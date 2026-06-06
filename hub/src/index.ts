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
import { RelayClient } from './relayClient';

function loadSecret(): string {
  const p = path.join(os.homedir(), '.vibelink', 'jwt_secret');
  try { return fs.readFileSync(p, 'utf8'); } catch { /* 생성 */ }
  const s = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, s);
  return s;
}

// 릴레이용 안정적 hub id. MTB_RELAY_ID 우선, 없으면 jwt_secret 처럼 영구 생성/재사용.
function loadRelayId(): string {
  if (process.env.MTB_RELAY_ID) return process.env.MTB_RELAY_ID;
  const p = path.join(os.homedir(), '.vibelink', 'relay_id');
  try { return fs.readFileSync(p, 'utf8').trim(); } catch { /* 생성 */ }
  const id = 'hub-' + crypto.randomBytes(5).toString('hex');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, id);
  return id;
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
  const projects = new ProjectStore(path.join(os.homedir(), '.vibelink', 'projects.json'));
  const pty = loadNodePty();
  const pwaDir = path.join(__dirname, '..', 'pwa');

  let server: HubServer;
  const sessions = new SessionManager(pty, m => server.broadcast(m), shell, launch);
  // 폰에서 바꾼 완료 알림 임계값 복원
  try {
    const nf = path.join(os.homedir(), '.vibelink', 'notify.json');
    if (fs.existsSync(nf)) sessions.setNotify(JSON.parse(fs.readFileSync(nf, 'utf8')));
  } catch { /* 무시 */ }
  // 폰에서 고른 새 세션 기본 에이전트 복원
  try {
    const af = path.join(os.homedir(), '.vibelink', 'agent.json');
    if (fs.existsSync(af)) {
      const a = JSON.parse(fs.readFileSync(af, 'utf8'));
      if (a && a.agent) sessions.setDefaultAgent(String(a.agent));
    }
  } catch { /* 무시 */ }
  // 데스크톱/환경변수로 지정한 기본 에이전트·환경(런모드) — 파일보다 우선.
  if (process.env.MTB_DEFAULT_AGENT) sessions.setDefaultAgent(String(process.env.MTB_DEFAULT_AGENT));
  if (process.env.MTB_DEFAULT_ENV) sessions.setDefaultEnv(String(process.env.MTB_DEFAULT_ENV));
  server = new HubServer(store, tunnel, projects, sessions, pwaDir);
  await server.listen(port);
  log(`서버 시작: http://127.0.0.1:${port}`);
  const lan = server.lanUrl();
  if (lan) { log(`같은 와이파이(추천): ${lan}`); log(`QR 페이지: http://127.0.0.1:${port}/qr.html`); }

  // 터널 선택: MTB_TUNNEL=relay|named|quick (기본: named env 있으면 named, 없으면 quick)
  const name = process.env.MTB_TUNNEL_NAME;
  const url = process.env.MTB_TUNNEL_URL;
  const mode = process.env.MTB_TUNNEL || (name && url ? 'named' : 'quick');

  let relay: RelayClient | undefined;
  if (mode === 'relay') {
    // 셀프 호스트 릴레이: 허브가 밖으로 다이얼 → NAT/방화벽 뒤에서도 동작.
    const relayUrl = process.env.MTB_RELAY_URL;
    if (!relayUrl) {
      log('MTB_TUNNEL=relay 인데 MTB_RELAY_URL 미설정 — 릴레이 비활성(로컬/LAN은 동작).');
    } else {
      relay = new RelayClient({
        relayUrl,
        hubPath: process.env.MTB_RELAY_HUB_PATH,
        id: loadRelayId(),
        key: process.env.MTB_RELAY_KEY ?? '',
        localPort: port,
        publicUrl: process.env.MTB_RELAY_PUBLIC_URL,
        log,
      });
      relay.start();
      const hostUrl = relay.publicHostUrl;
      if (hostUrl) { log(`릴레이 접속 URL(폰 페어링): ${hostUrl}`); server.setExternalUrl(hostUrl, 'relay'); }
      else log('릴레이 등록 중 — MTB_RELAY_PUBLIC_URL 설정 시 폰 URL을 안내합니다.');
    }
  } else if (mode === 'lan' || mode === 'none') {
    log('외부 터널 없음(LAN 전용) — 같은 와이파이에서 LAN QR로 접속하세요.');
  } else {
    try {
      if (mode === 'named' && name && url) await tunnel.start('named', port, name, url);
      else await tunnel.start('quick', port);
      tunnel.onReady(u => { log(`접속 URL: ${u}`); log(`QR: ${u}/qr.html`); });
    } catch (e) { log(`터널 시작 실패(로컬은 동작): ${String(e)}`); }
  }

  process.on('SIGINT', () => { sessions.dispose(); relay?.stop(); tunnel.stop(); process.exit(0); });
}

main().catch(e => { console.error(e); process.exit(1); });
