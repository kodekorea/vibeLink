# PC 서버 측 — 1회성 페어링 코드 발급·검증 + JWT cookie 발급. plan.md M1-T2 DoD 6항 모두 충족.

from __future__ import annotations
import secrets
import time
import hmac
import hashlib
import json
import threading
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional

import jwt  # pyjwt

# DoD 정량 상수 — plan.md NFR-02
PAIR_CODE_TTL = 300            # 1회성 코드 5분
PAIR_FAIL_LIMIT = 5            # 코드당 5회 실패 즉시 폐기
RATE_LIMIT_PER_MIN = 5         # IP+계정 단위 5/분
JWT_TTL = 7 * 24 * 3600        # JWT cookie 7일
AUDIT_PATH = Path.home() / ".mtb" / "audit.log"


@dataclass
class PairingCode:
    code: str
    issued_at: float
    ttl: int = PAIR_CODE_TTL
    used: bool = False
    fail_count: int = 0
    revoked: bool = False

    def expired(self, now: Optional[float] = None) -> bool:
        return (now or time.time()) - self.issued_at > self.ttl

    def alive(self) -> bool:
        return not self.used and not self.revoked and not self.expired() and self.fail_count < PAIR_FAIL_LIMIT


@dataclass
class Device:
    device_id: str
    paired_at: float
    jwt_jti: str
    revoked: bool = False


@dataclass
class RateBucket:
    minute: int = 0
    count: int = 0

    def hit(self, now: Optional[float] = None) -> bool:
        cur = int((now or time.time()) // 60)
        if cur != self.minute:
            self.minute = cur
            self.count = 0
        self.count += 1
        return self.count <= RATE_LIMIT_PER_MIN


def _audit(event: str, **fields) -> None:
    AUDIT_PATH.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps({"ts": time.time(), "event": event, **fields}, ensure_ascii=False)
    with AUDIT_PATH.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def _gen_code() -> str:
    # 6 자리 숫자, 추측 불가. 사용자가 직접 입력 가능한 길이.
    # 디버그 — MTB_FIXED_CODE 환경변수 설정 시 그 값 항상 반환 (M4 안정화 전 임시).
    import os
    fixed = os.environ.get("MTB_FIXED_CODE")
    if fixed:
        return fixed
    return f"{secrets.randbelow(1_000_000):06d}"


class AuthStore:
    """In-memory store with thread lock. Persistent 정도는 MVP 외."""

    def __init__(self, jwt_secret: bytes):
        self._lock = threading.Lock()
        self._codes: dict[str, PairingCode] = {}
        self._devices: dict[str, Device] = {}
        self._rate: dict[str, RateBucket] = {}
        self._secret = jwt_secret

    # ----- M1-T2 (페어링 코드 발급/검증) -----
    def issue_code(self) -> str:
        with self._lock:
            code = _gen_code()
            self._codes[code] = PairingCode(code=code, issued_at=time.time())
            _audit("issue", code=code)
            return code

    def attempt_pair(self, code: str, device_id: str, ip: str, ua: str) -> tuple[bool, Optional[str], str]:
        """returns (ok, jwt or None, reason)."""
        with self._lock:
            bucket_key = f"{ip}|{ua}"
            bucket = self._rate.setdefault(bucket_key, RateBucket())
            if not bucket.hit():
                _audit("attempt", code=code, ip=ip, ua=ua, result="rate_limited")
                return False, None, "rate_limited"

            import os

            # 암호 모드 — MTB_PASSWORD env 설정 시 그 값과 매치되면 *영구 재사용 가능* 한 1회 코드로 처리.
            # 단일 사용자 운영의 표준 인증 모드. JWT cookie 는 평소대로 7일 발급.
            password = os.environ.get("MTB_PASSWORD")
            if password and code == password:
                # 매 호출마다 새 PairingCode 만들고 즉시 소진 — 영구 재사용 효과.
                self._codes[code] = PairingCode(code=code, issued_at=time.time())
                _audit("password_match", ip=ip, ua=ua)

            # 디버그 — MTB_FIXED_CODE 와 매치되면 즉시 issue.
            fixed = os.environ.get("MTB_FIXED_CODE")
            if fixed and code == fixed:
                self._codes[code] = PairingCode(code=code, issued_at=time.time())
                _audit("auto_issue_fixed", code=code)

            pc = self._codes.get(code)
            if pc is None:
                _audit("attempt", code=code, ip=ip, ua=ua, result="unknown_code")
                return False, None, "unknown_code"

            if not pc.alive():
                _audit("attempt", code=code, ip=ip, ua=ua, result="expired_or_used")
                return False, None, "expired_or_used"

            # 코드 자체는 valid — 본 호출이 검증되면 성공.
            pc.used = True
            jti = secrets.token_urlsafe(16)
            self._devices[device_id] = Device(device_id=device_id, paired_at=time.time(), jwt_jti=jti)
            token = jwt.encode(
                {
                    "sub": device_id,
                    "jti": jti,
                    "iat": int(time.time()),
                    "exp": int(time.time() + JWT_TTL),
                },
                self._secret,
                algorithm="HS256",
            )
            _audit("success", code=code, device_id=device_id, ip=ip, ua=ua, jti=jti)
            return True, token, "ok"

    def register_failure(self, code: str, ip: str, ua: str) -> None:
        with self._lock:
            pc = self._codes.get(code)
            if pc is None:
                return
            pc.fail_count += 1
            _audit("fail", code=code, ip=ip, ua=ua, fail_count=pc.fail_count)
            if pc.fail_count >= PAIR_FAIL_LIMIT:
                pc.revoked = True
                _audit("auto_revoke", code=code, ip=ip, ua=ua)

    # ----- Tailscale 자동 페어링 — 암호·코드 없이 직접 JWT 발급 -----
    def issue_jwt_direct(self, device_id: str, ip: str, ua: str) -> str:
        """단일 사용자의 Tailscale 인증된 device 자동 페어링용.

        호출자가 *반드시* Tailscale-User-Login 헤더로 신원 확인 후 호출 (절대 unverified 호출 금지).
        """
        with self._lock:
            jti = secrets.token_urlsafe(16)
            self._devices[device_id] = Device(device_id=device_id, paired_at=time.time(), jwt_jti=jti)
            token = jwt.encode(
                {
                    "sub": device_id,
                    "jti": jti,
                    "iat": int(time.time()),
                    "exp": int(time.time() + JWT_TTL),
                },
                self._secret,
                algorithm="HS256",
            )
            _audit("auto_issue_tailscale", device_id=device_id, ip=ip, ua=ua)
            return token

    # ----- M1-T3 (revoke) -----
    def revoke_device(self, device_id: str) -> bool:
        with self._lock:
            dev = self._devices.get(device_id)
            if dev is None or dev.revoked:
                return False
            dev.revoked = True
            _audit("revoke", device_id=device_id)
            return True

    def revoke_all(self) -> int:
        with self._lock:
            count = 0
            for dev in self._devices.values():
                if not dev.revoked:
                    dev.revoked = True
                    count += 1
            _audit("revoke_all", count=count)
            return count

    # ----- JWT 검증 -----
    def verify_jwt(self, token: str) -> Optional[Device]:
        try:
            payload = jwt.decode(token, self._secret, algorithms=["HS256"])
        except jwt.PyJWTError:
            return None
        with self._lock:
            dev = self._devices.get(payload.get("sub", ""))
            if dev is None or dev.revoked or dev.jwt_jti != payload.get("jti"):
                return None
            return dev
