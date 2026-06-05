# Anthropic 리디자인 (하이브리드) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. This is a STYLING redesign — no logic changes; verification gates are typecheck + `expo export` + PWA `node --check` + hub tests staying green.

**Goal:** MTB Hub의 PWA·모바일 앱·데스크톱 설정 UI를 `DESIGN.md`의 Anthropic 크림/코랄/네이비 에디토리얼 시스템으로 리스킨한다 (파란색 → 코랄 전면 교체, serif 헤드라인, 토큰화).

**Architecture:** 단일 출처 디자인 토큰(`mobile/lib/theme.ts` for native, PWA `:root` CSS 변수). 크림 화면(연결/파일/에이전트/설정) + 다크 네이비 터미널/코드. 기능 무변경.

**Tech Stack:** Expo SDK 56 / Expo Router, `@expo-google-fonts/*`(번들 폰트), PWA HTML/CSS, Electron settings.html.

**설계 문서:** `docs/superpowers/specs/2026-06-04-anthropic-redesign-design.md`

---

## Task 1: 모바일 디자인 토큰 (theme.ts)

**Files:** Create `mobile/lib/theme.ts`

- [ ] **Step 1: 토큰 파일 작성**

```ts
// DESIGN.md(Anthropic 크림/코랄/네이비) 단일 출처. 모든 화면이 여기서만 색/간격/라운드를 가져온다.
export const color = {
  primary: '#cc785c', primaryActive: '#a9583e', primaryDisabled: '#e6dfd8',
  ink: '#141413', body: '#3d3d3a', bodyStrong: '#252523', muted: '#6c6a64', mutedSoft: '#8e8b82',
  hairline: '#e6dfd8', canvas: '#faf9f5', surfaceSoft: '#f5f0e8', surfaceCard: '#efe9de',
  surfaceCreamStrong: '#e8e0d2', surfaceDark: '#181715', surfaceDarkElevated: '#252320',
  surfaceDarkSoft: '#1f1e1b', onPrimary: '#ffffff', onDark: '#faf9f5', onDarkSoft: '#a09d96',
  accentTeal: '#5db8a6', success: '#5db872', warning: '#d4a017', error: '#c64545',
} as const;

export const radius = { sm: 6, md: 8, lg: 12, xl: 16, pill: 9999 } as const;
export const space = { xxs: 4, xs: 8, sm: 12, md: 16, lg: 24, xl: 32 } as const;

// useFonts로 로드되는 패밀리 키 (Task 2). 미로드 시 RN 기본으로 폴백되도록 옵셔널 사용 권장.
export const font = {
  display: 'CormorantGaramond_500Medium',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemibold: 'Inter_600SemiBold',
  code: 'JetBrainsMono_400Regular',
} as const;
```

- [ ] **Step 2: 타입체크**

Run (`mobile/`): `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add mobile/lib/theme.ts
git commit -m "feat(mobile): Anthropic design tokens (theme.ts)"
```

---

## Task 2: 폰트 번들 + 로드

**Files:** Modify `mobile/app/_layout.tsx`, `mobile/package.json` (via expo install)

- [ ] **Step 1: 폰트 패키지 설치**

Run (`mobile/`): `npx expo install @expo-google-fonts/cormorant-garamond @expo-google-fonts/inter @expo-google-fonts/jetbrains-mono expo-splash-screen`
Expected: 설치 성공 (`.npmrc` legacy-peer-deps 적용됨).

- [ ] **Step 2: `_layout.tsx` 에서 useFonts 로드**

현재 `_layout.tsx`(Stack + setupNotifications)를 다음으로 교체:
```tsx
import { Stack } from 'expo-router';
import { useEffect } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts, CormorantGaramond_500Medium } from '@expo-google-fonts/cormorant-garamond';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { JetBrainsMono_400Regular } from '@expo-google-fonts/jetbrains-mono';
import { setupNotifications } from '@/lib/notify';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [loaded] = useFonts({
    CormorantGaramond_500Medium,
    Inter_400Regular, Inter_500Medium, Inter_600SemiBold,
    JetBrainsMono_400Regular,
  });

  useEffect(() => { setupNotifications(); }, []);
  useEffect(() => { if (loaded) SplashScreen.hideAsync().catch(() => {}); }, [loaded]);

  if (!loaded) return null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="(tabs)" />
    </Stack>
  );
}
```

