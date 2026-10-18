"""Offline PNG checks only. Does not launch or communicate with AE."""
import json
from pathlib import Path
from PIL import Image

directory = Path(__file__).resolve().parent.parent / "test-results/local-folder-final"
source = Image.open(directory / "svg-compat.png").convert("RGBA")
frame = Image.open(directory / "ae-svg.png").convert("RGBA")
assert source.size == (1280, 800)
assert source.getpixel((0, 0))[3] == 0
assert source.getpixel((640, 400))[3] == 255
assert frame.size == (960, 640)
assert frame.getchannel("A").getbbox() == (336, 236, 624, 404)
assert frame.getpixel((0, 0))[3] == 0
assert frame.getpixel((480, 320))[3] == 255
report = {"finished": True, "scope": "Offline PNG pixels; no AE", "passed": 7, "failed": 0,
          "renderSize": list(source.size), "aeFrameSize": list(frame.size),
          "aeAlphaBounds": list(frame.getchannel("A").getbbox())}
(directory / "pixels.json").write_text(json.dumps(report, indent=2), encoding="utf8")
print(json.dumps(report))
