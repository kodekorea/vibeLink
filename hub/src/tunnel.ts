import * as child_process from 'child_process';
import * as fs from 'fs';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import QRCode from 'qrcode';

// 플랫폼별 cloudflared 바이너리 다운로드 URL
const CF_URLS: Record<string, string> = {
  'win32-x64':    'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe',
  'darwin-x64':   'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64',
  'darwin-arm64': 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64',
  'linux-x64':    'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64',
};

const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

function cfBinPath(extPath: string): string {
  const ext = process.platform === 'win32' ? '.exe' : '';
  return path.join(extPath, `cloudflared${ext}`);
}

function cfDlUrl(): string {
  const key = `${process.platform}-${os.arch()}`;
  return CF_URLS[key] ?? CF_URLS['linux-x64'];
}

function download(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const get = (u: string) => https.get(u, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        get(res.headers.location!);
        return;
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        if (process.platform !== 'win32') fs.chmodSync(dest, 0o755);
        resolve();
      });
    }).on('error', reject);
    get(url);
  });
}

export class TunnelManager {
  private proc?: child_process.ChildProcess;
  private _url?: string;
  private _readyCbs: Array<(url: string) => void> = [];
  private _ready = false;

  constructor(
    private extPath: string,
    private log: (msg: string) => void,
  ) {}

  async ensureCloudflared(): Promise<string> {
    const dest = cfBinPath(this.extPath);
    if (fs.existsSync(dest)) return dest;
    this.log('cloudflared 다운로드 중...');
    await download(cfDlUrl(), dest);
    this.log('cloudflared 다운로드 완료.');
    return dest;
  }

  async start(mode: string, port: number, namedName?: string, namedUrl?: string): Promise<void> {
    const exe = await this.ensureCloudflared();

    if (mode === 'named' && namedName && namedUrl) {
      this._url = namedUrl;
      this._notifyReady(namedUrl);
      this.proc = child_process.spawn(exe, ['tunnel', 'run', namedName], { stdio: 'ignore' });
      return;
    }

    this.log(`터널 시작 중 (포트 ${port})...`);
    this.proc = child_process.spawn(
      exe,
      ['tunnel', '--url', `http://localhost:${port}`],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    const onData = (chunk: Buffer) => {
      if (this._ready) return;
      const m = URL_RE.exec(chunk.toString());
      if (m) { this._url = m[0]; this._notifyReady(m[0]); }
    };
    this.proc.stdout?.on('data', onData);
    this.proc.stderr?.on('data', onData);
  }

  onReady(cb: (url: string) => void): void {
    if (this._ready && this._url) { cb(this._url); return; }
    this._readyCbs.push(cb);
  }

  private _notifyReady(url: string): void {
    this._ready = true;
    for (const cb of this._readyCbs) cb(url);
    this._readyCbs = [];
  }

  get url(): string | undefined { return this._url; }

  async showQR(url: string): Promise<void> {
    const ascii = await QRCode.toString(url, { type: 'terminal', small: true });
    const bar = '─'.repeat(52);
    this.log(`\n${bar}`);
    this.log(`  접속 URL: ${url}`);
    this.log('');
    this.log(ascii);
    this.log('  휴대폰으로 QR을 찍어 접속하세요');
    this.log(`${bar}\n`);
  }

  private static QR_OPTS = {
    errorCorrectionLevel: 'M' as const,
    margin: 4,               // quiet zone — 인식률에 중요
    width: 512,
    color: { dark: '#000000', light: '#ffffff' },
  };

  async qrPng(url: string): Promise<Buffer> {
    return QRCode.toBuffer(url, TunnelManager.QR_OPTS);
  }

  async qrDataUrl(url: string): Promise<string> {
    return QRCode.toDataURL(url, TunnelManager.QR_OPTS);
  }

  stop(): void {
    this.proc?.kill();
    this.proc = undefined;
    this._url = undefined;
    this._ready = false;
    this._readyCbs = [];
  }
}
