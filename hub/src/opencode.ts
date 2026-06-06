// opencode CLI 트랜스크립트 리더.
//
// opencode(v1.16+)는 대화를 SQLite DB 한 곳에 저장한다:
//   ~/.local/share/opencode/opencode.db   (Windows 도 같은 경로)
// 관련 테이블:
//   session(id, directory, agent, title, time_created, …)  — 프로젝트 cwd = directory
//   message(id, session_id, time_created, data)            — data: {role, …}
//   part(id, message_id, session_id, time_created, data)   — data: {type:'text'|'reasoning'|'tool'|…}
// 한 메시지는 여러 part 로 쪼개져 있고, 실제 텍스트/도구 호출은 part.data 에 들어있다.
//
// node:sqlite 는 Node 22.5+ 의 (실험적) 내장 모듈이라 외부 의존성 없이 읽을 수 있다.
// 없으면(구버전 Node) supported:false 로 떨어져 폰에서 폴백 메시지를 띄운다.
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import type { ChatEvent, FileChange } from './transcript';

const MAX_TEXT = 4000;
const MAX_DIFF = 8000;

function clip(s: unknown, n: number): string {
  if (typeof s !== 'string') return '';
  return s.length > n ? s.slice(0, n) + '\n…(잘림)' : s;
}

export function opencodeDbPath(): string {
  return path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');
}

// node:sqlite 동기 DatabaseSync. 없으면 null.
function openDb(file: string): any {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sqlite = require('node:sqlite');
    return new sqlite.DatabaseSync(file, { readOnly: true });
  } catch {
    return null;
  }
}

// cwd 와 directory 가 일치하는 가장 최근 session id. 없으면 null.
// 경로 비교는 슬래시 정규화 + 소문자(윈도) 기준.
function normPath(p: string): string {
  return path.resolve(p).replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
}

export interface OpencodeResult { events: ChatEvent[]; changes: FileChange[]; supported: boolean; }

export function loadOpencode(cwd: string): OpencodeResult {
  const file = opencodeDbPath();
  if (!fs.existsSync(file)) return { events: [], changes: [], supported: false };
  const db = openDb(file);
  if (!db) return { events: [], changes: [], supported: false };
  try {
    const wanted = normPath(cwd);
    const sessions = db.prepare('SELECT id, directory, time_created FROM session').all() as any[];
    let sid: string | null = null;
    let best = -1;
    for (const s of sessions) {
      if (typeof s.directory !== 'string') continue;
      if (normPath(s.directory) !== wanted) continue;
      const t = Number(s.time_created) || 0;
      if (t >= best) { best = t; sid = String(s.id); }
    }
    if (!sid) return { events: [], changes: [], supported: true }; // DB 는 읽혔지만 이 cwd 세션 없음

    // 메시지 순서(time_created) → 각 메시지의 part(time_created) 순서로 펼친다.
    const parts = db.prepare(
      'SELECT p.data AS data, m.time_created AS mtime, p.time_created AS ptime, m.data AS mdata ' +
      'FROM part p JOIN message m ON p.message_id = m.id ' +
      'WHERE p.session_id = ? ORDER BY m.time_created, p.time_created'
    ).all(sid) as any[];

    const { events, changes } = parseOpencodeRows(parts.map(r => ({ data: r.data, mdata: r.mdata })));
    return { events, changes, supported: true };
  } catch {
    return { events: [], changes: [], supported: false };
  } finally {
    try { db.close(); } catch { /* */ }
  }
}

// 메시지 순서대로 펼쳐진 part 행들을 ChatEvent/FileChange 로 변환한다(순수 함수, 테스트용).
//  row.data  : part.data  JSON 문자열 ({type:'text'|'reasoning'|'tool'|…})
//  row.mdata : message.data JSON 문자열 ({role:'user'|'assistant'})
export function parseOpencodeRows(rows: { data: string; mdata?: string | null }[]): { events: ChatEvent[]; changes: FileChange[] } {
  const events: ChatEvent[] = [];
  const changes: FileChange[] = [];
  for (const row of rows) {
    let d: any, md: any;
    try { d = JSON.parse(row.data); } catch { continue; }
    try { md = row.mdata ? JSON.parse(row.mdata) : {}; } catch { md = {}; }
    const role = md.role; // 'user' | 'assistant'
    const type = d.type;
    if (type === 'text') {
      const text = clip(d.text, MAX_TEXT);
      if (text) events.push({ kind: role === 'user' ? 'user' : 'assistant', text });
    } else if (type === 'reasoning') {
      const text = clip(d.text, 400);
      if (text) events.push({ kind: 'thinking', text });
    } else if (type === 'tool') {
      const name = String(d.tool || 'tool');
      const state = d.state || {};
      const input = state.input || {};
      const fc = extractFileChange(name, input);
      events.push({ kind: 'tool', tool: name, file: fc?.file ?? (typeof input.filePath === 'string' ? input.filePath : undefined) });
      if (fc) changes.push(fc);
      const out = state.output;
      if (typeof out === 'string' && out) {
        events.push({ kind: 'tool_result', text: clip(out, 600), isError: state.status === 'error' });
      }
    }
  }
  return { events, changes };
}

// opencode 도구 input 에서 파일 변경 정보를 뽑는다.
//  edit:  { filePath, oldString, newString }
//  write: { filePath, content }
//  patch: { filePath?, patch } (방어적)
function extractFileChange(tool: string, input: any): FileChange | null {
  if (!input || typeof input !== 'object') return null;
  const file = typeof input.filePath === 'string' ? input.filePath
    : typeof input.path === 'string' ? input.path : undefined;
  if (!file) return null;
  if (typeof input.content === 'string' && (tool === 'write' || input.oldString === undefined)) {
    return { file, kind: 'write', content: clip(input.content, MAX_DIFF) };
  }
  if (typeof input.oldString === 'string' && typeof input.newString === 'string') {
    return { file, kind: 'edit', edits: [{ old: clip(input.oldString, MAX_DIFF), new: clip(input.newString, MAX_DIFF) }] };
  }
  if (typeof input.patch === 'string') {
    return { file, kind: 'write', content: clip(input.patch, MAX_DIFF) };
  }
  return null;
}
