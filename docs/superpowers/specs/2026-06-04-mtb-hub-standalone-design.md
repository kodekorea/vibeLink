# MTB Hub — 독립형 상주 세션 서버 설계

날짜: 2026-06-04
상태: 설계 승인됨 (구현 플랜 작성 전)

## 목표

폰에서 **언제든 다시 붙어서** 여러 프로젝트의 `claude` 세션을 스와이프로 오가며 제어한다.
IDE(Antigravity/VS Code) 창을 열어두는 것과 무관하게 세션이 살아있어야 하고,
Windows 환경에서 **WSL/tmux 없이 네이티브로** 동작해야 한다.

### 해결하는 문제
- 기존 익스텐션은 **VS Code 창 안의 터미널을 미러링** → 그 창이 닫히면 세션도 죽고,
  여러 개를 동시에 보려면 창마다 열고 연결해야 했다.
- 원하는 것: 작업(claude 세션)이 **IDE 창과 분리된 상주 프로세스**에 살고,
  폰에서 북마크만 누르면 아무 때나 재접속·세션 생성·전환이 된다.

### 비목표 (YAGNI)
- 에디터/파일트리/프리뷰 미러링 (기존 익스텐션이 담당, hub 범위 밖)
- tmux 연동 / 데스크톱 터미널에서 `tmux attach` (이 유저는 폰 위주라 불필요)
- 재부팅 생존 (pty는 재부팅 시 죽음 — claude `--continue`로 대화 복구)
- VPS 배포 (호스트 무관하게 짜되, 1차는 Windows 네이티브 PC 상주만)

## 핵심 결정

| 항목 | 결정 | 이유 |
|------|------|------|
| 호스트 | 사용자 PC, Windows 네이티브 | WSL이 진입장벽. ConPTY로 네이티브 동작 |
| 멀티플렉서 | 없음 — 서버가 직접 pty 소유 | tmux 이점(재부팅/desktop attach)이 이 유저엔 marginal |
| 세션 생성 | 폴더 고르면 claude 자동 실행 | "한 프로젝트 = claude 하나" 워크플로우 |
| 폴더 소스 | 즐겨찾기 목록 + 파일 브라우저 | 빠르고 실수 적음 |
| 코드 구조 | 루트에 독립 `hub/` 신설 (A안) | 저위험, 기존 익스텐션 무손상 |
| 인증/URL | `MTB_PASSWORD` + named cloudflared 터널 | 고정 URL → 7일 JWT로 폰 자동 재접속 |

## 아키텍처

```
폰(PWA) ──HTTPS/WSS── named cloudflared 터널 ──→ hub 서버(:47800, PC 상주)
                                                   │
                                                   ├─ HttpServer (PWA + REST + WS)
                                                   ├─ AuthStore       (extension/src/auth.ts 재사용)
                                                   ├─ TunnelManager   (tunnel.ts 재사용, 로거만 교체)
                                                   ├─ ProjectStore    (~/.mtb/projects.json)
                                                   └─ SessionManager ─ node-pty(ConPTY)
                                                          ├─ session A: cwd=E:\projA, pty=셸→claude
                                                          └─ session B: cwd=E:\projB, pty=셸→claude
```

기존 익스텐션(`extension/`)은 **변경하지 않는다.** hub는 PWA를 자기 사본(`hub/pwa/`)으로
포크해서 sessions 전용으로 다듬는다(에디터/파일/프리뷰 탭 제거, 창바→세션바).

### vscode 결합도 (재사용 가능성 확인됨)
- `auth.ts` — vscode 의존 **0**. 그대로 복사/공유.
- `tunnel.ts` — `vscode.OutputChannel`만 로깅에 사용 → `(msg: string) => void` 로거로 교체.
  named 터널(`mode='named'`) 이미 지원.
- `terminal.ts` / `server.ts` — vscode(appRoot node-pty, workspace, OutputChannel)에 결합 →
  hub용으로 **재작성**(SessionManager / HttpServer).

## 컴포넌트

### SessionManager (`hub/src/sessions.ts`)
TerminalManager의 역할 계승. 세션 맵 소유.

