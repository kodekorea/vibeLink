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

// ── 공유 세션/터미널 상태 (세션=프로젝트, 그 안에 터미널 여러 개) ──
export type TerminalKind = 'agent' | 'shell';
export interface TerminalInfo { id: string; label: string; kind: TerminalKind; agent?: string; env?: string; }
export interface Session { id: string; label: string; cwd: string; env?: string; terminals: TerminalInfo[]; }

// 세션의 기본(에이전트) 터미널 id. 세션 선택 시 이 터미널을 활성으로.
export function claudeTerminalId(s: Session): string | null {
  return (s.terminals?.find(t => t.kind === 'agent') ?? s.terminals?.[0])?.id ?? null;
}

// 다른 탭에서 '+' 누르면 터미널 탭으로 이동해 새 세션 모달을 연다(이 플래그로 전달).
let pendingNew = false;
export function requestNewSession(): void { pendingNew = true; }
export function consumeNewSession(): boolean { const v = pendingNew; pendingNew = false; return v; }

let activeSessionId: string | null = null;   // 세션(프로젝트)
let activeTerminalId: string | null = null;  // 화면에 보이는 터미널(PTY)
const sessionListeners = new Set<() => void>();
const terminalListeners = new Set<() => void>();

export function onSessionChange(cb: () => void): () => void {
  sessionListeners.add(cb);
  return () => sessionListeners.delete(cb);
}
function emitSession() { for (const cb of sessionListeners) cb(); }

export function onTerminalChange(cb: () => void): () => void {
  terminalListeners.add(cb);
  return () => terminalListeners.delete(cb);
}
function emitTerminal() { for (const cb of terminalListeners) cb(); }

export function getActiveSessionId(): string | null { return activeSessionId; }
export function setActiveSessionId(id: string | null): void {
  if (activeSessionId === id) return;
  activeSessionId = id;
  emitSession();
}

