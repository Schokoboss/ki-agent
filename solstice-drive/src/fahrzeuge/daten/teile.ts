import type { ReifenTyp, TeilKategorie } from '../typen';

/** Wirkung einer Ausbaustufe. Nicht gesetzte Felder bedeuten „keine Änderung“. */
export interface TeilStufe {
  /** Preisanteil am Fahrzeuggrundpreis. */
  preisAnteil: number;
  leistung?: number;
  masse?: number;
  schaltzeit?: number;
  gaenge?: number;
  bremse?: number;
  abtrieb?: number;
  frequenz?: number;
  daempfung?: number;
  federweg?: number;
  bodenfreiheit?: number;
  schwerpunkt?: number;
  stabi?: number;
}

export interface TeilGruppe {
  kategorie: TeilKategorie;
  /** Stufe 0 ist immer die Serie. */
  stufen: TeilStufe[];
}

/** Tuningteile. Namen der Stufen stehen in den Sprachdateien unter `teil.<kategorie>.<stufe>`. */
export const TEILE: Record<Exclude<TeilKategorie, 'reifen'>, TeilGruppe> = {
  motor: { kategorie: 'motor', stufen: [
    { preisAnteil: 0, leistung: 1 }, { preisAnteil: 0.10, leistung: 1.08 }, { preisAnteil: 0.2, leistung: 1.17 }, { preisAnteil: 0.36, leistung: 1.28 },
  ] },
  aufladung: { kategorie: 'aufladung', stufen: [
    { preisAnteil: 0, leistung: 1 }, { preisAnteil: 0.12, leistung: 1.1 }, { preisAnteil: 0.24, leistung: 1.22 }, { preisAnteil: 0.4, leistung: 1.36 },
  ] },
  auspuff: { kategorie: 'auspuff', stufen: [
    { preisAnteil: 0, leistung: 1 }, { preisAnteil: 0.04, leistung: 1.03 }, { preisAnteil: 0.08, leistung: 1.05 }, { preisAnteil: 0.13, leistung: 1.07 },
  ] },
  getriebe: { kategorie: 'getriebe', stufen: [
    { preisAnteil: 0, schaltzeit: 1 }, { preisAnteil: 0.07, schaltzeit: 0.75 }, { preisAnteil: 0.14, schaltzeit: 0.55, gaenge: 1 }, { preisAnteil: 0.24, schaltzeit: 0.4, gaenge: 1 },
  ] },
  fahrwerk: { kategorie: 'fahrwerk', stufen: [
    { preisAnteil: 0 },
    { preisAnteil: 0.08, frequenz: 1.12, daempfung: 0.07, schwerpunkt: -0.02, stabi: 0.1 },
    { preisAnteil: 0.18, frequenz: 1.26, daempfung: 0.13, schwerpunkt: -0.035, stabi: 0.2 },
    { preisAnteil: 0.15, frequenz: 0.94, daempfung: 0.1, federweg: 1.4, bodenfreiheit: 0.05, schwerpunkt: 0.03, stabi: -0.15 },
  ] },
  bremsen: { kategorie: 'bremsen', stufen: [
    { preisAnteil: 0, bremse: 1 }, { preisAnteil: 0.05, bremse: 1.1 }, { preisAnteil: 0.1, bremse: 1.2 }, { preisAnteil: 0.18, bremse: 1.32 },
  ] },
  gewicht: { kategorie: 'gewicht', stufen: [
    { preisAnteil: 0, masse: 1 }, { preisAnteil: 0.08, masse: 0.955 }, { preisAnteil: 0.18, masse: 0.91 }, { preisAnteil: 0.32, masse: 0.86 },
  ] },
  aero: { kategorie: 'aero', stufen: [
    { preisAnteil: 0, abtrieb: 0 }, { preisAnteil: 0.06, abtrieb: 0.5 }, { preisAnteil: 0.13, abtrieb: 1.1 }, { preisAnteil: 0.22, abtrieb: 1.8 },
  ] },
  differenzial: { kategorie: 'differenzial', stufen: [
    { preisAnteil: 0 }, { preisAnteil: 0.06 }, { preisAnteil: 0.12 }, { preisAnteil: 0.09 },
  ] },
};

/** Wählbare Reifen (Index 0 im Tuning = Serienreifen des Autos). */
export const REIFEN_WAHL: readonly ReifenTyp[] = ['strasse', 'sport', 'renn', 'rallye', 'gelaende', 'winter', 'drift'];
export const REIFEN_PREIS: Record<ReifenTyp, number> = {
  strasse: 800, sport: 2200, renn: 6500, rallye: 2800, gelaende: 2600, winter: 1800, drift: 2400,
};
