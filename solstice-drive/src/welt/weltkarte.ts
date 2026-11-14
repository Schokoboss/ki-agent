import { glatt, klemme } from '../engine/mathe';
import { rauschen2 } from '../engine/rauschen';
import type { Boden, Bodenkontakt } from '../physik/typen';
import { U } from '../physik/untergrund';
import { REGION, REGIONEN, RASTER, RASTER_N, SEE, WASSERSTAND, WELT_HALB, type RegionId } from './daten/regionen';
import { ORTE, STRASSEN } from './daten/strassen';
import { landmaske, regionsGewichte, rohHoehe } from './gelaendeform';
import { baueStrassennetz, passeGelaendeAn, FLAG_BRUECKE, FLAG_NORMAL, FLAG_TUNNEL, TUNNEL_HOEHE, type Strassennetz, type Strasse } from './strassennetz';
import type { Jahreszeit } from './atmosphaere';

/** Angaben zur Straße unter dem zuletzt abgefragten Punkt (für Spiellogik). */
export interface StrassenKontakt {
  /** Index der Straße oder -1. */
  strasse: number;
  segment: number;
  t: number;
  u: number;
  flag: number;
}

const N = RASTER_N;

/**
 * Die Welt als Daten: Höhenraster, Regionen, Straßennetz. Liefert der Physik den Boden
 * (geschichtet: Gelände, Fahrbahn, Brücken, Tunnel, Eis) und der Darstellung die Geometrie.
 */
export class Weltkarte implements Boden {
  /** Geländehöhen mit eingearbeiteten Straßen. */
  readonly hoehen: Float32Array;
  /** Geländehöhen ohne Straßen. */
  readonly roh: Float32Array;
  /** Regions-ID je Rasterpunkt. */
  readonly region: Uint8Array;
  /** 1 = Rasterzelle wird nicht gezeichnet (Tunnelportal). */
  readonly loch: Uint8Array;
  readonly netz: Strassennetz;
  jahreszeit: Jahreszeit = 'sommer';
  /** Straße unter dem zuletzt mit `abfrage` geprüften Punkt. */
  readonly letzteStrasse: StrassenKontakt = { strasse: -1, segment: 0, t: 0, u: 0, flag: 0 };

  constructor(roh: Float32Array, region: Uint8Array, netz: Strassennetz) {
    this.roh = roh;
    this.region = region;
    this.netz = netz;
    this.hoehen = new Float32Array(roh);
    this.loch = new Uint8Array((N - 1) * (N - 1));
    passeGelaendeAn(netz, roh, this.hoehen, this.loch);
  }

  get wasserHoehe(): number { return WASSERSTAND[this.jahreszeit]; }
  get seeGefroren(): boolean { return this.jahreszeit === 'winter'; }

  /** Geländehöhe (ohne Fahrbahnen), exakt wie das gezeichnete Dreiecksnetz. */
  hoeheGelaende(x: number, z: number): number {
    const gx = klemme((x + WELT_HALB) / RASTER, 0, N - 1.0001), gz = klemme((z + WELT_HALB) / RASTER, 0, N - 1.0001);
    const i = Math.floor(gx), j = Math.floor(gz);
    const fx = gx - i, fz = gz - j;
    const h = this.hoehen, o = j * N + i;
    const a = h[o], b = h[o + 1], c = h[o + N], d = h[o + N + 1];
    return fx + fz <= 1 ? a + (b - a) * fx + (c - a) * fz : d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
  }

  regionAn(x: number, z: number): RegionId {
    const i = klemme(Math.round((x + WELT_HALB) / RASTER), 0, N - 1), j = klemme(Math.round((z + WELT_HALB) / RASTER), 0, N - 1);
    return this.region[j * N + i] as RegionId;
  }

