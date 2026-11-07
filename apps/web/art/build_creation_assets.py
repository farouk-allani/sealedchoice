"""Original creation-step stills. Blender 5.2 / Cycles, with editable source scenes.

blender --background --factory-startup --python apps/web/art/build_creation_assets.py -- --size 960 --samples 96
python apps/web/art/export_webp.py --source scratch/creation-art

These are conceptual objects. Engraved lines and controls do not encode live tender data.
"""
import argparse
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

parser = argparse.ArgumentParser()
parser.add_argument("--asset", choices=["all", "brief", "scoring", "committee", "review"], default="all")
parser.add_argument("--size", type=int, default=960)
parser.add_argument("--samples", type=int, default=96)
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
BASE = Path(__file__).resolve().parent
OUT = BASE.parents[2] / "scratch/creation-art"
OUT.mkdir(parents=True, exist_ok=True)
(BASE / "production").mkdir(exist_ok=True)


def material(name, color, metal=0, roughness=.35, brushed=False):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Roughness"].default_value = roughness
    if brushed:
        bsdf.inputs["Anisotropic"].default_value = .35
        noise = mat.node_tree.nodes.new("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = 240
        bump = mat.node_tree.nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = .075
        bump.inputs["Distance"].default_value = .004
        mat.node_tree.links.new(noise.outputs["Fac"], bump.inputs["Height"])
        mat.node_tree.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def finish(obj, name, mat, bevel=.03):
    obj.name = name
    obj.data.materials.append(mat)
    obj.parent = root
    if bevel:
        mod = obj.modifiers.new("Machined edge radii", "BEVEL")
        mod.width = bevel
        mod.segments = 5
        mod = obj.modifiers.new("Weighted face normals", "WEIGHTED_NORMAL")
        mod.keep_sharp = True
    return obj


def box(name, pos, dims, mat, bevel=.03):
    bpy.ops.mesh.primitive_cube_add(size=1, location=pos)
    obj = bpy.context.object
    obj.dimensions = dims
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(obj, name, mat, bevel)


def cylinder(name, pos, radius, depth, mat, bevel=.012, vertices=96):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=pos)
    obj = finish(bpy.context.object, name, mat, bevel)
    for face in obj.data.polygons:
        face.use_smooth = len(face.vertices) == 4
    return obj


def rod(name, start, end, radius, mat):
    direction = Vector(end) - Vector(start)
    obj = cylinder(name, (Vector(start) + Vector(end)) / 2, radius, direction.length, mat)
    obj.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
    return obj


def line(name, points, mat, radius=.025):
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = radius
    curve.bevel_resolution = 5
    spline = curve.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for point, xyz in zip(spline.points, points):
        point.co = (*xyz, 1)
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    obj.parent = root
    obj.data.materials.append(mat)
    return obj


def screw(x, y, z):
    cylinder("Recessed titanium fastener", (x, y, z), .048, .024, edge, .006, 48)
    box("Fastener drive", (x, y, z + .015), (.054, .010, .006), graphite, .002)


def brand_mark(x, y, z, size=.35, mat=None):
    """Extrude the same two circular-arrow paths used by the HTML brand mark."""
    for i, (start, end, tail) in enumerate([
        (math.atan2(1, -13.964), math.tau + math.atan2(-5, 13.077), [(8, 11), (14, 17)]),
        (math.atan2(-1, 13.964), math.atan2(5, -13.077), [(24, 21), (18, 15)]),
    ]):
        arc = [(16 + 14 * math.cos(start + (end - start) * t / 48),
                16 + 14 * math.sin(start + (end - start) * t / 48)) for t in range(49)]
        points = [(x + (px - 16) * size / 32, y - (py - 16) * size / 32, z) for px, py in arc + tail]
        mesh = bpy.data.meshes.new("Brand mark / arrow")
        mesh.from_pydata(points, [], [tuple(range(len(points)))])
        mesh.update()
        obj = bpy.data.objects.new(f"SealedChoice mark / {i}", mesh)
        bpy.context.collection.objects.link(obj)
        obj.parent = root
        obj.data.materials.append(mat or violet)
        solid = obj.modifiers.new("Raised engraving", "SOLIDIFY")
        solid.thickness = .012
        solid.offset = 1
        bevel = obj.modifiers.new("Engraving edge", "BEVEL")
        bevel.width = .004
        bevel.segments = 3


def record_lines(x, y, z, widths, mat=None, gap=.19, thickness=.045):
    for i, width in enumerate(widths):
        box("Inset document line", (x + width / 2, y - i * gap, z), (width, thickness, .012), mat or ink, .009)


