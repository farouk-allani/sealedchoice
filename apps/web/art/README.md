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

### Protocol assembly

`build_protocol_assets.py` renders a single conceptual evaluator assembly in six stages.
Sealed cartridges occupy the input side; a gate freezes that set; the cover lifts to show
the TEE; scoring produces records; the committee's selected record rises; and the final
stage binds the evidence records. The model illustrates the data flow, not real OutLayer
hardware. No bid plaintext is depicted outside the isolated core.

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background --factory-startup --python apps/web/art/build_protocol_assets.py -- --size 1200 --samples 64
python apps/web/art/export_webp.py --source scratch/landing-preview/protocol
```

Use `--stage sealed|closed|opened|scored|awarded|verified` for a single stage. Editable
scenes are `production/protocol-*.blend`; transparent stills are
`public/visuals/blender/protocol-*-poster.webp`. These six stills are now the reduced-motion
presentation of the section: the tabs select one and no sequence is fetched. The original
podium and seal scenes and assets remain available.

### Protocol cycle (scroll sequence)

`build_protocol_sequence.py` renders the same assembly as one continuous machine cycle
instead of six separate stills. It builds the scene once, keyframes it, and renders 61
frames. Every change is physical motion: cartridges seat into the input slots, the gate
rises and stays up, the cover lifts on telescoping guides, the core lights, criterion
channels emerge, records rise out of the output deck, the selected record lifts with its
mark, and the evidence binding closes around the deck. Nothing appears from nowhere; parts
that are not yet in play wait inside the chassis volume, where it occludes them.

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background --factory-startup --python apps/web/art/build_protocol_sequence.py -- --size 900 --samples 24
python apps/web/art/export_webp.py --source scratch/landing-preview/protocol-seq
```

`--step` sets the frames between stage keyframes (default 12, so stages land on frames
0, 12, 24, 36, 48 and 60). `--start` and `--end` render a sub-range while iterating.
`STAGE_STEP` and `FRAME_COUNT` in `src/components/landing/protocol-assembly.tsx` must match.
The editable scene is `production/protocol-sequence.blend`; 61 transparent 900 x 900 WebP
frames totalling 1,857,594 bytes are exported to `public/visuals/blender/protocol-seq-*.webp`.

The section scrolls as a sticky stage: `.protocol-scroll` provides the scroll length
(400vh), `.protocol-sticky` is held in view, and ScrollTrigger scrubs the frame index across
it. Frames stream four at a time once the section is approached, and the canvas cross-blends
consecutive frames so a slow scrub stays continuous. Under reduced motion none of this runs:
the track collapses to content height, the canvas is hidden, and the six posters are shown
with the steps selecting between them.

The copy beside it is a vertical stepper: six short headlines, the active one lit, and one
supporting line underneath. The steps are a tablist, so they keep arrow, Home and End
navigation, but scroll owns the selection and clicking a step scrolls to that stage. The
stage is one viewport, so the square assembly is bounded by `70svh` rather than by column
width, and a `max-height: 840px` block scales the copy for short laptops. Keep it this way:
the measured numbers belong in the result and verify sections, not here.

### Recorded tender cards

`build_result_assets.py` creates four distinct Cycles stills with a shared orthographic
camera and studio rig. The objects describe the card outcomes: a selected document,
stacked score records, a submission marked for review, and an exploded TEE package.
The chip is a conceptual illustration, not a diagram of OutLayer hardware. Decorative
record bars do not encode scores; the adjacent HTML supplies the real values.

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background --factory-startup --python apps/web/art/build_result_assets.py -- --size 960 --samples 64
python apps/web/art/export_webp.py --source scratch/landing-preview/results
```

Use `--asset award|ranked|flagged|evidence` to rebuild one object. Editable scenes are
saved as `production/result-*.blend`; transparent 960 x 816 WebP stills are exported to
`public/visuals/blender/result-*-poster.webp`. The ranking cards use these stills, with
a small scroll entrance that respects reduced motion, instead of loading the seal sequence.

The darker **vault** variant uses the same geometry with blackened steel, smoked titanium,
and narrow violet studio lights matched to the hero. Its files have a `-vault` suffix,
so the original studio WebPs and `.blend` scenes remain untouched.

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background --factory-startup --python apps/web/art/build_result_assets.py -- --theme vault --size 960 --samples 64
python apps/web/art/export_webp.py --source scratch/landing-preview/results-vault
```

**Revert the entire card art treatment:** set `RESULT_ARTWORK` to `"studio"` in
`src/components/landing/ranking.tsx`. That single setting selects both the original
image URLs and the original CSS lighting. `"vault"` selects the darker version.
The builder defaults to `--theme studio` to reproduce the first version.

| Asset | Used for |
|---|---|
| `vault` | The scroll sequence and its poster — the whole first act of the page. |
| `mark` | The brand mark: the vault's own handwheel. The nav and favicon use a flat SVG derived from the same silhouette; this render is for large contexts. |
| `seal`, `podium` | Modelled, not currently on the page. Kept because the scenes are cheap to keep and expensive to rebuild. |

These are decorative. Every number and claim on the page comes from `src/config/evidence.ts`
and `src/content/landing.ts`, never from the artwork.
