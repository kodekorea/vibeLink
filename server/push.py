# M5-T1 (regex prompt matcher) + M5-T2 (process_end watcher). Push trigger 의 *검출* 부분.
# Worker relay·Service Worker dispatch (M5-T3·T4) 는 별도. 자동 입력 절대 금지 정책은 PWA 측에서 강제.

from __future__ import annotations
import re
import time
from dataclasses import dataclass
from typing import Callable, Iterable, Optional, Protocol

DEBOUNCE_SECONDS = 30

# AI IDE / 일반 CLI 의 interactive prompt 패턴. 단일 사용자 환경에서 자주 보이는 형태 우선.
# 본 리스트는 디폴트 — TriggerDetector(patterns=[...]) 로 교체 가능.
DEFAULT_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"(?:continue|proceed)\s*\??\s*[\[(]?\s*y\s*[/|]\s*n\s*[\])]?\s*[?:]?", re.IGNORECASE),
    re.compile(r"\b(?:y/n|yes/no)\??", re.IGNORECASE),
    re.compile(r"(?:press|hit)\s+(?:enter|return|any\s*key)\s+to\s+continue", re.IGNORECASE),
    re.compile(r"(?:allow|accept|deny|permit)\s*\?", re.IGNORECASE),
    re.compile(r"확인\s*하시겠습니까\s*\??"),
    re.compile(r"계속\s*(?:하시)?(?:겠습니까)?\s*\?"),
    re.compile(r"진행\s*하시겠습니까\s*\??"),
]


@dataclass(frozen=True)
class TriggerEvent:
    """터미널 출력에서 검출된 push trigger."""
    kind: str           # "prompt" | "process_end"
    tag: str            # debounce/dedup 단위 키
    detected_at: float
    matched_text: str


class TriggerDetector:
    """Regex prompt matcher with 30s debounce + prompt tag dedup.

    동일 tag 가 debounce 윈도 내 재발생하면 dispatch 안 함 (None 반환).
    `detect()` 는 trigger 1개 또는 None 반환. 다중 매치는 *첫 매치만* 반환 — MVP 단순화.
    """

    def __init__(
        self,
        patterns: Optional[Iterable[re.Pattern[str]]] = None,
        debounce_seconds: float = DEBOUNCE_SECONDS,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._patterns = list(patterns) if patterns is not None else list(DEFAULT_PATTERNS)
        self._debounce = debounce_seconds
        self._clock = clock
        self._last_dispatched: dict[str, float] = {}

    def detect(self, text: str) -> Optional[TriggerEvent]:
        """터미널 출력 chunk → trigger event 1개 (없으면 None, debounced 도 None)."""
        if not text:
            return None
        now = self._clock()
        for idx, pat in enumerate(self._patterns):
            m = pat.search(text)
            if not m:
                continue
            matched = m.group(0).strip()
            tag = self._make_tag(idx, matched)
            last = self._last_dispatched.get(tag)
            if last is not None and (now - last) < self._debounce:
                return None  # debounced
            self._last_dispatched[tag] = now
            return TriggerEvent(kind="prompt", tag=tag, detected_at=now, matched_text=matched)
        return None

    def reset(self) -> None:
        """수동 dedup 초기화 (테스트 / 운영 reset)."""
        self._last_dispatched.clear()

    def _make_tag(self, pattern_idx: int, matched_text: str) -> str:
        # tag = pattern idx + 정규화 텍스트 (50자 cap, 소문자) → dedup 단위.
        norm = re.sub(r"\s+", " ", matched_text.lower())[:50]
        return f"p{pattern_idx}|{norm}"


# ---------- M5-T2: 프로세스 종료 watcher ----------

class _PidProbe(Protocol):
    """psutil-호환 인터페이스 (테스트 mock 용)."""
    def pid_exists(self, pid: int) -> bool: ...


def _default_probe() -> _PidProbe:
    import psutil
    return psutil  # type: ignore[return-value]


class ProcessEndWatcher:
    """등록된 PID 들의 종료를 polling 으로 감지. tick() 을 ~500ms 주기로 호출.

    - 종료 감지 시 TriggerEvent(kind="process_end") 발생.
    - 같은 PID 는 한 번만 발생 (이후 watch 해제됨 — 재호출에 중복 X).
    - 이미 종료된 PID 를 watch() 로 등록하면 다음 tick 에 즉시 발생.
    """

    def __init__(
        self,
        probe: Optional[_PidProbe] = None,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._probe = probe if probe is not None else _default_probe()
        self._clock = clock
        self._watched: dict[int, str] = {}  # pid → label

    def watch(self, pid: int, label: str = "") -> None:
        """PID 와 사용자 식별용 label (예: 명령 텍스트) 등록."""
        self._watched[pid] = label

    def unwatch(self, pid: int) -> None:
        self._watched.pop(pid, None)

    def watching(self) -> dict[int, str]:
        return dict(self._watched)

    def tick(self) -> list[TriggerEvent]:
        """이번 tick 에서 종료가 감지된 PID 들의 TriggerEvent 리스트 반환.

        감지된 PID 는 자동 unwatch — 같은 종료 이벤트가 다음 tick 에 중복 fire 되지 않음.
        """
        now = self._clock()
        ended: list[TriggerEvent] = []
        for pid in list(self._watched.keys()):
            if not self._probe.pid_exists(pid):
                label = self._watched.pop(pid)
                tag = f"pid:{pid}"
                ended.append(TriggerEvent(
                    kind="process_end",
                    tag=tag,
                    detected_at=now,
                    matched_text=label or f"PID {pid}",
                ))
        return ended
