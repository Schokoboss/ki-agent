// Kleine Helfer: Mathe, Zufall, Rauschen (Perlin), Spline-Pfade.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const damp = (a, b, k, dt) => b + (a - b) * Math.exp(-k * dt);
export const wrapAngle = a => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Perlin-Rauschen (2D)
const P = new Uint8Array(512);
(() => {
  const r = mulberry32(1337);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) P[i] = p[i & 255];
})();
const GX = [1, -1, 1, -1, 1, -1, 0, 0], GY = [1, 1, -1, -1, 0, 0, 1, -1];

export function perlin(x, y) {
  const xf = Math.floor(x), yf = Math.floor(y);
  const X = xf & 255, Y = yf & 255;
  x -= xf; y -= yf;
  const u = x * x * x * (x * (x * 6 - 15) + 10), v = y * y * y * (y * (y * 6 - 15) + 10);
  const a = P[X] + Y, b = P[X + 1] + Y;
  const g00 = P[a] & 7, g01 = P[a + 1] & 7, g10 = P[b] & 7, g11 = P[b + 1] & 7;
  const n00 = GX[g00] * x + GY[g00] * y;
  const n10 = GX[g10] * (x - 1) + GY[g10] * y;
  const n01 = GX[g01] * x + GY[g01] * (y - 1);
  const n11 = GX[g11] * (x - 1) + GY[g11] * (y - 1);
  const nx0 = n00 + u * (n10 - n00), nx1 = n01 + u * (n11 - n01);
  return nx0 + v * (nx1 - nx0); // ca. -1 … 1
}

export function fbm(x, y, oct = 4) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += perlin(x * f, y * f) * a; n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}

export function ridged(x, y, oct = 5) {
  let s = 0, a = 0.5, f = 1, w = 1;
  for (let i = 0; i < oct; i++) {
    let n = 1 - Math.abs(perlin(x * f, y * f) * 1.3);
    n *= n;
    s += n * a * w;
    w = clamp(n * 1.6, 0, 1);
    f *= 2.07; a *= 0.5;
  }
  return s;
}

// ---------- Splines → gleichmäßig abgetastete Pfade
function crPoint(p0, p1, p2, p3, t) {
  // zentripetaler Catmull-Rom (keine Schleifen/Spitzen)
  const d = (a, b) => Math.max(Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5), 1e-4);
  const t0 = 0, t1 = d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
  const tt = t1 + (t2 - t1) * t;
  const out = [0, 0];
  for (let k = 0; k < 2; k++) {
    const A1 = (p0[k] * (t1 - tt) + p1[k] * (tt - t0)) / (t1 - t0);
    const A2 = (p1[k] * (t2 - tt) + p2[k] * (tt - t1)) / (t2 - t1);
    const A3 = (p2[k] * (t3 - tt) + p3[k] * (tt - t2)) / (t3 - t2);
    const B1 = (A1 * (t2 - tt) + A2 * (tt - t0)) / (t2 - t0);
    const B2 = (A2 * (t3 - tt) + A3 * (tt - t1)) / (t3 - t1);
    out[k] = (B1 * (t2 - tt) + B2 * (tt - t1)) / (t2 - t1);
  }
  return out;
}

// Ecken eines Polygons abrunden: vor/nach jeder Ecke Hilfspunkte, damit der Spline enge Kurven macht
export function roundedPoly(corners, r, closed = true) {
  const out = [];
  const n = corners.length;
  for (let i = 0; i < n; i++) {
    const c = corners[i];
    if (!closed && (i === 0 || i === n - 1)) { out.push(c); continue; }
    const a = corners[(i - 1 + n) % n], b = corners[(i + 1) % n];
    const la = Math.hypot(a[0] - c[0], a[1] - c[1]), lb = Math.hypot(b[0] - c[0], b[1] - c[1]);
    const ra = Math.min(r, la * 0.4), rb = Math.min(r, lb * 0.4);
    out.push([c[0] + (a[0] - c[0]) / la * ra, c[1] + (a[1] - c[1]) / la * ra]);
    out.push([c[0] + (b[0] - c[0]) / lb * rb, c[1] + (b[1] - c[1]) / lb * rb]);
  }
  return out;
}

