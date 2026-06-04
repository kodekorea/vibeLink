import type { IPty, PtySpawn } from './nodePty';

export interface Project { label: string; path: string; }
export interface SessionInfo { id: string; label: string; cwd: string; }
export type Send = (msg: object) => void;

const MAX_BUFFER = 200 * 1024;

interface Session {
  id: string; label: string; cwd: string;
  pty: IPty; buffer: string; cols: number; rows: number;
  lastNotify: number;
}

const NOTIFY_DEBOUNCE_MS = 3000;

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
    const session: Session = { id, label: project.label, cwd: project.path, pty, buffer: '', cols, rows, lastNotify: 0 };
    this.sessions.set(id, session);

    pty.onData(data => {
      this.append(session, data);
      this.broadcast({ type: 'terminal_data', sessionId: id, data });
      // 터미널 벨(BEL) = "완료/입력 대기" 신호 → 폰 알림 (세션당 디바운스)
      if (data.indexOf('\x07') !== -1) this.maybeNotify(session);
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
    return Array.from(this.sessions.values()).map(s => ({ id: s.id, label: s.label, cwd: s.cwd }));
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

  private maybeNotify(s: Session): void {
    const now = Date.now();
    if (now - s.lastNotify < NOTIFY_DEBOUNCE_MS) return;
    s.lastNotify = now;
    this.broadcast({ type: 'notify', sessionId: s.id, label: s.label });
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
