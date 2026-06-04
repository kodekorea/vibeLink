import * as fs from 'fs';
import * as path from 'path';

export interface Entry { name: string; path: string; }

// 폴더 안의 하위 디렉터리만 (정렬)
export function browseDir(p: string): Entry[] {
  return fs.readdirSync(p, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => ({ name: d.name, path: path.join(p, d.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Windows 드라이브 루트 목록
export function drives(): Entry[] {
  const out: Entry[] = [];
  for (const c of 'CDEFGHIJ') {
    const root = `${c}:\\`;
    try { fs.accessSync(root); out.push({ name: root, path: root }); } catch { /* 없음 */ }
  }
  return out;
}
