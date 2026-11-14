import { Fahrzeug } from './fahrzeug';
import { Schaden } from './schaden';
import { Hindernisraster, rechteckUeberlappung, stossAutos } from './kollision';
import type { Boden, Fahrwerte } from './typen';
import { standardUmwelt, type Umwelt } from './untergrund';

/** Ein Fahrzeug in der Simulation samt Schadenszustand. */
export interface Teilnehmer {
  id: number;
  f: Fahrzeug;
  schaden: Schaden;
  /** Geister nehmen an keiner Kollision teil. */
  geist: boolean;
  aktiv: boolean;
}

export interface PhysikEreignis {
  art: 'aufprall' | 'zerstoert' | 'autokontakt' | 'landung';
  teilnehmer: number;
  anderer: number;
  x: number; y: number; z: number;
  /** Aufprallgeschwindigkeit in m/s. */
  staerke: number;
  /** Bei 'zerstoert': Objektart. */
  objekt: number;
  /** Kontaktpunkt im Fahrzeugsystem des Teilnehmers und Stoßrichtung (Welt). */
  lx: number; lz: number; nx: number; nz: number;
}

export type WeltKollision = (t: Teilnehmer, welt: Physikwelt) => void;

/**
 * Simulationskern: alle Fahrzeuge, ihr Boden und ihre Kollisionen. Frei von DOM und Darstellung –
 * läuft identisch im Browser, in Tests und im Rauchtest.
 */
export class Physikwelt {
  readonly teilnehmer: Teilnehmer[] = [];
  readonly umwelt: Umwelt = standardUmwelt();
  readonly hindernisse = new Hindernisraster();
  /** Ereignisse seit dem letzten Leeren (die Spielschicht liest und leert sie). */
  readonly ereignisse: PhysikEreignis[] = [];
  /** Kollision mit Weltobjekten (wird vom Weltmodul gesetzt). */
  weltKollision: WeltKollision | null = null;
  zeit = 0;
  private naechsteId = 1;

  constructor(public boden: Boden) {}

  fuegeHinzu(werte: Fahrwerte, geist = false): Teilnehmer {
    const t: Teilnehmer = { id: this.naechsteId++, f: new Fahrzeug(werte), schaden: new Schaden(), geist, aktiv: true };
    this.teilnehmer.push(t);
    return t;
  }

  entferne(t: Teilnehmer): void {
    const i = this.teilnehmer.indexOf(t);
    if (i >= 0) this.teilnehmer.splice(i, 1);
  }

  melde(e: PhysikEreignis): void {
    if (this.ereignisse.length < 64) this.ereignisse.push(e);
  }

  schritt(dt: number): void {
    const liste = this.teilnehmer;
    for (let i = 0; i < liste.length; i++) {
      const t = liste[i];
      if (!t.aktiv) continue;
      const f = t.f;
      f.schritt(dt, this.boden, this.umwelt);
      if (f.landung > 2.5) {
        this.melde({ art: 'landung', teilnehmer: t.id, anderer: 0, x: f.pos.x, y: f.pos.y, z: f.pos.z, staerke: f.landung, objekt: -1, lx: 0, lz: 0, nx: 0, nz: 0 });
      }
    }
    if (this.weltKollision) {
      for (let i = 0; i < liste.length; i++) if (liste[i].aktiv && !liste[i].geist) this.weltKollision(liste[i], this);
    }
    // Auto gegen Auto
    for (let i = 0; i < liste.length; i++) {
      const a = liste[i];
      if (!a.aktiv || a.geist) continue;
      const fa = a.f;
      for (let j = i + 1; j < liste.length; j++) {
        const b = liste[j];
        if (!b.aktiv || b.geist) continue;
        const fb = b.f;
        const dx = fa.pos.x - fb.pos.x, dz = fa.pos.z - fb.pos.z;
        const reich = (fa.w.laenge + fb.w.laenge) * 0.5 + 1;
        if (dx * dx + dz * dz > reich * reich) continue;
        if (Math.abs(fa.pos.y - fb.pos.y) > (fa.w.hoehe + fb.w.hoehe) * 0.5) continue;
        const la = Math.hypot(fa.vorn.x, fa.vorn.z), lb = Math.hypot(fb.vorn.x, fb.vorn.z);
        if (la < 0.3 || lb < 0.3) continue;
        const u = rechteckUeberlappung(
          fa.pos.x, fa.pos.z, fa.vorn.x / la, fa.vorn.z / la, fa.w.laenge / 2, fa.w.breite / 2,
          fb.pos.x, fb.pos.z, fb.vorn.x / lb, fb.vorn.z / lb, fb.w.laenge / 2, fb.w.breite / 2,
        );
        if (!u) continue;
        const py = (fa.pos.y + fb.pos.y) * 0.5 - 0.1;
        const va = fa.tempo, vb = fb.tempo;
        const staerke = stossAutos(fa, fb, u.px, py, u.pz, u.nx, u.nz, u.tiefe);
        if (staerke > 0.5) {
          const anteilA = fb.w.masse / (fa.w.masse + fb.w.masse);
          const ax = u.px - fa.pos.x, az = u.pz - fa.pos.z, bx = u.px - fb.pos.x, bz = u.pz - fb.pos.z;
          const alx = ax * fa.links.x + az * fa.links.z, alz = ax * fa.vorn.x + az * fa.vorn.z;
          const blx = bx * fb.links.x + bz * fb.links.z, blz = bx * fb.vorn.x + bz * fb.vorn.z;
          a.schaden.aufprall(fa, alx, alz, staerke * anteilA * 1.6);
          b.schaden.aufprall(fb, blx, blz, staerke * (1 - anteilA) * 1.6);
          this.melde({ art: 'autokontakt', teilnehmer: a.id, anderer: b.id, x: u.px, y: py, z: u.pz, staerke, objekt: -1, lx: alx, lz: alz, nx: u.nx, nz: u.nz });
          this.melde({ art: 'autokontakt', teilnehmer: b.id, anderer: a.id, x: u.px, y: py, z: u.pz, staerke, objekt: -1, lx: blx, lz: blz, nx: -u.nx, nz: -u.nz });
        }
        void va; void vb;
      }
    }
    this.zeit += dt;
  }
}
