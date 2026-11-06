# Landing artwork

Original geometry, modelled procedurally in `build_assets.py` and rendered with Cycles. No
purchased assets, no external textures, no generated meshes. `production/*.blend` holds the
editable scenes the script last wrote, including materials, camera and lights.

The site composites Cycles-rendered WebP frames rather than running WebGL. GSAP maps scroll
progress onto the sequence; the browser only cross-fades between frames and never relights
anything. The poster is the first paint, the reduced-motion still, and the fallback when a
frame has not loaded.

## What the vault sequence shows

A door that opens. `root -> hinge pivot -> door -> wheel`, with the pivot on the real hinge
axis, so over the sequence: the handwheel turns, eight throw bolts withdraw from the frame,
and the door swings out on its hinge to reveal a lit chamber. Anything that must stay still —
housing, frame bolts, hinge barrels, chamber — is parented to `root` instead of the door.

Two things that are easy to get wrong here and cost a rebuild:

- **Metal base colour is reflection colour.** At 0.05 the steel reflects almost nothing and
  renders as a black silhouette whatever the lights do. Brushed steel sits near 0.4. The page
  is dark because the *lighting* is dark, not the material.
- **The stages are timed against the beats** in `src/content/landing.ts`, not spread evenly:
  shut at `sealed`, the mechanism working at the freeze, clearly swinging at `opened`, wide
  open by `scored`. Change a beat's `at` and the stage windows here have to move with it.
- **A coarse step during the swing** shows up in the browser as a double image, because the
  scrubber cross-fades adjacent frames. Forty frames keeps the step small enough.

`--frames` sets the sequence length the motion is timed against; `--count` limits how many are
rendered now, which is how you spot-check a single pose without rendering the lot. `--poster`
renders one frame whatever `--frames` says, since every frame would write the same file.

`FRAME_COUNT` in `src/components/landing/blender-vault.tsx` must match `--frames`.

## Rebuild

Blender 5.2 and a Python with Pillow, from the repository root:

```powershell
$blender = 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe'
& $blender --background --factory-startup --python apps/web/art/build_assets.py -- --asset vault --size 1400 --samples 40 --frames 40 --poster
& $blender --background --factory-startup --python apps/web/art/build_assets.py -- --asset vault --size 880  --samples 14 --frames 40
& $blender --background --factory-startup --python apps/web/art/build_assets.py -- --asset mark  --size 720  --samples 48 --poster
python apps/web/art/export_webp.py
```

Spot-check one pose instead of the whole sequence:

```powershell
& $blender --background --factory-startup --python apps/web/art/build_assets.py -- --asset vault --size 860 --samples 14 --frame 34 --frames 40 --count 1
```

Rendering overwrites the matching `production/*.blend`. Temporary PNGs land in git-ignored
`scratch/landing-preview/blender`; `export_webp.py` converts whatever is there and only the
WebP output is loaded by the site. The script uses CUDA when present and falls back to CPU.

## Assets

| Asset | Used for |
|---|---|
| `vault` | The scroll sequence and its poster — the whole first act of the page. |
| `mark` | The brand mark: the vault's own handwheel. The nav and favicon use a flat SVG derived from the same silhouette; this render is for large contexts. |
| `seal`, `podium` | Modelled, not currently on the page. Kept because the scenes are cheap to keep and expensive to rebuild. |

These are decorative. Every number and claim on the page comes from `src/config/evidence.ts`
and `src/content/landing.ts`, never from the artwork.
