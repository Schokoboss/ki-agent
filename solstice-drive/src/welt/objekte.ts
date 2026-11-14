import { hash2 } from '../engine/zufall';
import { rauschen2 } from '../engine/rauschen';
import { KACHEL, KACHELN, REGION, REGIONEN, SEE, WELT_HALB } from './daten/regionen';
import { FLAG_NORMAL, type StrassenTreffer } from './strassennetz';
import type { Weltkarte } from './weltkarte';

/** Objektarten der Welt. */
export const OBJ = {
  KIEFER: 0, LAUBBAUM: 1, PALME: 2, BUSCH: 3, FELS: 4, DUENENGRAS: 5,
  LEITPFOSTEN: 6, SCHILD: 7, LATERNE: 8, ZAUN: 9, HEUBALLEN: 10, KISTE: 11, PYLON: 12, STRANDSCHIRM: 13, ABSPERRUNG: 14, FASS: 15,
} as const;
export const OBJ_ANZAHL = 16;

export interface ObjektTyp {
  schluessel: string;
  /** Pflanze (wird zu einem Netz je Kachel verschmolzen) oder Requisit (einzeln, zerstörbar). */
  pflanze: boolean;
  /** Kollisionsradius in m bei Skala 1 (0 = keine Kollision). */
  radius: number;
  /** Fest: hält das Auto auf. Sonst: zerbricht beim Aufprall. */
  fest: boolean;
  /** Masse für den Impulsverlust beim Zerstören (kg). */
  masse: number;
  /** Skill-Punkte beim Zerstören. */
  punkte: number;
  hoehe: number;
}

export const OBJEKT_TYPEN: readonly ObjektTyp[] = [
  { schluessel: 'kiefer', pflanze: true, radius: 0.34, fest: true, masse: 0, punkte: 0, hoehe: 11 },
  { schluessel: 'laubbaum', pflanze: true, radius: 0.42, fest: true, masse: 0, punkte: 0, hoehe: 9 },
  { schluessel: 'palme', pflanze: true, radius: 0.3, fest: true, masse: 0, punkte: 0, hoehe: 8 },
  { schluessel: 'busch', pflanze: true, radius: 0, fest: false, masse: 0, punkte: 0, hoehe: 1.4 },
  { schluessel: 'fels', pflanze: true, radius: 0.95, fest: true, masse: 0, punkte: 0, hoehe: 1.5 },
  { schluessel: 'duenengras', pflanze: true, radius: 0, fest: false, masse: 0, punkte: 0, hoehe: 0.8 },
  { schluessel: 'leitpfosten', pflanze: false, radius: 0.18, fest: false, masse: 6, punkte: 40, hoehe: 1.0 },
  { schluessel: 'schild', pflanze: false, radius: 0.22, fest: false, masse: 25, punkte: 90, hoehe: 2.6 },
  { schluessel: 'laterne', pflanze: false, radius: 0.24, fest: false, masse: 70, punkte: 150, hoehe: 6.5 },
  { schluessel: 'zaun', pflanze: false, radius: 1.2, fest: false, masse: 18, punkte: 60, hoehe: 1.1 },
  { schluessel: 'heuballen', pflanze: false, radius: 0.85, fest: false, masse: 60, punkte: 120, hoehe: 1.4 },
  { schluessel: 'kiste', pflanze: false, radius: 0.6, fest: false, masse: 30, punkte: 80, hoehe: 1.0 },
  { schluessel: 'pylon', pflanze: false, radius: 0.25, fest: false, masse: 3, punkte: 30, hoehe: 0.7 },
  { schluessel: 'strandschirm', pflanze: false, radius: 0.3, fest: false, masse: 10, punkte: 70, hoehe: 2.3 },
  { schluessel: 'absperrung', pflanze: false, radius: 1.1, fest: false, masse: 22, punkte: 60, hoehe: 1.1 },
  { schluessel: 'fass', pflanze: false, radius: 0.4, fest: false, masse: 25, punkte: 70, hoehe: 0.95 },
];

