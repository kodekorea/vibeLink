import * as fs from 'fs';
import * as path from 'path';

export interface Project { label: string; path: string; }

export class ProjectStore {
  constructor(private file: string) {}

  list(): Project[] {
    try {
      const arr = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!Array.isArray(arr)) return [];
      return arr.filter(p => p && typeof p.label === 'string' && typeof p.path === 'string')
        .map(p => ({ label: p.label, path: p.path }));
    } catch { return []; }
  }

  add(project: Project): Project[] {
    const list = this.list().filter(p => p.path !== project.path);
    list.push({ label: project.label, path: project.path });
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(list, null, 2));
    return list;
  }
}
