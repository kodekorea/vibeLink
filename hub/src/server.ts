import * as fs from 'fs';
import * as http from 'http';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { AuthStore } from './auth';
import { TunnelManager } from './tunnel';
import { ProjectStore } from './projects';
import { SessionManager } from './sessions';
import { browseDir, drives, listEntries, readFileText } from './fsbrowse';
import { loadAgentView } from './transcript';

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
// Windows 전용 화면 캡처 폴백: System.Drawing 으로 전체 가상 스크린을 PNG(base64)로 캡처.
// 고DPI(배율) 모니터에서 캡처가 좌상단 일부만 잡혀 잘리는 문제 방지 — 프로세스를
// per-monitor-v2 DPI 인식으로 올려 물리 해상도 전체를 캡처/매핑한다. (구버전 OS는 SetProcessDPIAware 폴백)
const DPI_AWARE_PS =
  'Add-Type -MemberDefinition \'[DllImport("user32.dll")]public static extern bool SetProcessDpiAwarenessContext(System.IntPtr value);[DllImport("user32.dll")]public static extern bool SetProcessDPIAware();\' -Name Dpi -Namespace W32;'
  + 'try{[W32.Dpi]::SetProcessDpiAwarenessContext([System.IntPtr](-4))|Out-Null}catch{try{[W32.Dpi]::SetProcessDPIAware()|Out-Null}catch{}};';

// screenshot-desktop 번들 캡처기가 실패하는 환경을 위한 무의존 대비책.
// idx가 주어지면 해당 모니터(Screen.AllScreens[idx])만, 없으면 전체 가상화면을 캡처.
function captureScreenPowerShell(idx?: number): Promise<Buffer> {
  const bounds = (typeof idx === 'number' && Number.isInteger(idx) && idx >= 0)
    ? `$ss=[System.Windows.Forms.Screen]::AllScreens; if($ss.Count -le ${idx}){[Console]::Error.WriteLine('no such display');exit 1}; $b=$ss[${idx}].Bounds;`
    : '$b=[System.Windows.Forms.SystemInformation]::VirtualScreen;';
  const ps = [
    DPI_AWARE_PS,
    'Add-Type -AssemblyName System.Windows.Forms,System.Drawing;',
    bounds,
    '$bmp=New-Object System.Drawing.Bitmap($b.Width,$b.Height);',
    '$g=[System.Drawing.Graphics]::FromImage($bmp);',
    '$g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size);',
    '$ms=New-Object System.IO.MemoryStream;',
    '$bmp.Save($ms,[System.Drawing.Imaging.ImageFormat]::Png);',
    '$g.Dispose();$bmp.Dispose();',
    '[Console]::Out.Write([System.Convert]::ToBase64String($ms.ToArray()));',
  ].join('');
  return new Promise<Buffer>((resolve, reject) => {
    import('child_process').then((cp) => {
      const child = cp.execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-STA', '-Command', ps],
        { windowsHide: true, maxBuffer: 256 * 1024 * 1024 },
        (err, stdout) => {
          if (err) { reject(err); return; }
          const b64 = String(stdout).trim();
          if (!b64) { reject(new Error('powershell capture: empty output')); return; }
          try { resolve(Buffer.from(b64, 'base64')); }
          catch (e) { reject(e); }
        },
      );
      child.on('error', reject);
    }).catch(reject);
  });
}

// 연결된 모니터 목록 (Windows, 무의존 .NET). idx는 캡처 시 ?display= 로 그대로 사용.
interface DisplayInfo { idx: number; name: string; primary: boolean; w: number; h: number; }
function listDisplaysWindows(): Promise<DisplayInfo[]> {
  const ps = [
    DPI_AWARE_PS,
    'Add-Type -AssemblyName System.Windows.Forms;',
    '$i=0;$o=@();',
    'foreach($s in [System.Windows.Forms.Screen]::AllScreens){$b=$s.Bounds;$o+=[PSCustomObject]@{idx=$i;name=$s.DeviceName;primary=$s.Primary;w=$b.Width;h=$b.Height};$i++}',
    'ConvertTo-Json -Compress -InputObject @($o)',
  ].join('');
  return new Promise<DisplayInfo[]>((resolve, reject) => {
    import('child_process').then((cp) => {
      const child = cp.execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', ps],
        { windowsHide: true, maxBuffer: 1024 * 1024 },
        (err, stdout) => {
          if (err && !stdout) { reject(err); return; }
          try {
            const parsed = JSON.parse(String(stdout).trim() || '[]');
            resolve(Array.isArray(parsed) ? parsed : [parsed]);
          } catch (e) { reject(e); }
        },
      );
      child.on('error', reject);
    }).catch(reject);
  });
}

