import * as THREE from 'three';
import { Grafik, istMobil, type Qualitaet } from './engine/grafik';
import { Eingabe, type Aktion } from './engine/eingabe';
import { Spielschleife } from './engine/spielschleife';
import { Verfolgerkamera } from './engine/kamera';
import { UMGEBUNG } from './engine/shader';
import type { Fahrzeug } from './physik/fahrzeug';
import type { Boden } from './physik/typen';
import { Physikwelt, type PhysikEreignis, type Teilnehmer } from './physik/physikwelt';
import { UNTERGRUENDE } from './physik/untergrund';
import { berechneFahrwerte } from './fahrzeuge/fahrwerte';
import { autoNachId, AUTOS } from './fahrzeuge/daten/autos';
import type { AutoDaten, Tuning } from './fahrzeuge/typen';
import { FahrzeugAnsicht } from './fahrzeuge/ansicht';
import type { Lackierung } from './fahrzeuge/lack';
import { FahrEffekte } from './fahrzeuge/effekte';
import { Atmosphaere, type Jahreszeit, type Wetter } from './welt/atmosphaere';
import { Himmel } from './welt/himmel';
import { Testgelaende } from './welt/testgelaende';
import { Inselwelt } from './welt/inselwelt';
import type { Weltkarte } from './welt/weltkarte';
import { erzeugeWeltKollision } from './welt/weltkollision';
import { FLAG_TUNNEL, type StrassenTreffer } from './welt/strassennetz';
import { Hud } from './ui/hud';
import { TouchSteuerung } from './ui/touch';

/** Gemeinsame Schnittstelle der befahrbaren Welten (Insel, Teststrecke). */
export interface Welt extends Boden {
  readonly gruppe: THREE.Group;
  startPunkt(): { x: number; z: number; gier: number };
  aktualisiere(kamera: THREE.Vector3, dt: number): void;
}

/** Skriptsteuerung für Werkzeuge und Tests (überschreibt die Spielereingabe). */
export interface Skripteingabe { gas: number; bremse: number; lenkung: number; handbremse: number }

/** Ein Auto im Spiel: Simulation, Stammdaten und Darstellung. */
export interface SpielAuto {
  t: Teilnehmer;
  daten: AutoDaten;
  ansicht: FahrzeugAnsicht;
}

export function standardLack(auto: AutoDaten): Lackierung {
  return { farbe: auto.farbe, akzent: auto.karosserie.akzent ?? 0x111111, glanz: 0.9, metallic: 0.35 };
}

const _treffer: StrassenTreffer = { strasse: -1, i: 0, t: 0, u: 0, abstand: 0 };
const _kontakt = { hoehe: 0, nx: 0, ny: 1, nz: 0, untergrund: 0 };

export class Spiel {
  readonly grafik: Grafik;
  readonly eingabe: Eingabe;
  readonly schleife: Spielschleife;
  readonly atmosphaere = new Atmosphaere();
  readonly himmel: Himmel;
  readonly kamera = new Verfolgerkamera();
  readonly hud: Hud;
  readonly touch: TouchSteuerung;
  readonly physik: Physikwelt;
  readonly effekte: FahrEffekte;
  readonly welt: Welt;
  /** Inselwelt (null auf der Teststrecke). */
  readonly insel: Inselwelt | null = null;
  readonly karte: Weltkarte | null;
  readonly autos: SpielAuto[] = [];
  spielerAuto!: SpielAuto;
  skript: Skripteingabe | null = null;
  diagnose = false;
  zeit = 0;
  /** Hörer für Physikereignisse und Bildtakt (Spielinhalte hängen sich hier ein). */
  readonly beiEreignis: ((e: PhysikEreignis) => void)[] = [];
  readonly beiSchritt: ((dt: number) => void)[] = [];
  readonly beiBild: ((dt: number, alpha: number) => void)[] = [];
  readonly beiAktion: ((a: Aktion) => boolean | void)[] = [];
  /** Spielereingabe gesperrt (Countdown, Menü, Wiederholung). */
  eingabeGesperrt = false;
  private wasserZeit = 0;

