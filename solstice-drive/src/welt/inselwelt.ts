import * as THREE from 'three';
import type { Bodenkontakt } from '../physik/typen';
import { objektMaterial } from '../engine/netzbau';
import type { QualitaetsWerte } from '../engine/grafik';
import { KACHEL, KACHELN, WELT_HALB } from './daten/regionen';
import { baueFernnetz, baueKachelGeometrie, gelaendeMaterial, NAH_RADIUS_UNIFORM, WASSER_UNIFORM } from './gelaende';
import { StrassenKacheln, strassenMaterial } from './strassenbau';
import { Wasser } from './wasser';
import type { Weltkarte } from './weltkarte';
import { Objektverwaltung } from './objekte';
import { bauePflanzen, KachelRequisiten, pflanzenMaterial } from './bewuchs';

interface KachelAnsicht {
  lod: number;
  gelaende: THREE.Mesh;
  strasse: THREE.Mesh | null;
  bauwerk: THREE.Mesh | null;
  pflanzen: THREE.Mesh | null;
  /** Detailstufe, für die das Pflanzennetz gebaut wurde (0 voll, 1 ausgedünnt, 2 keins). */
  pflanzenStufe: number;
  requisiten: KachelRequisiten | null;
}

/** Entfernungsgrenzen der Detailstufen in m (mit Hysterese beim Vergröbern). */
const LOD_GRENZEN = [400, 800, 1500];

/** Sichtbare Inselwelt: streamt Geländekacheln, Straßen und Bauwerke um die Kamera. */
export class Inselwelt {
  readonly gruppe = new THREE.Group();
  private readonly kacheln: (KachelAnsicht | null)[] = new Array(KACHELN * KACHELN).fill(null);
  private readonly strassen: StrassenKacheln;
  private readonly wasser: Wasser;
  private readonly warteschlange: number[] = [];
  private letzteX = 1e9;
  private letzteZ = 1e9;
  private readonly kameraPos = new THREE.Vector3();
  /** Zähler für Diagnose. */
  kachelnAktiv = 0;
  readonly objekte: Objektverwaltung;

  constructor(readonly karte: Weltkarte, private qualitaet: QualitaetsWerte) {
    this.strassen = new StrassenKacheln(karte);
    this.objekte = new Objektverwaltung(karte);
    this.gruppe.add(baueFernnetz(karte));
    this.wasser = new Wasser(karte);
    this.gruppe.add(this.wasser.netz);
    WASSER_UNIFORM.value = karte.wasserHoehe;
  }

  setzeQualitaet(q: QualitaetsWerte): void { this.qualitaet = q; this.letzteX = 1e9; }

  abfrage(x: number, z: number, y: number, aus: Bodenkontakt): void { this.karte.abfrage(x, z, y, aus); }

  startPunkt(): { x: number; z: number; gier: number } {
    return { x: 153, z: 250, gier: Math.PI };
  }

  private wunschLod(index: number, kx: number, kz: number): number {
    const cx = (kx + 0.5) * KACHEL - WELT_HALB, cz = (kz + 0.5) * KACHEL - WELT_HALB;
    const d = Math.max(0, Math.hypot(cx - this.kameraPos.x, cz - this.kameraPos.z) - KACHEL * 0.5);
    if (d > this.qualitaet.sichtweite) return -1;
    const alt = this.kacheln[index];
    let lod = 3;
    for (let l = 0; l < 3; l++) {
      // Hysterese: eine bereits feinere Kachel bleibt etwas länger fein
      const grenze = LOD_GRENZEN[l] * (alt && alt.lod <= l ? 1.12 : 1);
      if (d < grenze) { lod = l; break; }
    }
    return lod;
  }

  /** Streaming: hält die Kacheln um die Kamera aktuell. Baut höchstens `budget` Kacheln je Aufruf. */
  aktualisiere(kamera: THREE.Vector3, _dt: number, budget = 2): void {
    this.kameraPos.copy(kamera);
    WASSER_UNIFORM.value = this.karte.wasserHoehe;
    NAH_RADIUS_UNIFORM.value = this.warteschlange.length > 6 ? 0 : this.qualitaet.sichtweite - 420;
    if (Math.abs(kamera.x - this.letzteX) + Math.abs(kamera.z - this.letzteZ) > 24) {
      this.letzteX = kamera.x; this.letzteZ = kamera.z;
      this.plane();
    }
    // Zerstörte Requisiten nachziehen
    for (const k of this.kacheln) if (k?.requisiten) k.requisiten.gleicheAb();
    let gebaut = 0;
    while (this.warteschlange.length > 0 && gebaut < budget) {
      const index = this.warteschlange.shift()!;
      const kx = index % KACHELN, kz = (index - kx) / KACHELN;
      const lod = this.wunschLod(index, kx, kz);
      const alt = this.kacheln[index];
      if (lod < 0) { if (alt) this.entferne(index); continue; }
      if (alt && alt.lod === lod) continue;
      this.baue(index, kx, kz, lod);
      gebaut++;
    }
  }

  /** Baut sofort alles in Sichtweite (Ladebildschirm, Schnellreise). */
  ladeAlles(kamera: THREE.Vector3): void {
    this.letzteX = 1e9;
    this.aktualisiere(kamera, 0, 100000);
  }

