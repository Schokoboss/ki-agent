import { describe, it, expect } from 'vitest';
import { U } from '../src/physik/untergrund';
import { ebene, neuesAuto, simuliere, beschleunigung, bremsweg, kurvengrenze } from './hilfen';

describe('Fahrphysik: Grundverhalten', () => {
  it('steht ruhig und bleibt stehen', () => {
    const b = ebene(U.ASPHALT);
    const f = neuesAuto('aurel-s7', b);
    simuliere(f, b, 3);
    expect(f.tempo).toBeLessThan(0.02);
    expect(Math.abs(f.pos.x)).toBeLessThan(0.02);
    expect(Math.abs(f.pos.z)).toBeLessThan(0.05);
    expect(f.bodenRaeder).toBe(4);
    expect(f.pos.y).toBeGreaterThan(f.w.schwerpunktHoehe - 0.03);
    expect(f.pos.y).toBeLessThan(f.w.schwerpunktHoehe + 0.03);
  });

  it('beschleunigt plausibel (0–100 km/h)', () => {
    const b = ebene(U.ASPHALT);
    const zeiten: Record<string, number> = {};
    for (const id of ['tavio-pico', 'aurel-s7', 'halde-donner', 'brask-fjell', 'dunmark-bison', 'meridan-solara']) {
      zeiten[id] = beschleunigung(neuesAuto(id, b), b, 100);
    }
    console.log('0-100:', zeiten);
    expect(zeiten['tavio-pico']).toBeGreaterThan(5.5);
    expect(zeiten['tavio-pico']).toBeLessThan(9);
    expect(zeiten['meridan-solara']).toBeLessThan(3.8);
    expect(zeiten['meridan-solara']).toBeGreaterThan(2.2);
    expect(zeiten['aurel-s7']).toBeLessThan(5.6);
    expect(zeiten['dunmark-bison']).toBeGreaterThan(zeiten['aurel-s7']);
    expect(zeiten['brask-fjell']).toBeLessThan(zeiten['tavio-pico']);
  });

  it('erreicht die Höchstgeschwindigkeit aus den Stammdaten', () => {
    const b = ebene(U.ASPHALT);
    const f = neuesAuto('aurel-s7', b);
    f.gas = 1;
    simuliere(f, b, 70);
    console.log('vmax S7:', f.tempo * 3.6);
    expect(f.tempo * 3.6).toBeGreaterThan(272 * 0.95);
    expect(f.tempo * 3.6).toBeLessThan(272 * 1.06);
    expect(Math.abs(f.pos.x)).toBeLessThan(3);
  });

  it('Bremsweg wächst mit schlechterem Untergrund', () => {
    const wege: Record<string, number> = {};
    for (const [name, u] of [['asphalt', U.ASPHALT], ['schotter', U.SCHOTTER], ['gras', U.GRAS], ['schnee', U.SCHNEE], ['eis', U.EIS]] as const) {
      const b = ebene(u);
      wege[name] = bremsweg(neuesAuto('aurel-s7', b), b, 100);
    }
    console.log('Bremsweg 100-0:', wege);
    expect(wege.asphalt).toBeGreaterThan(28);
    expect(wege.asphalt).toBeLessThan(45);
    expect(wege.schotter).toBeGreaterThan(wege.asphalt * 1.25);
    expect(wege.gras).toBeGreaterThan(wege.schotter);
    expect(wege.schnee).toBeGreaterThan(wege.gras);
    expect(wege.eis).toBeGreaterThan(wege.schnee * 1.5);
  });

  it('Kurvengrenze je Untergrund und Klasse', () => {
    const g: Record<string, number> = {};
    for (const [name, u] of [['asphalt', U.ASPHALT], ['schotter', U.SCHOTTER], ['schnee', U.SCHNEE]] as const) {
      const b = ebene(u);
      g[name] = kurvengrenze(neuesAuto('aurel-s7', b), b);
    }
    const b = ebene(U.ASPHALT);
    g.superAsphalt = kurvengrenze(neuesAuto('meridan-solara', b), b);
    g.gelaendeAsphalt = kurvengrenze(neuesAuto('dunmark-bison', b), b);
    const bs = ebene(U.SCHOTTER);
    g.rallyeSchotter = kurvengrenze(neuesAuto('brask-fjell', bs), bs);
    console.log('Kurvengrenze (g):', g);
    expect(g.asphalt).toBeGreaterThan(0.95);
    expect(g.asphalt).toBeLessThan(1.35);
    expect(g.schotter).toBeLessThan(g.asphalt * 0.75);
    expect(g.schnee).toBeLessThan(g.schotter * 0.8);
    expect(g.superAsphalt).toBeGreaterThan(g.asphalt);
    expect(g.gelaendeAsphalt).toBeLessThan(g.asphalt);
    expect(g.rallyeSchotter).toBeGreaterThan(g.schotter * 1.2);
  });

  it('Drift bleibt mit Gas und Lenkung haltbar (starke Lenkhilfe)', () => {
    const b = ebene(U.ASPHALT);
    const f = neuesAuto('halde-donner', b);
    f.hilfen.lenkhilfe = 1;
    f.setzeTempo(60 / 3.6);
    let maxBeta = 0, driftZeit = 0;
    simuliere(f, b, 7, undefined, (t) => {
      f.gas = 1; f.lenkung = t > 0.5 ? -1 : 0;
      const beta = Math.abs(f.schwimmwinkel);
      if (t > 1) { maxBeta = Math.max(maxBeta, beta); if (beta > 0.17) driftZeit += 1 / 120; }
    });
    // rutscht deutlich (über 10°), dreht sich aber nicht weg (unter 50°) und bleibt lange im Drift
    expect(maxBeta).toBeGreaterThan(0.17);
    expect(maxBeta).toBeLessThan(0.87);
    expect(driftZeit).toBeGreaterThan(3);
    expect(f.tempo * 3.6).toBeGreaterThan(50);
  });

  it('Fronttriebler untersteuert, Hecktriebler übersteuert unter Last', () => {
    const b = ebene(U.ASPHALT);
    const lauf = (id: string) => {
      const f = neuesAuto(id, b);
      f.hilfen.lenkhilfe = 1;
      f.setzeTempo(70 / 3.6);
      let maxBeta = 0;
      simuliere(f, b, 4, undefined, (t) => { f.gas = 1; f.lenkung = t > 0.5 ? -1 : 0; maxBeta = Math.max(maxBeta, Math.abs(f.schwimmwinkel)); });
      return maxBeta;
    };
    const front = lauf('tavio-pico'), heck = lauf('halde-donner');
    expect(front).toBeLessThan(0.12);
    expect(heck).toBeGreaterThan(front * 2);
  });

  it('ist deterministisch', () => {
    const b = ebene(U.SCHOTTER);
    const lauf = () => {
      const f = neuesAuto('brask-fjell', b);
      simuliere(f, b, 8, undefined, (t) => { f.gas = 1; f.lenkung = Math.sin(t * 1.3) * 0.8; });
      return [f.pos.x, f.pos.y, f.pos.z, f.rot.w];
    };
    expect(lauf()).toEqual(lauf());
  });

  it('landet nach einem Sprung stabil', () => {
    const b = ebene(U.ASPHALT);
    const f = neuesAuto('brask-fjell', b);
    f.setzeTempo(30);
    f.pos.y += 2.5;
    let maxNick = 0;
    simuliere(f, b, 4, undefined, () => { maxNick = Math.max(maxNick, Math.abs(f.vorn.y)); });
    expect(f.bodenRaeder).toBe(4);
    expect(f.oben.y).toBeGreaterThan(0.98);
    expect(maxNick).toBeLessThan(0.3);
    expect(Number.isFinite(f.pos.x + f.pos.y + f.pos.z)).toBe(true);
  });
});
