# MTB Hub 프로토타입 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** IDE 창과 무관하게 상주하며 폰에서 여러 프로젝트의 claude 세션을 생성·스와이프·재접속할 수 있는 Windows 네이티브 독립 서버(`hub/`)의 동작 확인용 프로토타입을 만든다.

**Architecture:** 루트에 독립 `hub/` Node 서버를 신설. 서버가 `node-pty`(Windows ConPTY)로 셸+claude 세션을 직접 소유하고, 기존 `auth.ts`(vscode-free)·`tunnel.ts`(로거만 교체)를 재사용한다. 폰은 세션 전용 최소 PWA로 WS 접속해 세션을 제어한다. 기존 `extension/`은 건드리지 않는다.

**Tech Stack:** TypeScript, Node(>=20), tsx(무빌드 실행), `ws`, `jsonwebtoken`, `qrcode`, `node-pty`, xterm.js(CDN), cloudflared(터널).

**참고:** 이 저장소는 아직 git이 아니다. Task 1에 선택적 `git init`이 있다. git을 쓰지 않으면 각 Task의 "Commit" 스텝은 건너뛰면 된다.

**설계 문서:** `docs/superpowers/specs/2026-06-04-mtb-hub-standalone-design.md`

---

## 파일 구조

```
hub/
  package.json          — deps/scripts
  tsconfig.json
  src/
    index.ts            — 엔트리: 시크릿/구성/시작
    auth.ts             — extension/src/auth.ts 복사(무수정)
    tunnel.ts           — extension/src/tunnel.ts 이식(로거 주입)
    nodePty.ts          — node-pty 로더 + IPty/PtySpawn 타입
    fsbrowse.ts         — 폴더 브라우즈 헬퍼(드라이브/하위폴더)
    projects.ts         — ProjectStore (~/.mtb/projects.json)
    sessions.ts         — SessionManager (pty 소유)
    server.ts           — HubServer (정적 PWA + REST + WS)
  pwa/
    index.html          — 세션 전용 최소 PWA
    manifest.json
  tests/
    projects.test.ts
    sessions.test.ts
  실행.bat              — 포그라운드 실행(디버그)
  launcher.vbs          — 콘솔 없이 hidden 실행
  설치-자동실행.bat     — 시작프로그램 등록
```

---

## Task 1: hub 스캐폴드

**Files:**
- Create: `hub/package.json`
- Create: `hub/tsconfig.json`
- Create: `hub/.gitignore`

- [ ] **Step 1: (선택) git 초기화**

저장소 루트(`E:\mobile_term_bridge_distrib`)에서:
```bash
git init
git add -A && git commit -m "chore: snapshot before hub prototype"
```
git을 원치 않으면 이 스텝과 이후 모든 Commit 스텝을 건너뛴다.

- [ ] **Step 2: `hub/package.json` 작성**

```json
{
  "name": "mtb-hub",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "start": "tsx src/index.ts",
    "typecheck": "tsc -p . --noEmit",
    "test": "node --import tsx --test tests/*.test.ts"
  },
  "dependencies": {
    "jsonwebtoken": "^9.0.2",
    "node-pty": "^1.0.0",
    "qrcode": "^1.5.4",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/jsonwebtoken": "^9.0.6",
    "@types/node": "^20.14.0",
    "@types/qrcode": "^1.5.5",
    "@types/ws": "^8.5.10",
    "tsx": "^4.19.0",
    "typescript": "^5.5.0"
  }
}
```

- [ ] **Step 3: `hub/tsconfig.json` 작성**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 4: `hub/.gitignore` 작성**

```
node_modules/
dist/
cloudflared.exe
cloudflared
```

- [ ] **Step 5: 의존성 설치 (Windows 네이티브 — WSL 불필요)**

Run (PowerShell, `hub/`에서): `npm install`
Expected: `node_modules/` 생성, node-pty 프리빌트 설치(빌드 도구 없이 성공). 에러 없이 종료.

- [ ] **Step 6: Commit**

```bash
git add hub/package.json hub/tsconfig.json hub/.gitignore
git commit -m "chore(hub): scaffold standalone hub package"
```

---

## Task 2: auth 복사 + node-pty 로더 + fs 브라우즈

**Files:**
- Create: `hub/src/auth.ts` (복사)
- Create: `hub/src/nodePty.ts`
- Create: `hub/src/fsbrowse.ts`

- [ ] **Step 1: auth.ts 복사 (무수정)**

Run: `Copy-Item extension/src/auth.ts hub/src/auth.ts`
이 파일은 vscode 의존이 전혀 없어 그대로 동작한다(`AuthStore`, `verifyJwt`, `attemptPair`, `issueJwtDirect`, `MTB_PASSWORD` 처리 포함).

- [ ] **Step 2: `hub/src/nodePty.ts` 작성**

```ts
// node-pty를 표준 인터페이스로 감싼다. 테스트는 PtySpawn을 가짜로 주입한다.
export interface IPty {
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: { exitCode: number }) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  readonly pid: number;
}

export interface SpawnOpts {
  name?: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv;
}

export type PtySpawn = (file: string, args: string[], opts: SpawnOpts) => IPty;

export function loadNodePty(): PtySpawn {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pty = require('node-pty');
  return (file, args, opts) => pty.spawn(file, args, opts) as IPty;
}
```

