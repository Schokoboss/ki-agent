import * as THREE from 'three';
import { Grafik, istMobil, type Qualitaet } from './engine/grafik';
import { Eingabe } from './engine/eingabe';
import { Spielschleife } from './engine/spielschleife';
import { Verfolgerkamera } from './engine/kamera';
import { UMGEBUNG } from './engine/shader';
import { Fahrzeug } from './physik/fahrzeug';
import type { Boden } from './physik/typen';
import { standardUmwelt, type Umwelt } from './physik/untergrund';
import { berechneFahrwerte } from './fahrzeuge/fahrwerte';
import { autoNachId, AUTOS } from './fahrzeuge/daten/autos';
import { FahrzeugAnsicht } from './fahrzeuge/ansicht';
import { Atmosphaere } from './welt/atmosphaere';
import { Himmel } from './welt/himmel';
import { Testgelaende } from './welt/testgelaende';
import { Inselwelt } from './welt/inselwelt';
import type { Weltkarte } from './welt/weltkarte';
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

export class Spiel {
  readonly grafik: Grafik;
  readonly eingabe: Eingabe;
  readonly schleife: Spielschleife;
  readonly atmosphaere = new Atmosphaere();
  readonly himmel: Himmel;
  readonly kamera = new Verfolgerkamera();
  readonly umwelt: Umwelt = standardUmwelt();
  readonly hud: Hud;
  readonly touch: TouchSteuerung;
  welt: Welt;
  spieler: Fahrzeug;
  ansicht: FahrzeugAnsicht;
  skript: Skripteingabe | null = null;
  zeit = 0;

  /** Inselwelt (null auf der Teststrecke). */
  insel: Inselwelt | null = null;
  diagnose = false;

  constructor(canvas: HTMLCanvasElement, ui: HTMLElement, karte: Weltkarte | null, qualitaet: Qualitaet = istMobil() ? 'mittel' : 'hoch') {
    this.grafik = new Grafik(canvas, qualitaet);
    this.eingabe = new Eingabe();
    this.himmel = new Himmel(this.grafik.qualitaet.wolken);
    this.grafik.szene.add(this.himmel.netz);
    if (karte) {
      this.insel = new Inselwelt(karte, this.grafik.qualitaet);
      this.welt = this.insel;
    } else this.welt = new Testgelaende();
    this.grafik.szene.add(this.welt.gruppe);

    const auto = autoNachId('aurel-s7');
    this.spieler = new Fahrzeug(berechneFahrwerte(auto));
    this.ansicht = new FahrzeugAnsicht(auto, { farbe: auto.farbe, akzent: auto.karosserie.akzent ?? 0x111111, glanz: 0.9, metallic: 0.4 });
    this.ansicht.inSzene(this.grafik.szene);
    const s = this.welt.startPunkt();
    this.spieler.setzeAuf(s.x, s.z, s.gier, this.welt);

    this.hud = new Hud(ui);
    this.touch = new TouchSteuerung(this.eingabe, ui);
    this.schleife = new Spielschleife((dt) => this.physik(dt), (alpha, dt) => this.zeichne(alpha, dt));
    this.atmosphaere.aktualisiere(0);
    this.insel?.ladeAlles(new THREE.Vector3(s.x, 0, s.z));
  }

  /** Versetzt das Spielerauto (Schnellreise, Werkzeuge). */
  teleportiere(x: number, z: number, gier: number): void {
    this.spieler.setzeAuf(x, z, gier, this.welt);
    this.kamera.springe();
    this.insel?.ladeAlles(new THREE.Vector3(x, 0, z));
  }

  autoIds(): string[] { return AUTOS.map((a) => a.id); }

