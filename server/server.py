# HTTP + WSS 메인 서버. M1 페어링 + M2 capture + M4 inject + M5 detector 통합.

from __future__ import annotations
import secrets
import sys
from pathlib import Path

from aiohttp import web

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from collections import deque  # noqa: E402
import threading  # noqa: E402
from typing import Optional  # noqa: E402

from server.auth import AuthStore  # noqa: E402
from server.push import TriggerDetector, ProcessEndWatcher  # noqa: E402

# 누적 trigger event store — PWA 가 polling 으로 색깔 단추 표시.
# 실 push relay (M5-T3 Worker) 도입 전까지 *서버 측 알림 buffer* 역할.
TRIGGER_STORE: deque = deque(maxlen=100)
TRIGGER_LOCK = threading.Lock()

# JWT secret — 첫 실행 시 생성 후 ~/.mtb/jwt_secret 에 영속. 재시작 시 같은 secret 로드 →
# 기존 쿠키 무효화 안 됨. 본인 단독 도구, 파일 권한 600 적용.
_SECRET_PATH = Path.home() / ".mtb" / "jwt_secret"

def _load_or_create_secret() -> bytes:
    _SECRET_PATH.parent.mkdir(parents=True, exist_ok=True)
    if _SECRET_PATH.exists():
        return _SECRET_PATH.read_bytes()
    sec = secrets.token_bytes(32)
    _SECRET_PATH.write_bytes(sec)
    try:
        import os
        os.chmod(_SECRET_PATH, 0o600)
    except OSError:
        pass
    return sec

JWT_SECRET = _load_or_create_secret()
STORE = AuthStore(JWT_SECRET)
DETECTOR = TriggerDetector()
# WATCHER 는 psutil 의존 — Linux WSL 에서도 import 가능. 본 서버 프로세스에서 watch 등록 가능.
try:
    WATCHER: ProcessEndWatcher | None = ProcessEndWatcher()
except ImportError:
    WATCHER = None


def _auth_ok(request: web.Request):
    token = request.cookies.get("mtb_jwt")
    if not token:
        return None
    return STORE.verify_jwt(token)


async def index(request: web.Request) -> web.Response:
    pwa_path = Path(__file__).resolve().parents[1] / "pwa" / "index.html"
    if pwa_path.exists():
        return web.FileResponse(pwa_path)
    return web.Response(text="mobile_term_bridge — pwa/index.html missing")


async def manifest(request: web.Request) -> web.Response:
    p = Path(__file__).resolve().parents[1] / "pwa" / "manifest.json"
    return web.FileResponse(p) if p.exists() else web.Response(status=404)


async def service_worker(request: web.Request) -> web.Response:
    p = Path(__file__).resolve().parents[1] / "pwa" / "sw.js"
    return web.FileResponse(p) if p.exists() else web.Response(status=404)


async def static_lib(request: web.Request) -> web.Response:
    """tesseract.js 라이브러리 파일 정적 서빙."""
    name = request.match_info["name"]
    p = Path(__file__).resolve().parents[1] / "pwa" / "lib" / name
    if not p.exists() or ".." in name:
        return web.Response(status=404)
    return web.FileResponse(p)


async def static_data(request: web.Request) -> web.Response:
    """tesseract.js 언어 모델 (eng.traineddata.gz 등) 정적 서빙."""
    name = request.match_info["name"]
    p = Path(__file__).resolve().parents[1] / "pwa" / "data" / name
    if not p.exists() or ".." in name:
        return web.Response(status=404)
    return web.FileResponse(p)


async def issue_code_cli(request: web.Request) -> web.Response:
    if request.remote not in ("127.0.0.1", "::1"):
        return web.Response(status=403, text="loopback only")
    code = STORE.issue_code()
    return web.json_response({"code": code, "ttl_seconds": 300})


async def auto_pair_tailscale(request: web.Request) -> web.Response:
    """암호 없이 자동 JWT 발급.

    경로 2개:
      1. Tailscale Serve — `Tailscale-User-Login` 헤더 존재 시 tailnet 가입자 == 본인.
      2. localhost (127.0.0.1/::1) — 본인 PC 에서 직접 접속 시. OS 로컬 접근 == 본인.
    그 외 (외부 IP, 헤더 없음) 시 401 → 페어링 폼 표시.
    """
    ts_user = request.headers.get("Tailscale-User-Login", "").strip()
    remote = request.remote or ""
    is_local = remote in ("127.0.0.1", "::1")
    if not ts_user and not is_local:
        return web.json_response({"error": "no Tailscale header and not localhost"}, status=401)
    # device_id — Tailscale 우선, 없으면 localhost.
    if ts_user:
        xff = request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
        ts_ip = xff or remote or "unknown"
        device_id = f"ts:{ts_user}:{ts_ip}"
        ident_ip = ts_ip
    else:
        device_id = f"local:{remote}"
        ident_ip = remote
    ua = request.headers.get("User-Agent", "")
    token = STORE.issue_jwt_direct(device_id, ident_ip, ua)
    resp = web.json_response({"ok": True, "device_id": device_id, "ts_user": ts_user or "(localhost)"})
    resp.set_cookie(
        "mtb_jwt",
        token,
        httponly=True,
        secure=False,
        samesite="Strict",
        max_age=7 * 24 * 3600,
    )
    return resp


