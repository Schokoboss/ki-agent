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

export function makeTextures(aniso) {
  const rnd = mulberry32(7);
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
  // Asphalt mit Markierungen: u quer (0 = links, 1 = rechts), v längs
  {
    const [c, g] = canvas(256, 512);
    g.fillStyle = '#3b3c40'; g.fillRect(0, 0, 256, 512);
    noise(g, 256, 512, 0, 30, rnd);
    for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(0,0,0,${rnd() * 0.12})`; g.fillRect(rnd() * 256, rnd() * 512, 2 + rnd() * 10, 2 + rnd() * 30); }
    g.fillStyle = 'rgba(25,25,28,0.35)'; g.fillRect(56, 0, 40, 512); g.fillRect(160, 0, 40, 512); // Fahrspuren
    g.fillStyle = '#e9e9e2'; g.fillRect(8, 0, 7, 512); g.fillRect(241, 0, 7, 512);
    g.fillStyle = '#f2c230'; for (let y = 0; y < 512; y += 128) g.fillRect(125, y + 10, 6, 70);
    T.asphalt = tex(c, true, aniso);
  }
  // Schotterpiste
  {
    const [c, g] = canvas(256, 256);
    g.fillStyle = '#8a6d4a'; g.fillRect(0, 0, 256, 256);
    noise(g, 256, 256, 0, 50, rnd);
    for (let i = 0; i < 900; i++) { const v = 90 + rnd() * 90; g.fillStyle = `rgba(${v},${v * 0.85},${v * 0.65},0.6)`; g.fillRect(rnd() * 256, rnd() * 256, 2, 2); }
    g.fillStyle = 'rgba(60,40,25,0.28)'; g.fillRect(48, 0, 46, 256); g.fillRect(162, 0, 46, 256);
    g.fillStyle = 'rgba(80,110,50,0.35)'; g.fillRect(0, 0, 10, 256); g.fillRect(246, 0, 10, 256);
    T.dirt = tex(c, true, aniso);
  }
  // Festival-Platz mit Stern
  {
    const [c, g] = canvas(512, 512);
    g.fillStyle = '#34353b'; g.fillRect(0, 0, 512, 512);
    noise(g, 512, 512, 0, 22, rnd);
    g.translate(256, 256);
    g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 8;
    g.beginPath(); g.arc(0, 0, 200, 0, 7); g.stroke();
    g.fillStyle = '#ff3d7f';
    star(g, 0, 0, 150, 62, 5); g.fill();
    g.fillStyle = '#ffd23f'; star(g, 0, 0, 90, 38, 5); g.fill();
    g.setTransform(1, 0, 0, 1, 0, 0);
    T.plaza = tex(c, false, aniso);
  }
  // Fassade (Fenster) + Leucht-Fenster für die Nacht
  {
    const [c, g] = canvas(128, 128), [e, ge] = canvas(128, 128);
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 128);
    noise(g, 128, 128, 0, 14, rnd);
    ge.fillStyle = '#000'; ge.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
      const px = x * 64 + 16, py = y * 64 + 14;
      g.fillStyle = '#2a3a4a'; g.fillRect(px, py, 32, 38);
      g.fillStyle = 'rgba(150,200,255,0.35)'; g.fillRect(px + 2, py + 2, 12, 34);
      g.fillStyle = '#d8d8d0'; g.fillRect(px - 3, py + 38, 38, 5);
      if (rnd() < 0.55) { ge.fillStyle = rnd() < 0.5 ? '#ffcf7a' : '#fff1c9'; ge.fillRect(px, py, 32, 38); }
    }
    T.facade = tex(c, true, aniso);
    T.facadeGlow = tex(e, true, aniso);
  }
  // Plakat (Sammelobjekt)
  {
    const [c, g] = canvas(256, 128);
    const gr = g.createLinearGradient(0, 0, 256, 128);
    gr.addColorStop(0, '#ff3d7f'); gr.addColorStop(0.5, '#7a3dff'); gr.addColorStop(1, '#1fd1ff');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#ffd23f'; star(g, 52, 64, 40, 17, 5); g.fill();
    g.fillStyle = '#fff'; g.font = 'bold italic 34px sans-serif'; g.fillText('NOVA', 100, 58);
    g.font = 'bold 20px sans-serif'; g.fillText('FESTIVAL', 102, 88);
    g.strokeStyle = '#fff'; g.lineWidth = 6; g.strokeRect(3, 3, 250, 122);
    T.poster = tex(c, false, aniso);
  }
  // Banner für den Torbogen
  {
    const [c, g] = canvas(1024, 128);
    const gr = g.createLinearGradient(0, 0, 1024, 0);
    gr.addColorStop(0, '#ff3d7f'); gr.addColorStop(0.5, '#ff8a00'); gr.addColorStop(1, '#7a3dff');
    g.fillStyle = gr; g.fillRect(0, 0, 1024, 128);
    g.fillStyle = '#fff'; g.font = 'bold italic 88px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = 'rgba(0,0,0,0.4)'; g.shadowBlur = 8;
    g.fillText('NOVA ✦ FESTIVAL', 512, 68);
    T.banner = tex(c, false, aniso);
  }
  // Warnstreifen für Schanzen
  {
    const [c, g] = canvas(128, 128);
    g.fillStyle = '#ffcc00'; g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#1a1a1a';
    for (let i = -128; i < 256; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 16, 0); g.lineTo(i + 16 + 128, 128); g.lineTo(i + 128, 128); g.fill(); }
    T.stripes = tex(c, true, aniso);
  }
  // Zeltstoff
  {
    const [c, g] = canvas(256, 32);
    for (let i = 0; i < 16; i++) { g.fillStyle = i % 2 ? '#ffffff' : '#ff3d7f'; g.fillRect(i * 16, 0, 16, 32); }
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
export const PHOTO_SETS = ['grass', 'rock', 'sand', 'asphalt', 'gravel'];
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
