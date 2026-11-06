"""Editable Blender/Cycles artwork for the landing page. Run with Blender --background --python."""
import argparse
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector, Matrix

args = argparse.ArgumentParser()
args.add_argument('--asset', choices=['vault', 'seal', 'podium'], default='vault')
args.add_argument('--size', type=int, default=1080)
args.add_argument('--samples', type=int, default=48)
args.add_argument('--frame', type=int, default=0)
args.add_argument('--frames', type=int, default=1)
args.add_argument('--poster', action='store_true')
args.add_argument('--output', default='scratch/landing-preview/blender')
opts = args.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
BASE = Path(__file__).resolve().parent
(BASE / 'production').mkdir(parents=True, exist_ok=True)
OUT = Path(opts.output).resolve()
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = opts.samples
scene.cycles.use_denoising = True
scene.cycles.preview_samples = 16
scene.cycles.max_bounces = 6
scene.cycles.transparent_max_bounces = 4
scene.render.resolution_x = opts.size
scene.render.resolution_y = opts.size
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.image_settings.color_depth = '8'
scene.render.use_persistent_data = True
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - Medium High Contrast'
scene.view_settings.exposure = -0.1
prefs = bpy.context.preferences.addons['cycles'].preferences
try:
    prefs.compute_device_type = 'CUDA'
    prefs.get_devices()
    for device in prefs.devices:
        device.use = device.type == 'CUDA'
    scene.cycles.device = 'GPU' if any(d.type == 'CUDA' for d in prefs.devices) else 'CPU'
except (TypeError, RuntimeError):
    scene.cycles.device = 'CPU'

world = bpy.data.worlds.new('Dark photographic studio')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (.13, .125, .17, 1)
world.node_tree.nodes['Background'].inputs[1].default_value = .25
scene.world = world

def material(name, color, metal=.85, rough=.3, brush=False):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Anisotropic'].default_value = .36 if brush else .1
    if brush:
        coord = nodes.new('ShaderNodeTexCoord')
        wave = nodes.new('ShaderNodeTexWave')
        wave.wave_type = 'RINGS'
        wave.rings_direction = 'Z'
        wave.inputs['Scale'].default_value = 145
        wave.inputs['Distortion'].default_value = .35
        wave.inputs['Detail Scale'].default_value = 3
        links.new(coord.outputs['Object'], wave.inputs['Vector'])
        noise = nodes.new('ShaderNodeTexNoise')
        noise.inputs['Scale'].default_value = 220
        noise.inputs['Detail'].default_value = 2
        links.new(coord.outputs['Object'], noise.inputs['Vector'])
        bump = nodes.new('ShaderNodeBump')
        bump.inputs['Strength'].default_value = .14
        bump.inputs['Distance'].default_value = .007
        links.new(wave.outputs['Color'], bump.inputs['Height'])
        links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
        ramp = nodes.new('ShaderNodeMapRange')
        ramp.inputs['To Min'].default_value = rough - .04
        ramp.inputs['To Max'].default_value = rough + .07
        links.new(noise.outputs['Fac'], ramp.inputs['Value'])
        links.new(ramp.outputs['Result'], bsdf.inputs['Roughness'])
    return mat

gunmetal = material('01 / Brushed titanium - graphite', (.052, .047, .067), .88, .3, True)
edge = material('02 / Polished machined edge', (.11, .10, .14), .94, .22)
black = material('03 / Blackened steel', (.014, .012, .022), .78, .32)
rubber = material('04 / Recessed gasket', (.004, .003, .006), .12, .5)
chrome = material('05 / Satin highlight', (.21, .19, .25), .9, .27, True)
podium_mat = material('06 / Satin aluminium', (.24, .23, .29), .6, .38, True)

root = bpy.data.objects.new('SC / ARTWORK', None)
scene.collection.objects.link(root)

