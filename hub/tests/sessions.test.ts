import { test } from 'node:test';
import assert from 'node:assert';
import { SessionManager } from '../src/sessions';
import { winPathToWsl, buildWslSpawn } from '../src/wsl';
import type { IPty } from '../src/nodePty';

interface Fake { pty: IPty; file: string; args: string[]; writes: string[]; emit: (d: string) => void; exit: () => void; opts: any; }

// spawn 호출마다 새 fake pty를 만들고 기록한다(터미널 여러 개 검증용).
function fakeSpawn() {
  const made: Fake[] = [];
  const spawn = (file: string, args: string[], opts: any): IPty => {
    let dataCb: (d: string) => void = () => {};
    let exitCb: (e: { exitCode: number }) => void = () => {};
    const writes: string[] = [];
    const pty: IPty = {
      pid: 100 + made.length,
      onData(cb) { dataCb = cb; },
      onExit(cb) { exitCb = cb; },
      write(d) { writes.push(d); },
      resize() { /* noop */ },
      kill() { exitCb({ exitCode: 0 }); },
    };
    made.push({ pty, file, args, writes, emit: (d) => dataCb(d), exit: () => exitCb({ exitCode: 0 }), opts });
    return pty;
  };
  return { spawn, made };
}

test('createSession: 세션 + claude 터미널 자동 생성 + launch 실행 + 방송', () => {
  const { spawn, made } = fakeSpawn();
  const msgs: any[] = [];
  const sm = new SessionManager(spawn, m => msgs.push(m), 'powershell.exe', 'claude');
  const { sessionId, terminalId } = sm.createSession({ label: 'projA', path: 'C:\\a' });
  assert.equal(sessionId, 's1');
  assert.equal(terminalId, 't1');
  sm.resize(terminalId, 80, 24);                       // 첫 resize 후 launch
  assert.deepEqual(made[0].writes, ['claude\r']);      // claude 실행됨
  assert.equal(made[0].opts.cwd, 'C:\\a');
  const tree = sm.tree();
  assert.equal(tree.length, 1);
  assert.equal(tree[0].id, 's1');
  assert.deepEqual(tree[0].terminals, [{ id: 't1', label: 'claude', kind: 'agent', agent: 'claude', env: 'powershell' }]);
  assert.ok(msgs.some(m => m.type === 'session_list'));
});

test('createTerminal: 셸 추가 — claude 미실행, 같은 cwd, 라벨 shell 1', () => {
  const { spawn, made } = fakeSpawn();
  const sm = new SessionManager(spawn, () => {}, 'powershell.exe', 'claude');
  const { sessionId } = sm.createSession({ label: 'p', path: 'C:\\p' });
  const tid = sm.createTerminal(sessionId);
  assert.equal(tid, 't2');
  assert.deepEqual(made[1].writes, []);                 // 셸은 launch 안 함
  assert.equal(made[1].opts.cwd, 'C:\\p');
  const term = sm.tree()[0].terminals.find(t => t.id === 't2');
  assert.deepEqual(term, { id: 't2', label: 'shell 1', kind: 'shell', agent: 'shell', env: 'powershell' });
});

test('runtime spec: agent=opencode → opencode 실행, env=wsl → wsl.exe spawn (토대)', () => {
  const { spawn, made } = fakeSpawn();
  const sm = new SessionManager(spawn, () => {}, 'powershell.exe', 'claude');
  const { terminalId: t0 } = sm.createSession({ label: 'p', path: 'C:\\p' }, { agent: 'opencode', env: 'wsl' });
  assert.equal(made[0].file, 'wsl.exe');          // env=wsl → wsl.exe
  sm.resize(t0, 80, 24);
  assert.deepEqual(made[0].writes, ['opencode\r']); // agent=opencode → opencode 실행
  const term = sm.tree()[0].terminals[0];
  assert.equal(term.agent, 'opencode');
  assert.equal(term.env, 'wsl');
  assert.equal(term.kind, 'agent');
});