  private plane(): void {
    const r = Math.ceil(this.qualitaet.sichtweite / KACHEL) + 1;
    const ckx = Math.floor((this.kameraPos.x + WELT_HALB) / KACHEL), ckz = Math.floor((this.kameraPos.z + WELT_HALB) / KACHEL);
    const liste: { index: number; d: number }[] = [];
    for (let kz = Math.max(0, ckz - r); kz <= Math.min(KACHELN - 1, ckz + r); kz++) {
      for (let kx = Math.max(0, ckx - r); kx <= Math.min(KACHELN - 1, ckx + r); kx++) {
        const index = kz * KACHELN + kx;
        const lod = this.wunschLod(index, kx, kz);
        const alt = this.kacheln[index];
        if ((lod < 0 && alt) || (lod >= 0 && (!alt || alt.lod !== lod))) {
          liste.push({ index, d: Math.hypot(kx - ckx, kz - ckz) });
        }
      }
    }
    // Kacheln weit außerhalb entfernen
    for (let i = 0; i < this.kacheln.length; i++) {
      if (!this.kacheln[i]) continue;
      const kx = i % KACHELN, kz = (i - kx) / KACHELN;
      if (Math.abs(kx - ckx) > r || Math.abs(kz - ckz) > r) this.entferne(i);
    }
    liste.sort((a, b) => a.d - b.d);
    this.warteschlange.length = 0;
    for (const e of liste) this.warteschlange.push(e.index);
  }

  private baue(index: number, kx: number, kz: number, lod: number): void {
    const alt = this.kacheln[index];
    const geo = baueKachelGeometrie(this.karte, kx, kz, lod);
    if (alt) {
      alt.gelaende.geometry.dispose();
      alt.gelaende.geometry = geo;
      alt.lod = lod;
      if (alt.strasse) alt.strasse.visible = lod <= 2;
      if (alt.bauwerk) alt.bauwerk.visible = lod <= 2;
      this.bewuchs(index, alt);
      return;
    }
    const gelaende = new THREE.Mesh(geo, gelaendeMaterial());
    gelaende.matrixAutoUpdate = false;
    this.gruppe.add(gelaende);
    const k: KachelAnsicht = { lod, gelaende, strasse: null, bauwerk: null, pflanzen: null, pflanzenStufe: -1, requisiten: null };
    const sg = this.strassen.baueFahrbahn(index);
    if (sg) {
      k.strasse = new THREE.Mesh(sg, strassenMaterial());
      k.strasse.matrixAutoUpdate = false;
      k.strasse.visible = lod <= 2;
      this.gruppe.add(k.strasse);
    }
    const bg = this.strassen.baueBauwerke(index);
    if (bg) {
      k.bauwerk = new THREE.Mesh(bg, objektMaterial(true));
      k.bauwerk.matrixAutoUpdate = false;
      k.bauwerk.visible = lod <= 2;
      this.gruppe.add(k.bauwerk);
    }
    this.kacheln[index] = k;
    this.kachelnAktiv++;
    this.bewuchs(index, k);
  }

  /** Pflanzen und Requisiten passend zur Detailstufe der Kachel. */
  private bewuchs(index: number, k: KachelAnsicht): void {
    const stufe = k.lod <= 1 ? 0 : k.lod === 2 ? 1 : 2;
    if (stufe !== k.pflanzenStufe) {
      if (k.pflanzen) { this.gruppe.remove(k.pflanzen); k.pflanzen.geometry.dispose(); k.pflanzen = null; }
      k.pflanzenStufe = stufe;
      if (stufe < 2) {
        const geo = bauePflanzen(this.objekte.kachel(index), stufe === 0 ? this.qualitaet.dichte >= 1 ? 1 : 0.999 * this.qualitaet.dichte + 0.001 : 0.4 * this.qualitaet.dichte);
        if (geo) {
          k.pflanzen = new THREE.Mesh(geo, pflanzenMaterial());
          k.pflanzen.matrixAutoUpdate = false;
          this.gruppe.add(k.pflanzen);
        }
      }
    }
    const requisiten = k.lod <= 1;
    if (requisiten && !k.requisiten) {
      const r = new KachelRequisiten(this.objekte.kachel(index));
      if (!r.leer) { k.requisiten = r; this.gruppe.add(r.gruppe); }
    } else if (!requisiten && k.requisiten) {
      this.gruppe.remove(k.requisiten.gruppe); k.requisiten.entsorge(); k.requisiten = null;
    }
  }

  private entferne(index: number): void {
    const k = this.kacheln[index];
    if (!k) return;
    this.gruppe.remove(k.gelaende);
    k.gelaende.geometry.dispose();
    if (k.strasse) { this.gruppe.remove(k.strasse); k.strasse.geometry.dispose(); }
    if (k.bauwerk) { this.gruppe.remove(k.bauwerk); k.bauwerk.geometry.dispose(); }
    if (k.pflanzen) { this.gruppe.remove(k.pflanzen); k.pflanzen.geometry.dispose(); }
    if (k.requisiten) { this.gruppe.remove(k.requisiten.gruppe); k.requisiten.entsorge(); }
    this.kacheln[index] = null;
    this.kachelnAktiv--;
  }
}