async def attempt_pair(request: web.Request) -> web.Response:
    body = await request.json()
    code = (body.get("code") or "").strip()
    device_id = (body.get("device_id") or "").strip()
    if not code or not device_id:
        return web.json_response({"error": "code, device_id required"}, status=400)
    ip = request.remote or ""
    ua = request.headers.get("User-Agent", "")
    ok, token, reason = STORE.attempt_pair(code, device_id, ip, ua)
    if not ok:
        if reason == "rate_limited":
            return web.json_response({"error": reason}, status=429)
        STORE.register_failure(code, ip, ua)
        return web.json_response({"error": reason}, status=401)
    resp = web.json_response({"ok": True})
    resp.set_cookie(
        "mtb_jwt",
        token,
        httponly=True,
        secure=False,  # MVP 로컬 테스트 한정. 운영은 cloudflared 종단 후 True.
        samesite="Strict",
        max_age=7 * 24 * 3600,
    )
    return resp


async def revoke_cli(request: web.Request) -> web.Response:
    if request.remote not in ("127.0.0.1", "::1"):
        return web.Response(status=403, text="loopback only")
    body = await request.json()
    target = body.get("device_id")
    if target == "ALL":
        n = STORE.revoke_all()
        return web.json_response({"revoked_count": n})
    ok = STORE.revoke_device(target or "")
    return web.json_response({"ok": ok})


def _resolve_hwnd(request: web.Request, cap_mod) -> tuple[Optional[int], Optional[web.Response]]:
    """?hwnd=<int> 우선, 없으면 ?window=<regex>. (hwnd, error_response) 반환."""
    h = request.query.get("hwnd")
    if h:
        try:
            return int(h), None
        except ValueError:
            return None, web.json_response({"error": "invalid hwnd"}, status=400)
    target = request.query.get("window", "Antigravity")
    hwnd = cap_mod.find_window_by_title(target)
    if hwnd is None:
        try:
            wins = cap_mod.list_visible_windows()[:30]
        except Exception:
            wins = []
        return None, web.json_response({
            "error": "window not found",
            "available_sample": [t for _, t in wins],
        }, status=404)
    return hwnd, None


async def get_capture(request: web.Request) -> web.Response:
    if not _auth_ok(request):
        return web.json_response({"error": "auth required"}, status=401)
    try:
        from server import capture as cap
    except ImportError as e:
        return web.json_response({"error": f"capture unavailable: {e}"}, status=500)
    hwnd, err = _resolve_hwnd(request, cap)
    if err is not None:
        return err
    # 영역 한정 — crop_x, crop_y, crop_w, crop_h 모두 있으면 적용.
    crop = None
    cx = request.query.get("crop_x")
    cy = request.query.get("crop_y")
    cw = request.query.get("crop_w")
    ch = request.query.get("crop_h")
    if all(v is not None for v in (cx, cy, cw, ch)):
        try:
            crop = (int(cx), int(cy), int(cw), int(ch))
        except ValueError:
            return web.json_response({"error": "invalid crop params"}, status=400)
    bottom_half = request.query.get("bh") == "1"
    # OCR 모드 — lossless PNG + nearest-neighbor 업스케일 (default 2). JPEG artifact 회피.
    lossless = request.query.get("ocr") == "1" or request.query.get("fmt") == "png"
    try:
        upscale = int(request.query.get("upscale", "1"))
    except ValueError:
        upscale = 1
    upscale = max(1, min(4, upscale))
    try:
        img = cap.capture_window(hwnd, crop=crop, bottom_half=bottom_half, lossless=lossless, upscale=upscale)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)
    mime = "image/png" if lossless else "image/jpeg"
    return web.Response(body=img, content_type=mime)