test('agent 매핑: opencode/codex는 AGENT_CMD로 명령명 그대로 실행', () => {
  const { spawn, made } = fakeSpawn();
  const sm = new SessionManager(spawn, () => {}, 'powershell.exe', 'claude');
  const { terminalId: ta } = sm.createSession({ label: 'p', path: 'C:\\p' }, { agent: 'opencode' });
  const { terminalId: tb } = sm.createSession({ label: 'q', path: 'C:\\q' }, { agent: 'codex' });
  sm.resize(ta, 80, 24); sm.resize(tb, 80, 24);
  assert.deepEqual(made[0].writes, ['opencode\r']); // cwd에서 bare opencode → TUI
  assert.deepEqual(made[1].writes, ['codex\r']);     // codex 스텁
  assert.equal(sm.tree()[0].terminals[0].agent, 'opencode');
});

test('env=wsl: wsl.exe --cd <세션경로>로 spawn + 셸에 claude 타이핑', () => {
  const { spawn, made } = fakeSpawn();
  const sm = new SessionManager(spawn, () => {}, 'powershell.exe', 'claude');
  const { terminalId: tw } = sm.createSession({ label: 'p', path: 'E:\\foo\\bar' }, { env: 'wsl' });
  assert.equal(made[0].file, 'wsl.exe');
  assert.deepEqual(made[0].args, ['--cd', 'E:\\foo\\bar']); // 세션 폴더에서 대화형 셸
  sm.resize(tw, 80, 24);
  assert.deepEqual(made[0].writes, ['claude\r']);           // launch는 셸에 타이핑
});

test('env=wsl + agent=shell: 명령 타이핑 없이 순수 대화형 bash', () => {
  const { spawn, made } = fakeSpawn();
  const sm = new SessionManager(spawn, () => {}, 'powershell.exe', 'claude');
  const { sessionId } = sm.createSession({ label: 'p', path: 'C:\\p' }, { env: 'wsl' });
  const tid = sm.createTerminal(sessionId)!; // 기본 agent=shell, env=세션 기본(wsl) 상속
  const made1 = made[1];
  assert.equal(made1.file, 'wsl.exe');
  assert.deepEqual(made1.args, ['--cd', 'C:\\p']);
  assert.deepEqual(made1.writes, []);                       // 셸은 launch 안 함
  const term = sm.tree()[0].terminals.find(t => t.id === tid)!;
  assert.equal(term.env, 'wsl');
});

test('winPathToWsl: 드라이브 경로 → /mnt/<letter>/...', () => {
  assert.equal(winPathToWsl('E:\\foo\\bar'), '/mnt/e/foo/bar');
  assert.equal(winPathToWsl('C:\\Users\\x'), '/mnt/c/Users/x');
  assert.equal(winPathToWsl('/already/posix'), '/already/posix');
  assert.equal(winPathToWsl('rel\\path'), 'rel/path');
});

test('buildWslSpawn: distro 지정 시 -d 추가', () => {
  assert.deepEqual(buildWslSpawn('C:\\p'), { file: 'wsl.exe', args: ['--cd', 'C:\\p'] });
  assert.deepEqual(buildWslSpawn('C:\\p', 'Ubuntu-24.04'),
    { file: 'wsl.exe', args: ['-d', 'Ubuntu-24.04', '--cd', 'C:\\p'] });
});

test('env=cmd → cmd.exe, env=gitbash → Git bash.exe (-i -l)', () => {
  const { spawn, made } = fakeSpawn();
  const sm = new SessionManager(spawn, () => {}, 'powershell.exe', 'claude');
  sm.createSession({ label: 'p', path: 'C:\\p' }, { agent: 'shell', env: 'cmd' });
  assert.equal(made[0].file, 'cmd.exe');
  assert.deepEqual(made[0].writes, []);                 // shell → launch 없음
  sm.createSession({ label: 'q', path: 'C:\\q' }, { agent: 'shell', env: 'gitbash' });
  assert.match(made[1].file, /bash\.exe$/i);            // Git Bash 경로(System32 WSL 런처 아님)
  assert.deepEqual(made[1].args, ['-i', '-l']);
});

test('기본값: agent=claude, env=powershell (powershell.exe + claude)', () => {
  const { spawn, made } = fakeSpawn();
  const sm = new SessionManager(spawn, () => {}, 'powershell.exe', 'claude');
  const { terminalId: tp } = sm.createSession({ label: 'p', path: 'C:\\p' });
  assert.equal(made[0].file, 'powershell.exe');
  sm.resize(tp, 80, 24);
  assert.deepEqual(made[0].writes, ['claude\r']);
});

