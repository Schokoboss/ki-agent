import {
  type Vec3, type Quat, v3, quat, klemme, klemme01, mische, glatt, bewegeZu,
  quatIntegriere, quatAusGierUndNormale, tabelle,
} from '../engine/mathe';
import { rauschen2 } from '../engine/rauschen';
import { UNTERGRUENDE, type Umwelt } from './untergrund';
import type { Boden, Bodenkontakt, Fahrwerte, Fahrhilfen, ReifenWerte } from './typen';
import { HILFEN_STANDARD } from './typen';

const G = 9.81;
const LUFTDICHTE = 1.2;

/** Normierte Reifenkennlinie: s = kombinierter, auf das Maximum normierter Schlupf. */
export function reifenKurve(s: number, abfall: number): number {
  if (s <= 1) return s * (1.5 - 0.5 * s * s);
  const d = (s - 1) * 0.55;
  return abfall + (1 - abfall) / (1 + d * d);
}

export interface Rad {
  /** Aufhängungspunkt im Körpersystem (Radmitte bei voller Einfederung). */
  lx: number; ly: number; lz: number;
  vorn: boolean;
  /** Einfederung in m (0 = ganz ausgefedert). */
  einfederung: number;
  /** Drehgeschwindigkeit (rad/s) und Drehwinkel (für die Darstellung). */
  omega: number;
  drehwinkel: number;
  lenkwinkel: number;
  kontakt: boolean;
  /** Radlast in N. */
  last: number;
  /** Längsschlupf (Verhältnis) und Schräglaufwinkel (rad) des letzten Schritts. */
  schlupfL: number;
  schlupfW: number;
  /** Rutschstärke 0..1+ (normierter Schlupf über dem Haftungsmaximum). */
  rutsch: number;
  /** Kontaktpunkt, Bodennormale, Untergrund. */
  kx: number; ky: number; kz: number;
  nx: number; ny: number; nz: number;
  untergrund: number;
  absFaktor: number;
  /** Zuletzt übertragene Kräfte längs/quer (N). */
  kraftL: number;
  kraftQ: number;
}

function neuesRad(vorn: boolean): Rad {
  return {
    lx: 0, ly: 0, lz: 0, vorn, einfederung: 0, omega: 0, drehwinkel: 0, lenkwinkel: 0, kontakt: false,
    last: 0, schlupfL: 0, schlupfW: 0, rutsch: 0, kx: 0, ky: 0, kz: 0, nx: 0, ny: 1, nz: 0,
    untergrund: 0, absFaktor: 1, kraftL: 0, kraftQ: 0,
  };
}

/** Mechanische Folgen von Schäden (1 = unbeschädigt). */
export interface Mechanik {
  leistung: number;
  /** Lenkungszug in rad (verbogene Spur). */
  zug: number;
  federung: number;
  luft: number;
}

const kontaktTmp: Bodenkontakt = { hoehe: 0, nx: 0, ny: 1, nz: 0, untergrund: 0 };
const ZUSTAND_LAENGE = 13 + 4 * 4 + 10;

/**
 * Ein Auto als Starrkörper mit vier einzeln gefederten Rädern.
 * Körpersystem: x = links, y = oben, z = vorn. Lenkwinkel und Gieren positiv nach links.
 * Eingabe `lenkung` ist positiv nach rechts (wie eine Gamepad-Achse).
 */
export class Fahrzeug {
  w: Fahrwerte;
  readonly pos: Vec3 = v3();
  readonly rot: Quat = quat();
  /** Lineare und Winkelgeschwindigkeit in Weltkoordinaten. */
  readonly v: Vec3 = v3();
  readonly dreh: Vec3 = v3();
  readonly raeder: Rad[] = [neuesRad(true), neuesRad(true), neuesRad(false), neuesRad(false)];

  // Eingaben
  gas = 0;
  bremse = 0;
  lenkung = 0;
  handbremse = 0;
  hilfen: Fahrhilfen = { ...HILFEN_STANDARD };

  // Antrieb
  drehzahl = 900;
  /** -1 = rückwärts, 0 = Leerlauf, 1..n */
  gang = 1;
  schaltRest = 0;
  schaltSperre = 0;
  /** Tatsächlich wirkendes Gas nach Hilfen (0..1), für Klang. */
  last = 0;
  ladedruck = 0;

  // abgeleitet / Telemetrie
  /** Geschwindigkeit entlang der Fahrzeuglängsachse (m/s). */
  tempoVor = 0;
  tempoQuer = 0;
  /** Betrag der Geschwindigkeit (m/s). */
  tempo = 0;
  /** Schwimmwinkel am Schwerpunkt (rad, positiv = rutscht nach links). */
  schwimmwinkel = 0;
  luftZeit = 0;
  /** Anzahl Räder mit Bodenkontakt. */
  bodenRaeder = 0;
  /** Stärkster Aufprall des letzten Schritts (Einfederungsgeschwindigkeit m/s bei Landung). */
  landung = 0;
  lenkwinkel = 0;
  lenkGlatt = 0;
  tcsFaktor = 1;
  espAktiv = 0;
  imWasser = 0;
  /** Reduziert Luftwiderstand (Windschatten), 1 = normal. */
  windschatten = 1;
  mech: Mechanik = { leistung: 1, zug: 0, federung: 1, luft: 1 };
  /** Körperbasis in Weltkoordinaten (wird in jedem Schritt aktualisiert). */
  readonly links: Vec3 = v3(1, 0, 0);
  readonly oben: Vec3 = v3(0, 1, 0);
  readonly vorn: Vec3 = v3(0, 0, 1);
  /** Statische Radlast vorn/hinten je Rad (N). */
  private statischV = 0;
  private statischH = 0;
  private rueckwaertsZeit = 0;
  private umkippZeit = 0;

