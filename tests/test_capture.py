# M2-T1 단위 테스트 — Win32 모듈 mock 으로 동작 검증. 실 환경 통합 테스트는 수동 (Notepad).

import sys
import types
import io
from pathlib import Path
from unittest.mock import MagicMock
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server import capture as capture_mod  # noqa: E402


class FakeWin32Gui:
    def __init__(self, windows):
        # windows = list of (hwnd, title, visible)
        self.windows = windows
        self._next_id = 100

    def IsWindowVisible(self, hwnd):
        for h, _, vis in self.windows:
            if h == hwnd:
                return vis
        return False

    def GetWindowText(self, hwnd):
        for h, t, _ in self.windows:
            if h == hwnd:
                return t
        return ""

    def EnumWindows(self, callback, param):
        for hwnd, _, _ in self.windows:
            callback(hwnd, param)


def make_fake_imp(windows):
    fake_gui = FakeWin32Gui(windows)
    fake_ui = MagicMock()
    fake_con = MagicMock()
    return lambda: (fake_gui, fake_ui, fake_con)


def test_find_window_by_title_simple():
    imp = make_fake_imp([(101, "Notepad - 메모장", True)])
    assert capture_mod.find_window_by_title("notepad", _imp=imp) == 101


def test_find_window_by_title_no_match():
    imp = make_fake_imp([(101, "Notepad", True)])
    assert capture_mod.find_window_by_title("xyz", _imp=imp) is None


def test_find_window_by_title_skips_invisible():
    """비활성/숨겨진 윈도우는 매치 제외."""
    imp = make_fake_imp([
        (101, "Notepad", False),
        (102, "Notepad - other", True),
    ])
    assert capture_mod.find_window_by_title("notepad", _imp=imp) == 102


def test_find_window_by_title_regex_pattern():
    imp = make_fake_imp([(101, "Antigravity — main.py", True)])
    assert capture_mod.find_window_by_title(r"antigravity.*main\.py", _imp=imp) == 101


def test_find_window_by_title_first_match_only():
    """다중 매치 시 첫 매치 반환."""
    imp = make_fake_imp([
        (101, "Notepad - one", True),
        (102, "Notepad - two", True),
    ])
    assert capture_mod.find_window_by_title("notepad", _imp=imp) == 101