def brief():
    box("Brief / graphite folio", (0, 0, .04), (2.28, 2.98, .18), graphite, .12)
    box("Brief / polished perimeter", (0, 0, .145), (2.17, 2.87, .045), edge, .09)
    for index in range(3):
        box("Brief / layered paper", (-.035 * index, .035 * index, .19 + index * .035), (2.03, 2.70, .030), paper, .055)
    z = .284
    brand_mark(-.64, .82, z, .37)
    record_lines(-.25, .92, z, [.91, .66], muted, .16, .06)
    record_lines(-.72, .37, z, [1.43, 1.39, 1.14, 1.34], ink, .20)
    box("Brief / scope inset", (0, -.66, z), (1.46, .48, .018), pale_violet, .045)
    record_lines(-.56, -.56, z + .015, [1.12, .79], violet, .17, .038)
    # A real folded metal clip: rail, two pivots and the spring bridge.
    box("Brief / clip base", (0, 1.22, .30), (.93, .26, .11), edge, .045)
    box("Brief / clip spring", (0, 1.16, .40), (.71, .40, .075), graphite, .04)
    rod("Brief / clip hinge", (-.52, 1.27, .36), (.52, 1.27, .36), .055, titanium)
    for px in [-.39, .39]:
        screw(px, 1.23, .42)
    # The pen rests on the folio edge, with separate nib, grip and barrel.
    rod("Brief / pen barrel", (1.04, -.76, .32), (1.28, .97, .32), .065, titanium)
    rod("Brief / violet pen grip", (1.035, -.80, .32), (1.10, -.33, .32), .074, violet)
    rod("Brief / pen nib", (.995, -1.08, .32), (1.03, -.82, .32), .031, edge)
    rod("Brief / pen cap", (1.28, .97, .32), (1.31, 1.16, .32), .068, graphite)


def scoring():
    box("Scoring / instrument chassis", (0, 0, .06), (2.95, 2.65, .24), graphite, .14)
    box("Scoring / satin edge", (0, 0, .20), (2.81, 2.51, .055), titanium, .10)
    box("Scoring / recessed face", (0, 0, .24), (2.68, 2.38, .048), graphite, .075)
    for x, knob_y in zip([-.83, 0, .83], [.46, .03, -.40]):
        box("Scoring / rail surround", (x, .10, .28), (.30, 1.70, .045), titanium, .045)
        box("Scoring / recessed travel slot", (x, .10, .315), (.10, 1.55, .032), ink, .038)
        rod("Scoring / steel slide rail", (x, -.62, .335), (x, .82, .335), .025, edge)
        for index in range(8):
            width = .18 if index % 2 == 0 else .11
            box("Scoring / engraved calibration", (x - .27, -.57 + index * .19, .274), (width, .016, .008), muted, .003)
        box("Scoring / anodised weight control", (x, knob_y, .41), (.51, .36, .18), violet, .055)
        box("Scoring / polished control face", (x, knob_y, .51), (.41, .25, .035), lavender_metal, .035)
        for offset in [-.08, 0, .08]:
            box("Scoring / tactile control groove", (x + offset, knob_y, .532), (.015, .12, .008), pale_violet, .004)
        cylinder("Scoring / dial seat", (x, -.98, .30), .135, .055, titanium)
        cylinder("Scoring / machined dial", (x, -.98, .37), .105, .11, violet)
        box("Scoring / dial pointer", (x, -.94, .432), (.016, .085, .009), paper, .003)
    for x in [-1.24, 1.24]:
        for y in [-1.08, 1.08]:
            screw(x, y, .28)


def avatar(x, y, z):
    cylinder("Committee / embossed reviewer head", (x, y + .12, z), .108, .035, titanium, .008, 64)
    # Rounded shoulder silhouette sits in the same plane as the credential.
    box("Committee / embossed reviewer shoulders", (x, y - .12, z), (.43, .22, .035), titanium, .095)


def committee():
    # Three distinct review credentials fan around one shared submission record.
    box("Committee / shared review folio", (0, -.39, .02), (2.72, 2.18, .16), graphite, .12)
    box("Committee / shared submission", (0, -.40, .13), (2.45, 1.92, .045), paper, .07)
    record_lines(-.94, -.71, .162, [1.81, 1.40, 1.65], ink, .18, .045)
    for index, (x, y, z, angle) in enumerate([(-.83, .20, .22, -.27), (0, .48, .43, -.05), (.83, .61, .64, .21)]):
        collection_before = set(bpy.data.objects)
        box("Committee / credential edge", (x, y, z), (1.03, 1.65, .10), titanium, .075)
        box("Committee / credential face", (x, y, z + .065), (.94, 1.55, .045), graphite, .06)
        box("Committee / reviewer inset", (x, y + .20, z + .10), (.66, .70, .032), violet, .06)
        avatar(x, y + .20, z + .14)
        record_lines(x - .31, y - .34, z + .103, [.62, .42], paper, .15, .035)
        box("Committee / key contact", (x, y - .64, z + .104), (.34, .075, .018), lavender_metal, .02)
        # Rotate each card's actual geometry together around its own centre.
        anchor = bpy.data.objects.new(f"Committee / reviewer {index + 1}", None)
        bpy.context.collection.objects.link(anchor)
        anchor.parent = root
        anchor.location = (x, y, z)
        for obj in set(bpy.data.objects) - collection_before - {anchor}:
            obj.parent = anchor
            obj.location -= Vector((x, y, z))
        anchor.rotation_euler.z = angle
    box("Committee / shared approval clasp", (0, -1.17, .25), (1.07, .24, .13), violet, .045)
    brand_mark(0, -1.17, .325, .21, paper)


