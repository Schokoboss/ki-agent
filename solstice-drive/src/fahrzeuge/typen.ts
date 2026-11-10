import type { Antriebsart } from '../physik/typen';

export type Klasse = 'kompakt' | 'sport' | 'klassik' | 'rallye' | 'gelaende' | 'super';
export const KLASSEN: readonly Klasse[] = ['kompakt', 'sport', 'klassik', 'rallye', 'gelaende', 'super'];

export type MotorTyp = 'sauger' | 'turbo' | 'v8' | 'hochdreh' | 'diesel' | 'elektro';
export type ReifenTyp = 'strasse' | 'sport' | 'renn' | 'rallye' | 'gelaende' | 'winter' | 'drift';
export type DiffTyp = 'offen' | 'lsd' | 'sperre';
export type KarosserieForm =
  | 'schraegheck' | 'coupe' | 'limousine' | 'kombi' | 'roadster' | 'muscle'
  | 'suv' | 'pickup' | 'buggy' | 'supersport' | 'keil' | 'bus' | 'truck';

export interface KlangProfil {
  zylinder: number;
  /** Tonhöhenfaktor der Zündfrequenz. */
  tonlage: number;
  /** 0 seidig … 1 rau/blubbernd. */
  rauheit: number;
  /** 0 dumpf … 1 hell/kreischend. */
  helligkeit: number;
  turbo?: boolean;
  elektro?: boolean;
}

export interface Karosserie {
  form: KarosserieForm;
  /** Zusätze: Heckflügel 0–2, Dachträger, Bullenfänger, Zusatzscheinwerfer, Lufthutze, Überrollkäfig. */
  fluegel?: number;
  dachtraeger?: boolean;
  schutzbuegel?: boolean;
  zusatzlicht?: boolean;
  hutze?: boolean;
  kaefig?: boolean;
  /** Zweitfarbe (Dach/Streifen) als Hex. */
  akzent?: number;
}

/** Stammdaten eines Autos. Alles Weitere leitet `berechneFahrwerte` daraus ab. */
export interface AutoDaten {
  id: string;
  marke: string;
  name: string;
  klasse: Klasse;
  jahr: number;
  preis: number;
  /** Nur als Fund in der Welt erhältlich. */
  versteckt?: boolean;
  antrieb: Antriebsart;
  /** Momentanteil vorn bei Allrad (Standard 0.4). */
  allradVorn?: number;
  masse: number;
  /** Gewichtsanteil auf der Vorderachse 0..1. */
  gewichtVorn: number;
  /** Motorleistung in kW. */
  leistung: number;
  maxDrehzahl: number;
  motor: MotorTyp;
  gaenge: number;
  /** Höchstgeschwindigkeit in km/h (bestimmt den Luftwiderstand). */
  vmax: number;
  radstand: number;
  spur: number;
  laenge: number;
  breite: number;
  hoehe: number;
  radRadius: number;
  reifen: ReifenTyp;
  /** Haftungsfaktor des Fahrwerks (1 = Klassenschnitt). */
  grip: number;
  /** Fahrwerk: Eigenfrequenz in Hz, Federweg und Bodenfreiheit in m, Dämpfungsgrad, Stabilisator 0..1, Schwerpunkthöhe in m. */
  frequenz: number;
  federweg: number;
  bodenfreiheit: number;
  daempfung: number;
  stabi: number;
  schwerpunkt: number;
  /** Abtriebsbeiwert × Fläche gesamt (m²) und Anteil vorn. */
  abtrieb: number;
  abtriebVorn?: number;
  /** Fahrverhalten: -1 heckfreudig … +1 untersteuernd-stabil. */
  balance: number;
  diff: DiffTyp;
  karosserie: Karosserie;
  klang: KlangProfil;
  /** Standardlack als Hex. */
  farbe: number;
}

export type TeilKategorie =
  | 'motor' | 'aufladung' | 'auspuff' | 'getriebe' | 'reifen' | 'fahrwerk' | 'bremsen' | 'gewicht' | 'aero' | 'differenzial';

export interface Feinabstimmung {
  /** Multiplikator der Achsübersetzung (0.8 lang … 1.25 kurz). */
  uebersetzung: number;
  /** Sturz in Grad (0 … -4). */
  sturzVorn: number;
  sturzHinten: number;
  /** Multiplikator der Federhärte (0.7 … 1.5). */
  federVorn: number;
  federHinten: number;
  /** Anteil der Bremskraft vorn (0.5 … 0.75). */
  bremsBalance: number;
  /** Fahrhöhe in m relativ zur Serie (-0.04 … +0.06). */
  fahrhoehe: number;
  /** Multiplikator Stabilisator (0.5 … 1.6). */
  stabiVorn: number;
  stabiHinten: number;
  /** Sperrwirkung 0..1 (nur mit Sportdifferenzial). */
  sperre: number;
  /** Abtrieb-Multiplikator (nur mit Aero-Teilen) 0.5 … 1.5. */
  abtrieb: number;
}

export interface Tuning {
  /** Ausbaustufe je Kategorie (0 = Serie). Bei 'reifen' Index in die Reifenliste. */
  teile: Record<TeilKategorie, number>;
  fein: Feinabstimmung;
}

export function serienFein(): Feinabstimmung {
  return {
    uebersetzung: 1, sturzVorn: -1, sturzHinten: -0.5, federVorn: 1, federHinten: 1, bremsBalance: 0.62,
    fahrhoehe: 0, stabiVorn: 1, stabiHinten: 1, sperre: 0.35, abtrieb: 1,
  };
}
export function serienTuning(): Tuning {
  return {
    teile: { motor: 0, aufladung: 0, auspuff: 0, getriebe: 0, reifen: 0, fahrwerk: 0, bremsen: 0, gewicht: 0, aero: 0, differenzial: 0 },
    fein: serienFein(),
  };
}