  constructor(canvas: HTMLCanvasElement, ui: HTMLElement, karte: Weltkarte | null, qualitaet: Qualitaet = istMobil() ? 'mittel' : 'hoch') {
    this.grafik = new Grafik(canvas, qualitaet);
    this.eingabe = new Eingabe();
    this.himmel = new Himmel(this.grafik.qualitaet.wolken);
    this.grafik.szene.add(this.himmel.netz);
    this.karte = karte;
    if (karte) {
      this.physik = new Physikwelt(karte);
      this.insel = new Inselwelt(karte, this.grafik.qualitaet, this.physik.hindernisse);
      this.welt = this.insel;
      this.physik.weltKollision = erzeugeWeltKollision(karte, this.insel.objekte);
    } else {
      this.welt = new Testgelaende();
      this.physik = new Physikwelt(this.welt);
    }
    this.grafik.szene.add(this.welt.gruppe);
    this.effekte = new FahrEffekte(this.grafik.szene, this.grafik.qualitaet.partikel);

    const s = this.welt.startPunkt();
    this.spielerAuto = this.fuegeAuto(autoNachId('aurel-s7'));
    this.spieler.setzeAuf(s.x, s.z, s.gier, this.welt);

    this.hud = new Hud(ui);
    this.touch = new TouchSteuerung(this.eingabe, ui);
    this.schleife = new Spielschleife((dt) => this.schritt(dt), (alpha, dt) => this.zeichne(alpha, dt));
    this.atmosphaere.aktualisiere(0);
    this.insel?.ladeAlles(new THREE.Vector3(s.x, 0, s.z));
  }

  get spieler(): Fahrzeug { return this.spielerAuto.t.f; }
  autoIds(): string[] { return AUTOS.map((a) => a.id); }

  /** Fügt ein Auto in Simulation und Szene ein. */
  fuegeAuto(daten: AutoDaten, lack: Lackierung = standardLack(daten), tuning?: Tuning, geist = false): SpielAuto {
    const werte = berechneFahrwerte(daten, tuning);
    const t = this.physik.fuegeHinzu(werte, geist);
    const ansicht = new FahrzeugAnsicht(daten, lack, tuning?.teile.aero ?? 0, werte.schwerpunktHoehe, werte.bodenfreiheit);
    if (geist) { ansicht.material.transparent = true; ansicht.material.uniforms.uAlpha.value = 0.45; ansicht.material.depthWrite = false; }
    ansicht.inSzene(this.grafik.szene);
    const a: SpielAuto = { t, daten, ansicht };
    this.autos.push(a);
    return a;
  }

  entferneAuto(a: SpielAuto): void {
    const i = this.autos.indexOf(a);
    if (i < 0) return;
    this.autos.splice(i, 1);
    this.physik.entferne(a.t);
    this.effekte.vergiss(a.t.f);
    a.ansicht.ausSzene(this.grafik.szene);
    a.ansicht.entsorge();
  }

  /** Tauscht das Spielerauto (Lage und Tempo bleiben). */
  setzeAuto(id: string, lack?: Lackierung, tuning?: Tuning): void {
    const alt = this.spielerAuto;
    const gier = Math.atan2(alt.t.f.vorn.x, alt.t.f.vorn.z);
    const { x, z } = alt.t.f.pos;
    this.entferneAuto(alt);
    const daten = autoNachId(id);
    this.spielerAuto = this.fuegeAuto(daten, lack ?? standardLack(daten), tuning);
    this.spieler.setzeAuf(x, z, gier, this.welt);
    this.kamera.springe();
  }

  /** Versetzt das Spielerauto (Schnellreise, Werkzeuge). */
  teleportiere(x: number, z: number, gier: number, yBezug = 1e6): void {
    this.spieler.setzeAuf(x, z, gier, this.welt, yBezug);
    this.kamera.springe();
    this.insel?.ladeAlles(new THREE.Vector3(x, 0, z));
  }

  /** Wechselt die Jahreszeit: Farben, Wasserstand, Untergründe und Haftung. */
  setzeJahreszeit(j: Jahreszeit): void {
    this.atmosphaere.setzeJahreszeit(j);
    if (this.karte) this.karte.jahreszeit = j;
    const u = this.physik.umwelt;
    u.gripLose = j === 'fruehling' ? 0.9 : j === 'herbst' ? 0.94 : 1;
    u.gripStrasse = j === 'winter' ? 0.9 : j === 'herbst' ? 0.96 : 1;
  }

