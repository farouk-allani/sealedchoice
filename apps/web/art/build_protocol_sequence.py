"""The protocol assembly as one continuous machine cycle, rendered as a scroll frame sequence.

One scene, one fixed camera, six stage keyframes. Everything moves for a physical reason:
cartridges seat into the input slots, the gate freezes that set, the cover lifts on its guide
rods, the core lights, records rise out of the output deck, the selected record lifts, and the
evidence binding closes around the deck. Nothing pops into existence.

blender --background --factory-startup --python apps/web/art/build_protocol_sequence.py -- --size 900 --samples 24
python apps/web/art/export_webp.py --source scratch/landing-preview/protocol-seq

Geometry illustrates data flow, not the physical architecture of OutLayer hardware.
"""
import argparse
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

parser = argparse.ArgumentParser()
parser.add_argument('--size', type=int, default=900)
parser.add_argument('--samples', type=int, default=24)
parser.add_argument('--step', type=int, default=12, help='frames between stage keyframes')
parser.add_argument('--start', type=int, default=0)
parser.add_argument('--end', type=int, default=-1)
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])

BASE = Path(__file__).resolve().parent
OUT = BASE.parents[2] / 'scratch/landing-preview/protocol-seq'
OUT.mkdir(parents=True, exist_ok=True)

STEP = args.step
SEALED, CLOSED, OPENED, SCORED, AWARDED, VERIFIED = (i * STEP for i in range(6))
LAST = VERIFIED

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.preferences.filepaths.save_version = 0
bpy.context.preferences.edit.keyframe_new_interpolation_type = 'BEZIER'
bpy.context.preferences.edit.keyframe_new_handle_type = 'AUTO_CLAMPED'
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = args.samples
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 6
prefs = bpy.context.preferences.addons['cycles'].preferences
try:
    prefs.compute_device_type = 'CUDA'
    prefs.get_devices()
    for device in prefs.devices:
        device.use = device.type == 'CUDA'
    scene.cycles.device = 'GPU' if any(d.type == 'CUDA' for d in prefs.devices) else 'CPU'
except (RuntimeError, TypeError):
    scene.cycles.device = 'CPU'
scene.render.resolution_x = args.size
scene.render.resolution_y = args.size
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - Medium High Contrast'
scene.view_settings.exposure = -.35
world = bpy.data.worlds.new('Vault studio')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (.19, .18, .28, 1)
world.node_tree.nodes['Background'].inputs[1].default_value = .10
scene.world = world


def material(name, rgb, metallic=.85, roughness=.27, emission=0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    node = mat.node_tree.nodes.get('Principled BSDF')
    node.inputs['Base Color'].default_value = (*rgb, 1)
    node.inputs['Metallic'].default_value = metallic
    node.inputs['Roughness'].default_value = roughness
    node.inputs['Anisotropic'].default_value = .25
    node.inputs['Emission Color'].default_value = (*rgb, 1)
    node.inputs['Emission Strength'].default_value = emission
    return mat


def emit_key(mat, frame, strength):
    """Keyframe a material's emission so lighting states ramp instead of switching."""
    node = mat.node_tree.nodes.get('Principled BSDF').inputs['Emission Strength']
    node.default_value = strength
    node.keyframe_insert('default_value', frame=frame)


black = material('Blackened steel', (.055, .05, .085), .8, .32)
titanium = material('Smoked titanium', (.25, .24, .33), .9, .29)
edge = material('Polished graphite edges', (.38, .37, .48), .92, .22)
violet = material('Violet conductor', (.23, .13, .55), .65, .25, .35)
violet_out = material('Violet output conductor', (.23, .13, .55), .65, .25, 0)
mint = material('Selection enamel', (.09, .38, .27), .65, .27, 0)
amber = material('Frozen input boundary', (.46, .23, .075), .8, .27)
ceramic = material('Processor ceramic', (.025, .022, .045), .35, .29)
corelight = material('Active core seam', (.27, .18, .72), .25, .24, 0)


def box(name, pos, dims, mat, radius=.04):
    bpy.ops.mesh.primitive_cube_add(size=1, location=pos)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dims
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    bevel = obj.modifiers.new('Machined edge', 'BEVEL')
    bevel.width = radius
    bevel.segments = 4
    obj.modifiers.new('Face normals', 'WEIGHTED_NORMAL')
    return obj


def wire(name, points, mat, radius=.018):
    curve = bpy.data.curves.new(name, 'CURVE')
    curve.dimensions = '3D'
    curve.bevel_depth = radius
    curve.bevel_resolution = 4
    path = curve.splines.new('POLY')
    path.points.add(len(points) - 1)
    for point, xyz in zip(path.points, points):
        point.co = (*xyz, 1)
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    return obj


def label(body, pos, size, mat):
    curve = bpy.data.curves.new(body, 'FONT')
    curve.body = body
    curve.size = size
    curve.extrude = .001
    obj = bpy.data.objects.new(body, curve)
    bpy.context.collection.objects.link(obj)
    obj.location = pos
    obj.data.materials.append(mat)
    return obj


def screw(x, y, z):
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=.055, depth=.025, location=(x, y, z))
    head = bpy.context.object
    head.data.materials.append(edge)
    return [head, box('Socket', (x, y, z + .015), (.055, .013, .009), black, .002)]


