// OpenAI Codex CLI 트랜스크립트 파서.
//
// Codex 는 세션마다 rollout JSONL 파일을 남긴다:
//   ~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-<ISO>-<uuid>.jsonl
// 각 줄은 { timestamp, type, payload } 형태이고 우리가 보는 타입은:
//   - session_meta            : 첫 줄, payload.cwd 로 어느 프로젝트인지 식별
//   - response_item / message : role(user|assistant|developer) + content[]
//   - response_item / function_call · function_call_output : 도구 호출/결과
//   - event_msg / *           : task_started, user_message, agent_message, token_count …
//
// 우리는 OpenAI Responses 스키마(response_item)를 기준으로 대화를 복원한다.
// developer 롤(시스템 지시)·환경 컨텍스트 같은 합성 메시지는 건너뛴다.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ChatEvent, FileChange } from './transcript';

const MAX_TEXT = 4000;
const MAX_DIFF = 8000;

function clip(s: unknown, n: number): string {
  if (typeof s !== 'string') return '';
  return s.length > n ? s.slice(0, n) + '\n…(잘림)' : s;
}

// content 배열에서 텍스트만 이어붙인다. ({type:'input_text'|'output_text'|'text', text})
function joinText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const b of content) {
    if (b && typeof b === 'object' && typeof (b as any).text === 'string') parts.push((b as any).text);
  }
  return parts.join('');
}

// codex 가 user 롤에 끼워넣는 합성 메시지(환경/권한/지시 컨텍스트)인지.
// 이런 메시지는 <environment_context>, <user_instructions>, <permissions instructions>
// 같은 XML 스타일 태그로 시작한다.
function isSyntheticUser(text: string): boolean {
  return /^<(environment_context|user_instructions|permissions instructions|user_message|instructions)\b/.test(text.trimStart());
}

// codex 세션 디렉터리(연/월/일 트리) 전체에서 cwd 가 일치하는 가장 최근 rollout 경로.
export function findLatestCodexTranscript(cwd: string): string | null {
  const root = path.join(os.homedir(), '.codex', 'sessions');
  const wanted = path.resolve(cwd).toLowerCase();
  let files: string[] = [];
  try { files = walkJsonl(root); } catch { return null; }
  let best = '';
  let bestM = -1;
  for (const f of files) {
    let sessionCwd: string | null = null;
    let mtime = -1;
    try { mtime = fs.statSync(f).mtimeMs; } catch { continue; }
    if (mtime <= bestM) continue; // 이미 더 최신 후보가 있으면 cwd 읽기도 생략
    try {
      const firstLine = readFirstLine(f);
      const o = JSON.parse(firstLine);
      if (o && o.type === 'session_meta' && o.payload && typeof o.payload.cwd === 'string') {
        sessionCwd = path.resolve(o.payload.cwd).toLowerCase();
      }
    } catch { /* */ }
    if (sessionCwd === wanted) { bestM = mtime; best = f; }
  }
  return best || null;
}

function walkJsonl(dir: string): string[] {
  const out: string[] = [];
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkJsonl(full));
    else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(full);
  }
  return out;
}

function readFirstLine(file: string): string {
  // session_meta 한 줄만 필요 → 앞부분만 읽어 큰 파일 전체 로드를 피한다.
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(1 << 16);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const s = buf.toString('utf8', 0, n);
    const nl = s.indexOf('\n');
    return nl >= 0 ? s.slice(0, nl) : s;
  } finally { fs.closeSync(fd); }
}

export function parseCodexTranscript(text: string): { events: ChatEvent[]; changes: FileChange[] } {
  const events: ChatEvent[] = [];
  const changes: FileChange[] = [];
  for (const line of text.split('\n')) {
    const l = line.trim();
    if (!l) continue;
    let o: any;
    try { o = JSON.parse(l); } catch { continue; }
    if (o.type !== 'response_item') continue;
    const p = o.payload;
    if (!p || typeof p !== 'object') continue;

    if (p.type === 'message') {
      const role = p.role;
      if (role === 'developer' || role === 'system') continue; // 시스템 지시
      const text = clip(joinText(p.content), MAX_TEXT);
      if (!text) continue;
      if (role === 'user') {
        if (isSyntheticUser(text)) continue; // 환경/권한 컨텍스트
        events.push({ kind: 'user', text });
      } else if (role === 'assistant') {
        events.push({ kind: 'assistant', text });
      }
    } else if (p.type === 'reasoning') {
      const text = clip(joinText(p.summary ?? p.content), 400);
      if (text) events.push({ kind: 'thinking', text });
    } else if (p.type === 'function_call' || p.type === 'local_shell_call' || p.type === 'custom_tool_call') {
      const name = String(p.name || p.tool_name || 'tool');
      let args: any = {};
      try { args = typeof p.arguments === 'string' ? JSON.parse(p.arguments) : (p.arguments || p.input || {}); } catch { /* */ }
      const fc = extractFileChange(name, args);
      events.push({ kind: 'tool', tool: name, file: fc?.file });
      if (fc) changes.push(fc);
    } else if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') {
      const out = typeof p.output === 'string' ? p.output : joinText(p.output);
      events.push({ kind: 'tool_result', text: clip(out, 600), isError: false });
    }
  }
  return { events, changes };
}

// codex 의 파일 수정 도구 호출에서 변경 정보를 뽑는다.
// codex 는 주로 apply_patch(shell) 로 패치를 적용한다 — `*** Update File` 등의 헤더가 있는 patch 문자열.
function extractFileChange(name: string, args: any): FileChange | null {
  // apply_patch 계열: { input: "*** Begin Patch ... *** End Patch" } 또는 shell command 안에 patch.
  const patch: string | undefined =
    typeof args.input === 'string' ? args.input :
    typeof args.patch === 'string' ? args.patch :
    Array.isArray(args.command) ? args.command.join(' ') : undefined;
  if (/apply_patch/i.test(name) || (patch && /\*\*\*\s+(Begin Patch|Update File|Add File)/.test(patch))) {
    if (patch) {
      const m = patch.match(/\*\*\*\s+(?:Update File|Add File):\s*(.+)/);
      const file = m ? m[1].trim() : '(patch)';
      return { file, kind: 'write', content: clip(patch, MAX_DIFF) };
    }
  }
  // 명시적 edit/write 인자 형태도 방어적으로 지원.
  if (typeof args.file_path === 'string' || typeof args.path === 'string') {
    const file = String(args.file_path ?? args.path);
    if (typeof args.content === 'string') return { file, kind: 'write', content: clip(args.content, MAX_DIFF) };
    if (typeof args.old_string === 'string' && typeof args.new_string === 'string') {
      return { file, kind: 'edit', edits: [{ old: clip(args.old_string, MAX_DIFF), new: clip(args.new_string, MAX_DIFF) }] };
    }
  }
  return null;
}
