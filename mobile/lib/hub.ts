import * as SecureStore from 'expo-secure-store';

const HOSTS_KEY = 'mtb_hosts';
const ACTIVE_KEY = 'mtb_active_host';
const DEVICE_KEY = 'mtb_device';
const SELPROJ_PREFIX = 'mtb_selproj_';

export interface Host { id: string; label: string; url: string; token: string; }

let hosts: Host[] | null = null;
let activeId: string | null = null;
const listeners = new Set<() => void>();

// 활성 호스트가 바뀌면 구독자(탭들)에게 알림 → 데이터/터미널 새로고침.
export function onHostChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function emit() { for (const cb of listeners) cb(); }

function labelFromUrl(url: string): string {
  try {
    const h = new URL(url).host;
    const sub = h.split('.')[0];
    return sub && sub.length <= 20 ? sub : h;
  } catch { return url; }
}

async function persist() {
  await SecureStore.setItemAsync(HOSTS_KEY, JSON.stringify(hosts ?? []));
  if (activeId) await SecureStore.setItemAsync(ACTIVE_KEY, activeId);
}

async function ensureLoaded() {
  if (hosts !== null) return;
  try { hosts = JSON.parse((await SecureStore.getItemAsync(HOSTS_KEY)) || '[]'); } catch { hosts = []; }
  if (!Array.isArray(hosts)) hosts = [];
  activeId = (await SecureStore.getItemAsync(ACTIVE_KEY)) || (hosts[0]?.id ?? null);
}

export async function listHosts(): Promise<Host[]> { await ensureLoaded(); return hosts!.slice(); }

export async function getActiveHost(): Promise<Host | null> {
  await ensureLoaded();
  return hosts!.find(h => h.id === activeId) ?? hosts![0] ?? null;
}

export async function setActiveHost(id: string): Promise<void> {
  await ensureLoaded();
  if (hosts!.some(h => h.id === id)) { activeId = id; activeSessionId = null; await persist(); emit(); emitSession(); }
}

export async function removeHost(id: string): Promise<void> {
  await ensureLoaded();
  hosts = hosts!.filter(h => h.id !== id);
  if (activeId === id) activeId = hosts![0]?.id ?? null;
  await persist();
  emit();
}

// 페어링 성공 시 호스트를 추가하고 활성으로 설정. 같은 url이면 갱신.
export async function addHost(rawUrl: string, password: string): Promise<{ ok: boolean; error?: string }> {
  await ensureLoaded();
  let url = (rawUrl || '').trim();
  if (!url) return { ok: false, error: 'URL이 비었어요' };
  if (!/^https?:\/\//.test(url)) url = 'https://' + url;
  url = url.replace(/\/+$/, '');

  let deviceId = await SecureStore.getItemAsync(DEVICE_KEY);
  if (!deviceId) { deviceId = 'dev-' + Math.random().toString(36).slice(2); await SecureStore.setItemAsync(DEVICE_KEY, deviceId); }

  try {
    const r = await fetch(url + '/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: password, device_id: deviceId }),
    });
    if (!r.ok) return { ok: false, error: '인증 실패 (암호 확인)' };
    const j = (await r.json()) as { token?: string };
    if (!j.token) return { ok: false, error: '토큰을 받지 못했어요' };

    const existing = hosts!.find(h => h.url === url);
    if (existing) { existing.token = j.token; activeId = existing.id; }
    else {
      const id = 'h-' + Math.random().toString(36).slice(2);
      hosts!.push({ id, label: labelFromUrl(url), url, token: j.token });
      activeId = id;
    }
    await persist();
    emit();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: '연결 실패: ' + String(e) };
  }
}

export async function apiGet<T>(apiPath: string): Promise<T> {
  const h = await getActiveHost();
  if (!h) throw new Error('not connected');
  const r = await fetch(h.url + apiPath, { headers: { Authorization: 'Bearer ' + h.token } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return (await r.json()) as T;
}

// 선택된 프로젝트는 호스트별로 저장 (호스트마다 프로젝트가 다름).
export function getSelectedProject(): string | null {
  if (!activeId) return null;
  return _selByHost[activeId] ?? null;
}
export function setSelectedProject(p: string): void {
  if (!activeId) return;
  _selByHost[activeId] = p;
  SecureStore.setItemAsync(SELPROJ_PREFIX + activeId, p).catch(() => {});
}
const _selByHost: Record<string, string> = {};
export async function loadSelectedProject(): Promise<void> {
  if (!activeId) return;
  if (_selByHost[activeId]) return;
  const v = await SecureStore.getItemAsync(SELPROJ_PREFIX + activeId);
  if (v) _selByHost[activeId] = v;
}

// ── 공유 세션 상태 (모든 탭이 같은 활성 세션을 본다) ──
export interface Session { id: string; label: string; cwd: string; }

let activeSessionId: string | null = null;
const sessionListeners = new Set<() => void>();

export function onSessionChange(cb: () => void): () => void {
  sessionListeners.add(cb);
  return () => sessionListeners.delete(cb);
}
function emitSession() { for (const cb of sessionListeners) cb(); }

export function getActiveSessionId(): string | null { return activeSessionId; }
export function setActiveSessionId(id: string | null): void {
  if (activeSessionId === id) return;
  activeSessionId = id;
  emitSession();
}

export async function listSessions(): Promise<Session[]> {
  const r = await apiGet<{ sessions: Session[] }>('/sessions');
  return r.sessions;
}

export async function closeSession(id: string): Promise<void> {
  const h = await getActiveHost();
  if (!h) return;
  await fetch(h.url + '/sessions/close', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + h.token },
    body: JSON.stringify({ id }),
  });
}

// 파일 원본(이미지 등)을 RN <Image>/WebView에서 인증과 함께 불러올 소스.
export async function rawSource(filePath: string): Promise<{ uri: string; headers: Record<string, string> } | null> {
  const h = await getActiveHost();
  if (!h) return null;
  return {
    uri: h.url + '/raw?path=' + encodeURIComponent(filePath),
    headers: { Authorization: 'Bearer ' + h.token },
  };
}
