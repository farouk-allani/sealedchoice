"""Six conceptual protocol stages, modelled and rendered in Blender/Cycles.

blender --background --factory-startup --python apps/web/art/build_protocol_assets.py
python apps/web/art/export_webp.py --source scratch/landing-preview/protocol
Geometry illustrates data flow, not the physical architecture of OutLayer hardware.
"""
import argparse
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

parser = argparse.ArgumentParser()
parser.add_argument('--stage', default='all', choices=['all','sealed','closed','opened','scored','awarded','verified'])
parser.add_argument('--size', type=int, default=1200)
parser.add_argument('--samples', type=int, default=64)
args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
BASE = Path(__file__).resolve().parent
OUT = BASE.parents[2] / 'scratch/landing-preview/protocol'
OUT.mkdir(parents=True, exist_ok=True)
STAGES = ['sealed','closed','opened','scored','awarded','verified']


def material(name, rgb, metallic=.85, roughness=.27, emission=0):
    mat=bpy.data.materials.new(name)
    mat.use_nodes=True
    node=mat.node_tree.nodes.get('Principled BSDF')
    node.inputs['Base Color'].default_value=(*rgb,1)
    node.inputs['Metallic'].default_value=metallic
    node.inputs['Roughness'].default_value=roughness
    node.inputs['Anisotropic'].default_value=.25
    if emission:
        node.inputs['Emission Color'].default_value=(*rgb,1)
        node.inputs['Emission Strength'].default_value=emission
    return mat


def box(name, pos, dims, mat, radius=.04):
    bpy.ops.mesh.primitive_cube_add(size=1,location=pos)
    obj=bpy.context.object
    obj.name=name
    obj.dimensions=dims
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    obj.data.materials.append(mat)
    bevel=obj.modifiers.new('Machined edge','BEVEL')
    bevel.width=radius
    bevel.segments=4
    obj.modifiers.new('Face normals','WEIGHTED_NORMAL')
    return obj


def wire(name, points, mat, radius=.018):
    curve=bpy.data.curves.new(name,'CURVE')
    curve.dimensions='3D'
    curve.bevel_depth=radius
    curve.bevel_resolution=4
    path=curve.splines.new('POLY')
    path.points.add(len(points)-1)
    for point,xyz in zip(path.points,points):
        point.co=(*xyz,1)
    obj=bpy.data.objects.new(name,curve)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)


def label(body,pos,size,mat):
    curve=bpy.data.curves.new(body,'FONT')
    curve.body=body
    curve.size=size
    curve.extrude=.001
    obj=bpy.data.objects.new(body,curve)
    bpy.context.collection.objects.link(obj)
    obj.location=pos
    obj.data.materials.append(mat)


def screw(x,y,z):
    bpy.ops.mesh.primitive_cylinder_add(vertices=32,radius=.055,depth=.025,location=(x,y,z))
    bpy.context.object.data.materials.append(edge)
    box('Socket',(x,y,z+.015),(.055,.013,.009),black,.002)


def frame(name, width, depth, z, mat):
    for side in [-1,1]:
        box(name,(side*width/2,0,z),(.10,depth,.10),mat,.025)
        box(name,(0,side*depth/2,z),(width,.10,.10),mat,.025)


def cartridge(x,y,z):
    box('Encrypted cartridge edge',(x,y,z),(1.10,.68,.16),edge,.07)
    box('Opaque payload shell',(x,y,z+.10),(1.03,.61,.10),black,.06)
    box('Sealed cartridge band',(x,y,z+.16),(.16,.63,.035),titanium,.015)
    for i in range(3):
        box('Ciphertext index',(x-.36+i*.11,y-.18,z+.16),(.05,.10,.025),violet,.008)


def receipt(x,y,z,selected=False,archive=False):
    box('Recorded output',(x,y,z),(1.02,.74,.10),edge,.05)
    box('Output face',(x,y,z+.065),(.95,.67,.05),black,.035)
    for j,length in enumerate([.61,.43,.55]):
        box('Recorded values',(x-.33+length/2,y+.20-j*.15,z+.099),(length,.035,.012),mint if selected else titanium,.009)
    if selected:
        wire('Committee selection',[(x+.19,y-.20,z+.11),(x+.27,y-.27,z+.11),(x+.42,y-.08,z+.11)],mint,.025)
    if archive:
        wire('Receipt signature',[(x-.30,y-.23,z+.11),(x-.18,y-.14,z+.11),(x-.10,y-.25,z+.11),(x+.08,y-.19,z+.11)],violet,.013)


def area(name,pos,power,color,size,sy):
    light=bpy.data.lights.new(name,'AREA')
    light.energy=power
    light.color=color
    light.shape='RECTANGLE'
    light.size=size
    light.size_y=sy
    obj=bpy.data.objects.new(name,light)
    bpy.context.collection.objects.link(obj)
    obj.location=pos
    obj.rotation_euler=(Vector((0,0,.6))-obj.location).to_track_quat('-Z','Y').to_euler()


