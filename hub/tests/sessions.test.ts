import { test } from 'node:test';
import assert from 'node:assert';
import { SessionManager } from '../src/sessions';
import type { IPty } from '../src/nodePty';

function fakePty() {
  let dataCb: (d: string) => void = () => {};
  let exitCb: (e: { exitCode: number }) => void = () => {};
  const writes: string[] = [];
  const pty: IPty = {
    pid: 123,
    onData(cb) { dataCb = cb; },
    onExit(cb) { exitCb = cb; },
    write(d) { writes.push(d); },
    resize() { /* noop */ },
    kill() { exitCb({ exitCode: 0 }); },
  };
  return { pty, writes, emit: (d: string) => dataCb(d), exit: () => exitCb({ exitCode: 0 }) };
}

test('create: pty 생성 + launch 명령 입력 + 목록 등록 + session_list 방송', () => {
  const f = fakePty();
  const msgs: any[] = [];
  const sm = new SessionManager(() => f.pty, m => msgs.push(m), 'powershell.exe', 'claude');
  const id = sm.create({ label: 'projA', path: 'C:\\a' });
  assert.equal(id, '1');
  assert.deepEqual(f.writes, ['claude\r']);
  assert.deepEqual(sm.list(), [{ id: '1', label: 'projA' }]);
  assert.ok(msgs.some(m => m.type === 'session_list'));
});

test('pty 데이터 → terminal_data 방송 + 버퍼 누적', () => {
  const f = fakePty();
  const msgs: any[] = [];
  const sm = new SessionManager(() => f.pty, m => msgs.push(m), 'powershell.exe', '');
  const id = sm.create({ label: 'p', path: 'C:\\p' });
  f.emit('hello');
  assert.ok(msgs.some(m => m.type === 'terminal_data' && m.sessionId === id && m.data === 'hello'));
});

test('resyncTo: 목록 + 누적 버퍼 리플레이', () => {
  const f = fakePty();
  const sm = new SessionManager(() => f.pty, () => {}, 'powershell.exe', '');
  const id = sm.create({ label: 'p', path: 'C:\\p' });
  f.emit('abc');
  const sent: any[] = [];
  sm.resyncTo(m => sent.push(m));
  assert.ok(sent.some(m => m.type === 'session_list'));
  assert.ok(sent.some(m => m.type === 'terminal_data' && m.sessionId === id && m.data === 'abc'));
});

test('replayTo: 특정 세션 버퍼만 전송', () => {
  const f = fakePty();
  const sm = new SessionManager(() => f.pty, () => {}, 'powershell.exe', '');
  const id = sm.create({ label: 'p', path: 'C:\\p' });
  f.emit('xyz');
  const sent: any[] = [];
  sm.replayTo(id, m => sent.push(m));
  assert.deepEqual(sent, [{ type: 'terminal_data', sessionId: id, data: 'xyz' }]);
});

test('close → pty.kill → onExit → terminal_exit + 목록에서 제거', () => {
  const f = fakePty();
  const msgs: any[] = [];
  const sm = new SessionManager(() => f.pty, m => msgs.push(m), 'powershell.exe', '');
  const id = sm.create({ label: 'p', path: 'C:\\p' });
  assert.equal(sm.close(id), true);
  assert.ok(msgs.some(m => m.type === 'terminal_exit' && m.sessionId === id));
  assert.deepEqual(sm.list(), []);
});

test('write는 해당 세션 pty로 전달', () => {
  const f = fakePty();
  const sm = new SessionManager(() => f.pty, () => {}, 'powershell.exe', '');
  const id = sm.create({ label: 'p', path: 'C:\\p' });
  f.writes.length = 0;
  sm.write(id, 'ls\r');
  assert.deepEqual(f.writes, ['ls\r']);
});
