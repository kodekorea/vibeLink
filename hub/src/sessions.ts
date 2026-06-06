import type { IPty, PtySpawn } from './nodePty';
import { buildWslSpawn } from './wsl';
import { resolveEnvShell } from './shells';

export interface Project { label: string; path: string; }
// 터미널 종류: 'agent' = 세션의 기본 에이전트 터미널(claude/opencode/codex 등, 고정·닫기불가),
//             'shell' = 추가 셸 터미널(에이전트 미실행, 닫기가능).
export type TerminalKind = 'agent' | 'shell';
// 런타임 선택: agent(실행 프로그램) × env(환경/셸). 기본 claude × powershell.
//  - agent: 'claude' | 'opencode' | 'codex' | 'shell'(none)
//  - env:   'powershell' | 'cmd' | 'gitbash' | 'wsl'
export interface RuntimeSpec { agent: string; env: string; }
export interface TerminalInfo { id: string; label: string; kind: TerminalKind; agent: string; env: string; }
export interface SessionTree { id: string; label: string; cwd: string; env: string; terminals: TerminalInfo[]; }
export type Send = (msg: object) => void;

const MAX_BUFFER = 200 * 1024;
// 완료 알림 기준(에이전트가 "오래 생각"하고 끝났을 때만):
//  - 작업 중엔 스피너/상태가 계속 출력돼 데이터가 흐르고, 끝나면 조용해진다.
//  - QUIET_MS 동안 조용 = 턴 종료. 직전 작업 구간이 MIN_BUSY_MS 이상이었으면 그때만 알림.
const NOTIFY_QUIET_MS = 1500;   // 이만큼 출력 없으면 "끝남"으로 판정
const NOTIFY_MIN_BUSY_MS = 10000; // 작업이 이 시간 이상 지속됐을 때만 알림(짧은 응답 무시)
// 에이전트 실행은 첫 resize(실제 터미널 크기)까지 미룬다 — 80x24로 부팅해 화면이 깨지는 문제 방지.
// 클라이언트가 안 붙어 resize가 안 오면 이 시간 뒤 그냥 실행.
const LAUNCH_FALLBACK_MS = 1500;

// 에이전트명 → 셸에 타이핑할 실행 커맨드. 명령명과 다른 경우만 등록한다.
//  - opencode: 'opencode [project]'가 기본(default) 서브커맨드라 cwd에서 그냥 'opencode'면 TUI가 뜬다.
//  - codex:    OpenAI Codex CLI 스텁(미설치·미검증) — 일단 'codex'로 매핑해 선택만 가능하게.
// 'claude'는 launchCmd(생성자 주입)를 쓰므로 여기 두지 않는다. 맵에 없으면 에이전트명을 그대로 실행.
const AGENT_CMD: Record<string, string> = {
  opencode: 'opencode',
  codex: 'codex',
};
// 런모드 = 권한 건너뛰기(위험) 플래그. 에이전트별로 명령이 다르다.
// 주의: opencode TUI(`opencode [project]`)엔 스킵 플래그가 없다(권한은 opencode 설정에서) → 미등록.
const DANGER_FLAGS: Record<string, string> = {
  claude: '--dangerously-skip-permissions',
  codex: '--dangerously-bypass-approvals-and-sandbox',
};

interface Session { id: string; label: string; cwd: string; env: string; }
interface Terminal {
  id: string; sessionId: string; label: string; kind: TerminalKind; agent: string; env: string;
  pty: IPty; buffer: string; cols: number; rows: number;
  busyStart?: number; lastData?: number; idleTimer?: ReturnType<typeof setTimeout>;
  pendingLaunch?: string; launchTimer?: ReturnType<typeof setTimeout>;
}

// 세션(프로젝트) > 터미널(PTY) 2계층. WS 메시지의 sessionId 필드는 터미널 id를 가리킨다(PWA 호환).
export class SessionManager {
  private sessions = new Map<string, Session>();
  private terminals = new Map<string, Terminal>();
  private sCounter = 0;
  private tCounter = 0;

  private notifyQuietMs: number;
  private notifyMinBusyMs: number;
  // 새 세션이 띄울 기본 에이전트/환경(사용자 설정). createSession에 spec이 없으면 이 값을 쓴다.
  private defaultAgent = 'claude';
  private defaultEnv = 'powershell';
  private dangerMode = false;   // 런모드: 켜면 에이전트별 권한건너뛰기 플래그를 붙인다