// 화면 좌표(0~1 비율)에 좌클릭 주입 (Windows). idx면 해당 모니터, 없으면 전체 가상화면 기준.
function clickScreenPowerShell(xf: number, yf: number, idx?: number): Promise<void> {
  const cx = Math.min(1, Math.max(0, xf)).toFixed(6);
  const cy = Math.min(1, Math.max(0, yf)).toFixed(6);
  const bounds = (typeof idx === 'number' && Number.isInteger(idx) && idx >= 0)
    ? `$ss=[System.Windows.Forms.Screen]::AllScreens; if($ss.Count -le ${idx}){exit 1}; $b=$ss[${idx}].Bounds;`
    : '$b=[System.Windows.Forms.SystemInformation]::VirtualScreen;';
  const ps = [
    DPI_AWARE_PS,
    'Add-Type -AssemblyName System.Windows.Forms;',
    'Add-Type -MemberDefinition \'[DllImport("user32.dll")]public static extern bool SetCursorPos(int x,int y);[DllImport("user32.dll")]public static extern void mouse_event(uint f,int dx,int dy,uint d,int e);\' -Name U -Namespace Win32;',
    bounds,
    `$x=[int]($b.X + ${cx} * $b.Width);`,
    `$y=[int]($b.Y + ${cy} * $b.Height);`,
    '[Win32.U]::SetCursorPos($x,$y);',
    'Start-Sleep -Milliseconds 20;',
    '[Win32.U]::mouse_event(0x2,0,0,0,0);[Win32.U]::mouse_event(0x4,0,0,0,0);',
  ].join('');
  return new Promise<void>((resolve, reject) => {
    import('child_process').then((cp) => {
      const child = cp.execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-STA', '-Command', ps],
        { windowsHide: true },
        (err) => { if (err) reject(err); else resolve(); },
      );
      child.on('error', reject);
    }).catch(reject);
  });
}
function remoteIp(req: http.IncomingMessage): string {
  return (req.socket as net.Socket).remoteAddress ?? '';
}
function isLoopback(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}
// 같은 와이파이에서 폰이 직접 붙을 수 있는 사설 LAN IPv4. WSL 가상 어댑터는 뒤로 밀림.
function lanIp(): string | null {
  const addrs: string[] = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] ?? []) {
      const fam = (ni as { family: string | number }).family;
      if ((fam === 'IPv4' || fam === 4) && !ni.internal) addrs.push(ni.address);
    }
  }
  const pick = (re: RegExp) => addrs.find(a => re.test(a));
  // Tailscale 대역(100.64.0.0/10)은 LAN이 아니라 별도 처리하므로 여기선 제외.
  return pick(/^192\.168\./) || pick(/^10\./) || pick(/^172\.(1[6-9]|2\d|3[01])\./)
    || addrs.find(a => !/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a)) || null;
}
// Tailscale 가상 IP(100.64.0.0/10 CGNAT 대역) — 깔려 있으면 어디서나 고정 접속.
function tailscaleIp(): string | null {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] ?? []) {
      const fam = (ni as { family: string | number }).family;
      if ((fam === 'IPv4' || fam === 4) && !ni.internal && /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ni.address)) {
        return ni.address;
      }
    }
  }
  return null;
}
function bearer(req: http.IncomingMessage): string {
  const h = String(req.headers['authorization'] ?? '');
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}
// 현재 LISTEN 중인 TCP 포트 목록(중복 제거, 정렬). netstat 파싱. hub 자기 포트는 제외.
// 웹 dev 서버로 흔한 포트만 노출 — DB/윈도우 서비스 등 무의미한 LISTEN 포트를 거른다.
// 그 외 포트는 프리뷰 화면의 직접 입력칸으로 열 수 있음.
const DEV_PORTS = new Set<number>([
  3000, 3001, 3002, 3003, // Next.js / CRA / Node
  4173, 4174,             // Vite preview
  4200,                   // Angular
  5000, 5001,             // Flask / .NET / 일반
  5173, 5174, 5175,       // Vite dev
  8000, 8001,             // Django / 일반 http
  8080, 8081,             // 일반 웹 / webpack
  8888,                   // Jupyter / 일반
  9000, 9001,             // 일반 dev
  19006,                  // Expo web
]);

