# SETUP — 후배용 초기 셋업 가이드

원작자 환경 정보 (hostname, 암호, IP) 는 *마스킹* 됐습니다. 본인 환경에 맞게 채워 사용.

## 1. 사전 요구

- **OS**: Windows 10/11 (PC 서버 측)
- **Python**: 3.10 이상
- **휴대폰**: PWA 가능한 모바일 브라우저 (Chrome/Safari)
- **외부 도달 수단** (LTE 에서 PC 로): 하나 선택
  - **Tailscale** (권장 — Cloudflare 카드 등록 불필요)
  - **Cloudflare Tunnel** (카드 등록 필요)
  - **포트 포워딩 + DDNS** (집/사무실 라우터 설정 가능 시)

## 2. 본인 환경 값 설정 (필수)

### 2-1. 본인 암호 지정

`실행.bat` 파일 6번째 줄:
```bat
set MTB_PASSWORD=<여기에_본인_암호_숫자_입력>
```
→ 본인이 기억할 6자리 숫자 등으로 변경. 예: `set MTB_PASSWORD=123456`.
이 값은 *휴대폰 PWA 페어링 폼* 에 입력할 값이기도 함. 영구 사용.

### 2-2. (선택) 디버그 고정 코드 제거

`실행.bat` 에 `set MTB_FIXED_CODE=...` 가 있다면 *운영 시 절대 사용 금지* — 누구나 그 코드로 페어링 가능. 제거 또는 주석 처리.

## 3. 설치 (1회)

PC 의 mobile_term_bridge 폴더로 가서:
```powershell
.\설치.bat
```
가상환경 `.venv/` 생성 + `requirements.txt` 의존성 설치.

## 4. 외부 도달 (Tailscale 권장)

### Tailscale 설치 + 가입
1. https://tailscale.com 가입 (Google/Microsoft/이메일 무료)
2. PC + 휴대폰 양쪽 Tailscale 앱 설치 + 같은 계정 로그인.

### Tailscale Serve 등록 (PC 1회만)
```powershell
tailscale serve --bg --https=443 http://localhost:47800
```
→ `https://<your-pc>.<your-tailnet>.ts.net/` URL 출력. 휴대폰 LTE 에서 이 URL 로 접근 가능.

(Tailscale 안 쓰면 본 단계 대신 본인 외부 도달 수단으로 47800 포트를 휴대폰에서 접근 가능하게.)

## 5. 서버 실행

```powershell
.\실행.bat
```
→ 47800 포트 LISTEN. 종료는 Ctrl+C.

## 6. 휴대폰 페어링

### 방법 A: 암호 영구 모드 (권장, §2-1 설정 후)
1. 휴대폰 PWA URL (`https://<pc>.<tailnet>.ts.net/`) 접속.
2. 페어링 폼에 §2-1 의 본인 암호 입력.
3. JWT cookie 자동 발급 — 7일 유효.

### 방법 B: 일회용 6자리 코드 모드
1. PC 에서 `.\페어링.bat` 더블클릭 → 6자리 코드 출력 (5분 한정 1회용).
2. 휴대폰 폼에 그 코드 입력.

## 7. 휴대폰 분실/도난 시

```powershell
.\모든폐기.bat
```
모든 device JWT 즉시 무효화. 다시 §6 페어링부터.

## 8. 디렉토리 한눈에

```
mobile_term_bridge/
├── README.md             원본 기능 설명
├── SETUP.md              본 가이드
├── requirements.txt
├── 실행.bat / 페어링.bat / 모든폐기.bat / 설치.bat
├── server/               PC 서버 (Python)
├── pwa/                  휴대폰 PWA (HTML+JS+tesseract WASM)
├── worker/               Cloudflare Worker (push, 보류)
└── tests/                단위 테스트 (52 통과 시점)
```

## 9. 테스트 실행 (선택)

```powershell
.venv\Scripts\activate
pytest -q
```
→ 52 단위 테스트 통과 확인.

## 10. 알려진 제약

- **본인 단독 사용 가정**: 외부 다중 사용자 X. 인증은 1 password = 다 device 영구. 다중 사용자 운영 시 별도 보강 필요.
- **M5-T3/T4 push 미완**: Cloudflare 카드 등록 보류로 push 알림 기능 비활성. 기본 사용에 영향 없음 (캡처+입력 중심).
- **Antigravity Electron 입력**: Chromium 앱은 `SendInput + AttachThreadInput` 기법 (PWA 의 "Electron 모드" 체크박스). 일반 Win32 (메모장·PowerShell) 는 표준 `WM_CHAR`.

---

문제 시 원작자에게 문의.
