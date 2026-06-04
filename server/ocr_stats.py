# OCR raw vs 사용자 검수본 글자단위 diff 통계 — 자주 오인식되는 패턴 상위 N 추출.
from __future__ import annotations

import difflib
import json
from collections import Counter

from server import ocr_log


def _read_pair(folder) -> tuple[str, str, dict] | None:
    raw_p = folder / "raw.txt"
    cor_p = folder / "corrected.txt"
    if not (raw_p.exists() and cor_p.exists()):
        return None
    meta_p = folder / "meta.json"
    meta = {}
    if meta_p.exists():
        try:
            meta = json.loads(meta_p.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass
    return (
        raw_p.read_text(encoding="utf-8"),
        cor_p.read_text(encoding="utf-8"),
        meta,
    )


def collect_pairs() -> list[tuple[str, str, dict]]:
    pairs = []
    for folder in ocr_log.list_logs():
        p = _read_pair(folder)
        if p:
            pairs.append(p)
    return pairs


def char_ops(raw: str, cor: str) -> list[tuple[str, str]]:
    """SequenceMatcher 의 replace/delete/insert 만 (raw, cor) 쌍으로."""
    sm = difflib.SequenceMatcher(a=raw, b=cor, autojunk=False)
    out: list[tuple[str, str]] = []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            continue
        out.append((raw[i1:i2], cor[j1:j2]))
    return out


def main() -> None:
    pairs = collect_pairs()
    print(f"검수쌍 {len(pairs)}개")
    if not pairs:
        return
    counter: Counter = Counter()
    chars_raw = 0
    chars_changed = 0
    for raw, cor, _meta in pairs:
        chars_raw += len(raw)
        for r, c in char_ops(raw, cor):
            counter[(r, c)] += 1
            chars_changed += max(len(r), len(c))
    accuracy = 1 - chars_changed / chars_raw if chars_raw else 0
    print(f"글자 정확도 ≈ {accuracy * 100:.2f}% (변경 {chars_changed} / 원본 {chars_raw})")
    print()
    print(f"Top 20 오인식 패턴 (빈도 · raw → corrected):")
    for (r, c), n in counter.most_common(20):
        rs = repr(r) if r else "''"
        cs = repr(c) if c else "''"
        print(f"  {n:4d}회  {rs:<20s} → {cs}")


if __name__ == "__main__":
    main()
