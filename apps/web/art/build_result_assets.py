"""Four editorial product stills for the recorded tender cards. Blender 5.2 / Cycles.

blender --background --factory-startup --python apps/web/art/build_result_assets.py -- --samples 64
python apps/web/art/export_webp.py --source scratch/landing-preview/results
"""
import argparse
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

parser = argparse.ArgumentParser()
parser.add_argument('--asset', choices=['all', 'award', 'ranked', 'flagged', 'evidence'], default='all')
parser.add_argument('--size', type=int, default=960)
parser.add_argument('--samples', type=int, default=64)
parser.add_argument('--theme', choices=['studio', 'vault'], default='studio')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
BASE = Path(__file__).resolve().parent
VAULT = args.theme == 'vault'
SUFFIX = '-vault' if VAULT else ''
OUT = BASE.parents[2] / ('scratch/landing-preview/results-vault' if VAULT else 'scratch/landing-preview/results')
OUT.mkdir(parents=True, exist_ok=True)


def material(name, color, metal=0, rough=.3):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Roughness'].default_value = rough
    if metal > .5:
        bsdf.inputs['Anisotropic'].default_value = .3
        noise = mat.node_tree.nodes.new('ShaderNodeTexNoise')
        noise.inputs['Scale'].default_value = 190
        bump = mat.node_tree.nodes.new('ShaderNodeBump')
        bump.inputs['Strength'].default_value = .035 if VAULT else .12
        bump.inputs['Distance'].default_value = .003 if VAULT else .008
        mat.node_tree.links.new(noise.outputs['Fac'], bump.inputs['Height'])
        mat.node_tree.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    return mat


def box(name, xyz, dims, mat, radius=.06):
    bpy.ops.mesh.primitive_cube_add(size=1, location=xyz)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dims
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    bevel = obj.modifiers.new('Machined radii', 'BEVEL')
    bevel.width = radius
    bevel.segments = 5
    obj.modifiers.new('Weighted face normals', 'WEIGHTED_NORMAL')
    return obj


def line(name, points, mat, radius=.025, cyclic=False):
    data = bpy.data.curves.new(name, 'CURVE')
    data.dimensions = '3D'
    data.bevel_depth = radius
    data.bevel_resolution = 5
    spline = data.splines.new('POLY')
    spline.points.add(len(points) - 1)
    for point, xyz in zip(spline.points, points):
        point.co = (*xyz, 1)
    spline.use_cyclic_u = cyclic
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    return obj


def text_label(body, xyz, size, mat):
    curve = bpy.data.curves.new('Engraving / ' + body, 'FONT')
    curve.body = body
    curve.size = size
    curve.extrude = .001
    obj = bpy.data.objects.new(curve.name, curve)
    bpy.context.collection.objects.link(obj)
    obj.location = xyz
    obj.data.materials.append(mat)


def screw(x, y, z):
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=.052, depth=.018, location=(x, y, z))
    bpy.context.object.data.materials.append(silver)
    box('Socket', (x, y, z+.011), (.052, .011, .006), dark, .003)


def document(z=0, x=0, y=0):
    box('Titanium document edge', (x,y,z), (2.04,2.65,.16), silver, .10)
    box('Ceramic document face', (x,y,z+.095), (1.96,2.57,.08), dark, .085)
    for px in [-.84,.84]:
        screw(x+px,y+1.14,z+.145)


def award():
    document(.15)
    box('Mint selection inset', (0,.32,.325), (1.32,1.30,.22), mint, .14)
    line('Raised committee check', [(-.39,.31,.455),(-.10,.04,.455),(.43,.64,.455)], silver if VAULT else dark, .075)
    text_label('AWARD',(-.76,-.69,.295),.19,silver)
    for i,w in enumerate([1.48,1.03]):
        box('Engraved record line',(-.76+w/2,-.90-i*.15,.291),(w,.035,.012),muted,.01)
    # A second plate under the award makes the selected submission tangible.
    box('Underlying submission',(-.13,.13,-.08),(2.04,2.65,.12),muted,.10)


def ranked():
    for i in range(3):
        z = i*.43
        x = -.12*i
        y = .20*i
        box('Score record / titanium edge',(x,y,z),(2.40,1.55,.18),silver,.09)
        box('Score record / ceramic face',(x,y,z+.105),(2.32,1.47,.07),dark,.065)
        box('Index accent',(x-.97,y,z+.15),(.065,1.08,.018),violet,.015)
        for j,w in enumerate([1.22,.81,.53]):
            box('Recorded criterion',(x-.61+w/2,y+.40-j*.28,z+.153),(w,.095,.018),violet if j==0 else muted,.025)
        text_label('0'+str(3-i),(x+.70,y-.52,z+.15),.22,silver)


def flagged():
    document(.04)
    for i,w in enumerate([1.35,1.50,.94,1.30]):
        box('Submission text',(-.74+w/2,.80-i*.21,.19),(w,.055,.018),muted,.015)
    box('Flagged passage',(.02,.16,.21),(1.57,.15,.025),amber,.025)
    # A separate caution tile sits above the suspicious passage.
    box('Review tile',(.40,-.67,.43),(1.19,1.14,.16),dark,.10)
    line('Amber warning triangle',[(.40,-.20,.54),(-.06,-1.02,.54),(.86,-1.02,.54)],amber,.045,True)
    box('Caution stem',(.40,-.64,.55),(.075,.29,.06),amber,.025)
    box('Caution point',(.40,-.88,.55),(.075,.075,.06),amber,.018)
    for x in [-1.12,1.12]:
        side=1 if x<0 else -1
        line('Inspection bracket',[(x+side*.20,-1.37,.26),(x,-1.37,.26),(x,-.78,.26)],silver,.022)
    text_label('REVIEW',(-.76,-1.12,.19),.13,silver)