- [ ] **Step 3: 타입체크 + 번들**

Run (`mobile/`): `npx tsc --noEmit` (exit 0), then `npx expo export -p android --output-dir "$env:TEMP\mtb_r2"` (exit 0; delete temp after).

- [ ] **Step 4: Commit**

```bash
git add mobile/package.json mobile/package-lock.json mobile/app/_layout.tsx
git commit -m "feat(mobile): bundle Cormorant/Inter/JetBrainsMono fonts + splash gate"
```

---

## Task 3: PWA 터미널 리스킨 (다크 네이비 + 코랄)

**Files:** Modify `hub/pwa/index.html`

리스킨 규칙 (현재 파란/차가운 다크 → DESIGN.md):
- `<head>`에 Google Fonts 추가: `<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500&family=Inter:wght@400;500;600&family=JetBrains+Mono&display=swap" rel="stylesheet">`
- `:root` CSS 변수를 DESIGN.md 다크 표면 팔레트로 교체:
  `--bg:#181715; --panel:#1f1e1b; --panel2:#252320; --line:#33302b; --accent:#cc785c; --accent-press:#a9583e; --txt:#faf9f5; --mut:#a09d96; --cream:#faf9f5; --ink:#141413; --card:#efe9de`
- body font-family → `Inter, -apple-system, system-ui, sans-serif`. 터미널은 JetBrains Mono(`term` fontFamily 옵션도 `'JetBrains Mono, ui-monospace, ...'`).
- 모든 `#2563eb`/`#3b82f6`/파란 계열 → `var(--accent)`; press → `var(--accent-press)`.
- 칩 active, key:active, #send, #toBottom, #plus 활성, #pairBtn, .btn = 코랄.
- **페어링 화면(`#pair`)은 크림**: `#pair{background:var(--cream)}` `#pair h2{font-family:'Cormorant Garamond',Georgia,serif;color:var(--ink);font-size:34px;font-weight:500}` `#pair input{background:#fff;color:var(--ink);border:1px solid var(--hairline,#e6dfd8)}` 버튼 코랄.
- 라운드: 버튼/입력 8px(이미 비슷), 카드/시트 12–16, 칩 pill 유지.
- QR 모달 시트 `#sheet`는 다크 유지(터미널 컨텍스트) 또는 크림 — 다크 유지로 통일.

- [ ] **Step 1: head에 폰트 link 추가** (위 `<link>` 두 줄을 기존 xterm css link 옆에)
- [ ] **Step 2: `:root` 변수 + body/term 폰트 교체** (위 팔레트로)
- [ ] **Step 3: 파란색 → 코랄 전면 치환** (활성 칩/키/전송/toBottom/plus/pairBtn/.btn/입력 focus 보더)
- [ ] **Step 4: 페어링 화면 크림 + serif 제목**
- [ ] **Step 5: 검증**

Run (`hub/`, PowerShell):
```powershell
$h = Get-Content -Raw pwa\index.html
$m = [regex]::Matches($h,'(?s)<script>(.*?)</script>'); $js=$m[$m.Count-1].Groups[1].Value
$t = Join-Path $env:TEMP 'c.js'; Set-Content $t $js -Encoding utf8; node --check $t; Remove-Item $t
```
Expected: `node --check` exit 0. 또한 `$h -match '#cc785c'` True, `$h -notmatch '#2563eb'` True.

- [ ] **Step 6: Commit**

```bash
git add hub/pwa/index.html
git commit -m "feat(hub/pwa): Anthropic reskin — navy terminal + coral accents + serif pairing, fonts"
```

---

## Task 4: 모바일 연결/스캔 화면 (index.tsx) — 크림 에디토리얼

**Files:** Modify `mobile/app/index.tsx`

- [ ] **Step 1: theme 적용**

`import { color, radius, space, font } from '@/lib/theme';` 추가. 스타일을 다음 원칙으로 교체(JSX 구조·로직 유지):
- connect/manual 화면 배경 `color.canvas`(크림), 제목 `fontFamily: font.display, color: color.ink, fontSize: 30`
- 안내문 `color.muted`, 입력 `backgroundColor:'#fff', color:color.ink, borderColor:color.hairline, borderRadius:radius.md`, focus 느낌은 보더 색만
- 버튼(연결/권한 허용) `backgroundColor: color.primary, color: color.onPrimary, borderRadius: radius.md`
- 링크 텍스트 `color: color.primary`
- 스캔 오버레이: 프레임 보더 `color.primary`, 텍스트 `color.onDark`(스캐너는 카메라 위 → 흰/크림 텍스트 유지), 카메라 배경은 검정 유지