  constructor(
    private spawn: PtySpawn,
    private broadcast: Send,
    private shell: string,        // env=powershell 기본 셸 (예: powershell.exe)
    private launchCmd: string,    // agent=claude 기본 실행 명령 (예: claude)
    opts?: { notifyQuietMs?: number; notifyMinBusyMs?: number },
  ) {
    this.notifyQuietMs = opts?.notifyQuietMs ?? (Number(process.env.MTB_NOTIFY_QUIET_MS) || NOTIFY_QUIET_MS);
    this.notifyMinBusyMs = opts?.notifyMinBusyMs ?? (Number(process.env.MTB_NOTIFY_MIN_MS) || NOTIFY_MIN_BUSY_MS);
  }

  // 완료 알림 임계값 (폰 설정에서 실시간 변경). 안전 범위로 clamp.
  getNotify(): { minMs: number; quietMs: number } {
    return { minMs: this.notifyMinBusyMs, quietMs: this.notifyQuietMs };
  }
  setNotify(opts: { minMs?: number; quietMs?: number }): { minMs: number; quietMs: number } {
    if (typeof opts.minMs === 'number' && Number.isFinite(opts.minMs)) {
      this.notifyMinBusyMs = Math.min(120000, Math.max(2000, Math.round(opts.minMs)));
    }
    if (typeof opts.quietMs === 'number' && Number.isFinite(opts.quietMs)) {
      this.notifyQuietMs = Math.min(10000, Math.max(500, Math.round(opts.quietMs)));
    }
    return this.getNotify();
  }

  // 새 세션 기본 에이전트 (폰 설정에서 변경 + 시작 시 agent.json에서 복원).
  getDefaultAgent(): string { return this.defaultAgent; }
  setDefaultAgent(a: string): string {
    if (a && (a === 'claude' || a === 'opencode' || a === 'codex')) this.defaultAgent = a;
    return this.defaultAgent;
  }
  // 새 세션 기본 셸/환경 (powershell/cmd/gitbash/wsl).
  getDefaultEnv(): string { return this.defaultEnv; }
  setDefaultEnv(e: string): string {
    if (e && (e === 'powershell' || e === 'cmd' || e === 'gitbash' || e === 'wsl')) this.defaultEnv = e;
    return this.defaultEnv;
  }
  // 런모드(권한 건너뛰기). 켜면 에이전트 명령에 위험 플래그를 붙인다.
  setDanger(on: boolean): void { this.dangerMode = !!on; }
  getDanger(): boolean { return this.dangerMode; }

  // 런타임 스펙 → 실제 spawn 정보. env/agent별 분기는 여기 한 곳에서 확장한다.
  // (WSL 지원 = env 'wsl' 분기 추가, opencode/codex = agent 분기 추가)
  private resolveRuntime(spec: RuntimeSpec, cwd: string): { file: string; args: string[]; cwd: string; launch: string } {
    // 환경(셸)
    let file = this.shell;
    let args: string[] = [];
    if (spec.env === 'wsl') {
      // wsl.exe --cd <WindowsPath> 로 세션 폴더에서 기본 배포판의 대화형 로그인 셸을 띄운다.
      // launch(claude 등)는 아래 spawnTerminal에서 셸에 타이핑된다(powershell 경로와 동일 모델).
      const w = buildWslSpawn(cwd);
      file = w.file;
      args = w.args;
    } else {
      // cmd.exe / Git Bash. cwd는 node-pty의 cwd로 잡힌다(Windows 경로 그대로 OK).
      const sh = resolveEnvShell(spec.env);
      if (sh) { file = sh.file; args = sh.args; }
    }
    // 에이전트(실행 명령) — 셸에 타이핑할 launch 커맨드. 매핑은 AGENT_CMD 한 곳에서.
    let launch = '';
    if (spec.agent && spec.agent !== 'shell') {
      const base = spec.agent === 'claude' ? this.launchCmd : (AGENT_CMD[spec.agent] ?? spec.agent);
      const flag = this.dangerMode ? (DANGER_FLAGS[spec.agent] ?? '') : '';
      launch = flag ? base + ' ' + flag : base;
    }
    return { file, args, cwd, launch };
  }

