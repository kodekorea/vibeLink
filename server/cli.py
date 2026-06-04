# mtb CLI — 페어링 코드 발급 · device 폐기. plan.md M1-T3 DoD. stdlib urllib 만 사용.
# 사용: python -m server.cli revoke --all / --device <id> / issue.
# 서버 (loopback 127.0.0.1:47800) 가 실행 중이어야 함.

from __future__ import annotations
import argparse
import json
import sys
import urllib.request
import urllib.error

DEFAULT_BASE = "http://127.0.0.1:47800"


def _post(base: str, path: str, payload: dict) -> dict:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{base}{path}",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return json.loads(resp.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        sys.stderr.write(f"HTTP {e.code}: {e.read().decode('utf-8', 'replace')}\n")
        sys.exit(1)
    except urllib.error.URLError as e:
        sys.stderr.write("[ERROR] mtb 서버에 도달할 수 없습니다 (loopback 47800).\n"
                         f"        원인: {e}\n"
                         "        먼저 .\\실행.bat 또는 python -m server.server 로 서버를 켜세요.\n")
        sys.exit(1)


def cmd_revoke(args: argparse.Namespace) -> None:
    target = "ALL" if args.all else args.device
    data = _post(args.base, "/admin/revoke", {"device_id": target})
    if args.all:
        print(f"전체 device 폐기 완료 — {data.get('revoked_count', 0)}건.")
    else:
        ok = data.get("ok")
        print(f"device {args.device}: {'폐기됨' if ok else '대상 없음 또는 이미 폐기'}.")


def cmd_issue(args: argparse.Namespace) -> None:
    data = _post(args.base, "/admin/issue", {})
    print(f"페어링 코드: {data['code']}  (유효 {data['ttl_seconds']}초)")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="mtb", description="mobile_term_bridge CLI")
    p.add_argument("--base", default=DEFAULT_BASE, help="서버 주소 (기본 loopback)")
    sub = p.add_subparsers(dest="cmd", required=True)

    r = sub.add_parser("revoke", help="device JWT 폐기")
    g = r.add_mutually_exclusive_group(required=True)
    g.add_argument("--all", action="store_true", help="모든 device 한 번에 폐기")
    g.add_argument("--device", help="특정 device_id 폐기")
    r.set_defaults(func=cmd_revoke)

    i = sub.add_parser("issue", help="새 페어링 코드 발급")
    i.set_defaults(func=cmd_issue)
    return p


def main() -> None:
    args = build_parser().parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
