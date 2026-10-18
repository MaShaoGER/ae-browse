"""Offline checks for already captured update-test PNGs. Never connects to AE."""
import json
import sys
from pathlib import Path
from PIL import Image, ImageChops

directory = Path(sys.argv[1]).resolve()
capture = json.loads((directory / "frames.json").read_text(encoding="utf-8"))
if not capture.get("ok") or len(capture.get("frames", [])) != 3:
    raise ValueError("Expected three successful real AE captures")
images = [Image.open(frame["path"]).convert("RGBA") for frame in capture["frames"]]
results = []


def check(name, passed, **detail):
    results.append({"name": name, "passed": bool(passed), **detail})


check("Three frames use the 960 by 640 canvas", all(im.size == (960, 640) for im in images))
check("Before insertion is transparent", images[0].getchannel("A").getbbox() is None)
# Independent geometry expectations: 30-degree rotation; polygon radius 85,
# star outer/inner radii 85/38; 2px edge tolerance, 1 RGB quantization level.
expected = [("rounded-card", (240, 130)), ("circle", (150, 150)),
            ("ellipse", (240, 130)), ("triangle", (128, 147)),
            ("hexagon", (170, 147)), ("star", (161, 158))]
for index, (name, dimensions) in enumerate(expected):
    x, y = index % 3 * 320, index // 3 * 320
    crops = [im.crop((x, y, x + 320, y + 320)) for im in images[1:]]
    masks = [im.getchannel("A").point(lambda a: 255 if a >= 128 else 0) for im in crops]
    bbox = masks[-1].getbbox()
    size = (bbox[2] - bbox[0], bbox[3] - bbox[1]) if bbox else (0, 0)
    center = crops[-1].getpixel((160, 160))
    areas = [mask.histogram()[255] for mask in masks]
    passed = all(abs(size[i] - dimensions[i]) <= 2 for i in range(2))
    passed = passed and all(abs(center[i] - (230, 77, 51)[i]) <= 1 for i in range(3)) and center[3] == 255
    passed = passed and 0 < areas[0] < areas[1]
    check(name + " reflects updated dimensions/color and preserved entrance", passed,
          actualSize=size, expectedSize=dimensions, centerRGBA=center, middleArea=areas[0], finalArea=areas[1])
middle, final = [im.getchannel("A").point(lambda a: 255 if a >= 128 else 0) for im in images[1:]]
check("Entrance stays inside final shape regions", ImageChops.subtract(middle, final).getbbox() is None)
report = {"finished": True, "runId": directory.name, "scope": "Offline PNG checks only; no AE access.",
          "passed": sum(r["passed"] for r in results), "failed": sum(not r["passed"] for r in results), "results": results}
(directory / "pixels.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps(report))
sys.exit(1 if report["failed"] else 0)