def frame_ring(name, width, depth, z, mat):
    parts = []
    for side in [-1, 1]:
        parts.append(box(name, (side * width / 2, 0, z), (.10, depth, .10), mat, .025))
        parts.append(box(name, (0, side * depth / 2, z), (width, .10, .10), mat, .025))
    return parts


def cartridge(x, y, z):
    parts = [
        box('Encrypted cartridge edge', (x, y, z), (1.10, .68, .16), edge, .07),
        box('Opaque payload shell', (x, y, z + .10), (1.03, .61, .10), black, .06),
        box('Sealed cartridge band', (x, y, z + .16), (.16, .63, .035), titanium, .015),
    ]
    for i in range(3):
        parts.append(box('Ciphertext index', (x - .36 + i * .11, y - .18, z + .16), (.05, .10, .025), violet, .008))
    return parts


def receipt(x, y, z, archive=False):
    parts = [
        box('Recorded output', (x, y, z), (1.02, .74, .10), edge, .05),
        box('Output face', (x, y, z + .065), (.95, .67, .05), black, .035),
    ]
    for j, length in enumerate([.61, .43, .55]):
        parts.append(box('Recorded values', (x - .33 + length / 2, y + .20 - j * .15, z + .099),
                         (length, .035, .012), titanium, .009))
    if archive:
        parts.append(wire('Receipt signature', [(x - .30, y - .23, z + .11), (x - .18, y - .14, z + .11),
                                                (x - .10, y - .25, z + .11), (x + .08, y - .19, z + .11)], violet, .013))
    return parts


def area(name, pos, power, color, size, sy):
    light = bpy.data.lights.new(name, 'AREA')
    light.energy = power
    light.color = color
    light.shape = 'RECTANGLE'
    light.size = size
    light.size_y = sy
    obj = bpy.data.objects.new(name, light)
    bpy.context.collection.objects.link(obj)
    obj.location = pos
    obj.rotation_euler = (Vector((0, 0, .6)) - obj.location).to_track_quat('-Z', 'Y').to_euler()


REST = {}


def flat(groups):
    """receipt()/cartridge()/screw() return lists, so groups of groups need flattening."""
    out = []
    for item in groups:
        out.extend(item) if isinstance(item, list) else out.append(item)
    return out


def lift(parts, keys):
    """Keyframe a group's Z offset. keys: [(frame, dz)] against each part's ORIGINAL rest Z.

    The rest height is recorded once per object, so a group that is lifted twice (the awarded
    record rises again after every record has risen) stays measured from where it was built.
    """
    for part in flat(parts):
        rest = REST.setdefault(part.name_full, part.location.z)
        for frame, dz in keys:
            part.location.z = rest + dz
            part.keyframe_insert('location', index=2, frame=frame)
        part.location.z = rest + keys[0][1]