export function getActiveTerminalId(): string | null { return activeTerminalId; }
export function setActiveTerminalId(id: string | null): void {
  if (activeTerminalId === id) return;
  activeTerminalId = id;
  emitTerminal();
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

// 세션 안에 셸 터미널 추가 → 새 터미널 id
export async function createTerminal(sessionId: string): Promise<string | null> {
  const h = await getActiveHost();
  if (!h) return null;
  try {
    const r = await fetch(h.url + '/terminals/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + h.token },
      body: JSON.stringify({ sessionId }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j.terminalId ?? null;
  } catch {
    return null;
  }
}

// 터미널 닫기 (셸만; claude는 서버가 거부)
export async function closeTerminal(id: string): Promise<void> {
  const h = await getActiveHost();
  if (!h) return;
  await fetch(h.url + '/terminals/close', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + h.token },
    body: JSON.stringify({ id }),
  });
}

// 완료 알림 임계값 (초) — "이만큼 이상 작업하고 끝났을 때만 알림"
export async function getNotifyMinSec(): Promise<number | null> {
  const h = await getActiveHost();
  if (!h) return null;
  try {
    const r = await fetch(h.url + '/settings/notify', { headers: { Authorization: 'Bearer ' + h.token } });
    if (!r.ok) return null;
    const j = await r.json();
    return Math.round((j.minMs ?? 10000) / 1000);
  } catch {
    return null;
  }
}
export async function setNotifyMinSec(sec: number): Promise<boolean> {
  const h = await getActiveHost();
  if (!h) return false;
  try {
    const r = await fetch(h.url + '/settings/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + h.token },
      body: JSON.stringify({ minMs: Math.round(sec * 1000) }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  // RN 전역 btoa가 없을 수 있어 폴백 포함
  const g = globalThis as unknown as { btoa?: (s: string) => string };
  if (g.btoa) return g.btoa(bin);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bin.length; i += 3) {
    const a = bin.charCodeAt(i), b = bin.charCodeAt(i + 1), c = bin.charCodeAt(i + 2);
    out += chars[a >> 2] + chars[((a & 3) << 4) | (b >> 4)]
      + (i + 1 < bin.length ? chars[((b & 15) << 2) | (c >> 6)] : '=')
      + (i + 2 < bin.length ? chars[c & 63] : '=');
  }
  return out;
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
};

// 이미지 원본 바이트를 인증해서 받아 data URI로 반환. 실패 시 {error}.
// arrayBuffer→base64 수동 변환(FileReader/Blob 경로가 Expo에서 불안정한 경우 대비).
export async function imageDataUri(filePath: string): Promise<{ uri?: string; error?: string }> {
  const h = await getActiveHost();
  if (!h) return { error: '연결된 호스트 없음' };
  try {
    const r = await fetch(h.url + '/raw?path=' + encodeURIComponent(filePath), {
      headers: { Authorization: 'Bearer ' + h.token },
    });
    if (!r.ok) return { error: 'HTTP ' + r.status };
    const ext = (filePath.split('.').pop() || '').toLowerCase();
    const mime = r.headers.get('content-type') || MIME_BY_EXT[ext] || 'image/png';
    const buf = await r.arrayBuffer();
    if (!buf || buf.byteLength === 0) return { error: '빈 파일' };
    const b64 = bytesToBase64(new Uint8Array(buf));
    return { uri: `data:${mime};base64,${b64}` };
  } catch (e) {
    return { error: String(e) };
  }
}

// 파일 다운로드 URL (시스템 브라우저로 열어 저장). 브라우저는 헤더를 못 실으므로
// 토큰을 쿼리로 붙인다 — Linking.openURL(await downloadUrl(path)).
// JWT는 base64url(.) 만 쓰므로 encodeURIComponent로 깨지지 않고 그대로 왕복한다.
// 토큰이 비어 있으면 서버가 'no token' 401을 주므로, 여기서 미리 막아 원인을 분명히 한다.
export async function downloadUrl(filePath: string): Promise<string | null> {
  const h = await getActiveHost();
  if (!h) return null;
  if (!h.token) return null;
  return h.url + '/download?path=' + encodeURIComponent(filePath) + '&token=' + encodeURIComponent(h.token);
}

// PC에서 LISTEN 중인 dev 서버 포트 목록.
export async function listPorts(): Promise<number[]> {
  try { const r = await apiGet<{ ports: number[] }>('/ports'); return r.ports || []; }
  catch { return []; }
}

// dev 웹서버 프리뷰용 베이스: 활성 호스트가 http://<ip>:<port> 형태면 그 ip로 'http://<ip>'를 돌려준다.
// (같은 와이파이/LAN/Tailscale 직접접속일 때 동작. https 터널이면 null → LAN 안내)
export async function previewBase(): Promise<string | null> {
  const h = await getActiveHost();
  if (!h) return null;
  const m = h.url.match(/^http:\/\/([^/:]+)(?::\d+)?$/i);
  return m ? 'http://' + m[1] : null;
}

// 연결된 모니터 목록 (모니터 선택용)
export interface DisplayInfo { idx: number; name: string; primary: boolean; w: number; h: number; }
export async function listDisplays(): Promise<DisplayInfo[]> {
  const h = await getActiveHost();
  if (!h) return [];
  try {
    const r = await fetch(h.url + '/displays', { headers: { Authorization: 'Bearer ' + h.token } });
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j.displays) ? j.displays : [];
  } catch {
    return [];
  }
}

// 캡처 위 탭한 지점(xf,yf: 0~1 비율)을 PC에서 좌클릭. display: 모니터 idx(undefined=전체)
export async function sendClick(xf: number, yf: number, display?: number): Promise<boolean> {
  const h = await getActiveHost();
  if (!h) return false;
  try {
    const q = '?x=' + xf.toFixed(6) + '&y=' + yf.toFixed(6) + (display !== undefined ? '&display=' + display : '');
    const r = await fetch(h.url + '/click' + q, { headers: { Authorization: 'Bearer ' + h.token } });
    return r.ok;
  } catch {
    return false;
  }
}

// PC 화면 캡처를 data URI로 (인증 fetch → arrayBuffer → base64).
// display: 모니터 idx (undefined면 전체 가상화면)
export async function screenDataUri(display?: number): Promise<{ uri?: string; error?: string }> {
  const h = await getActiveHost();
  if (!h) return { error: 'not connected' };
  try {
    const q = display !== undefined ? '?display=' + display : '';
    const r = await fetch(h.url + '/screen' + q, { headers: { Authorization: 'Bearer ' + h.token } });
    if (!r.ok) return { error: 'HTTP ' + r.status };
    const buf = await r.arrayBuffer();
    if (!buf || buf.byteLength === 0) return { error: 'empty' };
    return { uri: 'data:image/png;base64,' + bytesToBase64(new Uint8Array(buf)) };
  } catch (e) {
    return { error: String(e) };
  }
}
