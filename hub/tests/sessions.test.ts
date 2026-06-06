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
  sm.createSession({ label: 'p', path: 'C:\\p' }, { agent: 'opencode', env: 'wsl' });
  assert.equal(made[0].file, 'wsl.exe');          // env=wsl → wsl.exe
  assert.deepEqual(made[0].writes, ['opencode\r']); // agent=opencode → opencode 실행
  const term = sm.tree()[0].terminals[0];
  assert.equal(term.agent, 'opencode');
  assert.equal(term.env, 'wsl');
  assert.equal(term.kind, 'agent');
});

test('env=wsl: wsl.exe --cd <세션경로>로 spawn + 셸에 claude 타이핑', () => {
  const { spawn, made } = fakeSpawn();
  const sm = new SessionManager(spawn, () => {}, 'powershell.exe', 'claude');
  sm.createSession({ label: 'p', path: 'E:\\foo\\bar' }, { env: 'wsl' });
  assert.equal(made[0].file, 'wsl.exe');
  assert.deepEqual(made[0].args, ['--cd', 'E:\\foo\\bar']); // 세션 폴더에서 대화형 셸
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

test('기본값: agent=claude, env=powershell (powershell.exe + claude)', () => {
  const { spawn, made } = fakeSpawn();
  const sm = new SessionManager(spawn, () => {}, 'powershell.exe', 'claude');
  sm.createSession({ label: 'p', path: 'C:\\p' });
  assert.equal(made[0].file, 'powershell.exe');
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

test('터미널 벨(\\x07) → notify(세션 라벨 포함)', () => {
  const { spawn, made } = fakeSpawn();
  const msgs: any[] = [];
  const sm = new SessionManager(spawn, m => msgs.push(m), 'powershell.exe', '');
  const { terminalId } = sm.createSession({ label: 'projA', path: 'C:\\a' });
  made[0].emit('done\x07');
  const n = msgs.find(m => m.type === 'notify');
  assert.ok(n, 'notify가 방송돼야 함');
  assert.equal(n.sessionId, terminalId);
  assert.equal(n.label, 'projA');
});

test('notify는 디바운스 윈도 내 중복 방송 안 함', () => {
  const { spawn, made } = fakeSpawn();
  const msgs: any[] = [];
  const sm = new SessionManager(spawn, m => msgs.push(m), 'powershell.exe', '');
  sm.createSession({ label: 'p', path: 'C:\\p' });
  made[0].emit('\x07'); made[0].emit('\x07');
  assert.equal(msgs.filter(m => m.type === 'notify').length, 1);
});