async def run_ocr(request: web.Request) -> web.Response:
    """서버측 OCR — 캡처 + pytesseract (네이티브 Tesseract.exe) → 텍스트 반환.

    tesseract.js 대비: 큰 원본 (서버 가용 메모리), 네이티브 속도, 한글 정확도 ↑.
    """
    if not _auth_ok(request):
        return web.json_response({"error": "auth required"}, status=401)
    try:
        from server import capture as cap
        from server import ocr as ocr_mod
    except ImportError as e:
        return web.json_response({"error": str(e)}, status=500)
    hwnd, err = _resolve_hwnd(request, cap)
    if err is not None:
        return err
    crop = None
    cx = request.query.get("crop_x")
    cy = request.query.get("crop_y")
    cw = request.query.get("crop_w")
    ch = request.query.get("crop_h")
    if all(v is not None for v in (cx, cy, cw, ch)):
        try:
            crop = (int(cx), int(cy), int(cw), int(ch))
        except ValueError:
            return web.json_response({"error": "invalid crop params"}, status=400)
    lang = request.query.get("lang", "eng")
    try:
        psm = int(request.query.get("psm", "6"))
    except ValueError:
        psm = 6
    try:
        upscale = int(request.query.get("upscale", "3"))
    except ValueError:
        upscale = 3
    upscale = max(1, min(4, upscale))
    try:
        img_bytes = cap.capture_window(hwnd, crop=crop, lossless=True, upscale=upscale)
        text = ocr_mod.ocr_bytes(img_bytes, lang=lang, psm=psm)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)
    # OCR 로그 저장 — 입력 이미지 + raw + meta. log_id 응답에 실어 클라가 검수본 feedback 시 참조.
    log_id = None
    try:
        from server import ocr_log
        win_title = ""
        try:
            import win32gui  # type: ignore[import-not-found]
            win_title = win32gui.GetWindowText(hwnd)
        except Exception:
            pass
        log_id = ocr_log.record_ocr(img_bytes, text, {
            "hwnd": hwnd,
            "window_title": win_title,
            "lang": lang,
            "psm": psm,
            "upscale": upscale,
            "crop": list(crop) if crop else None,
            "source": "server",
        })
    except Exception:
        pass
    return web.json_response({
        "text": text,
        "lang": lang,
        "psm": psm,
        "upscale": upscale,
        "image_bytes": len(img_bytes),
        "log_id": log_id,
    })


async def post_ocr_feedback(request: web.Request) -> web.Response:
    """OCR 결과 사용자 검수본 저장. body: {log_id, corrected}."""
    if not _auth_ok(request):
        return web.json_response({"error": "auth required"}, status=401)
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "invalid json"}, status=400)
    log_id = (data or {}).get("log_id")
    corrected = (data or {}).get("corrected", "")
    if not log_id:
        return web.json_response({"error": "log_id required"}, status=400)
    from server import ocr_log
    if not ocr_log.record_corrected(str(log_id), str(corrected)):
        return web.json_response({"error": "invalid or unknown log_id"}, status=404)
    return web.json_response({"ok": True})


async def list_windows(request: web.Request) -> web.Response:
    """디버그 — 보이는 윈도우 타이틀 모두 (인증 필요)."""
    if not _auth_ok(request):
        return web.Response(status=401, text="auth required")
    try:
        from server import capture as cap
        wins = cap.list_visible_windows()
        return web.json_response({"windows": [{"hwnd": h, "title": t} for h, t in wins]})
    except ImportError as e:
        return web.json_response({"error": str(e)}, status=500)


async def post_input(request: web.Request) -> web.Response:
    if not _auth_ok(request):
        return web.json_response({"error": "auth required"}, status=401)
    data = await request.json()
    text = data.get("text", "")
    enter = bool(data.get("enter", False))
    try:
        from server import capture as cap
        from server import inject as inj
    except ImportError as e:
        return web.json_response({"error": f"win32 unavailable: {e}"}, status=500)

    # hwnd 우선, 없으면 window title.
    h = data.get("hwnd")
    if h is not None:
        try:
            hwnd = int(h)
        except (TypeError, ValueError):
            return web.json_response({"error": "invalid hwnd"}, status=400)
    else:
        hwnd = cap.find_window_by_title(data.get("window", "Antigravity"))
        if hwnd is None:
            return web.json_response({"error": "window not found"}, status=404)

    method = data.get("method", "wm_char")  # "wm_char" (백그라운드) | "sendinput" (foreground, Electron 용)
    vk = data.get("vk")  # int VK 코드 (예: 0x1B = Esc) — text 와 함께 사용 시 text 후 vk.
    mods = data.get("mods") or []  # 동시 누름 modifier VK list (예: [0x10] = Shift). sendinput 한정.
    try:
        repeat = max(1, int(data.get("repeat", 1)))
    except (TypeError, ValueError):
        repeat = 1
    info = inj.describe_target(hwnd)
    if method == "sendinput":
        n = inj.inject_text_sendinput(hwnd, text) if text else 0
        if enter:
            inj.inject_enter_sendinput(hwnd)
        if vk is not None:
            if mods or repeat > 1:
                inj.inject_key_with_mods_sendinput(hwnd, int(vk), tuple(int(m) for m in mods), repeat)
            else:
                inj.inject_key_sendinput(hwnd, int(vk))
    else:
        n = inj.inject_text(hwnd, text) if text else 0
        if enter:
            inj.inject_enter(hwnd)
        if vk is not None:
            # wm_char path 는 modifier 미지원 — 단일 key 만.
            for _ in range(repeat):
                inj.inject_key(hwnd, int(vk))
    return web.json_response({
        "sent_chars": n,
        "enter": enter,
        "vk": vk,
        "method": method,
        "parent_hwnd": info["parent_hwnd"],
        "target_hwnd": info["target_hwnd"],
        "target_class": info["target_class"],
        "descendant_count": info["descendant_count"],
    })