  // 세션 생성 + 기본 에이전트 터미널 1개 자동 생성.
  createSession(project: Project, spec?: Partial<RuntimeSpec>, cols = 80, rows = 24): { sessionId: string; terminalId: string } {
    const agent = spec?.agent ?? this.defaultAgent;
    const env = spec?.env ?? this.defaultEnv;
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
    // COLORFGBG: TUI(opencode/termenv 등)가 OSC 질의 대신 이 env로 다크/라이트를 판단하는 경우 대비.
    const ptyEnv = Object.assign({}, process.env, {
      COLORFGBG: process.env.MTB_CLAUDE_THEME === 'dark' ? '15;0' : '0;15',
    });
    const pty = this.spawn(rt.file, rt.args, {
      name: 'xterm-256color', cols, rows, cwd: rt.cwd, env: ptyEnv,
    });
    const id = 't' + (++this.tCounter);
    const term: Terminal = { id, sessionId, label, kind, agent, env, pty, buffer: '', cols, rows };
    this.terminals.set(id, term);

    pty.onData(data => {
      this.append(term, data);
      this.broadcast({ type: 'terminal_data', sessionId: id, data });
      // 에이전트 터미널(claude/codex/opencode)만 "오래 작업 후 완료" 감지. 셸은 제외.
      if (term.kind === 'agent') this.trackBusy(term);
    });
    pty.onExit(() => {
      if (term.idleTimer) clearTimeout(term.idleTimer);
      if (term.launchTimer) clearTimeout(term.launchTimer);
      this.terminals.delete(id);
      this.broadcast({ type: 'terminal_exit', sessionId: id });
      if (!Array.from(this.terminals.values()).some(t => t.sessionId === sessionId)) {
        this.sessions.delete(sessionId);
      }
      this.broadcastList();
    });

    // 에이전트(claude/opencode/codex) launch는 첫 resize까지 미룬다(셸은 launch 없음).
    if (rt.launch) {
      term.pendingLaunch = rt.launch;
      term.launchTimer = setTimeout(() => this.flushLaunch(term), LAUNCH_FALLBACK_MS);
      term.launchTimer.unref?.();
    }
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
    this.flushLaunch(t);   // 실제 크기를 받은 뒤 에이전트 실행(첫 화면 깨짐 방지)
  }

  // 미뤄둔 에이전트 launch를 실행(첫 resize 또는 폴백 타임아웃 시).
  private flushLaunch(t: Terminal): void {
    if (!t.pendingLaunch) return;
    const cmd = t.pendingLaunch;
    t.pendingLaunch = undefined;
    if (t.launchTimer) { clearTimeout(t.launchTimer); t.launchTimer = undefined; }
    try { t.pty.write(cmd + '\r'); } catch { /* 무시 */ }
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

  // 출력이 흐르는 동안 작업 구간을 추적하고, 조용해지면(NOTIFY_QUIET_MS) 종료로 판정.
  private trackBusy(t: Terminal): void {
    const now = Date.now();
    if (t.busyStart == null) t.busyStart = now;
    t.lastData = now;
    if (t.idleTimer) clearTimeout(t.idleTimer);
    t.idleTimer = setTimeout(() => this.onIdle(t), this.notifyQuietMs);
  }

  // 작업이 조용해진 시점 — 직전 구간이 충분히 길었으면(오래 생각) 그때만 완료 알림.
  private onIdle(t: Terminal): void {
    t.idleTimer = undefined;
    const start = t.busyStart;
    t.busyStart = undefined;
    if (start == null) return;
    const busyMs = (t.lastData ?? start) - start;
    if (busyMs < this.notifyMinBusyMs) return;   // 짧은 응답 → 알림 안 함
    const label = this.sessions.get(t.sessionId)?.label ?? t.label;
    this.broadcast({ type: 'notify', sessionId: t.id, label, busyMs });
  }

  private append(t: Terminal, data: string): void {
    const next = t.buffer + data;
    t.buffer = next.length > MAX_BUFFER ? next.slice(next.length - MAX_BUFFER) : next;
  }

  dispose(): void {
    for (const t of this.terminals.values()) {
      if (t.idleTimer) clearTimeout(t.idleTimer);
      if (t.launchTimer) clearTimeout(t.launchTimer);
      try { t.pty.kill(); } catch { /* */ }
    }
    this.terminals.clear();
    this.sessions.clear();
  }
}
