/** Regionen von Kap Aurora. Reine Daten: Lage, Ausdehnung und Geländecharakter. */

export const REGION = {
  MEER: 0, KUESTE: 1, GEBIRGE: 2, WALD: 3, DUENEN: 4, STADT: 5, FESTIVAL: 6,
} as const;
export type RegionId = (typeof REGION)[keyof typeof REGION];

export const REGION_SCHLUESSEL: Record<number, string> = {
  0: 'meer', 1: 'kueste', 2: 'gebirge', 3: 'wald', 4: 'duenen', 5: 'stadt', 6: 'festival',
};

export const WELT_GROESSE = 8192;
export const WELT_HALB = WELT_GROESSE / 2;
/** Rasterweite der Höhenkarte in m und Anzahl Stützstellen je Achse. */
export const RASTER = 8;
export const RASTER_N = WELT_GROESSE / RASTER + 1;
export const KACHEL = 256;
export const KACHELN = WELT_GROESSE / KACHEL;

export interface RegionDef {
  id: RegionId;
  /** Mittelpunkt und Einflussradius in m. */
  x: number; z: number; radius: number;
  /** Gewicht (Dominanz gegenüber Nachbarn). */
  gewicht: number;
}

export const REGIONEN: readonly RegionDef[] = [
  { id: REGION.FESTIVAL, x: 150, z: 350, radius: 560, gewicht: 1.5 },
  { id: REGION.STADT, x: -2700, z: 2100, radius: 760, gewicht: 1.5 },
  { id: REGION.GEBIRGE, x: 1550, z: -1650, radius: 1500, gewicht: 1.15 },
  { id: REGION.WALD, x: -1750, z: -1450, radius: 1500, gewicht: 1.0 },
  { id: REGION.DUENEN, x: 1950, z: 1750, radius: 1250, gewicht: 1.0 },
];

/** Landmassen (weiche Vereinigung von Kreisen) – Hauptinsel und Nebeninseln. */
export const LANDMASSEN: readonly { x: number; z: number; radius: number }[] = [
  { x: 0, z: 0, radius: 2500 },
  { x: -1700, z: -1400, radius: 1600 },
  { x: 1550, z: -1650, radius: 1800 },
  { x: 1950, z: 1750, radius: 1550 },
  { x: -2150, z: 1850, radius: 1350 },
  { x: -150, z: 3330, radius: 520 }, // Südkap-Insel
  { x: -3330, z: -3080, radius: 400 }, // Leuchtfeuer-Insel
  { x: 3560, z: 150, radius: 360 }, // Wattinsel (über den Wattweg erreichbar)
];

/** Spiegelsee im Nebelwald: im Winter zugefroren und befahrbar. */
export const SEE = { x: -1380, z: -820, radius: 300 };
/** Wattweg zur Wattinsel: liegt knapp über dem Meer, im Frühling überflutet. */
export const WATTWEG = { x0: 2560, z0: 200, x1: 3260, z1: 170, hoehe: 0.55, breite: 60 };

/** Wasserstand je Jahreszeit (m). */
export const WASSERSTAND = { fruehling: 1.0, sommer: -0.5, herbst: 0, winter: -0.25 } as const;
