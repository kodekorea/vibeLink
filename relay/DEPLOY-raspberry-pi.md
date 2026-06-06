# VibeLink 릴레이 — 라즈베리파이 배포 가이드

이 릴레이는 폰↔허브(내 PC) 사이 바이트를 그대로 중계하는 **단순 파이프**다
(의존성 `ws` 하나, 약 280줄). 허브가 **밖으로(outbound)** 릴레이에 붙으므로
내 PC가 NAT/CGNAT 뒤에 있어도 폰이 어디서든 접속된다. 릴레이만 **공인에서
도달 가능한 곳**(공인 IP + 포트포워딩)에 있으면 된다 — 라즈베리파이에 딱.

리소스: 유휴 시 RAM ~30–60MB, CPU ~0%. 터미널 트래픽은 초당 수 KB. Pi Zero 2 W도 충분.

---

## 0. 전제 (네트워크)

릴레이가 인터넷에서 도달 가능해야 한다:
- **포트포워딩**: 공유기에서 외부 `80`, `443` → 파이 내부 IP로 포워딩 (TLS용 80은 인증서 발급, 443은 실제 접속).
- **도메인/서브도메인**: 폰이 `https://relay.내도메인` 으로 붙는다. 공인 IP가 **동적**이면 DuckDNS 같은 DDNS로 고정 호스트명 확보 (아래 §6 참고). 공인 IP가 **고정**이면 A 레코드만 그쪽으로.
- 회선이 **CGNAT**면 포트포워딩이 원천 불가 → 이 경우 파이 대신 공인 IP를 주는 VPS가 필요.

> 내부 포트: 릴레이는 기본 `8787`에서 듣고, Caddy가 443(HTTPS/WSS)을 받아 `127.0.0.1:8787`로 넘긴다.

---

## 1. 라즈베리파이 준비

Raspberry Pi OS (64-bit 권장). Node 20+ 설치:

```bash
# NodeSource로 Node 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git
node -v   # v20.x
npm -v
which npm # 보통 /usr/bin/npm — systemd에서 쓸 경로
```

---

## 2. 코드 가져오기

### 방법 A — git (권장, 업데이트 쉬움)

레포가 private이므로 파이에 **읽기 전용 deploy key**를 쓴다(개인 토큰보다 안전).

```bash
# 파이에서 키 생성
ssh-keygen -t ed25519 -f ~/.ssh/vibelink_deploy -N "" -C "pi-relay"
cat ~/.ssh/vibelink_deploy.pub
```
출력된 공개키를 GitHub 레포 → **Settings → Deploy keys → Add deploy key** 에 붙이고
(쓰기 권한 체크 안 함 = 읽기 전용) 저장. 그다음 SSH 설정:

```bash
cat >> ~/.ssh/config <<'EOF'
Host github-vibelink
  HostName github.com
  User git
  IdentityFile ~/.ssh/vibelink_deploy
  IdentitiesOnly yes
EOF

# 얕은 클론 (node_modules는 안 받으므로 작음)
git clone --depth 1 git@github-vibelink:shain1912/mobile_term_bridge_distrib.git ~/vibelink
cd ~/vibelink/relay
```

> 필요하면 relay 폴더만 받는 sparse checkout도 가능하지만, 소스만이라 전체 클론도 가볍다.

### 방법 B — scp (간단, 수동 업데이트)

PC에서 `relay/` 폴더만 복사:
```bash
scp -r E:\mobile_term_bridge_distrib\relay pi@<파이IP>:~/vibelink-relay
# 파이에서: cd ~/vibelink-relay
```

---

## 3. 릴레이 의존성 설치

```bash
cd ~/vibelink/relay      # (방법 B면 ~/vibelink-relay)
npm install              # ws + tsx 설치 (네이티브 컴파일 없음 → ARM에서 그냥 됨)
```

---

## 4. 릴레이 키 만들기

허브와 릴레이가 공유할 비밀키. 아무 긴 랜덤 문자열:

```bash
openssl rand -hex 24
# 예: 3f9c1e...   ← 이걸 KEY 로 쓴다 (PC 허브 설정에도 동일하게)
```

허브 식별자(`id`)는 아무 라벨이면 된다 (예: `myhub`). `RELAY_KEYS="myhub:<위 키>"`.

---

## 5. systemd 서비스 (24h 자동 실행)

`/etc/systemd/system/vibelink-relay.service`:

```ini
[Unit]
Description=VibeLink relay
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/vibelink/relay
Environment=RELAY_PORT=8787
Environment=RELAY_KEYS=myhub:REPLACE_WITH_KEY
Environment=RELAY_PUBLIC_URL=https://relay.내도메인
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

> `User`/`WorkingDirectory`/`/usr/bin/npm` 은 실제 값으로. (`whoami`, `pwd`, `which npm`)

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now vibelink-relay
sudo systemctl status vibelink-relay
journalctl -u vibelink-relay -f      # 로그: "listening on :8787", "registered keys for ids: myhub"
```

로컬 확인:
```bash
curl -s localhost:8787/healthz       # {"ok":true,"hubs":[...],"publicUrl":"..."}
```

---

## 6. (동적 IP면) DuckDNS — 무료 DDNS

