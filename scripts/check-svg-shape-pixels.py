"""Offline pixel checks of browser references against already-rendered AE PNGs."""
import json
from pathlib import Path
import numpy as np
from PIL import Image

directory = Path(__file__).resolve().parent.parent / "test-results/workflow-20261018"
fixtures = json.loads((directory / "svg-fixtures.json").read_text(encoding="utf8"))
results = []
for fixture in fixtures:
    name = fixture["name"]
    frame = max((directory / "renders" / name).glob("*.png"), key=lambda p: p.stat().st_mtime)
    image = Image.open(frame).convert("RGBA")
    reference = Image.open(directory / (name + "-reference.png")).convert("RGBA").resize(image.size, Image.Resampling.LANCZOS)
    a, b = np.asarray(image, dtype=float), np.asarray(reference, dtype=float)
    # This AE build exports premultiplied RGB through saveFrameToPng. The
    # additional opaque-white render below independently verifies its alpha blend.
    b[:, :, :3] *= b[:, :, 3:] / 255
    diff = np.abs(a-b)
    fraction = float(np.mean(np.max(diff, axis=2) > 32))
    mean = float(np.mean(diff))
    results.append({"name": name + " browser/AE appearance", "passed": fraction < .025 and mean < 2, "differentPixelFraction": fraction, "meanPremultipliedDifference": mean, "frame": str(frame)})
    if name == "rounded-card":
        results.append({"name": "card center color and transparent corner", "passed": image.getpixel((160,100)) == (83,134,237,255) and image.getpixel((0,0))[3] == 0})
    elif name == "compound-stroke":
        results.append({"name": "compound hole remains transparent", "passed": image.getpixel((100,100))[3] == 0 and image.getpixel((30,30))[3] == 255})
    elif name == "curves-transform":
        results.append({"name": "fill and group opacity", "passed": abs(image.getpixel((260,70))[3]-128) <= 1 and abs(image.getpixel((50,170))[3]-179) <= 1})
    elif name == "paint-order":
        results.append({"name": "later SVG element paints over earlier element", "passed": image.getpixel((120,100)) == (0,0,255,255)})
white = Image.open(max((directory / 'renders/curves-white').glob('*.png'), key=lambda p:p.stat().st_mtime)).convert('RGBA')
reference = Image.open(directory / 'curves-transform-reference.png').convert('RGBA').resize(white.size, Image.Resampling.LANCZOS)
composite = Image.alpha_composite(Image.new('RGBA', white.size, 'white'), reference)
diff = np.abs(np.asarray(white, dtype=float)-np.asarray(composite, dtype=float))
results.append({"name":"opaque white matte confirms alpha blending", "passed":float(np.mean(diff)) < 2 and float(np.mean(np.max(diff,axis=2)>32)) < .025, "meanDifference":float(np.mean(diff))})
report = {"finished": True, "scope": "Offline PNG pixels; does not communicate with AE", "passed": sum(r["passed"] for r in results), "failed": sum(not r["passed"] for r in results), "results": results}
(directory / "pixels.json").write_text(json.dumps(report, indent=2), encoding="utf8")
print(json.dumps(report))
raise SystemExit(1 if report["failed"] else 0)