/** Objekte einer Kachel als Spaltenfelder. */
export class KachelObjekte {
  n = 0;
  typ = new Uint8Array(64);
  x = new Float32Array(64);
  y = new Float32Array(64);
  z = new Float32Array(64);
  gier = new Float32Array(64);
  skala = new Float32Array(64);
  /** 0 = heil, 1 = zerstört. */
  zustand = new Uint8Array(64);
  /** Zähler, erhöht sich bei jeder Zustandsänderung (die Darstellung zieht nach). */
  version = 0;
  zuletztBenutzt = 0;

  fuege(typ: number, x: number, y: number, z: number, gier: number, skala: number): void {
    if (this.n === this.typ.length) {
      const neu = this.n * 2;
      const wachse = <T extends Uint8Array | Float32Array>(a: T): T => { const b = new (a.constructor as new (n: number) => T)(neu); b.set(a); return b; };
      this.typ = wachse(this.typ); this.x = wachse(this.x); this.y = wachse(this.y); this.z = wachse(this.z);
      this.gier = wachse(this.gier); this.skala = wachse(this.skala); this.zustand = wachse(this.zustand);
    }
    const i = this.n++;
    this.typ[i] = typ; this.x[i] = x; this.y[i] = y; this.z[i] = z; this.gier[i] = gier; this.skala[i] = skala;
  }
}

/** Sperrzonen, in denen keine Pflanzen wachsen (Mittelpunkt, Radius). */
const FREI: { x: number; z: number; r: number }[] = [
  { x: 150, z: 350, r: 300 },
];

const treffer: StrassenTreffer = { strasse: -1, i: 0, t: 0, u: 0, abstand: 0 };

/**
 * Erzeugt und verwaltet die Kleinobjekte der Welt, deterministisch je Kachel.
 * Dieselben Daten dienen der Darstellung und der Kollision.
 */
export class Objektverwaltung {
  private readonly cache = new Map<number, KachelObjekte>();
  private uhr = 0;
  /** Zusätzliche, von Spielinhalten gesetzte Objekte je Kachel (Festival, Events). */
  private readonly zusatz = new Map<number, [typ: number, x: number, z: number, gier: number, skala: number][]>();

  constructor(readonly karte: Weltkarte) {}

  static kachelIndex(x: number, z: number): number {
    const kx = Math.min(KACHELN - 1, Math.max(0, Math.floor((x + WELT_HALB) / KACHEL))), kz = Math.min(KACHELN - 1, Math.max(0, Math.floor((z + WELT_HALB) / KACHEL)));
    return kz * KACHELN + kx;
  }

  /** Setzt ein zusätzliches Requisit (vor dem ersten Abruf der Kachel). */
  setze(typ: number, x: number, z: number, gier = 0, skala = 1): void {
    const k = Objektverwaltung.kachelIndex(x, z);
    let l = this.zusatz.get(k);
    if (!l) { l = []; this.zusatz.set(k, l); }
    l.push([typ, x, z, gier, skala]);
    this.cache.delete(k);
  }

  kachel(index: number): KachelObjekte {
    let k = this.cache.get(index);
    if (!k) {
      k = this.erzeuge(index);
      this.cache.set(index, k);
      if (this.cache.size > 140) this.raeume();
    }
    k.zuletztBenutzt = ++this.uhr;
    return k;
  }

  private raeume(): void {
    const eintraege = [...this.cache.entries()].sort((a, b) => a[1].zuletztBenutzt - b[1].zuletztBenutzt);
    for (let i = 0; i < 40; i++) this.cache.delete(eintraege[i][0]);
  }

  /** Stellt alle zerstörten Objekte wieder her (z. B. vor einem Rennen). */
  stelleWiederHer(): void {
    for (const k of this.cache.values()) {
      let geaendert = false;
      for (let i = 0; i < k.n; i++) if (k.zustand[i]) { k.zustand[i] = 0; geaendert = true; }
      if (geaendert) k.version++;
    }
  }

