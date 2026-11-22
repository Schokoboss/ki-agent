"""Fotografierte Bäume von Poly Haven (CC0, gemeinfrei) als Imposter fürs Spiel.

Die Originale haben Millionen Dreiecke. Für das Spiel wird jeder Baum aus 8 Richtungen gerendert (Cycles, CPU):
  models/baum/<name>_c.webp  Farbe + Transparenz (8 Ansichten im 4×2-Atlas, weiches Umgebungslicht = eingebaute
                             Verschattung im Blätterdach)
  models/baum/<name>_n.webp  Normalen im Spiel-Koordinatensystem (y oben) → im Spiel richtig beleuchtet (Tageszeit)
  models/baum/baeume.json    Maße (Höhe, Breite der Fläche, Zellgröße)
Im Spiel ist jeder Baum eine Fläche (2 Dreiecke), die die Ansicht passend zur Blickrichtung zeigt.

Aufruf (im Ordner app/spiele/nova-drive):  python werkstatt/baeume.py [--hd] [--cache ORDNER] [name …]
Braucht: bpy, Pillow, numpy und Internet (api.polyhaven.com, dl.polyhaven.org). Downloads: 50–500 MB je Baum.
"""
import json
import math
import os
import sys
import tempfile
import urllib.request

import bpy  # zuerst: macht mathutils verfügbar
from mathutils import Vector
import numpy as np
from PIL import Image

# Spielname: (Poly-Haven-ID, Spiel-Baumart 0 Tanne / 1 Laubbaum / 2 Palme)
TREES = {
    'tanne': ('fir_tree_01', 0),
    'laub': ('tree_small_02', 1),
    'insel': ('island_tree_02', 2),
    'jaca': ('jacaranda_tree', 1),      # blüht lila – rund ums Festival
    'jung': ('fir_sapling', 0),         # junge Tannen im Wald
    'strand_a': ('island_tree_01', 2),  # Strandbäume statt Palmen
    'strand_b': ('island_tree_03', 2),
}
VIEWS, COLS, ROWS = 8, 4, 2
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
HD = '--hd' in ARGS
CELL_H = 1024 if HD else 512
CACHE = ARGS[ARGS.index('--cache') + 1] if '--cache' in ARGS else None
ONLY = [a for a in ARGS if not a.startswith('--') and a != CACHE]
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'models', 'baum-hd' if HD else 'baum')


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'NovaDrive-Werkstatt'})
    with urllib.request.urlopen(req, timeout=1800) as r:
        return r.read()


def download(pid, folder):
    files = json.loads(get(f'https://api.polyhaven.com/files/{pid}'))
    g = files['gltf']['1k']['gltf']
    main = os.path.join(folder, os.path.basename(g['url']))
    if not os.path.exists(main):
        for path, info in g.get('include', {}).items():
            p = os.path.join(folder, path)
            os.makedirs(os.path.dirname(p), exist_ok=True)
            if not os.path.exists(p):
                with open(p, 'wb') as f:
                    f.write(get(info['url']))
        with open(main, 'wb') as f:
            f.write(get(g['url']))
    return main


def bbox(objs):
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    return Vector([min(p[i] for p in pts) for i in range(3)]), Vector([max(p[i] for p in pts) for i in range(3)])