export class Path {
  // pts: [[x,z],…] Kontrollpunkte; spacing: Abstand der Abtastpunkte in m
  constructor(pts, closed, spacing = 2.5) {
    this.closed = closed;
    const n = pts.length;
    const P = pts.map(p => [p[0], p[1]]);
    const get = i => {
      if (closed) return P[((i % n) + n) % n];
      if (i < 0) return [2 * P[0][0] - P[1][0], 2 * P[0][1] - P[1][1]];
      if (i >= n) return [2 * P[n - 1][0] - P[n - 2][0], 2 * P[n - 1][1] - P[n - 2][1]];
      return P[i];
    };
    const dense = [];
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
      const L = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      const steps = Math.max(4, Math.ceil(L / 1.5));
      for (let k = 0; k < steps; k++) dense.push(crPoint(p0, p1, p2, p3, k / steps));
    }
    dense.push(closed ? dense[0] : P[n - 1]);
    const cum = [0];
    for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
    const total = cum[cum.length - 1];
    const count = Math.max(2, Math.round(total / spacing));
    this.length = total;
    this.ds = total / count;
    const m = closed ? count : count + 1;
    this.n = m;
    this.x = new Float32Array(m); this.z = new Float32Array(m); this.y = new Float32Array(m);
    this.tx = new Float32Array(m); this.tz = new Float32Array(m); this.curv = new Float32Array(m);
    let j = 0;
    for (let i = 0; i < m; i++) {
      const s = i * this.ds;
      while (j < cum.length - 2 && cum[j + 1] < s) j++;
      const f = clamp((s - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j]), 0, 1);
      this.x[i] = lerp(dense[j][0], dense[j + 1][0], f);
      this.z[i] = lerp(dense[j][1], dense[j + 1][1], f);
    }
    for (let i = 0; i < m; i++) {
      const a = this.idx(i - 1), b = this.idx(i + 1);
      const dx = this.x[b] - this.x[a], dz = this.z[b] - this.z[a];
      const l = Math.hypot(dx, dz) || 1;
      this.tx[i] = dx / l; this.tz[i] = dz / l;
    }
    // Krümmung über ±6 Punkte (glatt), Vorzeichen: + = Rechtskurve (aus Fahrersicht)
    const W = 6;
    const raw = new Float32Array(m);
    for (let i = 0; i < m; i++) {
      const a = this.idx(i - W), b = this.idx(i + W);
      const ang = Math.atan2(this.tx[b], this.tz[b]) - Math.atan2(this.tx[a], this.tz[a]);
      let d = ang; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      const span = (this.closed ? 2 * W : (b - a)) * this.ds || 1;
      raw[i] = -d / span;
    }
    for (let i = 0; i < m; i++) {
      let s = 0;
      for (let k = -3; k <= 3; k++) s += raw[this.idx(i + k)];
      this.curv[i] = s / 7;
    }
  }
  idx(i) { return this.closed ? ((i % this.n) + this.n) % this.n : clamp(i, 0, this.n - 1); }
  wrapS(s) { return this.closed ? ((s % this.length) + this.length) % this.length : clamp(s, 0, this.length - 1e-3); }
  // Position/Richtung bei Bogenlänge s (interpoliert)
  at(s, out) {
    s = this.wrapS(s);
    const f = s / this.ds;
    const i = Math.floor(f), t = f - i;
    const a = this.idx(i), b = this.idx(i + 1);
    out.x = lerp(this.x[a], this.x[b], t);
    out.z = lerp(this.z[a], this.z[b], t);
    out.y = lerp(this.y[a], this.y[b], t);
    let tx = lerp(this.tx[a], this.tx[b], t), tz = lerp(this.tz[a], this.tz[b], t);
    const l = Math.hypot(tx, tz) || 1;
    out.tx = tx / l; out.tz = tz / l;
    out.curv = lerp(this.curv[a], this.curv[b], t);
    return out;
  }
  // nächster Punkt; mit Hinweis (vorheriges s) nur lokal suchen
  closest(x, z, hintS = null, window = 80) {
    let best = 1e18, bi = 0;
    if (hintS === null) {
      for (let i = 0; i < this.n; i += 2) {
        const d = (this.x[i] - x) ** 2 + (this.z[i] - z) ** 2;
        if (d < best) { best = d; bi = i; }
      }
    } else {
      bi = Math.round(this.wrapS(hintS) / this.ds);
      best = 1e18;
      const w = Math.ceil(window / this.ds);
      const c0 = bi;
      for (let k = -w; k <= w; k++) {
        const i = this.idx(c0 + k);
        const d = (this.x[i] - x) ** 2 + (this.z[i] - z) ** 2;
        if (d < best) { best = d; bi = i; }
      }
    }
    // verfeinern auf dem Segment
    const a = this.idx(bi - 1), b = this.idx(bi + 1);
    let bestS = bi * this.ds, bestD = best;
    for (const [i0, i1] of [[a, bi], [bi, b]]) {
      const ax = this.x[i0], az = this.z[i0], bx = this.x[i1], bz = this.z[i1];
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
      const t = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1);
      const d = (ax + dx * t - x) ** 2 + (az + dz * t - z) ** 2;
      if (d < bestD) {
        bestD = d;
        let s0 = i0 * this.ds;
        if (this.closed && i1 === 0 && i0 === this.n - 1) s0 = i0 * this.ds;
        bestS = s0 + t * this.ds;
      }
    }
    // seitlicher Abstand (+ = rechts der Fahrtrichtung)
    const p = this.at(bestS, TMP);
    const lat = (x - p.x) * -p.tz + (z - p.z) * p.tx;
    return { s: this.wrapS(bestS), dist: Math.sqrt(bestD), lat };
  }
}
const TMP = {};

export function fmtTime(t) {
  if (!isFinite(t)) return '–:–';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
}
export const fmtNum = n => Math.round(n).toLocaleString('de-DE');

// Lange Rechnungen in Häppchen teilen: alle ~30 ms kurz dem Browser Luft lassen (Ladebalken, Animationen)
let _lastBreath = 0;
export async function breathe(ms = 30) {
  const n = performance.now();
  if (n - _lastBreath > ms) { await new Promise(r => setTimeout(r, 0)); _lastBreath = performance.now(); }
}