```
Session = { id, label, cwd, pty: IPty, buffer: string, cols, rows }
```

- `create(folder: {label, path})`: 그 폴더에서 셸 spawn → `claude` 자동 입력.
  - Windows 기본 셸(`powershell.exe` 또는 설정값)을 `cwd`로 spawn 후,
    pty에 `claude\r` 기록. claude 종료 시 셸 프롬프트로 복귀(세션 유지).
  - 실행 명령은 설정 가능(기본 `claude`).
- `write(id, data)` / `resize(id, cols, rows)` / `close(id)` / `list()` / `resync()`
- pty `onData` → 버퍼 append(상한 200KB) + `terminal_data` 브로드캐스트.
- pty `onExit` → `terminal_exit` 브로드캐스트 + 세션 제거(셸이 죽은 경우).
- 폰 신규 접속 시 `session_list` + 각 세션 버퍼 리플레이.

### ProjectStore (`hub/src/projects.ts`)
- `~/.mtb/projects.json`: `[{ label, path }]` 즐겨찾기 목록 로드/저장.
- 없으면 빈 목록. `GET /projects`로 반환.
- 파일 브라우저로 찾은 폴더를 `POST /projects/add`로 추가 가능.

### HttpServer (`hub/src/server.ts`)
- 정적 PWA(`hub/pwa/`) 서빙.
- REST:
  - `POST /pair` `{code|password, device_id}` → JWT 쿠키 (auth.ts)
  - `GET  /api/me` — 인증 확인
  - `GET  /sessions` — 세션 목록(WS로도 push)
  - `POST /sessions/create` `{path}` → 세션 생성
  - `POST /sessions/close` `{id}`
  - `GET  /projects` — 즐겨찾기 목록
  - `POST /projects/add` `{label, path}`
  - `GET  /fs?path=` — 폴더 브라우즈 (filesystem 헬퍼 재사용/이식)
  - `GET  /qr` `/qr.html` — 첫 페어링 QR
- WS `/ws`(JWT 검증) — S2C/C2S.

### TunnelManager / AuthStore — 재사용
- `auth.ts` 그대로. `tunnel.ts`는 로거 주입형으로 소폭 수정.

### PWA (`hub/pwa/`)
- 기존 `extension/pwa/index.html`의 **칩바 + 스와이프**를 세션 바로 재사용.
- 에디터/파일트리/프리뷰 탭 제거.
- "+ 새 세션" → `/projects`로 즐겨찾기 표시 + "찾아보기"(fs 브라우저) → 선택 시 `/sessions/create`.
- xterm 모바일 스크롤 수정(`.xterm-viewport` CSS + `scrollback:5000`) 그대로 가져옴.

## 데이터 흐름

```
폰 WS 접속(JWT 쿠키)
   → 서버: session_list 전송 + 각 세션 버퍼 리플레이
   → 폰: 세션 칩 렌더, 활성 세션의 terminal_data 표시
폰 "+ 새 세션"
   → GET /projects → 목록/브라우저로 폴더 선택
   → POST /sessions/create {path}
   → 서버: 셸+claude spawn, session_list 갱신 브로드캐스트, 스트림 시작
폰 입력/리사이즈/세션선택
   → WS: { type, sessionId, ... }  → 해당 세션 pty로
폰 세션 종료
   → POST /sessions/close {id} → pty.kill()
```

### 프로토콜 (S2C / C2S)
기존 `windowId` 자리를 `sessionId`로 정리(의미 동일, hub 및 hub 사본 PWA에서만 사용).

```
S2C:
  | { type:'session_list';  sessions: {id,label}[] }     // 기존 window_list
  | { type:'terminal_data'; sessionId; id; data }
  | { type:'terminal_list'; sessionId; list }
  | { type:'terminal_exit'; sessionId; id }
C2S:
  | { type:'terminal_input';  sessionId; id; data }
  | { type:'terminal_resize'; sessionId; id; cols; rows }
  | { type:'terminal_select'; sessionId; id }
```

