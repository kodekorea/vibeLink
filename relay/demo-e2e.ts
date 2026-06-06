// Local end-to-end proof for the self-relay.
//
//   phone (this script's HTTP/WS client)
//        │  http://127.0.0.1:RELAY/h/<id>/...   and   ws://.../h/<id>/ws
//        ▼
//   relay (real relay/src/index.ts, started below)
//        │  multiplexed control WS  /_hub
//        ▼
//   hub-side RelayClient (real hub/src/relayClient.ts)
//        │  loopback
//        ▼
//   a stand-in "hub" HTTP+WS server (mimics HubServer: GET /pair-ish + /ws echo)
//
// Proves: a normal HTTP GET AND a WebSocket upgrade both traverse phone→relay→hub and
// back, with the relay as a dumb byte pipe. Run: `npx tsx demo-e2e.ts` from relay/.

import * as http from 'http';
import { spawn } from 'child_process';
import * as path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { RelayClient } from '../hub/src/relayClient';

const RELAY_PORT = 8799;
const HUB_LOCAL_PORT = 47899;
const HUB_ID = 'demo-hub';
const HUB_KEY = 'demo-key';

function wait(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  let failures = 0;
  const check = (label: string, ok: boolean, extra = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  — ' + extra : ''}`);
    if (!ok) failures++;
  };

  // 1) Stand-in hub local server (what HubServer would be): a GET endpoint + a /ws echo.
  const hubHttp = http.createServer((req, res) => {
    if (req.url === '/sessions') {
      // echo back the Authorization header so we prove end-to-end token passthrough.
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, sawAuth: req.headers['authorization'] ?? null, host: req.headers['host'] }));
      return;
    }
    res.writeHead(404); res.end('nope');
  });
  const hubWss = new WebSocketServer({ noServer: true });
  hubHttp.on('upgrade', (req, socket, head) => {
    if ((req.url ?? '').split('?')[0] !== '/ws') { socket.destroy(); return; }
    hubWss.handleUpgrade(req, socket as any, head, (ws) => {
      ws.on('message', (m: Buffer) => ws.send('echo:' + m.toString()));
      ws.send('hello-from-hub');
    });
  });
  await new Promise<void>((r) => hubHttp.listen(HUB_LOCAL_PORT, r));
  console.log(`[demo] stand-in hub local server on :${HUB_LOCAL_PORT}`);

  // 2) Start the REAL relay as a child process.
  const relayProc = spawn(process.execPath, ['--import', 'tsx', path.join(__dirname, 'src', 'index.ts')], {
    env: { ...process.env, RELAY_PORT: String(RELAY_PORT), RELAY_KEYS: `${HUB_ID}:${HUB_KEY}`, RELAY_PUBLIC_URL: `http://127.0.0.1:${RELAY_PORT}` },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  await wait(1500);

  // 3) Start the REAL hub-side RelayClient pointing the loopback at our stand-in hub.
  const client = new RelayClient({
    relayUrl: `ws://127.0.0.1:${RELAY_PORT}`,
    id: HUB_ID, key: HUB_KEY, localPort: HUB_LOCAL_PORT,
    publicUrl: `http://127.0.0.1:${RELAY_PORT}`,
    log: (m) => console.log('[relayClient] ' + m),
  });
  client.start();
  await wait(1200);

  // 4) "Phone": plain HTTP GET through the relay with a Bearer token.
  const getResult = await new Promise<any>((resolve) => {
    http.get(`http://127.0.0.1:${RELAY_PORT}/h/${HUB_ID}/sessions`, { headers: { Authorization: 'Bearer FAKE.JWT.TOKEN' } }, (res) => {
      let body = ''; res.on('data', (c) => (body += c)); res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', (e) => resolve({ status: 0, body: String(e) }));
  });
  let parsed: any = {};
  try { parsed = JSON.parse(getResult.body); } catch { /* */ }
  check('HTTP GET phone→relay→hub returns 200', getResult.status === 200, getResult.body);
  check('hub received the Bearer token end-to-end', parsed.sawAuth === 'Bearer FAKE.JWT.TOKEN');
  check('relay rewrote Host to loopback', parsed.host === '127.0.0.1');

  // 5) "Phone": WebSocket through the relay (proves /ws upgrade passthrough).
  const wsResult = await new Promise<{ greet?: string; echo?: string; err?: string }>((resolve) => {
    const out: { greet?: string; echo?: string } = {};
    const ws = new WebSocket(`ws://127.0.0.1:${RELAY_PORT}/h/${HUB_ID}/ws`);
    const done = () => { try { ws.close(); } catch { /* */ } resolve(out); };
    const t = setTimeout(() => resolve({ ...out, err: 'timeout' }), 4000);
    ws.on('open', () => ws.send('ping123'));
    ws.on('message', (m: Buffer) => {
      const s = m.toString();
      if (s.startsWith('echo:')) { out.echo = s; clearTimeout(t); done(); }
      else out.greet = s;
    });
    ws.on('error', (e) => { clearTimeout(t); resolve({ ...out, err: String(e) }); });
  });
  check('WS upgrade phone→relay→hub: got hub greeting', wsResult.greet === 'hello-from-hub', wsResult.err ?? '');
  check('WS bidirectional echo through relay', wsResult.echo === 'echo:ping123');

  // 6) Unknown hub id → 502 from the relay (dumb router behavior).
  // Fresh connection (Connection: close): the relay routes per TCP connection (it sniffs
  // the first request line), so don't let Node's keep-alive agent reuse the demo-hub
  // socket for this different /h/<id>.
  const unknown = await new Promise<number>((resolve) => {
    http.get(`http://127.0.0.1:${RELAY_PORT}/h/nope/sessions`, { headers: { Connection: 'close' }, agent: false }, (res) => { res.resume(); resolve(res.statusCode ?? 0); }).on('error', () => resolve(0));
  });
  check('unknown hub id → 502', unknown === 502, 'got ' + unknown);

  // cleanup
  client.stop();
  hubHttp.close();
  relayProc.kill();
  await wait(300);
  console.log(`\n[demo] ${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
