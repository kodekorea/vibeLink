import { test } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { drives, listEntries, readFileText } from '../src/fsbrowse';

function tmpDir(): string {
  const d = path.join(os.tmpdir(), `mtb-fs-${process.pid}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

test('listEntries: 디렉터리 먼저, 그다음 파일, 이름순 + size', () => {
  const d = tmpDir();
  fs.mkdirSync(path.join(d, 'zsub'));
  fs.writeFileSync(path.join(d, 'a.txt'), 'hi');
  fs.writeFileSync(path.join(d, 'b.txt'), 'hello');
  const e = listEntries(d);
  assert.equal(e[0].name, 'zsub'); assert.equal(e[0].dir, true);
  assert.equal(e[1].name, 'a.txt'); assert.equal(e[1].dir, false); assert.equal(e[1].size, 2);
  assert.equal(e[2].name, 'b.txt');
  fs.rmSync(d, { recursive: true, force: true });
});

test('drives: 현재 OS에서 시작 폴더 목록을 반환', () => {
  const roots = drives();
  assert.ok(roots.length > 0);
  assert.ok(roots.every(e => e.name && e.path));
  if (process.platform !== 'win32') {
    assert.ok(roots.some(e => e.path === os.homedir()));
  }
});

test('readFileText: 내용 + size 반환', () => {
  const d = tmpDir();
  const f = path.join(d, 'x.txt');
  fs.writeFileSync(f, 'abcdef');
  const r = readFileText(f);
  assert.equal(r.content, 'abcdef'); assert.equal(r.size, 6); assert.equal(r.truncated, false);
  fs.rmSync(d, { recursive: true, force: true });
});

test('readFileText: maxBytes 초과면 truncated', () => {
  const d = tmpDir();
  const f = path.join(d, 'big.txt');
  fs.writeFileSync(f, 'x'.repeat(1000));
  const r = readFileText(f, 100);
  assert.equal(r.content.length, 100); assert.equal(r.truncated, true); assert.equal(r.size, 1000);
  fs.rmSync(d, { recursive: true, force: true });
});
