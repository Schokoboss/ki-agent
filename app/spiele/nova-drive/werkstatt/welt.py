"""Nova Drive – Weltmodelle in Blender bauen (eigene Designs).

Aufruf:  python welt.py -- ../models/welt [name …]
Erzeugt je Modell eine GLB. Koordinaten wie im Spiel (three.js): oben = +y, Vorderseite = +z, Boden bei y = 0.
Materialnamen, die das Spiel auswertet: wall (wird pro Haus eingefärbt), window (leuchtet nachts), bulb (Laternen-Licht),
led/banner/board (bekommen Canvas-Texturen), cloth (Zuschauer-Kleidung, eingefärbt).
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import bmesh  # noqa: E402
import autos  # noqa: E402
from autos import B, active, place, finish, box, cyl  # noqa: E402

OUT = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else os.path.join(os.path.dirname(__file__), '..', 'models', 'welt')
ONLY = sys.argv[sys.argv.index('--') + 2:] if '--' in sys.argv else []


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    autos.MATS.clear()


def M(name, color, metal=0.0, rough=0.7, emit=None, strength=0.0, double=False):
    m = autos.material(name, color, metal, rough, emit, strength)
    if double:
        m.use_backface_culling = False
    return m


def mesh(name, verts, faces, mat, smooth=False):
    me = bpy.data.meshes.new(name)
    me.from_pydata([B(*v) for v in verts], [], faces)
    me.update()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    o.data.materials.append(mat)
    for p in me.polygons:
        p.use_smooth = smooth
    return o


def ico(loc, r, mat, sub=1, noise=0.25, squash=1.0, seed=0, smooth=False):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub, radius=r)
    o = active()
    rnd = random.Random(seed)
    for v in o.data.vertices:
        f = 1 + (rnd.random() - 0.5) * 2 * noise
        v.co.x *= f
        v.co.y *= f
        v.co.z *= f * squash
    place(o, loc)
    return finish(o, mat, 0, 2, smooth)


def cone(loc, r1, r2, h, mat, verts=8, rot=(0, 0, 0), jag=0.0, seed=0):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=h)
    o = active()
    if jag:
        rnd = random.Random(seed)
        zs = [v.co.z for v in o.data.vertices]
        zmin = min(zs)
        for i, v in enumerate(o.data.vertices):
            if abs(v.co.z - zmin) < 1e-4 and (abs(v.co.x) + abs(v.co.y)) > 1e-4:
                k = 1 + (jag if i % 2 else -jag * 0.6) + (rnd.random() - 0.5) * jag * 0.5
                v.co.x *= k
                v.co.y *= k
                v.co.z -= (jag * 0.6 if i % 2 else 0)
    place(o, loc, rot)
    return finish(o, mat)


def join(objs, name):
    objs = [o for o in objs if o]
    for o in objs:
        bpy.ops.object.select_all(action='DESELECT')
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        for m in list(o.modifiers):
            bpy.ops.object.modifier_apply(modifier=m.name)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    o = active()
    o.name = name
    bpy.ops.object.select_all(action='DESELECT')
    return o


def export(objs, name, uv=False):
    bpy.ops.object.select_all(action='DESELECT')
    tris = 0
    for o in objs:
        o.select_set(True)
        if o.type == 'MESH':
            tris += sum(len(p.vertices) - 2 for p in o.data.polygons)
    path = os.path.abspath(os.path.join(OUT, name + '.glb'))
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                              export_texcoords=uv, export_normals=True, export_materials='EXPORT', export_cameras=False,
                              export_lights=False, export_extras=False)
    print(f'{name}: {tris} Dreiecke, {os.path.getsize(path) // 1024} KB')


# ---------------------------------------------------------------- Bäume
def pine(name, tiers, height, width, seed):
    reset()
    bark = M('bark', (0.16, 0.09, 0.05))
    greens = [M('pine1', (0.04, 0.14, 0.05)), M('pine2', (0.05, 0.18, 0.06)), M('pine3', (0.07, 0.22, 0.07))]
    parts = [cyl((0, height * 0.18, 0), width * 0.07, height * 0.36, bark, verts=8, smooth=True)]
    rnd = random.Random(seed)
    for i in range(tiers):
        t = i / max(1, tiers - 1)
        r = width * (1 - t * 0.78) * (0.95 + rnd.random() * 0.1)
        h = height * (0.34 - t * 0.12)
        y = height * (0.2 + t * 0.62) + h / 2
        parts.append(cone((0, y, 0), r, r * 0.12, h, greens[i % 3], verts=10, rot=(0, rnd.random() * 6.28, 0), jag=0.18, seed=seed + i))
    parts.append(cone((0, height * 0.97, 0), width * 0.12, 0.0, height * 0.12, greens[2], verts=6))
    export([join(parts, name)], name)


def leafy(name, height, crown, trunk_col, leaf_cols, seed, birch=False):
    reset()
    bark = M('bark2' if birch else 'bark', trunk_col)
    leaves = [M(f'leaf{i}', c) for i, c in enumerate(leaf_cols)]
    rnd = random.Random(seed)
    th = height * 0.55
    parts = [cyl((0, th / 2, 0), crown * 0.09, th, bark, verts=8, smooth=True)]
    for k in range(3):
        a = k / 3 * 6.28 + rnd.random()
        ln = crown * 0.55
        parts.append(cyl((math.sin(a) * ln * 0.35, th * 0.85 + ln * 0.25, math.cos(a) * ln * 0.35), crown * 0.04, ln, bark,
                         rot=(math.cos(a) * 0.7, 0, -math.sin(a) * 0.7), verts=6, smooth=True))
    blobs = 7 if not birch else 6
    for k in range(blobs):
        a = k / blobs * 6.28 + rnd.random() * 0.5
        rr = crown * (0.42 + rnd.random() * 0.2) * (0.8 if birch else 1)
        d = crown * (0.45 if k else 0) * (0.7 + rnd.random() * 0.3)
        y = height * (0.72 + rnd.random() * 0.18) + (0.15 * height if birch and k % 2 else 0)
        parts.append(ico((math.sin(a) * d, y, math.cos(a) * d), rr, leaves[k % len(leaves)], 1, 0.22, 0.85 if not birch else 1.2, seed + k * 7))
    parts.append(ico((0, height * 0.95, 0), crown * 0.45, leaves[0], 1, 0.2, 0.8, seed + 99))
    export([join(parts, name)], name)


def palm(name, seed):
    reset()
    bark = M('palmbark', (0.3, 0.2, 0.11))
    frond = M('frond', (0.07, 0.26, 0.05), double=True)
    frond2 = M('frond2', (0.1, 0.32, 0.07), double=True)
    nut = M('nut', (0.18, 0.11, 0.04))
    rnd = random.Random(seed)
    parts = []
    x = y = 0.0
    lean = 0.0
    for i in range(9):
        lean += 0.035
        seg = 0.95
        parts.append(cyl((x, y + seg / 2, 0), 0.22 - i * 0.008, seg, bark, rot=(0, 0, -lean), verts=7, smooth=True))
        parts.append(cyl((x, y + seg * 0.95, 0), 0.25 - i * 0.008, 0.08, bark, rot=(0, 0, -lean), verts=7, smooth=True))
        x += math.sin(lean) * seg
        y += math.cos(lean) * seg
    top = (x, y, 0)
    for k in range(9):
        a = k / 9 * 6.28 + rnd.random() * 0.3
        L = 3.4 + rnd.random() * 0.8
        verts, faces = [], []
        n = 7
        for j in range(n + 1):
            t = j / n
            d = t * L
            droop = -(t ** 1.8) * L * 0.55 + t * 0.6
            w = 0.55 * math.sin(math.pi * min(1, t * 1.1)) + 0.05
            cx, cz = math.cos(a) * d, math.sin(a) * d
            px, pz = -math.sin(a) * w, math.cos(a) * w
            verts += [(top[0] + cx + px, top[1] + droop - 0.08, top[2] + cz + pz), (top[0] + cx, top[1] + droop + 0.06, top[2] + cz),
                      (top[0] + cx - px, top[1] + droop - 0.08, top[2] + cz - pz)]
            if j:
                b = (j - 1) * 3
                faces += [(b, b + 3, b + 4, b + 1), (b + 1, b + 4, b + 5, b + 2)]
        parts.append(mesh('fr', verts, faces, frond if k % 2 else frond2, True))
    for k in range(3):
        a = k * 2.1
        parts.append(ico((top[0] + math.cos(a) * 0.25, top[1] - 0.3, math.sin(a) * 0.25), 0.16, nut, 1, 0.05))
    export([join(parts, name)], name)


def rock(name, seed, squash):
    reset()
    m = M('rock', (0.2, 0.19, 0.18), 0, 0.9)
    m2 = M('moss', (0.12, 0.16, 0.07), 0, 0.95)
    o = ico((0, 0.35, 0), 1.0, m, 2, 0.3, squash, seed)
    for v in o.data.vertices:
        if v.co.z < -0.15:
            v.co.z = -0.15 - (v.co.z + 0.15) * 0.2
    o.data.materials.append(m2)
    for p in o.data.polygons:
        if p.normal.z > 0.75:
            p.material_index = 1
    parts = [o, ico((0.7, 0.15, 0.4), 0.38, m, 1, 0.3, 0.8, seed + 3)]
    export([join(parts, name)], name)


# ---------------------------------------------------------------- Häuser
def house(name, w, d, floors, roof='gable', shop=False, balconies=False, shutters=False, farm=False, seed=0):
    reset()
    rnd = random.Random(seed)
    wall = M('wall', (0.85, 0.82, 0.76), 0, 0.85)
    plinth = M('stone', (0.32, 0.3, 0.28), 0, 0.9)
    win = M('window', (0.05, 0.08, 0.12), 0.3, 0.15)
    frame = M('frame', (0.9, 0.9, 0.88), 0, 0.6)
    roofm = M('roof', (0.42, 0.12, 0.06) if not farm else (0.22, 0.22, 0.24), 0, 0.75)
    door = M('door', (0.22, 0.12, 0.06), 0, 0.6)
    metal = M('metal', (0.35, 0.36, 0.38), 0.7, 0.4)
    shut = M('shutter', (0.12, 0.3, 0.2), 0, 0.6)
    awn = M('awning', (0.7, 0.08, 0.12), 0, 0.7, double=True)
    fh = 3.1
    H = floors * fh + 0.3
    parts = [box((0, (H - 3) / 2, 0), (w, H + 3, d), wall, bevel=0.0)]
    parts.append(box((0, 0.2, 0), (w + 0.25, 1.0 + 3 * 0, d + 0.25), plinth, bevel=0.0))
    parts.append(box((0, -1.5, 0), (w + 0.2, 3, d + 0.2), plinth, bevel=0.0))
    # Fenster auf allen vier Seiten
    for side, (nx, nz, L) in enumerate([(0, 1, w), (0, -1, w), (1, 0, d), (-1, 0, d)]):
        bays = max(1, int(L / 2.9))
        for f in range(floors):
            if farm and f == 0 and side == 0:
                continue
            y = f * fh + 1.75
            for k in range(bays):
                u = (k + 0.5) / bays * L - L / 2
                if shop and f == 0 and side == 0:
                    continue
                if f == 0 and side == 0 and k == bays // 2:
                    continue  # Tür
                rot = (0, math.atan2(nx, nz), 0)
                px = nx * (w / 2) + (u if nz else 0) * (1 if nz > 0 else -1)
                pz = nz * (d / 2) + (u if nx else 0) * (-1 if nx > 0 else 1)
                parts.append(box((px + nx * 0.03, y, pz + nz * 0.03), (1.15, 1.45, 0.08), frame, rot, 0.0))
                parts.append(box((px + nx * 0.06, y + 0.02, pz + nz * 0.06), (0.95, 1.25, 0.06), win, rot, 0.0))
                parts.append(box((px + nx * 0.1, y - 0.8, pz + nz * 0.1), (1.35, 0.1, 0.2), frame, rot, 0.0))
                if shutters:
                    for sgn in (-1, 1):
                        ox, oz = (sgn * 0.85 if nz else 0) * (1 if nz > 0 else -1), (sgn * 0.85 if nx else 0) * (-1 if nx > 0 else 1)
                        parts.append(box((px + ox + nx * 0.06, y, pz + oz + nz * 0.06), (0.5, 1.4, 0.05), shut, rot, 0.0))
                if balconies and f > 0 and side == 0 and k % 2 == 0:
                    parts.append(box((px, y - 0.95, pz + 0.65), (2.2, 0.15, 1.3), plinth, (0, 0, 0), 0.0))
                    parts.append(box((px, y - 0.45, pz + 1.28), (2.2, 0.9, 0.05), metal, (0, 0, 0), 0.0))
                    for sx in (-1, 1):
                        parts.append(box((px + sx * 1.08, y - 0.45, pz + 0.65), (0.05, 0.9, 1.3), metal, (0, 0, 0), 0.0))
    # Tür
    if farm:
        parts.append(box((0, 1.8, d / 2 + 0.05), (3.6, 3.6, 0.12), door, bevel=0.0))
        parts.append(box((0, 1.8, d / 2 + 0.12), (3.6, 0.15, 0.06), frame, (0, 0, 0.78), 0.0))
        parts.append(box((0, 1.8, d / 2 + 0.12), (3.6, 0.15, 0.06), frame, (0, 0, -0.78), 0.0))
    else:
        parts.append(box((0, 1.15, d / 2 + 0.04), (1.2, 2.3, 0.1), door, bevel=0.0))
        parts.append(box((0, 2.45, d / 2 + 0.45), (1.8, 0.12, 0.9), metal, bevel=0.0))
    if shop:
        parts.append(box((0, 1.4, d / 2 + 0.05), (w * 0.8, 2.1, 0.08), win, bevel=0.0))
        parts.append(box((0, 3.2, d / 2 + 0.9), (w * 0.86, 0.1, 1.8), awn, (-0.25, 0, 0), 0.0))
        parts.append(box((0, 3.75, d / 2 + 0.08), (w * 0.6, 0.6, 0.12), frame, bevel=0.0))
    # Dach
    if roof == 'gable':
        rh = min(w, d) * (0.42 if not farm else 0.5)
        o = 0.45
        vs = [(-w / 2 - o, H, -d / 2 - o), (w / 2 + o, H, -d / 2 - o), (w / 2 + o, H, d / 2 + o), (-w / 2 - o, H, d / 2 + o),
              (-w / 2 - o, H + rh, 0), (w / 2 + o, H + rh, 0)]
        fs = [(0, 1, 5, 4), (2, 3, 4, 5), (0, 3, 2, 1)]
        r = mesh('roof', vs, fs, roofm)
        th = [(-w / 2 - o, H - 0.15, -d / 2 - o), (w / 2 + o, H - 0.15, -d / 2 - o), (w / 2 + o, H - 0.15, d / 2 + o), (-w / 2 - o, H - 0.15, d / 2 + o)]
        r2 = mesh('roofb', vs[:4] + th, [(0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0), (4, 7, 6, 5)], roofm)
        g1 = mesh('gable1', [(-w / 2, H, -d / 2 + 0.01), (w / 2, H, -d / 2 + 0.01), (w / 2, H, d / 2 - 0.01)], [], wall)
        bpy.data.objects.remove(g1, do_unlink=True)
        gab = mesh('gab', [(-w / 2, H, -d / 2), (-w / 2, H, d / 2), (-w / 2, H + rh * 0.97, 0), (w / 2, H, -d / 2), (w / 2, H, d / 2), (w / 2, H + rh * 0.97, 0)],
                   [(0, 1, 2), (3, 5, 4)], wall)
        parts += [r, r2, gab]
        if not farm:
            parts.append(box((w * 0.25, H + rh * 0.7, d * 0.18), (0.7, rh * 0.9, 0.7), plinth, bevel=0.0))
    else:
        parts.append(box((0, H + 0.4, 0), (w + 0.1, 0.8, d + 0.1), plinth, bevel=0.0))
        parts.append(box((0, H + 0.45, 0), (w - 0.5, 0.8, d - 0.5), M('flat', (0.18, 0.18, 0.2), 0, 0.9), bevel=0.0))
        parts.append(box((w * 0.2, H + 1.3, -d * 0.15), (1.8, 1.2, 1.4), metal, bevel=0.02))
        if rnd.random() < 0.6:
            parts.append(cyl((-w * 0.22, H + 1.9, d * 0.1), 0.9, 2.2, metal, verts=12))
            for k in range(4):
                a = k * 1.57 + 0.78
                parts.append(box((-w * 0.22 + math.cos(a) * 0.7, H + 0.9, d * 0.1 + math.sin(a) * 0.7), (0.1, 1.1, 0.1), metal, bevel=0.0))
    export([join(parts, name)], name)


def barn(name):
    reset()
    wall = M('barnwall', (0.42, 0.06, 0.04), 0, 0.8)
    trim = M('frame', (0.9, 0.9, 0.88), 0, 0.6)
    roofm = M('roof', (0.2, 0.2, 0.22), 0.3, 0.6)
    w, d, H = 12, 18, 5.0
    parts = [box((0, (H - 3) / 2, 0), (w, H + 3, d), wall, bevel=0.0)]
    # Mansarddach
    o = 0.4
    prof = [(-w / 2 - o, H), (-w / 2 + 1.6, H + 3.2), (0, H + 4.6), (w / 2 - 1.6, H + 3.2), (w / 2 + o, H)]
    vs = []
    for z in (-d / 2 - o, d / 2 + o):
        for x, y in prof:
            vs.append((x, y, z))
    fs = [(i, i + 1, i + 6, i + 5) for i in range(4)]
    parts.append(mesh('roof', vs, fs, roofm))
    gv = [(x * 0.97, y - 0.02, -d / 2) for x, y in prof] + [(x * 0.97, y - 0.02, d / 2) for x, y in prof]
    parts.append(mesh('g1', gv, [(0, 1, 2, 3, 4), (9, 8, 7, 6, 5)], wall))
    for z in (-d / 2, d / 2):
        s = 1 if z > 0 else -1
        parts.append(box((0, 2.2, z + s * 0.05), (4.4, 4.4, 0.1), M('door', (0.3, 0.05, 0.03), 0, 0.7), bevel=0.0))
        for rot in (0.78, -0.78):
            parts.append(box((0, 2.2, z + s * 0.12), (5.6, 0.18, 0.06), trim, (0, 0, rot), 0.0))
        parts.append(box((0, 4.45, z + s * 0.1), (4.6, 0.18, 0.08), trim, bevel=0.0))
        parts.append(box((0, H + 2.2, z + s * 0.05), (1.6, 1.4, 0.1), M('window', (0.05, 0.08, 0.12), 0.3, 0.15), bevel=0.0))
    for sx in (-1, 1):
        for z in (-d / 2, d / 2):
            parts.append(box((sx * w / 2, H / 2 - 0.5, z), (0.2, H + 1, 0.2), trim, bevel=0.0))
    export([join(parts, name)], name)


# ---------------------------------------------------------------- Straßenmöbel & Zerstörbares
def lamp():
    reset()
    metal = M('lampmetal', (0.12, 0.13, 0.14), 0.6, 0.45)
    bulb = M('bulb', (1, 0.95, 0.8), 0, 0.3, (1, 0.85, 0.6), 2.0)
    parts = [cyl((0, 0.25, 0), 0.22, 0.5, metal, verts=10), cyl((0, 3.9, 0), 0.08, 7.4, metal, verts=10)]
    x, y = 0.0, 7.5
    for k in range(6):
        a = k / 6 * (math.pi / 2)
        nx, ny = math.sin(a + 0.26) * 0.36, math.cos(a + 0.26) * 0.36
        parts.append(cyl((x + nx / 2, y + ny / 2, 0), 0.055, 0.38, metal, (0, 0, -(a + 0.26)), 8))
        x += nx
        y += ny
    parts.append(box((x + 0.35, y - 0.05, 0), (0.9, 0.16, 0.42), metal, bevel=0.04))
    parts.append(box((x + 0.35, y - 0.15, 0), (0.75, 0.06, 0.32), bulb, bevel=0.0))
    o = join(parts, 'lamp')
    # Lampenkopf zeigt im Spiel nach +z → um 90° drehen
    o.rotation_euler = (0, 0, math.radians(90))
    export([o], 'lamp')


def fence():
    reset()
    wood = M('wood', (0.33, 0.22, 0.13), 0, 0.85)
    wood2 = M('wood2', (0.4, 0.28, 0.17), 0, 0.85)
    parts = []
    for x in (-1.95, 0, 1.95):
        parts.append(box((x, 0.6, 0), (0.14, 1.25, 0.14), wood, (0, 0, (x * 0.01)), 0.0))
    for y in (0.45, 0.9):
        parts.append(box((0, y, 0.09), (4.0, 0.13, 0.05), wood2, bevel=0.0))
    parts.append(box((-0.97, 0.68, 0.12), (2.1, 0.1, 0.04), wood2, (0, 0, 0.22), 0.0))
    export([join(parts, 'fence')], 'fence')


def cone_model():
    reset()
    org = M('orange', (0.9, 0.18, 0.01), 0, 0.5)
    white = M('reflect', (0.95, 0.95, 0.95), 0.2, 0.3)
    blk = M('rubber', (0.03, 0.03, 0.03), 0, 0.9)
    parts = [box((0, 0.03, 0), (0.62, 0.06, 0.62), blk, bevel=0.0), cone((0, 0.42, 0), 0.27, 0.05, 0.74, org, 10)]
    parts.append(cyl((0, 0.47, 0), 0.172, 0.12, white, verts=10))
    parts.append(cyl((0, 0.29, 0), 0.22, 0.08, white, verts=10))
    export([join(parts, 'cone')], 'cone')


def hay():
    reset()
    h = M('hay', (0.55, 0.42, 0.14), 0, 0.95)
    h2 = M('hay2', (0.45, 0.33, 0.1), 0, 0.95)
    o = cyl((0, 0.85, 0), 0.85, 1.5, h, (0, 0, math.pi / 2), 14)
    bv = o.modifiers.new('b', 'BEVEL')
    bv.width = 0.16
    bv.segments = 1
    parts = [o]
    for x in (-0.4, 0.4):
        parts.append(cyl((x, 0.85, 0), 0.865, 0.05, h2, (0, 0, math.pi / 2), 14))
    export([join(parts, 'hay')], 'hay')


def poster():
    reset()
    steel = M('steel', (0.25, 0.26, 0.28), 0.8, 0.35)
    white = M('frame', (0.92, 0.92, 0.9), 0.1, 0.4)
    board = M('board', (1, 1, 1), 0, 0.5)
    parts = [box((s * 2.1, 1.6, -0.15), (0.18, 3.2, 0.18), steel, bevel=0.01) for s in (-1, 1)]
    parts.append(box((0, 3.0, -0.12), (5.3, 2.9, 0.12), white, bevel=0.03))
    parts.append(box((0, 1.6, -0.15), (4.2, 0.12, 0.12), steel, bevel=0.0))
    for s in (-1.6, 0, 1.6):
        parts.append(box((s, 4.55, 0.25), (0.08, 0.08, 0.6), steel, bevel=0.0))
        parts.append(box((s, 4.55, 0.58), (0.35, 0.14, 0.18), steel, bevel=0.02))
    body = join(parts, 'poster')
    bpy.ops.mesh.primitive_plane_add(size=1)
    p = active()
    place(p, (0, 3.0, -0.05), (math.pi / 2, 0, 0), (5.0, 1, 2.6))
    finish(p, board)
    p.name = 'board'
    export([body, p], 'poster', uv=True)


def ramp():
    reset()
    deck = M('rampdeck', (0.55, 0.55, 0.57), 0.4, 0.5)
    stripe = M('stripe', (0.9, 0.6, 0.0), 0, 0.5)
    dark = M('stripe2', (0.03, 0.03, 0.03), 0, 0.6)
    steel = M('steel', (0.3, 0.31, 0.33), 0.8, 0.35)
    L, W, Hh = 16, 9, 4.2
    hA = lambda t: Hh * t * t * 0.35 + Hh * t * 0.65
    S = 16
    vs, fs = [], []
    for i in range(S + 1):
        t = i / S
        z = -L / 2 + t * L
        vs += [(-W / 2, hA(t) - 0.3, z), (W / 2, hA(t) - 0.3, z)]
    for i in range(S):
        fs.append((i * 2, i * 2 + 2, i * 2 + 3, i * 2 + 1))
    top = mesh('deck', vs, fs, deck)
    parts = [top]
    for i in range(S):
        t0, t1 = i / S, (i + 1) / S
        for sx in (-1, 1):
            m = stripe if i % 2 else dark
            z0, z1 = -L / 2 + t0 * L, -L / 2 + t1 * L
            parts.append(mesh('st', [(sx * W / 2, hA(t0) - 0.3, z0), (sx * W / 2, hA(t1) - 0.3, z1), (sx * (W / 2 - 0.6), hA(t1) - 0.29, z1), (sx * (W / 2 - 0.6), hA(t0) - 0.29, z0)],
                              [(0, 1, 2, 3)] if sx > 0 else [(3, 2, 1, 0)], m))
        for sx in (-1, 1):
            parts.append(mesh('side', [(sx * W / 2, -0.4, -L / 2 + t0 * L), (sx * W / 2, -0.4, -L / 2 + t1 * L), (sx * W / 2, hA(t1) - 0.3, -L / 2 + t1 * L), (sx * W / 2, hA(t0) - 0.3, -L / 2 + t0 * L)],
                              [(0, 1, 2, 3)] if sx > 0 else [(3, 2, 1, 0)], steel))
    parts.append(mesh('back', [(W / 2, -0.4, L / 2), (-W / 2, -0.4, L / 2), (-W / 2, Hh - 0.3, L / 2), (W / 2, Hh - 0.3, L / 2)], [(0, 1, 2, 3)], steel))
    for z in (-2, 2, 6):
        t = (z + L / 2) / L
        for sx in (-1, 1):
            parts.append(box((sx * (W / 2 - 0.5), (hA(t) - 0.3) / 2, z), (0.2, hA(t), 0.2), steel, bevel=0.0))
    # Warnschild vor der Schanze
    parts.append(box((W / 2 + 2, 1.1, -L / 2 - 2), (0.1, 2.2, 0.1), steel, bevel=0.0))
    tri = mesh('sign', [(W / 2 + 2 - 0.8, 2.0, -L / 2 - 1.94), (W / 2 + 2 + 0.8, 2.0, -L / 2 - 1.94), (W / 2 + 2, 3.4, -L / 2 - 1.94)], [(2, 1, 0)], stripe)
    parts.append(tri)
    export([join(parts, 'ramp')], 'ramp')


# ---------------------------------------------------------------- Festival
def stage():
    reset()
    dark = M('stageblack', (0.02, 0.02, 0.025), 0, 0.7)
    truss = M('truss', (0.6, 0.62, 0.66), 0.9, 0.3)
    spk = M('speaker', (0.04, 0.04, 0.045), 0, 0.5)
    cone_m = M('spkcone', (0.15, 0.15, 0.16), 0.3, 0.5)
    lights = M('stagelight', (1, 1, 1), 0, 0.3, (1, 0.9, 0.8), 3.0)
    led = M('led', (1, 1, 1), 0, 0.5)
    W, D, H = 44, 16, 15
    parts = [box((0, 0.8, 0), (W, 1.6, D), dark, bevel=0.05), box((0, 1.0, -D / 2 - 1.2), (12, 0.4, 2.4), dark, bevel=0.02)]
    parts.append(box((0, H / 2, D / 2 - 0.5), (W, H, 1), dark, bevel=0.0))
    for k in range(6):
        parts.append(box((0, 0.3 + k * 0.25, -D / 2 - 2.6 - k * 0.0), (6, 0.25, 0.5), dark, bevel=0.0))
    # Fachwerk-Türme und Dach
    def tower(x, z):
        out = []
        for sx in (-0.5, 0.5):
            for sz in (-0.5, 0.5):
                out.append(cyl((x + sx, H / 2 + 1, z + sz), 0.06, H + 2, truss, verts=6))
        for y in range(2, int(H) + 2, 2):
            out.append(box((x, y, z), (1.0, 0.06, 1.0), truss, bevel=0.0))
            out.append(box((x, y + 1, z + 0.5), (1.4, 0.05, 0.05), truss, (0, 0, 0.9), 0.0))
        return out
    for sx in (-1, 1):
        for sz in (-1, 1):
            parts += tower(sx * (W / 2 + 1), sz * (D / 2 + 0.5))
    for sz in (-1, 0, 1):
        z = sz * (D / 2 + 0.5)
        for dy in (0, 1.2):
            parts.append(cyl((0, H + 1.2 + dy, z), 0.07, W + 3, truss, (0, 0, math.pi / 2), 6))
    for sx in (-1, 0, 1):
        for dy in (0, 1.2):
            parts.append(cyl((sx * (W / 2 + 1), H + 1.2 + dy, 0), 0.07, D + 1, truss, (math.pi / 2, 0, 0), 6))
    parts.append(box((0, H + 2.6, 0), (W + 3, 0.3, D + 2), dark, bevel=0.0))
    for k in range(12):
        x = -W / 2 + 2 + k * (W - 4) / 11
        parts.append(box((x, H + 0.9, -D / 2 + 0.5), (0.5, 0.5, 0.6), dark, (0.5, 0, 0), 0.02))
        parts.append(box((x, H + 0.82, -D / 2 + 0.25), (0.36, 0.36, 0.1), lights, (0.5, 0, 0), 0.0))
    # Lautsprecher-Türme
    for sx in (-1, 1):
        for k in range(4):
            y = 1.6 + k * 1.6
            parts.append(box((sx * (W / 2 + 4.5), y + 0.8, -D / 2 + 3), (3.2, 1.55, 2.6), spk, bevel=0.04))
            for cx in (-0.7, 0.7):
                parts.append(cyl((sx * (W / 2 + 4.5) + cx, y + 0.8, -D / 2 + 1.68), 0.55, 0.06, cone_m, (math.pi / 2, 0, 0), 14))
    body = join(parts, 'stage')
    bpy.ops.mesh.primitive_plane_add(size=1)
    p = active()
    place(p, (0, 8.6, D / 2 - 1.06), (math.pi / 2, math.pi, 0), (26, 1, 13))
    finish(p, led)
    p.name = 'led'
    export([body, p], 'stage', uv=True)


def tent():
    reset()
    pink = M('tentpink', (0.8, 0.05, 0.25), 0, 0.7, double=True)
    white = M('tentwhite', (0.9, 0.88, 0.85), 0, 0.7, double=True)
    pole = M('pole', (0.6, 0.6, 0.62), 0.8, 0.3)
    flag = M('flag', (1.0, 0.75, 0.05), 0, 0.6, double=True)
    r, n = 6.6, 16
    parts = [cyl((0, 1.6, 0), r - 0.5, 3.2, white, verts=n * 2)]
    o = cyl((0, 1.6, 0), r - 0.45, 3.2, white, verts=n * 2)
    bpy.data.objects.remove(o, do_unlink=True)
    vs = [(0, 8.2, 0)]
    for i in range(n * 2):
        a = i / (n * 2) * math.pi * 2
        vs.append((math.cos(a) * (r + 0.3), 3.0, math.sin(a) * (r + 0.3)))
    roof = mesh('roof', vs, [(0, 1 + (i + 1) % (n * 2), 1 + i) for i in range(n * 2)], white)
    roof.data.materials.append(pink)
    for i, p in enumerate(roof.data.polygons):
        p.material_index = (i // 2) % 2
    parts.append(roof)
    # Zacken-Saum
    vs, fs = [], []
    for i in range(n * 2):
        a0, a1 = i / (n * 2) * math.pi * 2, (i + 1) / (n * 2) * math.pi * 2
        am = (a0 + a1) / 2
        b = len(vs)
        vs += [(math.cos(a0) * (r + 0.3), 3.0, math.sin(a0) * (r + 0.3)), (math.cos(a1) * (r + 0.3), 3.0, math.sin(a1) * (r + 0.3)), (math.cos(am) * (r + 0.3), 2.3, math.sin(am) * (r + 0.3))]
        fs.append((b, b + 1, b + 2))
    hem = mesh('hem', vs, fs, pink)
    parts.append(hem)
    parts.append(cyl((0, 9.0, 0), 0.06, 1.8, pole, verts=6))
    parts.append(mesh('flag', [(0, 9.8, 0), (1.2, 9.6, 0), (0, 9.3, 0)], [(0, 1, 2)], flag))
    parts.append(box((0, 1.3, r - 0.45), (2.4, 2.6, 0.1), M('opening', (0.03, 0.02, 0.02), 0, 0.9), bevel=0.0))
    export([join(parts, 'tent')], 'tent')


def ferris():
    reset()
    steel = M('fsteel', (0.85, 0.86, 0.9), 0.6, 0.35)
    ring = M('fring', (0.95, 0.95, 0.97), 0.3, 0.3, (1, 0.25, 0.6), 0.0)
    bulbs = M('fbulb', (1, 0.9, 0.7), 0, 0.3, (1, 0.8, 0.5), 2.0)
    R, axis = 20, 24
    stat = []
    for sz in (-3.4, 3.4):
        for sx in (-1, 1):
            stat.append(cyl((sx * 6.5, axis / 2, sz), 0.45, axis * 1.08, steel, (0, 0, -sx * 0.26), 10))
        stat.append(box((0, 3, sz), (14, 0.4, 0.4), steel, bevel=0.0))
    stat.append(cyl((0, axis, 0), 0.6, 8, steel, (math.pi / 2, 0, 0), 14))
    stat.append(box((0, 0.3, 0), (18, 0.6, 9), M('fbase', (0.2, 0.2, 0.22), 0, 0.8), bevel=0.05))
    base = join(stat, 'ferris')
    rot = []
    for z in (-1.4, 1.4):
        bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=0.32, major_segments=64, minor_segments=8)
        t = active()
        place(t, (0, 0, z), (math.pi / 2, 0, 0))
        rot.append(finish(t, ring, 0, 2, True))
        bpy.ops.mesh.primitive_torus_add(major_radius=R * 0.55, minor_radius=0.2, major_segments=40, minor_segments=6)
        t = active()
        place(t, (0, 0, z), (math.pi / 2, 0, 0))
        rot.append(finish(t, steel, 0, 2, True))
    for i in range(28):
        a = i / 28 * math.pi * 2
        rot.append(box((math.cos(a) * R / 2, math.sin(a) * R / 2, 0), (0.18, R, 0.18), steel, (0, 0, a - math.pi / 2), 0.0))
        rot.append(box((math.cos(a) * R, math.sin(a) * R, 1.5), (0.35, 0.35, 0.35), bulbs, bevel=0.0))
        rot.append(box((math.cos(a) * R, math.sin(a) * R, -1.5), (0.35, 0.35, 0.35), bulbs, bevel=0.0))
    for i in range(14):
        a = i / 14 * math.pi * 2
        rot.append(cyl((math.cos(a) * R, math.sin(a) * R, 0), 0.1, 3.4, steel, (math.pi / 2, 0, 0), 6))
    rotor = join(rot, 'rotor')
    rotor.location = B(0, axis, 0)
    # Gondel als eigenes Teil (das Spiel verteilt 14 Stück und hält sie waagerecht)
    gp = M('gondola', (0.9, 0.15, 0.35), 0.2, 0.5)
    gw = M('gwin', (0.05, 0.08, 0.12), 0.3, 0.15)
    g = [cyl((0, -1.6, 0), 1.25, 1.9, gp, verts=12), cyl((0, -0.55, 0), 1.35, 0.15, steel, verts=12), cyl((0, -0.25, 0), 0.06, 0.6, steel, verts=6),
         cyl((0, -1.35, 0), 1.27, 0.9, gw, verts=12)]
    gond = join(g, 'gondola')
    gond.location = B(40, 0, 0)
    export([base, rotor, gond], 'ferris')


def arch():
    reset()
    white = M('archwhite', (0.92, 0.92, 0.95), 0.2, 0.4)
    truss = M('truss', (0.6, 0.62, 0.66), 0.9, 0.3)
    dark = M('archdark', (0.03, 0.03, 0.04), 0, 0.6)
    banner = M('banner', (1, 1, 1), 0, 0.5)
    lights = M('stagelight', (1, 1, 1), 0, 0.3, (1, 0.9, 0.8), 3.0)
    parts = []
    for sx in (-13, 13):
        parts.append(box((sx, 6.5, 0), (2.6, 13, 2.6), white, bevel=0.15))
        parts.append(box((sx, 0.4, 0), (3.4, 0.8, 3.4), dark, bevel=0.05))
        for y in (3, 6, 9):
            parts.append(box((sx, y, 0), (2.7, 0.25, 2.7), dark, bevel=0.0))
    parts.append(box((0, 13.6, 0), (30, 3.6, 2.6), dark, bevel=0.1))
    for k in range(14):
        x = -13 + k * 2
        parts.append(box((x, 11.6, 1.0), (0.3, 0.3, 0.3), lights, bevel=0.0))
        parts.append(box((x, 11.6, -1.0), (0.3, 0.3, 0.3), lights, bevel=0.0))
    for x in (-13.6, 13.6):
        parts.append(cyl((x, 16.5, 0), 0.08, 2.4, truss, verts=6))
    body = join(parts, 'arch')
    bans = []
    for side in (1, -1):
        bpy.ops.mesh.primitive_plane_add(size=1)
        p = active()
        place(p, (0, 13.6, side * 1.33), (math.pi / 2, 0 if side > 0 else math.pi, 0), (27, 1, 3.3))
        finish(p, banner)
        p.name = 'banner'
        bans.append(p)
    export([body] + bans, 'arch', uv=True)


def tower():
    reset()
    truss = M('truss', (0.6, 0.62, 0.66), 0.9, 0.3)
    dark = M('stageblack', (0.02, 0.02, 0.025), 0, 0.7)
    lights = M('stagelight', (1, 1, 1), 0, 0.3, (1, 0.9, 0.8), 3.0)
    parts = []
    for sx in (-0.35, 0.35):
        for sz in (-0.35, 0.35):
            parts.append(cyl((sx, 9, sz), 0.05, 18, truss, verts=6))
    for y in range(1, 18, 1):
        parts.append(box((0, y, 0.35), (0.9, 0.04, 0.04), truss, (0, 0, 0.7 if y % 2 else -0.7), 0.0))
        parts.append(box((0, y, -0.35), (0.9, 0.04, 0.04), truss, (0, 0, -0.7 if y % 2 else 0.7), 0.0))
    parts.append(box((0, 0.2, 0), (1.6, 0.4, 1.6), dark, bevel=0.03))
    parts.append(box((0, 18.4, 0), (2.8, 0.25, 1.0), truss, bevel=0.0))
    for x in (-1.0, 0.0, 1.0):
        parts.append(box((x, 18.8, 0.1), (0.6, 0.6, 0.7), dark, (0.4, 0, 0), 0.03))
        parts.append(box((x, 18.75, 0.46), (0.46, 0.46, 0.05), lights, (0.4, 0, 0), 0.0))
    export([join(parts, 'tower')], 'tower')


# ---------------------------------------------------------------- Deko: Zuschauer, Boote, Windräder
def person(name, cheer):
    reset()
    skin = M('skin', (0.6, 0.38, 0.25), 0, 0.6)
    cloth = M('cloth', (0.8, 0.8, 0.8), 0, 0.8)
    pants = M('pants', (0.06, 0.08, 0.14), 0, 0.8)
    hair = M('hair', (0.05, 0.03, 0.02), 0, 0.8)
    parts = []
    for sx in (-0.11, 0.11):
        parts.append(box((sx, 0.42, 0), (0.15, 0.84, 0.17), pants, bevel=0.03))
    parts.append(box((0, 1.12, 0), (0.42, 0.6, 0.24), cloth, bevel=0.06))
    parts.append(ico((0, 1.58, 0), 0.14, skin, 1, 0.02, 1.15, 1, True))
    parts.append(ico((0, 1.64, -0.02), 0.145, hair, 1, 0.05, 0.75, 2, True))
    for sx in (-1, 1):
        if cheer:
            parts.append(box((sx * 0.3, 1.62, 0), (0.11, 0.6, 0.11), cloth, (0, 0, -sx * 0.35), 0.03))
            parts.append(ico((sx * 0.4, 1.95, 0), 0.06, skin, 1, 0.02))
        else:
            parts.append(box((sx * 0.27, 1.05, 0.02), (0.11, 0.6, 0.11), cloth, (0, 0, sx * 0.12), 0.03))
            parts.append(ico((sx * 0.31, 0.74, 0.02), 0.06, skin, 1, 0.02))
    export([join(parts, name)], name)


def boat():
    reset()
    hull = M('hull', (0.92, 0.92, 0.9), 0.1, 0.4)
    stripe = M('hullstripe', (0.05, 0.12, 0.4), 0, 0.5)
    wood = M('deck', (0.45, 0.3, 0.16), 0, 0.7)
    sail = M('sail', (0.95, 0.94, 0.9), 0, 0.6, double=True)
    mast = M('mast', (0.7, 0.7, 0.72), 0.7, 0.3)
    L, W = 8.0, 2.6
    prof = []
    n = 10
    for i in range(n + 1):
        t = i / n
        z = -L / 2 + t * L
        w = W / 2 * (1 - max(0, (t - 0.55) / 0.45) ** 1.6) * (0.85 + 0.15 * math.sin(t * math.pi))
        prof.append((z, max(0.05, w)))
    vs, fs = [], []
    for z, w in prof:
        vs += [(-w, 0.7, z), (-w * 0.7, -0.4, z), (0, -0.7, z), (w * 0.7, -0.4, z), (w, 0.7, z)]
    for i in range(n):
        for k in range(4):
            a, b = i * 5 + k, (i + 1) * 5 + k
            fs.append((a, b, b + 1, a + 1))
    fs.append((0, 1, 2, 3, 4))
    fs.append(tuple(n * 5 + k for k in (4, 3, 2, 1, 0)))
    parts = [mesh('hull', vs, fs, hull, True)]
    dv = [(-w * 0.97, 0.68, z) for z, w in prof] + [(w * 0.97, 0.68, z) for z, w in prof]
    parts.append(mesh('deck', dv, [tuple(range(n + 1)) + tuple(range(2 * n + 1, n, -1))], wood))
    sv = [(-w * 1.005, 0.45, z) for z, w in prof] + [(-w * 1.005, 0.6, z) for z, w in prof]
    parts.append(mesh('s1', sv, [(i, i + 1, n + 2 + i, n + 1 + i) for i in range(n)], stripe))
    sv2 = [(w * 1.005, 0.45, z) for z, w in prof] + [(w * 1.005, 0.6, z) for z, w in prof]
    parts.append(mesh('s2', sv2, [(n + 1 + i, n + 2 + i, i + 1, i) for i in range(n)], stripe))
    parts.append(cyl((0, 5.5, 0.6), 0.08, 9.6, mast, verts=8))
    parts.append(cyl((0, 1.6, -1.2), 0.06, 3.6, mast, (math.pi / 2, 0, 0), 6))
    parts.append(mesh('sail1', [(0, 1.7, 0.5), (0, 10.0, 0.55), (0, 1.7, -2.9)], [(0, 1, 2)], sail))
    parts.append(mesh('sail2', [(0, 1.9, 0.75), (0, 9.0, 0.7), (0, 1.0, 3.6)], [(0, 1, 2)], sail))
    parts.append(box((0, 1.1, -1.0), (1.6, 0.8, 2.2), hull, bevel=0.1))
    export([join(parts, 'boat')], 'boat')


def turbine():
    reset()
    white = M('twhite', (0.9, 0.9, 0.92), 0.1, 0.35)
    red = M('tred', (0.7, 0.05, 0.03), 0, 0.5)
    H = 62
    tw = cone((0, H / 2, 0), 2.0, 1.1, H, white, 16)
    for p in tw.data.polygons:
        p.use_smooth = True
    base = join([tw, cyl((0, 0.5, 0), 3.0, 1.0, white, verts=16), box((0, H + 1.2, -0.5), (2.6, 2.6, 7), white, bevel=0.6)], 'turbine')
    blades = [cone((0, 0, 0), 0.9, 0.5, 1.6, white, 12, (math.pi / 2, 0, 0))]
    for k in range(3):
        a = k / 3 * math.pi * 2
        L = 24
        vs = [(0, 0.5, 0), (0, -0.5, 0.1), (0, -0.2, 0), (0, L, 0.05), (0.9, 2.2, 0)]
        b = mesh('blade', [(0.35, 0.8, 0), (-0.35, 0.8, 0), (-0.15, L, 0.0), (0.18, L, 0.0), (0.9, 3.0, -0.08), (-0.6, 3.0, 0.08)],
                 [(0, 4, 3), (4, 0, 3), (1, 2, 5), (5, 2, 1), (0, 3, 2, 1), (1, 2, 3, 0)], white)
        b.rotation_euler = (0, -a, 0)
        blades.append(b)
        tip = box((0, L - 1.2, 0), (0.3, 2.4, 0.06), red, bevel=0.0)
        tip.rotation_euler = (0, -a, 0)
        blades.append(tip)
    rot = join(blades, 'rotor')
    rot.location = B(0, H + 1.2, 3.4)
    export([base, rot], 'turbine')


JOBS = {
    'pine_a': lambda: pine('pine_a', 5, 9.5, 2.3, 1),
    'pine_b': lambda: pine('pine_b', 7, 12.5, 2.0, 2),
    'leaf_a': lambda: leafy('leaf_a', 7.5, 3.2, (0.18, 0.11, 0.06), [(0.12, 0.3, 0.06), (0.16, 0.36, 0.07), (0.1, 0.25, 0.05)], 3),
    'leaf_b': lambda: leafy('leaf_b', 9.0, 2.5, (0.75, 0.73, 0.68), [(0.25, 0.42, 0.08), (0.3, 0.48, 0.1)], 4, birch=True),
    'palm': lambda: palm('palm', 5),
    'rock_a': lambda: rock('rock_a', 11, 0.7),
    'rock_b': lambda: rock('rock_b', 12, 1.0),
    'rock_c': lambda: rock('rock_c', 13, 0.5),
    'house_a': lambda: house('house_a', 10, 10, 2, 'gable', shutters=True, seed=1),
    'house_b': lambda: house('house_b', 12, 11, 3, 'flat', seed=2),
    'house_c': lambda: house('house_c', 9, 12, 4, 'gable', seed=3),
    'house_d': lambda: house('house_d', 14, 12, 5, 'flat', balconies=True, seed=4),
    'house_e': lambda: house('house_e', 11, 13, 2, 'flat', shop=True, seed=5),
    'house_f': lambda: house('house_f', 16, 14, 7, 'flat', balconies=True, seed=6),
    'farmhouse': lambda: house('farmhouse', 12, 10, 2, 'gable', shutters=True, farm=True, seed=7),
    'barn': lambda: barn('barn'),
    'lamp': lamp, 'fence': fence, 'cone': cone_model, 'hay': hay, 'poster': poster, 'ramp': ramp,
    'stage': stage, 'tent': tent, 'ferris': ferris, 'arch': arch, 'tower': tower,
    'person_a': lambda: person('person_a', False), 'person_b': lambda: person('person_b', True),
    'boat': boat, 'turbine': turbine,
}

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for name, fn in JOBS.items():
        if ONLY and name not in ONLY:
            continue
        fn()