- [ ] **Step 3: `hub/src/fsbrowse.ts` 작성**

```ts
import * as fs from 'fs';
import * as path from 'path';

export interface Entry { name: string; path: string; }

// 폴더 안의 하위 디렉터리만 (정렬)
export function browseDir(p: string): Entry[] {
  return fs.readdirSync(p, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => ({ name: d.name, path: path.join(p, d.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Windows 드라이브 루트 목록
export function drives(): Entry[] {
  const out: Entry[] = [];
  for (const c of 'CDEFGHIJ') {
    const root = `${c}:\\`;
    try { fs.accessSync(root); out.push({ name: root, path: root }); } catch { /* 없음 */ }
  }
  return out;
}
```

- [ ] **Step 4: 타입체크**

Run (`hub/`): `npm run typecheck`
Expected: 에러 없이 종료(컴파일 통과).

- [ ] **Step 5: Commit**

```bash
git add hub/src/auth.ts hub/src/nodePty.ts hub/src/fsbrowse.ts
git commit -m "feat(hub): copy auth, add node-pty loader and fs browse"
```

---

## Task 3: ProjectStore (TDD)

**Files:**
- Create: `hub/src/projects.ts`
- Test: `hub/tests/projects.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// hub/tests/projects.test.ts
import { test } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ProjectStore } from '../src/projects';

function tmpFile(): string {
  return path.join(os.tmpdir(), `mtb-proj-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
}

test('파일이 없으면 빈 목록', () => {
  const store = new ProjectStore(tmpFile());
  assert.deepEqual(store.list(), []);
});

test('add 하면 저장되고 list로 다시 읽힌다', () => {
  const f = tmpFile();
  const store = new ProjectStore(f);
  store.add({ label: 'projA', path: 'C:\\a' });
  assert.deepEqual(store.list(), [{ label: 'projA', path: 'C:\\a' }]);
  fs.unlinkSync(f);
});

test('같은 path는 중복되지 않고 최신 label로 갱신', () => {
  const f = tmpFile();
  const store = new ProjectStore(f);
  store.add({ label: 'old', path: 'C:\\a' });
  store.add({ label: 'new', path: 'C:\\a' });
  assert.deepEqual(store.list(), [{ label: 'new', path: 'C:\\a' }]);
  fs.unlinkSync(f);
});