def finish(obj, name, mat, bevel=.025, parent=None, smooth=True):
    obj.name = name
    obj.data.materials.append(mat)
    obj.parent = parent or root
    if smooth:
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
    if bevel:
        mod = obj.modifiers.new('Manufactured edge radius', 'BEVEL')
        mod.width = bevel
        mod.segments = 4
        mod.limit_method = 'ANGLE'
        mod = obj.modifiers.new('Face-weighted normals', 'WEIGHTED_NORMAL')
        mod.keep_sharp = True
        mod.weight = 50
    return obj

def cylinder(name, r, depth, pos, mat, bevel=.025, parent=None, vertices=128):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=r, depth=depth, location=pos)
    return finish(bpy.context.object, name, mat, bevel, parent)

def box(name, dims, pos, mat, bevel=.03, parent=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=pos)
    obj = bpy.context.object
    obj.dimensions = dims
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(obj, name, mat, bevel, parent)

def ring(name, inner, outer, depth, z, mat, bevel=.02, parent=None):
    segments = 192
    vertices = []
    for r, height in [(inner,z-depth/2),(outer,z-depth/2),(outer,z+depth/2),(inner,z+depth/2)]:
        vertices.extend([(r*math.cos(i*math.tau/segments),r*math.sin(i*math.tau/segments),height) for i in range(segments)])
    faces=[]
    for layer in range(4):
        for i in range(segments):
            j=(i+1)%segments
            faces.append((layer*segments+i,layer*segments+j,((layer+1)%4)*segments+j,((layer+1)%4)*segments+i))
    mesh=bpy.data.meshes.new(name)
    mesh.from_pydata(vertices,[],faces);mesh.update()
    obj=bpy.data.objects.new(name,mesh);scene.collection.objects.link(obj)
    return finish(obj,name,mat,bevel,parent)

def torus(name, radius, tube, pos, mat, parent=None):
    bpy.ops.mesh.primitive_torus_add(major_radius=radius,minor_radius=tube,major_segments=144,minor_segments=16,location=pos)
    return finish(bpy.context.object,name,mat,0,parent)

def bolt(name, x, y, z, radius=.09, parent=None):
    cylinder(name+' / recessed washer',radius*1.18,.035,(x,y,z),rubber,.009,parent)
    cylinder(name+' / rounded cap',radius,.075,(x,y,z+.04),gunmetal,.018,parent)
    # A genuinely inset dark hex socket, with a polished bevel at its lip.
    cylinder(name+' / socket',radius*.34,.004,(x,y,z+.078),rubber,.002,parent,6)

def curve(name, points, radius, mat, cyclic=False, parent=None):
    data=bpy.data.curves.new(name,'CURVE');data.dimensions='3D';data.resolution_u=16
    data.bevel_depth=radius;data.bevel_resolution=5
    spline=data.splines.new('POLY');spline.points.add(len(points)-1)
    for p,co in zip(spline.points,points):p.co=(*co,1)
    spline.use_cyclic_u=cyclic
    obj=bpy.data.objects.new(name,data);scene.collection.objects.link(obj);obj.data.materials.append(mat);obj.parent=parent or root
    return obj

def area(name, loc, energy, color, size, target=(0,0,0), size_y=None):
    data=bpy.data.lights.new(name,'AREA');data.energy=energy;data.color=color
    data.shape='RECTANGLE';data.size=size;data.size_y=size_y or size
    obj=bpy.data.objects.new(name,data);scene.collection.objects.link(obj);obj.location=loc
    obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()
    return obj

area('Key / large overhead strip',(-4,6,6),1000,(.84,.83,1),5,size_y=2)
area('Rim / violet vertical strip',(5,1,1.5),850,(.48,.34,1),2,size_y=6)
area('Fill / narrow left card',(-5,-1,3),500,(.67,.7,1),1.4,size_y=5)
area('Top glint',(1,6,1),450,(.9,.88,1),3,size_y=1)

