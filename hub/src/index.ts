import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { AuthStore } from './auth';
import { TunnelManager } from './tunnel';
import { ProjectStore } from './projects';
import { SessionManager } from './sessions';
import { loadNodePty } from './nodePty';
import { HubServer } from './server';

function loadSecret(): string {
  const p = path.join(os.homedir(), '.mtb', 'jwt_secret');
  try { return fs.readFileSync(p, 'utf8'); } catch { /* 생성 */ }
  const s = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, s);
  return s;
}

// claude를 라이트 테마로 띄우도록 ~/.claude/settings.json의 theme를 보장(없으면 추가/갱신).
function ensureClaudeTheme(theme: string): void {
  if (!theme) return;
  try {
    const p = path.join(os.homedir(), '.claude', 'settings.json');
    let cfg: Record<string, unknown> = {};
    try { cfg = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { /* 새로 생성 */ }
    if (cfg.theme === theme) return;
    cfg.theme = theme;
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
  } catch { /* 권한 등 — 무시 */ }
}

async function main(): Promise<void> {
  const port = Number(process.env.MTB_PORT ?? 47800);
  const shell = process.env.MTB_SHELL ?? 'powershell.exe';
  const launch = process.env.MTB_LAUNCH ?? 'claude';
  const log = (m: string) => console.log(`[hub] ${m}`);

  // MTB_CLAUDE_THEME 지정 시 claude 테마 보장(기본 light = Claude 라이트 느낌)
  ensureClaudeTheme(process.env.MTB_CLAUDE_THEME ?? 'light');

  if (!process.env.MTB_PASSWORD) log('경고: MTB_PASSWORD 미설정 — 첫 페어링은 /admin 코드가 필요(이 프로토타입은 MTB_PASSWORD 권장).');

  const store = new AuthStore(loadSecret());
  const tunnel = new TunnelManager(__dirname, log);
  const projects = new ProjectStore(path.join(os.homedir(), '.mtb', 'projects.json'));
  const pty = loadNodePty();
  const pwaDir = path.join(__dirname, '..', 'pwa');

  let server: HubServer;
  const sessions = new SessionManager(pty, m => server.broadcast(m), shell, launch);
  server = new HubServer(store, tunnel, projects, sessions, pwaDir);
  await server.listen(port);
  log(`서버 시작: http://127.0.0.1:${port}`);
  const lan = server.lanUrl();
  if (lan) { log(`같은 와이파이(추천): ${lan}`); log(`QR 페이지: http://127.0.0.1:${port}/qr.html`); }

  // 터널 선택: MTB_TUNNEL=named|quick (기본: named env 있으면 named, 없으면 quick)
  const name = process.env.MTB_TUNNEL_NAME;
  const url = process.env.MTB_TUNNEL_URL;
  const mode = process.env.MTB_TUNNEL || (name && url ? 'named' : 'quick');
  try {
    if (mode === 'named' && name && url) await tunnel.start('named', port, name, url);
    else await tunnel.start('quick', port);
    tunnel.onReady(u => { log(`접속 URL: ${u}`); log(`QR: ${u}/qr.html`); });
  } catch (e) { log(`터널 시작 실패(로컬은 동작): ${String(e)}`); }

  process.on('SIGINT', () => { sessions.dispose(); tunnel.stop(); process.exit(0); });
}

main().catch(e => { console.error(e); process.exit(1); });
