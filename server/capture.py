from __future__ import annotations
# M2-T1 — Win32 윈도우 영역 한정 캡처 → JPEG/PNG bytes. pywin32 + Pillow 의존.
# Antigravity 터미널 윈도우뿐 아니라 임의 타이틀 regex 로 윈도우 핸들 탐색 가능 (Notepad 로 동작 검증 권고).
import io
import re
from typing import Optional

# DPI awareness — import 시점에 한 번 설정. 안 하면 PrintWindow 가 *논리 픽셀* (150% scaling 시 1.5배 작음) 반환 → OCR 픽셀 밀도 부족.
def _set_dpi_aware():
    try:
        import ctypes
        # PROCESS_PER_MONITOR_DPI_AWARE = 2 (Win 8.1+ 권장)
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except (AttributeError, OSError):
        try:
            import ctypes
            ctypes.windll.user32.SetProcessDPIAware()
        except (AttributeError, OSError):
            pass

_set_dpi_aware()


def _import_win32():
    """Lazy import — 비 Windows 환경에서 모듈 import 자체 실패 회피 (테스트용)."""
    import win32gui  # type: ignore[import-not-found]
    import win32ui   # type: ignore[import-not-found]
    import win32con  # type: ignore[import-not-found]
    return win32gui, win32ui, win32con


def _import_pil():
    from PIL import Image  # type: ignore[import-not-found]
    return Image


def find_window_by_title(pattern: str, *, _imp=_import_win32) -> Optional[int]:
    """Title regex 와 매치되는 첫 visible 윈도우 핸들 반환. 없으면 None."""
    win32gui, _, _ = _imp()
    pat = re.compile(pattern, re.IGNORECASE)
    matches: list[int] = []

    def callback(hwnd, _):
        if win32gui.IsWindowVisible(hwnd):
            title = win32gui.GetWindowText(hwnd)
            if title and pat.search(title):
                matches.append(hwnd)
        return True

    win32gui.EnumWindows(callback, None)
    return matches[0] if matches else None


def list_visible_windows(*, _imp=_import_win32) -> list[tuple[int, str]]:
    """디버그용 — 현재 보이는 모든 윈도우의 (hwnd, title) 리스트. 빈 타이틀 제외."""
    win32gui, _, _ = _imp()
    result: list[tuple[int, str]] = []

    def callback(hwnd, _):
        if win32gui.IsWindowVisible(hwnd):
            title = win32gui.GetWindowText(hwnd)
            if title:
                result.append((hwnd, title))
        return True

    win32gui.EnumWindows(callback, None)
    return result


def get_window_rect(hwnd: int, *, _imp=_import_win32) -> tuple[int, int, int, int]:
    """윈도우의 화면 좌표 (left, top, right, bottom)."""
    win32gui, _, _ = _imp()
    return win32gui.GetWindowRect(hwnd)


def capture_window(hwnd: int, jpeg_quality: int = 85, crop: Optional[tuple[int, int, int, int]] = None, bottom_half: bool = False, lossless: bool = False, upscale: int = 1, *, _imp=_import_win32, _pil=_import_pil) -> bytes:
    """윈도우 핸들의 클라이언트 영역을 JPEG / PNG bytes 로 캡처.

    1) PrintWindow + PW_RENDERFULLCONTENT 우선 (Windows 8.1+, Electron/GPU 가속 앱 호환).
    2) 그래도 실패 시 BitBlt 폴백 (클래식 Win32 윈도우).

    OCR 용: lossless=True (PNG) + upscale=2~3 (nearest-neighbor) — JPEG artifact 회피 + 픽셀 밀도 향상.
    """
    import ctypes
    win32gui, win32ui, win32con = _imp()
    Image = _pil()

    # 최소화된 창은 PrintWindow/BitBlt 모두 비어있는 비트맵 반환.
    # SW_SHOWNOACTIVATE 로 *포커스 가져오지 않고* 복원 (다른 작업 방해 X).
    user32 = ctypes.windll.user32
    if user32.IsIconic(hwnd):
        SW_SHOWNOACTIVATE = 4
        user32.ShowWindow(hwnd, SW_SHOWNOACTIVATE)
        # 짧은 sleep — 윈도우 컴포지터가 첫 프레임 렌더할 시간.
        import time as _time
        _time.sleep(0.15)

    left, top, right, bottom = win32gui.GetClientRect(hwnd)
    width, height = right - left, bottom - top
    if width <= 0 or height <= 0:
        raise RuntimeError(f"invalid window dimensions hwnd={hwnd} w={width} h={height}")

    hwnd_dc = win32gui.GetWindowDC(hwnd)
    src_dc = win32ui.CreateDCFromHandle(hwnd_dc)
    mem_dc = src_dc.CreateCompatibleDC()
    bmp = win32ui.CreateBitmap()
    bmp.CreateCompatibleBitmap(src_dc, width, height)
    mem_dc.SelectObject(bmp)
    try:
        # PW_RENDERFULLCONTENT = 0x00000002 — Electron/Chromium 컴포지터 강제 렌더.
        PW_RENDERFULLCONTENT = 0x00000002
        user32 = ctypes.windll.user32
        result = user32.PrintWindow(hwnd, mem_dc.GetSafeHdc(), PW_RENDERFULLCONTENT)
        if result != 1:
            # 폴백 — 클래식 BitBlt.
            mem_dc.BitBlt((0, 0), (width, height), src_dc, (0, 0), win32con.SRCCOPY)

        info = bmp.GetInfo()
        bits = bmp.GetBitmapBits(True)
        img = Image.frombuffer("RGB", (info["bmWidth"], info["bmHeight"]), bits, "raw", "BGRX", 0, 1)

        if crop is not None:
            cx, cy, cw, ch = crop
            # 좌표·크기 이미지 경계 안으로 clamp.
            cx = max(0, min(cx, img.width - 1))
            cy = max(0, min(cy, img.height - 1))
            cw = max(1, min(cw, img.width - cx))
            ch = max(1, min(ch, img.height - cy))
            img = img.crop((cx, cy, cx + cw, cy + ch))

        if bottom_half and img.height >= 2:
            # 현 이미지의 하단 절반만 — 터미널 최신 출력 확대 보기용.
            half = img.height // 2
            img = img.crop((0, half, img.width, img.height))

        if upscale > 1:
            # nearest-neighbor — 텍스트 에지 sharp 보존. OCR 정확도 향상.
            new_size = (img.width * upscale, img.height * upscale)
            img = img.resize(new_size, Image.NEAREST)

        buf = io.BytesIO()
        if lossless:
            img.save(buf, format="PNG", optimize=False)
        else:
            img.save(buf, format="JPEG", quality=jpeg_quality)
        return buf.getvalue()
    finally:
        try:
            mem_dc.DeleteDC()
            src_dc.DeleteDC()
            win32gui.ReleaseDC(hwnd, hwnd_dc)
            win32gui.DeleteObject(bmp.GetHandle())
        except Exception:
            pass
