# M1-T2 의 DoD 6항 단위 테스트. 1회성·TTL·5회 폐기·rate·audit·revoke 각각 검증.

import sys
import time
import importlib
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server import auth as auth_mod  # noqa: E402


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(auth_mod, "AUDIT_PATH", tmp_path / "audit.log")
    importlib.reload(auth_mod)
    monkeypatch.setattr(auth_mod, "AUDIT_PATH", tmp_path / "audit.log")
    return auth_mod.AuthStore(jwt_secret=b"test-secret-32-bytes-min-lensssss"), tmp_path


def test_issue_then_pair_ok(store):
    s, _ = store
    code = s.issue_code()
    ok, token, _ = s.attempt_pair(code, device_id="dev1", ip="1.2.3.4", ua="UA")
    assert ok and token


def test_one_time_use(store):
    """DoD: 코드 1회성."""
    s, _ = store
    code = s.issue_code()
    ok1, _, _ = s.attempt_pair(code, "dev1", "1.2.3.4", "UA")
    ok2, _, reason = s.attempt_pair(code, "dev2", "1.2.3.4", "UA")
    assert ok1
    assert not ok2 and reason == "expired_or_used"


def test_ttl_expiry(store, monkeypatch):
    """DoD: 5분 TTL."""
    s, _ = store
    code = s.issue_code()
    fake = time.time() + auth_mod.PAIR_CODE_TTL + 1
    monkeypatch.setattr(auth_mod.time, "time", lambda: fake)
    ok, _, reason = s.attempt_pair(code, "dev1", "1.2.3.4", "UA")
    assert not ok and reason == "expired_or_used"


def test_five_failures_revoke(store):
    """DoD: 5회 실패 즉시 폐기."""
    s, _ = store
    code = s.issue_code()
    for _ in range(auth_mod.PAIR_FAIL_LIMIT):
        s.register_failure(code, "1.2.3.4", "UA")
    ok, _, reason = s.attempt_pair(code, "dev1", "1.2.3.4", "UA")
    assert not ok and reason == "expired_or_used"


def test_rate_limit(store):
    """DoD: IP+UA rate 5/분."""
    s, _ = store
    # 같은 IP+UA 로 RATE_LIMIT_PER_MIN 회 시도 후 추가 시도는 거부.
    for _ in range(auth_mod.RATE_LIMIT_PER_MIN):
        s.attempt_pair("000000", "devX", "9.9.9.9", "UA")
    ok, _, reason = s.attempt_pair("000000", "devX", "9.9.9.9", "UA")
    assert not ok and reason == "rate_limited"


def test_audit_log_written(store):
    """DoD: audit log 작성."""
    s, tmp = store
    code = s.issue_code()
    s.attempt_pair(code, "dev1", "1.2.3.4", "UA")
    log = (tmp / "audit.log").read_text(encoding="utf-8")
    assert '"event": "issue"' in log
    assert '"event": "success"' in log


def test_revoke_blocks_jwt(store):
    """DoD: revoke 후 JWT 검증 실패."""
    s, _ = store
    code = s.issue_code()
    _, token, _ = s.attempt_pair(code, "dev1", "1.2.3.4", "UA")
    assert s.verify_jwt(token) is not None
    assert s.revoke_device("dev1")
    assert s.verify_jwt(token) is None