세션 1개당 pty 1개이므로 세션 내 `terminal_list`/`id`는 단순화 가능(세션=터미널 1:1).
1차는 세션당 단일 pty로 고정한다(세션 안에서 또 여러 탭은 비목표).

## 상주 / 자동 실행
- `hub/실행.bat` — 포그라운드 실행(개발/디버그용).
- `hub/설치-자동실행.bat` — 시작프로그램 폴더(`shell:startup`)에 **숨김 런처(VBS)** 등록 →
  부팅 시 콘솔 창 없이 `node hub/src/index.js` 상주.
- 인코딩 교훈 적용: bat 본문 ASCII + `goto :label`.

## 인증 & URL
- `MTB_PASSWORD`로 영구 재사용 페어링.
- named cloudflared 터널로 **고정 URL** → 폰 북마크 자동 재접속(7일 JWT 쿠키, 같은 origin).
- 첫 기기 등록만 `/qr.html` QR → 비번 입력.

## 에러 처리
- claude/셸 미설치(PATH 없음): spawn 실패 → 세션에 에러 메시지 스트림, 세션은 셸로 유지.
- pty 종료(셸 exit): `terminal_exit` 후 세션 제거, 폰 칩에서 사라짐.
- 터널 끊김: TunnelManager 재시작(향후); 1차는 named 터널 안정성에 의존.
- 잘못된 폴더 경로: `/sessions/create` 400.
- 미인증 WS/REST: 401, 소켓 destroy.

## 테스트 전략
- **단위:** SessionManager(가짜 pty 주입) — create/write/resize/close/list/resync, 버퍼 상한,
  onExit 정리. ProjectStore — json 파싱/추가/없는 파일.
- **프로토콜:** WS 메시지 라우팅(sessionId → 올바른 pty), session_list push.
- **재사용:** auth 기존 테스트 통과 유지.
- **수동(기기):** 프로젝트 2개로 세션 2개 생성 → 스와이프 전환 → 각 claude 동작 →
  폰 끊었다가 재접속 시 세션·버퍼 유지 → 새 세션 생성 → 종료.

## node-pty (standalone)
- `hub/package.json`에 `node-pty` 의존 추가. Windows는 ConPTY prebuilt → `npm i`만으로 빌드.
- **WSL 빌드 춤 불필요** — hub는 순수 Windows Node 프로젝트.
- (향후 VPS 이전 시 Linux에서 `npm i` 재빌드.)

## 단계(요약, 상세는 구현 플랜에서)
1. `hub/` 스캐폴드 + `package.json`(ws, jsonwebtoken, qrcode, node-pty) + tsconfig.
2. `auth.ts` 복사, `tunnel.ts` 로거 주입형으로 이식.
3. SessionManager(가짜 pty 테스트 우선).
4. ProjectStore.
5. HttpServer(REST + WS + 정적).
6. `hub/pwa/` 포크 + 세션 바/새세션 폴더 피커.
7. 실행/자동실행 bat + VBS 런처.
8. 수동 기기 테스트.

## 로드맵 (단계적)
1. **1차 — 동작 확인 프로토타입 (이번 범위):** `hub/`를 `node`로 직접 실행해
   폰에서 세션 생성/스와이프/재접속이 실제로 되는지 검증. bat/VBS 상주까지.
   포장(installer)·코드사이닝 없음. 목표는 "된다"는 확인.
2. **2차 — 자체 앱 / 번들링 (향후):** Node 런타임 + cloudflared + hub를 하나로 묶어
   더블클릭 설치형으로. 후보: pkg/nexe로 단일 exe, 또는 Electron/Tauri 트레이 앱,
   또는 MSIX → **Microsoft Store** 등록. 프로토타입이 검증된 뒤 별도 spec으로 분리.

## 미해결/향후
- 코드 중복(PWA, auth) — 거슬리면 C안(`core/` 추출)으로 리팩터.
- 세션당 다중 탭, 재부팅 자동 복구(세션 재생성 + `--continue`)는 향후.
- 포장/배포(2차 로드맵)는 프로토타입 검증 후 별도 spec.
