import type { Fahrzeug } from '../physik/fahrzeug';
import { el } from './dom';

/** Anzeige während der Fahrt. */
export class Hud {
  readonly wurzel: HTMLElement;
  private readonly kmh: HTMLElement;
  private readonly gang: HTMLElement;
  private readonly dzBalken: HTMLElement;
  private readonly dz: HTMLElement;
  readonly diagnose: HTMLElement;
  private letzteKmh = -1;
  private letzterGang = '';
  einheitMph = false;

  constructor(eltern: HTMLElement) {
    this.kmh = el('div', { klasse: 'kmh', text: '0' });
    this.gang = el('div', { klasse: 'gang', text: '1' });
    this.dzBalken = el('i');
    this.dz = el('div', { klasse: 'drehzahl' }, this.dzBalken);
    const tacho = el('div', { klasse: 'tacho' }, this.kmh, el('div', { klasse: 'einheit', text: 'KM/H' }), this.gang, this.dz);
    this.diagnose = el('div', { klasse: 'diagnose versteckt' });
    this.wurzel = el('div', { klasse: 'hud' }, tacho, this.diagnose);
    eltern.append(this.wurzel);
  }

  aktualisiere(f: Fahrzeug): void {
    const v = Math.round(f.tempo * (this.einheitMph ? 2.23694 : 3.6));
    if (v !== this.letzteKmh) { this.kmh.textContent = String(v); this.letzteKmh = v; }
    const g = f.gang < 0 ? 'R' : f.gang === 0 ? 'N' : String(f.gang);
    if (g !== this.letzterGang) { this.gang.textContent = g; this.letzterGang = g; }
    const anteil = Math.min(1, f.drehzahl / f.w.maxDrehzahl);
    this.dzBalken.style.width = `${(anteil * 100).toFixed(1)}%`;
    this.dz.classList.toggle('rot', anteil > 0.93);
  }
}