공인 IP가 바뀌는 가정용 회선이면 고정 호스트명 확보:
1. https://www.duckdns.org 로그인 → 서브도메인 만들기 (예: `myrelay` → `myrelay.duckdns.org`).
2. 파이에서 5분마다 IP 갱신 cron:
```bash
mkdir -p ~/duckdns
echo 'echo url="https://www.duckdns.org/update?domains=myrelay&token=<DUCKDNS토큰>&ip=" | curl -k -o ~/duckdns/duck.log -K -' > ~/duckdns/duck.sh
chmod +x ~/duckdns/duck.sh
( crontab -l 2>/dev/null; echo '*/5 * * * * ~/duckdns/duck.sh >/dev/null 2>&1' ) | crontab -
~/duckdns/duck.sh && cat ~/duckdns/duck.log   # "OK"
```
이때 도메인은 `myrelay.duckdns.org`. (고정 IP면 이 단계 생략하고 본인 도메인 A레코드 사용.)

---

## 7. Caddy — 자동 HTTPS + 리버스 프록시

폰은 `wss://`(HTTPS)로 붙어야 하므로 TLS가 필수. Caddy가 Let's Encrypt 인증서를
자동 발급/갱신하고 WS 업그레이드도 그대로 넘긴다.

```bash
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get install -y caddy
```

`/etc/caddy/Caddyfile` (기존 내용 지우고):
```
relay.내도메인 {
    reverse_proxy 127.0.0.1:8787
}
```
(DuckDNS면 `myrelay.duckdns.org { reverse_proxy 127.0.0.1:8787 }`)

```bash
sudo systemctl restart caddy
sudo systemctl status caddy
# 외부에서: https://relay.내도메인/healthz  → {"ok":true,...}
```

> 라우터에서 80,443 → 파이로 포워딩돼 있어야 Caddy가 인증서를 받고 외부 접속이 된다.

---

## 8. PC(허브) 쪽 연결 설정

허브를 띄울 때 환경변수로 릴레이를 켠다. (`desktop` 앱이면 설정창/`.env`,
직접 실행이면 `hub/run.bat` 위에 추가하거나 시스템 환경변수로.)

```
MTB_TUNNEL=relay
MTB_RELAY_URL=wss://relay.내도메인          (릴레이 컨트롤 — /_hub 는 자동 부착)
MTB_RELAY_KEY=<§4에서 만든 키>
MTB_RELAY_ID=myhub                         (RELAY_KEYS의 id와 동일)
MTB_RELAY_PUBLIC_URL=https://relay.내도메인  (폰 접속 URL 안내용)
```

허브를 재시작하면 로그에:
```
릴레이 접속 URL(폰 페어링): https://relay.내도메인/h/myhub
```
파이 릴레이 로그엔 `hub registered: myhub`.

> 여러 PC를 쓰면 PC마다 다른 `MTB_RELAY_ID`/키를 주고 릴레이 `RELAY_KEYS`에 `id1:key1,id2:key2`로 나열.

---

## 9. 폰 페어링

폰 앱에서 호스트 추가 시 URL = **`https://relay.내도메인/h/myhub`**, 비밀번호는
허브의 `MTB_PASSWORD`. 이후엔 LAN/외부 구분 없이 이 URL로 접속된다.
(허브 JWT 인증은 종단간 그대로 — 릴레이는 토큰을 읽거나 위조하지 않는다.)

---

## 10. 업데이트

```bash
cd ~/vibelink && git pull
cd relay && npm install        # 의존성 바뀌었을 때만
sudo systemctl restart vibelink-relay
```
(scp 방식이면 PC에서 다시 scp 후 restart.)

---

## 11. 트러블슈팅

- `https://relay.내도메인/healthz` 가 안 열림 → 포트포워딩(80/443) 또는 DNS(A레코드/DuckDNS) 확인. `sudo journalctl -u caddy -f` 로 인증서 발급 로그.
- 폰이 `502 hub not connected` → PC 허브가 릴레이에 등록 안 됨. 허브 로그에 등록 메시지/키 일치(`MTB_RELAY_KEY` == `RELAY_KEYS`의 값) 확인.
- 릴레이 로그 `WARNING: RELAY_KEYS empty` → 키를 안 줘서 아무나 등록 가능(개발용). 운영에선 반드시 `RELAY_KEYS` 설정.
- WS가 안 붙음 → Caddy는 기본적으로 업그레이드를 넘긴다. 중간에 다른 프록시가 있으면 `Upgrade`/`Connection` 헤더 통과 확인.
- 동적 IP가 바뀌어 끊김 → DuckDNS cron 동작 확인(`cat ~/duckdns/duck.log`).

---

## 환경변수 요약

| 쪽 | 변수 | 예시 | 의미 |
|---|---|---|---|
| 릴레이(파이) | `RELAY_PORT` | `8787` | 내부 listen 포트 |
| | `RELAY_KEYS` | `myhub:KEY` | 허용 id:key 목록(콤마로 다중) |
| | `RELAY_PUBLIC_URL` | `https://relay.내도메인` | 로그/health 표시용 |
| | `RELAY_HUB_PATH` | `/_hub`(기본) | 허브 컨트롤 업그레이드 경로 |
| 허브(PC) | `MTB_TUNNEL` | `relay` | 릴레이 모드 켜기 |
| | `MTB_RELAY_URL` | `wss://relay.내도메인` | 릴레이 컨트롤 베이스 |
| | `MTB_RELAY_KEY` | `KEY` | 릴레이와 공유 비밀 |
| | `MTB_RELAY_ID` | `myhub` | 허브 식별자 |
| | `MTB_RELAY_PUBLIC_URL` | `https://relay.내도메인` | 폰 URL 안내용 |
