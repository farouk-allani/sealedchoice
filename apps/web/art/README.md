# Landing artwork

Original, locally modeled Blender geometry. `production/*.blend` contains the editable vault, security seal, and podium scenes, including materials, camera, and studio lights. No purchased assets or external textures.

The website uses Cycles-rendered WebP sequences rather than live WebGL. GSAP maps scroll progress to 24 vault poses and 24 seal poses. High-resolution posters provide the initial view, reduced-motion presentation, and loading/error fallback. The podium render is separate so its seal can move independently.

## Rebuild

Run from the repository root with Blender 5.2 and Python with Pillow. On this workstation:

```powershell
$blenderExe = 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe'
& $blenderExe --background --factory-startup --python apps/web/art/build_assets.py -- --asset vault --size 1400 --samples 40 --poster
& $blenderExe --background --factory-startup --python apps/web/art/build_assets.py -- --asset vault --size 768 --samples 12 --frames 24
& $blenderExe --background --factory-startup --python apps/web/art/build_assets.py -- --asset seal --size 640 --samples 40 --poster
& $blenderExe --background --factory-startup --python apps/web/art/build_assets.py -- --asset seal --size 400 --samples 16 --frames 24
& $blenderExe --background --factory-startup --python apps/web/art/build_assets.py -- --asset podium --size 1100 --samples 40 --poster
python apps/web/art/export_webp.py
```

The scene generator uses this workstation's CUDA GPU and falls back to CPU when unavailable. Rendering overwrites the corresponding editable scene. Temporary PNGs go into git-ignored `scratch/landing-preview/blender`; only the WebP exports are loaded by the frontend. The scripts also accept output/source directory arguments.

Vault motion is a perspective change of the whole object, not an opening door. The seal sequence changes its angle under fixed studio lights. These assets are decorative; result values and protocol claims remain in the existing evidence/content modules.
