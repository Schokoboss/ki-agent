import { Fahrzeug } from '../src/physik/fahrzeug';
import type { Boden, Bodenkontakt } from '../src/physik/typen';
import { standardUmwelt, type Umwelt } from '../src/physik/untergrund';
import { berechneFahrwerte } from '../src/fahrzeuge/fahrwerte';
import { autoNachId } from '../src/fahrzeuge/daten/autos';
import type { Tuning } from '../src/fahrzeuge/typen';

export const DT = 1 / 120;

/** Ebene Testfläche mit einheitlichem Untergrund. */
export function ebene(untergrund: number, hoehe = 0): Boden {
  return {
    abfrage(_x: number, _z: number, _y: number, aus: Bodenkontakt): void {
      aus.hoehe = hoehe; aus.nx = 0; aus.ny = 1; aus.nz = 0; aus.untergrund = untergrund;
    },
  };
}

export function neuesAuto(id: string, boden: Boden, tuning?: Tuning): Fahrzeug {
  const f = new Fahrzeug(berechneFahrwerte(autoNachId(id), tuning));
  f.setzeAuf(0, 0, 0, boden);
  return f;
}

export function simuliere(f: Fahrzeug, boden: Boden, sekunden: number, umwelt: Umwelt = standardUmwelt(), jeSchritt?: (t: number) => boolean | void): number {
  const n = Math.round(sekunden / DT);
  for (let i = 0; i < n; i++) {
    if (jeSchritt && jeSchritt(i * DT) === false) return i * DT;
    f.schritt(DT, boden, umwelt);
  }
  return sekunden;
}

/** Zeit von 0 auf ziel km/h mit Vollgas. */
export function beschleunigung(f: Fahrzeug, boden: Boden, zielKmh: number, umwelt?: Umwelt): number {
  f.gas = 1; f.bremse = 0; f.lenkung = 0;
  return simuliere(f, boden, 60, umwelt, () => f.tempo * 3.6 < zielKmh);
}

/** Bremsweg aus startKmh bis zum Stillstand (m). */
export function bremsweg(f: Fahrzeug, boden: Boden, startKmh: number, umwelt?: Umwelt): number {
  f.setzeAuf(0, 0, 0, boden);
  f.setzeTempo(startKmh / 3.6);
  simuliere(f, boden, 0.3, umwelt);
  const z0 = f.pos.z;
  f.setzeTempo(startKmh / 3.6);
  f.gas = 0; f.bremse = 1;
  simuliere(f, boden, 40, umwelt, () => f.tempo > 0.3);
  f.bremse = 0;
  return f.pos.z - z0;
}

/**
 * Höchste stationäre Querbeschleunigung (g): Kreisbahn (Radius 60 m, Mittelpunkt links) mit langsam
 * steigendem Tempo. Ein Zielpunkt-Regler hält die Bahn; gemessen wird v²/r, solange die Bahn gehalten wird.
 */
export function kurvengrenze(f: Fahrzeug, boden: Boden, umwelt?: Umwelt, protokoll = false): number {
  f.setzeAuf(0, 0, 0, boden);
  let maxG = 0, glattG = 0, letzte = -1;
  const radius = 60;
  simuliere(f, boden, 90, umwelt, (t) => {
    const zielTempo = 5 + t * 0.45;
    f.gas = f.tempo < zielTempo ? 0.55 : 0.05;
    f.bremse = 0;
    // Mittelpunkt bei (radius, 0): das Auto fährt gegen den Uhrzeigersinn (von oben), also Linkskurve
    const dx = f.pos.x - radius, dz = f.pos.z;
    const abstand = Math.sqrt(dx * dx + dz * dz);
    const winkel = Math.atan2(dz, dx);
    const voraus = Math.max(6, f.tempo * 0.55) / radius;
    // Fahrtrichtung: Winkel nimmt ab (Start bei PI, Kurs +z, Mittelpunkt links)
    const zx = radius + Math.cos(winkel - voraus) * radius, zz = Math.sin(winkel - voraus) * radius;
    const rx = zx - f.pos.x, rz = zz - f.pos.z;
    const querLinks = rx * f.links.x + rz * f.links.z;
    const vor = rx * f.vorn.x + rz * f.vorn.z;
    const zielWinkel = Math.atan2(querLinks, vor);
    f.lenkung = Math.max(-1, Math.min(1, -zielWinkel * 3.2));
    const fehler = abstand - radius;
    const querG = (f.tempo * f.tempo) / Math.max(1, abstand) / 9.81;
    glattG += (querG - glattG) * 0.01;
    if (Math.abs(fehler) < 3 && glattG > maxG) maxG = glattG;
    if (protokoll && Math.floor(t / 3) !== letzte) {
      letzte = Math.floor(t / 3);
      console.log(t.toFixed(0), 'v', (f.tempo * 3.6).toFixed(0), 'fehler', fehler.toFixed(2), 'g', querG.toFixed(2), 'lenk', f.lenkung.toFixed(2), 'beta', f.schwimmwinkel.toFixed(3));
    }
    return Math.abs(fehler) < 10;
  });
  return maxG;
}
