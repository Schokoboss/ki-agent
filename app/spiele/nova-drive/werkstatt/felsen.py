"""Fotografierte Felsen, Pflanzen und Holz von Poly Haven (CC0, gemeinfrei) als spieltaugliche Weltmodelle.

Lädt die Modelle, reduziert sie in Blender (das Relief kommt aus der Normal-Map), verkleinert die
Fototexturen und speichert models/welt/prock_*.glb (Felsen) und models/welt/pv_*.glb (Farne, Büsche, Holz).
Nur einzelne bauen:  python werkstatt/felsen.py pv_fern pv_log
Aufruf (im Ordner app/spiele/nova-drive):  python werkstatt/felsen.py
danach komprimieren wie die anderen Modelle:  gltf-transform meshopt <datei> <datei>
Braucht: bpy (pip install bpy) und Internet (api.polyhaven.com, dl.polyhaven.org).
"""
import json
import os
import sys
import tempfile
import urllib.request

import bpy  # zuerst: macht mathutils verfügbar
from mathutils import Vector

# Spielname: (Poly-Haven-ID, Objekt im Set oder None = alle, Ziel-Dreiecke, Breite in m oder None = echte Größe, Texturgröße)
ROCKS = {
    'prock_a': ('boulder_01', None, 1100, 2.2, 1024),
    'prock_b': ('namaqualand_boulder_02', None, 1100, 2.2, 1024),
    'prock_c': ('rock_moss_set_01', 'largest', 900, 2.2, 1024),
    'prock_d': ('rock_moss_set_02', 'largest', 900, 2.2, 1024),
    'prock_e': ('namaqualand_boulder_04', None, 1100, 2.2, 1024),
    # Pflanzen & Holz in echter Größe (Meter)
    # Pflanzen-Dateien enthalten mehrere Varianten nebeneinander → einzeln herauslösen (größte, zweitgrößte)
    'pv_fern': ('fern_02', 'largest', 3000, None, 1024),
    'pv_fern_b': ('fern_02', 'second', 3000, None, 1024),
    'pv_shrub_a': ('shrub_03', 'largest', 4000, None, 1024),
    'pv_shrub_b': ('shrub_04', 'largest', 5000, None, 1024),
    'pv_stump': ('tree_stump_01', None, 1600, None, 1024),
    'pv_log': ('dead_tree_trunk', None, 2400, None, 1024),
}
ONLY = [a for a in sys.argv[1:] if not a.startswith('-')]
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'models', 'welt')


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'NovaDrive-Werkstatt'})
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.read()


def download(pid, folder):
    files = json.loads(get(f'https://api.polyhaven.com/files/{pid}'))
    g = files['gltf']['1k']['gltf']
    main = os.path.join(folder, os.path.basename(g['url']))
    with open(main, 'wb') as f:
        f.write(get(g['url']))
    for path, info in g.get('include', {}).items():
        p = os.path.join(folder, path)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, 'wb') as f:
            f.write(get(info['url']))
    return main


def tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def bbox(o):
    pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
    mn = Vector([min(p[i] for p in pts) for i in range(3)])
    mx = Vector([max(p[i] for p in pts) for i in range(3)])
    return mn, mx


def build(name, pid, pick, target, width, tex, tmp):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=download(pid, tmp))
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    if pick in ('largest', 'second'):
        def vol(o):
            mn, mx = bbox(o)
            d = mx - mn
            return d.x * d.y * d.z
        order = sorted(meshes, key=vol, reverse=True)
        keep = order[1] if pick == 'second' and len(order) > 1 else order[0]
        for o in meshes:
            if o is not keep:
                bpy.data.objects.remove(o, do_unlink=True)
        meshes = [keep]
    # alles zu einem Objekt, Transformationen anwenden
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.parent = None
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # getrennte Naht-Punkte des glTF-Imports verschmelzen, sonst kann Blender kaum reduzieren
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=0.0005)
    bpy.ops.object.mode_set(mode='OBJECT')
    # reduzieren
    n0 = tris(o)
    if n0 > target:
        d = o.modifiers.new('dec', 'DECIMATE')
        d.decimate_type = 'COLLAPSE'
        d.ratio = target / n0
        d.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=d.name)
    for p in o.data.polygons:
        p.use_smooth = True
    # Größe & Lage: Boden bei z = -0.08 (Felsen) bzw. 0 (Pflanzen), Mitte im Ursprung, Felsen auf Breite normiert
    mn, mx = bbox(o)
    k = width / max(mx.x - mn.x, mx.y - mn.y) if width else 1.0
    c = (mn + mx) / 2
    o.location = (-c.x * k, -c.y * k, -mn.z * k - (0.08 if width else 0.02))
    o.scale = (k, k, k)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    o.name = name
    # Material: Farbe + Normal-Map behalten, AO/Rauheit-Bild weglassen (spart Platz), Bilder verkleinern
    for m in o.data.materials:
        m.name = 'rock' if name.startswith('prock') else 'plant'
        nt = m.node_tree
        bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        for n in list(nt.nodes):
            if n.type == 'TEX_IMAGE' and n.image:
                nm = n.image.name.lower()
                if '_arm' in nm or '_rough' in nm or 'ao' in nm.split('_')[-2:]:
                    nt.nodes.remove(n)
                    continue
                n.image.scale(tex, tex)
        if bsdf:
            bsdf.inputs['Roughness'].default_value = 0.9
            bsdf.inputs['Metallic'].default_value = 0.0
        for n in list(nt.nodes):
            if n.type == 'GROUP' and n.node_tree and 'gltf' in n.node_tree.name.lower():
                nt.nodes.remove(n)  # Occlusion-Ausgang
    path = os.path.join(OUT, name + '.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=False, export_apply=True,
                              export_image_format='WEBP', export_image_quality=82, export_texcoords=True,
                              export_normals=True, export_materials='EXPORT', export_cameras=False,
                              export_lights=False, export_extras=False)
    mn, mx = bbox(o)
    d = mx - mn
    print(f'{name}: {pid} {n0} → {tris(o)} Dreiecke, {os.path.getsize(path) // 1024} KB, Maße {d.x:.2f} × {d.y:.2f} × {d.z:.2f} m')
    return f'{name}: https://polyhaven.com/a/{pid} (CC0)'


def main():
    os.makedirs(OUT, exist_ok=True)
    credits = []
    with tempfile.TemporaryDirectory() as tmp:
        for name, (pid, pick, target, width, tex) in ROCKS.items():
            if ONLY and name not in ONLY:
                continue
            sub = os.path.join(tmp, pid)
            os.makedirs(sub, exist_ok=True)
            credits.append(build(name, pid, pick, target, width, tex, sub))
    with open(os.path.join(OUT, 'QUELLEN.txt'), 'w', encoding='utf-8') as f:
        f.write('prock_* / pv_*: fotografierte Felsen, Pflanzen und Holz von Poly Haven – Lizenz CC0 (gemeinfrei),\n')
        f.write('aufbereitet mit werkstatt/felsen.py\n')
        f.write('\n'.join(f'{n}: https://polyhaven.com/a/{v[0]} (CC0)' for n, v in ROCKS.items()) + '\n')


if __name__ == '__main__':
    sys.exit(main())
