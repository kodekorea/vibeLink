const { app, BrowserWindow, Tray, Menu, ipcMain, shell, nativeImage, powerSaveBlocker, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const SMOKE = !!process.env.MTB_SMOKE;
const SETTINGS_PATH = path.join(os.homedir(), '.vibelink', 'desktop.json');

let tray = null, win = null, hubProc = null, hubUrl = '', logs = [];
let hubStopRequested = false, hubRestarts = []; // 자동재시작 감독용
let psbId = null;                                // powerSaveBlocker 핸들

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
    agent: oneOf(s.agent, ['claude', 'opencode', 'codex', 'grok', 'antigravity'], 'claude'),         // 기본 에이전트
    runEnv: oneOf(s.runEnv, ['powershell', 'cmd', 'gitbash', 'wsl'], 'powershell'), // 런모드(환경)
    theme: (s.theme || s.claudeTheme) === 'dark' ? 'dark' : 'light',          // 테마 (claudeTheme 호환)
    runMode: (s.runMode || s.claudeMode) === 'skip' ? 'skip' : 'normal',      // 런모드: normal | skip(권한 건너뛰기)
    tunnel: oneOf(s.tunnel, ['cf', 'relay', 'quick', 'lan'], 'cf'),          // 기본=Cloudflare 터널
    relayUrl: s.relayUrl || '',     // 예: wss://relay.kodekorea.kr
    relayKey: s.relayKey || '',
    relayId: s.relayId || 'myhub',
    cfTunnelName: s.cfTunnelName || 'vibelink-hub',   // cloudflared named tunnel 이름
    cfHostname: s.cfHostname || 'hub.kodekorea.kr',   // 폰 접속 호스트명
    keepAwake: s.keepAwake !== false,          // hub 실행 중 PC 절전 차단(기본 ON)
    keepAwakeOnBattery: s.keepAwakeOnBattery === true, // 배터리에서도 차단(기본 OFF — 노트북 보호)
  };
}
function hubDir() { return app.isPackaged ? path.join(process.resourcesPath, 'hub') : path.join(__dirname, '..', 'hub'); }
function log(s) { logs.push(s); if (logs.length > 200) logs.shift(); }

// 절전 차단: hub 실행 중 + keepAwake + (충전 중 또는 배터리에서도 허용) 일 때만 ON.
// 'prevent-app-suspension' → Windows ES_SYSTEM_REQUIRED (시스템은 안 자고 화면만 꺼짐 = 전력 절약).
function refreshPowerBlocker() {
  const cfg = settings();
  const onBattery = (() => { try { return powerMonitor.isOnBatteryPower(); } catch { return false; } })();
  const shouldBlock = !!hubProc && cfg.keepAwake && (!onBattery || cfg.keepAwakeOnBattery);
  if (shouldBlock && psbId === null) {
    psbId = powerSaveBlocker.start('prevent-app-suspension');
    log('[power] 절전 차단 ON (배터리=' + onBattery + ')');
  } else if (!shouldBlock && psbId !== null) {
    powerSaveBlocker.stop(psbId); psbId = null;
    log('[power] 절전 차단 OFF');
  }
}