function listeningPorts(selfPort: number): Promise<number[]> {
  return new Promise((resolve, reject) => {
    import('child_process').then((cp) => {
      const netstatCmd = process.platform === 'win32'
        ? (process.env.SystemRoot ? path.join(process.env.SystemRoot, 'System32', 'netstat.exe') : 'C:\\Windows\\System32\\netstat.exe')
        : 'netstat';
      cp.execFile(netstatCmd, ['-ano', '-p', 'TCP'], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
        if (err && !stdout) { reject(err); return; }
        const set = new Set<number>();
        for (const line of String(stdout).split(/\r?\n/)) {
          const parts = line.trim().split(/\s+/);
          if (parts.length < 4 || parts[3] !== 'LISTENING') continue;
          const m = parts[1].match(/:(\d+)$/);
          if (!m) continue;
          const port = Number(m[1]);
          // hub 자기 포트 제외 + 흔한 dev 서버 포트만(화이트리스트). 그 외는 직접 입력으로 열기.
          if (port === selfPort || !DEV_PORTS.has(port)) continue;
          set.add(port);
        }
        resolve(Array.from(set).sort((a, b) => a - b));
      });
    }).catch(reject);
  });
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
      const wsTok = parseCookies(req)['mtb_jwt'] || bearer(req);
      if (!store.verifyJwt(wsTok)) { socket.destroy(); return; }
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

  private _port = 0;
  listen(port: number): Promise<void> {
    this._port = port;
    return new Promise((resolve, reject) => {
      this.httpServer.once('error', reject);
      this.httpServer.listen(port, () => { this.httpServer.removeListener('error', reject); resolve(); });
    });
  }

  // 같은 와이파이용 직접 접속 URL (cloudflared 없이, 안정적). 없으면 null.
  lanUrl(): string | null {
    const ip = lanIp();
    return ip ? `http://${ip}:${this._port}` : null;
  }

  // Tailscale 직접 접속 URL (집/밖 어디서나 고정). 미설치면 null.
  tailscaleUrl(): string | null {
    const ip = tailscaleIp();
    return ip ? `http://${ip}:${this._port}` : null;
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
    const tok = parseCookies(req)['mtb_jwt'] || bearer(req);
    return !!this.store.verifyJwt(tok);
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

    // QR (cloudflared 터널)
    if (meth === 'GET' && pathOnly === '/qr') {
      const u = this.tunnel.url;
      if (!u) { res.writeHead(503); res.end('tunnel not ready'); return; }
      const buf = await this.tunnel.qrPng(u);
      res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(buf); return;
    }
    // QR (같은 와이파이 LAN 직접 접속 — cloudflared 불필요, 안정적)
    if (meth === 'GET' && pathOnly === '/qrlan') {
      const lu = this.lanUrl();
      if (!lu) { res.writeHead(503); res.end('no lan ip'); return; }
      const buf = await this.tunnel.qrPng(lu);
      res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(buf); return;
    }
    // QR (Tailscale 직접 접속 — 집/밖 어디서나 고정)
    if (meth === 'GET' && pathOnly === '/qrts') {
      const tu = this.tailscaleUrl();
      if (!tu) { res.writeHead(503); res.end('no tailscale ip'); return; }
      const buf = await this.tunnel.qrPng(tu);
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

    // 현재 LISTEN 중인 로컬 포트 목록 (dev 서버 프리뷰용)
    if (meth === 'GET' && pathOnly === '/ports') {
      if (!this.auth(req)) { this.json(res, 401, { error: 'unauthenticated' }); return; }
      try { this.json(res, 200, { ports: await listeningPorts(this._port) }); }
      catch (e) { this.json(res, 200, { ports: [], error: String(e) }); }
      return;
    }

    // 세션 목록
    if (meth === 'GET' && pathOnly === '/sessions') {
      if (!this.auth(req)) { this.json(res, 401, { error: 'unauthenticated' }); return; }
      this.json(res, 200, { sessions: this.sessions.tree() }); return;
    }

    // 완료 알림 임계값 조회 (폰 설정에서 사용)
    if (meth === 'GET' && pathOnly === '/settings/notify') {
      if (!this.auth(req)) { this.json(res, 401, { error: 'unauthenticated' }); return; }
      this.json(res, 200, this.sessions.getNotify()); return;
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

    // 파일 탐색기: 디렉터리+파일 목록
    if (meth === 'GET' && pathOnly === '/files') {
      if (!this.auth(req)) { this.json(res, 401, { error: 'unauthenticated' }); return; }
      const p = new URL(url, 'http://x').searchParams.get('path');
      if (!p) {
        this.json(res, 200, { cwd: null, entries: drives().map(d => ({ name: d.name, path: d.path, dir: true, size: 0 })) });
        return;
      }
      try { this.json(res, 200, { cwd: p, entries: listEntries(decodeURIComponent(p)) }); }
      catch (e) { this.json(res, 400, { error: String(e) }); }
      return;
    }

    // 파일 탐색기: 파일 내용 읽기
    if (meth === 'GET' && pathOnly === '/file') {
      if (!this.auth(req)) { this.json(res, 401, { error: 'unauthenticated' }); return; }
      const p = new URL(url, 'http://x').searchParams.get('path');
      if (!p) { this.json(res, 400, { error: 'path required' }); return; }
      try { this.json(res, 200, readFileText(decodeURIComponent(p))); }
      catch (e) { this.json(res, 400, { error: String(e) }); }
      return;
    }

    // 파일 원본 바이트 (이미지 미리보기 등) — content-type을 확장자로 추정
    if (meth === 'GET' && pathOnly === '/raw') {
      if (!this.auth(req)) { res.writeHead(401); res.end(); return; }
      const p = new URL(url, 'http://x').searchParams.get('path');
      if (!p) { res.writeHead(400); res.end(); return; }
      const fp = decodeURIComponent(p);
      if (!fs.existsSync(fp)) { res.writeHead(404); res.end(); return; }
      const ext = path.extname(fp).toLowerCase();
      const mime = ({
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
        '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.pdf': 'application/pdf',
      } as Record<string, string>)[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime });
      fs.createReadStream(fp).pipe(res);
      return;
    }

    // 파일 다운로드 — 폰의 시스템 브라우저가 저장하도록 attachment로 내려준다.
    // 브라우저는 헤더를 못 실으므로 쿼리 토큰(?token=)도 허용한다.
    if (meth === 'GET' && pathOnly === '/download') {
      const u = new URL(url, 'http://x');
      const tok = u.searchParams.get('token') || parseCookies(req)['mtb_jwt'] || bearer(req);
      if (!this.store.verifyJwt(tok)) { res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('unauthenticated'); return; }
      const p = u.searchParams.get('path');
      if (!p) { res.writeHead(400); res.end('path required'); return; }
      const fp = decodeURIComponent(p);
      let st: fs.Stats;
      try { st = fs.statSync(fp); } catch { res.writeHead(404); res.end('not found'); return; }
      if (st.isDirectory()) { res.writeHead(400); res.end('is a directory'); return; }
      const name = path.basename(fp);
      const ext = path.extname(fp).toLowerCase();
      const mime = ({
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
        '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.pdf': 'application/pdf',
        '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.json': 'application/json',
      } as Record<string, string>)[ext] || 'application/octet-stream';
      // RFC 5987: 비ASCII(한글) 파일명도 안전하게. filename(폴백) + filename*(UTF-8).
      const asciiName = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || ('download' + ext);
      res.writeHead(200, {
        'Content-Type': mime,
        'Content-Length': String(st.size),
        'Content-Disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        'Cache-Control': 'no-store',
      });
      fs.createReadStream(fp).pipe(res);
      return;
    }

    // 연결된 모니터 목록 — 폰에서 캡처할 모니터를 고르게.
    if (meth === 'GET' && pathOnly === '/displays') {
      if (!this.auth(req)) { res.writeHead(401); res.end(); return; }
      try {
        let displays: DisplayInfo[] = [];
        if (process.platform === 'win32') {
          displays = await listDisplaysWindows();
        } else {
          const spec: string = 'screenshot-desktop';
          const mod: any = await import(spec);
          const ss = mod.default || mod;
          const ds: any[] = await ss.listDisplays();
          displays = ds.map((d, i) => ({ idx: d.id ?? i, name: d.name || ('Display ' + (i + 1)), primary: i === 0, w: d.width || 0, h: d.height || 0 }));
        }
        this.json(res, 200, { displays });
      } catch {
        this.json(res, 200, { displays: [] });
      }
      return;
    }

    // PC 화면 캡처(PNG) — OpenCV 새창·GUI 앱 등 무엇이든 폰에서 보기.
    // ?display=<idx> 면 해당 모니터만, 없거나 all 이면 전체 가상화면.
    if (meth === 'GET' && pathOnly === '/screen') {
      if (!this.auth(req)) { res.writeHead(401); res.end(); return; }
      const dispRaw = new URL(url, 'http://x').searchParams.get('display');
      const dispIdx = (dispRaw && dispRaw !== 'all' && /^\d+$/.test(dispRaw)) ? Number(dispRaw) : undefined;
      try {
        let img: Buffer | null = null;
        if (process.platform === 'win32') {
          // 이 환경에선 screenshot-desktop 번들 캡처기가 자주 깨져 PowerShell이 신뢰 가능 + 모니터별 캡처 지원.
          img = await captureScreenPowerShell(dispIdx);
        } else {
          const spec: string = 'screenshot-desktop';
          const mod: any = await import(spec);
          const screenshot = mod.default || mod;
          img = dispIdx !== undefined ? await screenshot({ screen: dispIdx, format: 'png' }) : await screenshot({ format: 'png' });
        }
        if (!img || img.length === 0) throw new Error('empty capture');
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
        res.end(img);
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'text/plain' }); res.end(String(e));
      }
      return;
    }

    // 화면 좌클릭 — 폰에서 캡처 위에 탭한 지점(0~1 비율)을 실제 PC 클릭으로.
    if (meth === 'GET' && pathOnly === '/click') {
      if (!this.auth(req)) { this.json(res, 401, { error: 'unauthenticated' }); return; }
      if (process.platform !== 'win32') { this.json(res, 501, { error: 'click supported on windows only' }); return; }
      const u = new URL(url, 'http://x');
      const xf = Number(u.searchParams.get('x'));
      const yf = Number(u.searchParams.get('y'));
      if (!Number.isFinite(xf) || !Number.isFinite(yf)) { this.json(res, 400, { error: 'x,y (0..1) required' }); return; }
      const dispRaw = u.searchParams.get('display');
      const dispIdx = (dispRaw && dispRaw !== 'all' && /^\d+$/.test(dispRaw)) ? Number(dispRaw) : undefined;
      try { await clickScreenPowerShell(xf, yf, dispIdx); this.json(res, 200, { ok: true }); }
      catch (e) { this.json(res, 500, { error: String(e) }); }
      return;
    }

    // 에이전트뷰: 세션 트랜스크립트(대화 타임라인)
    // ?path=<cwd> &agent=claude|codex|opencode|shell (없으면 claude 로 간주)
    if (meth === 'GET' && pathOnly === '/agent/log') {
      if (!this.auth(req)) { this.json(res, 401, { error: 'unauthenticated' }); return; }
      const u = new URL(url, 'http://x');
      const p = u.searchParams.get('path');
      if (!p) { this.json(res, 400, { error: 'path required' }); return; }
      const agent = u.searchParams.get('agent') ?? undefined;
      try {
        const v = loadAgentView(decodeURIComponent(p), agent);
        this.json(res, 200, { events: v.events, supported: v.supported });
      } catch (e) { this.json(res, 400, { error: String(e) }); }
      return;
    }

    // 변경사항: 트랜스크립트에서 에이전트가 고친 파일 추출
    if (meth === 'GET' && pathOnly === '/agent/changes') {
      if (!this.auth(req)) { this.json(res, 401, { error: 'unauthenticated' }); return; }
      const u = new URL(url, 'http://x');
      const p = u.searchParams.get('path');
      if (!p) { this.json(res, 400, { error: 'path required' }); return; }
      const agent = u.searchParams.get('agent') ?? undefined;
      try {
        const v = loadAgentView(decodeURIComponent(p), agent);
        this.json(res, 200, { changes: v.changes, supported: v.supported });
      } catch (e) { this.json(res, 400, { error: String(e) }); }
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
      res.end(JSON.stringify({ ok: true, token: r.token })); return;
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
      const spec = { agent: data['agent'] ? String(data['agent']) : undefined, env: data['env'] ? String(data['env']) : undefined };
      try {
        const { sessionId, terminalId } = this.sessions.createSession({ label, path: p }, spec);
        // id는 기존 호환(=기본 터미널 id). sessionId/terminalId도 함께 반환.
        this.json(res, 200, { ok: true, id: terminalId, sessionId, terminalId });
      } catch (e) {
        this.json(res, 500, { error: String(e) });
      }
      return;
    }

    if (url === '/sessions/close') {
      const id = String(data['id'] ?? '');
      this.json(res, 200, { ok: this.sessions.closeSession(id) }); return;
    }

    // 세션 안에 추가 터미널(기본 셸 — claude 미실행)
    if (url === '/terminals/create') {
      const sessionId = String(data['sessionId'] ?? '');
      if (!sessionId) { this.json(res, 400, { error: 'sessionId required' }); return; }
      const spec = { agent: data['agent'] ? String(data['agent']) : undefined, env: data['env'] ? String(data['env']) : undefined };
      try {
        const terminalId = this.sessions.createTerminal(sessionId, spec);
        if (!terminalId) { this.json(res, 404, { error: 'no such session' }); return; }
        this.json(res, 200, { ok: true, terminalId });
      } catch (e) {
        this.json(res, 500, { error: String(e) });
      }
      return;
    }

    // 터미널 닫기 (셸만; claude는 거부)
    if (url === '/terminals/close') {
      const id = String(data['id'] ?? '');
      this.json(res, 200, { ok: this.sessions.closeTerminal(id) }); return;
    }

    // 완료 알림 임계값 변경 (폰 설정) — 즉시 적용 + ~/.vibelink/notify.json에 영속화
    if (url === '/settings/notify') {
      const next = this.sessions.setNotify({
        minMs: data['minMs'] != null ? Number(data['minMs']) : undefined,
        quietMs: data['quietMs'] != null ? Number(data['quietMs']) : undefined,
      });
      try {
        const dir = path.join(os.homedir(), '.vibelink');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'notify.json'), JSON.stringify(next));
      } catch { /* 저장 실패해도 런타임 값은 적용됨 */ }
      this.json(res, 200, next); return;
    }

    if (url === '/projects/add') {
      const label = String(data['label'] ?? '');
      const p = String(data['path'] ?? '');
      if (!p) { this.json(res, 400, { error: 'path required' }); return; }
      this.projects.add({ label: label || p, path: p });
      this.json(res, 200, { projects: this.projects.list() }); return;
    }

    if (url === '/projects/remove') {
      const p = String(data['path'] ?? '');
      if (!p) { this.json(res, 400, { error: 'path required' }); return; }
      this.projects.remove(p);
      this.json(res, 200, { projects: this.projects.list() }); return;
    }

    // 새 폴더 만들기 (새 프로젝트 시작용)
    if (url === '/fs/mkdir') {
      const parent = String(data['parent'] ?? '');
      const name = String(data['name'] ?? '').trim();
      if (!parent || !name) { this.json(res, 400, { error: 'parent and name required' }); return; }
      if (/[\\/:*?"<>|]/.test(name)) { this.json(res, 400, { error: 'invalid folder name' }); return; }
      try {
        const dir = path.join(decodeURIComponent(parent), name);
        fs.mkdirSync(dir, { recursive: true });
        this.json(res, 200, { path: dir });
      } catch (e) { this.json(res, 400, { error: String(e) }); }
      return;
    }

    // 폰에서 이미지/파일 업로드 → PC에 저장 → 경로 반환(터미널에 붙여 Claude가 읽게)
    if (url === '/upload') {
      const b64 = String(data['data'] ?? '');
      const name = String(data['name'] ?? 'upload.png').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80) || 'upload.png';
      if (!b64) { this.json(res, 400, { error: 'data required' }); return; }
      try {
        const m = b64.match(/^data:[^;]+;base64,(.*)$/);
        const buf = Buffer.from(m ? m[1] : b64, 'base64');
        if (buf.length > 25 * 1024 * 1024) { this.json(res, 413, { error: 'too large (25MB max)' }); return; }
        const dir = path.join(os.homedir(), '.mtb', 'uploads');
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, Date.now() + '-' + name);
        fs.writeFileSync(file, buf);
        this.json(res, 200, { path: file });
      } catch (e) { this.json(res, 400, { error: String(e) }); }
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
  private qrPage(url: string): string {
    const lan = this.lanUrl();
    const ts = this.tailscaleUrl();
    const section = (title: string, tag: string, ok: boolean, img: string, urlText: string, help?: string) => `
<div class="card">
  <h3>${title}</h3>
  <div class="tag">${tag}</div>
  ${ok ? `<img src="${img}" alt="QR"><p class="u">${urlText}</p>` : `<p class="muted">${help || '사용 불가'}</p>`}
</div>`;

    const tsCard = section(
      '외부 접속 — Tailscale (추천)',
      '집·밖 어디서나 · 주소 영구 고정 · 무료',
      !!ts, '/qrts', ts ?? '',
      'Tailscale 미설치. PC와 폰에 <a href="https://tailscale.com/download" target="_blank">Tailscale</a>을 깔고 같은 계정으로 로그인하면 여기에 고정 QR이 떠요.',
    );
    const lanCard = section(
      '같은 와이파이 — LAN',
      '집 안 · 빠름 · 설정 0',
      !!lan, '/qrlan', lan ?? '',
      'LAN IP를 찾지 못했어요.',
    );
    const tunCard = section(
      '외부 접속 — 임시 터널',
      '설정 없이 집 밖 · 단 재시작마다 주소 바뀜',
      !!url, '/qr', url,
      '터널 준비 중...',
    );

    return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>VibeLink Hub 접속</title>
<style>
body{font-family:-apple-system,"Segoe UI",sans-serif;margin:0;padding:24px 16px;background:#faf9f5;color:#141413;display:flex;flex-direction:column;align-items:center}
h2{font-family:Georgia,serif;font-weight:500;margin:0 0 6px}
.sub{font-size:13px;color:#6c6a64;margin:0 0 20px}
.card{background:#efe9de;border-radius:16px;padding:18px;margin:0 0 16px;width:100%;max-width:320px;box-sizing:border-box;text-align:center}
h3{margin:0 0 4px;font-size:16px;color:#141413}
.tag{font-size:12px;color:#cc785c;margin-bottom:12px}
img{width:220px;height:220px;border:12px solid #fff;border-radius:10px}
.u{font-size:12px;color:#6c6a64;word-break:break-all;margin:10px 0 0}
.muted{font-size:13px;color:#6c6a64;line-height:1.5}
a{color:#cc785c}
</style></head><body>
<h2>VibeLink 연결</h2>
<p class="sub">앱으로 QR 스캔 → 암호 입력 → 끝</p>
${tsCard}
${lanCard}
${tunCard}
</body></html>`;
  }
}
