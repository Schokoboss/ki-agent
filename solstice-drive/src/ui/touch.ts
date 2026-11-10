import type { Eingabe, Aktion } from '../engine/eingabe';
import { klemme } from '../engine/mathe';
import { el, symbol, SYMBOLE } from './dom';

export type TouchLenkung = 'schieber' | 'tasten' | 'neigung';

/** Bildschirm-Steuerung für Touch-Geräte (Querformat, zweihändig). */
export class TouchSteuerung {
  readonly wurzel: HTMLElement;
  lenkart: TouchLenkung = 'schieber';
  private readonly spur: HTMLElement;
  private readonly knopf: HTMLElement;
  private readonly tasten: HTMLElement;
  private readonly zone: HTMLElement;
  private lenkZeiger = -1;
  private lenkStart = 0;
  private links = false;
  private rechts = false;
  /** Gas automatisch halten (einhändiges Fahren, Barrierefreiheit). */
  autoGas = false;
  private bremst = false;

  constructor(private readonly eingabe: Eingabe, eltern: HTMLElement) {
    this.spur = el('div', { klasse: 'lenkspur' });
    this.knopf = el('div', { klasse: 'lenkknopf' });
    this.knopf.append(symbol('M8 5l-6 7 6 7v-5h8v5l6-7-6-7v5H8z', 26));
    this.spur.append(this.knopf);
    this.zone = el('div', { klasse: 'lenkzone' });
    this.tasten = el('div', { klasse: 'lenktasten' });
    const tl = this.halteKnopf('tknopf', symbol(SYMBOLE.links, 40), (an) => { this.links = an; this.lenkeTasten(); });
    const tr = this.halteKnopf('tknopf', symbol(SYMBOLE.rechts, 40), (an) => { this.rechts = an; this.lenkeTasten(); });
    this.tasten.append(tl, tr);

    const gas = this.halteKnopf('tknopf gas', 'GAS', (an) => { eingabe.touch.gas = an ? 1 : 0; });
    const bremse = this.halteKnopf('tknopf bremse', 'BREMSE', (an) => { eingabe.touch.bremse = an ? 1 : 0; this.bremst = an; });
    const hb = this.halteKnopf('tknopf hb', 'HANDBR.', (an) => { eingabe.touch.handbremse = an ? 1 : 0; });
    const pedale = el('div', { klasse: 'pedale' }, bremse, gas);

    const leisteR = el('div', { klasse: 'leiste' },
      this.tippKnopf(SYMBOLE.karte, 'karte', 'Karte'),
      this.tippKnopf(SYMBOLE.kamera, 'kamera', 'Kamera'),
      this.tippKnopf(SYMBOLE.pause, 'pause', 'Pause'),
    );
    const leisteL = el('div', { klasse: 'leiste links' },
      this.tippKnopf(SYMBOLE.zurueckspulen, 'rueckspulen', 'Rückspulen'),
      this.tippKnopf(SYMBOLE.zuruecksetzen, 'zuruecksetzen', 'Zurücksetzen'),
    );
    this.wurzel = el('div', { klasse: 'touch versteckt' }, this.zone, this.spur, this.tasten, pedale, hb, leisteR, leisteL);
    eltern.append(this.wurzel);
    this.richteLenkzoneEin();
    this.setzeLenkart('schieber');

    // Erster Touch schaltet die Bildschirm-Steuerung ein
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') { eingabe.quelle = 'touch'; eingabe.touch.aktiv = true; this.zeige(true); }
    }, { capture: true });
  }

  zeige(an: boolean): void { this.wurzel.classList.toggle('versteckt', !an); }
  get sichtbar(): boolean { return !this.wurzel.classList.contains('versteckt'); }

  setzeLenkart(art: TouchLenkung): void {
    this.lenkart = art;
    this.spur.classList.toggle('versteckt', art !== 'schieber');
    this.zone.classList.toggle('versteckt', art !== 'schieber');
    this.tasten.classList.toggle('versteckt', art !== 'tasten');
    this.eingabe.neigungAktiv = art === 'neigung';
    this.eingabe.touch.lenkung = 0;
    if (art === 'neigung') {
      const D = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
      if (typeof D.requestPermission === 'function') void D.requestPermission().catch(() => undefined);
    }
  }

  /** Einmal pro Bild: Auto-Gas anwenden. */
  aktualisiere(): void {
    if (this.autoGas && this.eingabe.touch.aktiv) this.eingabe.touch.gas = this.bremst ? 0 : 1;
  }

  private lenkeTasten(): void {
    this.eingabe.touch.lenkung = (this.rechts ? 1 : 0) - (this.links ? 1 : 0);
  }

  private richteLenkzoneEin(): void {
    const z = this.zone;
    const setze = (wert: number) => {
      this.eingabe.touch.lenkung = wert;
      this.knopf.style.transform = `translateX(${wert * 66}px)`;
    };
    z.addEventListener('pointerdown', (e) => {
      if (this.lenkZeiger !== -1) return;
      this.lenkZeiger = e.pointerId;
      z.setPointerCapture(e.pointerId);
      // Bezugspunkt: Mitte der Spur, falls der Finger auf der Spur landet, sonst der Startpunkt
      const r = this.spur.getBoundingClientRect();
      const aufSpur = e.clientX >= r.left - 20 && e.clientX <= r.right + 20 && e.clientY >= r.top - 30;
      this.lenkStart = aufSpur ? r.left + r.width / 2 : e.clientX;
      setze(klemme((e.clientX - this.lenkStart) / 66, -1, 1));
      e.preventDefault();
    });
    z.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lenkZeiger) return;
      const roh = klemme((e.clientX - this.lenkStart) / 66, -1, 1);
      // leichte Kennlinie: feinfühlig um die Mitte
      setze(Math.sign(roh) * Math.pow(Math.abs(roh), 1.25));
    });
    const ende = (e: PointerEvent) => {
      if (e.pointerId !== this.lenkZeiger) return;
      this.lenkZeiger = -1;
      setze(0);
    };
    z.addEventListener('pointerup', ende);
    z.addEventListener('pointercancel', ende);
  }

  private halteKnopf(klasse: string, inhalt: string | Node, bei: (an: boolean) => void): HTMLElement {
    const k = el('div', { klasse }, inhalt);
    let zeiger = -1;
    k.addEventListener('pointerdown', (e) => {
      zeiger = e.pointerId; k.setPointerCapture(e.pointerId); k.classList.add('aktiv'); bei(true); e.preventDefault();
    });
    const ende = (e: PointerEvent) => {
      if (e.pointerId !== zeiger) return;
      zeiger = -1; k.classList.remove('aktiv'); bei(false);
    };
    k.addEventListener('pointerup', ende);
    k.addEventListener('pointercancel', ende);
    return k;
  }

  private tippKnopf(pfad: string, aktion: Aktion, titel: string): HTMLElement {
    const k = el('div', { klasse: 'tknopf klein', role: 'button', 'aria-label': titel }, symbol(pfad, 22));
    k.addEventListener('pointerdown', (e) => { this.eingabe.melde(aktion); k.classList.add('aktiv'); e.preventDefault(); e.stopPropagation(); });
    k.addEventListener('pointerup', () => k.classList.remove('aktiv'));
    k.addEventListener('pointercancel', () => k.classList.remove('aktiv'));
    return k;
  }
}
