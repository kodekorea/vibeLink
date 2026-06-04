import * as vscode from 'vscode';
import { WebSocket } from 'ws';
import type { S2C } from './server';
import type { TerminalHost, TerminalManager } from './terminal';

// 이 창이 '프로바이더'일 때(허브가 다른 창에 이미 떠 있을 때) 사용.
// 허브의 /provider WS에 붙어, 자기 터미널 출력을 허브로 흘려보내고
// 허브가 전달하는 입력/리사이즈/생성/종료 명령을 받아 처리한다.
export class ProviderClient implements TerminalHost {
  readonly clientJoinHandlers: Array<(ws: WebSocket) => void> = [];
  onTerminalInput?: (id: string, data: string) => void;
  onTerminalResize?: (id: string, cols: number, rows: number) => void;
  onTerminalSelect?: (ws: WebSocket, id: string) => void;
  termMgr?: TerminalManager;

  private ws?: WebSocket;
  private open = false;
  private queue: string[] = [];
  private closed = false;

  constructor(
    private port: number,
    private windowId: string,
    private label: string,
    private out: vscode.OutputChannel,
  ) {
    this.connect();
  }

  private connect(): void {
    if (this.closed) return;
    const ws = new WebSocket(`ws://127.0.0.1:${this.port}/provider`);
    this.ws = ws;
    ws.on('open', () => {
      this.open = true;
      this.out.appendLine(`[provider] 허브 연결됨 → 등록 (${this.label})`);
      ws.send(JSON.stringify({ type: 'register', windowId: this.windowId, label: this.label }));
      for (const s of this.queue.splice(0)) ws.send(s);
      this.termMgr?.resync();
    });
    ws.on('message', (raw: Buffer) => this.onHubMessage(raw.toString()));
    ws.on('close', () => {
      this.open = false;
      if (this.closed) return;
      this.out.appendLine('[provider] 허브 연결 끊김 → 2초 후 재연결');
      setTimeout(() => this.connect(), 2000);
    });
    ws.on('error', e => this.out.appendLine(`[provider] WS 오류: ${e instanceof Error ? e.message : String(e)}`));
  }

  // TerminalManager가 출력을 흘려보내는 통로 → 허브로 전송
  broadcast(msg: S2C): void {
    const s = JSON.stringify(msg);
    if (this.open && this.ws?.readyState === WebSocket.OPEN) this.ws.send(s);
    else this.queue.push(s);
  }

  private onHubMessage(raw: string): void {
    let m: { type?: string; id?: string; data?: string; cols?: number; rows?: number; name?: string; shellPath?: string };
    try { m = JSON.parse(raw); } catch { return; }
    switch (m.type) {
      case 'terminal_input':  this.onTerminalInput?.(m.id ?? '', m.data ?? ''); break;
      case 'terminal_resize': this.onTerminalResize?.(m.id ?? '', m.cols ?? 0, m.rows ?? 0); break;
      case 'terminal_select': if (this.ws) this.onTerminalSelect?.(this.ws, m.id ?? ''); break;
      case 'create':          this.termMgr?.createTerminal(m.name ?? '터미널', m.shellPath ?? ''); break;
      case 'close':           this.termMgr?.closeTerminal(m.id ?? ''); break;
      case 'resync':          this.termMgr?.resync(); break;
    }
  }

  dispose(): void {
    this.closed = true;
    try { this.ws?.close(); } catch { /* ignore */ }
  }
}
