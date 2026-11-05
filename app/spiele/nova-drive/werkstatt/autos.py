"""Nova Drive – Automodelle in Blender bauen (eigene Designs).

Aufruf (Blender als Python-Modul `bpy` oder `blender -b -P`):
    python autos.py -- ../models

Für jedes Auto entsteht <id>.glb mit:
  - "body": Karosserie (Subdivision geglättet, Radkästen per Boolean ausgeschnitten) + Anbauteile
  - "wheel_fl/fr/rl/rr": Räder (Mittelpunkt = Drehpunkt)
Materialnamen, die das Spiel nutzt: paint (Lackfarbe wird ersetzt), glass, trim, chrome, head, tail, tire, rim, caliper.
Koordinaten wie im Spiel (three.js): vorne = +z, oben = +y. Blender: vorne = -Y, oben = +Z.
"""
import math
import os
import sys

import bpy  # zuerst: macht bmesh/mathutils verfügbar
import bmesh
from mathutils import Euler, Matrix, Vector

OUT = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else os.path.join(os.path.dirname(__file__), '..', 'models')
ONLY = sys.argv[sys.argv.index('--') + 2:] if '--' in sys.argv else []

# Gleiche Maße wie im Spiel (carmodel.js / physics)
STYLES = {
    'hatch': dict(L=4.1, W=1.8, clr=0.3, belt=0.98, nose=0.78, tail=0.96, hood=1.25, ws=0.72, roof=1.45, rear=0.38, H=1.5, wR=0.33, wb=2.55, tireW=0.24, rim='spoke5'),
    'rally': dict(L=4.25, W=1.88, clr=0.4, belt=1.05, nose=0.86, tail=1.0, hood=1.3, ws=0.72, roof=1.45, rear=0.42, H=1.62, wR=0.37, wb=2.6, tireW=0.27, rim='dish'),
    'roadster': dict(L=4.05, W=1.82, clr=0.27, belt=0.86, nose=0.66, tail=0.86, hood=1.65, ws=0.01, roof=0.0, rear=0.0, H=0.87, wR=0.33, wb=2.5, tireW=0.25, rim='multi'),
    'muscle': dict(L=4.85, W=1.96, clr=0.3, belt=1.0, nose=0.92, tail=0.96, hood=1.95, ws=0.72, roof=0.95, rear=1.05, H=1.38, wR=0.37, wb=2.85, tireW=0.31, rim='spoke5'),
    'truck': dict(L=4.9, W=2.02, clr=0.55, belt=1.38, nose=1.28, tail=1.32, hood=1.15, ws=0.5, roof=1.25, rear=0.12, H=2.08, wR=0.47, wb=3.0, tireW=0.34, rim='offroad'),
    'gt': dict(L=4.6, W=1.96, clr=0.26, belt=0.9, nose=0.66, tail=0.92, hood=1.65, ws=0.85, roof=0.7, rear=1.15, H=1.25, wR=0.36, wb=2.7, tireW=0.3, rim='multi'),
    'ev': dict(L=4.7, W=2.0, clr=0.27, belt=0.92, nose=0.68, tail=0.94, hood=1.35, ws=1.1, roof=0.95, rear=1.0, H=1.3, wR=0.36, wb=2.8, tireW=0.28, rim='dish'),
    'hyper': dict(L=4.72, W=2.06, clr=0.22, belt=0.82, nose=0.52, tail=0.98, hood=1.15, ws=1.0, roof=0.62, rear=1.45, H=1.12, wR=0.36, wb=2.75, tireW=0.32, rim='multi'),
}
CARS = [('kestrel', 'hatch'), ('tundra', 'truck'), ('velora', 'roadster'), ('ostwind', 'rally'),
        ('brenner', 'muscle'), ('aurum', 'gt'), ('volt', 'ev'), ('phantom', 'hyper')]

RX = Matrix.Rotation(math.radians(90), 4, 'X')  # Spiel → Blender


def B(x, y, z):
    return Vector((x, -z, y))


# ---------------------------------------------------------------- Materialien
MATS = {}


