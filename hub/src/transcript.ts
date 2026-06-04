import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface ChatEvent {
  kind: 'user' | 'assistant' | 'thinking' | 'tool' | 'tool_result';
  text?: string;
  tool?: string;
  file?: string;
  isError?: boolean;
}

export interface FileChange {
  file: string;
  kind: 'edit' | 'write' | 'multiedit';
  edits?: { old: string; new: string }[];
  content?: string;
}

const MAX_TEXT = 4000;
const MAX_DIFF = 8000;

function clip(s: unknown, n: number): string {
  if (typeof s !== 'string') return '';
  return s.length > n ? s.slice(0, n) + '\n…(잘림)' : s;
}

// cwd → ~/.claude/projects/<encoded> 디렉터리 (비영숫자 → '-')
export function projectDir(cwd: string): string {
  const enc = cwd.replace(/[^a-zA-Z0-9]/g, '-');
  return path.join(os.homedir(), '.claude', 'projects', enc);
}

// 그 프로젝트의 가장 최근(mtime) 세션 트랜스크립트 경로. 없으면 null.
export function findLatestTranscript(cwd: string): string | null {
  const dir = projectDir(cwd);
  let files: string[];
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')); } catch { return null; }
  let best = '';
  let bestM = -1;
  for (const f of files) {
    const full = path.join(dir, f);
    try { const m = fs.statSync(full).mtimeMs; if (m > bestM) { bestM = m; best = full; } } catch { /* */ }
  }
  return best || null;
}

export function parseTranscript(text: string): { events: ChatEvent[]; changes: FileChange[] } {
  const events: ChatEvent[] = [];
  const changes: FileChange[] = [];
  for (const line of text.split('\n')) {
    const l = line.trim();
    if (!l) continue;
    let o: any;
    try { o = JSON.parse(l); } catch { continue; }
    const t = o.type;
    if (t !== 'user' && t !== 'assistant') continue;
    const content = o.message?.content;
    if (typeof content === 'string') {
      if (t === 'user') events.push({ kind: 'user', text: clip(content, MAX_TEXT) });
      continue;
    }
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (!b || typeof b !== 'object') continue;
      if (b.type === 'text' && b.text) {
        events.push({ kind: t === 'user' ? 'user' : 'assistant', text: clip(b.text, MAX_TEXT) });
      } else if (b.type === 'thinking' && b.thinking) {
        events.push({ kind: 'thinking', text: clip(b.thinking, 400) });
      } else if (b.type === 'tool_use') {
        const name = String(b.name || 'tool');
        const input = b.input || {};
        events.push({ kind: 'tool', tool: name, file: input.file_path });
        if (name === 'Edit') {
          changes.push({ file: input.file_path, kind: 'edit', edits: [{ old: clip(input.old_string, MAX_DIFF), new: clip(input.new_string, MAX_DIFF) }] });
        } else if (name === 'Write') {
          changes.push({ file: input.file_path, kind: 'write', content: clip(input.content, MAX_DIFF) });
        } else if (name === 'MultiEdit') {
          const eds = Array.isArray(input.edits) ? input.edits.map((e: any) => ({ old: clip(e.old_string, MAX_DIFF), new: clip(e.new_string, MAX_DIFF) })) : [];
          changes.push({ file: input.file_path, kind: 'multiedit', edits: eds });
        }
      } else if (b.type === 'tool_result') {
        events.push({ kind: 'tool_result', text: clip(b.content, 600), isError: !!b.is_error });
      }
    }
  }
  return { events, changes };
}
