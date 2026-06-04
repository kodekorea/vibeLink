# OCR 호출별 입력 이미지·raw 결과·사용자 검수본 누적 저장 — 정확도 개선 fixture 시드.
from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from typing import Optional

_LOG_ROOT = Path(__file__).resolve().parent.parent / "logs" / "ocr"
_KEEP = 200
_LOG_ID_RE = re.compile(r"^\d{8}_\d{6}_\d{3}$")


def _root() -> Path:
    _LOG_ROOT.mkdir(parents=True, exist_ok=True)
    return _LOG_ROOT


def record_ocr(img_bytes: bytes, raw_text: str, meta: dict) -> str:
    """입력 이미지·raw·meta 저장. log_id (폴더명) 반환."""
    root = _root()
    now = datetime.now()
    log_id = now.strftime("%Y%m%d_%H%M%S_") + f"{now.microsecond // 1000:03d}"
    folder = root / log_id
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "capture.png").write_bytes(img_bytes)
    (folder / "raw.txt").write_text(raw_text or "", encoding="utf-8")
    full_meta = {**meta, "ts": now.isoformat(timespec="milliseconds"), "log_id": log_id}
    (folder / "meta.json").write_text(
        json.dumps(full_meta, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    _cleanup_old(root)
    return log_id


def record_corrected(log_id: str, corrected_text: str) -> bool:
    """사용자 검수·수정본 덮어쓰기. log_id 유효·존재 시 True."""
    if not _LOG_ID_RE.match(log_id or ""):
        return False
    folder = _LOG_ROOT / log_id
    if not folder.is_dir():
        return False
    (folder / "corrected.txt").write_text(corrected_text or "", encoding="utf-8")
    return True


def _cleanup_old(root: Path, keep: Optional[int] = None) -> None:
    # default 는 모듈 변수 동적 lookup — 테스트가 _KEEP 을 monkeypatch 가능.
    if keep is None:
        keep = _KEEP
    entries = sorted(p for p in root.iterdir() if p.is_dir() and _LOG_ID_RE.match(p.name))
    excess = len(entries) - keep
    if excess <= 0:
        return
    for old in entries[:excess]:
        try:
            for f in old.iterdir():
                f.unlink(missing_ok=True)
            old.rmdir()
        except OSError:
            pass


def list_logs(limit: Optional[int] = None) -> list[Path]:
    """최신순 로그 폴더 경로. 분석 스크립트용."""
    if not _LOG_ROOT.is_dir():
        return []
    entries = sorted(
        (p for p in _LOG_ROOT.iterdir() if p.is_dir() and _LOG_ID_RE.match(p.name)),
        reverse=True,
    )
    return entries[:limit] if limit else entries
