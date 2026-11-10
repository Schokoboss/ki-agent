import type { AutoDaten } from '../typen';

/**
 * Fuhrpark von Kap Aurora. Alle Marken und Modelle sind frei erfunden.
 * Ein neues Auto hinzufügen: Eintrag ergänzen, Namen/Beschreibung in ui/i18n ist optional
 * (ohne Eintrag wird `marke + name` angezeigt). Siehe README, Abschnitt „Autos hinzufügen“.
 */
export const AUTOS: readonly AutoDaten[] = [
  // ---------------- Kompakt ----------------
  {
    id: 'tavio-pico', marke: 'Tavio', name: 'Pico GT', klasse: 'kompakt', jahr: 2019, preis: 18000,
    antrieb: 'FWD', masse: 1090, gewichtVorn: 0.62, leistung: 132, maxDrehzahl: 6800, motor: 'turbo', gaenge: 6, vmax: 222,
    radstand: 2.48, spur: 1.5, laenge: 3.92, breite: 1.74, hoehe: 1.43, radRadius: 0.3,
    reifen: 'strasse', grip: 1.0, frequenz: 1.85, federweg: 0.17, bodenfreiheit: 0.14, daempfung: 0.45, stabi: 0.5, schwerpunkt: 0.5,
    abtrieb: 0.1, balance: 0.35, diff: 'offen',
    karosserie: { form: 'schraegheck', fluegel: 1 },
    klang: { zylinder: 4, tonlage: 1.0, rauheit: 0.35, helligkeit: 0.55, turbo: true }, farbe: 0xf2b21a,
  },
  // ---------------- Sport ----------------
  {
    id: 'aurel-s7', marke: 'Aurel', name: 'S7 Coupé', klasse: 'sport', jahr: 2022, preis: 62000,
    antrieb: 'RWD', masse: 1420, gewichtVorn: 0.5, leistung: 285, maxDrehzahl: 7400, motor: 'sauger', gaenge: 6, vmax: 272,
    radstand: 2.62, spur: 1.58, laenge: 4.42, breite: 1.84, hoehe: 1.29, radRadius: 0.33,
    reifen: 'sport', grip: 1.02, frequenz: 2.0, federweg: 0.15, bodenfreiheit: 0.12, daempfung: 0.5, stabi: 0.6, schwerpunkt: 0.46,
    abtrieb: 0.35, balance: 0.1, diff: 'lsd',
    karosserie: { form: 'coupe' },
    klang: { zylinder: 6, tonlage: 1.05, rauheit: 0.3, helligkeit: 0.7 }, farbe: 0xc8202a,
  },
  // ---------------- Klassik ----------------
  {
    id: 'halde-donner', marke: 'Halde', name: 'Donner 427', klasse: 'klassik', jahr: 1969, preis: 54000,
    antrieb: 'RWD', masse: 1610, gewichtVorn: 0.56, leistung: 276, maxDrehzahl: 5900, motor: 'v8', gaenge: 4, vmax: 228,
    radstand: 2.82, spur: 1.52, laenge: 4.86, breite: 1.9, hoehe: 1.33, radRadius: 0.34,
    reifen: 'strasse', grip: 0.92, frequenz: 1.5, federweg: 0.19, bodenfreiheit: 0.15, daempfung: 0.36, stabi: 0.35, schwerpunkt: 0.53,
    abtrieb: 0.0, balance: -0.5, diff: 'lsd',
    karosserie: { form: 'muscle', hutze: true },
    klang: { zylinder: 8, tonlage: 0.82, rauheit: 0.85, helligkeit: 0.35 }, farbe: 0x1c3f8c,
  },
  // ---------------- Rallye ----------------
  {
    id: 'brask-fjell', marke: 'Brask', name: 'Fjell R', klasse: 'rallye', jahr: 2004, preis: 46000,
    antrieb: 'AWD', allradVorn: 0.42, masse: 1290, gewichtVorn: 0.57, leistung: 232, maxDrehzahl: 7000, motor: 'turbo', gaenge: 6, vmax: 218,
    radstand: 2.54, spur: 1.52, laenge: 4.38, breite: 1.78, hoehe: 1.44, radRadius: 0.33,
    reifen: 'rallye', grip: 1.04, frequenz: 1.7, federweg: 0.26, bodenfreiheit: 0.2, daempfung: 0.55, stabi: 0.3, schwerpunkt: 0.54,
    abtrieb: 0.3, balance: -0.1, diff: 'lsd',
    karosserie: { form: 'limousine', fluegel: 2, zusatzlicht: true },
    klang: { zylinder: 4, tonlage: 0.94, rauheit: 0.7, helligkeit: 0.6, turbo: true }, farbe: 0x1d6fd1,
  },
  // ---------------- Gelände ----------------
  {
    id: 'dunmark-bison', marke: 'Dunmark', name: 'Bison 4x4', klasse: 'gelaende', jahr: 2016, preis: 49000,
    antrieb: 'AWD', allradVorn: 0.5, masse: 2080, gewichtVorn: 0.54, leistung: 224, maxDrehzahl: 5200, motor: 'diesel', gaenge: 6, vmax: 182,
    radstand: 2.92, spur: 1.66, laenge: 4.82, breite: 1.96, hoehe: 1.86, radRadius: 0.42,
    reifen: 'gelaende', grip: 1.0, frequenz: 1.35, federweg: 0.34, bodenfreiheit: 0.29, daempfung: 0.5, stabi: 0.2, schwerpunkt: 0.74,
    abtrieb: 0, balance: 0.4, diff: 'sperre',
    karosserie: { form: 'suv', schutzbuegel: true, dachtraeger: true },
    klang: { zylinder: 6, tonlage: 0.72, rauheit: 0.6, helligkeit: 0.25, turbo: true }, farbe: 0x56683a,
  },
  // ---------------- Super ----------------
  {
    id: 'meridan-solara', marke: 'Meridan', name: 'Solara V12', klasse: 'super', jahr: 2024, preis: 420000,
    antrieb: 'RWD', masse: 1480, gewichtVorn: 0.42, leistung: 588, maxDrehzahl: 9000, motor: 'hochdreh', gaenge: 7, vmax: 352,
    radstand: 2.7, spur: 1.68, laenge: 4.62, breite: 1.98, hoehe: 1.14, radRadius: 0.35,
    reifen: 'sport', grip: 1.12, frequenz: 2.4, federweg: 0.12, bodenfreiheit: 0.1, daempfung: 0.6, stabi: 0.75, schwerpunkt: 0.4,
    abtrieb: 1.5, abtriebVorn: 0.4, balance: 0.15, diff: 'lsd',
    karosserie: { form: 'supersport', fluegel: 1 },
    klang: { zylinder: 12, tonlage: 1.2, rauheit: 0.2, helligkeit: 0.95 }, farbe: 0xff6a13,
  },
];

const NACH_ID = new Map(AUTOS.map((a) => [a.id, a]));
export function autoNachId(id: string): AutoDaten {
  const a = NACH_ID.get(id);
  if (!a) throw new Error(`Unbekanntes Auto: ${id}`);
  return a;
}
