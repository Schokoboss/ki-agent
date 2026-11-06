"""Fotografierte Felsen von Poly Haven (CC0, gemeinfrei) als spieltaugliche Weltmodelle.

Lädt die Modelle, reduziert sie in Blender auf ~1000 Dreiecke (das Relief kommt aus der Normal-Map),
verkleinert die Fototexturen auf 512 px und speichert models/welt/prock_*.glb.
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

# Spielname: (Poly-Haven-ID, Objekt im Set oder None = alle, Ziel-Dreiecke)
ROCKS = {
    'prock_a': ('boulder_01', None, 1100),
    'prock_b': ('namaqualand_boulder_02', None, 1100),
    'prock_c': ('rock_moss_set_01', 'largest', 900),
}
WIDTH = 2.2   # größte waagerechte Ausdehnung in Metern (wie die alten Felsen)
TEX = 512
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


def build(name, pid, pick, target, tmp):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=download(pid, tmp))
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    if pick == 'largest':
        def vol(o):
            mn, mx = bbox(o)
            d = mx - mn
            return d.x * d.y * d.z
        keep = max(meshes, key=vol)
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
    # Größe & Lage: Boden bei z = -0.08, Mitte im Ursprung, größte Breite = WIDTH
    mn, mx = bbox(o)
    k = WIDTH / max(mx.x - mn.x, mx.y - mn.y)
    c = (mn + mx) / 2
    o.location = (-c.x * k, -c.y * k, -mn.z * k - 0.08)
    o.scale = (k, k, k)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    o.name = name
    # Material: Farbe + Normal-Map behalten, AO/Rauheit-Bild weglassen (spart Platz), Bilder verkleinern
    for m in o.data.materials:
        m.name = 'rock'
        nt = m.node_tree
        bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        for n in list(nt.nodes):
            if n.type == 'TEX_IMAGE' and n.image:
                nm = n.image.name.lower()
                if '_arm' in nm or '_rough' in nm or 'ao' in nm.split('_')[-2:]:
                    nt.nodes.remove(n)
                    continue
                n.image.scale(TEX, TEX)
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
    print(f'{name}: {pid} {n0} → {tris(o)} Dreiecke, {os.path.getsize(path) // 1024} KB')
    return f'{name}: https://polyhaven.com/a/{pid} (CC0)'


def main():
    os.makedirs(OUT, exist_ok=True)
    credits = []
    with tempfile.TemporaryDirectory() as tmp:
        for name, (pid, pick, target) in ROCKS.items():
            sub = os.path.join(tmp, pid)
            os.makedirs(sub, exist_ok=True)
            credits.append(build(name, pid, pick, target, sub))
    with open(os.path.join(OUT, 'QUELLEN.txt'), 'w', encoding='utf-8') as f:
        f.write('prock_*: fotografierte Felsen von Poly Haven – Lizenz CC0 (gemeinfrei), aufbereitet mit werkstatt/felsen.py\n')
        f.write('\n'.join(credits) + '\n')


if __name__ == '__main__':
    sys.exit(main())
