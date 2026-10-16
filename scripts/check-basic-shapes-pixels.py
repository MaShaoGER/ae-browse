"""Inspect previously rendered PNGs only; this script never connects to AE."""
import json
import sys
from pathlib import Path

from PIL import Image, ImageChops


directory = Path(sys.argv[1]).resolve()
capture = json.loads((directory / "frames.json").read_text(encoding="utf-8"))
if not capture.get("ok") or len(capture.get("frames", [])) != 3:
    raise ValueError("Expected three successful real AE frame captures")
images = [Image.open(frame["path"]).convert("RGBA") for frame in capture["frames"]]
results = []


def check(name, passed, **detail):
    results.append({"name": name, "passed": bool(passed), **detail})


check("Three real frames have the expected canvas", all(image.size == (960, 640) for image in images))
check("Frame before insertion is fully transparent", images[0].getchannel("A").getbbox() is None)
# Independent dimensions and RGB samples for the six fixtures, with two-pixel
# raster tolerance for native polygon edges and one RGB level for quantization.
expected = [
    ("rounded-card", (240, 140), (51, 128, 255)),
    ("circle", (180, 180), (41, 184, 166)),
    ("ellipse", (260, 150), (71, 148, 255)),
    ("triangle", (191, 165), (255, 133, 71)),
    ("hexagon", (191, 220), (158, 122, 255)),
    ("star", (210, 199), (255, 194, 56)),
]
for index, (name, dimensions, color) in enumerate(expected):
    x, y = index % 3 * 320, index // 3 * 320
    crops = [image.crop((x, y, x + 320, y + 320)) for image in images[1:]]
    masks = [crop.getchannel("A").point(lambda alpha: 255 if alpha >= 128 else 0) for crop in crops]
    bbox = masks[1].getbbox()
    size = (bbox[2] - bbox[0], bbox[3] - bbox[1]) if bbox else (0, 0)
    areas = [mask.histogram()[255] for mask in masks]
    rgba = crops[1].getpixel((160, 160))
    passed = all(abs(size[i] - dimensions[i]) <= 2 for i in range(2))
    passed = passed and all(abs(rgba[i] - color[i]) <= 1 for i in range(3)) and rgba[3] == 255
    passed = passed and 0 < areas[0] < areas[1]
    check(name + " has expected extent, fill and entrance growth", passed,
          bbox=bbox, expectedSize=dimensions, actualSize=size, centerRGBA=rgba,
          middleOpaquePixels=areas[0], finalOpaquePixels=areas[1])
middle_mask, final_mask = [image.getchannel("A").point(lambda alpha: 255 if alpha >= 128 else 0) for image in images[1:]]
outside = ImageChops.subtract(middle_mask, final_mask).getbbox()
check("Entrance pixels remain inside the final shape regions", outside is None, outsideBbox=outside)
report = {
    "finished": True, "runId": directory.name,
    "scope": "Offline PNG pixel checks only; actual AE capture metadata is in frames.json. No AE calls.",
    "passed": sum(item["passed"] for item in results),
    "failed": sum(not item["passed"] for item in results), "results": results,
}
(directory / "pixels.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps(report))
sys.exit(1 if report["failed"] else 0)
