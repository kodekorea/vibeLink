# M4 — 텍스트 + 가상 키 주입. 두 메서드:
#   - WM_CHAR (SendMessage): 클래식 Win32 윈도우 (메모장·PowerShell 등). 백그라운드 가능.
#   - SendInput + foreground: Electron/Chromium DOM (Antigravity 등). 윈도우 포커스 가져옴 — 본인 PC 앞 사람 있으면 노출.

from __future__ import annotations
import ctypes
import time as _time
from ctypes import wintypes
from typing import Optional

# 흔한 input control 클래스 후보 (메모장·터미널·일반 IDE 의 텍스트 영역).
INPUT_CONTROL_CLASSES = (
    "Edit",
    "RichEdit",
    "RichEdit20W",
    "RICHEDIT50W",
    "RichEditD2DPT",  # Windows 11 modern Notepad
    "RICHEDIT60W",
)


def _import_win32():
    import win32api  # type: ignore[import-not-found]
    import win32con  # type: ignore[import-not-found]
    import win32gui  # type: ignore[import-not-found]
    return win32api, win32con, win32gui


def find_input_target(parent_hwnd: int, *, _imp=_import_win32) -> int:
    """parent 의 자손 중 Edit/RichEdit 컨트롤 검색. 없으면 parent 자체 반환.

    1단계: 직접 자식 FindWindowEx (빠른 path, 메모장 클래식 처리).
    2단계: EnumChildWindows 재귀 (모던 Windows 11 Notepad·UWP/XAML 깊은 트리 처리).
    """
    _, _, win32gui = _imp()
    for cls in INPUT_CONTROL_CLASSES:
        try:
            child = win32gui.FindWindowEx(parent_hwnd, 0, cls, None)
            if child:
                return child
        except Exception:
            continue

    # 2단계 — 재귀. EnumChildWindows 가 모든 descendant 를 자동 enumerate.
    found: list[int] = []

    def callback(hwnd, _param):
        try:
            cls = win32gui.GetClassName(hwnd)
            if cls in INPUT_CONTROL_CLASSES:
                found.append(hwnd)
                return False  # stop enumeration
        except Exception:
            pass
        return True

    try:
        win32gui.EnumChildWindows(parent_hwnd, callback, None)
    except Exception:
        pass

    return found[0] if found else parent_hwnd


def describe_target(parent_hwnd: int, *, _imp=_import_win32) -> dict:
    """디버그 — target 핸들 + 클래스 + 모든 자손 클래스 일부 반환."""
    _, _, win32gui = _imp()
    target = find_input_target(parent_hwnd, _imp=_imp)
    try:
        target_class = win32gui.GetClassName(target)
    except Exception:
        target_class = "?"
    descendants: list[dict] = []

    def collect(hwnd, _param):
        try:
            cls = win32gui.GetClassName(hwnd)
            title = win32gui.GetWindowText(hwnd) or ""
            descendants.append({"hwnd": hwnd, "class": cls, "title": title[:60]})
        except Exception:
            pass
        return True

    try:
        win32gui.EnumChildWindows(parent_hwnd, collect, None)
    except Exception:
        pass

    return {
        "parent_hwnd": parent_hwnd,
        "target_hwnd": target,
        "target_class": target_class,
        "descendant_count": len(descendants),
        "descendants_sample": descendants[:30],
    }


def inject_text(hwnd: int, text: str, *, _imp=_import_win32) -> int:
    """WM_CHAR 메시지로 텍스트 주입. 자동으로 input target 자식 검색.

    멀티-라인 처리: \n → WM_KEYDOWN VK_RETURN + 짧은 sleep — 터미널 명령 순차 실행.
    """
    win32api, win32con, _ = _imp()
    target = find_input_target(hwnd, _imp=_imp)
    n = 0
    lines = text.split('\n')
    for i, line in enumerate(lines):
        for ch in line:
            win32api.SendMessage(target, win32con.WM_CHAR, ord(ch), 0)
            n += 1
        if i < len(lines) - 1:
            win32api.SendMessage(target, win32con.WM_KEYDOWN, 0x0D, 0)
            win32api.SendMessage(target, win32con.WM_KEYUP, 0x0D, 0)
            _time.sleep(0.15)
            n += 1
    return n


def inject_key(hwnd: int, vk_code: int, *, _imp=_import_win32) -> None:
    """가상 키 코드 (예: VK_RETURN=0x0D) 주입. KEYDOWN + KEYUP 쌍. 자식 target 자동 선택."""
    win32api, win32con, _ = _imp()
    target = find_input_target(hwnd, _imp=_imp)
    win32api.SendMessage(target, win32con.WM_KEYDOWN, vk_code, 0)
    win32api.SendMessage(target, win32con.WM_KEYUP, vk_code, 0)


def inject_enter(hwnd: int, *, _imp=_import_win32) -> None:
    """Enter 키 — 가장 빈번한 단축 함수."""
    inject_key(hwnd, 0x0D, _imp=_imp)


# ---------- SendInput 기반 (Electron/Chromium 도달용, foreground 필요) ----------

INPUT_KEYBOARD = 1
KEYEVENTF_KEYUP = 0x0002
KEYEVENTF_UNICODE = 0x0004
VK_RETURN = 0x0D


class _KEYBDINPUT(ctypes.Structure):
    _fields_ = [
        ("wVk", wintypes.WORD),
        ("wScan", wintypes.WORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ctypes.c_void_p),
    ]


class _MOUSEINPUT(ctypes.Structure):
    _fields_ = [
        ("dx", wintypes.LONG),
        ("dy", wintypes.LONG),
        ("mouseData", wintypes.DWORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ctypes.c_void_p),
    ]


