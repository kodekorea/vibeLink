# M5-T1 단위 테스트 — regex 검출 + 30s debounce + prompt tag dedup.

import sys
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server.push import TriggerDetector, TriggerEvent, DEBOUNCE_SECONDS


class FakeClock:
    def __init__(self, t: float = 1000.0):
        self.t = t

    def __call__(self) -> float:
        return self.t


def test_detect_continue_prompt():
    clk = FakeClock()
    d = TriggerDetector(clock=clk)
    ev = d.detect("Build complete.\nContinue? [y/n]")
    assert ev is not None
    assert ev.kind == "prompt"
    assert "continue" in ev.matched_text.lower()


def test_no_match_returns_none():
    """일반 stdout 텍스트는 trigger 안 발동."""
    d = TriggerDetector(clock=FakeClock())
    assert d.detect("Just some plain output\nfile.py:42: ok") is None


def test_empty_text():
    d = TriggerDetector(clock=FakeClock())
    assert d.detect("") is None
    assert d.detect(None) is None  # type: ignore[arg-type]


def test_debounce_same_prompt_suppressed():
    """DoD: 동일 prompt 30s 중복 억제."""
    clk = FakeClock(1000.0)
    d = TriggerDetector(clock=clk)
    ev1 = d.detect("Continue? [y/n]")
    assert ev1 is not None
    clk.t = 1015.0  # 15s 후 — 아직 debounce 윈도 내
    ev2 = d.detect("Continue? [y/n]")
    assert ev2 is None


def test_debounce_expires_after_window():
    """30s 경과 후 같은 prompt 는 다시 발동."""
    clk = FakeClock(1000.0)
    d = TriggerDetector(clock=clk)
    d.detect("Continue? [y/n]")
    clk.t = 1000.0 + DEBOUNCE_SECONDS + 1  # 31s 후
    ev = d.detect("Continue? [y/n]")
    assert ev is not None


def test_different_prompts_independent_tags():
    """패턴 다른 prompt 는 독립 tag — 동시 trigger 정상."""
    clk = FakeClock()
    d = TriggerDetector(clock=clk)
    ev1 = d.detect("Continue? [y/n]")
    ev2 = d.detect("Press enter to continue")
    assert ev1 is not None and ev2 is not None
    assert ev1.tag != ev2.tag


def test_korean_confirmation_prompts():
    """한글 prompt 매치 (사무실 도구·CLI 의 흔한 형태)."""
    d = TriggerDetector(clock=FakeClock())
    assert d.detect("계속하시겠습니까?") is not None
    d.reset()
    assert d.detect("확인하시겠습니까?") is not None
    d.reset()
    assert d.detect("진행하시겠습니까?") is not None


def test_press_enter_pattern():
    d = TriggerDetector(clock=FakeClock())
    ev = d.detect("Press any key to continue...")
    assert ev is not None


def test_custom_patterns_override_defaults():
    """patterns 인자로 디폴트 패턴 완전 교체 가능."""
    import re
    custom = [re.compile(r"deploy\?\?\?")]
    clk = FakeClock()
    d = TriggerDetector(patterns=custom, clock=clk)
    # 디폴트 패턴 (Continue? 등) 매치 안 함
    assert d.detect("Continue? [y/n]") is None
    # 커스텀 패턴 매치
    assert d.detect("Ready to deploy???") is not None


def test_reset_clears_dedup():
    """reset() 호출 후 dedup 초기화 — 같은 prompt 즉시 재발동."""
    clk = FakeClock()
    d = TriggerDetector(clock=clk)
    d.detect("Continue? [y/n]")
    assert d.detect("Continue? [y/n]") is None  # debounced
    d.reset()
    assert d.detect("Continue? [y/n]") is not None  # reset 후 발동


# ---------- M5-T2: ProcessEndWatcher tests ----------

from server.push import ProcessEndWatcher


class FakeProbe:
    """psutil 대신 사용할 mock — alive_pids set 으로 살아있는 PID 관리."""
    def __init__(self, alive_pids):
        self.alive = set(alive_pids)

    def pid_exists(self, pid: int) -> bool:
        return pid in self.alive

    def kill(self, pid: int) -> None:
        self.alive.discard(pid)


def test_watcher_no_termination_yields_empty():
    probe = FakeProbe(alive_pids=[100, 200])
    w = ProcessEndWatcher(probe=probe, clock=FakeClock())
    w.watch(100, "build")
    w.watch(200, "test")
    assert w.tick() == []


def test_watcher_detects_single_termination():
    """DoD: 종료 감지 ~500ms 내."""
    probe = FakeProbe(alive_pids=[100, 200])
    w = ProcessEndWatcher(probe=probe, clock=FakeClock(1000.0))
    w.watch(100, "build")
    w.watch(200, "test")
    probe.kill(100)
    events = w.tick()
    assert len(events) == 1
    assert events[0].kind == "process_end"
    assert events[0].tag == "pid:100"
    assert "build" in events[0].matched_text


def test_watcher_unwatch_after_termination():
    """종료 감지된 PID 는 자동 unwatch — 다음 tick 에 중복 발생 안 함."""
    probe = FakeProbe(alive_pids=[100])
    w = ProcessEndWatcher(probe=probe, clock=FakeClock())
    w.watch(100, "build")
    probe.kill(100)
    first = w.tick()
    second = w.tick()
    assert len(first) == 1
    assert second == []


def test_watcher_multiple_terminations_one_tick():
    probe = FakeProbe(alive_pids=[1, 2, 3])
    w = ProcessEndWatcher(probe=probe, clock=FakeClock())
    w.watch(1, "a")
    w.watch(2, "b")
    w.watch(3, "c")
    probe.kill(1)
    probe.kill(3)
    events = w.tick()
    assert len(events) == 2
    assert {e.tag for e in events} == {"pid:1", "pid:3"}


def test_watcher_already_dead_pid_fires_next_tick():
    """이미 죽은 PID 를 watch 등록하면 다음 tick 에 즉시 fire."""
    probe = FakeProbe(alive_pids=[])  # 살아있는 게 없음
    w = ProcessEndWatcher(probe=probe, clock=FakeClock())
    w.watch(999, "stale")
    events = w.tick()
    assert len(events) == 1
    assert events[0].matched_text == "stale"


def test_watcher_unwatch_removes():
    probe = FakeProbe(alive_pids=[100])
    w = ProcessEndWatcher(probe=probe, clock=FakeClock())
    w.watch(100, "x")
    assert 100 in w.watching()
    w.unwatch(100)
    assert 100 not in w.watching()
    # unwatch 후 종료해도 event 없음
    probe.kill(100)
    assert w.tick() == []


def test_watcher_label_optional():
    """label 미지정 시 default 'PID {n}' 사용."""
    probe = FakeProbe(alive_pids=[7])
    w = ProcessEndWatcher(probe=probe, clock=FakeClock())
    w.watch(7)
    probe.kill(7)
    events = w.tick()
    assert events[0].matched_text == "PID 7"
