const { app, BrowserWindow, Tray, Menu, ipcMain, shell, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const SMOKE = !!process.env.MTB_SMOKE;
const SETTINGS_PATH = path.join(os.homedir(), '.vibelink', 'desktop.json');

let tray = null, win = null, hubProc = null, hubUrl = '', logs = [];

// .env 파서 (의존성 없이 KEY=VALUE) — ngrok 토큰/도메인을 hub로 넘기기 위함.
function parseDotEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (k) out[k] = v;
  }
  return out;
}
// .env 탐색 순서: ~/.mtb/.env(설치 후 권장) → 저장소 루트(.env, 개발) → desktop/.env → 패키지 리소스
function loadDotEnv() {
  const candidates = [
    path.join(os.homedir(), '.vibelink', '.env'),
    path.join(__dirname, '..', '.env'),
    path.join(__dirname, '.env'),
    app.isPackaged ? path.join(process.resourcesPath, '.env') : null,
  ].filter(Boolean);
  for (const f of candidates) {
    try { if (fs.existsSync(f)) return { file: f, vars: parseDotEnv(fs.readFileSync(f, 'utf8')) }; } catch { /* ignore */ }
  }
  return { file: null, vars: {} };
}

function readSettings() { try { return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')); } catch { return {}; } }
function writeSettings(s) { fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true }); fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2)); }
function settings() {
  const s = readSettings();
  const oneOf = (v, list, def) => list.includes(v) ? v : def;
  return {
    port: Number(s.port || process.env.MTB_PORT || 47801),
    password: s.password || 'changeme1234',
    agent: oneOf(s.agent, ['claude', 'opencode', 'codex'], 'claude'),         // 기본 에이전트
    runEnv: oneOf(s.runEnv, ['powershell', 'cmd', 'gitbash', 'wsl'], 'powershell'), // 런모드(환경)
    theme: (s.theme || s.claudeTheme) === 'dark' ? 'dark' : 'light',          // 테마 (claudeTheme 호환)
    runMode: (s.runMode || s.claudeMode) === 'skip' ? 'skip' : 'normal',      // 런모드: normal | skip(권한 건너뛰기)
    tunnel: oneOf(s.tunnel, ['relay', 'quick', 'lan'], 'relay'),             // 기본=릴레이
    relayUrl: s.relayUrl || '',     // 예: wss://relay.kodekorea.kr
    relayKey: s.relayKey || '',
    relayId: s.relayId || 'myhub',
  };
}
function hubDir() { return app.isPackaged ? path.join(process.resourcesPath, 'hub') : path.join(__dirname, '..', 'hub'); }
function log(s) { logs.push(s); if (logs.length > 200) logs.shift(); }

function startHub() {
  if (hubProc) return;
  const cfg = settings();
  const dot = loadDotEnv();
  const env = Object.assign({}, process.env, dot.vars, { MTB_PORT: String(cfg.port), MTB_PASSWORD: cfg.password });
  // 런모드(권한 건너뛰기)는 에이전트별 플래그를 hub가 붙인다 → MTB_LAUNCH는 베이스만.
  env.MTB_LAUNCH = 'claude';
  env.MTB_SKIP_PERMS = cfg.runMode === 'skip' ? '1' : '';
  env.MTB_CLAUDE_THEME = cfg.theme;
  env.MTB_DEFAULT_AGENT = cfg.agent;   // 새 세션 기본 에이전트
  env.MTB_DEFAULT_ENV = cfg.runEnv;    // 새 세션 기본 셸(환경)
  // 터널: 기본 릴레이. 사용자가 env를 직접 안 만져도 데스크톱이 릴레이 연결정보를 전달.
  env.MTB_TUNNEL = cfg.tunnel;
  if (cfg.tunnel === 'relay' && cfg.relayUrl) {
    env.MTB_RELAY_URL = cfg.relayUrl;
    env.MTB_RELAY_KEY = cfg.relayKey;
    env.MTB_RELAY_ID = cfg.relayId;
    env.MTB_RELAY_PUBLIC_URL = cfg.relayUrl.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
  }
  if (dot.file) log('[env] loaded ' + dot.file);
  log('[tunnel] ' + env.MTB_TUNNEL);
  hubProc = spawn('node', ['--import', 'tsx', 'src/index.ts'], { cwd: hubDir(), env });
  hubProc.stdout.on('data', d => { const s = d.toString(); const m = s.match(/https:\/\/[^\s"]+/); if (m) { hubUrl = m[0]; pushState(); } log(s); });
  hubProc.stderr.on('data', d => log(d.toString()));
  hubProc.on('exit', () => { hubProc = null; hubUrl = ''; pushState(); });
  pushState();
}
function stopHub() { if (hubProc) hubProc.kill(); hubProc = null; hubUrl = ''; pushState(); }
function state() { return Object.assign({ running: !!hubProc, url: hubUrl, logs: logs.slice(-50) }, settings()); }
function pushState() { if (win && !win.isDestroyed()) win.webContents.send('mtb:state', state()); updateTray(); }

function trayImage() { try { const img = nativeImage.createFromPath(path.join(__dirname, 'tray.png')); return img.isEmpty() ? nativeImage.createEmpty() : img; } catch { return nativeImage.createEmpty(); } }
function updateTray() {
  if (!tray) return;
  tray.setToolTip('VibeLink' + (hubUrl ? ' - ' + hubUrl : (hubProc ? ' - starting' : ' - stopped')));
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: hubProc ? 'Stop hub' : 'Start hub', click: () => hubProc ? stopHub() : startHub() },
    { label: 'Settings...', click: showWindow },
    { label: 'Open QR page', enabled: !!hubProc, click: () => shell.openExternal('http://127.0.0.1:' + settings().port + '/qr.html') },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; stopHub(); app.quit(); } },
  ]));
}
function showWindow() {
  if (win && !win.isDestroyed()) { win.show(); win.focus(); return; }
  win = new BrowserWindow({ width: 480, height: 680, title: 'VibeLink', webPreferences: { preload: path.join(__dirname, 'preload.js') } });
  win.loadFile('settings.html');
  win.on('close', e => { if (!app.isQuitting) { e.preventDefault(); win.hide(); } });
  win.webContents.on('did-finish-load', pushState);
}