def bottom_anchor(obj):
    """Move the origin to the part's underside so scaling Z extends it upward from its seat."""
    half = obj.dimensions.z / 2
    obj.data.transform(Matrix.Translation((0, 0, half)))
    obj.location.z -= half
    return obj


def grow_z(parts, keys):
    """Keyframe Z scale only, for a bottom-anchored part that telescopes."""
    for part in flat(parts):
        for frame, value in keys:
            part.scale.z = value
            part.keyframe_insert('scale', index=2, frame=frame)
        part.scale.z = keys[0][1]


def grow(parts, keys):
    """Keyframe uniform scale, so a mark can draw itself in instead of popping on."""
    for part in flat(parts):
        for frame, value in keys:
            part.scale = (value, value, value)
            part.keyframe_insert('scale', frame=frame)
        part.scale = (keys[0][1],) * 3


# ---------------------------------------------------------------- static chassis
box('Protocol chassis', (0, 0, -.20), (6.1, 3.75, .24), black, .18)
box('Chassis lower lip', (0, 0, -.34), (5.96, 3.60, .08), titanium, .12)
for x in [-2.78, 2.78]:
    for y in [-1.62, 1.62]:
        screw(x, y, -.065)

cartridges = []
receipts = []
archives = []
for i in range(3):
    y = .90 - i * .90
    wire('Input conductor', [(-2.15, y, -.065), (-1.44, y, -.065), (-1.20, y * .7, -.065)], violet)
    wire('Output conductor', [(1.20, y * .7, -.065), (1.48, y, -.065), (2.15, y, -.065)], violet_out)
    box('Empty output socket', (2.16, y, -.04), (1.1, .76, .07), ceramic, .06)
    cartridges.append(cartridge(-2.18, y, -.015))
    receipts.append(receipt(2.16, y, .13))
    archives.append(receipt(2.16, y, .33, archive=True))
label('INPUT', (-2.69, -1.49, -.065), .15, titanium)
label('RECORD', (1.65, -1.49, -.065), .15, titanium)

# ---------------------------------------------------------------- fixed evaluator base
box('Pinned evaluator mount', (0, 0, .03), (2.48, 2.62, .28), edge, .12)
box('Enclave base', (0, 0, .22), (2.34, 2.48, .17), black, .09)
frame_ring('Enclave perimeter', 2.15, 2.28, .40, titanium)
for side in [-1, 1]:
    for y in [-1.04, 1.04]:
        box('Fixed corner standoff', (side * .97, y, .58), (.15, .15, .60), titanium, .035)
        screw(side * .97, y, .90)
for side in [-1, 1]:
    for i in range(7):
        box('Processor contact', (-.63 + i * .21, side * .83, .44), (.09, .23, .06), edge, .015)
box('Isolated processor', (0, 0, .46), (1.62, 1.62, .22), ceramic, .08)
box('Core illumination', (0, 0, .59), (1.37, 1.37, .045), corelight, .04)
box('Core cap', (0, 0, .64), (1.31, 1.31, .08), black, .05)
label('TEE', (-.39, -.12, .685), .36, edge)

# ---------------------------------------------------------------- moving groups
LID_DOWN, LID_UP = .98, 2.02
posts = []
lid = [
    box('Pinned evaluator cover', (0, 0, LID_DOWN), (2.40, 2.54, .20), edge, .12),
    box('Cover ceramic inset', (0, 0, LID_DOWN + .125), (2.25, 2.39, .08), black, .09),
    label('PINNED', (-.76, .39, LID_DOWN + .17), .25, titanium),
    label('EVALUATOR', (-.76, .08, LID_DOWN + .17), .21, titanium),
]
for i in range(5):
    lid.append(box('Cover cooling channel', (-.73 + i * .365, -.55, LID_DOWN + .17), (.09, .43, .025), ceramic, .018))
