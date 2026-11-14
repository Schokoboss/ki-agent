import { glatt, klemme } from '../engine/mathe';
import { RASTER, RASTER_N, WELT_HALB } from './daten/regionen';
import { STRASSENTYPEN, type OrtDef, type StrassenDef, type StrassenTyp, type StrassenTypDaten } from './daten/strassentypen';

export const FLAG_NORMAL = 0;
export const FLAG_BRUECKE = 1;
export const FLAG_TUNNEL = 2;
/** Abstand der Stützpunkte entlang einer Straße in m. */
export const PUNKT_ABSTAND = 8;
/** Lichte Höhe eines Tunnels. */
export const TUNNEL_HOEHE = 6.2;

export interface Knoten {
  index: number;
  id: string;
  x: number; y: number; z: number;
  benannt: boolean;
  /** Indizes der angeschlossenen Straßen. */
  strassen: number[];
}

/** Eine fertig trassierte Straße als Punktfolge. */
export class Strasse {
  index = 0;
  readonly daten: StrassenTypDaten;
  readonly halbbreite: number;
  n = 0;
  x!: Float32Array; y!: Float32Array; z!: Float32Array;
  /** Kumulierte Länge. */
  s!: Float32Array;
  /** Querneigung (Höhenänderung je Meter nach links). */
  quer!: Float32Array;
  /** Krümmung (1/m, positiv = Linkskurve). */
  kurve!: Float32Array;
  flag!: Uint8Array;
  laenge = 0;
  constructor(readonly id: string, readonly typ: StrassenTyp, readonly von: number, readonly nach: number, readonly bauwerk?: 'bruecke' | 'tunnel') {
    this.daten = STRASSENTYPEN[typ];
    this.halbbreite = this.daten.halbbreite;
  }

  /** Punkt und Richtung bei Bogenlänge s (linear interpoliert). */
  bei(s: number, aus: { x: number; y: number; z: number; tx: number; tz: number; i: number }): void {
    const n = this.n;
    let i = Math.min(n - 2, Math.max(0, Math.floor((s / this.laenge) * (n - 1))));
    while (i > 0 && this.s[i] > s) i--;
    while (i < n - 2 && this.s[i + 1] < s) i++;
    const l = this.s[i + 1] - this.s[i];
    const t = klemme((s - this.s[i]) / l, 0, 1);
    aus.x = this.x[i] + (this.x[i + 1] - this.x[i]) * t;
    aus.y = this.y[i] + (this.y[i + 1] - this.y[i]) * t;
    aus.z = this.z[i] + (this.z[i + 1] - this.z[i]) * t;
    aus.tx = (this.x[i + 1] - this.x[i]) / l;
    aus.tz = (this.z[i + 1] - this.z[i]) / l;
    aus.i = i;
  }
}

/** Ergebnis einer Nachbarschaftssuche. */
export interface StrassenTreffer {
  strasse: number;
  /** Segmentindex und Anteil 0..1 im Segment. */
  i: number;
  t: number;
  /** Seitlicher Versatz in m (positiv = links in Laufrichtung). */
  u: number;
  abstand: number;
}

const ZELLE = 32;
const ZELLEN = (WELT_HALB * 2) / ZELLE;

export class Strassennetz {
  readonly knoten: Knoten[] = [];
  readonly strassen: Strasse[] = [];
  private readonly knotenNachId = new Map<string, number>();
  /** Räumlicher Index: je Zelle Liste von (strasse << 14 | segment). */
  private zellStart = new Int32Array(ZELLEN * ZELLEN + 1);
  private zellRefs = new Int32Array(0);
  /** Protokoll des Generators (Warnungen). */
  readonly meldungen: string[] = [];

  knotenIndex(id: string): number {
    const i = this.knotenNachId.get(id);
    if (i === undefined) throw new Error(`Unbekannter Ort: ${id}`);
    return i;
  }