test('깨진 JSON이면 빈 목록', () => {
  const f = tmpFile();
  fs.writeFileSync(f, '{not json');
  const store = new ProjectStore(f);
  assert.deepEqual(store.list(), []);
  fs.unlinkSync(f);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run (`hub/`): `npm test`
Expected: FAIL — `Cannot find module '../src/projects'`.

- [ ] **Step 3: 최소 구현 작성**

```ts
// hub/src/projects.ts
import * as fs from 'fs';
import * as path from 'path';

export interface Project { label: string; path: string; }

export class ProjectStore {
  constructor(private file: string) {}

  list(): Project[] {
    try {
      const arr = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!Array.isArray(arr)) return [];
      return arr.filter(p => p && typeof p.label === 'string' && typeof p.path === 'string')
        .map(p => ({ label: p.label, path: p.path }));
    } catch { return []; }
  }

  add(project: Project): Project[] {
    const list = this.list().filter(p => p.path !== project.path);
    list.push({ label: project.label, path: project.path });
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(list, null, 2));
    return list;
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run (`hub/`): `npm test`
Expected: PASS — projects 관련 4개 통과.

- [ ] **Step 5: Commit**

```bash
git add hub/src/projects.ts hub/tests/projects.test.ts
git commit -m "feat(hub): ProjectStore with json persistence (TDD)"
```

---

## Task 4: SessionManager (TDD, 가짜 pty)

**Files:**
- Create: `hub/src/sessions.ts`
- Test: `hub/tests/sessions.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// hub/tests/sessions.test.ts
import { test } from 'node:test';
import assert from 'node:assert';
import { SessionManager } from '../src/sessions';
import type { IPty } from '../src/nodePty';

function fakePty() {
  let dataCb: (d: string) => void = () => {};
  let exitCb: (e: { exitCode: number }) => void = () => {};
  const writes: string[] = [];
  const pty: IPty = {
    pid: 123,
    onData(cb) { dataCb = cb; },
    onExit(cb) { exitCb = cb; },
    write(d) { writes.push(d); },
    resize() { /* noop */ },
    kill() { exitCb({ exitCode: 0 }); },
  };
  return { pty, writes, emit: (d: string) => dataCb(d), exit: () => exitCb({ exitCode: 0 }) };
}

test('create: pty 생성 + launch 명령 입력 + 목록 등록 + session_list 방송', () => {
  const f = fakePty();
  const msgs: any[] = [];
  const sm = new SessionManager(() => f.pty, m => msgs.push(m), 'powershell.exe', 'claude');
  const id = sm.create({ label: 'projA', path: 'C:\\a' });
  assert.equal(id, '1');
  assert.deepEqual(f.writes, ['claude\r']);
  assert.deepEqual(sm.list(), [{ id: '1', label: 'projA' }]);
  assert.ok(msgs.some(m => m.type === 'session_list'));
});

test('pty 데이터 → terminal_data 방송 + 버퍼 누적', () => {
  const f = fakePty();
  const msgs: any[] = [];
  const sm = new SessionManager(() => f.pty, m => msgs.push(m), 'powershell.exe', '');
  const id = sm.create({ label: 'p', path: 'C:\\p' });
  f.emit('hello');
  assert.ok(msgs.some(m => m.type === 'terminal_data' && m.sessionId === id && m.data === 'hello'));
});

test('resyncTo: 목록 + 누적 버퍼 리플레이', () => {
  const f = fakePty();
  const sm = new SessionManager(() => f.pty, () => {}, 'powershell.exe', '');
  const id = sm.create({ label: 'p', path: 'C:\\p' });
  f.emit('abc');
  const sent: any[] = [];
  sm.resyncTo(m => sent.push(m));
  assert.ok(sent.some(m => m.type === 'session_list'));
  assert.ok(sent.some(m => m.type === 'terminal_data' && m.sessionId === id && m.data === 'abc'));
});

test('replayTo: 특정 세션 버퍼만 전송', () => {
  const f = fakePty();
  const sm = new SessionManager(() => f.pty, () => {}, 'powershell.exe', '');
  const id = sm.create({ label: 'p', path: 'C:\\p' });
  f.emit('xyz');
  const sent: any[] = [];
  sm.replayTo(id, m => sent.push(m));
  assert.deepEqual(sent, [{ type: 'terminal_data', sessionId: id, data: 'xyz' }]);
});

test('close → pty.kill → onExit → terminal_exit + 목록에서 제거', () => {
  const f = fakePty();
  const msgs: any[] = [];
  const sm = new SessionManager(() => f.pty, m => msgs.push(m), 'powershell.exe', '');
  const id = sm.create({ label: 'p', path: 'C:\\p' });
  assert.equal(sm.close(id), true);
  assert.ok(msgs.some(m => m.type === 'terminal_exit' && m.sessionId === id));
  assert.deepEqual(sm.list(), []);
});

test('write는 해당 세션 pty로 전달', () => {
  const f = fakePty();
  const sm = new SessionManager(() => f.pty, () => {}, 'powershell.exe', '');
  const id = sm.create({ label: 'p', path: 'C:\\p' });
  f.writes.length = 0;
  sm.write(id, 'ls\r');
  assert.deepEqual(f.writes, ['ls\r']);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run (`hub/`): `npm test`
Expected: FAIL — `Cannot find module '../src/sessions'`.

- [ ] **Step 3: 최소 구현 작성**

```ts
// hub/src/sessions.ts
import type { IPty, PtySpawn } from './nodePty';

export interface Project { label: string; path: string; }
export interface SessionInfo { id: string; label: string; }
export type Send = (msg: object) => void;

const MAX_BUFFER = 200 * 1024;

interface Session {
  id: string; label: string; cwd: string;
  pty: IPty; buffer: string; cols: number; rows: number;
}

export class SessionManager {
  private sessions = new Map<string, Session>();
  private counter = 0;

  constructor(
    private spawn: PtySpawn,
    private broadcast: Send,
    private shell: string,
    private launchCmd: string,
  ) {}

  create(project: Project, cols = 80, rows = 24): string {
    const pty = this.spawn(this.shell, [], {
      name: 'xterm-256color', cols, rows, cwd: project.path, env: process.env,
    });
    const id = String(++this.counter);
    const session: Session = { id, label: project.label, cwd: project.path, pty, buffer: '', cols, rows };
    this.sessions.set(id, session);

    pty.onData(data => {
      this.append(session, data);
      this.broadcast({ type: 'terminal_data', sessionId: id, data });
    });
    pty.onExit(() => {
      this.broadcast({ type: 'terminal_exit', sessionId: id });
      this.sessions.delete(id);
      this.broadcastList();
    });

    if (this.launchCmd) pty.write(this.launchCmd + '\r');
    this.broadcastList();
    return id;
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.pty.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    const s = this.sessions.get(id);
    if (!s || cols < 1 || rows < 1) return;
    s.cols = cols; s.rows = rows;
    try { s.pty.resize(cols, rows); } catch { /* 종료됨 */ }
  }

  close(id: string): boolean {
    const s = this.sessions.get(id);
    if (!s) return false;
    try { s.pty.kill(); } catch { /* 무시 */ }
    return true;
  }

  list(): SessionInfo[] {
    return Array.from(this.sessions.values()).map(s => ({ id: s.id, label: s.label }));
  }

  // 새 클라이언트 접속 시: 목록 + 각 세션 버퍼 리플레이
  resyncTo(send: Send): void {
    send({ type: 'session_list', sessions: this.list() });
    for (const s of this.sessions.values()) {
      if (s.buffer) send({ type: 'terminal_data', sessionId: s.id, data: s.buffer });
    }
  }

  // 세션 전환 시: 해당 세션 버퍼만 다시 전송
  replayTo(id: string, send: Send): void {
    const s = this.sessions.get(id);
    if (s?.buffer) send({ type: 'terminal_data', sessionId: id, data: s.buffer });
  }

  private broadcastList(): void {
    this.broadcast({ type: 'session_list', sessions: this.list() });
  }

  private append(s: Session, data: string): void {
    const next = s.buffer + data;
    s.buffer = next.length > MAX_BUFFER ? next.slice(next.length - MAX_BUFFER) : next;
  }

  dispose(): void {
    for (const s of this.sessions.values()) { try { s.pty.kill(); } catch { /* */ } }
    this.sessions.clear();
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run (`hub/`): `npm test`
Expected: PASS — sessions 6개 + projects 4개 모두 통과.

- [ ] **Step 5: Commit**

```bash
git add hub/src/sessions.ts hub/tests/sessions.test.ts
git commit -m "feat(hub): SessionManager owning pty sessions (TDD)"
```

---

## Task 5: tunnel.ts 이식 (로거 주입)

**Files:**
- Create: `hub/src/tunnel.ts` (extension/src/tunnel.ts 기반)

- [ ] **Step 1: tunnel.ts 복사 후 vscode 제거**

`extension/src/tunnel.ts`를 `hub/src/tunnel.ts`로 복사한 뒤 아래만 수정한다(나머지 로직은 그대로 — cloudflared 다운로드, quick/named 터널, QR 생성 포함):

1. `import * as vscode from 'vscode';` **줄 삭제**.
2. 생성자 시그니처 교체:
```ts
  constructor(
    private extPath: string,
    private log: (msg: string) => void,
  ) {}
```
3. 본문의 모든 `this.out.appendLine(X)` → `this.log(X)` 로 치환.
4. `showQR` 안의 `this.out.appendLine(...)` 들도 `this.log(...)`로, 마지막 `this.out.show(true);` **줄 삭제**.

- [ ] **Step 2: 타입체크**

Run (`hub/`): `npm run typecheck`
Expected: 에러 없이 종료(`vscode` 참조가 더는 없음).

- [ ] **Step 3: Commit**

```bash
git add hub/src/tunnel.ts
git commit -m "feat(hub): port TunnelManager with injectable logger"
```

---

## Task 6: HubServer (정적 + REST + WS)

**Files:**
- Create: `hub/src/server.ts`

- [ ] **Step 1: `hub/src/server.ts` 작성**

```ts
import * as fs from 'fs';
import * as http from 'http';
import * as net from 'net';
import * as path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { AuthStore } from './auth';
import { TunnelManager } from './tunnel';
import { ProjectStore } from './projects';
import { SessionManager } from './sessions';
import { browseDir, drives } from './fsbrowse';

function parseCookies(req: http.IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) out[k.trim()] = v.join('=').trim();
  }
  return out;
}
function cookieHeader(token: string): string {
  return `mtb_jwt=${token}; HttpOnly; SameSite=Strict; Max-Age=${7 * 24 * 3600}; Path=/`;
}
function remoteIp(req: http.IncomingMessage): string {
  return (req.socket as net.Socket).remoteAddress ?? '';
}
function isLoopback(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

export class HubServer {
  private httpServer: http.Server;
  private wss: WebSocketServer;
  private clients = new Set<WebSocket>();

  constructor(
    private store: AuthStore,
    private tunnel: TunnelManager,
    private projects: ProjectStore,
    private sessions: SessionManager,
    private pwaDir: string,
  ) {
    this.httpServer = http.createServer((req, res) => void this.route(req, res));
    this.wss = new WebSocketServer({ noServer: true });

    this.httpServer.on('upgrade', (req, socket, head) => {
      if (req.url !== '/ws') { socket.destroy(); return; }
      if (!store.verifyJwt(parseCookies(req)['mtb_jwt'] ?? '')) { socket.destroy(); return; }
      this.wss.handleUpgrade(req, socket, head, ws => {
        this.clients.add(ws);
        ws.on('close', () => this.clients.delete(ws));
        ws.on('message', (raw: Buffer) => this.onMessage(ws, raw.toString()));
        this.sessions.resyncTo(m => ws.send(JSON.stringify(m)));
      });
    });
  }

  // SessionManager가 broadcast 콜백으로 사용
  broadcast = (msg: object): void => {
    const data = JSON.stringify(msg);
    for (const ws of this.clients) if (ws.readyState === WebSocket.OPEN) ws.send(data);
  };

  listen(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.httpServer.once('error', reject);
      this.httpServer.listen(port, () => { this.httpServer.removeListener('error', reject); resolve(); });
    });
  }

  private onMessage(ws: WebSocket, raw: string): void {
    let m: { type?: string; sessionId?: string; data?: string; cols?: number; rows?: number };
    try { m = JSON.parse(raw); } catch { return; }
    if (!m.sessionId) return;
    switch (m.type) {
      case 'input':  this.sessions.write(m.sessionId, m.data ?? ''); break;
      case 'resize': this.sessions.resize(m.sessionId, m.cols ?? 0, m.rows ?? 0); break;
      case 'select': this.sessions.replayTo(m.sessionId, msg => ws.send(JSON.stringify(msg))); break;
    }
  }

  private auth(req: http.IncomingMessage): boolean {
    return !!this.store.verifyJwt(parseCookies(req)['mtb_jwt'] ?? '');
  }

  private async route(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = req.url ?? '/';
    const meth = req.method ?? 'GET';
    const pathOnly = url.split('?')[0];

    // 정적 PWA
    const staticMap: Record<string, string> = { '/': 'index.html', '/index.html': 'index.html', '/manifest.json': 'manifest.json' };
    if (meth === 'GET' && staticMap[pathOnly]) {
      const mime = pathOnly.endsWith('.json') ? 'application/json' : 'text/html; charset=utf-8';
      return this.sendFile(res, path.join(this.pwaDir, staticMap[pathOnly]), mime);
    }

    // QR
    if (meth === 'GET' && pathOnly === '/qr') {
      const u = this.tunnel.url;
      if (!u) { res.writeHead(503); res.end('tunnel not ready'); return; }
      const buf = await this.tunnel.qrPng(u);
      res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(buf); return;
    }
    if (meth === 'GET' && pathOnly === '/qr.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(this.qrPage(this.tunnel.url ?? '')); return;
    }

    // 인증 확인
    if (meth === 'GET' && pathOnly === '/api/me') {
      if (!this.auth(req)) { this.json(res, 401, { error: 'unauthenticated' }); return; }
      this.json(res, 200, { ok: true }); return;
    }

    // 세션 목록
    if (meth === 'GET' && pathOnly === '/sessions') {
      if (!this.auth(req)) { this.json(res, 401, { error: 'unauthenticated' }); return; }
      this.json(res, 200, { sessions: this.sessions.list() }); return;
    }

    // 프로젝트 즐겨찾기 목록
    if (meth === 'GET' && pathOnly === '/projects') {
      if (!this.auth(req)) { this.json(res, 401, { error: 'unauthenticated' }); return; }
      this.json(res, 200, { projects: this.projects.list() }); return;
    }

    // 폴더 브라우즈
    if (meth === 'GET' && pathOnly === '/fs') {
      if (!this.auth(req)) { this.json(res, 401, { error: 'unauthenticated' }); return; }
      const p = new URL(url, 'http://x').searchParams.get('path');
      if (!p) { this.json(res, 200, { cwd: null, entries: drives() }); return; }
      try { this.json(res, 200, { cwd: p, entries: browseDir(decodeURIComponent(p)) }); }
      catch (e) { this.json(res, 400, { error: String(e) }); }
      return;
    }

    // POST
    if (meth === 'POST') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => { let d: Record<string, unknown> = {}; try { d = JSON.parse(body); } catch { /* */ } void this.handlePost(pathOnly, req, res, d); });
      return;
    }

    res.writeHead(404); res.end('not found');
  }

  private handlePost(url: string, req: http.IncomingMessage, res: http.ServerResponse, data: Record<string, unknown>): void {
    const ip = remoteIp(req);
    const ua = String(req.headers['user-agent'] ?? '').slice(0, 200);

    if (url === '/pair') {
      const code = String(data['code'] ?? '').trim();
      const deviceId = String(data['device_id'] ?? '').trim();
      if (!code || !deviceId) { this.json(res, 400, { error: 'code and device_id required' }); return; }
      const r = this.store.attemptPair(code, deviceId, ip, ua);
      if (!r.ok) { if (r.reason !== 'rate_limited') this.store.registerFailure(code, ip, ua); this.json(res, r.reason === 'rate_limited' ? 429 : 401, { error: r.reason }); return; }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': cookieHeader(r.token!) });
      res.end(JSON.stringify({ ok: true })); return;
    }

    if (url === '/auto-pair') {
      if (!isLoopback(ip)) { this.json(res, 401, { error: 'localhost only' }); return; }
      const token = this.store.issueJwtDirect(`local:${ip}`, ip, ua);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': cookieHeader(token) });
      res.end(JSON.stringify({ ok: true })); return;
    }

    if (!this.auth(req)) { this.json(res, 401, { error: 'unauthenticated' }); return; }

    if (url === '/sessions/create') {
      const p = String(data['path'] ?? '');
      if (!p) { this.json(res, 400, { error: 'path required' }); return; }
      const label = String(data['label'] ?? (p.split(/[\\/]/).filter(Boolean).pop() || p));
      this.sessions.create({ label, path: p });
      this.json(res, 200, { ok: true }); return;
    }

    if (url === '/sessions/close') {
      const id = String(data['id'] ?? '');
      this.json(res, 200, { ok: this.sessions.close(id) }); return;
    }

    if (url === '/projects/add') {
      const label = String(data['label'] ?? '');
      const p = String(data['path'] ?? '');
      if (!p) { this.json(res, 400, { error: 'path required' }); return; }
      this.projects.add({ label: label || p, path: p });
      this.json(res, 200, { projects: this.projects.list() }); return;
    }

    res.writeHead(404); res.end('not found');
  }

  private sendFile(res: http.ServerResponse, filePath: string, mime: string): void {
    if (!fs.existsSync(filePath)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': mime });
    fs.createReadStream(filePath).pipe(res);
  }
  private json(res: http.ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }
  private qrPage(url: string): string {
    return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>MTB Hub 접속</title>
<style>body{font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#111;color:#eee}img{width:240px;height:240px;border:16px solid #fff;border-radius:8px}p{font-size:13px;color:#aaa;word-break:break-all;max-width:280px;text-align:center}</style>
</head><body><h2 style="margin-bottom:24px">휴대폰으로 찍어 접속</h2>
${url ? '<img src="/qr" alt="QR">' : '<p>터널 준비 중...</p>'}
<p style="margin-top:16px">${url}</p><p>접속 후 암호 입력 → 페어링</p></body></html>`;
  }
}
```

- [ ] **Step 2: 타입체크**

Run (`hub/`): `npm run typecheck`
Expected: 에러 없이 종료.

- [ ] **Step 3: Commit**

```bash
git add hub/src/server.ts
git commit -m "feat(hub): HubServer with static PWA, REST and WS"
```

---

## Task 7: 엔트리 (index.ts)

**Files:**
- Create: `hub/src/index.ts`

- [ ] **Step 1: `hub/src/index.ts` 작성**

```ts
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

async function main(): Promise<void> {
  const port = Number(process.env.MTB_PORT ?? 47800);
  const shell = process.env.MTB_SHELL ?? 'powershell.exe';
  const launch = process.env.MTB_LAUNCH ?? 'claude';
  const log = (m: string) => console.log(`[hub] ${m}`);

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

  const name = process.env.MTB_TUNNEL_NAME;
  const url = process.env.MTB_TUNNEL_URL;
  try {
    if (name && url) await tunnel.start('named', port, name, url);
    else await tunnel.start('quick', port);
    tunnel.onReady(u => { log(`접속 URL: ${u}`); log(`QR: ${u}/qr.html`); });
  } catch (e) { log(`터널 시작 실패(로컬은 동작): ${String(e)}`); }

  process.on('SIGINT', () => { sessions.dispose(); tunnel.stop(); process.exit(0); });
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: 타입체크**

Run (`hub/`): `npm run typecheck`
Expected: 에러 없이 종료.

- [ ] **Step 3: 로컬 기동 스모크 (터널 없이)**

Run (`hub/`, PowerShell): `$env:MTB_PASSWORD='test1234'; npm start`
Expected: 콘솔에 `서버 시작: http://127.0.0.1:47800` 출력. cloudflared 다운로드/터널 로그가 이어짐(인터넷 필요). `Ctrl+C`로 종료.

- [ ] **Step 4: Commit**

```bash
git add hub/src/index.ts
git commit -m "feat(hub): entry wiring secret/tunnel/sessions/server"
```

---

## Task 8: 세션 전용 PWA

**Files:**
- Create: `hub/pwa/index.html`
- Create: `hub/pwa/manifest.json`

- [ ] **Step 1: `hub/pwa/manifest.json` 작성**

```json
{
  "name": "MTB Hub",
  "short_name": "MTB",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0b0b0b",
  "theme_color": "#0b0b0b"
}
```

- [ ] **Step 2: `hub/pwa/index.html` 작성**

```html
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>MTB Hub</title>
<link rel="manifest" href="/manifest.json">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.min.css">
<style>
  :root{color-scheme:dark}*{box-sizing:border-box}
  html,body{margin:0;height:100%;background:#0b0b0b;color:#ddd;font-family:sans-serif}
  #app{display:flex;flex-direction:column;height:100%}
  #pair{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;height:100%}
  #pair input{font-size:18px;padding:10px;width:220px;text-align:center}
  .btn,#pairBtn{font-size:16px;padding:10px 16px;background:#2563eb;color:#fff;border:none;border-radius:6px}
  #bar{display:flex;gap:6px;padding:6px;overflow-x:auto;background:#151515;align-items:center}
  .chip{padding:6px 12px;background:#222;border-radius:16px;white-space:nowrap;font-size:13px}
  .chip.active{background:#2563eb}
  #plus{padding:6px 12px;background:#333;border-radius:16px;font-size:18px}
  #term{flex:1;min-height:0;position:relative}
  #term .xterm-viewport{overflow-y:auto !important;-webkit-overflow-scrolling:touch;touch-action:pan-y;overscroll-behavior:contain}
  #inputbar{display:flex;gap:6px;padding:6px;background:#151515}
  #inputbar input{flex:1;font-size:16px;padding:8px;background:#000;color:#eee;border:1px solid #333;border-radius:6px}
  #modal{position:fixed;inset:0;background:rgba(0,0,0,.7);display:none;align-items:center;justify-content:center}
  #modal.show{display:flex}
  #sheet{background:#1a1a1a;width:90%;max-width:420px;max-height:80%;overflow:auto;border-radius:10px;padding:14px}
  .row{padding:10px;border-bottom:1px solid #2a2a2a;cursor:pointer}
  .hidden{display:none !important}
</style>
</head>
<body>
<div id="app">
  <div id="pair">
    <h2>MTB Hub</h2>
    <input id="pw" type="password" placeholder="암호" autocomplete="off">
    <button id="pairBtn">연결</button>
    <div id="pairMsg" style="color:#f66;font-size:13px"></div>
  </div>
  <div id="main" class="hidden">
    <div id="bar"></div>
    <div id="term"></div>
    <div id="inputbar">
      <input id="line" placeholder="명령 입력 후 Enter" autocomplete="off" autocapitalize="off">
      <button class="btn" id="esc">Esc</button>
    </div>
  </div>
</div>
<div id="modal"><div id="sheet"></div></div>

<script src="https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.min.js"></script>
<script>
const deviceId = (() => {
  let id = localStorage.getItem('mtb_device');
  if (!id) { id = 'dev-' + Math.random().toString(36).slice(2); localStorage.setItem('mtb_device', id); }
  return id;
})();
const $ = s => document.querySelector(s);
let ws, term, fit, sessions = [], active = '';

function api(p, opts){ return fetch(p, Object.assign({ headers:{ 'Content-Type':'application/json' } }, opts)); }
function escapeHtml(s){ return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

$('#pairBtn').onclick = pair;
$('#pw').addEventListener('keydown', e => { if (e.key === 'Enter') pair(); });
async function pair(){
  const r = await api('/pair', { method:'POST', body: JSON.stringify({ code: $('#pw').value, device_id: deviceId }) });
  if (r.ok) start(); else $('#pairMsg').textContent = '인증 실패';
}
api('/api/me').then(r => { if (r.ok) start(); });

function start(){
  $('#pair').classList.add('hidden');
  $('#main').classList.remove('hidden');
  setupTerm();
  connect();
}

function setupTerm(){
  term = new Terminal({ scrollback: 5000, fontSize: 13, theme: { background:'#0b0b0b' } });
  fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open($('#term'));
  doFit();
  term.onData(d => sendWs({ type:'input', sessionId: active, data: d }));
  term.onResize(({cols,rows}) => sendWs({ type:'resize', sessionId: active, cols, rows }));
  window.addEventListener('resize', doFit);
  $('#line').addEventListener('keydown', e => {
    if (e.key === 'Enter') { sendWs({ type:'input', sessionId: active, data: $('#line').value + '\r' }); $('#line').value=''; }
  });
  $('#esc').onclick = () => sendWs({ type:'input', sessionId: active, data: '\x1b' });
  let sx=0, sy=0, st=0; const t = $('#term');
  t.addEventListener('touchstart', e => { const k=e.changedTouches[0]; sx=k.clientX; sy=k.clientY; st=Date.now(); }, {passive:true});
  t.addEventListener('touchend', e => {
    const k=e.changedTouches[0], dx=k.clientX-sx, dy=k.clientY-sy, dt=Date.now()-st;
    if (dt<600 && Math.abs(dx)>60 && Math.abs(dx)>Math.abs(dy)*1.6) switchByDelta(dx<0?1:-1);
  }, {passive:true});
}
function doFit(){ try { fit.fit(); } catch (e) {} }

function connect(){
  ws = new WebSocket((location.protocol==='https:'?'wss':'ws')+'://'+location.host+'/ws');
  ws.onopen = () => doFit();
  ws.onclose = () => setTimeout(connect, 1500);
  ws.onmessage = e => handle(JSON.parse(e.data));
}
function sendWs(m){ if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }

function handle(m){
  if (m.type === 'session_list') {
    sessions = m.sessions;
    if ((!active || !sessions.find(s => s.id === active))) active = sessions[0] ? sessions[0].id : '';
    renderBar();
  } else if (m.type === 'terminal_data') {
    if (m.sessionId === active) term.write(m.data);
  }
}

function renderBar(){
  const bar = $('#bar'); bar.innerHTML = '';
  for (const s of sessions) {
    const c = document.createElement('div');
    c.className = 'chip' + (s.id === active ? ' active' : '');
    c.textContent = s.label;
    c.onclick = () => switchTo(s.id);
    bar.appendChild(c);
  }
  const plus = document.createElement('div'); plus.id = 'plus'; plus.textContent = '+';
  plus.onclick = openNewSession; bar.appendChild(plus);
}
function switchTo(id){
  if (id === active) return;
  active = id; term.reset();
  sendWs({ type:'select', sessionId: id });
  renderBar(); doFit();
}
function switchByDelta(d){
  const i = sessions.findIndex(s => s.id === active);
  const n = sessions[i + d];
  if (n) switchTo(n.id);
}

async function openNewSession(){
  const { projects } = await (await api('/projects')).json();
  const sheet = $('#sheet');
  sheet.innerHTML = '<h3>새 세션 — 프로젝트 선택</h3>';
  for (const p of projects) {
    const row = document.createElement('div'); row.className = 'row';
    row.textContent = '▶ ' + p.label;
    row.onclick = () => createSession(p.path);
    sheet.appendChild(row);
  }
  const browse = document.createElement('button'); browse.className = 'btn'; browse.textContent = '폴더 찾아보기';
  browse.style.marginTop = '10px'; browse.onclick = () => browseFrom(null); sheet.appendChild(browse);
  const close = document.createElement('button'); close.textContent = '닫기'; close.style.marginLeft = '8px';
  close.onclick = () => $('#modal').classList.remove('show'); sheet.appendChild(close);
  $('#modal').classList.add('show');
}
async function browseFrom(p){
  const { entries, cwd } = await (await api('/fs' + (p ? ('?path=' + encodeURIComponent(p)) : ''))).json();
  const sheet = $('#sheet');
  sheet.innerHTML = '<h3>' + (cwd ? escapeHtml(cwd) : '드라이브') + '</h3>';
  if (cwd) {
    const up = document.createElement('div'); up.className = 'row'; up.textContent = '⬆ 상위';
    up.onclick = () => browseFrom(parentOf(cwd)); sheet.appendChild(up);
    const here = document.createElement('button'); here.className = 'btn'; here.textContent = '여기서 세션 시작';
    here.onclick = () => addAndCreate(cwd); sheet.appendChild(here);
  }
  for (const e of entries) {
    const row = document.createElement('div'); row.className = 'row';
    row.textContent = '📁 ' + e.name; row.onclick = () => browseFrom(e.path);
    sheet.appendChild(row);
  }
}
function parentOf(p){ const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/')); return i > 2 ? p.slice(0, i) : null; }
async function addAndCreate(p){
  const label = p.split(/[\\/]/).filter(Boolean).pop() || p;
  await api('/projects/add', { method:'POST', body: JSON.stringify({ label, path: p }) });
  createSession(p);
}
async function createSession(p){
  $('#modal').classList.remove('show');
  await api('/sessions/create', { method:'POST', body: JSON.stringify({ path: p }) });
}
</script>
</body>
</html>
```

- [ ] **Step 3: Commit**

```bash
git add hub/pwa/index.html hub/pwa/manifest.json
git commit -m "feat(hub): session-only minimal PWA"
```

---

## Task 9: 실행 / 자동실행 스크립트

**Files:**
- Create: `hub/실행.bat`
- Create: `hub/launcher.vbs`
- Create: `hub/설치-자동실행.bat`

> 인코딩 규칙: bat 본문은 ASCII만, 흐름은 `goto :label`. (한글/`( )`블록/특수문자 금지 — 콘솔 코드페이지 무관하게 동작.)

- [ ] **Step 1: `hub/실행.bat` 작성 (포그라운드 디버그용)**

```bat
@echo off
setlocal
title MTB Hub
cd /d "%~dp0"
if "%MTB_PASSWORD%"=="" set "MTB_PASSWORD=changeme1234"
echo Starting MTB Hub on http://127.0.0.1:47800
echo Password: %MTB_PASSWORD%
call npx tsx src/index.ts
pause
```

- [ ] **Step 2: `hub/launcher.vbs` 작성 (콘솔 없이 hidden 실행)**

```vbs
' MTB Hub silent launcher
Set sh = CreateObject("WScript.Shell")
hub = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
sh.CurrentDirectory = hub
' 0 = 창 숨김, False = 비동기
sh.Run "cmd /c npx tsx src/index.ts", 0, False
```

- [ ] **Step 3: `hub/설치-자동실행.bat` 작성 (시작프로그램 등록)**

```bat
@echo off
setlocal
set "SRC=%~dp0launcher.vbs"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
echo Registering MTB Hub to run at login...
echo Source: %SRC%
echo Startup: %STARTUP%
copy /y "%SRC%" "%STARTUP%\mtb-hub.vbs" >nul
if errorlevel 1 goto fail
echo DONE. MTB Hub will start hidden at next login.
echo To start now without reboot, double-click launcher.vbs.
echo To remove: delete "%STARTUP%\mtb-hub.vbs"
pause
exit /b 0
:fail
echo FAILED to copy launcher to Startup.
pause
exit /b 1
```

- [ ] **Step 4: 자동실행 등록 스모크**

Run: `hub\설치-자동실행.bat` 더블클릭(또는 실행).
Expected: `DONE. MTB Hub will start hidden...` 출력, `%APPDATA%\...\Startup\mtb-hub.vbs` 생성됨. 그 후 `launcher.vbs` 더블클릭 → 콘솔 창 없이 백그라운드에서 서버 기동(브라우저로 `http://127.0.0.1:47800` 접속되면 성공).

- [ ] **Step 5: Commit**

```bash
git add hub/실행.bat hub/launcher.vbs hub/설치-자동실행.bat
git commit -m "feat(hub): foreground run + hidden autostart scripts"
```

---

## Task 10: 수동 기기 테스트 (검증)

**Files:** 없음 (실제 폰/PC 검증)

- [ ] **Step 1: named 터널(고정 URL) 준비 — 선택이나 권장**

cloudflared 로그인 + named 터널이 있으면 `MTB_TUNNEL_NAME`/`MTB_TUNNEL_URL` 환경변수로 고정 URL 사용. 없으면 quick 터널(매번 URL 바뀜)로도 검증 가능.

- [ ] **Step 2: 즐겨찾기 프로젝트 2개 등록**

`~/.mtb/projects.json` 직접 작성(또는 PWA 브라우저로 추가):
```json
[
  { "label": "projA", "path": "E:\\some\\projA" },
  { "label": "projB", "path": "E:\\some\\projB" }
]
```

- [ ] **Step 3: 서버 기동 + 폰 접속**

`$env:MTB_PASSWORD='...'; hub\실행.bat` → 폰 브라우저로 터널 URL(또는 같은 LAN의 `http://<PC-IP>:47800`) 접속 → 암호 입력 → 페어링.

- [ ] **Step 4: 검증 체크리스트**

- [ ] "+ " → projA 선택 → 그 폴더에서 claude 자동 실행됨(프롬프트 보임)
- [ ] "+ " → projB 선택 → 두 번째 세션 칩 생김
- [ ] 칩 탭 / 좌우 스와이프로 두 세션 전환됨(각자 화면 유지)
- [ ] 입력바/키보드로 명령 입력 → 해당 세션에만 반영
- [ ] 긴 출력에서 위로 터치 스크롤 됨
- [ ] 폰 브라우저 닫았다가 다시 열기 → 자동 재접속, 세션·내용 유지
- [ ] PC에서 `localhost:47800` 브라우저로도 같은 세션 보임
- [ ] 세션 종료(셸 exit) 시 칩에서 사라짐

- [ ] **Step 5: 결과 기록**

발견된 문제를 spec의 "미해결/향후"에 적고, 메모리(`project-vscode-extension-active-work`)에 hub 프로토타입 동작 상태를 업데이트.

---

## 빌드/실행 빠른 참조

```powershell
cd hub
npm install              # 최초 1회 (node-pty 프리빌트)
npm run typecheck        # 타입 체크
npm test                 # 단위 테스트(projects + sessions)
$env:MTB_PASSWORD='...'; npm start   # 기동
```
