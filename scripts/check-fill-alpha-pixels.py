"""Read real AE alpha-test PNGs only; this script never connects to AE."""
import json
import sys
from pathlib import Path
from PIL import Image

directory = Path(sys.argv[1]).resolve()
capture = json.loads((directory / "frames.json").read_text(encoding="utf-8"))
if not capture.get("ok") or len(capture.get("frames", [])) != 1:
    raise ValueError("Expected one complete alpha-test frame")
image = Image.open(capture["frames"][0]["path"]).convert("RGBA")
results = [{"name": "960 by 640 canvas", "passed": image.size == (960, 640)}]
for x, alpha in [(160, 0), (480, 64), (800, 255)]:
    rgba = image.getpixel((x, 320))
    results.append({"name": "RGBA alpha rasterizes to " + str(alpha), "passed": abs(rgba[3] - alpha) <= 1,
                    "center": [x, 320], "expectedAlpha": alpha, "actualRGBA": rgba})
report = {"finished": True, "scope": "Offline real PNG alpha checks only; no AE access.",
          "passed": sum(r["passed"] for r in results), "failed": sum(not r["passed"] for r in results), "results": results}
(directory / "pixels.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps(report))
sys.exit(1 if report["failed"] else 0)