def material(name, color, metal=0.0, rough=0.5, emit=None, strength=0.0):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    p = nt.nodes.get('Principled BSDF')
    if p is None:
        p = nt.nodes.new('ShaderNodeBsdfPrincipled')
        out = nt.nodes.get('Material Output') or nt.nodes.new('ShaderNodeOutputMaterial')
        nt.links.new(p.outputs[0], out.inputs[0])
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Metallic'].default_value = metal
    p.inputs['Roughness'].default_value = rough
    if emit:
        p.inputs['Emission Color'].default_value = (*emit, 1)
        p.inputs['Emission Strength'].default_value = strength
    MATS[name] = m
    return m


def mats():
    return dict(
        paint=material('paint', (0.8, 0.05, 0.04), 0.55, 0.28),
        glass=material('glass', (0.02, 0.03, 0.045), 0.4, 0.06),
        trim=material('trim', (0.018, 0.018, 0.02), 0.0, 0.62),
        chrome=material('chrome', (0.9, 0.9, 0.92), 1.0, 0.12),
        head=material('head', (0.9, 0.9, 0.88), 0.3, 0.1, (1, 0.95, 0.85), 0.8),
        tail=material('tail', (0.5, 0.0, 0.0), 0.1, 0.2, (1, 0.02, 0.02), 0.6),
        tire=material('tire', (0.025, 0.025, 0.028), 0.0, 0.85),
        rim=material('rim', (0.72, 0.74, 0.78), 0.9, 0.28),
        caliper=material('caliper', (0.85, 0.12, 0.05), 0.2, 0.4),
        plate=material('plate', (0.85, 0.85, 0.82), 0.0, 0.5),
        accent=material('accent', (0.9, 0.9, 0.9), 0.1, 0.4),
        disc=material('disc', (0.3, 0.3, 0.32), 0.8, 0.45),
        interior=material('interior', (0.06, 0.035, 0.03), 0.0, 0.7),
    )


# ---------------------------------------------------------------- Hilfen
def active():
    return bpy.context.view_layer.objects.active


def place(o, loc, rot=(0, 0, 0), size=(1, 1, 1)):
    """loc/rot/size in Spiel-Koordinaten."""
    o.location = B(*loc)
    R = RX @ Euler(rot, 'XYZ').to_matrix().to_4x4() @ RX.inverted()
    o.rotation_euler = R.to_euler()
    o.scale = (size[0], size[2], size[1])
    return o


def finish(o, mat, bevel=0.0, segs=2, smooth=False):
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.data.materials.clear()
    o.data.materials.append(mat)
    if bevel > 0:
        m = o.modifiers.new('bev', 'BEVEL')
        m.width = bevel
        m.segments = segs
        m.limit_method = 'ANGLE'
    if smooth:
        for p in o.data.polygons:
            p.use_smooth = True
    o.select_set(False)
    return o


def box(loc, size, mat, rot=(0, 0, 0), bevel=0.02, segs=2):
    bpy.ops.mesh.primitive_cube_add(size=1)
    o = active()
    place(o, loc, rot, size)
    return finish(o, mat, bevel, segs)


def cyl(loc, r, depth, mat, rot=(0, 0, 0), verts=16, bevel=0.0, smooth=True):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth)
    o = active()
    place(o, loc, rot)
    return finish(o, mat, bevel, 2, smooth)


def ball(loc, size, mat, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, radius=0.5)
    o = active()
    place(o, loc, rot, size)
    return finish(o, mat, 0, 2, True)


