"""Lädt echte Foto-Oberflächen von Poly Haven (CC0, gemeinfrei) und bereitet sie fürs Spiel auf.

Aufruf (im Ordner app/spiele/nova-drive):  python werkstatt/texturen.py        (1K, Standard)
                                            python werkstatt/texturen.py --hd   (2K + Rauheit → models/tex-hd)
Ergebnis: models/tex/<name>_d.webp (Detail, Mittelwert 50 % – wird mit der Bodenfarbe multipliziert)
          models/tex/<name>_n.webp (Normal-Map, OpenGL-Konvention) für Licht und Schatten im Relief.
Braucht: Pillow, numpy, Internet (api.polyhaven.com, dl.polyhaven.org).
"""
import io
import json
import os
import sys
import urllib.request

import numpy as np
from PIL import Image

# Spielname: (Poly-Haven-ID, Farbanteil 0…1, Kontrast, Kantenlänge in Pixeln)
SETS = {
    'grass': ('grass_ground', 0.75, 1.15, 1024),
    'rock': ('rock_face_03', 0.55, 1.0, 1024),
    'sand': ('sand_01', 0.6, 1.1, 1024),
    'asphalt': ('asphalt_track', 0.2, 1.3, 512),
    'gravel': ('rocky_trail_02', 0.6, 1.1, 1024),
}
HD = '--hd' in sys.argv
RES = '2k' if HD else '1k'
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'models', 'tex-hd' if HD else 'tex')


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'NovaDrive-Werkstatt'})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def detail(img, color_share, contrast):
    a = np.asarray(img.convert('RGB'), dtype=np.float32) / 255.0
    mean = a.reshape(-1, 3).mean(0)
    lum = (a @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32))[..., None]
    lmean = float(lum.mean())
    col = a / mean  # Farbe relativ zum Mittel (Mittel = 1)
    gray = np.repeat(lum / lmean, 3, axis=2)
    rel = gray * (1 - color_share) + col * color_share
    rel = 1 + (rel - 1) * contrast
    out = np.clip(rel * 0.5, 0, 1)
    return Image.fromarray((out * 255 + 0.5).astype(np.uint8))


def main():
    os.makedirs(OUT, exist_ok=True)
    credits = []
    for name, (pid, share, contrast, size) in SETS.items():
        if HD:
            size = min(2048, size * 2)
        files = json.loads(get(f'https://api.polyhaven.com/files/{pid}'))
        diff = Image.open(io.BytesIO(get(files['Diffuse'][RES]['jpg']['url'])))
        nor = Image.open(io.BytesIO(get(files['nor_gl'][RES]['jpg']['url']))).convert('RGB')
        if diff.width != size:
            diff = diff.resize((size, size), Image.LANCZOS)
            nor = nor.resize((size, size), Image.LANCZOS)
        if HD:  # Rauheit (eigene Karte oder Grünkanal der AO/Rauheit/Metall-Karte), Mittel auf 50 % normiert
            if 'Rough' in files:
                rough = Image.open(io.BytesIO(get(files['Rough'][RES]['jpg']['url']))).convert('L')
            else:
                rough = Image.open(io.BytesIO(get(files['arm'][RES]['jpg']['url']))).convert('RGB').split()[1]
            r = np.asarray(rough.resize((size // 2, size // 2), Image.LANCZOS), dtype=np.float32) / 255.0
            r = np.clip(r / max(1e-3, float(r.mean())) * 0.5, 0, 1)
            Image.fromarray((r * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, f'{name}_r.webp'), quality=80, method=6)
        detail(diff, share, contrast).save(os.path.join(OUT, f'{name}_d.webp'), quality=82, method=6)
        nor.save(os.path.join(OUT, f'{name}_n.webp'), quality=86, method=6)
        credits.append(f'{name}: https://polyhaven.com/a/{pid} (CC0)')
        print(name, '←', pid)
    with open(os.path.join(OUT, 'QUELLEN.txt'), 'w', encoding='utf-8') as f:
        f.write('Foto-Texturen von Poly Haven – Lizenz CC0 (gemeinfrei), aufbereitet mit werkstatt/texturen.py\n')
        f.write('\n'.join(credits) + '\n')


if __name__ == '__main__':
    sys.exit(main())
