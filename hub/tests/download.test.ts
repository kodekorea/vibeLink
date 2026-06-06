import { test, before, after } from 'node:test';
import assert from 'node:assert';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AuthStore } from '../src/auth';
import { HubServer } from '../src/server';
import type { TunnelManager } from '../src/tunnel';
import type { ProjectStore } from '../src/projects';
import type { SessionManager } from '../src/sessions';

// /download 라우트의 토큰 인증 경로를 실제 HTTP로 검증한다.
// 라우트는 this.store(AuthStore)만 사용하므로 나머지 협력자는 빈 스텁으로 캐스팅한다.

const secret = 'download-test-secret';
const store = new AuthStore(secret);
const tunnelStub = {} as unknown as TunnelManager;
const projectsStub = {} as unknown as ProjectStore;
const sessionsStub = { resyncTo() {} } as unknown as SessionManager;

let server: HubServer;
let port = 0;
let tmpFile = '';
let validToken = '';

before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtb-dl-'));
  tmpFile = path.join(dir, 'hello.txt');
  fs.writeFileSync(tmpFile, 'hello world');
  validToken = store.issueJwtDirect('dev-dl', '127.0.0.1', 'ua');
  server = new HubServer(store, tunnelStub, projectsStub, sessionsStub, os.tmpdir());
  await server.listen(0);
  // listen(0) → OS가 포트 할당. 내부 httpServer의 주소를 읽는다.
  const addr = (server as unknown as { httpServer: http.Server }).httpServer.address();
  port = typeof addr === 'object' && addr ? addr.port : 0;
  assert.ok(port > 0, 'server should bind a port');
});

after(() => {
  (server as unknown as { httpServer: http.Server }).httpServer.close();
});

function req(p: string, opts: http.RequestOptions = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method: 'GET', ...opts }, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    r.on('error', reject);
    r.end();
  });
}

test('/download: 유효한 쿼리 토큰이면 파일을 내려준다 (Bearer 없이)', async () => {
  const url = '/download?path=' + encodeURIComponent(tmpFile) + '&token=' + encodeURIComponent(validToken);
  const r = await req(url);
  assert.equal(r.status, 200);
  assert.equal(r.body, 'hello world');
});

test('/download: 쿼리 토큰이 Bearer와 동일한 검증을 통과한다', async () => {
  const url = '/download?path=' + encodeURIComponent(tmpFile);
  const r = await req(url, { headers: { Authorization: 'Bearer ' + validToken } });
  assert.equal(r.status, 200);
  assert.equal(r.body, 'hello world');
});

test('/download: 토큰 없음 → 401 "no token"', async () => {
  const url = '/download?path=' + encodeURIComponent(tmpFile);
  const r = await req(url);
  assert.equal(r.status, 401);
  assert.match(r.body, /no token/);
});

test('/download: 잘못된 토큰 → 401 "invalid token"', async () => {
  const url = '/download?path=' + encodeURIComponent(tmpFile) + '&token=not-a-real-jwt';
  const r = await req(url);
  assert.equal(r.status, 401);
  assert.match(r.body, /invalid token/);
});

test('/download: 폐기된 디바이스 토큰 → 401 "invalid token"', async () => {
  const tok = store.issueJwtDirect('dev-revoked', '127.0.0.1', 'ua');
  store.revokeDevice('dev-revoked');
  const url = '/download?path=' + encodeURIComponent(tmpFile) + '&token=' + encodeURIComponent(tok);
  const r = await req(url);
  assert.equal(r.status, 401);
  assert.match(r.body, /invalid token/);
});

test('/download: HEAD 프리플라이트는 본문 없이 200/401을 준다', async () => {
  const ok = '/download?path=' + encodeURIComponent(tmpFile) + '&token=' + encodeURIComponent(validToken);
  const rOk = await req(ok, { method: 'HEAD' });
  assert.equal(rOk.status, 200);
  assert.equal(rOk.body, '');

  const bad = '/download?path=' + encodeURIComponent(tmpFile);
  const rBad = await req(bad, { method: 'HEAD' });
  assert.equal(rBad.status, 401);
});