  fuegeKnoten(o: OrtDef, y: number): Knoten {
    const k: Knoten = { index: this.knoten.length, id: o.id, x: o.x, y, z: o.z, benannt: !!o.benannt, strassen: [] };
    this.knoten.push(k);
    this.knotenNachId.set(o.id, k.index);
    return k;
  }

  fuegeStrasse(s: Strasse): void {
    s.index = this.strassen.length;
    this.strassen.push(s);
    this.knoten[s.von].strassen.push(s.index);
    this.knoten[s.nach].strassen.push(s.index);
  }

  /** Baut den räumlichen Index neu auf. */
  baueIndex(): void {
    const listen: number[][] = [];
    for (let i = 0; i < ZELLEN * ZELLEN; i++) listen.push([]);
    for (const st of this.strassen) {
      const rand = st.halbbreite + 2.5;
      for (let i = 0; i < st.n - 1; i++) {
        const x0 = Math.min(st.x[i], st.x[i + 1]) - rand, x1 = Math.max(st.x[i], st.x[i + 1]) + rand;
        const z0 = Math.min(st.z[i], st.z[i + 1]) - rand, z1 = Math.max(st.z[i], st.z[i + 1]) + rand;
        const cx0 = klemme(Math.floor((x0 + WELT_HALB) / ZELLE), 0, ZELLEN - 1), cx1 = klemme(Math.floor((x1 + WELT_HALB) / ZELLE), 0, ZELLEN - 1);
        const cz0 = klemme(Math.floor((z0 + WELT_HALB) / ZELLE), 0, ZELLEN - 1), cz1 = klemme(Math.floor((z1 + WELT_HALB) / ZELLE), 0, ZELLEN - 1);
        for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) listen[cz * ZELLEN + cx].push((st.index << 14) | i);
      }
    }
    let gesamt = 0;
    for (const l of listen) gesamt += l.length;
    this.zellRefs = new Int32Array(gesamt);
    let o = 0;
    for (let c = 0; c < listen.length; c++) {
      this.zellStart[c] = o;
      for (const r of listen[c]) this.zellRefs[o++] = r;
    }
    this.zellStart[listen.length] = o;
  }

  /** Ruft `f` für jedes Segment in der Zelle von (x, z) auf. */
  segmenteBei(x: number, z: number, f: (strasse: Strasse, i: number) => void): void {
    const cx = Math.floor((x + WELT_HALB) / ZELLE), cz = Math.floor((z + WELT_HALB) / ZELLE);
    if (cx < 0 || cz < 0 || cx >= ZELLEN || cz >= ZELLEN) return;
    const c = cz * ZELLEN + cx;
    for (let r = this.zellStart[c]; r < this.zellStart[c + 1]; r++) {
      const ref = this.zellRefs[r];
      f(this.strassen[ref >> 14], ref & 16383);
    }
  }

  /** Roher Zugriff für die Bodenabfrage (ohne Closure). */
  zelle(x: number, z: number): number {
    const cx = Math.floor((x + WELT_HALB) / ZELLE), cz = Math.floor((z + WELT_HALB) / ZELLE);
    if (cx < 0 || cz < 0 || cx >= ZELLEN || cz >= ZELLEN) return -1;
    return cz * ZELLEN + cx;
  }
  get refs(): Int32Array { return this.zellRefs; }
  get starts(): Int32Array { return this.zellStart; }

  /** Nächstgelegene Straße innerhalb von maxAbstand (m). */
  naechste(x: number, z: number, maxAbstand: number, aus: StrassenTreffer, filter?: (s: Strasse) => boolean): boolean {
    const r = Math.ceil(maxAbstand / ZELLE);
    const cx0 = Math.floor((x + WELT_HALB) / ZELLE), cz0 = Math.floor((z + WELT_HALB) / ZELLE);
    let best = maxAbstand;
    let gefunden = false;
    for (let cz = cz0 - r; cz <= cz0 + r; cz++) {
      if (cz < 0 || cz >= ZELLEN) continue;
      for (let cx = cx0 - r; cx <= cx0 + r; cx++) {
        if (cx < 0 || cx >= ZELLEN) continue;
        const c = cz * ZELLEN + cx;
        for (let q = this.zellStart[c]; q < this.zellStart[c + 1]; q++) {
          const ref = this.zellRefs[q];
          const st = this.strassen[ref >> 14], i = ref & 16383;
          if (filter && !filter(st)) continue;
          const ax = st.x[i], az = st.z[i];
          const dx = st.x[i + 1] - ax, dz = st.z[i + 1] - az;
          const l2 = dx * dx + dz * dz;
          const t = klemme(((x - ax) * dx + (z - az) * dz) / l2, 0, 1);
          const px = ax + dx * t, pz = az + dz * t;
          const d = Math.sqrt((x - px) * (x - px) + (z - pz) * (z - pz));
          if (d < best) {
            best = d; gefunden = true;
            const l = Math.sqrt(l2);
            aus.strasse = st.index; aus.i = i; aus.t = t; aus.abstand = d;
            aus.u = ((x - px) * dz - (z - pz) * dx) / l;
          }
        }
      }
    }
    return gefunden;
  }

  /** Kürzester Weg zwischen zwei Knoten (Dijkstra). Liefert Folge von [Straßenindex, vorwärts?]. */
  weg(von: number, nach: number, erlaubt?: (s: Strasse) => boolean): [number, boolean][] | null {
    const n = this.knoten.length;
    const dist = new Float64Array(n).fill(Infinity);
    const vor = new Int32Array(n).fill(-1);
    const vorStrasse = new Int32Array(n).fill(-1);
    const fertig = new Uint8Array(n);
    dist[von] = 0;
    for (;;) {
      let u = -1, best = Infinity;
      for (let i = 0; i < n; i++) if (!fertig[i] && dist[i] < best) { best = dist[i]; u = i; }
      if (u < 0 || u === nach) break;
      fertig[u] = 1;
      for (const si of this.knoten[u].strassen) {
        const st = this.strassen[si];
        if (erlaubt && !erlaubt(st)) continue;
        const v = st.von === u ? st.nach : st.von;
        const d = dist[u] + st.laenge;
        if (d < dist[v]) { dist[v] = d; vor[v] = u; vorStrasse[v] = si; }
      }
    }
    if (!isFinite(dist[nach])) return null;
    const pfad: [number, boolean][] = [];
    let k = nach;
    while (k !== von) {
      const st = this.strassen[vorStrasse[k]];
      pfad.push([st.index, st.nach === k]);
      k = vor[k];
    }
    return pfad.reverse();
  }
}

