import * as fs from 'fs';
import * as http from 'http';
import * as net from 'net';
import * as path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import * as vscode from 'vscode';
import { AuthStore } from './auth';
import { detectShells, TerminalManager } from './terminal';
import { readDir, workspaceRoots, openFolder, openFile } from './filesystem';
import { PreviewManager } from './preview';
import { TunnelManager } from './tunnel';

// Server → Client
// windowId: 어느 VS Code 창(=프로젝트)의 터미널인지. 폰은 이걸로 창을 스와이프 전환한다.
export type S2C =
  | { type: 'terminal_data';   windowId: string; id: string; data: string }
  | { type: 'terminal_list';   windowId: string; list: { id: string; name: string; hasShellIntegration: boolean }[] }
  | { type: 'terminal_exit';   windowId: string; id: string }
  | { type: 'terminal_exec_end'; windowId: string; id: string; command: string; exitCode: number | null; durationMs: number }
  | { type: 'window_list';     windows: { id: string; label: string }[] }
  | { type: 'editor_open';     path: string; lang: string; content: string }
  | { type: 'editor_change';   content: string }
  | { type: 'editor_cursor';   line: number; col: number }
  | { type: 'editor_close' };

// Client → Server
export type C2S =
  | { type: 'terminal_input';  windowId?: string; id: string; data: string }
  | { type: 'terminal_select'; windowId?: string; id: string }
  | { type: 'terminal_resize'; windowId?: string; id: string; cols: number; rows: number };

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

export class MtbServer {
  private httpServer: http.Server;
  private wss: WebSocketServer;   // 폰 클라이언트
  private pwss: WebSocketServer;  // 다른 창(프로바이더) — 루프백 전용
  private pwaDir: string;
  readonly clients = new Set<WebSocket>();

  // 이 창(허브 자신)의 식별. extension.ts가 tryStart 전에 채운다.
  localWindow = { id: 'local', label: '메인 창' };
  // 등록된 다른 창들(프로바이더). key=windowId
  private providers = new Map<string, { label: string; ws: WebSocket }>();

  readonly clientJoinHandlers: Array<(ws: WebSocket) => void> = [];
  onTerminalInput?: (id: string, data: string) => void;
  onTerminalResize?: (id: string, cols: number, rows: number) => void;
  onTerminalSelect?: (ws: WebSocket, id: string) => void;
  termMgr?: TerminalManager;
  previewMgr?: PreviewManager;

  constructor(
    private store: AuthStore,
    private tunnel: TunnelManager,
    extPath: string,
    private out: vscode.OutputChannel,
  ) {
    this.pwaDir = path.join(extPath, 'pwa');
    this.httpServer = http.createServer((req, res) => this.route(req, res));
    this.wss = new WebSocketServer({ noServer: true });
    this.pwss = new WebSocketServer({ noServer: true });

    this.httpServer.on('upgrade', (req, socket, head) => {
      // 다른 VS Code 창이 허브로 등록하는 경로 (루프백 전용, JWT 불필요)
      if (req.url === '/provider') {
        if (!isLoopback(remoteIp(req))) { socket.destroy(); return; }
        this.pwss.handleUpgrade(req, socket, head, ws => this.handleProvider(ws));
        return;
      }
      if (req.url !== '/ws') { socket.destroy(); return; }
      const cookies = parseCookies(req);
      if (!store.verifyJwt(cookies['mtb_jwt'] ?? '')) { socket.destroy(); return; }
      this.wss.handleUpgrade(req, socket, head, ws => {
        this.clients.add(ws);
        ws.on('close', () => this.clients.delete(ws));
        ws.on('message', (raw: Buffer) => this.onWsMessage(ws, raw.toString()));
        for (const cb of this.clientJoinHandlers) cb(ws);
        // 창 목록 전달 + 모든 프로바이더에 상태 재전송 요청
        ws.send(JSON.stringify({ type: 'window_list', windows: this.windowList() }));
        for (const p of this.providers.values()) {
          if (p.ws.readyState === WebSocket.OPEN) p.ws.send(JSON.stringify({ type: 'resync' }));
        }
      });
    });
  }