for x in [-.98, .98]:
    for y in [-1.05, 1.05]:
        lid.extend(screw(x, y, LID_DOWN + .17))
        # Telescoping guide, seated on the standoff. It extends as the cover rises.
        posts.append(bottom_anchor(box('Cover guide post', (x, y, (.91 + LID_UP - .13) / 2),
                                       (.05, .05, LID_UP - .13 - .91), titanium, .006)))

gate = [box('Frozen input gate', (-1.41, 0, .37), (.15, 2.96, .18), amber, .035)]
for y in [-1.35, 1.35]:
    box('Gate anchor', (-1.41, y, .11), (.31, .28, .47), titanium, .05)

channels = [box('Criterion channel', (-.42 + i * .42, 0, .82), (.17, .63 + i * .14, .04), violet, .025) for i in range(3)]

selection = [wire('Committee selection', [(2.35, .70, .24), (2.43, .63, .24), (2.58, .82, .24)], mint, .025)]

binding = frame_ring('Evidence record binding', 5.58, 3.30, -.045, titanium)

# ---------------------------------------------------------------- the machine cycle
# Cartridges arrive raised, then seat into the input slots as the deadline closes.
lift(cartridges, [(SEALED, .115), (CLOSED, 0), (LAST, 0)])
# The gate rises out of the deck and stays up: the bid set is frozen from the deadline on.
lift(gate, [(SEALED, -.57), (CLOSED, 0), (LAST, 0)])
# The cover lifts on its guide rods and stays open for the rest of the cycle.
lift(lid, [(CLOSED, 0), (OPENED, LID_UP - LID_DOWN), (LAST, LID_UP - LID_DOWN)])
grow_z(posts, [(CLOSED, .001), (OPENED, 1), (LAST, 1)])
# Criterion channels emerge from under the core cap while scoring runs.
lift(channels, [(OPENED, -.26), (SCORED, 0), (LAST, 0)])
# Records rise out of the output deck once scoring has produced them.
lift(receipts, [(OPENED, -.62), (SCORED, 0), (LAST, 0)])
# The selected record lifts clear of the other two, with its mark.
lift([receipts[0], selection], [(SCORED, 0), (AWARDED, .30), (LAST, .30)])
grow(selection, [(SCORED, .001), (AWARDED, 1), (LAST, 1)])
# The archive layer and the binding close the cycle.
lift(archives, [(AWARDED, -.95), (VERIFIED, 0)])
lift(binding, [(AWARDED, -.215), (VERIFIED, 0)])

# Lighting states ramp with the motion rather than switching between stills.
emit_key(corelight, CLOSED, 0)
emit_key(corelight, OPENED, 1.8)
emit_key(violet_out, OPENED, 0)
emit_key(violet_out, SCORED, .35)
emit_key(mint, SCORED, 0)
emit_key(mint, AWARDED, .15)

area('Vault overhead strip', (-4, 2, 8), 1150, (.86, .85, 1), 3, 1.5)
area('Violet edge strip', (5, 2, 4), 1450, (.46, .32, 1), 1.5, 6)
area('Left reflection', (-5, -2, 4), 500, (.62, .66, 1), 1.6, 5)
area('Front readability', (1, -6, 6), 240, (.86, .85, 1), 4, 4)
bpy.ops.object.camera_add(location=(7, -10, 9))
camera = bpy.context.object
camera.rotation_euler = (Vector((0, 0, .55)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
camera.data.type = 'ORTHO'
camera.data.ortho_scale = 7.75
scene.camera = camera

scene.frame_start = args.start
scene.frame_end = LAST if args.end < 0 else args.end
scene.render.filepath = str(OUT / 'protocol-seq-')
scene.render.use_overwrite = True
bpy.ops.wm.save_as_mainfile(filepath=str(BASE / 'production' / 'protocol-sequence.blend'))
bpy.ops.render.render(animation=True)
print('PROTOCOL_SEQUENCE_COMPLETE', scene.frame_start, scene.frame_end, flush=True)