# ---------------------------------------------------------------- Karosserie
class Shape:
    def __init__(self, S, style):
        self.S = S
        self.style = style
        L = S['L']
        self.zWs = L / 2 - S['hood']
        self.zRF = self.zWs - S['ws']
        self.zRR = self.zRF - S['roof']
        self.zRear = max(-L / 2 + 0.15, self.zRR - S['rear'])

    def T(self, s):
        S = self.S
        L, belt, nose, tail, H = S['L'], S['belt'], S['nose'], S['tail'], S['H']
        s = max(-L / 2, min(L / 2, s))
        if s >= self.zWs:
            u = (s - self.zWs) / S['hood']
            return belt + (nose - belt) * (u ** 1.5)
        if s >= self.zRF:
            u = (self.zWs - s) / max(S['ws'], 1e-3)
            return belt + (H - belt) * (1 - (1 - u) ** 1.6)
        if s >= self.zRR:
            u = (s - self.zRR) / max(S['roof'], 1e-3)
            return H + 0.015 * math.sin(u * math.pi)
        if s >= self.zRear:
            u = (self.zRR - s) / max(self.zRR - self.zRear, 1e-3)
            return H + (belt + 0.02 - H) * (u ** 1.15)
        u = (self.zRear - s) / max(self.zRear + L / 2, 1e-3)
        return belt + 0.02 + (tail - belt - 0.02) * (u ** 2)

    def Bl(self, s):
        S = self.S
        line = S['belt'] + 0.05 * (-s / (S['L'] / 2))
        return min(line, self.T(s) - 0.05)

    def g(self, s):
        return max(0.0, min(1.0, (self.T(s) - self.Bl(s) - 0.06) / 0.22))

    def hw(self, s):
        S = self.S
        u = abs(s) / (S['L'] / 2)
        return S['W'] / 2 * (1 - 0.1 * u ** 3.5) - 0.02

    def bottom(self, s):
        u = abs(s) / (self.S['L'] / 2)
        return self.S['clr'] + 0.1 * u ** 5

    def section(self, s):
        T, Bv, g, hw, b = self.T(s), self.Bl(s), self.g(s), self.hw(s), self.bottom(s)
        wr = hw * 0.8
        lerp = lambda a, c, t: a + (c - a) * t
        pts = [
            (0.0, b), (hw * 0.72, b), (hw * 0.95, b + 0.05), (hw, b + 0.3 * (Bv - b)), (hw * 1.0, b + 0.72 * (Bv - b)),
            (hw * 0.985, Bv), (lerp(hw * 0.95, wr * 1.0, g), Bv + lerp(0.03, 0.06, g)),
            (lerp(hw * 0.9, wr * 0.95, g), lerp(Bv + 0.045, Bv + (T - Bv) * 0.55, g)),
            (lerp(hw * 0.8, wr * 0.86, g), lerp(T - 0.012, T - 0.05, g)),
            (lerp(hw * 0.5, wr * 0.6, g), T - 0.004), (lerp(hw * 0.22, wr * 0.28, g), T + 0.004), (0.0, T + 0.006),
        ]
        return pts


