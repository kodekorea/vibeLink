# 릴레이 배포 체크리스트 (회사 도메인 `relay.kodekorea.kr` 기준)

라즈베리파이는 구운 상태. 아래를 **순서대로** 하면 폰이 어디서든 허브에 접속된다.
세부 설명은 [`DEPLOY-raspberry-pi.md`](./DEPLOY-raspberry-pi.md) 참고 — 여기는 우리 상황용 실전 순서.

> 흐름: `폰 → relay.kodekorea.kr (DNS) → 회사 공인IP → 라우터 포트포워딩(80/443) → 파이 내부IP → Caddy → 릴레이(:8787) → 허브`

---

## 1. DNS 확인 — 도메인이 회사 공인 IP를 가리키는가
```bash
nslookup relay.kodekorea.kr        # 결과 IP == 회사 공인(외부) IP 여야 함
```
- [ ] A레코드 = 회사 공인 IP 확인
- 회사 공인 IP 모르면: 회사망에서 `curl -s ifconfig.me` (또는 라우터 WAN 상태)

## 2. 라우터 포트포워딩 — 80, 443 → 파이 내부 IP
파이 내부 IP 확인: 파이에서 `hostname -I` (예: `192.168.0.x`)
- [ ] 라우터에서 **TCP 80 → 파이내부IP:80**
- [ ] 라우터에서 **TCP 443 → 파이내부IP:443**
- (회사 IT가 라우터 관리하면 요청. 80은 인증서 발급용, 443은 실제 접속)
- ⚠️ 회사가 이미 80/443을 다른 서비스에 쓰면 충돌 → 기존 리버스프록시에 `relay.kodekorea.kr` 얹거나 다른 포트 협의

## 3. 파이: 코드 + 릴레이 실행
```bash
# (최초) deploy key 등록 후 클론 — DEPLOY-raspberry-pi.md §2 참고
cd ~/vibelink/relay && npm install

# 릴레이 키 생성 (허브와 공유할 비밀)
openssl rand -hex 24        # → <KEY> 로 메모

# systemd 서비스 (DEPLOY-raspberry-pi.md §5)
#   RELAY_KEYS=myhub:<KEY>
#   RELAY_PUBLIC_URL=https://relay.kodekorea.kr
sudo systemctl enable --now vibelink-relay
curl -s localhost:8787/healthz     # {"ok":true,...}
```
- [ ] 릴레이가 `:8787`에서 뜸 (`journalctl -u vibelink-relay -f`)
- [ ] `RELAY_KEYS`에 `myhub:<KEY>` 설정 (비우면 아무나 등록됨)

## 4. 파이: Caddy 자동 HTTPS
`/etc/caddy/Caddyfile`:
```
relay.kodekorea.kr {
    reverse_proxy 127.0.0.1:8787
}
```
```bash
sudo systemctl restart caddy
sudo journalctl -u caddy -f        # 인증서 발급 로그 확인
```
- [ ] Caddy가 `relay.kodekorea.kr` 인증서 자동 발급 (1,2번이 돼 있어야 발급됨)
- (DuckDNS는 진짜 도메인 있으니 **불필요 — 건너뜀**)

## 5. 외부에서 검증 — 셀룰러로!
폰 WiFi 끄고 **셀룰러**에서:
```
https://relay.kodekorea.kr/healthz   →  {"ok":true,"hubs":[...]}
```
- [ ] 셀룰러에서 healthz 200
- ⚠️ **회사 내부 WiFi에선 안 될 수 있음**(헤어핀 NAT) — 정상. 테스트는 셀룰러로.

## 6. 허브(PC) 연결
허브 띄울 때 환경변수 (desktop 설정창/`.env` 또는 시스템 환경변수):
```
MTB_TUNNEL=relay
MTB_RELAY_URL=wss://relay.kodekorea.kr
MTB_RELAY_KEY=<KEY>                 (§3에서 만든 값)
MTB_RELAY_ID=myhub                 (RELAY_KEYS의 id와 동일)
MTB_RELAY_PUBLIC_URL=https://relay.kodekorea.kr
```
허브 재시작 → 로그에 `릴레이 접속 URL(폰 페어링): https://relay.kodekorea.kr/h/myhub`
파이 로그엔 `hub registered: myhub`
- [ ] 허브가 릴레이에 등록됨
- [ ] 폰 앱에서 호스트 추가: URL `https://relay.kodekorea.kr/h/myhub`, 비번 = `MTB_PASSWORD`

---

## 막히면 보는 곳
- healthz 안 뜸 → 1(DNS) / 2(포트포워딩) / 4(Caddy 인증서) 순서로 확인
- 폰이 `502 hub not connected` → 허브 미등록. `MTB_RELAY_KEY` == `RELAY_KEYS` 값 일치 확인
- WS 안 붙음 → Caddy는 업그레이드 자동 전달. 중간 프록시 있으면 `Upgrade/Connection` 헤더 통과 확인

## 이 작업과 별개로 남은 것 (참고)
- 📱 앱·데톱 최신 기능 실기기 테스트 (지금 진행 중)
- 🔁 codex: 허브를 **새 PATH 셸에서 재시작**해야 codex 세션 동작 (설치는 완료)
- 📦 릴리스 빌드: `build-apk.bat` / `build-desktop.bat` 산출물 확인