// ---------------------------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------------------------

const GS = 4; // Trassenraster in Höhenraster-Zellen (32 m)
const GN = (RASTER_N - 1) / GS + 1;
const NACHBARN: [number, number][] = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
  [2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2],
  [3, 1], [3, -1], [-3, 1], [-3, -1], [1, 3], [1, -3], [-1, 3], [-1, -3],
  [3, 2], [3, -2], [-3, 2], [-3, -2], [2, 3], [2, -3], [-2, 3], [-2, -3],
];

class Halde {
  private readonly idx: number[] = [];
  private readonly kosten: number[] = [];
  get leer(): boolean { return this.idx.length === 0; }
  rein(i: number, k: number): void {
    const a = this.idx, c = this.kosten;
    let p = a.length;
    a.push(i); c.push(k);
    while (p > 0) {
      const e = (p - 1) >> 1;
      if (c[e] <= k) break;
      a[p] = a[e]; c[p] = c[e]; p = e;
    }
    a[p] = i; c[p] = k;
  }
  raus(): number {
    const a = this.idx, c = this.kosten;
    const oben = a[0];
    const li = a.pop()!, lk = c.pop()!;
    const n = a.length;
    if (n > 0) {
      let p = 0;
      for (;;) {
        let k = p * 2 + 1;
        if (k >= n) break;
        if (k + 1 < n && c[k + 1] < c[k]) k++;
        if (c[k] >= lk) break;
        a[p] = a[k]; c[p] = c[k]; p = k;
      }
      a[p] = li; c[p] = lk;
    }
    return oben;
  }
}