  constructor(werte: Fahrwerte) {
    this.w = werte;
    this.setzeWerte(werte);
  }

  setzeWerte(werte: Fahrwerte): void {
    this.w = werte;
    const w = werte;
    const radstand = w.achsVorn + w.achsHinten;
    this.statischV = (w.masse * G * w.achsHinten) / radstand / 2;
    this.statischH = (w.masse * G * w.achsVorn) / radstand / 2;
    const ruheV = this.statischV / w.federRate[0];
    const ruheH = this.statischH / w.federRate[1];
    const yBasis = -(w.schwerpunktHoehe - w.radRadius);
    const r = this.raeder;
    r[0].lx = w.spurVorn / 2; r[1].lx = -w.spurVorn / 2;
    r[2].lx = w.spurHinten / 2; r[3].lx = -w.spurHinten / 2;
    r[0].lz = r[1].lz = w.achsVorn;
    r[2].lz = r[3].lz = -w.achsHinten;
    r[0].ly = r[1].ly = yBasis + (w.federweg - ruheV);
    r[2].ly = r[3].ly = yBasis + (w.federweg - ruheH);
    if (this.gang > w.gaenge.length) this.gang = w.gaenge.length;
  }

  /** Setzt das Auto ruhend auf den Boden. */
  setzeAuf(x: number, z: number, gier: number, boden: Boden, yBezug = 1e6): void {
    boden.abfrage(x, z, yBezug, kontaktTmp);
    quatAusGierUndNormale(gier, kontaktTmp.nx, kontaktTmp.ny, kontaktTmp.nz, this.rot);
    this.pos.x = x; this.pos.z = z;
    this.pos.y = kontaktTmp.hoehe + this.w.schwerpunktHoehe + 0.02;
    this.v.x = this.v.y = this.v.z = 0;
    this.dreh.x = this.dreh.y = this.dreh.z = 0;
    for (const rad of this.raeder) {
      rad.omega = 0;
      rad.einfederung = (rad.vorn ? this.statischV / this.w.federRate[0] : this.statischH / this.w.federRate[1]);
      rad.absFaktor = 1; rad.rutsch = 0; rad.schlupfL = 0; rad.schlupfW = 0;
    }
    this.gang = 1; this.schaltRest = 0; this.drehzahl = this.w.leerlauf;
    this.lenkwinkel = 0; this.lenkGlatt = 0; this.luftZeit = 0; this.tcsFaktor = 1;
    this.rueckwaertsZeit = 0; this.umkippZeit = 0; this.landung = 0;
    this.aktualisiereBasis();
  }

  /** Setzt Geschwindigkeit entlang der Fahrzeugachse (z. B. fliegender Start, Rückspulen). */
  setzeTempo(tempo: number): void {
    this.aktualisiereBasis();
    this.v.x = this.vorn.x * tempo; this.v.y = this.vorn.y * tempo; this.v.z = this.vorn.z * tempo;
    for (const rad of this.raeder) rad.omega = tempo / this.w.radRadius;
    this.waehleGangFuer(tempo);
  }

  private waehleGangFuer(tempo: number): void {
    const w = this.w;
    let g = 1;
    for (let i = 0; i < w.gaenge.length; i++) {
      const dz = (Math.abs(tempo) / w.radRadius) * w.gaenge[i] * w.achsuebersetzung * 9.5493;
      g = i + 1;
      if (dz < w.maxDrehzahl * 0.86) break;
    }
    this.gang = tempo < -0.5 ? -1 : g;
  }

  aktualisiereBasis(): void {
    const q = this.rot;
    const x = q.x, y = q.y, z = q.z, ww = q.w;
    this.links.x = 1 - 2 * (y * y + z * z); this.links.y = 2 * (x * y + ww * z); this.links.z = 2 * (x * z - ww * y);
    this.oben.x = 2 * (x * y - ww * z); this.oben.y = 1 - 2 * (x * x + z * z); this.oben.z = 2 * (y * z + ww * x);
    this.vorn.x = 2 * (x * z + ww * y); this.vorn.y = 2 * (y * z - ww * x); this.vorn.z = 1 - 2 * (x * x + y * y);
  }

  /** Übersetzung Motor → Rad im aktuellen Gang (0 im Leerlauf). */
  uebersetzung(): number {
    const w = this.w;
    if (this.gang > 0) return w.gaenge[this.gang - 1] * w.achsuebersetzung;
    if (this.gang < 0) return -w.rueckwaertsgang * w.achsuebersetzung;
    return 0;
  }

  schalte(richtung: number): void {
    if (this.schaltRest > 0) return;
    const neu = klemme(this.gang + richtung, -1, this.w.gaenge.length);
    if (neu === this.gang) return;
    this.gang = neu;
    this.schaltRest = this.w.schaltzeit;
    this.schaltSperre = this.w.schaltzeit + 0.25;
  }

  /** Wendet einen Impuls (N·s) an einem Weltpunkt an. */
  impuls(px: number, py: number, pz: number, jx: number, jy: number, jz: number): void {
    const m = this.w.masse;
    this.v.x += jx / m; this.v.y += jy / m; this.v.z += jz / m;
    const rx = px - this.pos.x, ry = py - this.pos.y, rz = pz - this.pos.z;
    this.drehImpuls(ry * jz - rz * jy, rz * jx - rx * jz, rx * jy - ry * jx);
  }

