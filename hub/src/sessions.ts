import type { IPty, PtySpawn } from './nodePty';

export interface Project { label: string; path: string; }
export type TerminalKind = 'claude' | 'shell';
export interface TerminalInfo { id: string; label: string; kind: TerminalKind; }
export interface SessionTree { id: string; label: string; cwd: string; terminals: TerminalInfo[]; }
export type Send = (msg: object) => void;

const MAX_BUFFER = 200 * 1024;
const NOTIFY_DEBOUNCE_MS = 3000;

interface Session { id: string; label: string; cwd: string; }
interface Terminal {
  id: string; sessionId: string; label: string; kind: TerminalKind;
  pty: IPty; buffer: string; cols: number; rows: number; lastNotify: number;
}

// 세션(프로젝트) > 터미널(PTY) 2계층. WS 메시지의 sessionId 필드는 터미널 id를 가리킨다(PWA 호환).
export class SessionManager {
  private sessions = new Map<string, Session>();
  private terminals = new Map<string, Terminal>();
  private sCounter = 0;
  private tCounter = 0;

  constructor(
    private spawn: PtySpawn,
    private broadcast: Send,
    private shell: string,
    private launchCmd: string,
  ) {}

  // 세션 생성 + 기본 claude 터미널 1개 자동 생성.
  createSession(project: Project, cols = 80, rows = 24): { sessionId: string; terminalId: string } {
    const sessionId = 's' + (++this.sCounter);
    this.sessions.set(sessionId, { id: sessionId, label: project.label, cwd: project.path });
    const terminalId = this.spawnTerminal(sessionId, 'claude', 'claude', cols, rows);
    this.broadcastList();
    return { sessionId, terminalId };
  }

  // 세션 안에 추가 터미널. 기본은 셸(claude 미실행).
  createTerminal(sessionId: string, kind: TerminalKind = 'shell', cols = 80, rows = 24): string | null {
    if (!this.sessions.has(sessionId)) return null;
    const n = Array.from(this.terminals.values()).filter(t => t.sessionId === sessionId && t.kind === 'shell').length + 1;
    const label = kind === 'claude' ? 'claude' : 'shell ' + n;
    const id = this.spawnTerminal(sessionId, kind, label, cols, rows);
    this.broadcastList();
    return id;
  }

  private spawnTerminal(sessionId: string, kind: TerminalKind, label: string, cols: number, rows: number): string {
    const session = this.sessions.get(sessionId)!;
    const pty = this.spawn(this.shell, [], {
      name: 'xterm-256color', cols, rows, cwd: session.cwd, env: process.env,
    });
    const id = 't' + (++this.tCounter);
    const term: Terminal = { id, sessionId, label, kind, pty, buffer: '', cols, rows, lastNotify: 0 };
    this.terminals.set(id, term);

    pty.onData(data => {
      this.append(term, data);
      this.broadcast({ type: 'terminal_data', sessionId: id, data });
      if (data.indexOf('\x07') !== -1) this.maybeNotify(term);
    });
    pty.onExit(() => {
      this.terminals.delete(id);
      this.broadcast({ type: 'terminal_exit', sessionId: id });
      // 터미널이 모두 사라진 세션은 함께 정리.
      if (!Array.from(this.terminals.values()).some(t => t.sessionId === sessionId)) {
        this.sessions.delete(sessionId);
      }
      this.broadcastList();
    });

    // claude 터미널만 launch 명령 실행. 셸은 그대로 둔다.
    if (kind === 'claude' && this.launchCmd) pty.write(this.launchCmd + '\r');
    return id;
  }

  write(terminalId: string, data: string): void {
    this.terminals.get(terminalId)?.pty.write(data);
  }

  resize(terminalId: string, cols: number, rows: number): void {
    const t = this.terminals.get(terminalId);
    if (!t || cols < 1 || rows < 1) return;
    t.cols = cols; t.rows = rows;
    try { t.pty.resize(cols, rows); } catch { /* 종료됨 */ }
  }

  // 셸 터미널만 닫는다. claude 터미널은 고정(거부).
  closeTerminal(terminalId: string): boolean {
    const t = this.terminals.get(terminalId);
    if (!t || t.kind === 'claude') return false;
    try { t.pty.kill(); } catch { /* 무시 */ }
    return true;
  }

  // 세션 종료 — 소속 터미널 전부 kill.
  closeSession(sessionId: string): boolean {
    if (!this.sessions.has(sessionId)) return false;
    for (const t of Array.from(this.terminals.values())) {
      if (t.sessionId === sessionId) { try { t.pty.kill(); } catch { /* 무시 */ } }
    }
    return true;
  }

  // 중첩 트리 (REST GET /sessions 용)
  tree(): SessionTree[] {
    return Array.from(this.sessions.values()).map(s => ({
      id: s.id, label: s.label, cwd: s.cwd,
      terminals: Array.from(this.terminals.values())
        .filter(t => t.sessionId === s.id)
        .map(t => ({ id: t.id, label: t.label, kind: t.kind })),
    }));
  }

  // 평면 터미널 목록 (WS session_list 용 — PWA 호환)
  terminalList(): { id: string; label: string }[] {
    return Array.from(this.terminals.values()).map(t => ({ id: t.id, label: t.label }));
  }

  // 새 클라이언트 접속 시: 목록 + 각 터미널 버퍼 리플레이
  resyncTo(send: Send): void {
    send({ type: 'session_list', sessions: this.terminalList() });
    for (const t of this.terminals.values()) {
      if (t.buffer) send({ type: 'terminal_data', sessionId: t.id, data: t.buffer });
    }
  }

  // 터미널 전환 시: 해당 터미널 버퍼만 다시 전송
  replayTo(terminalId: string, send: Send): void {
    const t = this.terminals.get(terminalId);
    if (t?.buffer) send({ type: 'terminal_data', sessionId: terminalId, data: t.buffer });
  }

  private broadcastList(): void {
    this.broadcast({ type: 'session_list', sessions: this.terminalList() });
  }

  private maybeNotify(t: Terminal): void {
    const now = Date.now();
    if (now - t.lastNotify < NOTIFY_DEBOUNCE_MS) return;
    t.lastNotify = now;
    const label = this.sessions.get(t.sessionId)?.label ?? t.label;
    this.broadcast({ type: 'notify', sessionId: t.id, label });
  }

  private append(t: Terminal, data: string): void {
    const next = t.buffer + data;
    t.buffer = next.length > MAX_BUFFER ? next.slice(next.length - MAX_BUFFER) : next;
  }

  dispose(): void {
    for (const t of this.terminals.values()) { try { t.pty.kill(); } catch { /* */ } }
    this.terminals.clear();
    this.sessions.clear();
  }
}
