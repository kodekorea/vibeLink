// Windows 셸 환경(env) 해석 헬퍼. powershell/cmd/gitbash. (wsl은 wsl.ts에서 별도)
import * as fs from 'fs';
import * as path from 'path';

// Git Bash(bash.exe) 경로 탐색. 주의: System32\bash.exe는 WSL 런처이므로 bare 'bash.exe'를
// 쓰면 안 된다 — Git 설치 경로의 bash.exe를 명시적으로 찾는다.
export function gitBashPath(): string {
  const cands = [
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Git', 'bin', 'bash.exe'),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Git', 'bin', 'bash.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe'),
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  ].filter(Boolean) as string[];
  for (const c of cands) {
    try { if (fs.existsSync(c)) return c; } catch { /* */ }
  }
  // 못 찾으면 표준 경로 반환(없으면 spawn 시 에러 → 사용자가 Git 설치/경로 확인).
  return cands[cands.length - 1];
}

// env → spawn 파일/인자. powershell은 호출부의 기본 셸(this.shell)을 쓰므로 여기 없음.
export function resolveEnvShell(env: string): { file: string; args: string[] } | null {
  if (env === 'cmd') return { file: 'cmd.exe', args: [] };
  if (env === 'gitbash') return { file: gitBashPath(), args: ['-i', '-l'] };
  return null; // powershell/그 외는 기본 셸
}