  /** Addiert I⁻¹·L (Weltkoordinaten) zur Winkelgeschwindigkeit. */
  drehImpuls(lx: number, ly: number, lz: number): void {
    const X = this.links, Y = this.oben, Z = this.vorn, t = this.w.traegheit;
    const bx = (lx * X.x + ly * X.y + lz * X.z) / t[0];
    const by = (lx * Y.x + ly * Y.y + lz * Y.z) / t[1];
    const bz = (lx * Z.x + ly * Z.y + lz * Z.z) / t[2];
    this.dreh.x += X.x * bx + Y.x * by + Z.x * bz;
    this.dreh.y += X.y * bx + Y.y * by + Z.y * bz;
    this.dreh.z += X.z * bx + Y.z * by + Z.z * bz;
  }

  /** Effektive inverse Masse an einem Punkt in Richtung n (für Kollisionsimpulse). */
  inverseMasseAn(px: number, py: number, pz: number, nx: number, ny: number, nz: number): number {
    const X = this.links, Y = this.oben, Z = this.vorn, t = this.w.traegheit;
    const rx = px - this.pos.x, ry = py - this.pos.y, rz = pz - this.pos.z;
    const cx = ry * nz - rz * ny, cy = rz * nx - rx * nz, cz = rx * ny - ry * nx;
    const bx = cx * X.x + cy * X.y + cz * X.z;
    const by = cx * Y.x + cy * Y.y + cz * Y.z;
    const bz = cx * Z.x + cy * Z.y + cz * Z.z;
    return 1 / this.w.masse + (bx * bx) / t[0] + (by * by) / t[1] + (bz * bz) / t[2];
  }

  /** Geschwindigkeit eines Weltpunkts auf dem Körper. */
  punktTempo(px: number, py: number, pz: number, aus: Vec3): Vec3 {
    const rx = px - this.pos.x, ry = py - this.pos.y, rz = pz - this.pos.z;
    const d = this.dreh;
    aus.x = this.v.x + d.y * rz - d.z * ry;
    aus.y = this.v.y + d.z * rx - d.x * rz;
    aus.z = this.v.z + d.x * ry - d.y * rx;
    return aus;
  }

