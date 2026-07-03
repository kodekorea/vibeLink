import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface Entry { name: string; path: string; }

// 폴더 안의 하위 디렉터리만 (정렬)
export function browseDir(p: string): Entry[] {
  return fs.readdirSync(p, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => ({ name: d.name, path: path.join(p, d.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function existingDirs(entries: Entry[]): Entry[] {
  const seen = new Set<string>();
  const out: Entry[] = [];
  for (const e of entries) {
    try {
      if (!fs.statSync(e.path).isDirectory()) continue;
      const key = path.resolve(e.path);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(e);
    } catch { /* 없음/권한 없음 */ }
  }
  return out;
}

// 파일 브라우저 시작 지점. Windows는 드라이브, macOS/Linux는 자주 쓰는 POSIX 루트.
export function drives(): Entry[] {
  if (process.platform !== 'win32') {
    const home = os.homedir();
    return existingDirs([
      { name: 'Home', path: home },
      { name: 'Desktop', path: path.join(home, 'Desktop') },
      { name: 'Documents', path: path.join(home, 'Documents') },
      { name: 'Downloads', path: path.join(home, 'Downloads') },
      { name: 'Root /', path: '/' },
      { name: 'Volumes', path: '/Volumes' },
    ]);
  }

  const out: Entry[] = [];
  for (const c of 'CDEFGHIJ') {
    const root = `${c}:\\`;
    try { fs.accessSync(root); out.push({ name: root, path: root }); } catch { /* 없음 */ }
  }
  return out;
}

export interface FullEntry { name: string; path: string; dir: boolean; size: number; }

// 한 폴더의 하위 디렉터리 + 파일을 모두 반환 (디렉터리 먼저, 각각 이름순).
export function listEntries(p: string): FullEntry[] {
  return fs.readdirSync(p, { withFileTypes: true })
    .map(d => {
      const full = path.join(p, d.name);
      let size = 0;
      if (!d.isDirectory()) { try { size = fs.statSync(full).size; } catch { /* ignore */ } }
      return { name: d.name, path: full, dir: d.isDirectory(), size };
    })
    .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
}

// 텍스트 파일을 maxBytes까지 읽는다.
export function readFileText(p: string, maxBytes = 256 * 1024): { content: string; truncated: boolean; size: number } {
  const size = fs.statSync(p).size;
  const fd = fs.openSync(p, 'r');
  try {
    const len = Math.min(size, maxBytes);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, 0);
    return { content: buf.toString('utf8'), truncated: size > maxBytes, size };
  } finally {
    fs.closeSync(fd);
  }
}