  /** Untergrund abseits der Straße aus Region, Höhe, Hangneigung und Jahreszeit. */
  untergrundGelaende(x: number, z: number, h: number, ny: number): number {
    if (h < this.wasserHoehe + 0.15) return U.FLACHWASSER;
    const region = this.regionAn(x, z);
    const winter = this.jahreszeit === 'winter';
    if (ny < 0.74) return U.FELS;
    let u: number;
    switch (region) {
      case REGION.GEBIRGE:
        if (h > 430 + rauschen2(x / 90, z / 90) * 25) return U.SCHNEE;
        u = ny < 0.88 || h > 310 ? U.FELS : U.GRAS;
        break;
      case REGION.WALD: u = rauschen2(x / 60 + 3, z / 60) > 0.25 ? U.GRAS : U.ERDE; break;
      case REGION.DUENEN: u = U.SAND; break;
      case REGION.STADT: u = h < 3.2 ? U.SAND : U.BETON; break;
      case REGION.FESTIVAL: u = U.GRAS; break;
      default: u = h < 4.6 ? U.SAND : U.GRAS;
    }
    if (winter && u !== U.SAND && u !== U.BETON && h > 5) return U.SCHNEE;
    if (winter && (u === U.SAND || u === U.BETON) && h > 60) return U.SCHNEE;
    return u;
  }

  /** Untergrund einer Fahrbahn unter Berücksichtigung der Jahreszeit. */
  untergrundStrasse(st: Strasse, hoehe: number): number {
    const u = st.daten.untergrund;
    if (this.jahreszeit === 'winter') {
      if (u === U.ASPHALT) return hoehe > 300 ? U.SCHNEE : U.ASPHALT;
      if (u === U.SCHOTTER || u === U.ERDE) return hoehe > 25 ? U.SCHNEE : u;
    }
    return u;
  }

  abfrage(x: number, z: number, y: number, aus: Bodenkontakt): void {
    // --- Gelände ---
    const gx = klemme((x + WELT_HALB) / RASTER, 0, N - 1.0001), gz = klemme((z + WELT_HALB) / RASTER, 0, N - 1.0001);
    const i = Math.floor(gx), j = Math.floor(gz);
    const fx = gx - i, fz = gz - j;
    const h = this.hoehen, o = j * N + i;
    const a = h[o], b = h[o + 1], c = h[o + N], d = h[o + N + 1];
    const hT = fx + fz <= 1 ? a + (b - a) * fx + (c - a) * fz : d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
    // weiche Normale aus interpolierten Kantengefällen
    const gxh = ((b - a) * (1 - fz) + (d - c) * fz) / RASTER, gzh = ((c - a) * (1 - fx) + (d - b) * fx) / RASTER;
    let nl = Math.sqrt(gxh * gxh + 1 + gzh * gzh);
    let hoehe = hT, nx = -gxh / nl, ny = 1 / nl, nz = -gzh / nl;
    let untergrund = -1;
    const ls = this.letzteStrasse;
    ls.strasse = -1;

    // --- Fahrbahnen ---
    const netz = this.netz;
    const zelle = netz.zelle(x, z);
    if (zelle >= 0) {
      const starts = netz.starts, refs = netz.refs;
      let bestDeck = -1e9;
      for (let r = starts[zelle]; r < starts[zelle + 1]; r++) {
        const ref = refs[r];
        const st = netz.strassen[ref >> 14], k = ref & 16383;
        const ax = st.x[k], az = st.z[k];
        const dx = st.x[k + 1] - ax, dz = st.z[k + 1] - az;
        const l2 = dx * dx + dz * dz;
        const tRoh = ((x - ax) * dx + (z - az) * dz) / l2;
        if (tRoh < -0.25 || tRoh > 1.25) continue;
        const t = tRoh < 0 ? 0 : tRoh > 1 ? 1 : tRoh;
        const px = ax + dx * t, pz = az + dz * t;
        const l = Math.sqrt(l2);
        const u = ((x - px) * dz - (z - pz) * dx) / l;
        const ex = x - px, ez = z - pz;
        const dist = Math.sqrt(ex * ex + ez * ez);
        const hw = st.halbbreite;
        const flag = st.flag[k] | st.flag[k + 1];
        const bankett = flag === FLAG_NORMAL ? 1.5 : 0.4;
        if (dist > hw + bankett) continue;
        const quer = st.quer[k] + (st.quer[k + 1] - st.quer[k]) * t;
        const dy = st.y[k + 1] - st.y[k];
        let deck = st.y[k] + dy * t + klemme(u, -hw, hw) * quer;
        if (dist > hw) deck -= ((dist - hw) / bankett) * 0.34;
        // Schichtregeln: Brücke nur von oben, Tunnel nur von innen
        if (flag & FLAG_BRUECKE) { if (y < deck - 1.2) continue; }
        else if (flag & FLAG_TUNNEL) { if (y > deck + TUNNEL_HOEHE) continue; }
        if (deck <= bestDeck) continue;
        bestDeck = deck;
        hoehe = deck;
        // Normale aus Längs- und Querneigung: n = T × L
        const tx = dx / l, ty = dy / l, tz = dz / l;
        const lx = dz / l, ly = dist > hw ? 0 : quer, lz = -dx / l;
        nx = ty * lz - tz * ly; ny = tz * lx - tx * lz; nz = tx * ly - ty * lx;
        nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
        nx /= nl; ny /= nl; nz /= nl;
        if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
        untergrund = dist > hw ? (st.daten.untergrund === U.ASPHALT ? U.SCHOTTER : U.ERDE) : this.untergrundStrasse(st, deck);
        ls.strasse = st.index; ls.segment = k; ls.t = t; ls.u = u; ls.flag = flag;
      }
    }

    // --- Zugefrorener Spiegelsee ---
    if (untergrund < 0 && this.seeGefroren) {
      const eis = this.wasserHoehe;
      if (hT < eis) {
        const ds = (x - SEE.x) * (x - SEE.x) + (z - SEE.z) * (z - SEE.z);
        if (ds < SEE.radius * SEE.radius * 2.6) { hoehe = eis; nx = 0; ny = 1; nz = 0; untergrund = U.EIS; }
      }
    }
    if (untergrund < 0) untergrund = this.untergrundGelaende(x, z, hT, ny);
    aus.hoehe = hoehe; aus.nx = nx; aus.ny = ny; aus.nz = nz; aus.untergrund = untergrund;
  }