- [ ] **Step 2: 타입체크** — Run (`mobile/`): `npx tsc --noEmit` → exit 0
- [ ] **Step 3: Commit**

```bash
git add mobile/app/index.tsx
git commit -m "feat(mobile): cream editorial connect/scan screen"
```

---

## Task 5: 탭바 (tabs/_layout.tsx) — 크림 + 코랄 활성

**Files:** Modify `mobile/app/(tabs)/_layout.tsx`

- [ ] **Step 1: theme 적용**

`screenOptions`를:
```tsx
import { color } from '@/lib/theme';
// ...
screenOptions={{
  headerStyle: { backgroundColor: color.canvas },
  headerTintColor: color.ink,
  headerTitleStyle: { fontFamily: 'CormorantGaramond_500Medium', fontSize: 22, color: color.ink },
  headerShadowVisible: false,
  tabBarStyle: { backgroundColor: color.canvas, borderTopColor: color.hairline },
  tabBarActiveTintColor: color.primary,
  tabBarInactiveTintColor: color.muted,
  tabBarLabelStyle: { fontFamily: 'Inter_500Medium' },
}}
```
나머지(5개 Tabs.Screen) 유지.

- [ ] **Step 2: 타입체크** → exit 0
- [ ] **Step 3: Commit** — `git commit -m "feat(mobile): cream tab bar with coral active"`

---

## Task 6: 프로젝트 칩 바 (project-bar.tsx) — pill 코랄

**Files:** Modify `mobile/components/project-bar.tsx`

- [ ] **Step 1:** `import { color, radius } from '@/lib/theme';` 추가, StyleSheet:
  - `bar` 배경 `color.surfaceSoft`, 보더하단 `color.hairline`
  - `chip` 배경 `color.surfaceCard`, 글자 `color.muted`, `borderRadius: radius.pill`, 보더 `color.hairline`
  - `active` 배경 `color.primary`, 보더 투명; `txtActive` `color.onPrimary`
  - 폰트 `Inter_500Medium`
- [ ] **Step 2: 타입체크** → exit 0
- [ ] **Step 3: Commit** — `git commit -m "feat(mobile): coral pill project chips"`

---

## Task 7: 파일 탐색기 (files.tsx) — 크림 리스트 + 다크 코드뷰

**Files:** Modify `mobile/app/(tabs)/files.tsx`

- [ ] **Step 1:** theme 적용:
  - 리스트 루트 `color.canvas`, 바/구분선 `color.hairline`, 파일명 `color.ink`, 크기/경로 `color.mutedSoft`, 링크 `color.primary`
  - **파일 뷰어(file 선택 시)는 다크 코드**: 배경 `color.surfaceDark`, 코드 텍스트 `color.onDark` + `fontFamily:'JetBrainsMono_400Regular'`, 상단 바 `color.surfaceDarkElevated` 위 onDark 텍스트, "닫기" 링크 코랄톤(onDark 위라 `color.primary` 또는 accent)
  - 에러 `color.error`
- [ ] **Step 2: 타입체크** → exit 0
- [ ] **Step 3: Commit** — `git commit -m "feat(mobile): cream file list + dark code viewer"`

---

## Task 8: 에이전트 챗 (agent.tsx) — 크림 캔버스 + 말풍선

**Files:** Modify `mobile/app/(tabs)/agent.tsx`

- [ ] **Step 1:** theme 적용:
  - 루트 `color.canvas`
  - user 말풍선 `color.primary` 배경 + `color.onPrimary` 텍스트
  - assistant 말풍선 `color.surfaceCard` 배경 + `color.ink` 텍스트, `fontFamily:'Inter_400Regular'`
  - thinking `color.mutedSoft` 이탤릭, tool `color.muted`(🔧), tool_result `color.mutedSoft` + 코드폰트, 에러결과 `color.error`
  - FAB(⤓) `color.primary`, 에러문 `color.error`