def vault():
    ring('Outer housing / heavy cast frame',2.85,3.91,.42,-.16,gunmetal,.055)
    ring('Outer bright bevel',3.85,3.92,.1,.055,edge,.018)
    ring('Outer face recessed track',3.52,3.73,.055,.065,black,.012)
    ring('Inner frame machined band',2.98,3.5,.1,.095,gunmetal,.028)
    ring('Inner seat shadow',2.81,2.99,.23,.04,rubber,.02)
    ring('Door outer chamfer',2.77,2.84,.16,.18,edge,.025)
    cylinder('Door / solid milled face',2.78,.32,(0,0,.055),gunmetal,.06)
    torus('Fine circular face incision',2.61,.011,(0,0,.223),black)
    torus('Fine circular face highlight',2.6,.006,(0,0,.23),edge)
    # A real central wheel with open spokes and contact shadows on the door.
    cylinder('Wheel bearing mount',.41,.15,(0,0,.32),black,.035)
    for i in range(8):
        a=i*math.tau/8
        group=bpy.data.objects.new(f'Handle assembly {i+1}',None);scene.collection.objects.link(group);group.parent=root;group.rotation_euler.z=a
        shaft=cylinder('Radial handle shaft',.055,1.93,(0,1.16,.52),edge,.013,group,64);shaft.rotation_euler.x=math.pi/2
        grip=cylinder('Handle grip',.095,.49,(0,1.94,.52),black,.022,group,64);grip.rotation_euler.x=math.pi/2
        for y in [1.69,1.79,2.08,2.19]:
            band=cylinder('Machined grip collar',.106,.035,(0,y,.52),edge,.01,group,64);band.rotation_euler.x=math.pi/2
        spoke=box('Wheel open spoke',(.06,.62,.085),(0,.52,.58),gunmetal,.015,group)
    ring('Wheel / wide forged rim',.82,1.15,.17,.66,black,.035)
    torus('Wheel / bright outside edge',1.135,.014,(0,0,.742),edge)
    torus('Wheel / inside bevel',.835,.012,(0,0,.744),gunmetal)
    cylinder('Wheel central hub',.32,.22,(0,0,.61),black,.045)
    torus('Hub highlight',.29,.012,(0,0,.727),edge)
    for i in range(16):
        a=i*math.tau/16+.09
        bolt(f'Frame bolt {i}',3.26*math.cos(a),3.26*math.sin(a),.18,.105)
    for i in range(32):
        a=i*math.tau/32
        bolt(f'Perimeter fastener {i}',3.8*math.cos(a),3.8*math.sin(a),.105,.034)
    # Rounded radial bridge plates, with two pins and recessed hardware.
    for i in range(6):
        a=i*math.tau/6+.28
        group=bpy.data.objects.new(f'Lock bridge {i}',None);scene.collection.objects.link(group);group.parent=root;group.rotation_euler.z=a
        box('Bridge / rounded mounting plate',(.37,.73,.14),(0,3.48,.24),black,.15,group)
        bolt('Bridge outer pivot',0,3.71,.33,.13,group)
        bolt('Bridge inner pivot',0,3.31,.33,.085,group)
    # Side hinge with three interleaved barrels rather than flat rectangular blocks.
    for y in [-.49,0,.49]:
        obj=cylinder('Hinge / interleaved barrel',.2,.46,(3.02,y,.21),gunmetal,.035);obj.rotation_euler.x=math.pi/2
    for y in [-.72,.72]:
        box('Hinge / anchor',(.43,.32,.16),(3.07,y,.12),black,.07)
        bolt('Hinge / pin',3.08,y,.23,.07)

