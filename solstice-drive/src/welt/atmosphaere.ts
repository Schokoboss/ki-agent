import * as THREE from 'three';
import { UMGEBUNG } from '../engine/shader';
import { NACHT_UNIFORM } from '../engine/netzbau';
import { klemme01, mische, glatt } from '../engine/mathe';

export type Wetter = 'sonne' | 'regen' | 'nebel' | 'gewitter';
export const WETTER_ARTEN: readonly Wetter[] = ['sonne', 'regen', 'nebel', 'gewitter'];
export type Jahreszeit = 'fruehling' | 'sommer' | 'herbst' | 'winter';
export const JAHRESZEITEN: readonly Jahreszeit[] = ['fruehling', 'sommer', 'herbst', 'winter'];

/** Zielwerte je Wetterlage. */
const WETTER_WERTE: Record<Wetter, { wolken: number; nebel: number; regen: number; sonne: number; grau: number }> = {
  sonne: { wolken: 0.28, nebel: 0.00016, regen: 0, sonne: 1, grau: 0 },
  regen: { wolken: 0.86, nebel: 0.0007, regen: 0.7, sonne: 0.3, grau: 0.7 },
  nebel: { wolken: 0.6, nebel: 0.0052, regen: 0, sonne: 0.4, grau: 0.85 },
  gewitter: { wolken: 1.0, nebel: 0.0011, regen: 1, sonne: 0.14, grau: 0.9 },
};

interface Farbstufe { e: number; sonne: [number, number, number]; licht: [number, number, number]; zenit: [number, number, number]; horizont: [number, number, number] }
/** Farbverlauf über die Sonnenhöhe e = sin(Elevation). */
const STUFEN: Farbstufe[] = [
  { e: -0.35, sonne: [0.1, 0.14, 0.26], licht: [0.035, 0.05, 0.1], zenit: [0.004, 0.008, 0.028], horizont: [0.018, 0.03, 0.07] },
  { e: -0.1, sonne: [0.1, 0.13, 0.24], licht: [0.06, 0.07, 0.13], zenit: [0.02, 0.035, 0.1], horizont: [0.12, 0.1, 0.14] },
  { e: 0.0, sonne: [0.95, 0.38, 0.12], licht: [0.2, 0.2, 0.3], zenit: [0.1, 0.17, 0.42], horizont: [0.9, 0.48, 0.25] },
  { e: 0.12, sonne: [1.15, 0.7, 0.38], licht: [0.32, 0.36, 0.5], zenit: [0.14, 0.3, 0.68], horizont: [0.85, 0.68, 0.5] },
  { e: 0.35, sonne: [1.2, 1.08, 0.9], licht: [0.4, 0.5, 0.7], zenit: [0.13, 0.34, 0.8], horizont: [0.6, 0.76, 0.95] },
  { e: 1.0, sonne: [1.25, 1.18, 1.05], licht: [0.42, 0.52, 0.74], zenit: [0.1, 0.3, 0.8], horizont: [0.55, 0.74, 0.96] },
];

const _f = { sonne: [0, 0, 0], licht: [0, 0, 0], zenit: [0, 0, 0], horizont: [0, 0, 0] };
function stufe(e: number): typeof _f {
  let i = 0;
  while (i < STUFEN.length - 2 && STUFEN[i + 1].e < e) i++;
  const a = STUFEN[i], b = STUFEN[i + 1];
  const t = klemme01((e - a.e) / (b.e - a.e));
  for (const k of ['sonne', 'licht', 'zenit', 'horizont'] as const) {
    for (let c = 0; c < 3; c++) _f[k][c] = a[k][c] + (b[k][c] - a[k][c]) * t;
  }
  return _f;
}

/**
 * Tageszeit, Wetter und Jahreszeit. Schreibt die gemeinsamen Shader-Uniformen
 * und liefert die physikalisch relevanten Größen (Nässe, Sicht).
 */
