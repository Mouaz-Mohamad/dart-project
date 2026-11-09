"""Generate reviewed storefront WebP variants; preserve the source photographs.
Run manually with Python + Pillow; deployment uses the checked-in output files.
"""
from pathlib import Path
from PIL import Image, ImageOps
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
SOURCES = {
    "made-for-you-2": "Photos/Made For You2.png",
    "made-for-you-4": "Photos/Made For You 4.png",
    "hero-model1": "Photos/model1.jpg",
}
WIDTHS = (480, 960)
QUALITY = 88

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    rows = []
    for stem, relative in SOURCES.items():
        source = ROOT / relative
        with Image.open(source) as raw:
            image = ImageOps.exif_transpose(raw)
            image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
            variants = []
            for width in WIDTHS:
                height = round(image.height * width / image.width)
                resized = image.resize((width, height), Image.Resampling.LANCZOS)
                target = ROOT / f"Photos/optimized/{stem}-{width}.webp"
                target.parent.mkdir(parents=True, exist_ok=True)
                resized.save(target, "WEBP", quality=QUALITY, method=6, exact=True)
                variants.append({"path": target.relative_to(ROOT).as_posix(), "width": width,
                    "height": height, "bytes": target.stat().st_size, "sha256": sha(target)})
            rows.append({"source": relative, "sourceBytes": source.stat().st_size,
                "sourceSha256": sha(source), "variants": variants})
    (ROOT / "scripts/store-image-manifest.json").write_text(
        json.dumps({"format": "webp", "quality": QUALITY, "images": rows}, indent=2) + "\n")
    for row in rows:
        print(row["source"], row["sourceBytes"], "->", [(v["width"], v["bytes"]) for v in row["variants"]])

if __name__ == "__main__":
    main()