async def inspect_window(request: web.Request) -> web.Response:
    """디버그 — 특정 window 의 자손 트리 전체 dump (인증 필요)."""
    if not _auth_ok(request):
        return web.Response(status=401, text="auth required")
    target = request.query.get("window", "")
    if not target:
        return web.json_response({"error": "window required"}, status=400)
    try:
        from server import capture as cap
        from server import inject as inj
    except ImportError as e:
        return web.json_response({"error": str(e)}, status=500)
    hwnd = cap.find_window_by_title(target)
    if hwnd is None:
        return web.json_response({"error": "window not found"}, status=404)
    return web.json_response(inj.describe_target(hwnd))


async def feed_terminal_output(request: web.Request) -> web.Response:
    """터미널 출력 chunk 를 받아 push trigger 검출. 검출 시 TRIGGER_STORE 에 누적 — PWA 가 polling 으로 확인."""
    if request.remote not in ("127.0.0.1", "::1"):
        return web.Response(status=403)
    data = await request.json()
    text = data.get("text", "")
    event = DETECTOR.detect(text)
    if event is None:
        return web.json_response({"triggered": False})
    with TRIGGER_LOCK:
        TRIGGER_STORE.append({
            "kind": event.kind,
            "tag": event.tag,
            "ts": event.detected_at,
            "matched": event.matched_text,
        })
    return web.json_response({
        "triggered": True,
        "kind": event.kind,
        "tag": event.tag,
        "matched": event.matched_text,
    })


async def trigger_status(request: web.Request) -> web.Response:
    """누적 trigger event 조회 — PWA 알림 표시용 polling."""
    if not _auth_ok(request):
        return web.json_response({"error": "auth required"}, status=401)
    with TRIGGER_LOCK:
        return web.json_response({
            "count": len(TRIGGER_STORE),
            "recent": list(TRIGGER_STORE)[-5:],
        })


async def trigger_dismiss(request: web.Request) -> web.Response:
    """누적 trigger 모두 dismiss — 사용자가 알림 본 후 클릭."""
    if not _auth_ok(request):
        return web.json_response({"error": "auth required"}, status=401)
    with TRIGGER_LOCK:
        n = len(TRIGGER_STORE)
        TRIGGER_STORE.clear()
    return web.json_response({"dismissed": n})


def build_app() -> web.Application:
    app = web.Application()
    app.router.add_get("/", index)
    app.router.add_get("/manifest.json", manifest)
    app.router.add_get("/sw.js", service_worker)
    app.router.add_get(r"/lib/{name:.+}", static_lib)
    app.router.add_get(r"/data/{name:.+}", static_data)
    app.router.add_post("/admin/issue", issue_code_cli)
    app.router.add_post("/admin/revoke", revoke_cli)
    app.router.add_post("/admin/output", feed_terminal_output)
    app.router.add_post("/pair", attempt_pair)
    app.router.add_post("/auto-pair", auto_pair_tailscale)
    app.router.add_get("/capture", get_capture)
    app.router.add_get("/ocr", run_ocr)
    app.router.add_post("/ocr/feedback", post_ocr_feedback)
    app.router.add_get("/windows", list_windows)
    app.router.add_get("/inspect", inspect_window)
    app.router.add_post("/input", post_input)
    app.router.add_get("/triggers", trigger_status)
    app.router.add_post("/triggers/dismiss", trigger_dismiss)
    return app


if __name__ == "__main__":
    web.run_app(build_app(), host="127.0.0.1", port=47800)