export interface GeneratorEingabe {
  /** Rohhöhen (RASTER_N²). */
  roh: Float32Array;
  orte: readonly OrtDef[];
  strassen: readonly StrassenDef[];
  /** Höchster Wasserstand aller Jahreszeiten. */
  wasserMax: number;
}

function rohAn(roh: Float32Array, x: number, z: number): number {
  const gx = klemme((x + WELT_HALB) / RASTER, 0, RASTER_N - 1.001), gz = klemme((z + WELT_HALB) / RASTER, 0, RASTER_N - 1.001);
  const i = Math.floor(gx), j = Math.floor(gz);
  const fx = gx - i, fz = gz - j;
  const o = j * RASTER_N + i;
  const a = roh[o], b = roh[o + 1], c = roh[o + RASTER_N], d = roh[o + RASTER_N + 1];
  return a + (b - a) * fx + (c - a + (a - b + d - c) * fx) * fz;
}

/** Tastet eine Linie in gleichmäßigem Abstand ab. */
function taste(px: number[], pz: number[], abstand: number): [number[], number[]] {
  let laenge = 0;
  const kum = [0];
  for (let i = 1; i < px.length; i++) {
    laenge += Math.hypot(px[i] - px[i - 1], pz[i] - pz[i - 1]);
    kum.push(laenge);
  }
  const n = Math.max(2, Math.round(laenge / abstand) + 1);
  const ox: number[] = [], oz: number[] = [];
  let k = 0;
  for (let i = 0; i < n; i++) {
    const s = (i / (n - 1)) * laenge;
    while (k < px.length - 2 && kum[k + 1] < s) k++;
    const l = kum[k + 1] - kum[k] || 1;
    const t = klemme((s - kum[k]) / l, 0, 1);
    ox.push(px[k] + (px[k + 1] - px[k]) * t);
    oz.push(pz[k] + (pz[k + 1] - pz[k]) * t);
  }
  return [ox, oz];
}

function glaette(x: number[], z: number[], durchlaeufe: number): void {
  const n = x.length;
  const tx = new Float64Array(n), tz = new Float64Array(n);
  for (let d = 0; d < durchlaeufe; d++) {
    for (let i = 1; i < n - 1; i++) {
      tx[i] = 0.25 * x[i - 1] + 0.5 * x[i] + 0.25 * x[i + 1];
      tz[i] = 0.25 * z[i - 1] + 0.5 * z[i] + 0.25 * z[i + 1];
    }
    for (let i = 1; i < n - 1; i++) { x[i] = tx[i]; z[i] = tz[i]; }
  }
}