  /** Ein fester Physikschritt. */
  schritt(dt: number, boden: Boden, umwelt: Umwelt): void {
    const w = this.w;
    this.aktualisiereBasis();
    const X = this.links, Y = this.oben, Z = this.vorn;
    const pos = this.pos, v = this.v, om = this.dreh;
    const m = w.masse;

    const vVor = v.x * Z.x + v.y * Z.y + v.z * Z.z;
    const vQuer = v.x * X.x + v.y * X.y + v.z * X.z;
    this.tempoVor = vVor; this.tempoQuer = vQuer;
    this.tempo = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    this.schwimmwinkel = this.tempo > 2 ? Math.atan2(vQuer, Math.abs(vVor)) : 0;

    // ---------- Fahrlogik: Rückwärtsgang, Automatik ----------
    let gas = klemme01(this.gas), bremse = klemme01(this.bremse);
    const hb = klemme01(this.handbremse);
    if (this.hilfen.automatik) {
      if (this.gang >= 0) {
        if (bremse > 0.2 && gas < 0.1 && Math.abs(vVor) < 0.8 && this.bodenRaeder >= 2) {
          this.rueckwaertsZeit += dt;
          if (this.rueckwaertsZeit > 0.18) { this.gang = -1; this.schaltRest = 0.1; this.rueckwaertsZeit = 0; }
        } else this.rueckwaertsZeit = 0;
      } else if (gas > 0.2 && bremse < 0.1 && vVor > -1.5) {
        this.gang = 1; this.schaltRest = 0.1;
      }
    }
    if (this.gang < 0 && this.hilfen.automatik) { const t = gas; gas = bremse; bremse = t; }

    const uebers = this.uebersetzung();
    const r = w.radRadius;
    const rad = this.raeder;

    // Drehzahl aus den angetriebenen Rädern
    const fv = w.antriebVorn, fh = 1 - fv;
    const omV = (rad[0].omega + rad[1].omega) * 0.5, omH = (rad[2].omega + rad[3].omega) * 0.5;
    const omAntrieb = fv * omV + fh * omH;
    const dzRad = Math.abs(omAntrieb * uebers) * 9.5493;

    if (this.schaltRest > 0) this.schaltRest -= dt;
    if (this.schaltSperre > 0) this.schaltSperre -= dt;
    if (this.hilfen.automatik && this.gang >= 1 && this.schaltSperre <= 0 && this.bodenRaeder >= 2) {
      const dzTempo = Math.abs((this.tempo / r) * uebers) * 9.5493;
      const basis = Math.min(dzRad, dzTempo * 1.2 + 300);
      const hoch = w.maxDrehzahl * mische(0.74, 0.955, gas);
      if (basis > hoch && this.gang < w.gaenge.length) this.schalte(1);
      else if (this.gang > 1) {
        const dzTiefer = dzRad * w.gaenge[this.gang - 2] / w.gaenge[this.gang - 1];
        const runter = w.maxDrehzahl * (bremse > 0.3 ? 0.86 : mische(0.42, 0.74, gas));
        if (dzTiefer < runter) this.schalte(-1);
      }
    }

    // Traktionskontrolle
    let gasEff = gas;
    if (this.hilfen.tcs) gasEff *= this.tcsFaktor;
    if (this.espAktiv > 0.01 && this.hilfen.esp) gasEff *= 1 - 0.7 * this.espAktiv;

    // Motor
    const eingekuppelt = this.schaltRest <= 0 && uebers !== 0;
    const anfahr = w.leerlauf + gasEff * (w.maxDrehzahl * 0.42 - w.leerlauf);
    let dzZiel = eingekuppelt ? Math.max(dzRad, anfahr) : mische(w.leerlauf, w.maxDrehzahl * 0.9, gasEff);
    dzZiel = Math.min(dzZiel, w.maxDrehzahl + 150);
    const dzRate = eingekuppelt ? 22 : 7;
    this.drehzahl += (dzZiel - this.drehzahl) * Math.min(1, dzRate * dt);
    let motorMoment = 0;
    if (eingekuppelt) {
      const voll = tabelle(w.motorKurve, 0, w.maxDrehzahl, this.drehzahl) * this.mech.leistung;
      const begrenzer = klemme01((w.maxDrehzahl + 60 - this.drehzahl) / 220);
      motorMoment = voll * gasEff * begrenzer;
      const schleppt = dzRad > anfahr * 0.98;
      if (schleppt) motorMoment -= w.motorBremse * (this.drehzahl / w.maxDrehzahl) * (1 - gasEff);
    }
    this.last += (gasEff * (eingekuppelt ? 1 : 0.3) - this.last) * Math.min(1, 12 * dt);
    this.ladedruck += ((gasEff > 0.5 ? this.drehzahl / w.maxDrehzahl : 0) - this.ladedruck) * Math.min(1, 2.5 * dt);
    const antriebMoment = motorMoment * uebers * w.wirkungsgrad;

    // Momentverteilung mit Differenzialen
    let mV = antriebMoment * fv, mH = antriebMoment * fh;
    if (fv > 0 && fh > 0 && eingekuppelt) {
      const d = w.diffMitte;
      const grenze = d.vorlast + d.sperre * Math.abs(antriebMoment);
      const t = klemme(d.viskos * (omV - omH), -grenze, grenze);
      mV -= t; mH += t;
    }
    const radMoment = [0, 0, 0, 0];
    const engTr = eingekuppelt ? Math.min(w.motorTraegheit * uebers * uebers * 0.5, 2.5) : 0;
    {
      const d = w.diffVorn;
      const grenze = fv > 0 ? d.vorlast + d.sperre * Math.abs(mV) : 0;
      const t = klemme(d.viskos * (rad[0].omega - rad[1].omega), -grenze, grenze);
      radMoment[0] = mV * 0.5 - t; radMoment[1] = mV * 0.5 + t;
    }
    {
      const d = w.diffHinten;
      let grenze = fh > 0 ? d.vorlast + d.sperre * Math.abs(mH) : 0;
      if (hb > 0.5) grenze = 0;
      const t = klemme(d.viskos * (rad[2].omega - rad[3].omega), -grenze, grenze);
      radMoment[2] = mH * 0.5 - t; radMoment[3] = mH * 0.5 + t;
    }

    // ---------- Lenkung ----------
    const vFrontQuer = vQuer + (om.x * Y.x + om.y * Y.y + om.z * Y.z) * w.achsVorn;
    const lenkEin = klemme(this.lenkung, -1, 1);
    const rate = Math.abs(lenkEin) > Math.abs(this.lenkGlatt) || lenkEin * this.lenkGlatt < 0 ? 5.5 : 8;
    this.lenkGlatt = bewegeZu(this.lenkGlatt, lenkEin, rate * dt);
    const hilfe = this.hilfen.lenkhilfe;
    let schlupfBoden = 1;
    if (rad[0].kontakt || rad[1].kontakt) {
      schlupfBoden = (UNTERGRUENDE[rad[0].untergrund].schlupf + UNTERGRUENDE[rad[1].untergrund].schlupf) * 0.5;
    }
    // Bei Tempo begrenzt die Lenkhilfe den Schräglauf der Vorderräder auf knapp über das Haftungsmaximum.
    const alphaMax = w.reifenVorn.winkelPeak * Math.sqrt(schlupfBoden) * (1.08 + 0.55 * (1 - hilfe));
    const bereich = mische(w.maxLenkwinkel, Math.min(w.maxLenkwinkel, alphaMax), glatt(4, 24, Math.abs(vVor)));
    let befehl = -this.lenkGlatt * bereich;
    let ziel = this.mech.zug;
    if (hilfe > 0 && vVor > 3) {
      const ein = glatt(3, 9, vVor);
      const beta = Math.atan2(vFrontQuer, Math.max(vVor, 3));
      const vHeckQuer = vQuer - (om.x * Y.x + om.y * Y.y + om.z * Y.z) * w.achsHinten;
      const betaH = Math.atan2(vHeckQuer, Math.max(vVor, 3));
      // Driftwinkel-Begrenzung: lenkt der Fahrer weiter in die Kurve, nimmt die Hilfe Lenkung zurück,
      // sobald das Heck weit ausschwenkt – so bleibt ein Drift mit Gas und Lenkung haltbar.
      if (befehl * betaH < 0) befehl *= 1 - 1.45 * hilfe * ein * glatt(0.2, 0.62, Math.abs(betaH));
      ziel += hilfe * beta * ein;
    }
    ziel += befehl;
    this.lenkwinkel = klemme(ziel, -w.maxLenkwinkel, w.maxLenkwinkel);
    // Ackermann-Näherung: kurveninneres Rad lenkt etwas stärker
    const ack = this.lenkwinkel * Math.abs(this.lenkwinkel) * 0.18;
    rad[0].lenkwinkel = this.lenkwinkel + ack;
    rad[1].lenkwinkel = this.lenkwinkel - ack;

    // ---------- ESP (Zustand aus dem letzten Schritt) ----------
    let espRad = -1;
    if (this.hilfen.esp && vVor > 8) {
      const vHeckQuer = vQuer - (om.x * Y.x + om.y * Y.y + om.z * Y.z) * w.achsHinten;
      const betaH = Math.atan2(vHeckQuer, vVor);
      const ueber = Math.abs(betaH) - 0.1;
      this.espAktiv += ((ueber > 0 ? klemme01(ueber / 0.12) : 0) - this.espAktiv) * Math.min(1, 10 * dt);
      if (ueber > 0) espRad = betaH > 0 ? 0 : 1;
    } else this.espAktiv *= 1 - Math.min(1, 6 * dt);

    // ---------- Räder ----------
    let Fx = 0, Fy = -m * G, Fz = 0;
    let Tx = 0, Ty = 0, Tz = 0;
    let kontakte = 0;
    let maxSchlupfAntrieb = 0;
    let landung = 0;
    const bremsGesamt = w.bremsMoment * bremse;
    const naesse = umwelt.naesse;
    this.imWasser = 0;

    const einfAlt0 = rad[0].einfederung, einfAlt1 = rad[1].einfederung, einfAlt2 = rad[2].einfederung, einfAlt3 = rad[3].einfederung;
    for (let i = 0; i < 4; i++) {
      const R = rad[i];
      const achse = R.vorn ? 0 : 1;
      const einfGegen = i === 0 ? einfAlt1 : i === 1 ? einfAlt0 : i === 2 ? einfAlt3 : einfAlt2;
      // Aufhängungspunkt in Weltkoordinaten
      const hx = pos.x + X.x * R.lx + Y.x * R.ly + Z.x * R.lz;
      const hy = pos.y + X.y * R.lx + Y.y * R.ly + Z.y * R.lz;
      const hz = pos.z + X.z * R.lx + Y.z * R.ly + Z.z * R.lz;
      // Boden unter dem Rad (Abfrage am voraussichtlichen Kontaktpunkt)
      const tVor = w.federweg - R.einfederung + r;
      const qx = hx - Y.x * tVor, qz = hz - Y.z * tVor;
      boden.abfrage(qx, qz, hy + 0.3, kontaktTmp);
      const U0 = UNTERGRUENDE[kontaktTmp.untergrund];
      let bodenH = kontaktTmp.hoehe;
      if (U0.rauAmp > 0) bodenH += U0.rauAmp * rauschen2(qx / U0.rauLaenge, qz / U0.rauLaenge);
      const nx = kontaktTmp.nx, ny = kontaktTmp.ny, nz = kontaktTmp.nz;
      R.untergrund = kontaktTmp.untergrund;
      if (bodenH < umwelt.wasserHoehe) this.imWasser += 0.25 * klemme01((umwelt.wasserHoehe - bodenH) / 0.6);

      // Strahl (hx,hy,hz) + t·(-Y) gegen Ebene durch (qx, bodenH, qz)
      const dn = -(Y.x * nx + Y.y * ny + Y.z * nz);
      let einf = 0;
      let kontakt = false;
      if (dn < -0.25) {
        const t = ((qx - hx) * nx + (bodenH - hy) * ny + (qz - hz) * nz) / dn;
        einf = w.federweg + r - t;
        kontakt = einf > 0;
      }
      const stat = R.vorn ? this.statischV : this.statischH;
      let N = 0;
      if (kontakt) {
        // Kontaktpunkt
        const t = w.federweg + r - einf;
        const kx = hx - Y.x * t, ky = hy - Y.y * t, kz = hz - Y.z * t;
        R.kx = kx; R.ky = ky; R.kz = kz; R.nx = nx; R.ny = ny; R.nz = nz;
        const rx = kx - pos.x, ry = ky - pos.y, rz = kz - pos.z;
        // Geschwindigkeit des Kontaktpunkts
        const cvx = v.x + om.y * rz - om.z * ry;
        const cvy = v.y + om.z * rx - om.x * rz;
        const cvz = v.z + om.x * ry - om.y * rx;
        const vn = cvx * nx + cvy * ny + cvz * nz;
        const einfV = -vn; // positiv = federt ein
        // Feder, Dämpfer, Stabilisator, Anschlag
        const k = w.federRate[achse] * this.mech.federung;
        const c = einfV > 0 ? w.daempferDruck[achse] : w.daempferZug[achse];
        let kraft = k * Math.min(einf, w.federweg) + c * einfV + w.stabi[achse] * (Math.min(einf, w.federweg) - einfGegen);
        if (einf > w.federweg) {
          const ueber = einf - w.federweg;
          kraft += k * 7 * ueber + c * 1.5 * Math.max(0, einfV);
        }
        if (!R.kontakt && einfV > landung) landung = einfV;
        N = klemme(kraft, 0, stat * 7 + m * 8);
        R.einfederung = Math.min(einf, w.federweg + 0.05);

        // Reifenrichtungen in der Bodenebene
        const cs = Math.cos(R.lenkwinkel), sn = Math.sin(R.lenkwinkel);
        let fx = Z.x * cs + X.x * sn, fy = Z.y * cs + X.y * sn, fz = Z.z * cs + X.z * sn;
        const fd = fx * nx + fy * ny + fz * nz;
        fx -= nx * fd; fy -= ny * fd; fz -= nz * fd;
        const fl = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1;
        fx /= fl; fy /= fl; fz /= fl;
        const lx = ny * fz - nz * fy, ly = nz * fx - nx * fz, lz = nx * fy - ny * fx;
        const vl = cvx * fx + cvy * fy + cvz * fz;
        const vq = cvx * lx + cvy * ly + cvz * lz;

        // Haftung
        const reifen: ReifenWerte = R.vorn ? w.reifenVorn : w.reifenHinten;
        const nassF = 1 - naesse * (1 - U0.nass) - naesse * reifen.nassVerlust * (U0.kategorie === 'strasse' ? 1 : 0);
        const umweltF = U0.kategorie === 'strasse' ? umwelt.gripStrasse : umwelt.gripLose;
        const NReifen = Math.min(N, stat * 3.2);
        const lastF = klemme(1 - reifen.lastEmpfindlichkeit * (NReifen / stat - 1), 0.72, 1.12);
        const mu = U0.grip * reifen.kategorie[U0.kategorie] * nassF * umweltF * lastF;
        const muL = mu * reifen.gripLaengs, muQ = mu * reifen.gripQuer;
        const schlupfP = reifen.schlupfPeak * U0.schlupf;
        const tanP = Math.tan(Math.min(0.6, reifen.winkelPeak * U0.schlupf));
        const vRef = Math.max(Math.abs(vl), 1.6);
        const sy = vq / (Math.max(Math.abs(vl), 1.0) * tanP);

        // Bremsmoment (inkl. ABS, Handbremse, ESP) und Rollwiderstand
        let bm = bremsGesamt * (R.vorn ? w.bremsBalance : 1 - w.bremsBalance) * 0.5;
        if (this.hilfen.abs && bm > 0) {
          const blockiert = R.schlupfL < -schlupfP * 1.25 && Math.abs(vl) > 2.5;
          R.absFaktor = klemme(R.absFaktor + (blockiert ? -14 : 5) * dt, 0.12, 1);
          bm *= R.absFaktor;
        } else R.absFaktor = 1;
        if (!R.vorn) bm += w.handbremsMoment * hb;
        if (i === espRad) bm += w.bremsMoment * 0.22 * this.espAktiv;
        const rollM = (U0.rollwiderstand + U0.sog * Math.min(1, Math.abs(vl) / 12)) * NReifen * r;
        bm += rollM;

        // Implizite Lösung der Raddrehzahl (Bisektion)
        const angetrieben = (R.vorn ? fv : fh) > 0;
        const I = w.radTraegheit + (angetrieben ? engTr : 0);
        const md = radMoment[i];
        const omAlt = R.omega;
        const omRoll = vl / r;
        const spanne = (dt / I) * (Math.abs(md) + bm + r * muL * NReifen) + 1;
        let lo = Math.min(omAlt, omRoll, 0) - spanne, hi = Math.max(omAlt, omRoll, 0) + spanne;
        let omNeu = omAlt, kraftL = 0, sx = 0, sGes = 0, kurve = 0;
        for (let it = 0; it < 18; it++) {
          omNeu = (lo + hi) * 0.5;
          sx = (omNeu * r - vl) / vRef / schlupfP;
          sGes = Math.sqrt(sx * sx + sy * sy);
          kurve = sGes > 1e-6 ? reifenKurve(sGes, U0.abfall) / sGes : 1.5;
          kraftL = muL * NReifen * kurve * sx;
          const bs = klemme(omNeu / 0.6, -1, 1);
          const g = omNeu - omAlt - (dt / I) * (md - bm * bs - r * kraftL);
          if (g > 0) hi = omNeu; else lo = omNeu;
        }
        R.omega = omNeu;
        let kraftQ = -muQ * NReifen * kurve * sy;
        // Stabilitätsgrenze bei sehr kleinen Quergeschwindigkeiten
        const grenzeQ = (0.55 * (NReifen / G) * Math.abs(vq)) / dt;
        if (kraftQ > grenzeQ) kraftQ = grenzeQ; else if (kraftQ < -grenzeQ) kraftQ = -grenzeQ;
        const grenzeL = (0.9 * (m * 0.25) * Math.abs(omNeu * r - vl)) / dt + Math.abs(md) / r + bm / r;
        if (kraftL > grenzeL) kraftL = grenzeL; else if (kraftL < -grenzeL) kraftL = -grenzeL;

        R.schlupfL = (omNeu * r - vl) / vRef;
        R.schlupfW = Math.atan2(vq, Math.abs(vl) + 0.5);
        R.rutsch = Math.abs(vl) + Math.abs(vq) > 1.5 || Math.abs(omNeu * r) > 2 ? sGes : 0;
        R.kraftL = kraftL; R.kraftQ = kraftQ;
        if (angetrieben && Math.abs(R.schlupfL) / schlupfP > maxSchlupfAntrieb) maxSchlupfAntrieb = Math.abs(R.schlupfL) / schlupfP;

        // Kräfte auf den Körper; Seitenkraft greift am Rollzentrum an
        const kxF = nx * N + fx * kraftL, kyF = ny * N + fy * kraftL, kzF = nz * N + fz * kraftL;
        Fx += kxF + lx * kraftQ; Fy += kyF + ly * kraftQ; Fz += kzF + lz * kraftQ;
        Tx += ry * kzF - rz * kyF; Ty += rz * kxF - rx * kzF; Tz += rx * kyF - ry * kxF;
        const hRoll = w.rollzentrum * w.schwerpunktHoehe;
        const qx2 = rx + Y.x * hRoll, qy2 = ry + Y.y * hRoll, qz2 = rz + Y.z * hRoll;
        const sFx = lx * kraftQ, sFy = ly * kraftQ, sFz = lz * kraftQ;
        Tx += qy2 * sFz - qz2 * sFy; Ty += qz2 * sFx - qx2 * sFz; Tz += qx2 * sFy - qy2 * sFx;
        kontakte++;
      } else {
        // Rad in der Luft: federt aus, dreht frei
        R.einfederung = Math.max(0, R.einfederung - 2.5 * dt);
        const angetrieben = (R.vorn ? fv : fh) > 0;
        const I = w.radTraegheit + (angetrieben ? engTr : 0);
        const bm = bremsGesamt * (R.vorn ? w.bremsBalance : 1 - w.bremsBalance) * 0.5 + (R.vorn ? 0 : w.handbremsMoment * hb) + 4;
        let om2 = R.omega + (dt / I) * radMoment[i];
        const ab = (dt / I) * bm;
        om2 = Math.abs(om2) <= ab ? 0 : om2 - Math.sign(om2) * ab;
        const grenze = (w.maxDrehzahl * 1.05) / 9.5493 / Math.max(1, Math.abs(uebers));
        if (angetrieben && uebers !== 0) om2 = klemme(om2, -grenze, grenze);
        R.omega = om2;
        R.schlupfL = 0; R.schlupfW = 0; R.rutsch = 0; R.kraftL = 0; R.kraftQ = 0;
        R.absFaktor = 1;
      }
      R.kontakt = kontakt;
      R.last = N;
      R.drehwinkel += R.omega * dt;
    }
    this.bodenRaeder = kontakte;
    this.landung = landung;

    // TCS-Regler
    if (maxSchlupfAntrieb > 1.25) this.tcsFaktor = Math.max(0.08, this.tcsFaktor - (maxSchlupfAntrieb - 1.25) * 9 * dt);
    else this.tcsFaktor = Math.min(1, this.tcsFaktor + 2.5 * dt);

    // ---------- Aerodynamik ----------
    const tempo = this.tempo;
    if (tempo > 0.5) {
      const q = 0.5 * LUFTDICHTE * tempo;
      const cw = w.luftwiderstand * this.windschatten * this.mech.luft;
      Fx -= q * cw * v.x; Fy -= q * cw * v.y; Fz -= q * cw * v.z;
      const qa = 0.5 * LUFTDICHTE * vVor * vVor * (kontakte > 0 ? 1 : 0.25);
      const av = qa * w.abtrieb[0], ah = qa * w.abtrieb[1];
      Fx -= Y.x * (av + ah); Fy -= Y.y * (av + ah); Fz -= Y.z * (av + ah);
      // Nickmoment aus Abtriebsverteilung: Drehmoment um die Querachse (links)
      const nick = -av * w.achsVorn + ah * w.achsHinten; // Kraft nach unten vorn → Nase runter
      Tx -= X.x * nick; Ty -= X.y * nick; Tz -= X.z * nick;
    }
    // Wasserwiderstand
    if (this.imWasser > 0) {
      const d = 900 * this.imWasser * (1 + tempo * 0.25);
      Fx -= v.x * d; Fz -= v.z * d;
    }

    // ---------- Luftlage ----------
    if (kontakte === 0) {
      this.luftZeit += dt;
      if (this.luftZeit > 0.12) {
        // sanfte Stabilisierung: Drehungen dämpfen und zur Waagerechten neigen (Y × Welt-Oben)
        const k = m * 2.2, c = m * 1.4;
        Tx += -Y.z * k - om.x * c;
        Tz += Y.x * k - om.z * c;
        Ty -= om.y * c * 0.4;
      }
    } else this.luftZeit = 0;

    // ---------- Integration ----------
    v.x += (Fx / m) * dt; v.y += (Fy / m) * dt; v.z += (Fz / m) * dt;
    // Drehmoment → Körpersystem, mit Kreiselterm
    const t = w.traegheit;
    const wbx = om.x * X.x + om.y * X.y + om.z * X.z;
    const wby = om.x * Y.x + om.y * Y.y + om.z * Y.z;
    const wbz = om.x * Z.x + om.y * Z.y + om.z * Z.z;
    const tbx = Tx * X.x + Ty * X.y + Tz * X.z - (wby * wbz * (t[2] - t[1]));
    const tby = Tx * Y.x + Ty * Y.y + Tz * Y.z - (wbz * wbx * (t[0] - t[2]));
    const tbz = Tx * Z.x + Ty * Z.y + Tz * Z.z - (wbx * wby * (t[1] - t[0]));
    let nbx = wbx + (tbx / t[0]) * dt, nby = wby + (tby / t[1]) * dt, nbz = wbz + (tbz / t[2]) * dt;
    const wl = Math.sqrt(nbx * nbx + nby * nby + nbz * nbz);
    if (wl > 14) { const s = 14 / wl; nbx *= s; nby *= s; nbz *= s; }
    om.x = X.x * nbx + Y.x * nby + Z.x * nbz;
    om.y = X.y * nbx + Y.y * nby + Z.y * nbz;
    om.z = X.z * nbx + Y.z * nby + Z.z * nbz;

    this.bodenKollision(dt, boden);

    pos.x += v.x * dt; pos.y += v.y * dt; pos.z += v.z * dt;
    quatIntegriere(this.rot, om.x, om.y, om.z, dt);

    // Auf dem Dach liegen geblieben?
    if (Y.y < 0.15 && this.tempo < 3) this.umkippZeit += dt; else this.umkippZeit = 0;
  }

