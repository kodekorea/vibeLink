# M1-T3 CLI 파싱 + payload 구성 단위 테스트. HTTP 호출 자체는 mock (server 통합 테스트는 별도).

import sys
import json
from pathlib import Path
from unittest.mock import patch, MagicMock
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server import cli as cli_mod  # noqa: E402


def test_parser_revoke_all_required_args():
    """`revoke --all` 정상 파싱."""
    args = cli_mod.build_parser().parse_args(["revoke", "--all"])
    assert args.cmd == "revoke"
    assert args.all is True


def test_parser_revoke_device():
    args = cli_mod.build_parser().parse_args(["revoke", "--device", "dev1"])
    assert args.device == "dev1"


def test_parser_revoke_mutually_exclusive():
    """`--all` 과 `--device` 동시 지정은 거부."""
    with pytest.raises(SystemExit):
        cli_mod.build_parser().parse_args(["revoke", "--all", "--device", "dev1"])


def test_parser_issue():
    args = cli_mod.build_parser().parse_args(["issue"])
    assert args.cmd == "issue"


def test_revoke_all_post_body(capsys):
    """`revoke --all` 시 payload `{"device_id": "ALL"}` 송신."""
    fake_resp = MagicMock()
    fake_resp.read.return_value = b'{"revoked_count": 3}'
    fake_resp.__enter__ = lambda s: s
    fake_resp.__exit__ = lambda *a: False

    captured_payload = {}

    def fake_urlopen(req, timeout=5):
        captured_payload["body"] = json.loads(req.data.decode())
        captured_payload["url"] = req.full_url
        return fake_resp

    with patch.object(cli_mod.urllib.request, "urlopen", fake_urlopen):
        args = cli_mod.build_parser().parse_args(["revoke", "--all"])
        args.func(args)

    assert captured_payload["body"] == {"device_id": "ALL"}
    assert "/admin/revoke" in captured_payload["url"]
    out = capsys.readouterr().out
    assert "3건" in out


def test_issue_prints_code(capsys):
    fake_resp = MagicMock()
    fake_resp.read.return_value = b'{"code": "123456", "ttl_seconds": 300}'
    fake_resp.__enter__ = lambda s: s
    fake_resp.__exit__ = lambda *a: False

    with patch.object(cli_mod.urllib.request, "urlopen", lambda req, timeout=5: fake_resp):
        args = cli_mod.build_parser().parse_args(["issue"])
        args.func(args)

    out = capsys.readouterr().out
    assert "123456" in out
    assert "300" in out