/** Erzeugt das Straßennetz aus Orten und Straßendefinitionen auf dem Rohgelände. */
export function baueStrassennetz(ein: GeneratorEingabe): Strassennetz {
  const { roh, wasserMax } = ein;
  const netz = new Strassennetz();
  const mindest = wasserMax + 2.0;

  // Geglättete Höhen auf dem Trassenraster
  const hG = new Float32Array(GN * GN);
  for (let j = 0; j < GN; j++) {
    for (let i = 0; i < GN; i++) {
      const ri = i * GS, rj = j * GS;
      let s = 0, c = 0;
      for (const [dx, dz] of [[0, 0], [2, 0], [-2, 0], [0, 2], [0, -2]]) {
        const a = ri + dx, b = rj + dz;
        if (a < 0 || b < 0 || a >= RASTER_N || b >= RASTER_N) continue;
        s += roh[b * RASTER_N + a]; c++;
      }
      hG[j * GN + i] = s / c;
    }
  }
  const belegt = new Uint8Array(GN * GN);
  const gKosten = new Float32Array(GN * GN);
  const gVor = new Int32Array(GN * GN);
  const gMarke = new Uint32Array(GN * GN);
  const gZu = new Uint32Array(GN * GN);
  let marke = 0;

  const trassiere = (ax: number, az: number, bx: number, bz: number, typ: StrassenTyp): [number[], number[]] | null => {
    const gmax = STRASSENTYPEN[typ].maxSteigung;
    const zuG = (v: number) => klemme(Math.round((v + WELT_HALB) / (RASTER * GS)), 0, GN - 1);
    const si = zuG(ax), sj = zuG(az), zi = zuG(bx), zj = zuG(bz);
    const start = sj * GN + si, ziel = zj * GN + zi;
    marke++;
    const halde = new Halde();
    gKosten[start] = 0; gVor[start] = -1; gMarke[start] = marke;
    halde.rein(start, 0);
    const schritt = RASTER * GS;
    let gefunden = false;
    while (!halde.leer) {
      const u = halde.raus();
      if (u === ziel) { gefunden = true; break; }
      if (gZu[u] === marke) continue; // veralteter Eintrag
      gZu[u] = marke;
      const ui = u % GN, uj = (u - ui) / GN;
      const ku = gKosten[u];
      for (const [dx, dz] of NACHBARN) {
        const vi = ui + dx, vj = uj + dz;
        if (vi < 1 || vj < 1 || vi >= GN - 1 || vj >= GN - 1) continue;
        const v = vj * GN + vi;
        if (gZu[v] === marke) continue;
        const d = schritt * Math.sqrt(dx * dx + dz * dz);
        const hv = hG[v], hu = hG[u];
        const steigung = Math.abs(hv - hu) / d;
        if (steigung > gmax * 3) continue;
        const sv = steigung / gmax;
        const ub = sv > 0.75 ? sv - 0.75 : 0;
        let k = d * (1 + 0.6 * sv * sv + 30 * ub * ub + (sv > 1 ? 14 * (sv - 1) : 0));
        // lange Züge: Gelände in der Mitte darf nicht stark von der Geraden abweichen
        if (dx * dx + dz * dz > 2) {
          const mi = ui + (dx >> 1), mj = uj + (dz >> 1);
          const hm = (hG[mj * GN + mi] + hG[(uj + dz - (dz >> 1)) * GN + (ui + dx - (dx >> 1))]) * 0.5;
          const abw = Math.abs(hm - (hu + hv) * 0.5);
          if (abw > 3) k += (abw - 3) * 25;
        }
        if (hv < mindest - 0.8) k += d * (hv < -2.5 ? 60 : 9);
        if (belegt[v]) {
          const nahStart = Math.abs(vi - si) + Math.abs(vj - sj) <= 3, nahZiel = Math.abs(vi - zi) + Math.abs(vj - zj) <= 3;
          if (!nahStart && !nahZiel) k += 500;
        }
        const neu = ku + k;
        if (gMarke[v] !== marke || neu < gKosten[v]) {
          gMarke[v] = marke; gKosten[v] = neu; gVor[v] = u;
          const lx = (vi - zi) * schritt, lz = (vj - zj) * schritt;
          halde.rein(v, neu + Math.sqrt(lx * lx + lz * lz));
        }
      }
    }
    if (!gefunden) return null;
    const zellen: number[] = [];
    for (let k = ziel; k !== -1; k = gVor[k]) zellen.push(k);
    zellen.reverse();
    const px: number[] = [ax], pz: number[] = [az];
    for (let q = 2; q < zellen.length - 2; q++) {
      const c = zellen[q];
      const ci = c % GN, cj = (c - ci) / GN;
      px.push(ci * schritt - WELT_HALB); pz.push(cj * schritt - WELT_HALB);
    }
    px.push(bx); pz.push(bz);
    return [px, pz];
  };

  // Knoten anlegen
  for (const o of ein.orte) {
    let s = 0, c = 0;
    for (let dz = -16; dz <= 16; dz += 8) for (let dx = -16; dx <= 16; dx += 8) { s += rohAn(roh, o.x + dx, o.z + dz); c++; }
    const y = Math.max(s / c, mindest);
    if (s / c < -0.5) netz.meldungen.push(`Ort ${o.id} liegt im Wasser (${(s / c).toFixed(1)} m)`);
    netz.fuegeKnoten(o, y);
  }

  for (const def of ein.strassen) {
    const A = netz.knoten[netz.knotenIndex(def.von)], B = netz.knoten[netz.knotenIndex(def.nach)];
    const typ = STRASSENTYPEN[def.typ];
    const halt: [number, number][] = [[A.x, A.z], ...(def.ueber ?? []), [B.x, B.z]];
    let px: number[] = [], pz: number[] = [];
    let fehler = false;
    for (let h = 0; h < halt.length - 1; h++) {
      const [x0, z0] = halt[h], [x1, z1] = halt[h + 1];
      let teil: [number[], number[]] | null;
      if (def.gerade || def.bauwerk) teil = [[x0, x1], [z0, z1]];
      else teil = trassiere(x0, z0, x1, z1, def.typ);
      if (!teil) { netz.meldungen.push(`Keine Trasse für ${def.id} (${def.von} → ${def.nach})`); fehler = true; break; }
      if (h > 0) { teil[0].shift(); teil[1].shift(); }
      px = px.concat(teil[0]); pz = pz.concat(teil[1]);
    }
    if (fehler) continue;
    [px, pz] = taste(px, pz, PUNKT_ABSTAND);
    if (!def.gerade && !def.bauwerk) {
      glaette(px, pz, typ.trasse);
      [px, pz] = taste(px, pz, PUNKT_ABSTAND);
      glaette(px, pz, 3);
    } else if (px.length > 6 && (def.ueber?.length ?? 0) > 0) {
      glaette(px, pz, 6);
      [px, pz] = taste(px, pz, PUNKT_ABSTAND);
    }
    const n = px.length;
    const st = new Strasse(def.id, def.typ, A.index, B.index, def.bauwerk);
    st.n = n;
    st.x = Float32Array.from(px); st.z = Float32Array.from(pz);
    st.y = new Float32Array(n); st.s = new Float32Array(n); st.quer = new Float32Array(n); st.kurve = new Float32Array(n);
    st.flag = new Uint8Array(n);
    for (let i = 1; i < n; i++) st.s[i] = st.s[i - 1] + Math.hypot(px[i] - px[i - 1], pz[i] - pz[i - 1]);
    st.laenge = st.s[n - 1];

    // Höhenprofil
    const gel = new Float32Array(n);
    for (let i = 0; i < n; i++) gel[i] = rohAn(roh, px[i], pz[i]);
    const y = st.y;
    if (def.furt) {
      for (let i = 0; i < n; i++) y[i] = gel[i] + 0.12;
      const tmp = new Float32Array(n);
      for (let d = 0; d < 10; d++) {
        for (let i = 1; i < n - 1; i++) tmp[i] = 0.25 * y[i - 1] + 0.5 * y[i] + 0.25 * y[i + 1];
        for (let i = 1; i < n - 1; i++) y[i] = tmp[i];
      }
    } else if (def.bauwerk) {
      const bogen = def.bauwerk === 'bruecke' ? Math.min(16, st.laenge * 0.028) : 0;
      for (let i = 0; i < n; i++) {
        const t = st.s[i] / st.laenge;
        y[i] = A.y + (B.y - A.y) * t + Math.sin(Math.PI * t) * bogen;
      }
    } else {
      for (let i = 0; i < n; i++) y[i] = Math.max(gel[i], mindest);
      y[0] = A.y; y[n - 1] = B.y;
      const tmp = new Float32Array(n);
      for (let d = 0; d < typ.glaettung; d++) {
        for (let i = 1; i < n - 1; i++) tmp[i] = 0.25 * y[i - 1] + 0.5 * y[i] + 0.25 * y[i + 1];
        for (let i = 1; i < n - 1; i++) y[i] = tmp[i];
      }
      const g = typ.maxSteigung * 1.08;
      for (let d = 0; d < 6; d++) {
        for (let i = 1; i < n - 1; i++) { const ds = st.s[i] - st.s[i - 1]; y[i] = klemme(y[i], y[i - 1] - g * ds, y[i - 1] + g * ds); }
        for (let i = n - 2; i > 0; i--) { const ds = st.s[i + 1] - st.s[i]; y[i] = klemme(y[i], y[i + 1] - g * ds, y[i + 1] + g * ds); }
      }
    }
    // Brücken und Tunnel erkennen
    for (let i = 0; i < n && !def.furt; i++) {
      const diff = y[i] - gel[i];
      if (diff > 5.5 || gel[i] < wasserMax + 0.5) st.flag[i] = FLAG_BRUECKE;
      else if (diff < (def.bauwerk === 'tunnel' ? -TUNNEL_HOEHE - 0.8 : -11)) st.flag[i] = FLAG_TUNNEL;
    }
    // Enden bleiben am Boden; sehr kurze Tunnel werden zu Einschnitten
    st.flag[0] = st.flag[n - 1] = FLAG_NORMAL;
    for (let i = 0; i < n;) {
      if (st.flag[i] !== FLAG_TUNNEL) { i++; continue; }
      let j = i;
      while (j < n && st.flag[j] === FLAG_TUNNEL) j++;
      if (j - i < 6) for (let q = i; q < j; q++) st.flag[q] = FLAG_NORMAL;
      i = j;
    }
    // Krümmung und Überhöhung
    for (let i = 1; i < n - 1; i++) {
      const ax = px[i] - px[i - 1], az = pz[i] - pz[i - 1], bx = px[i + 1] - px[i], bz = pz[i + 1] - pz[i];
      const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
      // Drehung nach links (um +y): Kreuzprodukt (a × b).y = az*bx - ax*bz
      const kreuz = az * bx - ax * bz;
      st.kurve[i] = Math.asin(klemme(kreuz / (la * lb), -1, 1)) / ((la + lb) / 2);
    }
    const kt = new Float32Array(n);
    for (let d = 0; d < 4; d++) {
      for (let i = 1; i < n - 1; i++) kt[i] = 0.25 * st.kurve[i - 1] + 0.5 * st.kurve[i] + 0.25 * st.kurve[i + 1];
      for (let i = 1; i < n - 1; i++) st.kurve[i] = kt[i];
    }
    for (let i = 0; i < n; i++) {
      const rand = glatt(0, 45, st.s[i]) * glatt(0, 45, st.laenge - st.s[i]);
      st.quer[i] = -klemme(st.kurve[i] * 2.2 * typ.ueberhoehung, -0.065, 0.065) * rand;
    }
    netz.fuegeStrasse(st);
    // Trassenraster belegen
    for (let i = 0; i < n; i++) {
      const gi = klemme(Math.round((px[i] + WELT_HALB) / (RASTER * GS)), 0, GN - 1), gj = klemme(Math.round((pz[i] + WELT_HALB) / (RASTER * GS)), 0, GN - 1);
      belegt[gj * GN + gi] = 1;
    }
  }
  netz.baueIndex();
  return netz;
}

