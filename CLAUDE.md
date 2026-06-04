# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Single-user tool that mirrors a Windows PC terminal (Antigravity/Electron IDE) to a mobile PWA over Tailscale, with keyboard injection and push-trigger detection. The Python server runs on the PC; the mobile browser connects to it directly.

## Commands

```powershell
# Install
pip install -r requirements.txt        # or .\설치.bat on Windows

# Run server (port 47800)
python -m server.server                # or .\실행.bat on Windows

# CLI (server must be running)
python -m server.cli issue             # generate pairing code
python -m server.cli revoke --all      # revoke all devices
python -m server.cli revoke --device <id>

# Tests
pytest                                 # all 52 tests
pytest tests/test_auth.py             # single file
pytest -k test_issue_then_pair_ok     # single test

# OCR accuracy analysis
python -m server.ocr_stats            # raw vs corrected diff, top-20 error patterns
```

## Architecture

### Server (`server/`)

`server.py` is the aiohttp app wiring everything together on port 47800. All routes are defined in `build_app()`. Admin endpoints (`/admin/*`) accept loopback-only connections.

**Auth flow** (`auth.py`): `AuthStore` is an in-memory thread-safe store. Pairing code TTL is 300 s; 5 failed attempts auto-revoke the code; rate limit is 5/min per IP+UA. JWT (HS256, 7-day) secret is persisted at `~/.mtb/jwt_secret` so server restarts don't invalidate cookies. Two fast-paths bypass the code: `MTB_PASSWORD` env (permanent reusable password) and Tailscale auto-pair (Tailscale-User-Login header or localhost).

**Capture** (`capture.py`): Uses `PrintWindow(PW_RENDERFULLCONTENT)` first (Electron/GPU compositing), falling back to `BitBlt`. DPI awareness is set at import time. Supports crop rect, bottom-half crop, and nearest-neighbor upscale (for OCR clarity).

**Inject** (`inject.py`): Two injection methods selectable per request via `method` param:
- `wm_char` — `SendMessage(WM_CHAR)` to the deepest `Edit`/`RichEdit` descendant; works in background (no focus steal).
- `sendinput` — `SendInput` with `AttachThreadInput` foreground steal; required for Electron/Chromium (Antigravity). Supports `mods` (modifier VK list) and `repeat` params via `inject_key_with_mods_sendinput`.

Multi-line text (`\n`) inserts VK_RETURN + 150 ms sleep so the terminal can process each command.

**OCR** (`ocr.py` + `ocr_log.py`): Server-side OCR uses `pytesseract` (auto-detects `tesseract.exe`). Each call is logged to `logs/ocr/<timestamp>/` (capture.png, raw.txt, meta.json, optional corrected.txt). LRU keeps 200 entries. The PWA also ships `tesseract.js` for client-side OCR (bundled in `pwa/lib/` and `pwa/data/`).

**Push triggers** (`push.py`): `TriggerDetector` matches regex patterns against terminal output chunks fed via `POST /admin/output` (loopback). Matched events go into `TRIGGER_STORE` (deque maxlen=100); PWA polls `GET /triggers`. 30 s debounce per tag. `ProcessEndWatcher` polls PID liveness via `psutil`. **Auto-executing commands on trigger is permanently forbidden.**

### PWA (`pwa/`)

`index.html` is a single-file PWA (no build step) served by the Python server. Tesseract.js WASM + language models are bundled locally — no CDN dependency. Service worker (`sw.js`) enables offline caching.

### Cloudflare Worker (`worker/push_relay.js`)

M5-T3 stub — not implemented. VAPID Web Push relay for when Cloudflare subscription is available.

## Key env vars

| Var | Purpose |
|-----|---------|
| `MTB_PASSWORD` | Permanent reusable pairing password (production auth mode) |
| `MTB_FIXED_CODE` | Fixed 6-digit debug code — **never use in production** |

## Platform notes

`capture.py` and `inject.py` use `pywin32` + `ctypes` Win32 APIs — server runs on Windows only. Tests mock Win32 imports so they run on any platform. `pywin32` is listed as `; sys_platform == 'win32'` in requirements.txt.

Server-side OCR requires `Tesseract.exe` installed separately (auto-detected at `C:\Program Files\Tesseract-OCR\tesseract.exe` or on PATH).

## Persistent state locations

- `~/.mtb/jwt_secret` — JWT signing secret (auto-created, chmod 600)
- `~/.mtb/audit.log` — JSON Lines audit trail
- `logs/ocr/` — OCR fixture logs (LRU 200)