  /** Setzt Wetter und optional die Tageszeit sofort. */
  setzeWetter(w: Wetter, stunde?: number): void {
    this.atmosphaere.setzeSofort(w, stunde);
  }

  /** Setzt ein Auto auf die nächste Straße zurück (oder an Ort und Stelle aufrecht). */
  setzeZurueck(a: SpielAuto): void {
    const f = a.t.f;
    let x = f.pos.x, z = f.pos.z, gier = Math.atan2(f.vorn.x, f.vorn.z), y = f.pos.y + 2;
    if (this.karte && this.karte.netz.naechste(x, z, 500, _treffer)) {
      const st = this.karte.netz.strassen[_treffer.strasse], i = _treffer.i;
      const nass = this.karte.istTiefesWasser(x, z);
      if (nass || _treffer.abstand < 60 || f.liegtAufDemDach) {
        x = st.x[i] + (st.x[i + 1] - st.x[i]) * _treffer.t; z = st.z[i] + (st.z[i + 1] - st.z[i]) * _treffer.t;
        y = st.y[i] + 1.5;
        let g = Math.atan2(st.x[i + 1] - st.x[i], st.z[i + 1] - st.z[i]);
        if (Math.cos(g - gier) < 0) g += Math.PI;
        gier = g;
      }
    }
    f.setzeAuf(x, z, gier, this.welt, y);
    if (a === this.spielerAuto) this.kamera.springe();
  }

  private schritt(dt: number): void {
    const f = this.spieler;
    if (!this.eingabeGesperrt) {
      const e = this.skript ?? this.eingabe.fahren;
      f.gas = e.gas; f.bremse = e.bremse; f.lenkung = e.lenkung; f.handbremse = e.handbremse;
    }
    this.physik.umwelt.naesse = this.atmosphaere.naesse;
    if (this.karte) this.physik.umwelt.wasserHoehe = this.karte.wasserHoehe;
    for (const h of this.beiSchritt) h(dt);
    this.physik.schritt(dt);
    this.zeit += dt;
  }