def pick_tallest(meshes):
    """Dateien enthalten oft mehrere Varianten nebeneinander: nach Überlappung (xy) gruppieren, höchste Gruppe behalten."""
    boxes = [bbox([o]) for o in meshes]
    parent = list(range(len(meshes)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for i in range(len(meshes)):
        for j in range(i + 1, len(meshes)):
            (a0, a1), (b0, b1) = boxes[i], boxes[j]
            if a0.x <= b1.x and b0.x <= a1.x and a0.y <= b1.y and b0.y <= a1.y:
                parent[find(i)] = find(j)
    groups = {}
    for i, o in enumerate(meshes):
        groups.setdefault(find(i), []).append(o)
    best = max(groups.values(), key=lambda g: bbox(g)[1].z - bbox(g)[0].z)
    for o in meshes:
        if o not in best:
            bpy.data.objects.remove(o, do_unlink=True)
    return best


def normal_material():
    """Emission = Normale im Spiel-System (Blender x,y,z → Spiel x,z,−y), 0…1 kodiert."""
    m = bpy.data.materials.new('nrm')
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    neg = nt.nodes.new('ShaderNodeMath'); neg.operation = 'MULTIPLY'; neg.inputs[1].default_value = -1
    comb = nt.nodes.new('ShaderNodeCombineXYZ')
    mad = nt.nodes.new('ShaderNodeVectorMath'); mad.operation = 'MULTIPLY_ADD'
    mad.inputs[1].default_value = (0.5, 0.5, 0.5); mad.inputs[2].default_value = (0.5, 0.5, 0.5)
    em = nt.nodes.new('ShaderNodeEmission')
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(geo.outputs['Normal'], sep.inputs[0])
    nt.links.new(sep.outputs['X'], comb.inputs['X'])
    nt.links.new(sep.outputs['Z'], comb.inputs['Y'])
    nt.links.new(sep.outputs['Y'], neg.inputs[0])
    nt.links.new(neg.outputs[0], comb.inputs['Z'])
    nt.links.new(comb.outputs[0], mad.inputs[0])
    nt.links.new(mad.outputs[0], em.inputs['Color'])
    nt.links.new(em.outputs[0], out.inputs['Surface'])
    return m


def bleed(img):
    """Farbe in durchsichtige Ränder ausbreiten (sonst dunkle Säume durch Mipmaps)."""
    a = np.asarray(img, dtype=np.float32)
    rgb, al = a[..., :3], a[..., 3:4] / 255.0
    acc, w = rgb * al, al.copy()
    for _ in range(24):
        pad = lambda x: np.pad(x, ((1, 1), (1, 1), (0, 0)), mode='edge')
        A, Wt = pad(acc), pad(w)
        acc2 = (A[:-2, 1:-1] + A[2:, 1:-1] + A[1:-1, :-2] + A[1:-1, 2:] + A[1:-1, 1:-1])
        w2 = (Wt[:-2, 1:-1] + Wt[2:, 1:-1] + Wt[1:-1, :-2] + Wt[1:-1, 2:] + Wt[1:-1, 1:-1])
        hole = w < 0.999
        acc = np.where(hole, acc2 / 5, acc); w = np.where(hole, np.minimum(1, w2 / 5 * 1.6), w)
    col = np.where(al > 0.01, rgb, acc / np.maximum(w, 1e-4))
    out = np.concatenate([np.clip(col, 0, 255), a[..., 3:4]], axis=2).astype(np.uint8)
    return Image.fromarray(out, 'RGBA')


def bake(name, pid, kind, cache):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=download(pid, cache))
    meshes = pick_tallest([o for o in bpy.context.scene.objects if o.type == 'MESH'])
    mn, mx = bbox(meshes)
    H = mx.z - mn.z
    span = math.hypot(mx.x - mn.x, mx.y - mn.y) * 0.92  # größte sichtbare Breite aus allen Richtungen
    aspect = max(0.4, min(1.0, span / H))
    ch = CELL_H
    cw = int(round(ch * aspect / 16) * 16)
    scale = max(H, span * ch / cw) * 1.03  # senkrechte Ausdehnung der Zelle in Metern
    S = bpy.context.scene
    S.render.engine = 'CYCLES'; S.cycles.device = 'CPU'; S.cycles.use_denoising = False
    S.render.film_transparent = True; S.render.resolution_x = cw; S.render.resolution_y = ch
    S.render.image_settings.color_mode = 'RGBA'
    S.view_settings.view_transform = 'Standard'
    w = bpy.data.worlds.new('w'); S.world = w; w.use_nodes = True
    bg = w.node_tree.nodes['Background']; bg.inputs[0].default_value = (1, 1, 1, 1); bg.inputs[1].default_value = 1.0
    cd = bpy.data.cameras.new('c'); cd.type = 'ORTHO'; cd.ortho_scale = scale; cd.clip_end = 500
    cam = bpy.data.objects.new('c', cd); S.collection.objects.link(cam); S.camera = cam
    cx, cy = (mn.x + mx.x) / 2, (mn.y + mx.y) / 2
    cz = mn.z - scale * 0.01 + scale / 2  # Fuß des Baums an der Unterkante
    tmp = tempfile.mkdtemp()
    nrm = normal_material()
    shots = {'c': [], 'n': []}
    for k in range(VIEWS):
        a = k / VIEWS * 2 * math.pi  # Spiel: Blickrichtung vom Baum zur Kamera = atan2(dx, dz) = a
        cam.location = (cx + math.sin(a) * 120, cy - math.cos(a) * 120, cz)
        cam.rotation_euler = (Vector((cx, cy, cz)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
        for kind_, samples, override in (('c', 24, None), ('n', 6, nrm)):
            S.cycles.samples = samples
            S.view_layers[0].material_override = override
            S.render.filepath = os.path.join(tmp, f'{kind_}{k}.png')
            bpy.ops.render.render(write_still=True)
            shots[kind_].append(S.render.filepath)
    os.makedirs(OUT, exist_ok=True)
    for kind_ in ('c', 'n'):
        atlas = Image.new('RGBA', (cw * COLS, ch * ROWS), (0, 0, 0, 0))
        for k, f in enumerate(shots[kind_]):
            im = Image.open(f).convert('RGBA')
            atlas.paste(im, ((k % COLS) * cw, (k // COLS) * ch))
        atlas = bleed(atlas)
        if kind_ == 'n':  # Alpha der Normalen = Alpha der Farbe (gleiche Form), spart nichts, hält die Ränder sauber
            atlas = Image.merge('RGB', atlas.split()[:3])
            atlas.save(os.path.join(OUT, f'{name}_n.webp'), quality=88, method=6)
        else:
            atlas.save(os.path.join(OUT, f'{name}_c.webp'), quality=86, method=6, alpha_quality=90)
    info = dict(pid=pid, kind=kind, H=round(H, 3), scale=round(scale, 3), width=round(scale * cw / ch, 3),
                base=round(-scale * 0.01, 4), cw=cw, ch=ch, cols=COLS, rows=ROWS, views=VIEWS)
    print(f'{name}: {pid} Höhe {H:.1f} m, Zelle {cw}×{ch}, Atlas {cw * COLS}×{ch * ROWS}')
    return info


def main():
    meta_path = os.path.join(OUT, 'baeume.json')
    meta = json.load(open(meta_path)) if os.path.exists(meta_path) else {}
    cache = CACHE or tempfile.mkdtemp()
    for name, (pid, kind) in TREES.items():
        if ONLY and name not in ONLY:
            continue
        sub = os.path.join(cache, pid)
        os.makedirs(sub, exist_ok=True)
        meta[name] = bake(name, pid, kind, sub)
    os.makedirs(OUT, exist_ok=True)
    with open(meta_path, 'w', encoding='utf-8') as f:
        json.dump(meta, f, indent=1)
    with open(os.path.join(OUT, 'QUELLEN.txt'), 'w', encoding='utf-8') as f:
        f.write('Bäume von Poly Haven – Lizenz CC0 (gemeinfrei), als Imposter gerendert mit werkstatt/baeume.py\n')
        f.write('\n'.join(f'{n}: https://polyhaven.com/a/{v["pid"]} (CC0)' for n, v in meta.items()) + '\n')


if __name__ == '__main__':
    sys.exit(main())