  // 프로바이더(다른 창) WS 처리: register 후엔 들어오는 S2C 메시지를 폰으로 그대로 전달.
  private handleProvider(ws: WebSocket): void {
    let windowId = '';
    ws.on('message', (raw: Buffer) => {
      const s = raw.toString();
      let m: { type?: string; windowId?: string; label?: string };
      try { m = JSON.parse(s); } catch { return; }
      if (m.type === 'register' && m.windowId) {
        windowId = m.windowId;
        this.providers.set(windowId, { label: m.label ?? '창', ws });
        this.out.appendLine(`[hub] 프로바이더 등록: ${m.label} (${windowId})`);
        this.broadcast({ type: 'window_list', windows: this.windowList() });
        return;
      }
      // terminal_data/list/exit/exec_end → 폰들에게 그대로 중계 (이미 windowId 태깅됨)
      this.broadcastRaw(s);
    });
    ws.on('close', () => {
      if (windowId) {
        this.providers.delete(windowId);
        this.out.appendLine(`[hub] 프로바이더 해제: ${windowId}`);
        this.broadcast({ type: 'window_list', windows: this.windowList() });
      }
    });
    ws.on('error', () => { /* 무시 — close가 뒤따름 */ });
  }

  private windowList(): { id: string; label: string }[] {
    return [
      { id: this.localWindow.id, label: this.localWindow.label },
      ...Array.from(this.providers.entries()).map(([id, p]) => ({ id, label: p.label })),
    ];
  }

