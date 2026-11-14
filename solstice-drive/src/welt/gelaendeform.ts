import { fbm, grat, rauschen2 } from '../engine/rauschen';
import { glatt, klemme01, mische } from '../engine/mathe';
import { LANDMASSEN, REGION, REGIONEN, SEE, WATTWEG, type RegionId } from './daten/regionen';

/**
 * Analytische Geländeform von Kap Aurora (ohne Straßen). Deterministisch.
 * Liefert Rohhöhe und Regionsgewichte; die Weltkarte tastet dies auf das Raster ab.
 */

const _gew = new Float64Array(REGIONEN.length + 1);

/** Landmaske: > 0 Land, < 0 Meer. Etwa „Anteil des Radius ins Landesinnere“. */
export function landmaske(x: number, z: number): number {
  let s = 0;
  const k = 7;
  for (const l of LANDMASSEN) {
    const d = Math.sqrt((x - l.x) * (x - l.x) + (z - l.z) * (z - l.z));
    // Abstand zur Kreislinie in km (positiv innen)
    s += Math.exp(k * ((l.radius - d) / 1000));
  }
  const m = Math.log(s) / k; // km ins Landesinnere (weiches Maximum)
  // Küstenlinie ausfransen: Buchten und Landzungen
  const rausch = fbm(x / 1400 + 3.1, z / 1400 - 1.7, 4) * 0.38 + rauschen2(x / 330, z / 330) * 0.06;
  return m + rausch;
}

/** Regionsgewichte (Index 0 = Küste/Tiefland, 1.. = REGIONEN in Datenreihenfolge), normiert. */
export function regionsGewichte(x: number, z: number, aus: Float64Array = _gew): Float64Array {
  const wx = x + rauschen2(x / 600 + 9, z / 600) * 140, wz = z + rauschen2(x / 600 - 4, z / 600 + 7) * 140;
  let summe = 0.42;
  aus[0] = 0.42;
  for (let i = 0; i < REGIONEN.length; i++) {
    const r = REGIONEN[i];
    const d = Math.sqrt((wx - r.x) * (wx - r.x) + (wz - r.z) * (wz - r.z)) / r.radius;
    const g = r.gewicht * Math.exp(-d * d * 2.4);
    aus[i + 1] = g;
    summe += g;
  }
  for (let i = 0; i <= REGIONEN.length; i++) aus[i] /= summe;
  return aus;
}

/** Dominante Region an einem Punkt (ohne Meer/Strand-Sonderfälle). */
export function regionAn(x: number, z: number): RegionId {
  const g = regionsGewichte(x, z);
  let best = 0, wert = g[0];
  for (let i = 1; i <= REGIONEN.length; i++) if (g[i] > wert) { wert = g[i]; best = i; }
  return best === 0 ? REGION.KUESTE : REGIONEN[best - 1].id;
}

function regionsHoehe(id: RegionId, x: number, z: number): number {
  switch (id) {
    case REGION.FESTIVAL: return 40 + rauschen2(x / 260, z / 260) * 1.6;
    case REGION.STADT: return 6.5 + rauschen2(x / 300, z / 300) * 0.7;
    case REGION.GEBIRGE: {
      const g = grat(x / 1500 + 1.3, z / 1500 + 0.4, 5);
      return 110 + 560 * Math.pow(g, 1.25) + fbm(x / 240, z / 240, 3) * 26;
    }
    case REGION.WALD: {
      const h = fbm(x / 760 - 2.2, z / 760 + 5.1, 5) * 0.5 + 0.5;
      return 46 + 120 * h * h + rauschen2(x / 150, z / 150) * 7;
    }
    case REGION.DUENEN: {
      const d = grat(x / 460 + 7.7, z / 460 - 3.3, 3);
      return 13 + 30 * d + rauschen2(x / 900, z / 900) * 6;
    }
    default: {
      const h = fbm(x / 1000 + 4.4, z / 1000 + 8.8, 4) * 0.5 + 0.5;
      return 12 + 30 * h + rauschen2(x / 210, z / 210) * 3;
    }
  }
}

/** Rohhöhe des Geländes in m (Meeresspiegel = 0, Meeresboden negativ). */
export function rohHoehe(x: number, z: number): number {
  const m = landmaske(x, z);
  let h: number;
  if (m <= 0) {
    // Meeresboden fällt sanft ab
    h = -1.2 - 34 * klemme01(-m / 0.5) - 3 * klemme01(-m / 0.06);
  } else {
    const g = regionsGewichte(x, z);
    let land = g[0] * regionsHoehe(REGION.KUESTE, x, z);
    for (let i = 0; i < REGIONEN.length; i++) {
      if (g[i + 1] > 0.003) land += g[i + 1] * regionsHoehe(REGIONEN[i].id, x, z);
    }
    // Strand: erst flach, dann Anstieg ins Hinterland
    const strand = glatt(0, 0.07, m);
    const hinterland = Math.pow(glatt(0.02, 0.3, m), 1.4);
    h = 0.4 + strand * 2.4 + hinterland * Math.max(0, land - 2.8);
  }
  // Spiegelsee
  const ds = Math.sqrt((x - SEE.x) * (x - SEE.x) + (z - SEE.z) * (z - SEE.z));
  if (ds < SEE.radius * 1.5) {
    const rand = SEE.radius * (1 + rauschen2(x / 140, z / 140) * 0.16);
    h = mische(h, -6, glatt(rand * 1.25, rand * 0.72, ds));
  }
  // Wattweg: flacher Sandrücken zwischen Hauptinsel und Wattinsel
  const wx = WATTWEG.x1 - WATTWEG.x0, wz = WATTWEG.z1 - WATTWEG.z0;
  const wl = wx * wx + wz * wz;
  const t = ((x - WATTWEG.x0) * wx + (z - WATTWEG.z0) * wz) / wl;
  if (t > -0.3 && t < 1.3) {
    const px = WATTWEG.x0 + wx * t, pz = WATTWEG.z0 + wz * t;
    const d = Math.sqrt((x - px) * (x - px) + (z - pz) * (z - pz));
    const laengs = glatt(-0.3, 0.0, t) * glatt(1.3, 1.0, t);
    const f = glatt(WATTWEG.breite, WATTWEG.breite * 0.35, d) * laengs;
    if (f > 0 && h < WATTWEG.hoehe + 1.5) h = mische(h, WATTWEG.hoehe, f);
  }
  return h;
}