def review():
    box("Review / bound dossier", (0, 0, .045), (2.31, 2.95, .20), graphite, .12)
    for index in range(4):
        box("Review / bound page edges", (.02, -.01, .17 + index * .022), (2.12, 2.74, .018), paper, .06)
    box("Review / satin cover", (0, 0, .28), (2.23, 2.87, .07), titanium, .08)
    box("Review / inset document face", (.07, 0, .324), (1.90, 2.61, .025), paper, .06)
    record_lines(-.60, .91, .345, [1.13, .87], violet, .20, .07)
    record_lines(-.60, .39, .345, [1.35, 1.14, 1.27], ink, .18, .04)
    # A wrapped band and a separate pressed seal convey checking and fixing the brief.
    box("Review / violet binding band", (0, -.66, .37), (2.38, .38, .075), violet, .035)
    for y in [-.95, .84]:
        rod("Review / binding pin", (-.94, y - .13, .40), (-.94, y + .13, .40), .06, edge)
        box("Review / hinge foot", (-.94, y, .34), (.19, .37, .08), graphite, .035)
    cylinder("Review / knurled seal perimeter", (.32, -.63, .46), .49, .17, lavender_metal, .018, 64)
    cylinder("Review / polished seal rim", (.32, -.63, .56), .426, .045, edge)
    cylinder("Review / violet seal face", (.32, -.63, .59), .365, .028, violet)
    line("Review / raised review check", [(.12, -.64, .62), (.27, -.80, .62), (.57, -.46, .62)], paper, .045)
    for i in range(32):
        angle = math.tau * i / 32
        ridge = box("Review / seal edge knurl", (.32 + .475 * math.cos(angle), -.63 + .475 * math.sin(angle), .47), (.032, .025, .12), titanium, .006)
        ridge.rotation_euler.z = angle
    brand_mark(.61, 1.02, .348, .28)


def area(name, pos, energy, color, width, height=None):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.color = color
    data.shape = "RECTANGLE"
    data.size = width
    data.size_y = height or width
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = pos
    obj.rotation_euler = (Vector((0, 0, .25)) - obj.location).to_track_quat("-Z", "Y").to_euler()


for asset in (["brief", "scoring", "committee", "review"] if args.asset == "all" else [args.asset]):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.save_version = 0
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = args.samples
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 6
    scene.cycles.seed = 31
    prefs = bpy.context.preferences.addons["cycles"].preferences
    try:
        prefs.compute_device_type = "CUDA"
        prefs.get_devices()
        for device in prefs.devices:
            device.use = device.type == "CUDA"
        scene.cycles.device = "GPU" if any(device.type == "CUDA" for device in prefs.devices) else "CPU"
    except (TypeError, RuntimeError):
        scene.cycles.device = "CPU"
    scene.render.resolution_x = args.size
    scene.render.resolution_y = round(args.size * .75)
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = -.18
    world = bpy.data.worlds.new("Soft violet product studio")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (.49, .47, .57, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = .32
    scene.world = world
    root = bpy.data.objects.new("SealedChoice / creation artwork", None)
    scene.collection.objects.link(root)
    graphite = material("Blackened graphite", (.075, .065, .105), .72, .29, True)
    titanium = material("Satin titanium", (.36, .34, .43), .82, .26, True)
    edge = material("Polished machined edge", (.64, .62, .73), .9, .20)
    paper = material("Porcelain paper", (.81, .79, .86), .03, .49)
    ink = material("Debossed slate", (.16, .13, .22), .28, .42)
    muted = material("Recessed titanium ink", (.26, .22, .34), .45, .34)
    violet = material("Violet anodised aluminium", (.24, .13, .41), .58, .27)
    pale_violet = material("Soft lavender ceramic", (.51, .43, .66), .2, .36)
    lavender_metal = material("Brushed violet titanium", (.47, .34, .65), .75, .23, True)
    globals()[asset]()
    root.rotation_euler.z = math.radians(-7 if asset == "brief" else 0)
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -.105))
    floor = bpy.context.object
    floor.name = "Transparent contact-shadow catcher"
    floor.is_shadow_catcher = True
    floor.data.materials.append(material("Studio floor", (.74, .72, .80), 0, .6))
    area("Key / broad porcelain reflection", (-3, -4, 7), 650, (.94, .92, 1), 4.5)
    area("Rim / violet strip", (4, 2, 4), 850, (.68, .54, 1), 2, 5)
    area("Fill / neutral longbox", (-4, 2, 3), 450, (.86, .88, 1), 3, 4)
    area("Front / soft metal detail", (1, -5, 3), 150, (1, .94, .92), 3)
    bpy.ops.object.camera_add(location=(5.1, -7.2, 8.6))
    camera = bpy.context.object
    camera.rotation_euler = (Vector((0, 0, .25)) - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 4.9
    scene.camera = camera
    scene.render.filepath = str(OUT / f"create-{asset}-poster.png")
    bpy.ops.wm.save_as_mainfile(filepath=str(BASE / "production" / f"create-{asset}.blend"))
    bpy.ops.render.render(write_still=True)
    print(f"CREATION_COMPLETE {asset}", flush=True)