  private zeichne(alpha: number, dt: number): void {
    this.eingabe.aktualisiere();
    this.touch.aktualisiere();
    for (const a of this.eingabe.holeAktionen()) this.aktion(a);
    const f = this.spieler;

    // Physikereignisse: Kamera, Vibration, Verformung, Partikel
    for (const e of this.physik.ereignisse) {
      this.effekte.ereignis(e);
      const auto = this.autos.find((a) => a.t.id === e.teilnehmer);
      if (auto && (e.art === 'aufprall' || e.art === 'autokontakt') && e.staerke > 2.5 && auto.t.schaden.aktiv) {
        auto.ansicht.verforme(e.lx, 0, e.lz, e.nx * auto.t.f.links.x + e.nz * auto.t.f.links.z, 0, e.nx * auto.t.f.vorn.x + e.nz * auto.t.f.vorn.z, Math.min(1, e.staerke / 20));
      }
      if (auto === this.spielerAuto) {
        if (e.art === 'landung') { this.kamera.stoss(e.staerke); this.eingabe.vibriere(Math.min(1, e.staerke / 7), 90); }
        else if (e.art === 'zerstoert') { this.kamera.stoss(1.2); this.eingabe.vibriere(0.4, 40); }
        else { this.kamera.stoss(e.staerke * 0.6); this.eingabe.vibriere(Math.min(1, e.staerke / 10), 120); }
      }
      for (const h of this.beiEreignis) h(e);
    }
    this.physik.ereignisse.length = 0;

    // Tiefes Wasser oder Sturz aus der Welt: zurück auf die Straße
    if (this.karte) {
      const unterWasser = this.karte.istTiefesWasser(f.pos.x, f.pos.z) && f.pos.y < this.karte.wasserHoehe + 0.4;
      this.wasserZeit = unterWasser ? this.wasserZeit + dt : 0;
      if (this.wasserZeit > 0.8 || f.pos.y < -60 || Math.abs(f.pos.x) > 4080 || Math.abs(f.pos.z) > 4080) { this.setzeZurueck(this.spielerAuto); this.wasserZeit = 0; }
      // Tunnel-Licht
      this.karte.abfrage(f.pos.x, f.pos.z, f.pos.y, _kontakt);
      const imTunnel = this.karte.letzteStrasse.strasse >= 0 && (this.karte.letzteStrasse.flag & FLAG_TUNNEL) !== 0;
      this.atmosphaere.tunnel += ((imTunnel ? 1 : 0) - this.atmosphaere.tunnel) * Math.min(1, dt * 2.5);
    }
    this.atmosphaere.aktualisiere(dt);

    const g = this.spielerAuto.ansicht.gruppe.position;
    const nacht = this.atmosphaere.sonnenHoehe < 0.1 || this.atmosphaere.nebelDichte > 0.002 || this.atmosphaere.tunnel > 0.3;
    for (const a of this.autos) {
      const af = a.t.f;
      a.ansicht.aktualisiere(af, alpha, this.welt, dt);
      a.ansicht.material.uniforms.uLicht.value = nacht ? 1 : 0;
      const nah = Math.abs(af.pos.x - g.x) + Math.abs(af.pos.z - g.z) < 160;
      this.effekte.fahrzeug(af, dt, this.atmosphaere.naesse, nah);
      // Schmutz sammelt sich auf losem Grund und wäscht im Regen ab
      let lose = 0;
      for (const r of af.raeder) if (r.kontakt) lose += UNTERGRUENDE[r.untergrund].staubMenge;
      a.ansicht.schmutz = Math.max(0, Math.min(1, a.ansicht.schmutz + dt * (lose * 0.004 * Math.min(1, af.tempo / 15) - this.atmosphaere.regen * 0.03 - af.imWasser * 0.2)));
    }
    this.kamera.aktualisiere(this.grafik.kamera, f, g.x, g.y, g.z, this.welt, dt, this.eingabe.fahren.blickZurueck, this.eingabe.fahren.blickX);
    this.welt.aktualisiere(this.grafik.kamera.position, dt);
    const winter = this.atmosphaere.jahreszeit === 'winter';
    this.effekte.niederschlag(this.grafik.kamera.position, f.v.x, f.v.z, this.atmosphaere.regen * (1 - this.atmosphaere.tunnel), winter, dt);
    this.effekte.aktualisiere(dt);
    for (const h of this.beiBild) h(dt, alpha);

    UMGEBUNG.uLampeStaerke.value = nacht ? 1 : 0;
    UMGEBUNG.uLampePos.value.set(g.x + f.vorn.x * 1.6, g.y + 0.3, g.z + f.vorn.z * 1.6);
    UMGEBUNG.uLampeRichtung.value.set(f.vorn.x, f.vorn.y - 0.12, f.vorn.z).normalize();
    this.grafik.zeichne();
    this.grafik.regleAufloesung(this.schleife.bildzeit);
    this.hud.aktualisiere(f);
    if (this.diagnose && this.schleife.bilder % 10 === 0) {
      const info = this.grafik.renderer.info.render;
      this.hud.diagnose.classList.remove('versteckt');
      this.hud.diagnose.textContent = `${(1000 / this.schleife.bildzeit).toFixed(0)} FPS  ${this.schleife.arbeitszeit.toFixed(1)} ms  Aufrufe ${info.calls}  Dreiecke ${(info.triangles / 1000).toFixed(0)}k  Kacheln ${this.insel?.kachelnAktiv ?? 0}  Partikel ${this.effekte.partikel.aktiv}  Skal. ${this.grafik.skalierung.toFixed(2)}\n${f.pos.x.toFixed(0)}, ${f.pos.y.toFixed(1)}, ${f.pos.z.toFixed(0)}`;
    }
  }

  private aktion(a: Aktion): void {
    for (const h of this.beiAktion) if (h(a) === true) return;
    const f = this.spieler;
    switch (a) {
      case 'kamera': this.kamera.naechsterModus(); break;
      case 'zuruecksetzen': this.setzeZurueck(this.spielerAuto); break;
      case 'schalteHoch': f.schalte(1); break;
      case 'schalteRunter': f.schalte(-1); break;
    }
  }
}
