// Alle Texturen werden zur Laufzeit auf Canvas gemalt – keine Bilddateien nötig.
import * as THREE from '../lib/three.module.min.js';
import { mulberry32, breathe } from './util.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function tex(c, repeat = true, aniso = 4) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  return t;
}
function noise(g, w, h, base, amp, rnd, size = 1) {
  const img = g.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * amp;
    img.data[i] = Math.max(0, Math.min(255, img.data[i] + n));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n));
  }
  g.putImageData(img, 0, 0);
}

// hi: höhere Auflösung (4-fach) der gemalten Texturen
export function makeTextures(aniso, hi = true) {
  const rnd = mulberry32(7), M = hi ? 4 : 2;
  const T = {};

  // Gelände-Detail (grau, wird mit Vertexfarbe multipliziert)
  {
    const [c, g] = canvas(256, 256);
    g.fillStyle = '#e6e6e6'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2600; i++) {
      const v = 200 + Math.floor(rnd() * 55);
      g.fillStyle = `rgba(${v},${v},${v},0.5)`;
      g.fillRect(rnd() * 256, rnd() * 256, 1 + rnd() * 3, 1 + rnd() * 3);
    }
    for (let i = 0; i < 500; i++) {
      g.fillStyle = `rgba(120,120,110,${0.08 + rnd() * 0.12})`;
      g.beginPath(); g.arc(rnd() * 256, rnd() * 256, 1 + rnd() * 6, 0, 7); g.fill();
    }
    noise(g, 256, 256, 0, 26, rnd);
    T.ground = tex(c, true, aniso);
  }
  // Asphalt mit Markierungen: u quer (0 = links, 1 = rechts), v längs (24 m je Kachel).
  // Hohe Auflösung: abgefahrene Ränder, Reifenspuren, Flickstellen, Teernähte (Körnung kommt aus dem Foto-Detail).
  {
    const W = 256 * M, H = 512 * M, [c, g] = canvas(W, H);
    g.fillStyle = '#3c3d41'; g.fillRect(0, 0, W, H);
    noise(g, W, H, 0, 14, rnd);
    // Reifenspuren je Fahrspur (etwas dunkler, glatter)
    for (const x of [0.2, 0.33, 0.67, 0.8]) { const gr = g.createLinearGradient(x * W - 22 * M, 0, x * W + 22 * M, 0); gr.addColorStop(0, 'rgba(20,20,24,0)'); gr.addColorStop(0.5, 'rgba(20,20,24,0.32)'); gr.addColorStop(1, 'rgba(20,20,24,0)'); g.fillStyle = gr; g.fillRect(x * W - 22 * M, 0, 44 * M, H); }
    // Flickstellen und Teernähte
    for (let i = 0; i < 4; i++) { const x = rnd() * W * 0.8 + W * 0.1, y = rnd() * H, w = (24 + rnd() * 40) * M, h = (30 + rnd() * 70) * M; g.fillStyle = `rgba(${rnd() < 0.5 ? '18,18,22' : '70,70,74'},${0.07 + rnd() * 0.08})`; g.fillRect(x - w / 2, y, w, h); g.strokeStyle = 'rgba(10,10,12,0.16)'; g.lineWidth = 1.2 * M; g.strokeRect(x - w / 2, y, w, h); }
    g.strokeStyle = 'rgba(12,12,14,0.32)'; g.lineCap = 'round';
    for (let i = 0; i < 14; i++) { let x = rnd() * W, y = rnd() * H; g.lineWidth = (0.8 + rnd()) * M; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 8; k++) { x += (rnd() - 0.5) * 30 * M; y += rnd() * 30 * M; g.lineTo(x, y); } g.stroke(); }
    // abgefahrene Markierung: viele kleine Stücke mit Lücken und weichen Rändern
    const paint = (x0, w, y0, y1, col, wear) => {
      for (let y = y0; y < y1; y += 3 * M) for (let x = x0; x < x0 + w; x += 3 * M) {
        if (rnd() < wear) continue;
        g.fillStyle = col.replace('A', (0.75 + rnd() * 0.25).toFixed(2)); g.fillRect(x, y, 3.4 * M, 3.4 * M);
      }
    };
    paint(8 * M, 7 * M, 0, H, 'rgba(236,236,228,A)', 0.07);
    paint(W - 15 * M, 7 * M, 0, H, 'rgba(236,236,228,A)', 0.07);
    for (let y = 0; y < H; y += 128 * M) paint(125 * M, 6 * M, y + 10 * M, y + 80 * M, 'rgba(244,196,52,A)', 0.1);
    T.asphalt = tex(c, true, aniso);
  }
  // Schotterpiste: Fahrspuren, Graskante, Pfützenflecken (Körnung und Steine kommen aus dem Foto-Detail)
  {
    const S = 256 * M, [c, g] = canvas(S, S);
    g.fillStyle = '#8a6d4a'; g.fillRect(0, 0, S, S);
    noise(g, S, S, 0, 36, rnd);
    for (const x of [0.27, 0.73]) { const gr = g.createLinearGradient(x * S - 26 * M, 0, x * S + 26 * M, 0); gr.addColorStop(0, 'rgba(60,40,25,0)'); gr.addColorStop(0.5, 'rgba(60,40,25,0.38)'); gr.addColorStop(1, 'rgba(60,40,25,0)'); g.fillStyle = gr; g.fillRect(x * S - 26 * M, 0, 52 * M, S); }
    for (let i = 0; i < 9; i++) { const x = rnd() * S, y = rnd() * S, r = (6 + rnd() * 18) * M; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(45,32,20,0.35)'); gr.addColorStop(1, 'rgba(45,32,20,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); }
    for (const [x0, x1] of [[0, 14 * M], [S - 14 * M, S]]) { const gr = g.createLinearGradient(x0, 0, x1, 0); const outer = x0 === 0; gr.addColorStop(outer ? 0 : 1, 'rgba(80,110,50,0.55)'); gr.addColorStop(outer ? 1 : 0, 'rgba(80,110,50,0)'); g.fillStyle = gr; g.fillRect(x0, 0, x1 - x0, S); }
    T.dirt = tex(c, true, aniso);
  }
  // Festival-Platz: Pflasterplatten, Ring, Stern, Schriftzug
  {
    const S = 512 * M, [c, g] = canvas(S, S), k = S / 512;
    g.fillStyle = '#35363c'; g.fillRect(0, 0, S, S);
    noise(g, S, S, 0, 16, rnd);
    g.strokeStyle = 'rgba(15,15,18,0.45)'; g.lineWidth = 1.2 * k;
    for (let x = 0; x <= S; x += 32 * k) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, S); g.stroke(); }
    for (let y = 0; y <= S; y += 32 * k) { g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke(); }
    for (let i = 0; i < 120; i++) { g.fillStyle = `rgba(${rnd() < 0.5 ? '255,255,255' : '0,0,0'},${0.03 + rnd() * 0.05})`; g.fillRect(Math.floor(rnd() * 16) * 32 * k, Math.floor(rnd() * 16) * 32 * k, 32 * k, 32 * k); }
    g.translate(S / 2, S / 2);
    g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 8 * k;
    g.beginPath(); g.arc(0, 0, 200 * k, 0, 7); g.stroke();
    g.lineWidth = 2.5 * k; g.beginPath(); g.arc(0, 0, 214 * k, 0, 7); g.stroke();
    g.fillStyle = '#ff3d7f'; star(g, 0, 0, 150 * k, 62 * k, 5); g.fill();
    g.fillStyle = '#ffd23f'; star(g, 0, 0, 90 * k, 38 * k, 5); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.9)'; g.font = `bold italic ${22 * k}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    const txt = 'NOVA ✦ FESTIVAL DER SONNENKÜSTE ✦ ';
    for (let i = 0; i < txt.length; i++) { const a = i / txt.length * Math.PI * 2; g.save(); g.rotate(a); g.fillText(txt[i], 0, -232 * k); g.restore(); }
    g.setTransform(1, 0, 0, 1, 0, 0);
    T.plaza = tex(c, false, aniso);
  }
  // Fassade (2×2 Fenster je Kachel): Rahmen, Sprossen, Glas mit Himmelsspiegelung, Gardinen, Fensterbänke
  // + Leucht-Fenster für die Nacht
  {
    const S = 128 * M, k = S / 128, [c, g] = canvas(S, S), [e, ge] = canvas(S, S);
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, S, S);
    noise(g, S, S, 0, 10, rnd);
    for (let i = 0; i < 40 * M; i++) { g.fillStyle = `rgba(120,110,100,${0.03 + rnd() * 0.05})`; g.fillRect(rnd() * S, rnd() * S, (2 + rnd() * 8) * k, (1 + rnd() * 3) * k); }
    ge.fillStyle = '#000'; ge.fillRect(0, 0, S, S);
    const curtains = ['#d9cbb0', '#c9d6e0', '#e6d2d2', '#d8e2c8', '#efe6d2'];
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
      const px = (x * 64 + 16) * k, py = (y * 64 + 14) * k, w = 32 * k, h = 38 * k;
      g.fillStyle = '#e9e6de'; g.fillRect(px - 3 * k, py - 3 * k, w + 6 * k, h + 6 * k); // Laibung
      const sky = g.createLinearGradient(px, py, px + w, py + h); sky.addColorStop(0, '#5d7fa0'); sky.addColorStop(0.45, '#2a3a4a'); sky.addColorStop(1, '#1b2632');
      g.fillStyle = sky; g.fillRect(px, py, w, h);
      g.fillStyle = 'rgba(190,225,255,0.28)'; g.beginPath(); g.moveTo(px, py + h * 0.55); g.lineTo(px + w * 0.45, py); g.lineTo(px + w * 0.62, py); g.lineTo(px, py + h * 0.82); g.fill(); // Spiegelung
      const cur = curtains[Math.floor(rnd() * curtains.length)];
      if (rnd() < 0.7) { g.fillStyle = cur; g.globalAlpha = 0.85; g.fillRect(px, py, w * 0.22, h); g.fillRect(px + w * 0.78, py, w * 0.22, h); g.globalAlpha = 1; }
      g.fillStyle = '#f4f2ec'; g.fillRect(px + w / 2 - 1.2 * k, py, 2.4 * k, h); g.fillRect(px, py + h * 0.42, w, 2.2 * k); // Sprossen
      g.strokeStyle = '#f7f5ef'; g.lineWidth = 2.2 * k; g.strokeRect(px, py, w, h);
      g.fillStyle = '#cfcac0'; g.fillRect(px - 4 * k, py + h + 1 * k, w + 8 * k, 4 * k); g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(px - 4 * k, py + h + 5 * k, w + 8 * k, 2 * k); // Fensterbank
      if (rnd() < 0.55) {
        const warm = rnd() < 0.5 ? [255, 207, 122] : [255, 241, 201];
        const gl = ge.createLinearGradient(px, py, px, py + h); gl.addColorStop(0, `rgb(${warm.map(v => Math.round(v * 0.75)).join(',')})`); gl.addColorStop(1, `rgb(${warm.join(',')})`);
        ge.fillStyle = gl; ge.fillRect(px, py, w, h);
        ge.fillStyle = 'rgba(0,0,0,0.55)'; ge.fillRect(px + w / 2 - 1.2 * k, py, 2.4 * k, h); ge.fillRect(px, py + h * 0.42, w, 2.2 * k);
        if (rnd() < 0.6) { ge.fillStyle = 'rgba(0,0,0,0.35)'; ge.fillRect(px, py, w * 0.22, h); ge.fillRect(px + w * 0.78, py, w * 0.22, h); }
      }
    }
    T.facade = tex(c, true, aniso);
    T.facadeGlow = tex(e, true, aniso);
  }
  // Plakat (Sammelobjekt): Verlauf, Stern, Schrift, Rahmen – scharf auch aus der Nähe
  {
    const W = 256 * M, H = 128 * M, k = W / 256, [c, g] = canvas(W, H);
    const gr = g.createLinearGradient(0, 0, W, H);
    gr.addColorStop(0, '#ff3d7f'); gr.addColorStop(0.5, '#7a3dff'); gr.addColorStop(1, '#1fd1ff');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 18; i++) { g.strokeStyle = `rgba(255,255,255,${0.04 + rnd() * 0.06})`; g.lineWidth = (2 + rnd() * 6) * k; g.beginPath(); g.moveTo(rnd() * W, 0); g.lineTo(rnd() * W, H); g.stroke(); }
    g.shadowColor = 'rgba(0,0,0,0.35)'; g.shadowBlur = 6 * k;
    g.fillStyle = '#ffd23f'; star(g, 52 * k, 64 * k, 40 * k, 17 * k, 5); g.fill();
    g.fillStyle = '#fff'; g.font = `bold italic ${34 * k}px sans-serif`; g.fillText('NOVA', 100 * k, 58 * k);
    g.font = `bold ${20 * k}px sans-serif`; g.fillText('FESTIVAL', 102 * k, 88 * k);
    g.font = `${9 * k}px sans-serif`; g.globalAlpha = 0.85; g.fillText('SONNENKÜSTE · LIVE · RENNEN', 102 * k, 106 * k); g.globalAlpha = 1;
    g.shadowBlur = 0;
    g.strokeStyle = '#fff'; g.lineWidth = 6 * k; g.strokeRect(3 * k, 3 * k, W - 6 * k, H - 6 * k);
    T.poster = tex(c, false, aniso);
  }
  // Banner für den Torbogen
  {
    const W = 1024 * Math.min(M, 2), H = 128 * Math.min(M, 2), k = W / 1024, [c, g] = canvas(W, H);
    const gr = g.createLinearGradient(0, 0, W, 0);
    gr.addColorStop(0, '#ff3d7f'); gr.addColorStop(0.5, '#ff8a00'); gr.addColorStop(1, '#7a3dff');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,0.08)'; for (let x = 0; x < W; x += 24 * k) g.fillRect(x, 0, 12 * k, H);
    g.fillStyle = '#fff'; g.font = `bold italic ${88 * k}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = 'rgba(0,0,0,0.4)'; g.shadowBlur = 8 * k;
    g.fillText('NOVA ✦ FESTIVAL', W / 2, 68 * k);
    T.banner = tex(c, false, aniso);
  }
  // Warnstreifen für Schanzen (mit Abrieb)
  {
    const S = 128 * M, k = S / 128, [c, g] = canvas(S, S);
    g.fillStyle = '#ffcc00'; g.fillRect(0, 0, S, S);
    g.fillStyle = '#1a1a1a';
    for (let i = -S; i < 2 * S; i += 32 * k) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 16 * k, 0); g.lineTo(i + 16 * k + S, S); g.lineTo(i + S, S); g.fill(); }
    noise(g, S, S, 0, 26, rnd);
    for (let i = 0; i < 60 * M; i++) { g.fillStyle = `rgba(90,80,60,${0.1 + rnd() * 0.2})`; g.fillRect(rnd() * S, rnd() * S, (1 + rnd() * 5) * k, (1 + rnd() * 2) * k); }
    T.stripes = tex(c, true, aniso);
  }
  // Zeltstoff: Bahnen mit Nähten und leichter Faltenschattierung
  {
    const W = 256 * M, H = 32 * M, k = W / 256, [c, g] = canvas(W, H);
    for (let i = 0; i < 16; i++) {
      const gr = g.createLinearGradient(i * 16 * k, 0, (i + 1) * 16 * k, 0);
      const base = i % 2 ? [255, 255, 255] : [255, 61, 127];
      gr.addColorStop(0, `rgb(${base.map(v => Math.round(v * 0.86)).join(',')})`); gr.addColorStop(0.5, `rgb(${base.join(',')})`); gr.addColorStop(1, `rgb(${base.map(v => Math.round(v * 0.9)).join(',')})`);
      g.fillStyle = gr; g.fillRect(i * 16 * k, 0, 16 * k, H);
      g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(i * 16 * k, 0, 0.8 * k, H);
    }
    noise(g, W, H, 0, 8, rnd);
    T.tent = tex(c, true, aniso);
  }
  // weiche runde Flecken: Rauch, Schatten, Glühen
  T.puff = radial(64, [[0, 'rgba(255,255,255,1)'], [0.45, 'rgba(255,255,255,0.55)'], [1, 'rgba(255,255,255,0)']]);
  T.blob = radial(64, [[0, 'rgba(0,0,0,0.7)'], [0.6, 'rgba(0,0,0,0.45)'], [1, 'rgba(0,0,0,0)']]);
  T.glow = radial(64, [[0, 'rgba(255,255,255,1)'], [0.2, 'rgba(255,255,255,0.7)'], [1, 'rgba(255,255,255,0)']]);
  // Lichtsäule (vertikaler Verlauf)
  {
    const [c, g] = canvas(4, 128);
    const gr = g.createLinearGradient(0, 128, 0, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.15, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 4, 128);
    T.beam = tex(c, false, 1);
  }
  // Wolke
  {
    const [c, g] = canvas(256, 128);
    for (let i = 0; i < 26; i++) {
      const x = 40 + rnd() * 176, y = 50 + rnd() * 40 - Math.abs(x - 128) * 0.12, r = 18 + rnd() * 30;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    T.cloud = tex(c, false, 1);
  }
  // LED-Wand der Bühne (wird animiert)
  {
    const [c, g] = canvas(256, 128);
    T.ledCanvas = c; T.ledCtx = g;
    T.led = tex(c, false, 1);
  }
  return T;
}

// Echte Foto-Oberflächen (Poly Haven, CC0) aus models/tex – aufbereitet von werkstatt/texturen.py.
// _d = Detail (Mittel 50 %, wird mit der Bodenfarbe multipliziert), _n = Normal-Map (OpenGL).
export const PHOTO_SETS = ['grass', 'rock', 'sand', 'asphalt', 'gravel', 'forest', 'wall'];
// hd = 2K-Texturen + Rauheit aus models/tex-hd (HD-Paket); fehlt etwas, wird die 1K-Fassung genommen.
export async function loadPhotoTextures(T, aniso, url = p => p, prog = () => {}, hd = false) {
  const L = new THREE.TextureLoader();
  const flat = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1, THREE.RGBAFormat);
  flat.needsUpdate = true;
  T.flatN = flat;
  const grey = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1, THREE.RGBAFormat);
  grey.needsUpdate = true;
  T.flatR = grey;
  T.photo = {}; T.photoHD = hd;
  const keys = hd ? ['d', 'n', 'r'] : ['d', 'n'];
  let done = 0;
  const load = (n, k, dir) => L.loadAsync(url(`${dir}/${n}_${k}.webp`)).then(t => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = aniso;
    if (k === 'd') t.colorSpace = THREE.SRGBColorSpace;
    T.photo[`${n}_${k}`] = t;
  });
  const jobs = PHOTO_SETS.flatMap(n => keys.map(k => (hd ? load(n, k, 'models/tex-hd').catch(() => k === 'r' ? null : load(n, k, 'models/tex')) : load(n, k, 'models/tex'))
    .catch(e => console.warn('Foto-Textur fehlt', n, k, e)).finally(() => prog(++done / (PHOTO_SETS.length * keys.length)))));
  await Promise.all(jobs);
}

// Fotografierte Bäume als Imposter (werkstatt/baeume.py): Farb- und Normalen-Atlas je Baum + Maße (baeume.json)
export async function loadTreeImpostors(T, aniso, url = p => p) {
  T.trees = {};
  let meta;
  try { meta = await (await fetch(url('models/baum/baeume.json'))).json(); } catch { return; }
  const L = new THREE.TextureLoader();
  await Promise.all(Object.entries(meta).map(async ([name, info]) => {
    try {
      const [c, n] = await Promise.all(['c', 'n'].map(k => L.loadAsync(url(`models/baum/${name}_${k}.webp`))));
      c.colorSpace = THREE.SRGBColorSpace; c.anisotropy = aniso;
      for (const t of [c, n]) { t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; }
      T.trees[name] = { info, c, n };
    } catch (e) { console.warn('Baum fehlt', name, e); }
  }));
}

// Wolkenrauschen + Bodendetails (nahtlos kachelbar); hi = doppelte Auflösung
export async function makeDetailTextures(T, aniso, hi, prog = () => {}) {
  const rnd = mulberry32(99), S = hi ? 1024 : 512;
  T.noise = noiseTexture(256, rnd); prog(0.1); await breathe(0);
  T.dGrass = detailGrass(S, rnd, aniso); prog(0.45); await breathe(0);
  T.dRock = detailRock(S, rnd, aniso); prog(0.75); await breathe(0);
  T.dSand = detailSand(S, rnd, aniso); prog(1); await breathe(0);
}

// kachelbares Wertrauschen (mehrere Oktaven) als Float-Feld 0…1
function tileNoise(size, octaves, rnd) {
  const out = new Float32Array(size * size);
  let amp = 1, total = 0;
  for (const cells of octaves) {
    const lat = Array.from({ length: cells * cells }, () => rnd());
    const v = (i, j) => lat[((j % cells + cells) % cells) * cells + ((i % cells + cells) % cells)];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const fx = x / size * cells, fy = y / size * cells, i = Math.floor(fx), j = Math.floor(fy);
      let u = fx - i, w = fy - j; u = u * u * (3 - 2 * u); w = w * w * (3 - 2 * w);
      const a = v(i, j) + (v(i + 1, j) - v(i, j)) * u, b = v(i, j + 1) + (v(i + 1, j + 1) - v(i, j + 1)) * u;
      out[y * size + x] += (a + (b - a) * w) * amp;
    }
    total += amp; amp *= 0.5;
  }
  for (let k = 0; k < out.length; k++) out[k] /= total;
  return out;
}
function noiseTexture(size, rnd) {
  const n = tileNoise(size, [8, 16, 32], rnd), d = new Uint8Array(size * size * 4);
  for (let k = 0; k < n.length; k++) { const v = Math.round(n[k] * 255); d[k * 4] = d[k * 4 + 1] = d[k * 4 + 2] = v; d[k * 4 + 3] = 255; }
  const t = new THREE.DataTexture(d, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}
function fieldCanvas(size, field, lo, hi, tint) {
  const [c, g] = canvas(size, size), img = g.createImageData(size, size);
  for (let k = 0; k < size * size; k++) {
    const v = lo + (hi - lo) * field[k];
    img.data[k * 4] = Math.min(255, v * tint[0]); img.data[k * 4 + 1] = Math.min(255, v * tint[1]); img.data[k * 4 + 2] = Math.min(255, v * tint[2]); img.data[k * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return [c, g];
}
// zeichnet mit Umbruch an den Rändern (für nahtlose Kacheln)
function wrapDraw(g, size, x, y, fn) { for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) fn(x + ox, y + oy); }
function detailGrass(size, rnd, aniso) {
  const [c, g] = fieldCanvas(size, tileNoise(size, [4, 16, 64], rnd), 95, 160, [1, 1.04, 0.92]);
  g.lineCap = 'round';
  const k2 = (size / 512) ** 2;
  for (let i = 0; i < 9000 * k2; i++) {
    const x = rnd() * size, y = rnd() * size, a = -Math.PI / 2 + (rnd() - 0.5) * 1.4, L = 3 + rnd() * 9;
    const v = rnd() < 0.5 ? 70 + rnd() * 50 : 160 + rnd() * 70;
    g.strokeStyle = `rgba(${v * 0.95},${v},${v * 0.85},${0.35 + rnd() * 0.4})`; g.lineWidth = 0.8 + rnd() * 1.2;
    wrapDraw(g, size, x, y, (px, py) => { if (px < -12 || py < -12 || px > size + 12 || py > size + 12) return; g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(a) * L, py + Math.sin(a) * L); g.stroke(); });
  }
  for (let i = 0; i < 260 * k2; i++) {
    const x = rnd() * size, y = rnd() * size, r = 4 + rnd() * 14;
    g.fillStyle = `rgba(60,55,40,${0.06 + rnd() * 0.08})`;
    wrapDraw(g, size, x, y, (px, py) => { g.beginPath(); g.arc(px, py, r, 0, 7); g.fill(); });
  }
  return tex(c, true, aniso);
}
function detailRock(size, rnd, aniso) {
  const [c, g] = fieldCanvas(size, tileNoise(size, [4, 8, 32, 128], rnd), 70, 185, [1, 0.98, 0.95]);
  for (let i = 0; i < 70 * (size / 512) ** 2; i++) {
    let x = rnd() * size, y = rnd() * size, a = rnd() * 6.28;
    g.strokeStyle = `rgba(25,22,20,${0.25 + rnd() * 0.35})`; g.lineWidth = 0.8 + rnd() * 1.6;
    const pts = [[x, y]];
    for (let k = 0; k < 14; k++) { a += (rnd() - 0.5) * 0.9; x += Math.cos(a) * (6 + rnd() * 10); y += Math.sin(a) * (6 + rnd() * 10); pts.push([x, y]); }
    for (const [ox, oy] of [[-size, 0], [0, 0], [size, 0], [0, -size], [0, size], [-size, -size], [size, size], [size, -size], [-size, size]]) {
      g.beginPath(); pts.forEach(([px, py], k) => k ? g.lineTo(px + ox, py + oy) : g.moveTo(px + ox, py + oy)); g.stroke();
    }
  }
  return tex(c, true, aniso);
}
function detailSand(size, rnd, aniso) {
  const n = tileNoise(size, [4, 8], rnd), grain = tileNoise(size, [128, 256], rnd), f = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const k = y * size + x;
    const r = Math.sin((y / size * 18 + n[k] * 3.2) * Math.PI * 2) * 0.5 + 0.5;
    f[k] = r * 0.45 + grain[k] * 0.4 + n[k] * 0.15;
  }
  const [c] = fieldCanvas(size, f, 105, 175, [1.02, 1, 0.94]);
  return tex(c, true, aniso);
}

function radial(s, stops) {
  const [c, g] = canvas(s, s);
  const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  for (const [o, col] of stops) gr.addColorStop(o, col);
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  return t;
}

export function star(g, x, y, R, r, n) {
  g.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + i * Math.PI / n, rr = i % 2 ? r : R;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
}

export function drawLed(T, t, beat) {
  const g = T.ledCtx;
  g.fillStyle = '#05010f'; g.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 32; i++) {
    const h = (Math.sin(t * 3 + i * 0.6) * 0.5 + 0.5) * (0.4 + 0.6 * beat) * 110 + 6;
    const hue = (i * 11 + t * 60) % 360;
    g.fillStyle = `hsl(${hue},100%,60%)`;
    g.fillRect(i * 8 + 1, 124 - h, 6, h);
  }
  g.fillStyle = '#fff'; g.font = 'bold italic 30px sans-serif'; g.textAlign = 'center';
  g.globalAlpha = 0.85; g.fillText('NOVA', 128, 46 + Math.sin(t * 2) * 4); g.globalAlpha = 1;
  T.led.needsUpdate = true;
}
