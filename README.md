# mobile_term_bridge

> LTE 휴대폰에서 사무실 PC 의 Antigravity 바이브 코딩 터미널 영역을 실시간 미러링 + 입력 + push 알림 받는 단일 사용자 도구.
>
> 단일 사용자 전용. 본인 외 접속 차단.

## 산출 기반
- 기획서 별도 보관 (29 turn 회의 결과, status AGREED, 2026-05-25)
- WBS 순서: **M1 (인증+터널) → M2 (캡처+송신) → M3 (PWA) → M4 (입력 주입) → M5 (push) → M6 (종합 검증)**

## 현재 진행 (2026-05-26)
- ✅ M0 scaffold + BAT (실행·페어링·모든폐기·설치)
- ✅ M1-T2 페어링 + JWT (7/7 tests). `MTB_PASSWORD=<your_password>` 영구 암호 + Tailscale 헤더 자동 + **localhost 자동 페어링** (PC 직접 접속 시 폼 우회).
- ✅ M1-T3 CLI (6/6 tests)
- ✅ M1-T1 외부 도달 — **Tailscale Serve** (Cloudflare 대신, 카드 없이 가능)
- ✅ M2-T1 Win32 캡처 + PrintWindow(PW_RENDERFULLCONTENT) Electron 호환
- ✅ M2 영역 한정 crop (드래그 선택, 윈도우별 localStorage)
- ✅ M3-T1 PWA 페어링 + 영상 + 입력 UI
- ✅ M3 줌 슬라이더 + 전체 화면 탭 + 하단 절반 모드 + **3번째 OCR 검수 탭** (캡처 + 블록별 인라인 편집 + ▶▶ 전체 순차 실행, 한글 줄 자동 필터 + 영문 모델 default)
- ✅ M3 **터미널 상태 단추** (전체화면+Antigravity) — 픽셀 diff 기반 🟢대기/🔴실행중/🟡변화, idle 5s hold 후 Web Audio 두-톤 차임
- ✅ M4 입력 주입 — WM_CHAR (메모장·PowerShell), SendInput+AttachThreadInput (Antigravity·Electron). Multi-line 순차 + Enter 자동.
- ✅ M5-T1 regex prompt detector (10/10 tests)
- ✅ M5-T2 ProcessEndWatcher (7/7 tests)
- ✅ **UI 개선 4건 (2026-05-26)**: ① `.status.busy` 노랑+펄스 진행중 상태 (페어링/전송/OCR/음성 등 진행중을 초록 (완료색) 으로 표시하던 혼란 해소). ② 방향키 4개 (↑↓←→) — 표준+전체화면 양쪽 + `_NAV_VKS` 에 37/39 추가 (auto-end skip). ③ 222/999 단추 제거 + 🤔추천 ("다음 무슨 작업하면 좋을까?") 추가 + 커밋·푸쉬 → 💾커밋푸시 ("커밋하고 푸시해줘") 통합. ④ 🔓 권한모드 단추 (Shift+Tab × 1, Claude Code 권한 모드 전환) — server `inject_key_with_mods_sendinput()` + `/input` 의 `mods` / `repeat` 파라미터 신규.
- ✅ **터미널 탭 전환 단추 (⬅️탭 / 탭➡️)** — Ctrl+Alt+← / Ctrl+Alt+→. Antigravity keybindings.json 에 `workbench.action.terminal.focusNext/Previous` 사전 설정 필요.
- ✅ **프로젝트 폴더 매크로 (2026-05-26)** — ⚙️ 폴더 단추로 label+path 등록 (localStorage). 폴더 단추 클릭 시 자동 시퀀스 — Ctrl+Shift+` (새 터미널) → 800ms 대기 → `cd "<path>"` Enter. 휴대폰 단독으로 폴더 추가·삭제·전환 가능. 키바인드·확장 사전 설정 불요.
- ✅ **단추 UI 정리 (2026-05-26 → 2026-05-27)** — 단일 grid → 처음엔 5 그룹 (응답/키/터미널/제어/매크로) → 공간 차지 과다 피드백으로 **3 그룹 (응답+제어, 키+터미널, 매크로)** 으로 합침. 그룹별 border-left 색상 (회색·파랑·녹색) + 작은 라벨. ⛔Ctrl+C 인터럽트, ➕새 터미널 (Ctrl+Shift+`), ➗스플릿 (Ctrl+Shift+5) 추가. 권한모드 Shift+Tab × 3 → × 1.
- ✅ **OCR 검수 fixture 인프라 (2026-05-26)** — `server/ocr_log.py` 누적 저장 (capture+raw+meta+corrected, LRU 200), `/ocr/feedback` 엔드포인트, PWA 💾 검수 저장 단추 + paste 시 자동 silent 저장. `server/ocr_stats.py` 로 raw vs 검수본 글자 diff Top 20 패턴 분석. 정확도 개선 fixture 시드 용도. ▶▶ 전체 순차는 통합 paste 로 변경 — 엔터는 사용자 직접 (오인식 코드 자동 실행 방지).
- ✅ 총 **52/52** 단위 테스트 통과 (modifier+key+repeat 3건 + ocr_log 5건 포함).
- ⬜ M5-T3 Cloudflare Worker push relay (카드 필요, 보류) — 종 단추 폐기, push 도입 시 부활
- ⬜ M5-T4 PWA push 수신 (M5-T3 후속)
- ⬜ M6 통합 시나리오 본격 사용 검증