test('런모드(danger): 에이전트별 권한 건너뛰기 플래그 추가', () => {
  const { spawn, made } = fakeSpawn();
  const sm = new SessionManager(spawn, () => {}, 'powershell.exe', 'claude');
  sm.setDanger(true);
  const a = sm.createSession({ label: 'a', path: 'C:\\a' }, { agent: 'claude' });
  const b = sm.createSession({ label: 'b', path: 'C:\\b' }, { agent: 'codex' });
  const c = sm.createSession({ label: 'c', path: 'C:\\c' }, { agent: 'opencode' });
  sm.resize(a.terminalId, 80, 24); sm.resize(b.terminalId, 80, 24); sm.resize(c.terminalId, 80, 24);
  assert.deepEqual(made[0].writes, ['claude --dangerously-skip-permissions\r']);
  assert.deepEqual(made[1].writes, ['codex --dangerously-bypass-approvals-and-sandbox\r']);
  assert.deepEqual(made[2].writes, ['opencode\r']);   // opencode TUI엔 스킵 플래그 없음
});

test('기본 에이전트 설정: setDefaultAgent → createSession이 그 에이전트로 띄움', () => {
  const { spawn, made } = fakeSpawn();
  const sm = new SessionManager(spawn, () => {}, 'powershell.exe', 'claude');
  assert.equal(sm.getDefaultAgent(), 'claude');           // 기본값 claude
  assert.equal(sm.setDefaultAgent('opencode'), 'opencode');
  assert.equal(sm.getDefaultAgent(), 'opencode');
  const { terminalId } = sm.createSession({ label: 'p', path: 'C:\\p' }); // spec 없음 → 기본값 사용
  sm.resize(terminalId, 80, 24);
  assert.deepEqual(made[0].writes, ['opencode\r']);       // 기본 에이전트 opencode 실행
  assert.equal(sm.tree()[0].terminals[0].agent, 'opencode');
});

test('기본 에이전트 설정: 잘못된 값은 무시(기존 유지), spec.agent는 기본값보다 우선', () => {
  const { spawn, made } = fakeSpawn();
  const sm = new SessionManager(spawn, () => {}, 'powershell.exe', 'claude');
  sm.setDefaultAgent('codex');
  assert.equal(sm.setDefaultAgent('bogus'), 'codex');     // 화이트리스트 밖 → 무시
  assert.equal(sm.setDefaultAgent(''), 'codex');          // 빈 값 → 무시
  const { terminalId } = sm.createSession({ label: 'p', path: 'C:\\p' }, { agent: 'claude' }); // 명시 우선
  sm.resize(terminalId, 80, 24);
  assert.deepEqual(made[0].writes, ['claude\r']);
});

test('createTerminal: 없는 세션이면 null', () => {
  const { spawn } = fakeSpawn();
  const sm = new SessionManager(spawn, () => {}, 'powershell.exe', 'claude');
  assert.equal(sm.createTerminal('nope'), null);
});

test('closeTerminal: 셸은 닫히고 claude는 거부', () => {
  const { spawn } = fakeSpawn();
  const sm = new SessionManager(spawn, () => {}, 'powershell.exe', 'claude');
  const { sessionId, terminalId } = sm.createSession({ label: 'p', path: 'C:\\p' });
  const tid = sm.createTerminal(sessionId)!;
  assert.equal(sm.closeTerminal(terminalId), false);    // claude 거부
  assert.equal(sm.closeTerminal(tid), true);            // shell 닫힘
  assert.deepEqual(sm.tree()[0].terminals.map(t => t.id), ['t1']);
});

test('closeSession: 소속 터미널 전부 종료 + 세션 제거', () => {
  const { spawn } = fakeSpawn();
  const msgs: any[] = [];
  const sm = new SessionManager(spawn, m => msgs.push(m), 'powershell.exe', 'claude');
  const { sessionId } = sm.createSession({ label: 'p', path: 'C:\\p' });
  sm.createTerminal(sessionId);
  assert.equal(sm.closeSession(sessionId), true);
  assert.deepEqual(sm.tree(), []);
  assert.ok(msgs.some(m => m.type === 'terminal_exit'));
});

test('마지막 터미널 종료 시 세션도 정리', () => {
  const { spawn, made } = fakeSpawn();
  const sm = new SessionManager(spawn, () => {}, 'powershell.exe', '');
  sm.createSession({ label: 'p', path: 'C:\\p' });
  made[0].exit();
  assert.deepEqual(sm.tree(), []);
});

