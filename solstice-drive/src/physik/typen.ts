import type { ReifenKategorie } from './untergrund';

/** Ergebnis einer Bodenabfrage. */
export interface Bodenkontakt {
  hoehe: number;
  nx: number; ny: number; nz: number;
  untergrund: number;
}

/** Bodenquelle für die Physik. y ist die Bezugshöhe (für Brücken/Tunnel: höchste Schicht unterhalb y + Toleranz). */
export interface Boden {
  abfrage(x: number, z: number, y: number, aus: Bodenkontakt): void;
}

export type Antriebsart = 'FWD' | 'RWD' | 'AWD';

export interface Differenzial {
  /** Sperrmoment je rad/s Drehzahlunterschied (Nm·s). */
  viskos: number;
  /** Grundsperrmoment (Nm). */
  vorlast: number;
  /** Sperranteil am Antriebsmoment 0..1. */
  sperre: number;
}

export interface ReifenWerte {
  gripLaengs: number;
  gripQuer: number;
  /** Haftungsfaktor je Untergrundkategorie. */
  kategorie: Record<ReifenKategorie, number>;
  /** Zusätzlicher Nässeverlust (Slicks) 0..1. */
  nassVerlust: number;
  /** Schlupfwinkel am Haftungsmaximum auf Asphalt (rad). */
  winkelPeak: number;
  /** Schlupfverhältnis am Haftungsmaximum auf Asphalt. */
  schlupfPeak: number;
  lastEmpfindlichkeit: number;
}

/** Alle Zahlen, die die Fahrphysik für ein konkretes (getuntes) Auto braucht. */
export interface Fahrwerte {
  masse: number;
  /** Trägheitsmomente um Körperachsen: x (Nicken), y (Gieren), z (Rollen). */
  traegheit: [number, number, number];
  schwerpunktHoehe: number;
  /** Abstand Schwerpunkt → Vorder-/Hinterachse. */
  achsVorn: number;
  achsHinten: number;
  spurVorn: number;
  spurHinten: number;
  radRadius: number;
  radTraegheit: number;
  federweg: number;
  federRate: [number, number];
  daempferDruck: [number, number];
  daempferZug: [number, number];
  stabi: [number, number];
  /** Höhe des Rollzentrums über dem Boden als Anteil der Schwerpunkthöhe (0 = Boden). */
  rollzentrum: number;
  reifenVorn: ReifenWerte;
  reifenHinten: ReifenWerte;
  /** Drehmomentkurve (Nm) gleichmäßig über [0, maxDrehzahl]. */
  motorKurve: number[];
  leerlauf: number;
  maxDrehzahl: number;
  motorTraegheit: number;
  motorBremse: number;
  gaenge: number[];
  rueckwaertsgang: number;
  achsuebersetzung: number;
  schaltzeit: number;
  wirkungsgrad: number;
  /** Anteil des Antriebsmoments an der Vorderachse (0 = Heck, 1 = Front). */
  antriebVorn: number;
  diffVorn: Differenzial;
  diffHinten: Differenzial;
  diffMitte: Differenzial;
  bremsMoment: number;
  /** Anteil der Bremskraft vorn. */
  bremsBalance: number;
  handbremsMoment: number;
  /** cw × Stirnfläche (m²). */
  luftwiderstand: number;
  /** Abtriebsbeiwert × Fläche vorn/hinten (m²). */
  abtrieb: [number, number];
  maxLenkwinkel: number;
  laenge: number;
  breite: number;
  hoehe: number;
  /** Bodenfreiheit im Stand. */
  bodenfreiheit: number;
}

export interface Fahrhilfen {
  abs: boolean;
  tcs: boolean;
  esp: boolean;
  /** 0 = aus, 0.6 = normal, 1 = stark (Lenkung folgt der Bewegungsrichtung). */
  lenkhilfe: number;
  automatik: boolean;
}

export const HILFEN_STANDARD: Fahrhilfen = { abs: true, tcs: false, esp: false, lenkhilfe: 0.6, automatik: true };
export const HILFEN_EINSTEIGER: Fahrhilfen = { abs: true, tcs: true, esp: true, lenkhilfe: 1, automatik: true };
export const HILFEN_PROFI: Fahrhilfen = { abs: false, tcs: false, esp: false, lenkhilfe: 0, automatik: false };
