# JSON Lines 감사 로그. server/auth.py 내부 _audit 와 분리하여 향후 push/capture 도 같은 store 공유.

from __future__ import annotations
import json
import time
from pathlib import Path
from typing import Any

DEFAULT_PATH = Path.home() / ".mtb" / "audit.log"


def append(event: str, *, path: Path = DEFAULT_PATH, **fields: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps({"ts": time.time(), "event": event, **fields}, ensure_ascii=False)
    with path.open("a", encoding="utf-8") as f:
        f.write(line + "\n")
