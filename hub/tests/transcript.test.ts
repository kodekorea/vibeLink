import { test } from 'node:test';
import assert from 'node:assert';
import { parseTranscript, projectDir } from '../src/transcript';

test('projectDir: 비영숫자 → 하이픈 인코딩', () => {
  const d = projectDir('E:\\mobile_term_bridge_distrib');
  assert.ok(d.endsWith('E--mobile-term-bridge-distrib'), d);
});

test('parseTranscript: 이벤트 순서 + 변경 추출', () => {
  const lines = [
    JSON.stringify({ type: 'user', message: { role: 'user', content: '안녕' } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [
      { type: 'thinking', thinking: '생각' },
      { type: 'text', text: '할게요' },
      { type: 'tool_use', name: 'Edit', input: { file_path: 'a.ts', old_string: 'x', new_string: 'y' } },
    ] } }),
    JSON.stringify({ type: 'user', message: { role: 'user', content: [
      { type: 'tool_result', content: 'ok', is_error: false, tool_use_id: '1' },
    ] } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [
      { type: 'tool_use', name: 'Write', input: { file_path: 'b.ts', content: 'hello' } },
    ] } }),
  ].join('\n');

  const { events, changes } = parseTranscript(lines);
  assert.deepEqual(events.map(e => e.kind), ['user', 'thinking', 'assistant', 'tool', 'tool_result', 'tool']);
  assert.equal(events[0].text, '안녕');
  assert.equal(events[3].tool, 'Edit');
  assert.equal(events[3].file, 'a.ts');

  assert.equal(changes.length, 2);
  assert.deepEqual(changes[0], { file: 'a.ts', kind: 'edit', edits: [{ old: 'x', new: 'y' }] });
  assert.deepEqual(changes[1], { file: 'b.ts', kind: 'write', content: 'hello' });
});

test('parseTranscript: 깨진 줄·기타 타입 무시', () => {
  const lines = ['not json', JSON.stringify({ type: 'file-history-snapshot' }), ''].join('\n');
  const { events, changes } = parseTranscript(lines);
  assert.deepEqual(events, []);
  assert.deepEqual(changes, []);
});