  private broadcastRaw(data: string): void {
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    }
  }

  private _boundPort = 0;
  get boundPort(): number { return this._boundPort; }

  // 포트 바인딩 성공 → 이 창이 '허브'. EADDRINUSE → 다른 창이 이미 허브이므로
  // 이 창은 '프로바이더'로 붙어야 한다(extension.ts에서 분기).
  tryStart(port: number): Promise<'hub' | 'inuse'> {
    return new Promise((resolve, reject) => {
      const onErr = (err: NodeJS.ErrnoException) => {
        this.httpServer.removeListener('listening', onOk);
        if (err.code === 'EADDRINUSE') { resolve('inuse'); return; }
        reject(new Error(`listen 실패 (${err.code ?? err.message})`));
      };
      const onOk = () => {
        this.httpServer.removeListener('error', onErr);
        this._boundPort = port;
        this.out.appendLine(`서버 시작(허브): http://127.0.0.1:${port}`);
        resolve('hub');
      };
      this.httpServer.once('error', onErr);
      this.httpServer.listen(port, '127.0.0.1', onOk);
    });
  }

  stop(): void { this.httpServer.close(); this.wss.close(); this.pwss.close(); }

  broadcast(msg: S2C): void {
    const data = JSON.stringify(msg);
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    }
  }

  private onWsMessage(ws: WebSocket, raw: string): void {
    let msg: C2S;
    try { msg = JSON.parse(raw); } catch { return; }

    // 다른 창(프로바이더)을 향한 메시지면 그쪽으로 그대로 전달
    const wid = msg.windowId;
    if (wid && wid !== this.localWindow.id) {
      const p = this.providers.get(wid);
      if (p && p.ws.readyState === WebSocket.OPEN) p.ws.send(raw);
      return;
    }

    // 이 창(허브 로컬) 터미널 처리
    switch (msg.type) {
      case 'terminal_input':  this.onTerminalInput?.(msg.id, msg.data); break;
      case 'terminal_resize': this.onTerminalResize?.(msg.id, msg.cols, msg.rows); break;
      case 'terminal_select': this.onTerminalSelect?.(ws, msg.id); break;
    }
  }

  private route(req: http.IncomingMessage, res: http.ServerResponse): void {
    void this.routeAsync(req, res);
  }

  private async routeAsync(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url  = req.url  ?? '/';
    const meth = req.method ?? 'GET';

    // --- Static PWA ---
    const staticMap: Record<string, string> = {
      '/':             'index.html',
      '/index.html':   'index.html',
      '/manifest.json':'manifest.json',
      '/sw.js':        'sw.js',
    };
    if (meth === 'GET' && staticMap[url]) {
      const mime = url.endsWith('.json') ? 'application/json'
                 : url.endsWith('.js')   ? 'application/javascript'
                 : 'text/html; charset=utf-8';
      return this.sendFile(res, path.join(this.pwaDir, staticMap[url]), mime);
    }

    // --- QR ---
    if (meth === 'GET' && url === '/qr') {
      const u = this.tunnel.url;
      if (!u) { res.writeHead(503); res.end('tunnel not ready'); return; }
      this.tunnel.qrPng(u).then(buf => {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(buf);
      });
      return;
    }
    if (meth === 'GET' && url === '/qr.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(this.qrPageHtml(this.tunnel.url ?? ''));
      return;
    }

    // --- Terminals ---
    if (meth === 'GET' && url === '/terminals/shells') {
      const dev = this.store.verifyJwt(parseCookies(req)['mtb_jwt'] ?? '');
      if (!dev) { this.json(res, 401, { error: 'unauthenticated' }); return; }
      this.json(res, 200, { shells: detectShells() });
      return;
    }

    // --- File system ---
    if (meth === 'GET' && url.startsWith('/fs')) {
      const dev = this.store.verifyJwt(parseCookies(req)['mtb_jwt'] ?? '');
      if (!dev) { this.json(res, 401, { error: 'unauthenticated' }); return; }
      const qs = new URL(url, 'http://x').searchParams;
      const p = qs.get('path');
      if (!p) {
        this.json(res, 200, { roots: workspaceRoots() });
      } else {
        try {
          const entries = await readDir(decodeURIComponent(p));
          this.json(res, 200, { entries });
        } catch (e) {
          this.json(res, 400, { error: String(e) });
        }
      }
      return;
    }

    // --- Preview ---
    if (meth === 'GET' && url === '/preview/status') {
      const dev = this.store.verifyJwt(parseCookies(req)['mtb_jwt'] ?? '');
      if (!dev) { this.json(res, 401, { error: 'unauthenticated' }); return; }
      this.json(res, 200, { url: this.previewMgr?.url ?? null, port: this.previewMgr?.port ?? null });
      return;
    }

    if (meth === 'GET' && url === '/preview/qr') {
      const dev = this.store.verifyJwt(parseCookies(req)['mtb_jwt'] ?? '');
      if (!dev) { this.json(res, 401, { error: 'unauthenticated' }); return; }
      const png = await this.previewMgr?.qrPng();
      if (!png) { res.writeHead(503); res.end('no preview active'); return; }
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(png);
      return;
    }

    // --- Auth check endpoint ---
    if (meth === 'GET' && url === '/api/me') {
      const dev = this.store.verifyJwt(parseCookies(req)['mtb_jwt'] ?? '');
      if (!dev) { this.json(res, 401, { error: 'unauthenticated' }); return; }
      this.json(res, 200, { device_id: dev.deviceId });
      return;
    }

    // --- POST routes ---
    if (meth === 'POST') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        let data: Record<string, unknown> = {};
        try { data = JSON.parse(body); } catch { /* allow empty body */ }
        void this.handlePost(url, req, res, data);
      });
      return;
    }

    res.writeHead(404); res.end('not found');
  }

  private async handlePost(
    url: string,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    data: Record<string, unknown>,
  ): Promise<void> {
    const ip = remoteIp(req);
    const ua = String(req.headers['user-agent'] ?? '').slice(0, 200);

    if (url === '/pair') {
      const code     = String(data['code']      ?? '').trim();
      const deviceId = String(data['device_id'] ?? '').trim();
      if (!code || !deviceId) { this.json(res, 400, { error: 'code and device_id required' }); return; }
      const result = this.store.attemptPair(code, deviceId, ip, ua);
      if (!result.ok) {
        if (result.reason !== 'rate_limited') this.store.registerFailure(code, ip, ua);
        this.json(res, result.reason === 'rate_limited' ? 429 : 401, { error: result.reason });
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': cookieHeader(result.token!) });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (url === '/auto-pair') {
      if (!isLoopback(ip)) { this.json(res, 401, { error: 'localhost only' }); return; }
      const token = this.store.issueJwtDirect(`local:${ip}`, ip, ua);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': cookieHeader(token) });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (url === '/terminals/close') {
      const dev = this.store.verifyJwt(parseCookies(req)['mtb_jwt'] ?? '');
      if (!dev) { this.json(res, 401, { error: 'unauthenticated' }); return; }
      const wid = String(data['windowId'] ?? '');
      const id = String(data['id'] ?? '');
      if (wid && wid !== this.localWindow.id) {
        const p = this.providers.get(wid);
        if (p?.ws.readyState === WebSocket.OPEN) p.ws.send(JSON.stringify({ type: 'close', id }));
        this.json(res, 200, { ok: !!p });
        return;
      }
      const ok = this.termMgr?.closeTerminal(id);
      this.json(res, 200, { ok: ok ?? false });
      return;
    }

    if (url === '/preview/start') {
      const dev = this.store.verifyJwt(parseCookies(req)['mtb_jwt'] ?? '');
      if (!dev) { this.json(res, 401, { error: 'unauthenticated' }); return; }
      const port = Number(data['port'] ?? 3000);
      if (!this.previewMgr) { this.json(res, 503, { error: 'preview manager not ready' }); return; }
      const url2 = await this.previewMgr.start(port);
      this.json(res, 200, { url: url2 ?? null });
      return;
    }

    if (url === '/preview/stop') {
      const dev = this.store.verifyJwt(parseCookies(req)['mtb_jwt'] ?? '');
      if (!dev) { this.json(res, 401, { error: 'unauthenticated' }); return; }
      this.previewMgr?.stop();
      this.json(res, 200, { ok: true });
      return;
    }

    if (url === '/terminals/create') {
      const dev = this.store.verifyJwt(parseCookies(req)['mtb_jwt'] ?? '');
      if (!dev) { this.json(res, 401, { error: 'unauthenticated' }); return; }
      const shellPath = String(data['path'] ?? '');
      const name      = String(data['name'] ?? (shellPath || '터미널'));
      const wid       = String(data['windowId'] ?? '');
      if (wid && wid !== this.localWindow.id) {
        const p = this.providers.get(wid);
        if (p?.ws.readyState === WebSocket.OPEN) p.ws.send(JSON.stringify({ type: 'create', name, shellPath }));
        this.json(res, 200, { ok: !!p });
        return;
      }
      this.termMgr?.createTerminal(name, shellPath);
      this.json(res, 200, { ok: true });
      return;
    }

    if (url === '/workspace/open') {
      const dev = this.store.verifyJwt(parseCookies(req)['mtb_jwt'] ?? '');
      if (!dev) { this.json(res, 401, { error: 'unauthenticated' }); return; }
      const p = String(data['path'] ?? '');
      if (!p) { this.json(res, 400, { error: 'path required' }); return; }
      await openFolder(p);
      this.json(res, 200, { ok: true });
      return;
    }

    if (url === '/fs/open') {
      const dev = this.store.verifyJwt(parseCookies(req)['mtb_jwt'] ?? '');
      if (!dev) { this.json(res, 401, { error: 'unauthenticated' }); return; }
      const p = String(data['path'] ?? '');
      if (!p) { this.json(res, 400, { error: 'path required' }); return; }
      await openFile(p);
      this.json(res, 200, { ok: true });
      return;
    }

    if (url === '/admin/issue') {
      if (!isLoopback(ip)) { this.json(res, 403, { error: 'loopback only' }); return; }
      const code = this.store.issueCode();
      this.json(res, 200, { code, ttl_seconds: 300 });
      return;
    }

    if (url === '/admin/revoke') {
      if (!isLoopback(ip)) { this.json(res, 403, { error: 'loopback only' }); return; }
      if (data['device_id'] === 'ALL') {
        this.json(res, 200, { revoked_count: this.store.revokeAll() }); return;
      }
      this.json(res, 200, { ok: this.store.revokeDevice(String(data['device_id'] ?? '')) });
      return;
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

  private qrPageHtml(url: string): string {
    return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>MTB 새 기기 추가</title>
  <style>
    body{font-family:sans-serif;display:flex;flex-direction:column;align-items:center;
         justify-content:center;min-height:100vh;margin:0;background:#111;color:#eee}
    img{width:240px;height:240px;border:16px solid #fff;border-radius:8px}
    p{font-size:13px;color:#aaa;word-break:break-all;max-width:280px;text-align:center}
  </style>
</head>
<body>
  <h2 style="margin-bottom:24px">휴대폰으로 찍어 접속</h2>
  ${url ? '<img src="/qr" alt="QR">' : '<p>터널 준비 중...</p>'}
  <p style="margin-top:16px">${url}</p>
  <p>접속 후 암호 입력 → 페어링 완료</p>
</body>
</html>`;
  }
}