class _HARDWAREINPUT(ctypes.Structure):
    _fields_ = [
        ("uMsg", wintypes.DWORD),
        ("wParamL", wintypes.WORD),
        ("wParamH", wintypes.WORD),
    ]


class _INPUT_UNION(ctypes.Union):
    _fields_ = [("ki", _KEYBDINPUT), ("mi", _MOUSEINPUT), ("hi", _HARDWAREINPUT)]


class _INPUT(ctypes.Structure):
    _fields_ = [("type", wintypes.DWORD), ("u", _INPUT_UNION)]


def _send_one(input_struct: _INPUT) -> None:
    ctypes.windll.user32.SendInput(1, ctypes.byref(input_struct), ctypes.sizeof(_INPUT))


def _key_input(vk: int = 0, scan: int = 0, flags: int = 0) -> _INPUT:
    inp = _INPUT()
    inp.type = INPUT_KEYBOARD
    inp.u.ki = _KEYBDINPUT(wVk=vk, wScan=scan, dwFlags=flags, time=0, dwExtraInfo=None)
    return inp


def _bring_foreground(hwnd: int) -> None:
    """AttachThreadInput 기법 — ALT 트릭 없이 foreground 가져옴.

    ALT 트릭은 IDE/에디터 의 메뉴바를 활성화하는 부작용이 있어 Enter 가 메뉴 열기로 작동.
    AttachThreadInput 은 현재 쓰레드의 input queue 를 target 쓰레드와 잠시 합쳐 foreground 권한 획득.
    """
    user32 = ctypes.windll.user32
    kernel32 = ctypes.windll.kernel32

    fg = user32.GetForegroundWindow()
    fg_thread = user32.GetWindowThreadProcessId(fg, None) if fg else 0
    target_thread = user32.GetWindowThreadProcessId(hwnd, None)
    cur_thread = kernel32.GetCurrentThreadId()

    attached = []
    if cur_thread and target_thread and cur_thread != target_thread:
        if user32.AttachThreadInput(cur_thread, target_thread, True):
            attached.append((cur_thread, target_thread))
    if fg_thread and target_thread and fg_thread != target_thread:
        if user32.AttachThreadInput(fg_thread, target_thread, True):
            attached.append((fg_thread, target_thread))

    try:
        user32.BringWindowToTop(hwnd)
        user32.SetForegroundWindow(hwnd)
        user32.SetFocus(hwnd)
    finally:
        for src, dst in attached:
            user32.AttachThreadInput(src, dst, False)

    _time.sleep(0.05)


def inject_text_sendinput(hwnd: int, text: str) -> int:
    """SendInput Unicode 키보드 입력. 윈도우 포커스 가져옴 — Electron DOM 도달.

    멀티-라인 처리: \n 만나면 Enter 키 송신 + 짧은 sleep — 터미널이 명령 처리할 시간.
    """
    _bring_foreground(hwnd)
    n = 0
    lines = text.split('\n')
    for i, line in enumerate(lines):
        for ch in line:
            _send_one(_key_input(scan=ord(ch), flags=KEYEVENTF_UNICODE))
            _send_one(_key_input(scan=ord(ch), flags=KEYEVENTF_UNICODE | KEYEVENTF_KEYUP))
            n += 1
        if i < len(lines) - 1:
            _send_one(_key_input(vk=VK_RETURN))
            _send_one(_key_input(vk=VK_RETURN, flags=KEYEVENTF_KEYUP))
            _time.sleep(0.15)  # 터미널이 명령 처리·프롬프트 갱신할 시간.
            n += 1
    return n


def inject_enter_sendinput(hwnd: int) -> None:
    """Enter 키 SendInput — foreground 가져온 뒤 VK_RETURN."""
    _bring_foreground(hwnd)
    _send_one(_key_input(vk=VK_RETURN))
    _send_one(_key_input(vk=VK_RETURN, flags=KEYEVENTF_KEYUP))


def inject_key_sendinput(hwnd: int, vk_code: int) -> None:
    """임의 VK 코드 SendInput — foreground + 단일 키 down/up."""
    _bring_foreground(hwnd)
    _send_one(_key_input(vk=vk_code))
    _send_one(_key_input(vk=vk_code, flags=KEYEVENTF_KEYUP))


def inject_key_with_mods_sendinput(
    hwnd: int,
    vk_code: int,
    mods: tuple[int, ...] = (),
    repeat: int = 1,
    *,
    _sender=None,
) -> int:
    """modifier (Shift/Ctrl/Alt 등) 를 누른 채 key 를 repeat 회 누름.

    시퀀스: [mod down]* → ([key down] [key up]) * repeat → [mod up]* (역순).
    Antigravity Electron 같은 Chromium 대상 — foreground 필요.

    반환: 송신된 SendInput 이벤트 총 개수 (mod down/up + key down/up × repeat).
    _sender — 테스트용 mock. 미지정 시 실 SendInput.
    """
    if repeat < 1:
        return 0
    send = _sender or _send_one
    if _sender is None:
        _bring_foreground(hwnd)
    count = 0
    for m in mods:
        send(_key_input(vk=m))
        count += 1
    for _ in range(repeat):
        send(_key_input(vk=vk_code))
        send(_key_input(vk=vk_code, flags=KEYEVENTF_KEYUP))
        count += 2
        if repeat > 1:
            _time.sleep(0.05)  # Antigravity 같은 Electron 권한 모드 처리 시간
    for m in reversed(mods):
        send(_key_input(vk=m, flags=KEYEVENTF_KEYUP))
        count += 1
    return count
