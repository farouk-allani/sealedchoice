"""Export Cycles PNG frames for the website. Requires Pillow; run from the repo root."""
import argparse
from pathlib import Path

from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument("--source", type=Path, default=Path("scratch/landing-preview/blender"))
args = parser.parse_args()
destination = Path(__file__).resolve().parents[1] / "public" / "visuals" / "blender"
destination.mkdir(parents=True, exist_ok=True)
names = [f"{asset}-poster" for asset in ("vault", "seal", "podium")]
names += [f"{asset}-{frame:03d}" for asset in ("vault", "seal") for frame in range(24)]
for name in names:
    source = args.source / f"{name}.png"
    with Image.open(source) as image:
        image.save(destination / f"{name}.webp", quality=90 if "poster" in name else 84, method=6)
print(f"Exported {len(names)} WebP assets to {destination}")
