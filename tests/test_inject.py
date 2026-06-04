# M4 단위 테스트 — Win32 SendMessage mock 으로 호출 검증.

import sys
from pathlib import Path
from unittest.mock import MagicMock
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server import inject as inject_mod  # noqa: E402


def make_fake_imp(child_for_class=None):
    """child_for_class: {class_name: child_hwnd} — FindWindowEx 가 반환할 값."""
    api = MagicMock()
    con = MagicMock()
    con.WM_CHAR = 0x0102
    con.WM_KEYDOWN = 0x0100
    con.WM_KEYUP = 0x0101
    gui = MagicMock()
    mapping = child_for_class or {}

    def fake_find(parent, _, cls, __):
        return mapping.get(cls, 0)

    gui.FindWindowEx = fake_find
    return api, con, lambda: (api, con, gui)


def test_inject_text_sends_one_wm_char_per_char():
    """자식 Edit 없으면 parent hwnd 그대로."""
    api, con, imp = make_fake_imp()
    n = inject_mod.inject_text(hwnd=999, text="abc", _imp=imp)
    assert n == 3
    assert api.SendMessage.call_count == 3
    calls = api.SendMessage.call_args_list
    assert calls[0].args[:3] == (999, con.WM_CHAR, ord("a"))
    assert calls[1].args[:3] == (999, con.WM_CHAR, ord("b"))
    assert calls[2].args[:3] == (999, con.WM_CHAR, ord("c"))


def test_inject_text_uses_edit_child():
    """자식 Edit 컨트롤 발견 시 그 hwnd 에 송신."""
    api, con, imp = make_fake_imp(child_for_class={"Edit": 7777})
    inject_mod.inject_text(hwnd=999, text="hi", _imp=imp)
    # parent 가 아니라 Edit child 에 송신
    assert api.SendMessage.call_args_list[0].args[0] == 7777


def test_inject_text_uses_richedit_d2dpt_for_modern_notepad():
    """Windows 11 모던 Notepad — RichEditD2DPT 자식 컨트롤 매치."""
    api, _, imp = make_fake_imp(child_for_class={"RichEditD2DPT": 5555})
    inject_mod.inject_text(hwnd=999, text="x", _imp=imp)
    assert api.SendMessage.call_args_list[0].args[0] == 5555


def test_inject_text_empty():
    api, _, imp = make_fake_imp()
    n = inject_mod.inject_text(hwnd=999, text="", _imp=imp)
    assert n == 0
    api.SendMessage.assert_not_called()


def test_inject_text_unicode_hangul():
    api, _, imp = make_fake_imp()
    n = inject_mod.inject_text(hwnd=1, text="안녕", _imp=imp)
    assert n == 2


def test_inject_key_keydown_keyup_pair():
    api, con, imp = make_fake_imp()
    inject_mod.inject_key(hwnd=42, vk_code=0x0D, _imp=imp)
    assert api.SendMessage.call_count == 2
    calls = api.SendMessage.call_args_list
    assert calls[0].args[:3] == (42, con.WM_KEYDOWN, 0x0D)
    assert calls[1].args[:3] == (42, con.WM_KEYUP, 0x0D)


def test_inject_enter_uses_0x0D():
    api, con, imp = make_fake_imp()
    inject_mod.inject_enter(hwnd=7, _imp=imp)
    assert api.SendMessage.call_count == 2
    assert api.SendMessage.call_args_list[0].args[2] == 0x0D


def test_find_input_target_no_child_returns_parent():
    """자식 매치 안 됨 → parent 그대로."""
    _, _, imp = make_fake_imp()
    assert inject_mod.find_input_target(parent_hwnd=42, _imp=imp) == 42


def test_find_input_target_returns_first_match():
    """클래스 후보 순서대로 검색, 첫 매치 반환."""
    _, _, imp = make_fake_imp(child_for_class={"RichEdit": 200, "Edit": 100})
    # INPUT_CONTROL_CLASSES 첫 후보가 "Edit" 이므로 100
    assert inject_mod.find_input_target(parent_hwnd=999, _imp=imp) == 100


def test_inject_key_with_mods_shift_tab_x3():
    """Shift+Tab × 3 — Claude Code 권한모드 전환 시퀀스.

    예상 송신: SHIFT down → (TAB down → TAB up) × 3 → SHIFT up.
    총 8 회 SendInput.
    """
    sent: list = []
    n = inject_mod.inject_key_with_mods_sendinput(
        hwnd=1234,
        vk_code=0x09,        # VK_TAB
        mods=(0x10,),        # VK_SHIFT
        repeat=3,
        _sender=sent.append,
    )
    assert n == 8  # 1 (mod down) + 6 (tab × 3) + 1 (mod up)
    assert len(sent) == 8
    # 첫 이벤트 = SHIFT down (no KEYUP flag).
    assert sent[0].u.ki.wVk == 0x10
    assert sent[0].u.ki.dwFlags == 0
    # 다음 6 회 = TAB down/up 교대.
    for i in range(3):
        down = sent[1 + i * 2]
        up = sent[2 + i * 2]
        assert down.u.ki.wVk == 0x09
        assert down.u.ki.dwFlags == 0
        assert up.u.ki.wVk == 0x09
        assert up.u.ki.dwFlags == inject_mod.KEYEVENTF_KEYUP
    # 마지막 = SHIFT up.
    assert sent[-1].u.ki.wVk == 0x10
    assert sent[-1].u.ki.dwFlags == inject_mod.KEYEVENTF_KEYUP


def test_inject_key_with_mods_no_mods_single():
    """mods 비어있고 repeat=1 — key down/up 2 회만."""
    sent: list = []
    n = inject_mod.inject_key_with_mods_sendinput(
        hwnd=1, vk_code=0x0D, mods=(), repeat=1, _sender=sent.append,
    )
    assert n == 2
    assert sent[0].u.ki.wVk == 0x0D
    assert sent[1].u.ki.dwFlags == inject_mod.KEYEVENTF_KEYUP


def test_inject_key_with_mods_zero_repeat_noop():
    """repeat<1 — 송신 0."""
    sent: list = []
    n = inject_mod.inject_key_with_mods_sendinput(
        hwnd=1, vk_code=0x09, mods=(0x10,), repeat=0, _sender=sent.append,
    )
    assert n == 0
    assert sent == []
