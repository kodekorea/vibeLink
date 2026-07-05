import { test } from 'node:test';
import assert from 'node:assert';
import * as path from 'path';
import { existingWindowsExe, normalizeProcessEnv, pathEntries } from '../src/env';

test('normalizeProcessEnv: 빈 환경에서도 기본 PATH를 만든다', () => {
  const env = normalizeProcessEnv({});
  const entries = pathEntries(env);
  assert.ok(entries.length > 0);
  if (process.platform === 'win32') {
    assert.ok(entries.some(p => /\\System32$/i.test(p)));
    assert.equal(path.basename(existingWindowsExe('powershell.exe', env)).toLowerCase(), 'powershell.exe');
    assert.equal(path.basename(existingWindowsExe('cmd.exe', env)).toLowerCase(), 'cmd.exe');
  } else {
    assert.ok(entries.includes('/usr/bin') || entries.includes('/bin'));
  }
});
