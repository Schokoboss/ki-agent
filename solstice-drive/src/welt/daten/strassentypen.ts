import { U } from '../../physik/untergrund';

export type StrassenTyp = 'schnellstrasse' | 'landstrasse' | 'bergstrasse' | 'stadtstrasse' | 'schotter' | 'feldweg' | 'sandpiste';

export interface StrassenTypDaten {
  /** Halbe Fahrbahnbreite in m. */
  halbbreite: number;
  untergrund: number;
  /** Größte Längsneigung (Anteil). */
  maxSteigung: number;
  /** Glättungsdurchläufe des Höhenprofils (mehr = ruhigere Trasse, mehr Dämme/Einschnitte). */
  glaettung: number;
  /** Glättung des Verlaufs in der Ebene (weniger = engere Kehren bleiben erhalten). */
  trasse: number;
  /** Richtgeschwindigkeit für Verkehr in m/s. */
  tempo: number;
  /** 0 keine, 1 Mittellinie, 2 Mittellinie + Randlinien, 3 mehrspurig. */
  markierung: number;
  /** Querneigung in Kurven (Faktor). */
  ueberhoehung: number;
  /** Farbe auf der Karte (RGB 0–255). */
  kartenfarbe: [number, number, number];
  kartenbreite: number;
}

export const STRASSENTYPEN: Record<StrassenTyp, StrassenTypDaten> = {
  schnellstrasse: { halbbreite: 7.5, untergrund: U.ASPHALT, maxSteigung: 0.065, glaettung: 140, trasse: 44, tempo: 36, markierung: 3, ueberhoehung: 1, kartenfarbe: [255, 214, 120], kartenbreite: 3.2 },
  landstrasse: { halbbreite: 5.0, untergrund: U.ASPHALT, maxSteigung: 0.09, glaettung: 70, trasse: 26, tempo: 27, markierung: 2, ueberhoehung: 1, kartenfarbe: [245, 245, 245], kartenbreite: 2.3 },
  bergstrasse: { halbbreite: 4.2, untergrund: U.ASPHALT, maxSteigung: 0.115, glaettung: 36, trasse: 8, tempo: 20, markierung: 1, ueberhoehung: 0.7, kartenfarbe: [235, 235, 235], kartenbreite: 2.0 },
  stadtstrasse: { halbbreite: 5.5, untergrund: U.ASPHALT, maxSteigung: 0.08, glaettung: 40, trasse: 10, tempo: 14, markierung: 2, ueberhoehung: 0, kartenfarbe: [225, 228, 240], kartenbreite: 2.2 },
  schotter: { halbbreite: 3.4, untergrund: U.SCHOTTER, maxSteigung: 0.14, glaettung: 22, trasse: 14, tempo: 18, markierung: 0, ueberhoehung: 0.4, kartenfarbe: [214, 180, 130], kartenbreite: 1.6 },
  feldweg: { halbbreite: 2.6, untergrund: U.ERDE, maxSteigung: 0.17, glaettung: 14, trasse: 10, tempo: 13, markierung: 0, ueberhoehung: 0.2, kartenfarbe: [170, 135, 95], kartenbreite: 1.2 },
  sandpiste: { halbbreite: 3.6, untergrund: U.SAND, maxSteigung: 0.15, glaettung: 26, trasse: 16, tempo: 17, markierung: 0, ueberhoehung: 0.3, kartenfarbe: [240, 215, 150], kartenbreite: 1.5 },
};

export interface OrtDef {
  id: string;
  x: number;
  z: number;
  /** Benannter Ort (erscheint auf der Karte, Schnellreiseziel) oder bloße Kreuzung. */
  benannt?: boolean;
}

export interface StrassenDef {
  id: string;
  typ: StrassenTyp;
  von: string;
  nach: string;
  /** Zwischenpunkte [x, z]. */
  ueber?: [number, number][];
  /** Gerade Verbindung ohne Trassensuche (Stadtstraßen, Bauwerke). */
  gerade?: boolean;
  bauwerk?: 'bruecke' | 'tunnel';
  /** Furt/Wattweg: folgt dem Boden ohne Damm und Brücke (kann überflutet sein). */
  furt?: boolean;
}