def build_body(S, style, M):
    sh = Shape(S, style)
    L = S['L']
    N = 34
    stations = [-L / 2 + L * (1 - math.cos(math.pi * i / (N - 1))) / 2 for i in range(N)]
    bm = bmesh.new()
    rings = []
    for k, s in enumerate(stations):
        half = sh.section(s)
        # Enden etwas einziehen → runde Nase/Heck nach dem Glätten
        shrink = 1.0
        if k == 0 or k == N - 1:
            shrink = 0.9
        ring = []
        full = [(x * shrink, h) for x, h in half] + [(-x * shrink, h) for x, h in reversed(half[1:-1])]
        for x, h in full:
            ring.append(bm.verts.new(B(x, h, s)))
        rings.append(ring)
    n = len(rings[0])
    for a, b in zip(rings[:-1], rings[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    for ring, flip in ((rings[0], False), (rings[-1], True)):
        c = sum((v.co for v in ring), Vector()) / len(ring)
        cv = bm.verts.new(c)
        for i in range(n):
            j = (i + 1) % n
            f = (ring[j], ring[i], cv) if not flip else (ring[i], ring[j], cv)
            bm.faces.new(f)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new('body')
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new('body', me)
    bpy.context.collection.objects.link(o)
    order = ['paint', 'glass', 'trim', 'chrome']
    for nm in order:
        me.materials.append(M[nm])
    # Flächen einfärben
    mid_roof = (sh.zRR + sh.zRF) / 2
    for p in me.polygons:
        c = p.center
        x, h, s = c.x, c.z, -c.y
        idx = 0
        g = sh.g(s)
        if g > 0.25 and h > sh.Bl(s) + 0.035 and style != 'roadster':
            roofzone = sh.zRR + 0.03 < s < sh.zRF - 0.03
            if roofzone and h > sh.T(s) - 0.08 and abs(x) < sh.hw(s) * 0.66:
                idx = 0
            elif (sh.zRF - 0.02 < s < sh.zWs or sh.zRear < s < sh.zRR + 0.02) and abs(x) > sh.hw(s) * 0.74 and h > sh.T(s) - 0.2:
                idx = 0  # A-/C-Säulen
            elif abs(s - mid_roof) < 0.05 and abs(x) > sh.hw(s) * 0.7:
                idx = 2  # B-Säule
            else:
                idx = 1
        elif h < S['clr'] + 0.11:
            idx = 2
        p.material_index = idx
        p.use_smooth = True
    sub = o.modifiers.new('sub', 'SUBSURF')
    sub.levels = 1
    sub.render_levels = 1
    # Radkästen
    cutters = []
    for sz in (1, -1):
        for sx in (1, -1):
            pass
    for sz in (1, -1):
        bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=S['wR'] + 0.065, depth=S['W'] + 0.6)
        cu = active()
        place(cu, (0, S['wR'] + 0.02, sz * S['wb'] / 2), (0, 0, math.pi / 2))
        cu.data.materials.append(M['trim'])
        cu.hide_render = True
        cutters.append(cu)
    for cu in cutters:
        bo = o.modifiers.new('arch', 'BOOLEAN')
        bo.operation = 'DIFFERENCE'
        bo.object = cu
        try:
            bo.solver = 'EXACT'
        except Exception:
            pass
        try:
            bo.material_mode = 'TRANSFER'
        except Exception:
            pass
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    for mname in [m.name for m in o.modifiers]:
        bpy.ops.object.modifier_apply(modifier=mname)
    o.select_set(False)
    for cu in cutters:
        bpy.data.objects.remove(cu, do_unlink=True)
    return o, sh


def details(S, style, sh, M):
    L, W = S['L'], S['W']
    parts = []
    add = parts.append
    fz = L / 2
    # Lichter
    sH = fz - 0.12
    hH = sh.T(sH) - 0.06
    slope = math.atan2(sh.T(sH + 0.05) - sh.T(sH - 0.05), 0.1)
    if style in ('ev', 'hyper'):
        add(box((0, hH + 0.01, sH + 0.02), (W * 0.84, 0.045, 0.1), M['head'], (slope * 0.5, 0, 0), 0.015))
        add(box((0, sh.T(-fz + 0.1) - 0.08, -fz + 0.08), (W * 0.9, 0.06, 0.08), M['tail'], (0, 0, 0), 0.015))
    else:
        for sx in (1, -1):
            if style == 'truck':
                add(box((sx * (sh.hw(sH) - 0.28), hH - 0.04, sH + 0.03), (0.34, 0.2, 0.12), M['head'], (0, 0, 0), 0.03))
            elif style == 'muscle':
                for k in (0, 1):
                    add(cyl((sx * (sh.hw(sH) - 0.22 - k * 0.22), hH - 0.08, fz - 0.06), 0.085, 0.06, M['head'], (math.pi / 2, 0, 0), 16))
            else:
                add(box((sx * (sh.hw(sH) - 0.3), hH, sH + 0.0), (0.42, 0.1, 0.2), M['trim'], (slope, sx * 0.3, 0), 0.03))
                add(box((sx * (sh.hw(sH) - 0.3), hH + 0.01, sH + 0.03), (0.36, 0.07, 0.17), M['head'], (slope, sx * 0.3, 0), 0.025))
            sT = -fz + 0.07
            add(box((sx * (sh.hw(sT) - 0.3), sh.T(sT) - 0.1, sT - 0.01), (0.46, 0.1, 0.08), M['tail'], (0, -sx * 0.15, 0), 0.02))
    # Grill, Lippe, Diffusor, Kennzeichen
    gh = S['clr'] + (S['nose'] - S['clr']) * 0.42
    add(box((0, gh, fz - 0.06), (W * (0.32 if style == 'ev' else 0.46), 0.16 if style != 'truck' else 0.32, 0.12), M['paint' if style == 'ev' else 'trim'], (0, 0, 0), 0.03))
    if style == 'muscle':
        add(box((0, gh, fz - 0.03), (W * 0.5, 0.2, 0.06), M['chrome'], (0, 0, 0), 0.015))
    add(box((0, S['clr'] + 0.03, fz - 0.3), (W * 0.8, 0.04, 0.22), M['trim'], (0, 0, 0), 0.01))
    add(box((0, S['clr'] + 0.07, -fz + 0.2), (W * 0.7, 0.1, 0.22), M['trim'], (0, 0, 0), 0.01))
    add(box((0, S['clr'] + 0.17, fz - 0.035), (0.44, 0.11, 0.02), M['plate'], (0, 0, 0), 0.005))
    add(box((0, S['clr'] + 0.3, -fz + 0.03), (0.44, 0.11, 0.02), M['plate'], (0, 0, 0), 0.005))
    # Spiegel
    if style != 'roadster':
        for sx in (1, -1):
            s = sh.zWs - 0.12
            x = sx * (sh.hw(s) + 0.07)
            add(box((x, sh.Bl(s) + 0.1, s), (0.16, 0.11, 0.2), M['paint'], (0, 0, 0), 0.03))
            add(box((x - sx * 0.07, sh.Bl(s) + 0.05, s), (0.08, 0.04, 0.05), M['trim'], (0, 0, 0), 0.005))
    # Seitenschweller
    for sx in (1, -1):
        add(box((sx * (W / 2 - 0.1), S['clr'] + 0.07, 0), (0.08, 0.1, S['wb'] - S['wR'] * 2 - 0.3), M['trim'], (0, 0, 0), 0.02))
    # Auspuff
    ex = [-0.48, 0.48] if style in ('gt', 'muscle', 'hyper') else [0.5]
    if style != 'ev':
        for x in ex:
            add(cyl((x, S['clr'] + 0.09, -fz + 0.02), 0.055, 0.22, M['chrome'], (math.pi / 2, 0, 0), 14))
    # Stil-Extras
    if style == 'hatch':
        add(box((0, S['H'] - 0.07, sh.zRR - 0.1), (W * 0.7, 0.04, 0.24), M['paint'], (-0.18, 0, 0), 0.015))
    if style == 'rally':
        sW = sh.zRR - 0.12
        add(box((0, S['H'] + 0.1, sW), (W * 0.96, 0.04, 0.32), M['paint'], (0.08, 0, 0), 0.015))
        for sx in (1, -1):
            add(box((sx * W * 0.47, S['H'] + 0.06, sW), (0.03, 0.16, 0.36), M['trim'], (0, 0, 0), 0.005))
            add(box((sx * W * 0.25, S['H'] - 0.01, sW + 0.05), (0.04, 0.12, 0.08), M['trim'], (0, 0, 0), 0.005))
            add(box((sx * (W / 2 - 0.25), S['clr'] + 0.02, -S['wb'] / 2 - S['wR'] - 0.1), (0.32, 0.3, 0.02), M['trim'], (0, 0, 0), 0.005))
        add(box((0, S['H'] + 0.05, (sh.zRF + sh.zRR) / 2 + 0.25), (0.4, 0.1, 0.36), M['trim'], (0, 0, 0), 0.03))
        for x in (-0.45, -0.15, 0.15, 0.45):
            add(cyl((x, S['nose'] + 0.06, fz - 0.28), 0.085, 0.08, M['head'], (math.pi / 2 - 0.1, 0, 0), 14))
            add(cyl((x, S['nose'] + 0.06, fz - 0.33), 0.095, 0.06, M['trim'], (math.pi / 2 - 0.1, 0, 0), 14))
    if style == 'muscle':
        s = sh.zWs + 0.65
        add(box((0, sh.T(s) + 0.05, s), (0.6, 0.12, 0.7), M['paint'], (-0.06, 0, 0), 0.04))
        add(box((0, sh.T(s) + 0.07, s + 0.36), (0.5, 0.07, 0.02), M['trim'], (0, 0, 0), 0.005))
        add(box((0, S['tail'] + 0.04, -fz + 0.14), (W * 0.86, 0.05, 0.16), M['paint'], (-0.22, 0, 0), 0.015))
    if style == 'gt':
        add(box((0, S['tail'] + 0.03, -fz + 0.12), (W * 0.82, 0.035, 0.2), M['paint'], (-0.28, 0, 0), 0.012))
        for sx in (1, -1):
            add(box((sx * (sh.hw(0.3) + 0.0), sh.Bl(0.3) - 0.2, 0.3), (0.04, 0.12, 0.5), M['trim'], (0, 0, 0), 0.01))
    if style == 'hyper':
        sW = -fz + 0.3
        add(box((0, S['tail'] + 0.42, sW), (W * 0.98, 0.05, 0.4), M['paint'], (0.1, 0, 0), 0.02))
        for sx in (1, -1):
            add(box((sx * 0.55, S['tail'] + 0.2, sW + 0.03), (0.06, 0.4, 0.18), M['trim'], (0, 0, 0), 0.01))
            add(box((sx * W * 0.49, S['tail'] + 0.36, sW), (0.03, 0.22, 0.46), M['trim'], (0, 0, 0), 0.005))
            add(box((sx * (sh.hw(-0.2) - 0.02), sh.Bl(-0.2) - 0.22, -0.2), (0.06, 0.3, 0.75), M['trim'], (0, sx * 0.12, 0), 0.02))
        add(box((0, S['H'] + 0.06, (sh.zRF + sh.zRR) / 2 - 0.1), (0.3, 0.12, 0.6), M['paint'], (0, 0, 0), 0.04))
        add(box((0, S['clr'] + 0.06, -fz + 0.18), (W * 0.8, 0.14, 0.36), M['trim'], (0.35, 0, 0), 0.01))
    if style == 'ev':
        add(box((0, sh.Bl(sh.zWs) + 0.05, sh.zWs + 0.06), (W * 0.62, 0.02, 0.05), M['head'], (0, 0, 0), 0.005))
    if style == 'truck':
        z0, z1 = -fz + 0.15, sh.zRear - 0.05
        add(box((0, S['belt'] + 0.03, (z0 + z1) / 2), (W * 0.86, 0.06, z1 - z0), M['trim'], (0, 0, 0), 0.01))
        for sx in (1, -1):
            add(box((sx * W * 0.44, S['belt'] + 0.12, (z0 + z1) / 2), (0.05, 0.05, z1 - z0), M['chrome'], (0, 0, 0), 0.01))
            add(box((sx * W * 0.42, S['belt'] + 0.4, z1 - 0.15), (0.07, 0.8, 0.07), M['trim'], (0, 0, 0), 0.01))
            for sz in (1, -1):
                add(box((sx * (W / 2 + 0.02), S['wR'] + 0.36, sz * S['wb'] / 2), (0.1, 0.12, S['wR'] * 2 + 0.3), M['trim'], (0, 0, 0), 0.03))
        add(box((0, S['belt'] + 0.8, z1 - 0.15), (W * 0.84, 0.07, 0.07), M['trim'], (0, 0, 0), 0.01))
        rz = (sh.zRF + sh.zRR) / 2 + 0.3
        add(box((0, S['H'] + 0.1, rz), (W * 0.82, 0.08, 0.1), M['trim'], (0, 0, 0), 0.01))
        for x in (-0.6, -0.2, 0.2, 0.6):
            add(box((x, S['H'] + 0.1, rz + 0.06), (0.24, 0.1, 0.04), M['head'], (0, 0, 0), 0.01))
        for h in (0.35, 0.75):
            add(box((0, S['clr'] + h, fz + 0.1), (W * 0.8, 0.07, 0.07), M['trim'], (0, 0, 0), 0.015))
        for sx in (1, -1):
            add(box((sx * W * 0.38, S['clr'] + 0.55, fz + 0.1), (0.07, 0.5, 0.07), M['trim'], (0, 0, 0), 0.015))
    if style == 'roadster':
        zc = sh.zWs - 0.85
        add(box((0, S['belt'] + 0.005, zc), (W * 0.74, 0.04, 1.3), M['interior'], (0, 0, 0), 0.05))
        for sx in (-0.4, 0.4):
            add(box((sx, S['belt'] + 0.22, zc - 0.5), (0.48, 0.5, 0.12), M['interior'], (0.18, 0, 0), 0.05))
            add(box((sx, S['belt'] + 0.06, zc - 0.25), (0.46, 0.12, 0.5), M['interior'], (0, 0, 0), 0.04))
            bpy.ops.mesh.primitive_torus_add(major_radius=0.22, minor_radius=0.03, major_segments=16, minor_segments=6)
            t = active()
            place(t, (sx, S['belt'] + 0.06, zc - 0.68), (math.pi / 2, 0, 0))
            add(finish(t, M['chrome'], 0, 2, True))
        add(box((0, S['belt'] + 0.2, sh.zWs - 0.1), (W * 0.82, 0.38, 0.025), M['glass'], (-0.6, 0, 0), 0.01))
        add(box((0, S['belt'] + 0.39, sh.zWs - 0.21), (W * 0.84, 0.03, 0.04), M['trim'], (-0.6, 0, 0), 0.005))
        add(box((0, S['tail'] + 0.02, -fz + 0.25), (W * 0.7, 0.03, 0.18), M['paint'], (-0.15, 0, 0), 0.01))
    return parts


# ---------------------------------------------------------------- Räder
def build_wheel(S, M):
    r, w = S['wR'], S['tireW']
    parts = []
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=r, depth=w)
    t = active()
    place(t, (0, 0, 0), (0, 0, math.pi / 2))
    finish(t, M['tire'], 0, 2, True)
    bv = t.modifiers.new('bev', 'BEVEL')
    bv.width = r * 0.2
    bv.segments = 2
    parts.append(t)
    rim = S['rim']
    rr = r * (0.66 if rim != 'offroad' else 0.58)
    out = w / 2 - 0.02
    parts.append(cyl((out - 0.035, 0, 0), rr, 0.05, M['trim'], (0, 0, math.pi / 2), 24))
    parts.append(cyl((out, 0, 0), rr, 0.025, M['rim'], (0, 0, math.pi / 2), 24))
    bpy.ops.mesh.primitive_torus_add(major_radius=rr - 0.012, minor_radius=0.022, major_segments=24, minor_segments=6)
    tor = active()
    place(tor, (out + 0.012, 0, 0), (0, 0, math.pi / 2))
    parts.append(finish(tor, M['rim'], 0, 2, True))
    n = {'spoke5': 5, 'multi': 10, 'dish': 6, 'offroad': 6}[rim]
    for k in range(n):
        a = k / n * math.pi * 2
        if rim == 'dish':
            parts.append(cyl((out + 0.014, math.sin(a) * rr * 0.58, math.cos(a) * rr * 0.58), rr * 0.17, 0.012, M['trim'], (0, 0, math.pi / 2), 12))
            continue
        wd = 0.07 if rim in ('spoke5', 'offroad') else 0.032
        parts.append(box((out + 0.012, math.sin(a) * rr * 0.52, math.cos(a) * rr * 0.52), (0.03, wd, rr * 0.92), M['rim'], (a, 0, 0), 0.008))
    parts.append(cyl((out + 0.02, 0, 0), rr * 0.24, 0.04, M['chrome'], (0, 0, math.pi / 2), 12))
    parts.append(cyl((-0.02, 0, 0), rr * 0.82, 0.03, M['disc'], (0, 0, math.pi / 2), 20))
    parts.append(box((0.0, rr * 0.55, -rr * 0.35), (0.07, rr * 0.38, rr * 0.3), M['caliper'], (0.6, 0, 0), 0.015))
    if rim == 'offroad':
        for k in range(20):
            a = k / 20 * math.pi * 2
            parts.append(box((((k % 2) - 0.5) * w * 0.4, math.sin(a) * r, math.cos(a) * r), (w * 0.45, 0.06, 0.09), M['tire'], (a, 0, 0), 0.01))
    for p in parts:
        bpy.ops.object.select_all(action='DESELECT')
        p.select_set(True)
        bpy.context.view_layer.objects.active = p
        for m in list(p.modifiers):
            bpy.ops.object.modifier_apply(modifier=m.name)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = parts[0]
    for p in parts:
        p.select_set(True)
    bpy.ops.object.join()
    wobj = active()
    wobj.name = 'wheel'
    bpy.ops.object.select_all(action='DESELECT')
    return wobj


