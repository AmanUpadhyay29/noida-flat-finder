"""Local OCR with macOS's built-in Vision framework (free, no upload). Returns text boxes with positions."""
import Quartz
import Vision
from Foundation import NSURL


def ocr(path):
    """[(text, cx, cy, height, confidence)] with x, y in 0..1 from the top-left."""
    src = Quartz.CGImageSourceCreateWithURL(NSURL.fileURLWithPath_(str(path)), None)
    img = Quartz.CGImageSourceCreateImageAtIndex(src, 0, None)
    req = Vision.VNRecognizeTextRequest.alloc().init()
    req.setRecognitionLevel_(Vision.VNRequestTextRecognitionLevelAccurate)
    req.setUsesLanguageCorrection_(False)
    handler = Vision.VNImageRequestHandler.alloc().initWithCGImage_options_(img, None)
    handler.performRequests_error_([req], None)
    out = []
    for o in req.results() or []:
        c = o.topCandidates_(1)[0]
        b = o.boundingBox()
        out.append((str(c.string()), b.origin.x + b.size.width / 2, 1 - (b.origin.y + b.size.height / 2), b.size.height, float(c.confidence())))
    return out


if __name__ == "__main__":
    import sys
    for t in ocr(sys.argv[1]):
        print(f"{t[1]:.2f} {t[2]:.2f} {t[0]}")
