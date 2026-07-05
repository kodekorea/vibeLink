// 셸 환경(env) 해석 헬퍼. wsl은 wsl.ts에서 별도 처리한다.
import * as fs from 'fs';
import * as path from 'path';
import { existingWindowsExe } from './env';

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

export function defaultShell(): string {
  if (process.platform === 'win32') return existingWindowsExe('powershell.exe');
  return process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh');
}

export function defaultEnv(): string {
  return process.platform === 'win32' ? 'powershell' : 'zsh';
}

export const ENV_CHOICES = ['powershell', 'cmd', 'gitbash', 'wsl', 'zsh', 'bash', 'sh'] as const;

export function isSupportedEnv(env: string): boolean {
  return (ENV_CHOICES as readonly string[]).includes(env);
}

// env → spawn 파일/인자. powershell은 호출부의 기본 셸(this.shell)을 쓰므로 여기 없음.
export function resolveEnvShell(env: string): { file: string; args: string[] } | null {
  if (env === 'cmd') return { file: existingWindowsExe('cmd.exe'), args: [] };
  if (env === 'gitbash') return { file: gitBashPath(), args: ['-i', '-l'] };
  if (env === 'zsh') return { file: process.env.SHELL && process.env.SHELL.endsWith('/zsh') ? process.env.SHELL : '/bin/zsh', args: ['-l'] };
  if (env === 'bash') return { file: '/bin/bash', args: ['-l'] };
  if (env === 'sh') return { file: '/bin/sh', args: [] };
  return null; // powershell/그 외는 기본 셸
}