export class Atmosphaere {
  /** Tageszeit in Stunden 0..24. */
  stunde = 15.5;
  /** Spielminuten pro echter Sekunde (0 = Zeit steht). */
  zeitTempo = 0.4;
  wetter: Wetter = 'sonne';
  jahreszeit: Jahreszeit = 'sommer';
  /** Aktuelle, weich überblendete Größen. */
  wolken = 0.28;
  nebelDichte = 0.00016;
  regen = 0;
  /** Nässe der Fahrbahn 0..1 (trocknet langsam). */
  naesse = 0;
  blitz = 0;
  /** Wird auf true gesetzt, wenn in diesem Bild ein Blitz begann (für Donner). */
  blitzNeu = false;
  /** 0 draußen … 1 tief im Tunnel (dimmt Sonne und Himmel). */
  tunnel = 0;
  private sonnenAnteil = 1;
  private grau = 0;
  private blitzWarten = 6;
  private zufallZustand = 12345;
  readonly sonnenRichtung = new THREE.Vector3(0, 1, 0);
  /** sin der Sonnenhöhe (-1..1). */
  sonnenHoehe = 0.6;

  private z(): number {
    this.zufallZustand = (Math.imul(this.zufallZustand, 1664525) + 1013904223) | 0;
    return (this.zufallZustand >>> 0) / 4294967296;
  }

  get istNacht(): boolean { return this.sonnenHoehe < 0.02; }
  /** Sichtweite-Faktor für KI und Gameplay (1 = klar). */
  get sicht(): number { return klemme01(0.0004 / Math.max(0.0001, this.nebelDichte)); }

  /** Setzt Wetter ohne Überblendung (z. B. beim Eventstart). */
  setzeSofort(wetter: Wetter, stunde?: number): void {
    this.wetter = wetter;
    if (stunde !== undefined) this.stunde = stunde;
    const w = WETTER_WERTE[wetter];
    this.wolken = w.wolken; this.nebelDichte = w.nebel; this.regen = w.regen;
    this.sonnenAnteil = w.sonne; this.grau = w.grau;
    this.naesse = w.regen > 0 ? 1 : 0;
  }

