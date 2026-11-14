import type { Fahrzeug } from './fahrzeug';
import { klemme01 } from '../engine/mathe';

/** Schadenszonen: vorn, hinten, links, rechts (je 0..1). */
export class Schaden {
  readonly zonen = new Float32Array(4);
  /** Mechanische Auswirkungen ein/aus (Einstellung). */
  mechanisch = false;
  /** Schaden ganz abschalten (z. B. Schaustück-Events). */
  aktiv = true;

  get gesamt(): number { return (this.zonen[0] + this.zonen[1] + this.zonen[2] + this.zonen[3]) / 4; }

  /**
   * Verbucht einen Aufprall. (lx, lz): Kontaktpunkt im Fahrzeugsystem (x links, z vorn),
   * deltaV: Geschwindigkeitsänderung in m/s. Liefert die hinzugekommene Schadensmenge.
   */
  aufprall(f: Fahrzeug, lx: number, lz: number, deltaV: number): number {
    if (!this.aktiv || deltaV < 1.5) return 0;
    const menge = klemme01((deltaV - 1.5) / 22);
    const hb = f.w.breite / 2, hl = f.w.laenge / 2;
    const seitlich = Math.abs(lx) / hb > Math.abs(lz) / hl;
    const zone = seitlich ? (lx > 0 ? 2 : 3) : lz > 0 ? 0 : 1;
    const vorher = this.zonen[zone];
    this.zonen[zone] = Math.min(1, vorher + menge);
    this.wende(f);
    return this.zonen[zone] - vorher;
  }

  /** Überträgt den Schaden auf die mechanischen Werte des Fahrzeugs. */
  wende(f: Fahrzeug): void {
    const z = this.zonen;
    if (!this.mechanisch) { f.mech.leistung = 1; f.mech.zug = 0; f.mech.federung = 1; f.mech.luft = 1; return; }
    f.mech.leistung = 1 - 0.28 * Math.pow(z[0], 1.5);
    f.mech.zug = (z[2] - z[3]) * 0.035 * (0.4 + z[0]);
    f.mech.federung = 1 - 0.18 * Math.max(z[2], z[3]);
    f.mech.luft = 1 + 0.2 * this.gesamt;
  }

  repariere(f: Fahrzeug): void {
    this.zonen.fill(0);
    this.wende(f);
  }
}
