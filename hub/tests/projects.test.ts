import { test } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ProjectStore } from '../src/projects';

function tmpFile(): string {
  return path.join(os.tmpdir(), `mtb-proj-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
}

test('파일이 없으면 빈 목록', () => {
  const store = new ProjectStore(tmpFile());
  assert.deepEqual(store.list(), []);
});

test('add 하면 저장되고 list로 다시 읽힌다', () => {
  const f = tmpFile();
  const store = new ProjectStore(f);
  store.add({ label: 'projA', path: 'C:\\a' });
  assert.deepEqual(store.list(), [{ label: 'projA', path: 'C:\\a' }]);
  fs.unlinkSync(f);
});

test('같은 path는 중복되지 않고 최신 label로 갱신', () => {
  const f = tmpFile();
  const store = new ProjectStore(f);
  store.add({ label: 'old', path: 'C:\\a' });
  store.add({ label: 'new', path: 'C:\\a' });
  assert.deepEqual(store.list(), [{ label: 'new', path: 'C:\\a' }]);
  fs.unlinkSync(f);
});

test('깨진 JSON이면 빈 목록', () => {
  const f = tmpFile();
  fs.writeFileSync(f, '{not json');
  const store = new ProjectStore(f);
  assert.deepEqual(store.list(), []);
  fs.unlinkSync(f);
});