function startHub() {
  if (hubProc) return;
  hubStopRequested = false;
  const cfg = settings();
  const dot = loadDotEnv();
  const env = Object.assign({}, process.env, dot.vars, { MTB_PORT: String(cfg.port), MTB_PASSWORD: cfg.password });
  // 런모드(권한 건너뛰기)는 에이전트별 플래그를 hub가 붙인다 → MTB_LAUNCH는 베이스만.
  env.MTB_LAUNCH = 'claude';
  env.MTB_SKIP_PERMS = cfg.runMode === 'skip' ? '1' : '';
  env.MTB_CLAUDE_THEME = cfg.theme;
  env.MTB_DEFAULT_AGENT = cfg.agent;   // 새 세션 기본 에이전트
  env.MTB_DEFAULT_ENV = cfg.runEnv;    // 새 세션 기본 셸(환경)
  // 터널: 기본 Cloudflare named tunnel. 'cf' → hub의 named 모드(cloudflared tunnel run)로 매핑.
  if (cfg.tunnel === 'cf') {
    env.MTB_TUNNEL = 'named';
    env.MTB_TUNNEL_NAME = cfg.cfTunnelName;              // ~/.cloudflared/config.yml 의 터널
    env.MTB_TUNNEL_URL = 'https://' + cfg.cfHostname;    // 폰 페어링 주소
  } else {
    env.MTB_TUNNEL = cfg.tunnel;
  }
  if (cfg.tunnel === 'relay' && cfg.relayUrl) {
    env.MTB_RELAY_URL = cfg.relayUrl;
    env.MTB_RELAY_KEY = cfg.relayKey;
    env.MTB_RELAY_ID = cfg.relayId;
    env.MTB_RELAY_PUBLIC_URL = cfg.relayUrl.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
  }
  if (dot.file) log('[env] loaded ' + dot.file);
  log('[tunnel] ' + env.MTB_TUNNEL);
  const child = spawn('node', ['--import', 'tsx', 'src/index.ts'], { cwd: hubDir(), env });
  hubProc = child;
  child.stdout.on('data', d => { const s = d.toString(); const m = s.match(/https:\/\/[^\s"]+/); if (m) { hubUrl = m[0]; pushState(); } log(s); });
  child.stderr.on('data', d => log(d.toString()));
  child.on('exit', (code) => {
    if (hubProc !== child) return; // 새로 띄운 프로세스로 교체됨(설정 재시작 등) → 무시
    hubProc = null; hubUrl = ''; pushState(); refreshPowerBlocker();
    if (hubStopRequested || app.isQuitting) return; // 의도된 종료
    // 비정상 종료 → 자동 재시작 (1분 내 5회 초과 시 폭주 방지로 중단)
    const now = Date.now();
    hubRestarts = hubRestarts.filter(t => now - t < 60000);
    hubRestarts.push(now);
    if (hubRestarts.length > 5) { log('[hub] 1분 내 재시작 5회 초과 — 자동재시작 중단'); return; }
    log('[hub] 비정상 종료(code=' + code + ') — 2초 후 자동 재시작');
    setTimeout(() => { if (!hubProc && !hubStopRequested && !app.isQuitting) startHub(); }, 2000);
  });
  refreshPowerBlocker();
  pushState();
}
function stopHub() { hubStopRequested = true; if (hubProc) hubProc.kill(); hubProc = null; hubUrl = ''; refreshPowerBlocker(); pushState(); }
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
    agent: oneOf(s.agent, ['claude', 'opencode', 'codex', 'grok', 'antigravity'], 'claude'),
    runEnv: oneOf(s.runEnv, ['powershell', 'cmd', 'gitbash', 'wsl'], 'powershell'),
    theme: s.theme === 'dark' ? 'dark' : 'light',
    runMode: s.runMode === 'skip' ? 'skip' : 'normal',
    tunnel: oneOf(s.tunnel, ['cf', 'relay', 'quick', 'lan'], 'cf'),
    relayUrl: s.relayUrl || '',
    relayKey: s.relayKey || '',
    relayId: s.relayId || 'myhub',
    cfTunnelName: s.cfTunnelName || 'vibelink-hub',
    cfHostname: s.cfHostname || 'hub.kodekorea.kr',
    keepAwake: s.keepAwake !== false,
    keepAwakeOnBattery: s.keepAwakeOnBattery === true,
  }));
  refreshPowerBlocker(); // 토글 즉시 반영(재시작 안 해도)
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
  try { powerMonitor.on('on-ac', refreshPowerBlocker); powerMonitor.on('on-battery', refreshPowerBlocker); } catch { /* */ }
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
