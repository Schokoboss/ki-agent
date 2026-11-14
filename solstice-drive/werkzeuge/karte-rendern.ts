// Rendert die Weltkarte als PNG (Schummerung, Regionen, Straßen, Orte, Koordinatengitter).
// Aufruf: npm run karte   → werkzeuge/ausgabe/karte.png
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { erzeugeWeltkarte } from '../src/welt/weltkarte';
import { REGION, WELT_HALB } from '../src/welt/daten/regionen';
import { FLAG_BRUECKE, FLAG_TUNNEL } from '../src/welt/strassennetz';
import { schreibePng } from './png';

const t0 = Date.now();
const karte = erzeugeWeltkarte();
console.log(`Welt erzeugt in ${Date.now() - t0} ms`);
for (const m of karte.netz.meldungen) console.log('WARNUNG:', m);

const B = 1024, M = (WELT_HALB * 2) / B;
const rgba = new Uint8Array(B * B * 4);
const farbe: Record<number, [number, number, number]> = {
  [REGION.KUESTE]: [128, 170, 96], [REGION.GEBIRGE]: [140, 132, 124], [REGION.WALD]: [52, 110, 60],
  [REGION.DUENEN]: [226, 196, 124], [REGION.STADT]: [150, 150, 162], [REGION.FESTIVAL]: [230, 130, 80],
};
let hMax = 0;
for (let j = 0; j < B; j++) {
  for (let i = 0; i < B; i++) {
    const x = (i + 0.5) * M - WELT_HALB, z = (j + 0.5) * M - WELT_HALB;
    const h = karte.hoeheGelaende(x, z);
    hMax = Math.max(hMax, h);
    const o = (j * B + i) * 4;
    let c: [number, number, number];
    if (h < 0) c = [18 + Math.max(-18, h), 70 + Math.max(-50, h * 1.5), 150 + Math.max(-70, h * 2)];
    else {
      const r = farbe[karte.regionAn(x, z)] ?? [128, 170, 96];
      const hx = karte.hoeheGelaende(x + M, z) - karte.hoeheGelaende(x - M, z), hz = karte.hoeheGelaende(x, z + M) - karte.hoeheGelaende(x, z - M);
      const licht = Math.max(0.35, Math.min(1.5, 1 - (hx + hz) * 0.035));
      c = [r[0] * licht, r[1] * licht, r[2] * licht];
      if (h < 3) c = [236, 222, 176];
      if (h > 430 && karte.regionAn(x, z) === REGION.GEBIRGE) c = [240 * licht, 244 * licht, 250 * licht];
      if (Math.floor(h / 100) !== Math.floor(karte.hoeheGelaende(x + M, z + M) / 100)) c = [c[0] * 0.7, c[1] * 0.7, c[2] * 0.7];
    }
    rgba[o] = Math.min(255, c[0]); rgba[o + 1] = Math.min(255, c[1]); rgba[o + 2] = Math.min(255, c[2]); rgba[o + 3] = 255;
  }
}
const punkt = (x: number, z: number, r: number, c: [number, number, number]) => {
  const px = (x + WELT_HALB) / M, pz = (z + WELT_HALB) / M;
  for (let j = Math.floor(pz - r); j <= pz + r; j++) for (let i = Math.floor(px - r); i <= px + r; i++) {
    if (i < 0 || j < 0 || i >= B || j >= B) continue;
    if ((i - px) * (i - px) + (j - pz) * (j - pz) > r * r) continue;
    const o = (j * B + i) * 4;
    rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2];
  }
};
// Gitter alle 1000 m
for (let g = -4000; g <= 4000; g += 1000) {
  for (let q = -WELT_HALB; q < WELT_HALB; q += M) { punkt(g, q, 0.5, g === 0 ? [255, 60, 60] : [70, 70, 90]); punkt(q, g, 0.5, g === 0 ? [255, 60, 60] : [70, 70, 90]); }
}
let gesamt = 0, bruecken = 0, tunnel = 0, maxSteig = 0;
for (const st of karte.netz.strassen) {
  gesamt += st.laenge;
  for (let i = 0; i < st.n - 1; i++) {
    const f = st.flag[i];
    if (f === FLAG_BRUECKE) bruecken += 8; else if (f === FLAG_TUNNEL) tunnel += 8;
    maxSteig = Math.max(maxSteig, Math.abs(st.y[i + 1] - st.y[i]) / (st.s[i + 1] - st.s[i]));
    const c: [number, number, number] = f === FLAG_BRUECKE ? [255, 80, 200] : f === FLAG_TUNNEL ? [40, 40, 40] : st.daten.kartenfarbe;
    for (let t = 0; t < 1; t += 0.34) punkt(st.x[i] + (st.x[i + 1] - st.x[i]) * t, st.z[i] + (st.z[i + 1] - st.z[i]) * t, st.daten.kartenbreite * 0.55, c);
  }
}
for (const k of karte.netz.knoten) punkt(k.x, k.z, k.benannt ? 4 : 2.2, k.benannt ? [255, 40, 40] : [30, 30, 200]);
const datei = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ausgabe', 'karte.png');
schreibePng(datei, B, B, rgba);
console.log(`Höchster Punkt ${hMax.toFixed(0)} m · Straßen ${(gesamt / 1000).toFixed(1)} km (${karte.netz.strassen.length} Abschnitte) · Brücken ${bruecken} m · Tunnel ${tunnel} m · max. Steigung ${(maxSteig * 100).toFixed(1)} %`);
console.log(datei);
if (process.argv.includes('--knoten')) for (const k of karte.netz.knoten) console.log(k.id.padEnd(16), k.x, k.z, 'h', k.y.toFixed(1), 'Straßen', k.strassen.length);
if (process.argv.includes('--strassen')) for (const st of karte.netz.strassen) {
  let ms = 0, br = 0, tu = 0, hmin = 1e9, hmax = -1e9;
  for (let i = 0; i < st.n - 1; i++) { ms = Math.max(ms, Math.abs(st.y[i + 1] - st.y[i]) / (st.s[i + 1] - st.s[i])); if (st.flag[i] === FLAG_BRUECKE) br++; if (st.flag[i] === FLAG_TUNNEL) tu++; hmin = Math.min(hmin, st.y[i]); hmax = Math.max(hmax, st.y[i]); }
  if (process.argv.includes('--auffaellig') && ms < 0.13 && br * 8 < 250 && tu === 0) continue;
  console.log(st.id.padEnd(22), st.typ.padEnd(14), `${st.laenge.toFixed(0)} m`.padStart(8), `Steig ${(ms * 100).toFixed(1)}%`, `h ${hmin.toFixed(0)}–${hmax.toFixed(0)}`, br ? `Brücke ${br * 8} m` : '', tu ? `Tunnel ${tu * 8} m` : '');
}
