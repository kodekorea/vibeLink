import * as vscode from 'vscode';
import { TunnelManager } from './tunnel';

export class PreviewManager {
  private tunnel?: TunnelManager;
  private _port?: number;

  constructor(
    private extPath: string,
    private out: vscode.OutputChannel,
  ) {}

  async start(port: number): Promise<string | undefined> {
    this.stop();
    this._port = port;
    this.tunnel = new TunnelManager(this.extPath, this.out);
    this.out.appendLine(`프리뷰 터널 시작 (포트 ${port})...`);
    await this.tunnel.start('temp', port);
    return new Promise(resolve => {
      const timer = setTimeout(() => resolve(undefined), 30_000);
      this.tunnel!.onReady(url => {
        clearTimeout(timer);
        this.out.appendLine(`프리뷰 URL: ${url}`);
        resolve(url);
      });
    });
  }

  stop(): void {
    this.tunnel?.stop();
    this.tunnel = undefined;
    this._port = undefined;
  }

  get url(): string | undefined { return this.tunnel?.url; }
  get port(): number | undefined { return this._port; }

  async qrPng(): Promise<Buffer | undefined> {
    const url = this.url;
    if (!url || !this.tunnel) return undefined;
    return this.tunnel.qrPng(url);
  }
}