test('pty 데이터 → terminal_data(sessionId=terminalId) + 버퍼 누적', () => {
  const { spawn, made } = fakeSpawn();
  const msgs: any[] = [];
  const sm = new SessionManager(spawn, m => msgs.push(m), 'powershell.exe', '');
  const { terminalId } = sm.createSession({ label: 'p', path: 'C:\\p' });
  made[0].emit('hello');
  assert.ok(msgs.some(m => m.type === 'terminal_data' && m.sessionId === terminalId && m.data === 'hello'));
});

test('resyncTo: 평면 목록 + 누적 버퍼 리플레이', () => {
  const { spawn, made } = fakeSpawn();
  const sm = new SessionManager(spawn, () => {}, 'powershell.exe', '');
  const { terminalId } = sm.createSession({ label: 'p', path: 'C:\\p' });
  made[0].emit('abc');
  const sent: any[] = [];
  sm.resyncTo(m => sent.push(m));
  assert.ok(sent.some(m => m.type === 'session_list'));
  assert.ok(sent.some(m => m.type === 'terminal_data' && m.sessionId === terminalId && m.data === 'abc'));
});

test('replayTo: 특정 터미널 버퍼만 전송', () => {
  const { spawn, made } = fakeSpawn();
  const sm = new SessionManager(spawn, () => {}, 'powershell.exe', '');
  const { terminalId } = sm.createSession({ label: 'p', path: 'C:\\p' });
  made[0].emit('xyz');
  const sent: any[] = [];
  sm.replayTo(terminalId, m => sent.push(m));
  assert.deepEqual(sent, [{ type: 'terminal_data', sessionId: terminalId, data: 'xyz' }]);
});

test('write는 해당 터미널 pty로 전달', () => {
  const { spawn, made } = fakeSpawn();
  const sm = new SessionManager(spawn, () => {}, 'powershell.exe', '');
  const { terminalId } = sm.createSession({ label: 'p', path: 'C:\\p' });
  made[0].writes.length = 0;
  sm.write(terminalId, 'ls\r');
  assert.deepEqual(made[0].writes, ['ls\r']);
});

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

test('완료 알림: 긴 작업 버스트 후 조용해지면 알림(세션 라벨 포함)', async () => {
  const { spawn, made } = fakeSpawn();
  const msgs: any[] = [];
  const sm = new SessionManager(spawn, m => msgs.push(m), 'powershell.exe', 'claude', { notifyQuietMs: 30, notifyMinBusyMs: 60 });
  const { terminalId } = sm.createSession({ label: 'projA', path: 'C:\\a' });
  // 스피너처럼 한동안 계속 출력(=작업 중)
  const start = Date.now();
  while (Date.now() - start < 130) { made[0].emit('.'); await delay(10); }
  await delay(60); // 조용 → idle 판정
  const n = msgs.find(m => m.type === 'notify');
  assert.ok(n, '긴 작업 후 알림이 와야 함');
  assert.equal(n.sessionId, terminalId);
  assert.equal(n.label, 'projA');
});

test('완료 알림: 짧은 응답(짧은 버스트)은 알림 안 함', async () => {
  const { spawn, made } = fakeSpawn();
  const msgs: any[] = [];
  const sm = new SessionManager(spawn, m => msgs.push(m), 'powershell.exe', 'claude', { notifyQuietMs: 30, notifyMinBusyMs: 300 });
  sm.createSession({ label: 'p', path: 'C:\\p' });
  made[0].emit('ok');            // 짧게 한 번
  await delay(70);               // 조용 → idle, busy<300ms
  assert.equal(msgs.filter(m => m.type === 'notify').length, 0);
});

test('완료 알림: 셸 터미널은 길게 출력해도 알림 안 함', async () => {
  const { spawn, made } = fakeSpawn();
  const msgs: any[] = [];
  const sm = new SessionManager(spawn, m => msgs.push(m), 'powershell.exe', 'claude', { notifyQuietMs: 30, notifyMinBusyMs: 60 });
  const { sessionId } = sm.createSession({ label: 'p', path: 'C:\\p' });
  sm.createTerminal(sessionId);  // shell (made[1])
  const start = Date.now();
  while (Date.now() - start < 130) { made[1].emit('building...'); await delay(10); }
  await delay(60);
  assert.equal(msgs.filter(m => m.type === 'notify').length, 0); // 셸은 대상 아님
});
