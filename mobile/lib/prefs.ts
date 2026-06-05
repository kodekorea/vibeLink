import { useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';

export type ThemeName = 'light' | 'dark';
export type Lang = 'en' | 'ko';

const LIGHT = {
  primary: '#cc785c', primaryActive: '#a9583e',
  ink: '#141413', body: '#3d3d3a', bodyStrong: '#252523', muted: '#6c6a64', mutedSoft: '#8e8b82',
  hairline: '#e6dfd8', canvas: '#faf9f5', surfaceSoft: '#f5f0e8', surfaceCard: '#efe9de',
  surfaceCreamStrong: '#e8e0d2', surfaceDark: '#181715', surfaceDarkElevated: '#252320',
  onPrimary: '#ffffff', onDark: '#faf9f5', onDarkSoft: '#a09d96', success: '#5db872', error: '#c64545',
};
const DARK: typeof LIGHT = {
  primary: '#cc785c', primaryActive: '#a9583e',
  ink: '#faf9f5', body: '#e6e3dd', bodyStrong: '#f3efe8', muted: '#a09d96', mutedSoft: '#857f76',
  hairline: '#33302b', canvas: '#181715', surfaceSoft: '#1f1e1b', surfaceCard: '#252320',
  surfaceCreamStrong: '#2a2622', surfaceDark: '#0f0d0b', surfaceDarkElevated: '#1f1e1b',
  onPrimary: '#ffffff', onDark: '#faf9f5', onDarkSoft: '#a09d96', success: '#5db872', error: '#f08a7a',
};
export const PALETTES = { light: LIGHT, dark: DARK };
export type Palette = typeof LIGHT;

let _theme: ThemeName = 'light';
let _lang: Lang = 'en';
const subs = new Set<() => void>();
function emit() { for (const s of subs) s(); }

export async function loadPrefs(): Promise<void> {
  try { const t = await SecureStore.getItemAsync('mtb_theme'); if (t === 'dark' || t === 'light') _theme = t; } catch {}
  try { const l = await SecureStore.getItemAsync('mtb_lang'); if (l === 'en' || l === 'ko') _lang = l; } catch {}
  emit();
}
export function getTheme(): ThemeName { return _theme; }
export function getLang(): Lang { return _lang; }
export async function setTheme(t: ThemeName): Promise<void> { _theme = t; emit(); try { await SecureStore.setItemAsync('mtb_theme', t); } catch {} }
export async function setLang(l: Lang): Promise<void> { _lang = l; emit(); try { await SecureStore.setItemAsync('mtb_lang', l); } catch {} }

export function usePrefs() {
  const [, force] = useState(0);
  useEffect(() => { const fn = () => force(n => n + 1); subs.add(fn); return () => { subs.delete(fn); }; }, []);
  return { theme: _theme, lang: _lang, c: PALETTES[_theme] };
}