  /** true, wenn der Punkt in tiefem Wasser liegt (Auto wird zurückgesetzt). */
  istTiefesWasser(x: number, z: number): boolean {
    const h = this.hoeheGelaende(x, z);
    if (this.seeGefroren && h < this.wasserHoehe) {
      const ds = (x - SEE.x) * (x - SEE.x) + (z - SEE.z) * (z - SEE.z);
      if (ds < SEE.radius * SEE.radius * 2.6) return false;
    }
    return h < this.wasserHoehe - 1.1;
  }
}

/** Erzeugt die komplette Welt. `fortschritt` wird mit 0..1 aufgerufen (Ladebalken). */
export function erzeugeWeltkarte(fortschritt?: (anteil: number, schritt: string) => void): Weltkarte {
  const roh = new Float32Array(N * N);
  const region = new Uint8Array(N * N);
  const gew = new Float64Array(REGIONEN.length + 1);
  for (let j = 0; j < N; j++) {
    const z = j * RASTER - WELT_HALB;
    for (let i = 0; i < N; i++) {
      const x = i * RASTER - WELT_HALB;
      const h = rohHoehe(x, z);
      const o = j * N + i;
      roh[o] = h;
      if (h < -0.2 && landmaske(x, z) <= 0) { region[o] = REGION.MEER; continue; }
      regionsGewichte(x, z, gew);
      let best = 0, wert = gew[0];
      for (let r = 1; r <= REGIONEN.length; r++) if (gew[r] > wert) { wert = gew[r]; best = r; }
      region[o] = best === 0 ? REGION.KUESTE : REGIONEN[best - 1].id;
    }
    if (fortschritt && j % 128 === 0) fortschritt((j / N) * 0.6, 'gelaende');
  }
  fortschritt?.(0.6, 'strassen');
  const wasserMax = Math.max(...Object.values(WASSERSTAND));
  const netz = baueStrassennetz({ roh, orte: ORTE, strassen: STRASSEN, wasserMax });
  fortschritt?.(0.9, 'anpassen');
  const karte = new Weltkarte(roh, region, netz);
  fortschritt?.(1, 'fertig');
  return karte;
}

void glatt; void FLAG_TUNNEL;
