/** Untergründe und ihre Reifeneigenschaften. Reine Daten. */

export const U = {
  ASPHALT: 0, BETON: 1, SCHOTTER: 2, ERDE: 3, GRAS: 4, SAND: 5,
  SCHNEE: 6, EIS: 7, FELS: 8, FLACHWASSER: 9, PFLASTER: 10,
} as const;
export const UNTERGRUND_ANZAHL = 11;

export type ReifenKategorie = 'strasse' | 'lose' | 'winter';

export interface Untergrund {
  id: number;
  schluessel: string;
  kategorie: ReifenKategorie;
  /** Grundhaftung (Reibwert-Faktor). */
  grip: number;
  /** Haftungsfaktor bei voller Nässe. */
  nass: number;
  /** Streckt Schlupfwinkel/-verhältnis am Haftungsmaximum (lose Böden rutschen später, weicher). */
  schlupf: number;
  /** Anteil der Maximalkraft, der beim vollen Gleiten bleibt. */
  abfall: number;
  rollwiderstand: number;
  /** Geschwindigkeitsabhängiger Zusatzwiderstand (tiefer Sand, Wasser). */
  sog: number;
  /** Unebenheit: Amplitude in Metern und Wellenlänge in Metern. */
  rauAmp: number;
  rauLaenge: number;
  /** Farbe der Staub-/Spritzpartikel (RGB 0..1) und Menge 0..1. */
  staub: [number, number, number];
  staubMenge: number;
  /** Klangtyp für Reifengeräusch. */
  klang: 'asphalt' | 'schotter' | 'weich' | 'schnee' | 'wasser';
}

export const UNTERGRUENDE: readonly Untergrund[] = [
  { id: U.ASPHALT, schluessel: 'asphalt', kategorie: 'strasse', grip: 1.0, nass: 0.74, schlupf: 1.0, abfall: 0.86, rollwiderstand: 0.012, sog: 0, rauAmp: 0, rauLaenge: 1, staub: [0.75, 0.75, 0.75], staubMenge: 0.0, klang: 'asphalt' },
  { id: U.BETON, schluessel: 'beton', kategorie: 'strasse', grip: 0.96, nass: 0.76, schlupf: 1.0, abfall: 0.86, rollwiderstand: 0.013, sog: 0, rauAmp: 0.002, rauLaenge: 4, staub: [0.8, 0.8, 0.78], staubMenge: 0.0, klang: 'asphalt' },
  { id: U.SCHOTTER, schluessel: 'schotter', kategorie: 'lose', grip: 0.70, nass: 0.9, schlupf: 2.0, abfall: 0.93, rollwiderstand: 0.028, sog: 0, rauAmp: 0.012, rauLaenge: 1.3, staub: [0.72, 0.64, 0.52], staubMenge: 0.8, klang: 'schotter' },
  { id: U.ERDE, schluessel: 'erde', kategorie: 'lose', grip: 0.64, nass: 0.72, schlupf: 2.2, abfall: 0.92, rollwiderstand: 0.035, sog: 0.01, rauAmp: 0.022, rauLaenge: 2.6, staub: [0.5, 0.38, 0.27], staubMenge: 0.7, klang: 'schotter' },
  { id: U.GRAS, schluessel: 'gras', kategorie: 'lose', grip: 0.56, nass: 0.7, schlupf: 2.3, abfall: 0.9, rollwiderstand: 0.05, sog: 0.015, rauAmp: 0.028, rauLaenge: 3.4, staub: [0.38, 0.5, 0.25], staubMenge: 0.35, klang: 'weich' },
  { id: U.SAND, schluessel: 'sand', kategorie: 'lose', grip: 0.52, nass: 1.12, schlupf: 2.8, abfall: 0.95, rollwiderstand: 0.085, sog: 0.035, rauAmp: 0.02, rauLaenge: 5.5, staub: [0.9, 0.8, 0.58], staubMenge: 1.0, klang: 'weich' },
  { id: U.SCHNEE, schluessel: 'schnee', kategorie: 'winter', grip: 0.36, nass: 1.0, schlupf: 2.6, abfall: 0.94, rollwiderstand: 0.06, sog: 0.02, rauAmp: 0.015, rauLaenge: 3.0, staub: [0.95, 0.97, 1.0], staubMenge: 0.9, klang: 'schnee' },
  { id: U.EIS, schluessel: 'eis', kategorie: 'winter', grip: 0.16, nass: 0.9, schlupf: 1.6, abfall: 0.9, rollwiderstand: 0.01, sog: 0, rauAmp: 0.0, rauLaenge: 1, staub: [0.9, 0.95, 1.0], staubMenge: 0.15, klang: 'schnee' },
  { id: U.FELS, schluessel: 'fels', kategorie: 'lose', grip: 0.78, nass: 0.75, schlupf: 1.3, abfall: 0.88, rollwiderstand: 0.03, sog: 0, rauAmp: 0.05, rauLaenge: 2.4, staub: [0.6, 0.6, 0.6], staubMenge: 0.25, klang: 'schotter' },
  { id: U.FLACHWASSER, schluessel: 'flachwasser', kategorie: 'lose', grip: 0.5, nass: 1.0, schlupf: 2.6, abfall: 0.95, rollwiderstand: 0.1, sog: 0.09, rauAmp: 0.015, rauLaenge: 5, staub: [0.85, 0.92, 1.0], staubMenge: 1.0, klang: 'wasser' },
  { id: U.PFLASTER, schluessel: 'pflaster', kategorie: 'strasse', grip: 0.9, nass: 0.68, schlupf: 1.1, abfall: 0.88, rollwiderstand: 0.018, sog: 0, rauAmp: 0.008, rauLaenge: 0.7, staub: [0.7, 0.68, 0.64], staubMenge: 0.0, klang: 'asphalt' },
];

/** Umweltzustand, der die Physik beeinflusst. */
export interface Umwelt {
  /** 0 trocken … 1 klatschnass. */
  naesse: number;
  /** Höhe der Wasseroberfläche (Meer/See). */
  wasserHoehe: number;
  /** Globaler Haftungsfaktor (z. B. Laub im Herbst auf losem Grund). */
  gripLose: number;
  gripStrasse: number;
}

export function standardUmwelt(): Umwelt {
  return { naesse: 0, wasserHoehe: -1000, gripLose: 1, gripStrasse: 1 };
}
