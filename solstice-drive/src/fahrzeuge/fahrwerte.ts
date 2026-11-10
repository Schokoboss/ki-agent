import { klemme, glatt } from '../engine/mathe';
import type { Differenzial, Fahrwerte, ReifenWerte } from '../physik/typen';
import type { AutoDaten, MotorTyp, ReifenTyp, Tuning, DiffTyp } from './typen';
import { serienTuning } from './typen';
import { TEILE, REIFEN_WAHL } from './daten/teile';

const G = 9.81;

/** Normierte Drehmomentform über x = Drehzahl / Höchstdrehzahl. */
export function momentForm(typ: MotorTyp, x: number): number {
  const glocke = (xp: number, wl: number, wr: number) => {
    const d = x < xp ? (x - xp) / wl : (x - xp) / wr;
    return Math.max(0.3, 1 - d * d);
  };
  switch (typ) {
    case 'sauger': return glocke(0.68, 1.0, 0.75);
    case 'turbo': return x < 0.4 ? 0.4 + 0.6 * glatt(0.1, 0.4, x) : x < 0.74 ? 1 : 1 - (x - 0.74) * 0.85;
    case 'v8': return glocke(0.5, 0.9, 0.95);
    case 'hochdreh': return glocke(0.82, 1.15, 0.5);
    case 'diesel': return glocke(0.4, 0.7, 0.8);
    case 'elektro': return x < 0.3 ? 1 : 0.3 / x;
  }
}

const REIFEN: Record<ReifenTyp, ReifenWerte> = {
  strasse: { gripLaengs: 1.22, gripQuer: 1.0, kategorie: { strasse: 1, lose: 0.8, winter: 0.72 }, nassVerlust: 0, winkelPeak: 0.14, schlupfPeak: 0.12, lastEmpfindlichkeit: 0.1 },
  sport: { gripLaengs: 1.32, gripQuer: 1.09, kategorie: { strasse: 1, lose: 0.74, winter: 0.62 }, nassVerlust: 0.02, winkelPeak: 0.125, schlupfPeak: 0.11, lastEmpfindlichkeit: 0.09 },
  renn: { gripLaengs: 1.5, gripQuer: 1.24, kategorie: { strasse: 1, lose: 0.62, winter: 0.48 }, nassVerlust: 0.14, winkelPeak: 0.105, schlupfPeak: 0.1, lastEmpfindlichkeit: 0.07 },
  rallye: { gripLaengs: 1.2, gripQuer: 0.97, kategorie: { strasse: 1, lose: 1.14, winter: 1.05 }, nassVerlust: 0, winkelPeak: 0.15, schlupfPeak: 0.13, lastEmpfindlichkeit: 0.1 },
  gelaende: { gripLaengs: 1.1, gripQuer: 0.88, kategorie: { strasse: 1, lose: 1.22, winter: 1.12 }, nassVerlust: 0, winkelPeak: 0.17, schlupfPeak: 0.14, lastEmpfindlichkeit: 0.12 },
  winter: { gripLaengs: 1.12, gripQuer: 0.92, kategorie: { strasse: 1, lose: 1.0, winter: 1.5 }, nassVerlust: -0.04, winkelPeak: 0.15, schlupfPeak: 0.13, lastEmpfindlichkeit: 0.1 },
  drift: { gripLaengs: 1.2, gripQuer: 0.93, kategorie: { strasse: 1, lose: 0.76, winter: 0.6 }, nassVerlust: 0, winkelPeak: 0.17, schlupfPeak: 0.15, lastEmpfindlichkeit: 0.08 },
};

function diff(typ: DiffTyp, sperre?: number): Differenzial {
  if (sperre !== undefined) return { viskos: 12 + 28 * sperre, vorlast: 30 + 250 * sperre, sperre: klemme(sperre, 0, 1) };
  switch (typ) {
    case 'offen': return { viskos: 4, vorlast: 20, sperre: 0.05 };
    case 'lsd': return { viskos: 22, vorlast: 90, sperre: 0.38 };
    case 'sperre': return { viskos: 40, vorlast: 420, sperre: 1 };
  }
}

/** Welche Reifen fährt das Auto mit diesem Tuning? */
export function reifenTyp(auto: AutoDaten, tuning: Tuning): ReifenTyp {
  return tuning.teile.reifen === 0 ? auto.reifen : REIFEN_WAHL[tuning.teile.reifen - 1];
}

