# OCR 로그 저장·검수본 누적·보존 LRU 단위 테스트.

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server import ocr_log  # noqa: E402


def _isolate(monkeypatch, tmp_path):
    monkeypatch.setattr(ocr_log, "_LOG_ROOT", tmp_path / "logs" / "ocr")


def test_record_ocr_writes_three_files(monkeypatch, tmp_path):
    _isolate(monkeypatch, tmp_path)
    log_id = ocr_log.record_ocr(b"\x89PNG\r\n\x1a\n", "raw text", {"lang": "eng"})
    folder = ocr_log._LOG_ROOT / log_id
    assert folder.is_dir()
    assert (folder / "capture.png").read_bytes().startswith(b"\x89PNG")
    assert (folder / "raw.txt").read_text(encoding="utf-8") == "raw text"
    import json
    meta = json.loads((folder / "meta.json").read_text(encoding="utf-8"))
    assert meta["lang"] == "eng"
    assert meta["log_id"] == log_id
    assert "ts" in meta


def test_record_corrected_appends(monkeypatch, tmp_path):
    _isolate(monkeypatch, tmp_path)
    log_id = ocr_log.record_ocr(b"img", "raw", {})
    assert ocr_log.record_corrected(log_id, "fixed text") is True
    assert (ocr_log._LOG_ROOT / log_id / "corrected.txt").read_text(encoding="utf-8") == "fixed text"


def test_record_corrected_rejects_invalid_id(monkeypatch, tmp_path):
    _isolate(monkeypatch, tmp_path)
    # 잘못된 포맷 — path traversal 시도.
    assert ocr_log.record_corrected("../etc/passwd", "x") is False
    assert ocr_log.record_corrected("not_a_valid_id", "x") is False
    # 정상 포맷이지만 존재 X.
    assert ocr_log.record_corrected("20990101_120000_000", "x") is False


def test_cleanup_keeps_recent_only(monkeypatch, tmp_path):
    _isolate(monkeypatch, tmp_path)
    monkeypatch.setattr(ocr_log, "_KEEP", 3)
    ids = []
    for _ in range(5):
        ids.append(ocr_log.record_ocr(b"img", "raw", {}))
        # log_id 가 ms 단위 — 같은 ms 안에 5번 호출되면 동일 log_id 라 보존 검증 의미 없음. 짧게 대기.
        time.sleep(0.01)
    remaining = [p.name for p in ocr_log.list_logs()]
    assert len(remaining) == 3
    # 최신 3개 = ids 의 마지막 3개.
    assert set(remaining) == set(ids[-3:])


def test_list_logs_returns_newest_first(monkeypatch, tmp_path):
    _isolate(monkeypatch, tmp_path)
    a = ocr_log.record_ocr(b"img", "raw", {})
    time.sleep(0.01)
    b = ocr_log.record_ocr(b"img", "raw", {})
    logs = ocr_log.list_logs()
    assert [p.name for p in logs[:2]] == [b, a]
