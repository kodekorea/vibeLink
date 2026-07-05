import * as child_process from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function pathKey(env: NodeJS.ProcessEnv): string {
  return Object.keys(env).find(k => k.toLowerCase() === 'path') ?? (process.platform === 'win32' ? 'Path' : 'PATH');
}

function envValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const found = Object.keys(env).find(k => k.toLowerCase() === key.toLowerCase());
  return found ? env[found] : undefined;
}

function setEnv(env: NodeJS.ProcessEnv, key: string, value: string): void {
  const found = Object.keys(env).find(k => k.toLowerCase() === key.toLowerCase());
  env[found ?? key] = value;
}

function windowsDir(env: NodeJS.ProcessEnv): string {
  return envValue(env, 'SystemRoot') || envValue(env, 'windir') || 'C:\\Windows';
}

function addPath(parts: string[], p: string | undefined): void {
  if (!p) return;
  const v = p.trim();
  if (!v) return;
  if (!parts.some(x => process.platform === 'win32' ? x.toLowerCase() === v.toLowerCase() : x === v)) parts.push(v);
}

function registryPath(scope: 'HKLM' | 'HKCU', env: NodeJS.ProcessEnv): string {
  if (process.platform !== 'win32') return '';
  const reg = windowsExe('reg.exe', env);
  const key = scope === 'HKLM'
    ? 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'
    : 'HKCU\\Environment';
  try {
    const out = child_process.execFileSync(reg, ['query', key, '/v', 'Path'], {
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    const line = out.split(/\r?\n/).find(l => /\bPath\b/i.test(l) && /\bREG_(?:EXPAND_)?SZ\b/i.test(l));
    const m = line?.match(/\bREG_(?:EXPAND_)?SZ\s+(.+)$/i);
    return m ? m[1].trim() : '';
  } catch {
    return '';
  }
}

function expandWindowsVars(value: string, env: NodeJS.ProcessEnv): string {
  return value.replace(/%([^%]+)%/g, (_m, name) => envValue(env, name) || process.env[name] || '');
}

export function windowsExe(name: string, env: NodeJS.ProcessEnv = process.env): string {
  if (process.platform !== 'win32' || path.isAbsolute(name)) return name;
  const root = windowsDir(env);
  return path.join(root, 'System32', name);
}

export function normalizeProcessEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  if (process.platform === 'win32') {
    const root = windowsDir(env);
    setEnv(env, 'SystemRoot', root);
    setEnv(env, 'windir', envValue(env, 'windir') || root);
    setEnv(env, 'ComSpec', envValue(env, 'ComSpec') || path.join(root, 'System32', 'cmd.exe'));
    setEnv(env, 'TEMP', envValue(env, 'TEMP') || os.tmpdir());
    setEnv(env, 'TMP', envValue(env, 'TMP') || os.tmpdir());

    const parts: string[] = [];
    for (const key of Object.keys(env)) {
      if (key.toLowerCase() === 'path') {
        for (const p of String(env[key] || '').split(path.delimiter)) addPath(parts, p);
      }
    }
    for (const p of registryPath('HKLM', env).split(path.delimiter)) addPath(parts, expandWindowsVars(p, env));
    for (const p of registryPath('HKCU', env).split(path.delimiter)) addPath(parts, expandWindowsVars(p, env));
    addPath(parts, path.join(root, 'System32'));
    addPath(parts, root);
    addPath(parts, path.join(root, 'System32', 'WindowsPowerShell', 'v1.0'));
    addPath(parts, path.join(root, 'System32', 'OpenSSH'));
    addPath(parts, 'C:\\Program Files\\PowerShell\\7');
    addPath(parts, 'C:\\Program Files\\nodejs');
    addPath(parts, path.join(os.homedir(), 'AppData', 'Roaming', 'npm'));
    env[pathKey(env)] = parts.join(path.delimiter);
  } else {
    const parts = String(env.PATH || '').split(path.delimiter).filter(Boolean);
    for (const p of ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin']) {
      addPath(parts, p);
    }
    env.PATH = parts.join(path.delimiter);
  }
  return env;
}

export function pathEntries(env: NodeJS.ProcessEnv): string[] {
  return String(env[pathKey(env)] || '').split(path.delimiter).filter(Boolean);
}

export function existingWindowsExe(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const absolute = windowsExe(name, env);
  try { if (fs.existsSync(absolute)) return absolute; } catch { /* ignore */ }
  return name;
}
