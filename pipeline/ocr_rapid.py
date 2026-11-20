"""Local OCR with RapidOCR (PaddleOCR models on ONNX Runtime; free, offline, any OS). Same interface as ocr.py.

pip install rapidocr_onnxruntime pillow   (in the project venv)

Used on Windows, where macOS Vision is not available. Windows' own OCR was tried first and garbled the tiny
print on portal floor plans (3350X4270 came back as 335014270); RapidOCR read the same plan cleanly.
"""
import numpy as np
from PIL import Image

_engine = None


def _eng():
    global _engine
    if _engine is None:
        from rapidocr_onnxruntime import RapidOCR
        _engine = RapidOCR()
    return _engine


def ocr(path):
    """[(text, cx, cy, height, confidence)] with x, y in 0..1 of the whole image, from the top-left."""
    im = Image.open(path).convert("RGB")
    W, H = im.size
    res, _ = _eng()(np.array(im), use_cls=False)  # plan text is upright; skipping the angle step is 20% faster, same boxes
    out = []
    for box, text, conf in res or []:
        xs, ys = [p[0] for p in box], [p[1] for p in box]
        out.append((text, (min(xs) + max(xs)) / 2 / W, (min(ys) + max(ys)) / 2 / H, (max(ys) - min(ys)) / H, float(conf)))
    return out


if __name__ == "__main__":
    import sys
    for t in ocr(sys.argv[1]):
        print(f"{t[1]:.3f} {t[2]:.3f} {t[4]:.2f} {t[0]}")
