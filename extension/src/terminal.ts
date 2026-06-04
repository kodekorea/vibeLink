import * as child_process from 'child_process';
import * as fs from 'fs';
import { createRequire } from 'module';
import * as path from 'path';
import * as vscode from 'vscode';
import { WebSocket } from 'ws';
import type { S2C } from './server';

const MAX_BUFFER = 200 * 1024;

// 터미널이 출력을 흘려보낼 대상(허브 서버 또는 프로바이더 클라이언트)을 추상화.
// 허브 모드면 MtbServer가, 프로바이더 모드면 ProviderClient가 이 인터페이스를 만족한다.
export interface TerminalHost {
  clientJoinHandlers: Array<(ws: WebSocket) => void>;
  onTerminalInput?: (id: string, data: string) => void;
  onTerminalResize?: (id: string, cols: number, rows: number) => void;
  onTerminalSelect?: (ws: WebSocket, id: string) => void;
  broadcast(msg: S2C): void;
}

export interface ShellInfo { id: string; name: string; path: string; }

export function detectShells(): ShellInfo[] {
  const shells: ShellInfo[] = [{ id: 'default', name: '기본 셸', path: '' }];
  if (process.platform === 'win32') {
    shells.push({ id: 'powershell', name: 'PowerShell', path: 'powershell.exe' });
    try {
      child_process.execSync('pwsh.exe --version', { stdio: 'ignore', timeout: 2000 });
      shells.push({ id: 'pwsh', name: 'PowerShell 7', path: 'pwsh.exe' });
    } catch { /* not installed */ }
    try {
      child_process.execSync('wsl.exe --status', { stdio: 'ignore', timeout: 2000 });
      shells.push({ id: 'wsl', name: 'WSL', path: 'wsl.exe' });
    } catch { /* not installed */ }
    const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe';
    if (fs.existsSync(gitBash)) shells.push({ id: 'gitbash', name: 'Git Bash', path: gitBash });
    shells.push({ id: 'cmd', name: 'Command Prompt', path: 'cmd.exe' });
  } else {
    for (const [id, name, p] of [
      ['bash', 'bash', '/bin/bash'],
      ['zsh',  'zsh',  '/bin/zsh'],
      ['fish', 'fish', '/usr/bin/fish'],
    ] as const) {
      if (fs.existsSync(p)) shells.push({ id, name, path: p });
    }
  }
  return shells;
}

// ── VS Code 내장 node-pty 재사용 (현재 Electron용으로 빌드돼 있어 ABI 일치) ──
interface IPty {
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  readonly pid: number;
}
interface NodePty {
  spawn(file: string, args: string[] | string, opts: {
    name?: string; cols?: number; rows?: number; cwd?: string; env?: NodeJS.ProcessEnv;
  }): IPty;
}

function loadNodePty(): NodePty {
  const ptyPath = path.join(vscode.env.appRoot, 'node_modules', 'node-pty');
  return createRequire(process.execPath)(ptyPath) as NodePty;
}

interface Session {
  id: string;
  name: string;
  proc: IPty;
  buffer: string;
  cols: number;
  rows: number;
}

export class TerminalManager {
  private pty: NodePty;
  private sessions = new Map<string, Session>();
  private counter = 0;

  // windowId: 이 창을 식별하는 ID. 폰은 이걸로 창들을 구분/스와이프한다.
  constructor(private host: TerminalHost, private windowId: string) {
    this.pty = loadNodePty();

    host.clientJoinHandlers.push((ws: WebSocket) => {
      ws.send(JSON.stringify({ type: 'terminal_list', windowId: this.windowId, list: this.getList() }));
      for (const s of this.sessions.values()) {
        if (s.buffer) ws.send(JSON.stringify({ type: 'terminal_data', windowId: this.windowId, id: s.id, data: s.buffer }));
      }
    });

    host.onTerminalInput  = (id, data) => this.write(id, data);
    host.onTerminalResize = (id, cols, rows) => this.resize(id, cols, rows);
    host.onTerminalSelect = (ws, id) => {
      const s = this.sessions.get(id);
      if (s) ws.send(JSON.stringify({ type: 'terminal_data', windowId: this.windowId, id, data: s.buffer }));
    };
  }