/** Motorleistung (kW) inklusive Tuning. */
export function leistungMitTuning(auto: AutoDaten, tuning: Tuning): number {
  const t = tuning.teile;
  let f = TEILE.motor.stufen[t.motor].leistung! * TEILE.auspuff.stufen[t.auspuff].leistung!;
  if (auto.motor !== 'elektro') f *= TEILE.aufladung.stufen[t.aufladung].leistung!;
  else f *= 1 + 0.06 * t.aufladung;
  return auto.leistung * f;
}
export function masseMitTuning(auto: AutoDaten, tuning: Tuning): number {
  return auto.masse * TEILE.gewicht.stufen[tuning.teile.gewicht].masse! - 6 * tuning.teile.auspuff;
}

/** Leitet aus Stammdaten und Tuning alle Physikwerte ab. */
export function berechneFahrwerte(auto: AutoDaten, tuning: Tuning = serienTuning()): Fahrwerte {
  const t = tuning.teile, fein = tuning.fein;
  const masse = masseMitTuning(auto, tuning);
  const leistung = leistungMitTuning(auto, tuning) * 1000;
  const maxDrehzahl = auto.maxDrehzahl + (auto.motor === 'elektro' ? 0 : 250 * t.motor);
  const fw = TEILE.fahrwerk.stufen[t.fahrwerk];
  const r = auto.radRadius;

  // Motorkurve so skalieren, dass die Spitzenleistung stimmt
  const N = 20;
  const form: number[] = [];
  let maxP = 0;
  for (let i = 0; i <= N; i++) {
    const x = i / N;
    const f = momentForm(auto.motor, x);
    form.push(f);
    maxP = Math.max(maxP, f * x * maxDrehzahl * (Math.PI / 30));
  }
  const motorKurve = form.map((f) => (f * leistung) / maxP);
  const maxMoment = Math.max(...motorKurve);

  // Getriebe
  const wirkungsgrad = auto.antrieb === 'AWD' ? 0.87 : 0.91;
  const vmax = auto.vmax / 3.6;
  const achsuebersetzung = 3.9 * fein.uebersetzung;
  const omMax = maxDrehzahl * (Math.PI / 30);
  const gaenge: number[] = [];
  const gesamtTop = (omMax * r) / (vmax * 1.07);
  if (auto.motor === 'elektro') {
    gaenge.push((omMax * r) / (vmax * 1.04) / 3.9);
  } else {
    const n = auto.gaenge + (TEILE.getriebe.stufen[t.getriebe].gaenge ?? 0);
    const v1 = klemme(vmax * 0.245, 12.5, 21);
    const gesamtErster = (omMax * r) / v1;
    for (let i = 0; i < n; i++) {
      const u = Math.pow(i / (n - 1), 0.82);
      gaenge.push((gesamtErster * Math.pow(gesamtTop / gesamtErster, u)) / 3.9);
    }
  }

  // Luftwiderstand aus Serienleistung und Höchstgeschwindigkeit
  const pRad = auto.leistung * 1000 * wirkungsgrad * 0.97;
  const abtriebGesamt = (auto.abtrieb + TEILE.aero.stufen[t.aero].abtrieb!) * (t.aero > 0 ? fein.abtrieb : 1);
  let luftwiderstand = (pRad - masse * G * 0.014 * vmax) / (0.5 * 1.2 * vmax * vmax * vmax);
  luftwiderstand = Math.max(0.35, luftwiderstand) + TEILE.aero.stufen[t.aero].abtrieb! * 0.1 * (t.aero > 0 ? fein.abtrieb : 1);
  const abV = auto.abtriebVorn ?? 0.42;

  // Geometrie
  const achsVorn = auto.radstand * (1 - auto.gewichtVorn);
  const achsHinten = auto.radstand * auto.gewichtVorn;
  const hoeheOffset = t.fahrwerk > 0 ? fein.fahrhoehe : 0;
  const schwerpunktHoehe = auto.schwerpunkt + (fw.schwerpunkt ?? 0) + hoeheOffset;
  const bodenfreiheit = Math.max(0.07, auto.bodenfreiheit + (fw.bodenfreiheit ?? 0) + hoeheOffset);

  // Fahrwerk
  const statV = (masse * G * achsHinten) / auto.radstand / 2;
  const statH = (masse * G * achsVorn) / auto.radstand / 2;
  const freq = auto.frequenz * (fw.frequenz ?? 1);
  const kV = (statV / G) * Math.pow(2 * Math.PI * freq, 2) * (t.fahrwerk > 0 ? fein.federVorn : 1);
  const kH = (statH / G) * Math.pow(2 * Math.PI * freq * 1.07, 2) * (t.fahrwerk > 0 ? fein.federHinten : 1);
  const zeta = auto.daempfung + (fw.daempfung ?? 0);
  const cV = 2 * Math.sqrt(kV * (statV / G)), cH = 2 * Math.sqrt(kH * (statH / G));
  let federweg = auto.federweg * (fw.federweg ?? 1);
  federweg = Math.max(federweg, (Math.max(statV / kV, statH / kH)) / 0.5);
  const stabiF = auto.stabi + (fw.stabi ?? 0);

  // Reifen
  const typ = reifenTyp(auto, tuning);
  const basis = REIFEN[typ];
  const sturz = (grad: number) => 0.022 * (1 - Math.pow((grad + 2.2) / 2.2, 2));
  const reifen = (vorn: boolean): ReifenWerte => {
    const bal = 1 + (vorn ? -0.035 : 0.035) * auto.balance;
    const st = vorn ? fein.sturzVorn : fein.sturzHinten;
    return {
      ...basis,
      kategorie: { ...basis.kategorie },
      gripQuer: basis.gripQuer * auto.grip * bal * (1 + sturz(st)),
      gripLaengs: basis.gripLaengs * auto.grip * (1 + 0.004 * st),
    };
  };

  // Antrieb
  const antriebVorn = auto.antrieb === 'FWD' ? 1 : auto.antrieb === 'RWD' ? 0 : auto.allradVorn ?? 0.4;
  const diffStufe = t.differenzial;
  const diffTyp: DiffTyp = diffStufe === 3 ? 'sperre' : auto.diff;
  const einstellbar = diffStufe === 1 || diffStufe === 2 ? klemme(fein.sperre * (diffStufe === 2 ? 1.25 : 1), 0, 1) : undefined;
  const achsDiff = diff(diffTyp, einstellbar);
  const offen = diff('offen');

  const bremsF = TEILE.bremsen.stufen[t.bremsen].bremse!;
  return {
    masse,
    traegheit: [
      (masse / 12) * (auto.laenge * auto.laenge + auto.hoehe * auto.hoehe),
      (masse / 12) * (auto.laenge * auto.laenge + auto.breite * auto.breite) * 0.92,
      (masse / 12) * (auto.breite * auto.breite + auto.hoehe * auto.hoehe) * 1.5,
    ],
    schwerpunktHoehe,
    achsVorn, achsHinten,
    spurVorn: auto.spur, spurHinten: auto.spur,
    radRadius: r,
    radTraegheit: 0.55 + 4.5 * r * r,
    federweg,
    federRate: [kV, kH],
    daempferDruck: [zeta * cV * 0.8, zeta * cH * 0.8],
    daempferZug: [zeta * cV * 1.3, zeta * cH * 1.3],
    stabi: [stabiF * kV * 0.75 * (t.fahrwerk > 0 ? fein.stabiVorn : 1), stabiF * kH * 0.6 * (t.fahrwerk > 0 ? fein.stabiHinten : 1)],
    rollzentrum: schwerpunktHoehe > 0.62 ? 0.58 : 0.42,
    reifenVorn: reifen(true),
    reifenHinten: reifen(false),
    motorKurve,
    leerlauf: auto.motor === 'elektro' ? 0 : Math.round(maxDrehzahl * 0.13),
    maxDrehzahl,
    motorTraegheit: auto.motor === 'elektro' ? 0.04 : 0.12 + maxMoment / 4000,
    motorBremse: auto.motor === 'elektro' ? maxMoment * 0.18 : maxMoment * 0.2,
    gaenge,
    rueckwaertsgang: auto.motor === 'elektro' ? gaenge[0] : gaenge[0] * 0.9,
    achsuebersetzung,
    schaltzeit: auto.motor === 'elektro' ? 0 : (auto.klasse === 'super' ? 0.12 : auto.klasse === 'klassik' ? 0.32 : 0.22) * TEILE.getriebe.stufen[t.getriebe].schaltzeit!,
    wirkungsgrad,
    antriebVorn,
    diffVorn: antriebVorn > 0 ? (auto.antrieb === 'AWD' ? diff(diffTyp === 'sperre' ? 'lsd' : diffTyp, einstellbar !== undefined ? einstellbar * 0.6 : undefined) : achsDiff) : offen,
    diffHinten: antriebVorn < 1 ? achsDiff : offen,
    diffMitte: { viskos: 30, vorlast: 160, sperre: 0.5 },
    bremsMoment: masse * G * 1.55 * r * bremsF,
    bremsBalance: t.bremsen > 0 ? fein.bremsBalance : 0.62,
    handbremsMoment: masse * G * 0.95 * r,
    luftwiderstand,
    abtrieb: [abtriebGesamt * abV, abtriebGesamt * (1 - abV)],
    maxLenkwinkel: typ === 'drift' ? 0.75 : 0.6,
    laenge: auto.laenge, breite: auto.breite, hoehe: auto.hoehe,
    bodenfreiheit,
  };
}