def seal(parent=None):
    coin=bpy.data.objects.new('SC / Security seal',None);scene.collection.objects.link(coin);coin.parent=parent or root
    cylinder('Seal / solid titanium blank',1.15,.17,(0,0,0),gunmetal,.055,coin)
    ring('Seal / outer polished shoulder',1.035,1.13,.08,.1,edge,.023,coin)
    cylinder('Seal / recessed satin face',1.01,.06,(0,0,.095),black,.025,coin)
    torus('Seal / engraved concentric track',.94,.012,(0,0,.133),gunmetal,coin)
    # The rim is milled, not drawn: 120 fine reeds around the cylinder wall.
    for i in range(120):
        a=i*math.tau/120
        obj=box('Seal / edge reeding',(.009,.018,.1),(1.14*math.cos(a),1.14*math.sin(a),-.015),edge,.003,coin)
        obj.rotation_euler.z=a
    shield=[(0,.62),(.2,.46),(.52,.36),(.48,-.08),(.36,-.35),(0,-.62),(-.36,-.35),(-.48,-.08),(-.52,.36),(-.2,.46)]
    curve('Seal / raised shield perimeter',[(x,y,.17) for x,y in shield],.035,gunmetal,True,coin)
    curve('Seal / shield inner engraved edge',[(x*.87,y*.87,.16) for x,y in shield],.012,edge,True,coin)
    shackle=[(.19*math.cos(i*math.pi/48),.06+.19*math.sin(i*math.pi/48),.23) for i in range(49)]
    curve('Seal / lock shackle',shackle,.044,edge,False,coin)
    box('Seal / lock body',(.46,.37,.1),(0,-.14,.205),gunmetal,.035,coin)
    cylinder('Seal / keyhole',.043,.008,(0,-.11,.261),rubber,.002,coin,48)
    box('Seal / keyway',(.032,.09,.008),(0,-.165,.262),rubber,.008,coin)
    return coin

if opts.asset=='vault':
    vault()
    root.rotation_euler=(math.radians(3),math.radians(-5),math.radians(-8))
    camera_location=(0,.1,12.8)
    camera_target=(0,0,0)
    ortho=8.5
elif opts.asset=='seal':
    coin=seal()
    coin.rotation_euler=(math.radians(8),math.radians(-20),math.radians(-8))
    camera_location=(0,0,8)
    camera_target=(0,0,0)
    ortho=2.8
else:
    coin=seal()
    coin.location=(0,1.68,.0)
    # Render the podium separately so the seal can carry between sections.
    for child in coin.children_recursive: child.hide_render=True
    coin.rotation_euler=(math.radians(5),math.radians(-18),math.radians(-8))
    for x,h in [(-1.7,1.1),(0,2.6),(1.7,1.8)]:
        obj=cylinder('Podium / satin aluminium',.78,h,(x,-2.3+h/2,-.12),podium_mat,.045)
        obj.rotation_euler.x=math.pi/2
    camera_location=(0,1.6,11)
    camera_target=(0,0,0)
    ortho=6.3

bpy.ops.object.camera_add(location=camera_location)
camera=bpy.context.object;camera.name='Camera / art direction'
forward=(Vector(camera_target)-camera.location).normalized()
right=forward.cross(Vector((0,1,0))).normalized()
up=right.cross(forward).normalized()
camera.rotation_euler=Matrix((right,up,-forward)).transposed().to_euler()
camera.data.type='ORTHO';camera.data.ortho_scale=ortho
scene.camera=camera
scene.render.image_settings.compression = 20
bpy.ops.wm.save_as_mainfile(filepath=str(BASE/'production'/f'{opts.asset}.blend'))
frames=range(opts.frame, opts.frame+opts.frames)
for frame in frames:
    if opts.asset=='vault':
        t=frame/23
        root.rotation_euler.x=math.radians(3+62*t)
        root.rotation_euler.y=math.radians(-5+4*t)
        root.rotation_euler.z=math.radians(-8+8*t)
    elif opts.asset=='seal' and opts.frames>1:
        coin.rotation_euler.y=math.radians(-20+frame/23*55)
    scene.render.filepath=str(OUT/(f'{opts.asset}-poster.png' if opts.poster else f'{opts.asset}-{frame:03d}.png'))
    bpy.ops.render.render(write_still=True)
    print('ASSET_COMPLETE',scene.render.filepath,flush=True)