  // 폰이 새로 접속했을 때(또는 허브가 요청할 때) 현재 상태를 다시 흘려보낸다.
  resync(): void {
    this.host.broadcast({ type: 'terminal_list', windowId: this.windowId, list: this.getList() });
    for (const s of this.sessions.values()) {
      if (s.buffer) this.host.broadcast({ type: 'terminal_data', windowId: this.windowId, id: s.id, data: s.buffer });
    }
  }

  activate(context: vscode.ExtensionContext): void {
    this.spawnSession('터미널', '');
    context.subscriptions.push({ dispose: () => this.dispose() });
  }

  private defaultCwd(): string {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
      ?? process.env.USERPROFILE ?? process.env.HOME ?? process.cwd();
  }

  spawnSession(name: string, shellPath: string, cols = 80, rows = 24): string {
    const file = shellPath
      || (process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || 'bash'));
    const proc = this.pty.spawn(file, [], {
      name: 'xterm-256color', cols, rows,
      cwd: this.defaultCwd(),
      env: process.env,
    });
    const id = String(++this.counter);
    const session: Session = { id, name, proc, buffer: '', cols, rows };
    this.sessions.set(id, session);

    proc.onData(data => {
      this.appendBuffer(session, data);
      this.host.broadcast({ type: 'terminal_data', windowId: this.windowId, id, data });
      this.detectExecEnd(id, data);
    });
    proc.onExit(() => {
      this.host.broadcast({ type: 'terminal_exit', windowId: this.windowId, id });
      this.sessions.delete(id);
      this.broadcastList();
    });

    this.broadcastList();
    return id;
  }

  // server.ts /terminals/create 호환
  createTerminal(name: string, shellPath: string): void {
    this.spawnSession(name || shellPath || '터미널', shellPath);
  }

  write(id: string, data: string): void {
    (this.sessions.get(id) ?? this.firstSession())?.proc.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    const s = this.sessions.get(id);
    if (!s || cols < 1 || rows < 1) return;
    s.cols = cols; s.rows = rows;
    try { s.proc.resize(cols, rows); } catch { /* pty 종료 등 */ }
  }

  closeTerminal(id: string): boolean {
    const s = this.sessions.get(id);
    if (!s) return false;
    try { s.proc.kill(); } catch { /* ignore */ }
    return true;
  }

  private firstSession(): Session | undefined {
    return this.sessions.values().next().value as Session | undefined;
  }

  private appendBuffer(s: Session, data: string): void {
    const next = s.buffer + data;
    s.buffer = next.length > MAX_BUFFER ? next.slice(next.length - MAX_BUFFER) : next;
  }

  private getList(): { id: string; name: string; hasShellIntegration: boolean }[] {
    return Array.from(this.sessions.values()).map(s => ({
      id: s.id, name: s.name, hasShellIntegration: true,
    }));
  }

  broadcastList(): void {
    this.host.broadcast({ type: 'terminal_list', windowId: this.windowId, list: this.getList() });
  }

  // OSC 133 ; D ; <exit> 감지 → 완료 알림 (셸이 OSC 133을 내보낼 때만 동작)
  private detectExecEnd(id: string, data: string): void {
    const re = /\x1b\]133;D(?:;(-?\d+))?(?:\x07|\x1b\\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(data)) !== null) {
      const exitCode = m[1] !== undefined ? Number(m[1]) : null;
      this.host.broadcast({ type: 'terminal_exec_end', windowId: this.windowId, id, command: '', exitCode, durationMs: 0 });
    }
  }

  dispose(): void {
    for (const s of this.sessions.values()) {
      try { s.proc.kill(); } catch { /* ignore */ }
    }
    this.sessions.clear();
  }
}