# ---------------------------------------------------------------- ein Auto
def build_car(cid, style):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    MATS.clear()
    M = mats()
    S = STYLES[style]
    body, sh = build_body(S, style, M)
    parts = details(S, style, sh, M)
    for p in parts:
        bpy.context.view_layer.objects.active = p
        for m in list(p.modifiers):
            bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.ops.object.select_all(action='DESELECT')
    for p in parts:
        p.select_set(True)
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    body = active()
    body.name = 'body'
    bpy.ops.object.select_all(action='DESELECT')
    wheel = build_wheel(S, M)
    wx = S['W'] / 2 - 0.12
    wheels = []
    for name, sx, sz in (('wheel_fl', 1, 1), ('wheel_fr', -1, 1), ('wheel_rl', 1, -1), ('wheel_rr', -1, -1)):
        o = wheel.copy()
        o.data = wheel.data
        bpy.context.collection.objects.link(o)
        o.name = name
        o.location = B(sx * wx, S['wR'], sz * S['wb'] / 2)
        o.rotation_euler = (0, 0, 0 if sx > 0 else math.pi)
        wheels.append(o)
    bpy.data.objects.remove(wheel, do_unlink=True)
    bpy.ops.object.select_all(action='DESELECT')
    body.select_set(True)
    for o in wheels:
        o.select_set(True)
    tris = sum(len(p.vertices) - 2 for p in body.data.polygons) + 4 * sum(len(p.vertices) - 2 for p in wheels[0].data.polygons)
    path = os.path.abspath(os.path.join(OUT, f'{cid}.glb'))
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                              export_texcoords=False, export_normals=True, export_materials='EXPORT', export_cameras=False,
                              export_lights=False, export_extras=False)
    print(f'{cid}: {tris} Dreiecke → {path} ({os.path.getsize(path) // 1024} KB)')
    # LOD für Gegner/Verkehr: Karosserie ausdünnen, einfache Räder
    dec = body.modifiers.new('dec', 'DECIMATE')
    dec.ratio = 0.3
    for o in wheels:
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=S['wR'], depth=S['tireW'])
    lw = active()
    place(lw, (0, 0, 0), (0, 0, math.pi / 2))
    finish(lw, M['tire'])
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=S['wR'] * 0.62, depth=S['tireW'] + 0.02)
    lr = active()
    place(lr, (0, 0, 0), (0, 0, math.pi / 2))
    finish(lr, M['rim'])
    bpy.ops.object.select_all(action='DESELECT')
    for p in (lw, lr):
        p.select_set(True)
        bpy.context.view_layer.objects.active = p
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.context.view_layer.objects.active = lw
    bpy.ops.object.join()
    lw = active()
    bpy.ops.object.select_all(action='DESELECT')
    body.select_set(True)
    for name, sx, sz in (('wheel_fl', 1, 1), ('wheel_fr', -1, 1), ('wheel_rl', 1, -1), ('wheel_rr', -1, -1)):
        o = lw.copy(); o.data = lw.data
        bpy.context.collection.objects.link(o)
        o.name = name
        o.location = B(sx * wx, S['wR'], sz * S['wb'] / 2)
        o.select_set(True)
    bpy.data.objects.remove(lw, do_unlink=True)
    lpath = os.path.abspath(os.path.join(OUT, f'{cid}_lod.glb'))
    bpy.ops.export_scene.gltf(filepath=lpath, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                              export_texcoords=False, export_normals=True, export_materials='EXPORT', export_cameras=False,
                              export_lights=False, export_extras=False)
    print(f'{cid}_lod → {os.path.getsize(lpath) // 1024} KB')


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for cid, style in CARS:
        if ONLY and cid not in ONLY:
            continue
        build_car(cid, style)