  private erzeuge(index: number): KachelObjekte {
    const karte = this.karte, netz = karte.netz;
    const kx = index % KACHELN, kz = (index - kx) / KACHELN;
    const x0 = kx * KACHEL - WELT_HALB, z0 = kz * KACHEL - WELT_HALB;
    const k = new KachelObjekte();
    const wasser = 1.4; // höchster Wasserstand + Reserve
    // ---- Pflanzen auf einem verwackelten Gitter ----
    const schritt = 9.5;
    const n = Math.floor(KACHEL / schritt);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const gx = kx * n + i, gz = kz * n + j;
        const zufall = hash2(gx, gz, 11);
        const x = x0 + (i + hash2(gx, gz, 1)) * schritt, z = z0 + (j + hash2(gx, gz, 2)) * schritt;
        const region = karte.regionAn(x, z);
        if (region === REGION.MEER || region === REGION.STADT || region === REGION.FESTIVAL) continue;
        const h = karte.hoeheGelaende(x, z);
        if (h < wasser) continue;
        const hauf = rauschen2(x / 190 + 5, z / 190 - 3) * 0.5 + 0.5; // Haine und Lichtungen
        let typ = -1;
        if (region === REGION.WALD) {
          const dicht = 0.3 + 0.55 * hauf;
          if (zufall < dicht) typ = hash2(gx, gz, 3) < 0.68 ? OBJ.KIEFER : OBJ.LAUBBAUM;
          else if (zufall < dicht + 0.08) typ = OBJ.BUSCH;
        } else if (region === REGION.GEBIRGE) {
          if (h < 330 && zufall < 0.26 * hauf) typ = OBJ.KIEFER;
          else if (zufall > 0.955) typ = OBJ.FELS;
        } else if (region === REGION.DUENEN) {
          const oase = Math.hypot(x - REGIONEN[4].x, z - REGIONEN[4].z);
          if (oase < 170 && zufall < 0.3) typ = OBJ.PALME;
          else if (zufall < 0.075) typ = OBJ.DUENENGRAS;
          else if (zufall > 0.992) typ = OBJ.FELS;
        } else {
          // Küste und Tiefland: Palmen am Strand, Baumgruppen im Hinterland
          if (h < 7.5) { if (zufall < 0.07) typ = OBJ.PALME; else if (zufall < 0.1) typ = OBJ.DUENENGRAS; }
          else if (hauf > 0.62 && zufall < (hauf - 0.62) * 1.6) typ = hash2(gx, gz, 3) < 0.25 ? OBJ.KIEFER : OBJ.LAUBBAUM;
          else if (zufall > 0.975) typ = OBJ.BUSCH;
          else if (zufall > 0.968) typ = OBJ.FELS;
        }
        if (typ < 0) continue;
        // Hangneigung, Straßennähe, Sperrzonen
        const hx = karte.hoeheGelaende(x + 3, z) - h, hz = karte.hoeheGelaende(x, z + 3) - h;
        if (hx * hx + hz * hz > (typ === OBJ.FELS ? 9 : 3.2)) continue;
        if (netz.naechste(x, z, 16, treffer) && treffer.abstand < netz.strassen[treffer.strasse].halbbreite + 4.5) continue;
        let frei = true;
        for (const f of FREI) if ((x - f.x) * (x - f.x) + (z - f.z) * (z - f.z) < f.r * f.r) { frei = false; break; }
        if (!frei) continue;
        if ((x - SEE.x) * (x - SEE.x) + (z - SEE.z) * (z - SEE.z) < SEE.radius * SEE.radius * 1.2 && h < 3) continue;
        const skala = 0.75 + hash2(gx, gz, 4) * 0.6;
        k.fuege(typ, x, h, z, hash2(gx, gz, 5) * Math.PI * 2, skala);
      }
    }
    // ---- Straßenausstattung ----
    for (const st of netz.strassen) {
      if (st.x[0] < x0 - 3000 && st.x[st.n - 1] < x0 - 3000) continue;
      const asphalt = st.typ === 'schnellstrasse' || st.typ === 'landstrasse' || st.typ === 'bergstrasse';
      const stadt = st.typ === 'stadtstrasse';
      for (let i = 2; i < st.n - 2; i++) {
        const x = st.x[i], z = st.z[i];
        if (x < x0 || x >= x0 + KACHEL || z < z0 || z >= z0 + KACHEL) continue;
        if (st.flag[i] !== FLAG_NORMAL) continue;
        if (st.s[i] < 28 || st.laenge - st.s[i] < 28) continue;
        const a = Math.max(0, i - 1), b = Math.min(st.n - 1, i + 1);
        const dx = st.x[b] - st.x[a], dz = st.z[b] - st.z[a];
        const l = Math.hypot(dx, dz) || 1;
        const lx = dz / l, lz = -dx / l;
        const gier = Math.atan2(dx, dz);
        const hw = st.halbbreite;
        const zf = hash2(st.index, i, 21);
        const setze = (typ: number, seite: number, abstand: number, drehung = 0) => {
          const px = x + lx * seite * abstand, pz = z + lz * seite * abstand;
          k.fuege(typ, px, karte.hoeheGelaende(px, pz), pz, gier + drehung, 1);
        };
        if (asphalt) {
          if (i % 6 === 0) { setze(OBJ.LEITPFOSTEN, 1, hw + 1.0); setze(OBJ.LEITPFOSTEN, -1, hw + 1.0); }
          // Kurvenwarnschilder vor engen Kurven
          if (i % 9 === 4 && Math.abs(st.kurve[Math.min(st.n - 1, i + 8)]) > 0.02 && Math.abs(st.kurve[i]) < 0.008) setze(OBJ.SCHILD, -1, hw + 1.6);
          else if (i % 90 === 45) setze(OBJ.SCHILD, -1, hw + 1.6);
        } else if (stadt) {
          if (i % 5 === 2) setze(OBJ.LATERNE, i % 10 === 2 ? 1 : -1, hw + 0.9, i % 10 === 2 ? Math.PI / 2 : -Math.PI / 2);
          if (zf > 0.93) setze(zf > 0.965 ? OBJ.KISTE : OBJ.PYLON, zf > 0.95 ? 1 : -1, hw + 1.4);
        } else if (st.typ === 'feldweg' || st.typ === 'schotter') {
          const zaun = rauschen2(st.s[i] / 160 + st.index * 3.3, 1.5) > 0.25;
          if (zaun && i % 1 === 0 && karte.regionAn(x, z) === REGION.KUESTE) setze(OBJ.ZAUN, st.index % 2 ? 1 : -1, hw + 1.3);
          if (zf > 0.975) setze(OBJ.HEUBALLEN, zf > 0.99 ? 1 : -1, hw + 2.6);
        } else if (st.typ === 'sandpiste') {
          if (zf > 0.965) setze(zf > 0.985 ? OBJ.FASS : OBJ.PYLON, zf > 0.975 ? 1 : -1, hw + 1.0);
        }
      }
    }
    // ---- Heuballen auf Feldern, Strandschirme ----
    const m = Math.floor(KACHEL / 32);
    for (let j = 0; j < m; j++) {
      for (let i = 0; i < m; i++) {
        const gx = kx * m + i, gz = kz * m + j;
        const zufall = hash2(gx, gz, 31);
        if (zufall > 0.06) continue;
        const x = x0 + (i + hash2(gx, gz, 32)) * 32, z = z0 + (j + hash2(gx, gz, 33)) * 32;
        if (karte.regionAn(x, z) !== REGION.KUESTE) continue;
        const h = karte.hoeheGelaende(x, z);
        if (h < wasser + 0.4) continue;
        if (netz.naechste(x, z, 14, treffer)) continue;
        if (h < 4.2) k.fuege(OBJ.STRANDSCHIRM, x, h, z, zufall * 90, 1);
        else if (h > 9 && rauschen2(x / 300, z / 300 + 40) > 0.2) {
          k.fuege(OBJ.HEUBALLEN, x, h, z, zufall * 60, 1);
          const x2 = x + 2.2, z2 = z + 0.8;
          k.fuege(OBJ.HEUBALLEN, x2, karte.hoeheGelaende(x2, z2), z2, zufall * 60 + 0.5, 1);
        }
      }
    }
    for (const [typ, x, z, gier, skala] of this.zusatz.get(index) ?? []) {
      // y folgt dem Boden einschließlich Fahrbahn
      const kontakt = { hoehe: 0, nx: 0, ny: 1, nz: 0, untergrund: 0 };
      karte.abfrage(x, z, 1e6, kontakt);
      k.fuege(typ, x, kontakt.hoehe, z, gier, skala);
    }
    return k;
  }
}