  /** true, wenn das Auto seit über einer Sekunde auf Dach oder Seite liegt. */
  get liegtAufDemDach(): boolean { return this.umkippZeit > 1.2; }

  /** Karosserie gegen Boden: Eckpunkte als Kontaktpunkte mit Impulsantwort. */
  private bodenKollision(dt: number, boden: Boden): void {
    const w = this.w;
    const X = this.links, Y = this.oben, Z = this.vorn, pos = this.pos, v = this.v, om = this.dreh;
    const hb = w.breite * 0.5 - 0.05, hl = w.laenge * 0.5 - 0.05;
    const yUnten = -(w.schwerpunktHoehe - w.bodenfreiheit), yOben = w.hoehe - w.schwerpunktHoehe;
    for (let i = 0; i < 12; i++) {
      let lx: number, ly: number, lz: number;
      if (i < 4) { lx = i & 1 ? -hb : hb; lz = i & 2 ? -hl : hl; ly = yUnten + 0.12; }
      else if (i < 8) { lx = (i & 1 ? -hb : hb) * 0.78; lz = i & 2 ? -hl * 0.45 : hl * 0.25; ly = yOben; }
      else { lx = i & 1 ? -hb : hb; lz = i & 2 ? -hl : hl; ly = yUnten + (yOben - yUnten) * 0.5; }
      const px = pos.x + X.x * lx + Y.x * ly + Z.x * lz;
      const py = pos.y + X.y * lx + Y.y * ly + Z.y * lz;
      const pz = pos.z + X.z * lx + Y.z * ly + Z.z * lz;
      boden.abfrage(px, pz, py + 0.9, kontaktTmp);
      const tiefe = (kontaktTmp.hoehe - py) * kontaktTmp.ny;
      if (tiefe <= 0) continue;
      const nx = kontaktTmp.nx, ny = kontaktTmp.ny, nz = kontaktTmp.nz;
      const rx = px - pos.x, ry = py - pos.y, rz = pz - pos.z;
      const cvx = v.x + om.y * rz - om.z * ry;
      const cvy = v.y + om.z * rx - om.x * rz;
      const cvz = v.z + om.x * ry - om.y * rx;
      const vn = cvx * nx + cvy * ny + cvz * nz;
      const inv = this.inverseMasseAn(px, py, pz, nx, ny, nz);
      // Annäherung stoppen (leicht federnd), Eindringen weich abbauen
      const zielV = Math.min(3, tiefe * 10);
      const nachher = vn < 0 ? Math.max(-0.12 * vn, zielV) : zielV;
      if (vn < nachher) {
        const jn = ((nachher - vn) / inv) * (vn < 0 ? 1 : 0.5);
        this.impuls(px, py, pz, nx * jn, ny * jn, nz * jn);
        const tx = cvx - nx * vn, ty = cvy - ny * vn, tz = cvz - nz * vn;
        const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
        if (tl > 0.05) {
          const invT = this.inverseMasseAn(px, py, pz, tx / tl, ty / tl, tz / tl);
          const jt = Math.min(tl / invT, 0.45 * jn);
          this.impuls(px, py, pz, (-tx / tl) * jt, (-ty / tl) * jt, (-tz / tl) * jt);
        }
        if (-vn * 0.6 > this.landung) this.landung = -vn * 0.6;
      }
    }
    void dt;
  }

