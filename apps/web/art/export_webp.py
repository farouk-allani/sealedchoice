"""Export Cycles PNG frames for the website. Requires Pillow; run from the repo root.

Exports whatever the render step produced rather than a fixed list, so rendering a subset of
the assets does not fail the export.
"""
import argparse
from pathlib import Path

from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument("--source", type=Path, default=Path("scratch/landing-preview/blender"))
args = parser.parse_args()
destination = Path(__file__).resolve().parents[1] / "public" / "visuals" / "blender"
destination.mkdir(parents=True, exist_ok=True)

sources = sorted(args.source.glob("*.png"))
if not sources:
    raise SystemExit(f"No PNG frames found in {args.source}")

for source in sources:
    # Posters are the first thing a reader sees and the reduced-motion still, so they keep
    # more quality than a frame that is on screen for one scroll tick.
    quality = 92 if "poster" in source.stem else 84
    with Image.open(source) as image:
        image.save(destination / f"{source.stem}.webp", quality=quality, method=6)
print(f"Exported {len(sources)} WebP assets to {destination}")