for stage in STAGES if args.stage=='all' else [args.stage]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.save_version=0
    scene=bpy.context.scene
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
    except (RuntimeError,TypeError):
        scene.cycles.device='CPU'
    scene.render.resolution_x=args.size
    scene.render.resolution_y=args.size
    scene.render.resolution_percentage=100
    scene.render.film_transparent=True
    scene.render.image_settings.file_format='PNG'
    scene.render.image_settings.color_mode='RGBA'
    scene.view_settings.view_transform='AgX'
    scene.view_settings.look='AgX - Medium High Contrast'
    scene.view_settings.exposure=-.35
    world=bpy.data.worlds.new('Vault studio')
    world.use_nodes=True
    world.node_tree.nodes['Background'].inputs[0].default_value=(.19,.18,.28,1)
    world.node_tree.nodes['Background'].inputs[1].default_value=.10
    scene.world=world
    black=material('Blackened steel',(.055,.05,.085),.8,.32)
    titanium=material('Smoked titanium',(.25,.24,.33),.9,.29)
    edge=material('Polished graphite edges',(.38,.37,.48),.92,.22)
    violet=material('Violet conductor',(.23,.13,.55),.65,.25,.35)
    mint=material('Selection / petrol enamel',(.09,.38,.27),.65,.27,.15)
    amber=material('Frozen input boundary',(.46,.23,.075),.8,.27)
    ceramic=material('Processor ceramic',(.025,.022,.045),.35,.29)
    corelight=material('Active core seam',(.27,.18,.72),.25,.24,1.8)

    # One substantial assembly, with physically separate input, execution and output zones.
    box('Protocol chassis',(0,0,-.20),(6.1,3.75,.24),black,.18)
    box('Chassis lower lip',(0,0,-.34),(5.96,3.60,.08),titanium,.12)
    for x in [-2.78,2.78]:
        for y in [-1.62,1.62]:
            screw(x,y,-.065)
    for i in range(3):
        y=.90-i*.90
        wire('Input conductor',[(-2.15,y,-.065),(-1.44,y,-.065),(-1.20,y*.7,-.065)],violet)
        wire('Output conductor',[(1.20,y*.7,-.065),(1.48,y,-.065),(2.15,y,-.065)],violet if stage in ['scored','awarded','verified'] else titanium)
        cartridge(-2.18,y,.10 if stage in ['sealed','closed'] else -.015)
        if stage in ['scored','awarded','verified']:
            raised=.30 if stage=='awarded' and i==0 else 0
            receipt(2.16,y,.13+raised,selected=stage=='awarded' and i==0,archive=stage=='verified')
        else:
            box('Empty output socket',(2.16,y,-.04),(1.1,.76,.07),ceramic,.06)
    label('INPUT',(-2.69,-1.49,-.065),.15,titanium)
    label('RECORD',(1.65,-1.49,-.065),.15,titanium)

    # Fixed evaluator base and socket, with retained corner fasteners.
    box('Pinned evaluator mount',(0,0,.03),(2.48,2.62,.28),edge,.12)
    box('Enclave base',(0,0,.22),(2.34,2.48,.17),black,.09)
    frame('Enclave perimeter',2.15,2.28,.40,titanium)
    for side in [-1,1]:
        for y in [-1.04,1.04]:
            box('Fixed corner standoff',(side*.97,y,.58),(.15,.15,.60),titanium,.035)
            screw(side*.97,y,.90)
    for side in [-1,1]:
        for i in range(7):
            box('Processor contact',(-.63+i*.21,side*.83,.44),(.09,.23,.06),edge,.015)
    box('Isolated processor',(0,0,.46),(1.62,1.62,.22),ceramic,.08)
    box('Core illumination',(0,0,.59),(1.37,1.37,.045),corelight,.04)
    box('Core cap',(0,0,.64),(1.31,1.31,.08),black,.05)
    label('TEE',(-.39,-.12,.685),.36,edge)

    open_stage=stage in ['opened','scored','awarded','verified']
    lid_z=2.02 if open_stage else .98
    box('Pinned evaluator cover',(0,0,lid_z),(2.40,2.54,.20),edge,.12)
    box('Cover ceramic inset',(0,0,lid_z+.125),(2.25,2.39,.08),black,.09)
    label('PINNED',(-.76,.39,lid_z+.17),.25,titanium)
    label('EVALUATOR',(-.76,.08,lid_z+.17),.21,titanium)
    # Parallel machined channels give the cover a recognisable functional silhouette.
    for i in range(5):
        box('Cover cooling channel',(-.73+i*.365,-.55,lid_z+.17),(.09,.43,.025),ceramic,.018)
    for x in [-.98,.98]:
        for y in [-1.05,1.05]:
            screw(x,y,lid_z+.17)
            if open_stage:
                wire('Exploded assembly guide',[(x,y,.91),(x,y,lid_z-.13)],titanium,.008)
    if stage=='closed':
        box('Frozen input gate',(-1.41,0,.37),(.15,2.96,.18),amber,.035)
        for y in [-1.35,1.35]:
            box('Gate anchor',(-1.41,y,.11),(.31,.28,.47),titanium,.05)
    if stage=='scored':
        # The computation stays inside the enclosure; only records occupy output slots.
        for i in range(3):
            box('Criterion channel',(-.42+i*.42,0,.82),(.17,.63+i*.14,.04),violet,.025)
    if stage=='verified':
        for i in range(3):
            receipt(2.16,.9-i*.9,.33,archive=True)
        frame('Evidence record binding',5.58,3.30,-.045,titanium)

    area('Vault overhead strip',(-4,2,8),1150,(.86,.85,1),3,1.5)
    area('Violet edge strip',(5,2,4),1450,(.46,.32,1),1.5,6)
    area('Left reflection',(-5,-2,4),500,(.62,.66,1),1.6,5)
    area('Front readability',(1,-6,6),240,(.86,.85,1),4,4)
    bpy.ops.object.camera_add(location=(7,-10,9))
    camera=bpy.context.object
    camera.rotation_euler=(Vector((0,0,.55))-camera.location).to_track_quat('-Z','Y').to_euler()
    camera.data.type='ORTHO'
    camera.data.ortho_scale=7.75
    scene.camera=camera
    scene.render.filepath=str(OUT/f'protocol-{stage}-poster.png')
    bpy.ops.wm.save_as_mainfile(filepath=str(BASE/'production'/f'protocol-{stage}.blend'))
    bpy.ops.render.render(write_still=True)
    print('PROTOCOL_COMPLETE',stage,flush=True)