def evidence():
    box('Attestation substrate',(0,0,-.20),(2.45,2.45,.16),dark,.10)
    for side in [-1,1]:
        for i in range(9):
            offset=-.94+i*.235
            box('Processor contact',(offset,side*1.27,-.17),(.10,.27,.07),silver,.018)
            box('Processor contact',(side*1.27,offset,-.17),(.27,.10,.07),silver,.018)
    box('Lower package',(0,0,-.04),(1.94,1.94,.18),silver,.08)
    box('Isolated core',(0,0,.32),(1.50,1.50,.25),violet,.065)
    box('Core polished surface',(0,0,.455),(1.37,1.37,.03),dark,.045)
    text_label('TEE',(-.43,-.12,.478),.40,silver)
    for i in range(5):
        box('Die conductor',(-.44+i*.22,.43,.48),(.11,.055,.014),violet,.007)
    # Open frame exposes the separated layers instead of obscuring the core.
    z=.92
    for side in [-1,1]:
        box('Upper enclosure rail',(side*.99,0,z),(.17,2.13,.14),silver,.04)
        box('Upper enclosure rail',(0,side*.99,z),(1.87,.17,.14),silver,.04)
        for y in [-.99,.99]:
            screw(side*.99,y,z+.08)


def light(name, xyz, energy, color, size, target=(0,0,0), size_y=None):
    data=bpy.data.lights.new(name,'AREA')
    data.energy=energy
    data.color=color
    data.shape='RECTANGLE'
    data.size=size
    data.size_y=size_y or size
    obj=bpy.data.objects.new(name,data)
    bpy.context.collection.objects.link(obj)
    obj.location=xyz
    obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()


for asset in (['award','ranked','flagged','evidence'] if args.asset=='all' else [args.asset]):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene=bpy.context.scene
    bpy.context.preferences.filepaths.save_version=0
    scene.render.engine='CYCLES'
    scene.cycles.samples=args.samples
    scene.cycles.use_denoising=True
    scene.cycles.max_bounces=6
    prefs=bpy.context.preferences.addons['cycles'].preferences
    try:
        prefs.compute_device_type='CUDA'
        prefs.get_devices()
        for device in prefs.devices:
            device.use=device.type=='CUDA'
        scene.cycles.device='GPU' if any(d.type=='CUDA' for d in prefs.devices) else 'CPU'
    except (TypeError,RuntimeError):
        scene.cycles.device='CPU'
    scene.render.resolution_x=args.size
    scene.render.resolution_y=round(args.size*.85)
    scene.render.resolution_percentage=100
    scene.render.film_transparent=True
    scene.render.image_settings.file_format='PNG'
    scene.render.image_settings.color_mode='RGBA'
    scene.view_settings.view_transform='AgX'
    scene.view_settings.look='AgX - Medium High Contrast'
    scene.view_settings.exposure=-.45 if VAULT else 0
    world=bpy.data.worlds.new('Neutral studio')
    world.use_nodes=True
    world.node_tree.nodes['Background'].inputs[0].default_value=(.24,.26,.32,1)
    world.node_tree.nodes['Background'].inputs[1].default_value=.07 if VAULT else .35
    scene.world=world
    if VAULT:
        silver=material('Vault / smoked titanium',(.30,.29,.38),.9,.23)
        dark=material('Vault / blackened steel',(.065,.060,.092),.85,.31)
        muted=material('Vault / recessed graphite',(.16,.15,.22),.85,.34)
        mint=material('Vault / deep petrol alloy',(.055,.16,.12),.8,.28)
        violet=material('Vault / violet titanium',(.15,.10,.29),.85,.25)
        amber=material('Vault / burnished bronze',(.48,.23,.065),.8,.26)
    else:
        silver=material('Satin titanium',(.56,.61,.69),.8,.27)
        dark=material('Graphite ceramic',(.032,.042,.061),.4,.30)
        muted=material('Recessed aluminium',(.23,.29,.36),.65,.38)
        mint=material('Mint enamel',(.16,.68,.47),.35,.25)
        violet=material('Violet anodised alloy',(.35,.24,.66),.6,.28)
        amber=material('Amber enamel',(.95,.43,.065),.3,.27)
    globals()[asset]()
    if VAULT:
        # Narrow sources reveal the bevels while keeping broad faces dark, like the hero.
        light('Vault / overhead strip',(-3,2,7),650,(.86,.85,1),2.6,size_y=1.3)
        light('Vault / violet rim',(4,1,3),850,(.46,.32,1),1.2,size_y=5)
        light('Vault / left reflection',(-4,-1,3),220,(.62,.66,1),1.2,size_y=4.5)
        light('Vault / soft front fill',(1,-5,5),100,(.86,.85,1),3,size_y=4)
    else:
        light('Key softbox',(-3,-4,7),750,(.86,.92,1),5)
        light('Long edge reflection',(4,1,5),900,(.75,.80,1),3,size_y=6)
        light('Warm fill',(-4,3,2),500,(1,.86,.70),3)
        light('Front strip',(1,-5,2),170,(.80,1,.95),2,size_y=4)
    bpy.ops.object.camera_add(location=(4.4,-6.6,7.6))
    camera=bpy.context.object
    target=Vector((0,0,.28 if asset=='evidence' else .15))
    camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
    camera.data.type='ORTHO'
    camera.data.ortho_scale=4.65
    scene.camera=camera
    scene.render.filepath=str(OUT/f'result-{asset}{SUFFIX}-poster.png')
    bpy.ops.wm.save_as_mainfile(filepath=str(BASE/'production'/f'result-{asset}{SUFFIX}.blend'))
    bpy.ops.render.render(write_still=True)
    print('RESULT_COMPLETE',asset,flush=True)
