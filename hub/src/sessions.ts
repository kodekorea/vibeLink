import type { IPty, PtySpawn } from './nodePty';

export interface Project { label: string; path: string; }
// 터미널 종류: 'agent' = 세션의 기본 에이전트 터미널(claude/opencode/codex 등, 고정·닫기불가),
//             'shell' = 추가 셸 터미널(에이전트 미실행, 닫기가능).
export type TerminalKind = 'agent' | 'shell';
// 런타임 선택: agent(실행 프로그램) × env(환경/셸). 기본 claude × powershell.
//  - agent: 'claude' | 'opencode' | 'codex' | 'shell'(none)
//  - env:   'powershell' | 'wsl'
export interface RuntimeSpec { agent: string; env: string; }
export interface TerminalInfo { id: string; label: string; kind: TerminalKind; agent: string; env: string; }
export interface SessionTree { id: string; label: string; cwd: string; env: string; terminals: TerminalInfo[]; }
export type Send = (msg: object) => void;

const MAX_BUFFER = 200 * 1024;
const NOTIFY_DEBOUNCE_MS = 3000;

// 에이전트명 → 셸에 타이핑할 실행 커맨드. 명령명과 다른 경우만 등록한다.
//  - opencode: 'opencode [project]'가 기본(default) 서브커맨드라 cwd에서 그냥 'opencode'면 TUI가 뜬다.
//  - codex:    OpenAI Codex CLI 스텁(미설치·미검증) — 일단 'codex'로 매핑해 선택만 가능하게.
// 'claude'는 launchCmd(생성자 주입)를 쓰므로 여기 두지 않는다. 맵에 없으면 에이전트명을 그대로 실행.
const AGENT_CMD: Record<string, string> = {
  opencode: 'opencode',
  codex: 'codex',
};

interface Session { id: string; label: string; cwd: string; env: string; }
interface Terminal {
  id: string; sessionId: string; label: string; kind: TerminalKind; agent: string; env: string;
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
    private shell: string,        // env=powershell 기본 셸 (예: powershell.exe)
    private launchCmd: string,    // agent=claude 기본 실행 명령 (예: claude)
  ) {}

  // 런타임 스펙 → 실제 spawn 정보. env/agent별 분기는 여기 한 곳에서 확장한다.
  // (WSL 지원 = env 'wsl' 분기 추가, opencode/codex = agent 분기 추가)
  private resolveRuntime(spec: RuntimeSpec, cwd: string): { file: string; args: string[]; cwd: string; launch: string } {
    // 환경(셸)
    let file = this.shell;
    let args: string[] = [];
    if (spec.env === 'wsl') {
      // 기본 골격 — WSL 브랜치에서 distro/-e bash -lc/경로변환을 채운다.
      file = 'wsl.exe';
      args = [];
    }
    // 에이전트(실행 명령) — 셸에 타이핑할 launch 커맨드. 매핑은 AGENT_CMD 한 곳에서.
    let launch = '';
    if (spec.agent === 'claude') launch = this.launchCmd;
    else if (spec.agent && spec.agent !== 'shell') launch = AGENT_CMD[spec.agent] ?? spec.agent;
    return { file, args, cwd, launch };
  }

  // 세션 생성 + 기본 에이전트 터미널 1개 자동 생성.
  createSession(project: Project, spec?: Partial<RuntimeSpec>, cols = 80, rows = 24): { sessionId: string; terminalId: string } {
    const agent = spec?.agent ?? 'claude';
    const env = spec?.env ?? 'powershell';
    const sessionId = 's' + (++this.sCounter);
    this.sessions.set(sessionId, { id: sessionId, label: project.label, cwd: project.path, env });
    const terminalId = this.spawnTerminal(sessionId, 'agent', agent, agent, env, cols, rows);
    this.broadcastList();
    return { sessionId, terminalId };
  }

  // 세션 안에 추가 터미널. 기본은 셸(에이전트 미실행). env는 세션 기본을 따른다.
  createTerminal(sessionId: string, spec?: Partial<RuntimeSpec>, cols = 80, rows = 24): string | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    const agent = spec?.agent ?? 'shell';
    const env = spec?.env ?? session.env;
    const kind: TerminalKind = agent === 'shell' ? 'shell' : 'agent';
    const n = Array.from(this.terminals.values()).filter(t => t.sessionId === sessionId && t.kind === 'shell').length + 1;
    const label = kind === 'agent' ? agent : 'shell ' + n;
    const id = this.spawnTerminal(sessionId, kind, label, agent, env, cols, rows);
    this.broadcastList();
    return id;
  }

  private spawnTerminal(sessionId: string, kind: TerminalKind, label: string, agent: string, env: string, cols: number, rows: number): string {
    const session = this.sessions.get(sessionId)!;
    const rt = this.resolveRuntime({ agent, env }, session.cwd);
    const pty = this.spawn(rt.file, rt.args, {
      name: 'xterm-256color', cols, rows, cwd: rt.cwd, env: process.env,
    });
    const id = 't' + (++this.tCounter);
    const term: Terminal = { id, sessionId, label, kind, agent, env, pty, buffer: '', cols, rows, lastNotify: 0 };
    this.terminals.set(id, term);

    pty.onData(data => {
      this.append(term, data);
      this.broadcast({ type: 'terminal_data', sessionId: id, data });
      if (data.indexOf('\x07') !== -1) this.maybeNotify(term);
    });
    pty.onExit(() => {
      this.terminals.delete(id);
      this.broadcast({ type: 'terminal_exit', sessionId: id });
      if (!Array.from(this.terminals.values()).some(t => t.sessionId === sessionId)) {
        this.sessions.delete(sessionId);
      }
      this.broadcastList();
    });

    // 에이전트(claude/opencode/codex) 터미널만 launch 명령 실행. 셸은 그대로 둔다.
    if (rt.launch) pty.write(rt.launch + '\r');
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

  // 셸 터미널만 닫는다. 에이전트 터미널은 고정(거부).
  closeTerminal(terminalId: string): boolean {
    const t = this.terminals.get(terminalId);
    if (!t || t.kind === 'agent') return false;
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
      id: s.id, label: s.label, cwd: s.cwd, env: s.env,
      terminals: Array.from(this.terminals.values())
        .filter(t => t.sessionId === s.id)
        .map(t => ({ id: t.id, label: t.label, kind: t.kind, agent: t.agent, env: t.env })),
    }));
  }

  // 평면 터미널 목록 (WS session_list 용 — PWA 호환)
  terminalList(): { id: string; label: string }[] {
    return Array.from(this.terminals.values()).map(t => ({ id: t.id, label: t.label }));
  }

  resyncTo(send: Send): void {
    send({ type: 'session_list', sessions: this.terminalList() });
    for (const t of this.terminals.values()) {
      if (t.buffer) send({ type: 'terminal_data', sessionId: t.id, data: t.buffer });
    }
  }

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