- [ ] **Step 2: 타입체크** → exit 0
- [ ] **Step 3: Commit** — `git commit -m "feat(mobile): cream agent chat (coral/cream bubbles)"`

---

## Task 9: 변경 diff (changes.tsx) — 리스트 크림 + diff 다크

**Files:** Modify `mobile/app/(tabs)/changes.tsx`

- [ ] **Step 1:** theme 적용:
  - 리스트 루트 `color.canvas`, 행 구분 `color.hairline`, 파일명 `color.ink`, 경로 `color.mutedSoft`, kind 아이콘 `color.primary`
  - **diff 뷰는 다크 code-window**: 배경 `color.surfaceDark`, 상단 바 `color.surfaceDarkElevated`, 닫기 링크 코랄, add 라인 `color.success`, del 라인 `color.error`, 코드폰트 `JetBrainsMono_400Regular`
  - 빈/에러 텍스트 `color.muted`/`color.error`
- [ ] **Step 2: 타입체크** → exit 0
- [ ] **Step 3: Commit** — `git commit -m "feat(mobile): cream changes list + dark diff window"`

---

## Task 10: 설정 (settings.tsx) — 크림 카드

**Files:** Modify `mobile/app/(tabs)/settings.tsx`

- [ ] **Step 1:** theme 적용:
  - 루트 `color.canvas`, 섹션 제목 `color.muted`(또는 serif 작은 제목), 카드 `color.surfaceCard` + `radius.lg`
  - 활성 호스트 카드 보더 `color.primary`, 활성 라벨 `color.ink`, url `color.mutedSoft`
  - "＋ PC 추가" 버튼 `color.primary` 배경 + onPrimary (primary CTA)
  - 삭제 링크 `color.error`
- [ ] **Step 2: 타입체크** → exit 0
- [ ] **Step 3: Commit** — `git commit -m "feat(mobile): cream settings cards"`

---

## Task 11: 데스크톱 설정창 (settings.html) — 크림 + 코랄

**Files:** Modify `desktop/settings.html`

- [ ] **Step 1:** `<style>`을 DESIGN.md 크림으로: body 배경 `#faf9f5` 글자 `#141413`, h2 serif(Georgia/serif 폴백) , 입력 흰 배경+hairline 보더 radius 8, 버튼 코랄 `#cc785c`/흰글씨 radius 8, 로그 `pre`는 다크 `#181715` 위 `#faf9f5` + monospace, .url 코랄 `#cc785c`, status 강조. (electron 렌더러라 외부폰트 없이 시스템 serif/sans 사용)
- [ ] **Step 2: 검증** — Run (`desktop/`): `node --check main.js` (settings.html은 정적이라 변경 무관하지만 main.js 무손상 확인) → exit 0. settings.html에 `#cc785c` 포함, `#2563eb` 미포함 확인.
- [ ] **Step 3: Commit** — `git commit -m "feat(desktop): cream/coral settings window"`

---

## Task 12: 최종 검증

**Files:** 없음

- [ ] **Step 1: 모바일 풀 검증**

Run (`mobile/`): `npx tsc --noEmit` → exit 0; `npx expo export -p android --output-dir "$env:TEMP\mtb_final"` → exit 0 (delete after).

- [ ] **Step 2: hub 검증 (로직 무변경 확인)**

Run (`hub/`): `npm run typecheck` → exit 0; `npm test` → 18 pass.

- [ ] **Step 3: PWA 서빙 스모크**

hub를 빈 포트로 띄워 `GET /` 200 + 응답에 `#cc785c` 포함, `#2563eb` 미포함 확인 후 정리(47800 건드리지 말 것).

- [ ] **Step 4: 색상 잔재 점검**

`mobile/app`, `mobile/components`, `hub/pwa/index.html`, `desktop/settings.html`에서 파란 하드코드(`#2563eb`, `#3b82f6`, `#1e3a8a`, `#7aa2ff`, `#1e293b`, `#93c5fd`) 잔재 grep → 없거나 의도된 것만. 있으면 코랄/토큰으로 교체 후 재커밋.

- [ ] **Step 5:** 사용자 기기 테스트 안내 (크림 화면/코랄/serif/다크 터미널/모든 탭).

---

## 빠른 참조
```powershell
cd mobile; npx tsc --noEmit; npx expo export -p android --output-dir "$env:TEMP\x"
cd hub;    npm run typecheck; npm test
```
