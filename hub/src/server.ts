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
      try {
        const id = this.sessions.create({ label, path: p });
        this.json(res, 200, { ok: true, id });
      } catch (e) {
        this.json(res, 500, { error: String(e) });
      }
      return;
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
