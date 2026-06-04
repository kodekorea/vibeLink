# Anthropic 디자인 시스템 적용 (하이브리드 리스킨) 설계

날짜: 2026-06-04
상태: 설계 승인됨 (구현 플랜 작성 전)
참조: 저장소 루트 `DESIGN.md` (Anthropic 크림/코랄/네이비 에디토리얼 시스템)

## 목표

MTB Hub 모바일 앱·PWA·데스크톱 설정 UI를 `DESIGN.md`의 Anthropic 디자인 언어로 싹 리스킨한다.
핵심: 지금의 차가운 파란색(#2563eb/#3b82f6)을 **코랄(#cc785c)** 로 전면 교체하고,
따뜻한 크림/네이비 표면 + serif 헤드라인 + 토큰화된 라운드/간격을 입힌다.
기능은 그대로, 외형만 바꾼다.

### 하이브리드 결정 (승인됨)
- **크림 에디토리얼 화면**: 연결/스캔, 파일 탐색기, 설정, 에이전트 챗 — 밝은 크림 캔버스.
- **다크 네이비 표면**: 터미널(WebView/PWA), 변경 diff — DESIGN.md가 "터미널/코드 = 다크 네이비"로 규정.
- **코랄**이 두 표면 공통의 액센트(활성/primary).

### 비목표 (YAGNI)
- Anthropic 스파이크 로고 글리프(브랜드 자산 필요) — 일반 워드마크 텍스트로 대체.
- 애니메이션/트랜지션, 마케팅 컴포넌트(hero/pricing/connector grid 등).
- 기능 변경/추가 — 순수 외형.

## 디자인 토큰 (DESIGN.md에서 추출, 단일 출처)

```
color:
  primary       #cc785c   (코랄 — CTA/활성)
  primaryActive #a9583e
  primaryDisabled #e6dfd8
  ink           #141413   (헤드라인/주요 텍스트)
  body          #3d3d3a
  bodyStrong    #252523
  muted         #6c6a64
  mutedSoft     #8e8b82
  hairline      #e6dfd8   (크림 위 1px 보더)
  canvas        #faf9f5   (기본 크림 바닥)
  surfaceSoft   #f5f0e8
  surfaceCard   #efe9de   (피처/콘텐츠 카드)
  surfaceCreamStrong #e8e0d2
  surfaceDark   #181715   (터미널/코드/푸터)
  surfaceDarkElevated #252320
  surfaceDarkSoft #1f1e1b
  onPrimary     #ffffff
  onDark        #faf9f5   (다크 위 크림틴트 텍스트)
  onDarkSoft    #a09d96
  accentTeal    #5db8a6   (상태 점 등 희소)
  success       #5db872
  warning       #d4a017
  error         #c64545
radius:  sm 6 · md 8(버튼/입력) · lg 12(카드) · xl 16 · pill 9999
space:   xxs4 · xs8 · sm12 · md16 · lg24 · xl32
font:
  display: Cormorant Garamond (serif, 500, 음수 트래킹)   ← Copernicus 대체
  body:    Inter (sans)                                    ← StyreneB 대체
  code:    JetBrains Mono / ui-monospace
```

## 컴포넌트 매핑 (현재 → DESIGN.md)

| 현재 요소 | 새 스타일 |
|---|---|
| 파란 버튼 #2563eb | `button-primary` 코랄 #cc785c, on white, radius 8, press→#a9583e |
| 텍스트 입력 | `text-input` 크림 배경, hairline 보더, radius 8, focus→코랄 보더 |
| 세션/프로젝트 칩 | `badge-pill`/category-tab — 비활성 muted, 활성 코랄 배경 |
| 탭바 활성색 | 코랄 #cc785c (아이콘+라벨) |
| 화면 제목 | Cormorant serif display, 음수 트래킹 |
| 에이전트 유저 말풍선 | 코랄 배경 + onPrimary |
| 에이전트 Claude 말풍선 | surfaceCard #efe9de + ink |
| 에이전트 thinking | muted 이탤릭 |
| 터미널(PWA) 배경 | surfaceDark #181715, 텍스트 onDark, 활성 칩/키/전송 코랄 |
| 변경 diff 뷰 | code-window 다크(surfaceDark), +success/−error 톤 |
| 설정 카드 | surfaceCard 크림 카드, 위험 액션만 error 톤 |

## 적용 범위 (파일)

### 모바일 (`mobile/`)
- **신설 `mobile/lib/theme.ts`** — 위 토큰을 export하는 단일 출처(객체). 모든 화면이 import.
- **폰트 번들** — `@expo-google-fonts/cormorant-garamond`, `@expo-google-fonts/inter`, `@expo-google-fonts/jetbrains-mono` 설치, `app/_layout.tsx`에서 `useFonts`로 로드(로드 전 splash 유지). 오프라인에서도 동작(번들).
- **리스킨 화면** (인라인 스타일 → theme 토큰):
  - `app/index.tsx` (스캔/연결) — 크림 캔버스, serif 헤드라인, 코랄 CTA
  - `app/(tabs)/_layout.tsx` — 탭바 크림 + 코랄 활성
  - `app/(tabs)/files.tsx` — 크림 리스트, hairline 구분, 파일뷰어는 다크 code
  - `app/(tabs)/agent.tsx` — 크림 캔버스, 코랄/크림 말풍선, serif 헤더 느낌
  - `app/(tabs)/changes.tsx` — 리스트 크림, diff는 다크 code-window
  - `app/(tabs)/settings.tsx` — 크림 카드, 호스트 목록 코랄 활성
  - `components/project-bar.tsx` — pill 칩 코랄 활성
- 터미널 탭(`app/(tabs)/terminal.tsx`)은 WebView라 색만 맞춤(배경 surfaceDark).

### PWA (`hub/pwa/index.html`)
- 터미널 본체: **다크 네이비**(surfaceDark/Elevated/Soft) + 코랄 액센트(활성 칩, 키 active, 전송 버튼, toBottom).
- 페어링 화면: 크림 캔버스 + serif 제목 + 코랄 버튼.
- Google Fonts `<link>`(Cormorant Garamond + Inter + JetBrains Mono) + 시스템 폴백.
- 토큰을 CSS 변수(`:root`)로 정의해 단일 출처.

### 데스크톱 (`desktop/settings.html`)
- 크림 캔버스 + 코랄 버튼 + 카드. (작은 변경.)

## 데이터/동작
- 변경 없음. 순수 스타일. WS/REST/인증/세션 로직 그대로.

## 에러 처리
- 폰트 로드 실패(네이티브): `useFonts` 에러 시 시스템 폰트로 폴백, 앱은 계속.
- PWA Google Fonts 미로드(오프라인): CSS 폴백 스택(serif/sans/monospace)으로 자연 degrade.

## 테스트 전략
- **컴파일/번들 게이트**: `mobile` `npx tsc --noEmit` + `npx expo export -p android` 0; PWA inline JS `node --check` 0; hub `npm test` 18/18 유지(로직 무변경).
- **서빙 스모크**: hub `/` 200 + 새 팔레트 마크업 존재.
- **수동(기기)**: 사용자가 한 번 — 크림 화면/코랄 액센트/serif 제목/다크 터미널 확인, 모든 탭 동작.

## 단계 (요약, 상세는 플랜에서)
1. `mobile/lib/theme.ts` + 폰트 설치/로드(`_layout`).
2. PWA 리스킨(CSS 변수 + 폰트 + 코랄/네이비/크림).
3. 모바일 화면 리스킨(theme 적용) — index, tabs/_layout, files, agent, changes, settings, project-bar.
4. desktop/settings.html 리스킨.
5. 컴파일/번들/스모크 검증 → 사용자 1회 테스트 → 배포 단계로.

## 미해결/향후
- 배포(MSIX/Play/EAS)는 이 리스킨 검증 후 별도 spec.
- 스파이크 로고 글리프는 추후 자산 확보 시.