/**
 * Passt das Gelände an die Straßen an (Dämme und Einschnitte) und markiert Tunnelöffnungen.
 * Schreibt nach `hoehen`; `loch` erhält je Rasterzelle 1, wo das Gelände nicht gezeichnet wird.
 */
export function passeGelaendeAn(netz: Strassennetz, roh: Float32Array, hoehen: Float32Array, loch: Uint8Array): void {
  const N = RASTER_N;
  const best = new Float32Array(N * N).fill(1e9);
  const ziel = new Float32Array(N * N);
  const kern = new Float32Array(N * N);
  const AUSLAUF = 34;
  for (const st of netz.strassen) {
    const k = st.halbbreite + 3;
    const R = k + AUSLAUF;
    for (let i = 0; i < st.n - 1; i++) {
      const tunnel = st.flag[i] === FLAG_TUNNEL || st.flag[i + 1] === FLAG_TUNNEL;
      if (st.flag[i] === FLAG_BRUECKE || st.flag[i + 1] === FLAG_BRUECKE) continue;
      const ax = st.x[i], az = st.z[i], dx = st.x[i + 1] - ax, dz = st.z[i + 1] - az;
      const l2 = dx * dx + dz * dz, l = Math.sqrt(l2);
      const r = tunnel ? st.halbbreite + 2 : R;
      const i0 = Math.max(0, Math.floor((Math.min(ax, ax + dx) - r + WELT_HALB) / RASTER)), i1 = Math.min(N - 1, Math.ceil((Math.max(ax, ax + dx) + r + WELT_HALB) / RASTER));
      const j0 = Math.max(0, Math.floor((Math.min(az, az + dz) - r + WELT_HALB) / RASTER)), j1 = Math.min(N - 1, Math.ceil((Math.max(az, az + dz) + r + WELT_HALB) / RASTER));
      for (let j = j0; j <= j1; j++) {
        for (let q = i0; q <= i1; q++) {
          const x = q * RASTER - WELT_HALB, z = j * RASTER - WELT_HALB;
          const t = klemme(((x - ax) * dx + (z - az) * dz) / l2, 0, 1);
          const px = ax + dx * t, pz = az + dz * t;
          const d = Math.sqrt((x - px) * (x - px) + (z - pz) * (z - pz));
          if (d > r) continue;
          const o = j * N + q;
          const deck = st.y[i] + (st.y[i + 1] - st.y[i]) * t;
          if (tunnel) continue;
          if (d < best[o]) {
            best[o] = d;
            const u = ((x - px) * dz - (z - pz) * dx) / l;
            const quer = st.quer[i] + (st.quer[i + 1] - st.quer[i]) * t;
            ziel[o] = deck + klemme(u, -st.halbbreite, st.halbbreite) * quer - 0.32;
            kern[o] = k;
          }
        }
      }
    }
  }
  for (let o = 0; o < N * N; o++) {
    if (best[o] > 1e8) continue;
    const f = glatt(kern[o], kern[o] + AUSLAUF, best[o]);
    hoehen[o] = ziel[o] + (roh[o] - ziel[o]) * f;
  }
  // Tunnelöffnungen: Zellen ausstanzen, deren (angepasstes) Gelände in den Röhrenraum ragt
  for (const st of netz.strassen) {
    const r = st.halbbreite + 2.2;
    for (let i = 0; i < st.n - 1; i++) {
      if (st.flag[i] !== FLAG_TUNNEL && st.flag[i + 1] !== FLAG_TUNNEL) continue;
      const ax = st.x[i], az = st.z[i], dx = st.x[i + 1] - ax, dz = st.z[i + 1] - az;
      const l2 = dx * dx + dz * dz;
      const i0 = Math.max(0, Math.floor((Math.min(ax, ax + dx) - r + WELT_HALB) / RASTER)), i1 = Math.min(N - 2, Math.floor((Math.max(ax, ax + dx) + r + WELT_HALB) / RASTER));
      const j0 = Math.max(0, Math.floor((Math.min(az, az + dz) - r + WELT_HALB) / RASTER)), j1 = Math.min(N - 2, Math.floor((Math.max(az, az + dz) + r + WELT_HALB) / RASTER));
      for (let j = j0; j <= j1; j++) {
        for (let q = i0; q <= i1; q++) {
          // Zelle (q, j) mit Ecken q..q+1, j..j+1: Abstand der Zellmitte zur Achse
          const x = (q + 0.5) * RASTER - WELT_HALB, z = (j + 0.5) * RASTER - WELT_HALB;
          const t = klemme(((x - ax) * dx + (z - az) * dz) / l2, 0, 1);
          const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
          if (d > r + RASTER * 0.72) continue;
          const deck = st.y[i] + (st.y[i + 1] - st.y[i]) * t;
          const o = j * N + q;
          const tief = Math.min(hoehen[o], hoehen[o + 1], hoehen[o + N], hoehen[o + N + 1]);
          if (tief < deck + TUNNEL_HOEHE + 1.6) loch[j * (N - 1) + q] = 1;
        }
      }
    }
  }
}