  /** Tauscht das Spielerauto. */
  setzeAuto(id: string): void {
    const auto = autoNachId(id);
    const altGier = Math.atan2(this.spieler.vorn.x, this.spieler.vorn.z);
    const { x, z } = this.spieler.pos;
    this.ansicht.ausSzene(this.grafik.szene);
    this.ansicht.entsorge();
    this.spieler = new Fahrzeug(berechneFahrwerte(auto));
    this.ansicht = new FahrzeugAnsicht(auto, { farbe: auto.farbe, akzent: auto.karosserie.akzent ?? 0x111111, glanz: 0.9, metallic: 0.4 });
    this.ansicht.inSzene(this.grafik.szene);
    this.spieler.setzeAuf(x, z, altGier, this.welt);
    this.kamera.springe();
  }

  private physik(dt: number): void {
    const f = this.spieler;
    const e = this.skript ?? this.eingabe.fahren;
    f.gas = e.gas; f.bremse = e.bremse; f.lenkung = e.lenkung; f.handbremse = e.handbremse;
    this.umwelt.naesse = this.atmosphaere.naesse;
    if (this.insel) this.umwelt.wasserHoehe = this.insel.karte.wasserHoehe;
    f.schritt(dt, this.welt, this.umwelt);
    if (f.landung > 2.2) {
      this.kamera.stoss(f.landung);
      this.eingabe.vibriere(Math.min(1, f.landung / 7), 90);
    }
    this.zeit += dt;
  }

  private zeichne(alpha: number, dt: number): void {
    this.eingabe.aktualisiere();
    this.touch.aktualisiere();
    for (const a of this.eingabe.holeAktionen()) this.aktion(a);
    this.atmosphaere.aktualisiere(dt);
    const f = this.spieler;
    this.ansicht.aktualisiere(f, alpha, this.welt, dt);
    const g = this.ansicht.gruppe.position;
    this.kamera.aktualisiere(this.grafik.kamera, f, g.x, g.y, g.z, this.welt, dt, this.eingabe.fahren.blickZurueck, this.eingabe.fahren.blickX);
    this.welt.aktualisiere(this.grafik.kamera.position, dt);
    // Scheinwerfer
    const nacht = this.atmosphaere.sonnenHoehe < 0.1 || this.atmosphaere.nebelDichte > 0.002;
    this.ansicht.material.uniforms.uLicht.value = nacht ? 1 : 0;
    UMGEBUNG.uLampeStaerke.value = nacht ? 1 : 0;
    UMGEBUNG.uLampePos.value.set(g.x + f.vorn.x * 1.6, g.y + 0.3, g.z + f.vorn.z * 1.6);
    UMGEBUNG.uLampeRichtung.value.set(f.vorn.x, f.vorn.y - 0.12, f.vorn.z).normalize();
    this.grafik.zeichne();
    this.grafik.regleAufloesung(this.schleife.bildzeit);
    this.hud.aktualisiere(f);
    if (this.diagnose && this.schleife.bilder % 10 === 0) {
      const info = this.grafik.renderer.info.render;
      this.hud.diagnose.classList.remove('versteckt');
      this.hud.diagnose.textContent = `${(1000 / this.schleife.bildzeit).toFixed(0)} FPS  ${this.schleife.arbeitszeit.toFixed(1)} ms  Aufrufe ${info.calls}  Dreiecke ${(info.triangles / 1000).toFixed(0)}k  Kacheln ${this.insel?.kachelnAktiv ?? 0}  Skal. ${this.grafik.skalierung.toFixed(2)}\n${f.pos.x.toFixed(0)}, ${f.pos.y.toFixed(1)}, ${f.pos.z.toFixed(0)}`;
    }
  }

  private aktion(a: string): void {
    const f = this.spieler;
    switch (a) {
      case 'kamera': this.kamera.naechsterModus(); break;
      case 'zuruecksetzen': {
        const gier = Math.atan2(f.vorn.x, f.vorn.z);
        f.setzeAuf(f.pos.x, f.pos.z, gier, this.welt, f.pos.y + 2);
        this.kamera.springe();
        break;
      }
      case 'schalteHoch': f.schalte(1); break;
      case 'schalteRunter': f.schalte(-1); break;
    }
  }
}
