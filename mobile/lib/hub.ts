import * as SecureStore from 'expo-secure-store';

const URL_KEY = 'mtb_hub_url';
const TOKEN_KEY = 'mtb_hub_token';
const DEVICE_KEY = 'mtb_device';

let cachedUrl: string | null = null;
let cachedToken: string | null = null;

export interface Creds { url: string; token: string; }

export async function loadCreds(): Promise<Creds | null> {
  const url = cachedUrl ?? (await SecureStore.getItemAsync(URL_KEY));
  const token = cachedToken ?? (await SecureStore.getItemAsync(TOKEN_KEY));
  if (url && token) { cachedUrl = url; cachedToken = token; return { url, token }; }
  return null;
}

export async function pair(rawUrl: string, password: string): Promise<{ ok: boolean; error?: string }> {
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
    cachedUrl = url;
    cachedToken = j.token;
    await SecureStore.setItemAsync(URL_KEY, url);
    await SecureStore.setItemAsync(TOKEN_KEY, j.token);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: '연결 실패: ' + String(e) };
  }
}

export async function disconnect(): Promise<void> {
  cachedUrl = null;
  cachedToken = null;
  await SecureStore.deleteItemAsync(URL_KEY);
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export async function apiGet<T>(apiPath: string): Promise<T> {
  const c = await loadCreds();
  if (!c) throw new Error('not connected');
  const r = await fetch(c.url + apiPath, { headers: { Authorization: 'Bearer ' + c.token } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return (await r.json()) as T;
}