## 디렉토리
```
mobile_term_bridge/
├── README.md
├── requirements.txt
├── 실행.bat              (Windows 실행)
├── 설치.bat              (의존성 설치)
├── .gitignore
├── server/               (PC 서버 측)
│   ├── server.py         (HTTP + WSS 메인)
│   ├── auth.py           (페어링 + JWT) ← 1차 구현 완료
│   ├── capture.py        (Win32 영역 캡처) [stub]
│   ├── inject.py         (ConPTY / SendMessage 입력 주입) [stub]
│   ├── push.py           (trigger + Cloudflare Worker relay) [stub]
│   └── audit.py          (JSON Lines 감사 로그)
├── pwa/                  (휴대폰 PWA 클라이언트)
│   ├── index.html
│   ├── manifest.json
│   └── sw.js             (Service Worker)
├── worker/               (Cloudflare Worker)
│   └── push_relay.js
└── tests/
    └── test_auth.py      (M1-T2 단위 테스트)
```

## 운영 제약 (plan.md 1.2 발췌)
- PWA 단일 트랙 — Native FCM 영구 배제 (사용자 선호: 업데이트 부담 회피).
- Push trigger 자동 명령 실행 영구 금지.
- 사무실 PC 24/7 가동 + outbound HTTPS 가정.
- MVP 한도: code_lines ≤ 400, files ≤ 8 (사용자 명시 예외).

## 의존성 (M1 기준)
- Python 3.10+
- `pyjwt` (JWT 발급/검증)
- `aiohttp` (HTTP + WSS 서버)
- `psutil` (M5 process watcher)
- `Pillow` + `mss` + `pywin32` (M2 캡처)

## 실행 (정식 페어링 흐름)

### 1. 사전 1회
```powershell
.\설치.bat          # 가상환경 + 의존성 설치
```

### 2. 서버 가동
```powershell
.\실행.bat
```
포트 47800 에서 LISTEN. 종료는 Ctrl+C.

### 3. Tailscale HTTPS 노출 (한 번만 — 본 PC 영구)
```powershell
tailscale serve --bg --https=443 http://localhost:47800
```
→ `https://<this-pc>.<tailnet>.ts.net/` URL 출력. 휴대폰 Tailscale 가입 시 자동 도달.

### 4. 페어링 (휴대폰 ↔ PC, 매 신규 device 마다 1회)
PC 에서 `.\페어링.bat` 더블클릭 → 6자리 코드 출력 (5분 1회용).
휴대폰 PWA 페어링 폼에 코드 입력 → JWT cookie 발급 → 7일 유효.

### 5. 사용
PWA 에 영구 표시되는 main UI 에서:
- 윈도우 드롭다운 (자동 로드) → 캡처할 윈도우 선택
- 자동(2fps) 또는 캡처 단발
- 영역 설정 (드래그) → 영역 확정 — 윈도우 타이틀별 저장
- 줌 슬라이더 (100~400%) 텍스트 가독성
- 전체 화면 탭 → 하단 절반 모드 (휴대폰 텍스트 ~2배)
- 입력 박스 + Electron 모드 (Antigravity 같은 Chromium 앱) / 일반 모드 (메모장·PowerShell)

### 6. device 폐기 (휴대폰 분실 등)
`.\모든폐기.bat` 더블클릭 → 발급된 모든 JWT 즉시 무효화. 새 페어링부터 다시 사용.

## 디버그 (옵션)
임시 페어링 코드 고정 — `set MTB_FIXED_CODE=000000` env 후 서버 가동. 운영 시 사용 금지.
