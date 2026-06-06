import { test } from 'node:test';
import assert from 'node:assert';
import { parseTranscript, projectDir } from '../src/transcript';
import { parseCodexTranscript } from '../src/codex';
import { parseOpencodeRows } from '../src/opencode';

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

test('parseCodexTranscript: 메시지·합성 컨텍스트 필터·apply_patch 변경', () => {
  const lines = [
    JSON.stringify({ type: 'session_meta', payload: { id: 'x', cwd: 'E:\\proj' } }),
    JSON.stringify({ type: 'event_msg', payload: { type: 'task_started' } }),
    // developer/system 지시 → 무시
    JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'rules' }] } }),
    // 환경 컨텍스트(합성 user) → 무시
    JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>\n<cwd>E:\\proj</cwd>\n</environment_context>' }] } }),
    // 실제 사용자 질문
    JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '안녕' }] } }),
    // 어시스턴트 답변
    JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '반가워요' }] } }),
    // 도구 호출(apply_patch) + 결과
    JSON.stringify({ type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: JSON.stringify({ command: ['apply_patch', '*** Begin Patch\n*** Update File: a.ts\n@@\n-x\n+y\n*** End Patch'] }) } }),
    JSON.stringify({ type: 'response_item', payload: { type: 'function_call_output', output: 'done' } }),
    // event_msg 들은 무시(response_item 만 사용)
    JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', message: '반가워요' } }),
  ].join('\n');

  const { events, changes } = parseCodexTranscript(lines);
  assert.deepEqual(events.map(e => e.kind), ['user', 'assistant', 'tool', 'tool_result']);
  assert.equal(events[0].text, '안녕');
  assert.equal(events[1].text, '반가워요');
  assert.equal(events[2].tool, 'shell');
  assert.equal(events[2].file, 'a.ts');
  assert.equal(events[3].text, 'done');

  assert.equal(changes.length, 1);
  assert.equal(changes[0].file, 'a.ts');
  assert.equal(changes[0].kind, 'write');
});

test('parseCodexTranscript: 명시적 file_path edit 인자', () => {
  const lines = [
    JSON.stringify({ type: 'response_item', payload: { type: 'function_call', name: 'edit', arguments: JSON.stringify({ file_path: 'b.ts', old_string: 'a', new_string: 'b' }) } }),
  ].join('\n');
  const { changes } = parseCodexTranscript(lines);
  assert.deepEqual(changes[0], { file: 'b.ts', kind: 'edit', edits: [{ old: 'a', new: 'b' }] });
});

test('parseOpencodeRows: text/reasoning/tool part → 이벤트·변경', () => {
  const rows = [
    { data: JSON.stringify({ type: 'text', text: '안녕' }), mdata: JSON.stringify({ role: 'user' }) },
    { data: JSON.stringify({ type: 'step-start' }), mdata: JSON.stringify({ role: 'assistant' }) },
    { data: JSON.stringify({ type: 'reasoning', text: '생각중' }), mdata: JSON.stringify({ role: 'assistant' }) },
    { data: JSON.stringify({ type: 'text', text: '해결!' }), mdata: JSON.stringify({ role: 'assistant' }) },
    { data: JSON.stringify({ type: 'tool', tool: 'edit', state: { status: 'completed', input: { filePath: 'a.ts', oldString: 'x', newString: 'y' }, output: 'ok' } }), mdata: JSON.stringify({ role: 'assistant' }) },
    { data: JSON.stringify({ type: 'tool', tool: 'write', state: { status: 'completed', input: { filePath: 'b.ts', content: 'hello' } } }), mdata: JSON.stringify({ role: 'assistant' }) },
  ];
  const { events, changes } = parseOpencodeRows(rows);
  assert.deepEqual(events.map(e => e.kind), ['user', 'thinking', 'assistant', 'tool', 'tool_result', 'tool']);
  assert.equal(events[0].text, '안녕');
  assert.equal(events[3].tool, 'edit');
  assert.equal(events[3].file, 'a.ts');
  assert.equal(events[4].text, 'ok');

  assert.equal(changes.length, 2);
  assert.deepEqual(changes[0], { file: 'a.ts', kind: 'edit', edits: [{ old: 'x', new: 'y' }] });
  assert.deepEqual(changes[1], { file: 'b.ts', kind: 'write', content: 'hello' });
});

test('parseOpencodeRows: 깨진 data 무시', () => {
  const rows = [{ data: 'not json', mdata: null }, { data: JSON.stringify({ type: 'text', text: 'ok' }), mdata: JSON.stringify({ role: 'user' }) }];
  const { events } = parseOpencodeRows(rows);
  assert.deepEqual(events.map(e => e.kind), ['user']);
});