  aktualisiere(dt: number): void {
    this.stunde = (this.stunde + (dt * this.zeitTempo) / 60) % 24;
    const w = WETTER_WERTE[this.wetter];
    const k = Math.min(1, dt * 0.25);
    this.wolken += (w.wolken - this.wolken) * k;
    this.nebelDichte += (w.nebel - this.nebelDichte) * k;
    this.regen += (w.regen - this.regen) * k;
    this.sonnenAnteil += (w.sonne - this.sonnenAnteil) * k;
    this.grau += (w.grau - this.grau) * k;
    // Fahrbahn wird schnell nass und trocknet langsam
    if (this.regen > 0.05) this.naesse = Math.min(1, this.naesse + dt * 0.08 * this.regen);
    else this.naesse = Math.max(0, this.naesse - dt * 0.012);

    // Blitze
    this.blitzNeu = false;
    this.blitz *= Math.exp(-dt * 9);
    if (this.wetter === 'gewitter' && this.regen > 0.6) {
      this.blitzWarten -= dt;
      if (this.blitzWarten <= 0) {
        this.blitz = 1; this.blitzNeu = true;
        this.blitzWarten = 2.5 + this.z() * 9;
      }
    }

    // Sonnenstand: Aufgang 6 Uhr, Untergang 20 Uhr (Sommer), im Winter kürzer
    const tagLaenge = this.jahreszeit === 'winter' ? 9.5 : this.jahreszeit === 'sommer' ? 15 : 12.5;
    const mittag = 13;
    const phase = ((this.stunde - mittag) / tagLaenge) * Math.PI; // 0 am Mittag, ±PI/2 bei Auf-/Untergang
    const maxHoehe = this.jahreszeit === 'winter' ? 0.55 : this.jahreszeit === 'sommer' ? 0.92 : 0.78;
    let e = Math.cos(phase) * maxHoehe;
    const nachtPhase = Math.abs(this.stunde - mittag) > tagLaenge / 2;
    if (nachtPhase) {
      // nachts sinkt die Sonne weiter; Lichtquelle wird der Mond
      const tief = (Math.abs(this.stunde - mittag) - tagLaenge / 2) / (12 - tagLaenge / 2);
      e = -Math.sin(Math.min(1, tief) * Math.PI) * 0.5 - 0.02 * 0;
    }
    this.sonnenHoehe = e;
    const azimut = ((this.stunde - 6) / 24) * Math.PI * 2;
    const nacht = e < -0.06;
    // Lichtrichtung: tags Sonne, nachts Mond (steht hoch im Süden)
    if (!nacht) {
      const h = Math.max(e, 0.04);
      const c = Math.sqrt(1 - h * h);
      this.sonnenRichtung.set(Math.sin(azimut) * c, h, -Math.cos(azimut) * c * 0.7 + 0.3 * c).normalize();
    } else {
      this.sonnenRichtung.set(0.35, 0.72, 0.6).normalize();
    }

    const f = stufe(e);
    const U = UMGEBUNG;
    const g = this.grau, s = this.sonnenAnteil * (1 - this.tunnel);
    const helligkeit = (c: number[]) => c[0] * 0.3 + c[1] * 0.55 + c[2] * 0.15;
    const entsaettigt = (c: number[], ziel: THREE.Color, faktor: number) => {
      const h = helligkeit(c);
      ziel.setRGB(mische(c[0], h * 0.92, g) * faktor, mische(c[1], h * 0.97, g) * faktor, mische(c[2], h * 1.05, g) * faktor);
    };
    U.uSonne.value.copy(this.sonnenRichtung);
    U.uSonnenFarbe.value.setRGB(f.sonne[0] * s, f.sonne[1] * s, f.sonne[2] * s);
    entsaettigt(f.licht, U.uHimmelLicht.value, mische(1, 0.8, g));
    entsaettigt(f.zenit, U.uZenit.value, mische(1, 0.6, g));
    entsaettigt(f.horizont, U.uHorizont.value, mische(1, 0.75, g));
    const hl = U.uHimmelLicht.value;
    if (this.tunnel > 0) hl.setRGB(mische(hl.r, 0.2, this.tunnel), mische(hl.g, 0.17, this.tunnel), mische(hl.b, 0.12, this.tunnel));
    U.uBodenLicht.value.setRGB(hl.r * 0.42 + f.sonne[0] * s * 0.1, hl.g * 0.4 + f.sonne[1] * s * 0.09, hl.b * 0.36 + f.sonne[2] * s * 0.07);
    // Nebel nimmt die Horizontfarbe an
    const ho = U.uHorizont.value;
    U.uNebelFarbe.value.setRGB(ho.r, ho.g, ho.b);
    U.uNebelDichte.value = this.nebelDichte;
    U.uNaesse.value = this.naesse;
    U.uBlitz.value = this.blitz;
    U.uSterne.value = glatt(0.02, -0.15, e) * (1 - this.wolken * 0.9);
    U.uWolken.value = this.wolken;
    NACHT_UNIFORM.value = glatt(0.14, -0.02, e);
    const jz = U.uJahreszeit.value;
    const ziel = this.jahreszeit;
    jz.x += ((ziel === 'fruehling' ? 1 : 0) - jz.x) * k * 2;
    jz.y += ((ziel === 'sommer' ? 1 : 0) - jz.y) * k * 2;
    jz.z += ((ziel === 'herbst' ? 1 : 0) - jz.z) * k * 2;
    jz.w += ((ziel === 'winter' ? 1 : 0) - jz.w) * k * 2;
    U.uSchnee.value = jz.w;
    U.uZeit.value += dt;
  }

  /** Jahreszeit sofort setzen (ohne Überblendung der Shaderfarben). */
  setzeJahreszeit(j: Jahreszeit): void {
    this.jahreszeit = j;
    UMGEBUNG.uJahreszeit.value.set(j === 'fruehling' ? 1 : 0, j === 'sommer' ? 1 : 0, j === 'herbst' ? 1 : 0, j === 'winter' ? 1 : 0);
    UMGEBUNG.uSchnee.value = j === 'winter' ? 1 : 0;
  }
}