ipcMain.handle('mtb:getState', () => state());
ipcMain.handle('mtb:start', () => { startHub(); return state(); });
ipcMain.handle('mtb:stop', () => { stopHub(); return state(); });
ipcMain.handle('mtb:save', async (_e, s) => {
  const cur = readSettings();
  const oneOf = (v, list, def) => list.includes(v) ? v : def;
  writeSettings(Object.assign({}, cur, {
    port: Number(s.port) || 47801,
    password: s.password || 'changeme1234',
    agent: oneOf(s.agent, ['claude', 'opencode', 'codex'], 'claude'),
    runEnv: oneOf(s.runEnv, ['powershell', 'cmd', 'gitbash', 'wsl'], 'powershell'),
    theme: s.theme === 'dark' ? 'dark' : 'light',
    runMode: s.runMode === 'skip' ? 'skip' : 'normal',
    tunnel: oneOf(s.tunnel, ['relay', 'quick', 'lan'], 'relay'),
    relayUrl: s.relayUrl || '',
    relayKey: s.relayKey || '',
    relayId: s.relayId || 'myhub',
  }));
  // 실행 중이면 새 설정(암호/포트/claude옵션 등)을 반영하려고 자동 재시작.
  if (hubProc) {
    log('[settings] saved — restarting hub to apply');
    stopHub();
    await new Promise(r => setTimeout(r, 800)); // 포트 해제 대기
    startHub();
  }
  return state();
});
ipcMain.handle('mtb:openQr', () => shell.openExternal('http://127.0.0.1:' + settings().port + '/qr.html'));
ipcMain.handle('mtb:openProjects', () => { const p = path.join(os.homedir(), '.vibelink', 'projects.json'); if (!fs.existsSync(p)) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, '[]'); } shell.openPath(p); });
ipcMain.handle('mtb:openExternal', (_e, url) => { if (/^https:\/\//.test(String(url))) shell.openExternal(url); });

app.whenReady().then(() => {
  if (SMOKE) return runSmoke();
  tray = new Tray(trayImage());
  updateTray();
  startHub();
  showWindow();
});
app.on('window-all-closed', () => { /* stay alive in tray */ });
app.on('before-quit', () => { app.isQuitting = true; stopHub(); });

function httpStatus(url) { return new Promise(res => { const r = http.get(url, x => { res(x.statusCode); x.resume(); }); r.on('error', () => res(0)); }); }
function waitFor(fn, ms) { const t0 = Date.now(); return new Promise(resolve => { (async function loop(){ while (Date.now() - t0 < ms) { if (await fn()) return resolve(true); await new Promise(r => setTimeout(r, 500)); } resolve(false); })(); }); }
async function runSmoke() {
  startHub();
  const port = settings().port;
  const ok = await waitFor(async () => (await httpStatus('http://127.0.0.1:' + port + '/api/me')) === 401, 25000);
  console.log(ok ? 'SMOKE_OK' : 'SMOKE_FAIL');
  stopHub();
  setTimeout(() => app.exit(ok ? 0 : 1), 800);
}