  /** Zustand für Rückspulen/Netz in ein Zahlenfeld schreiben. */
  sichere(ziel?: Float64Array): Float64Array {
    const a = ziel ?? new Float64Array(ZUSTAND_LAENGE);
    let i = 0;
    a[i++] = this.pos.x; a[i++] = this.pos.y; a[i++] = this.pos.z;
    a[i++] = this.rot.x; a[i++] = this.rot.y; a[i++] = this.rot.z; a[i++] = this.rot.w;
    a[i++] = this.v.x; a[i++] = this.v.y; a[i++] = this.v.z;
    a[i++] = this.dreh.x; a[i++] = this.dreh.y; a[i++] = this.dreh.z;
    for (const r of this.raeder) { a[i++] = r.einfederung; a[i++] = r.omega; a[i++] = r.drehwinkel; a[i++] = r.absFaktor; }
    a[i++] = this.drehzahl; a[i++] = this.gang; a[i++] = this.schaltRest; a[i++] = this.schaltSperre;
    a[i++] = this.lenkwinkel; a[i++] = this.lenkGlatt; a[i++] = this.luftZeit; a[i++] = this.tcsFaktor;
    a[i++] = this.last; a[i++] = this.espAktiv;
    return a;
  }

  lade(a: Float64Array): void {
    let i = 0;
    this.pos.x = a[i++]; this.pos.y = a[i++]; this.pos.z = a[i++];
    this.rot.x = a[i++]; this.rot.y = a[i++]; this.rot.z = a[i++]; this.rot.w = a[i++];
    this.v.x = a[i++]; this.v.y = a[i++]; this.v.z = a[i++];
    this.dreh.x = a[i++]; this.dreh.y = a[i++]; this.dreh.z = a[i++];
    for (const r of this.raeder) { r.einfederung = a[i++]; r.omega = a[i++]; r.drehwinkel = a[i++]; r.absFaktor = a[i++]; }
    this.drehzahl = a[i++]; this.gang = a[i++]; this.schaltRest = a[i++]; this.schaltSperre = a[i++];
    this.lenkwinkel = a[i++]; this.lenkGlatt = a[i++]; this.luftZeit = a[i++]; this.tcsFaktor = a[i++];
    this.last = a[i++]; this.espAktiv = a[i++];
    this.aktualisiereBasis();
  }

  static readonly ZUSTAND_LAENGE = ZUSTAND_LAENGE;
}
