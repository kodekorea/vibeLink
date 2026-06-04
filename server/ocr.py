# 서버측 OCR — pytesseract (네이티브 Tesseract.exe). tesseract.js 보다 빠르고 한글 정확도 ↑.
# billing_invoice_generator/core/image_ocr.py 의 path detection 패턴 차용.
from __future__ import annotations

import io
import shutil
from pathlib import Path
from typing import Optional

_TESSERACT_READY: Optional[bool] = None


def _ensure_tesseract() -> bool:
    """Tesseract.exe 위치 자동 탐색 + pytesseract.cmd 세팅. 한 번 캐시."""
    global _TESSERACT_READY
    if _TESSERACT_READY is not None:
        return _TESSERACT_READY
    try:
        import pytesseract
    except ImportError:
        _TESSERACT_READY = False
        return False

    cmd = getattr(pytesseract.pytesseract, "tesseract_cmd", "tesseract")
    if cmd and Path(cmd).is_absolute() and Path(cmd).exists():
        _TESSERACT_READY = True
        return True
    if shutil.which(cmd or "tesseract"):
        _TESSERACT_READY = True
        return True

    for c in (
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
        r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
    ):
        if Path(c).exists():
            pytesseract.pytesseract.tesseract_cmd = c
            _TESSERACT_READY = True
            return True

    _TESSERACT_READY = False
    return False


def ocr_bytes(img_bytes: bytes, lang: str = "eng", psm: int = 6) -> str:
    """이미지 bytes → OCR 텍스트.

    Args:
        img_bytes: PNG/JPEG/etc bytes.
        lang: "eng" / "kor+eng" / "kor".
        psm: page segmentation mode. 6 = uniform block of text (default).
             3 = fully automatic page segmentation (a bit slower).
             11 = sparse text. 12 = sparse text with OSD.
    """
    if not _ensure_tesseract():
        raise RuntimeError("pytesseract / Tesseract.exe 미설치 — billing_invoice_generator 와 동일 환경 필요")
    from PIL import Image
    import pytesseract

    img = Image.open(io.BytesIO(img_bytes))
    config = f"--psm {psm}"
    text = pytesseract.image_to_string(img, lang=lang, config=config)
    return text or ""
