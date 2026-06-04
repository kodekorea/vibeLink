# 공유 세션 바 + 세션 삭제 설계

날짜: 2026-06-05
상태: 설계 승인됨

## 목표
폰 앱에 **맨 위 고정 세션 바** 하나를 두고, 그걸로 세션을 전환하면 **터미널·에이전트·변경·파일** 4개 탭이 모두 그 세션 기준으로 보이게 한다. 세션 **삭제(종료)** 기능도 추가.

## 핵심 모델
**세션 = 한 프로젝트 폴더(cwd)에서 실행 중인 터미널 1개.** 그 cwd가 공통 키:
- 터미널 = 그 세션의 pty
- 에이전트 = 그 cwd의 Claude 트랜스크립트
- 변경 = 그 cwd의 에이전트 수정 파일
- 파일 = 그 cwd부터 탐색

세션 바는 **실행 중인 세션만** 표시(트레이드오프: 끝난 세션의 옛 대화는 안 뜸 — 승인됨).

## 변경 사항

### hub (`hub/src/sessions.ts`, `hub/tests/sessions.test.ts`)
- `SessionInfo`에 `cwd: string` 추가. `list()`가 `{id, label, cwd}` 반환.
- 기존 테스트의 `list()` 기대값을 `{id,label,cwd}`로 갱신(예: `{ id:'1', label:'projA', cwd:'C:\\a' }`).
- `/sessions`(server.ts)는 이미 `sessions.list()` 반환 → 자동으로 cwd 포함. `/sessions/close`도 이미 존재. server 변경 없음.

### 모바일 — 공유 세션 상태 (`mobile/lib/hub.ts`에 추가)
- 활성 세션 전역 상태 + 구독(기존 `onHostChange` 패턴 재사용):
  - `interface Session { id:string; label:string; cwd:string }`
  - 모듈 상태 `activeSessionId`, `getActiveSessionId()`, `setActiveSessionId(id)`, `onSessionChange(cb)→unsub`(emit)
  - 호스트 바뀌면 activeSessionId 초기화.
- 세션 목록/종료 헬퍼: `listSessions(): Promise<Session[]>`(GET /sessions), `closeSession(id): Promise<void>`(POST /sessions/close).

### 모바일 — 공유 세션 바 컴포넌트 (`mobile/components/session-bar.tsx`, 신설)
- `<SessionBar onActive={(s: Session|null)=>void} showNew?: boolean />`
- 동작:
  - 마운트/포커스/`onSessionChange`/`onHostChange` 시 `listSessions()` 갱신.
  - 활성 세션이 없거나 사라지면 첫 세션으로. `onActive(activeSession)` 호출(없으면 null).
  - 칩: 탭=`setActiveSessionId(id)`(전역 emit) + `onActive`; 길게누르기 or 칩 우측 **× → closeSession(id)** 확인 후 종료 → 목록 갱신.
  - `showNew`면 **+** 칩: 콜백 `onNew?()`(터미널 탭에서 PWA 생성 모달 트리거용).
- 스타일: DESIGN.md 토큰(크림 바, 코랄 활성 pill, × 작은 회색). `project-bar.tsx`를 베이스로.

### 모바일 — 탭들
- **agent.tsx / changes.tsx**: `<ProjectBar>` → `<SessionBar onActive={s => { if (s) load(s.cwd) else clear }}>`. 활성 세션의 cwd로 로드. 세션 없으면 "실행 중인 세션이 없어요 — 터미널 탭에서 + 로 시작" 안내.
- **files.tsx**: 상단에 `<SessionBar onActive={s => load(s?.cwd ?? null)}>` 추가. 세션 cwd부터 탐색(없으면 드라이브 목록).
- **terminal.tsx**: 상단에 `<SessionBar showNew onActive={...} onNew={...}>`. WebView는 활성 세션을 보이게:
  - WebView src에 `?embed=1&session=<id>` 부여, `key={host.id + ':' + activeId}` 로 세션 바뀌면 remount(그 세션으로 열림).
  - `onNew`: `webviewRef.injectJavaScript("window.__mtbNew && window.__mtbNew()")` — PWA 생성 모달 오픈.
  - 활성 세션 없으면 안내 + + 버튼만.

### PWA (`hub/pwa/index.html`)
- `?embed=1`이면 자체 세션 칩 바 `#bar`를 **CSS로 숨김**(네이티브 바가 대체).
- `?session=<id>`면 로드 후 그 세션을 활성으로(있으면 `switchTo(id)`, 없으면 무시).
- 전역 노출: `window.__mtbNew = openNewSession;` (네이티브 + 가 호출).
- 세션 생성 시 기존처럼 동작(생성 후 그 세션 활성). 네이티브 바는 자기 폴링/포커스로 새 세션을 곧 반영.
- 로직(WS/세션) 변경 없음 — embed 분기와 전역 노출만 추가.

## 데이터 흐름
```
SessionBar(listSessions) → 칩 렌더 → 탭=setActiveSessionId(emit)
  → 모든 탭의 SessionBar가 onSessionChange로 활성 갱신 → onActive(cwd)
  → agent/changes/files: 그 cwd로 재로드
  → terminal: WebView key 변경 → ?session=id 로 remount
칩 × → closeSession(id) → POST /sessions/close → listSessions 갱신; PWA는 WS로 자동 반영
터미널 + → onNew → inject window.__mtbNew() → PWA 생성 모달
```

## 에러 처리
- 세션 0개: 각 탭 안내 문구. 터미널 탭은 + 로 생성 유도.
- closeSession 실패: 무시(목록 갱신이 실제 상태 반영).
- cwd 없는(끝난) 세션 선택 잔존: 갱신 시 사라지면 첫 세션으로 폴백.

## 테스트
- hub: `sessions.test.ts`의 list 기대값 cwd 포함으로 수정 → `npm test` 18 유지(통과).
- 모바일: `npx tsc --noEmit` 0, `npx expo export -p android` 0.
- PWA: inline JS `node --check` 0; `?embed=1`에서 `#bar` 숨김 + `window.__mtbNew` 존재.
- 수동(기기): 세션 2개 → 바에서 전환 시 4탭 다 따라오는지, × 로 종료되는지, + 로 생성되는지.

## 단계
1. hub SessionInfo.cwd + 테스트 수정.
2. lib/hub.ts 세션 상태/헬퍼.
3. session-bar.tsx 신설.
4. PWA embed 분기(#bar 숨김, ?session, window.__mtbNew).
5. terminal/agent/changes/files 탭에 SessionBar 적용(ProjectBar 교체).
6. 검증.

## 비목표
- 끝난 세션 트랜스크립트 열람(세션 바는 실행 중만). 향후 "히스토리" 별도.
- 세션 이름 변경, 재정렬.
