const { app, BrowserWindow, Tray, Menu, ipcMain, shell, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const SMOKE = !!process.env.MTB_SMOKE;
const SETTINGS_PATH = path.join(os.homedir(), '.mtb', 'desktop.json');

let tray = null, win = null, hubProc = null, hubUrl = '', logs = [];

function readSettings() { try { return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')); } catch { return {}; } }
function writeSettings(s) { fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true }); fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2)); }
function settings() { const s = readSettings(); return { port: Number(s.port || process.env.MTB_PORT || 47801), password: s.password || 'changeme1234' }; }
function hubDir() { return app.isPackaged ? path.join(process.resourcesPath, 'hub') : path.join(__dirname, '..', 'hub'); }
function log(s) { logs.push(s); if (logs.length > 200) logs.shift(); }

function startHub() {
  if (hubProc) return;
  const cfg = settings();
  const env = Object.assign({}, process.env, { MTB_PORT: String(cfg.port), MTB_PASSWORD: cfg.password });
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
  tray.setToolTip('MTB Hub' + (hubUrl ? ' - ' + hubUrl : (hubProc ? ' - starting' : ' - stopped')));
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
  win = new BrowserWindow({ width: 460, height: 600, title: 'MTB Hub', webPreferences: { preload: path.join(__dirname, 'preload.js') } });
  win.loadFile('settings.html');
  win.on('close', e => { if (!app.isQuitting) { e.preventDefault(); win.hide(); } });
  win.webContents.on('did-finish-load', pushState);
}

ipcMain.handle('mtb:getState', () => state());
ipcMain.handle('mtb:start', () => { startHub(); return state(); });
ipcMain.handle('mtb:stop', () => { stopHub(); return state(); });
ipcMain.handle('mtb:save', (_e, s) => { const cur = readSettings(); writeSettings(Object.assign({}, cur, { port: Number(s.port) || 47801, password: s.password || 'changeme1234' })); return state(); });
ipcMain.handle('mtb:openQr', () => shell.openExternal('http://127.0.0.1:' + settings().port + '/qr.html'));
ipcMain.handle('mtb:openProjects', () => { const p = path.join(os.homedir(), '.mtb', 'projects.json'); if (!fs.existsSync(p)) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, '[]'); } shell.openPath(p); });

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
