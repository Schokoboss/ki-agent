// Erfolge: Ziele quer durchs Spiel mit Fortschritt und Credits-Belohnung. Prüfung alle 2 s aus dem Spielstand.
import { EVENTS, CARS, CHAMPS } from './data.js';
import { fmtNum } from './util.js';

const best = (g, type) => Math.max(0, ...EVENTS.filter(e => e.type === type).map(e => g.save.best[e.id] || 0));
const starsOf = (g, type) => EVENTS.filter(e => e.type === type).filter(e => (g.save.stars[e.id] || 0) >= 3).length;
const champWins = g => Object.values(g.save.champs || {}).filter(c => c.best === 1).length;
const tuned = g => Object.values(g.save.owned).some(o => o.up && ['motor', 'reifen', 'fahrwerk', 'nitro'].every(k => (o.up[k] || 0) >= 3));
const races = EVENTS.filter(e => e.type === 'race').length;

// [id, Gruppe, Name, Beschreibung, Ziel, Wert(g), Belohnung CR]
export const ACH = [
  ['km1', 'Fahren', 'Erste Runde', 'Fahre 1 km', 1, g => g.save.stats.km, 1000],
  ['km50', 'Fahren', 'Inselbummler', 'Fahre 50 km', 50, g => g.save.stats.km, 5000],
  ['km250', 'Fahren', 'Weltenbummler', 'Fahre 250 km', 250, g => g.save.stats.km, 20000],
  ['v200', 'Fahren', 'Tempo 200', 'Erreiche 200 km/h', 200, g => g.save.stats.top, 3000],
  ['v300', 'Fahren', 'Tempo 300', 'Erreiche 300 km/h', 300, g => g.save.stats.top, 10000],
  ['v330', 'Fahren', 'Schallmauer', 'Erreiche 330 km/h', 330, g => g.save.stats.top, 12000],
  ['win1', 'Rennen', 'Erster Sieg', 'Gewinne ein Rennen', 1, g => g.save.stats.wins, 3000],
  ['win10', 'Rennen', 'Seriensieger', 'Gewinne 10 Rennen', 10, g => g.save.stats.wins, 10000],
  ['race25', 'Rennen', 'Rennprofi', 'Fahre 25 Rennen', 25, g => g.save.stats.races, 10000],
  ['gold', 'Rennen', 'Goldstück', `3 Sterne in allen ${races} Rennen`, races, g => starsOf(g, 'race'), 25000],
  ['champ1', 'Rennen', 'Meister', 'Gewinne eine Meisterschaft', 1, champWins, 10000],
  ['champAll', 'Rennen', 'Großmeister', `Gewinne alle ${CHAMPS.length} Meisterschaften`, CHAMPS.length, champWins, 35000],
  ['drift3', 'Können', 'Driftkönig', '3 Sterne in einer Driftzone', 1, g => starsOf(g, 'drift'), 5000],
  ['jump100', 'Können', 'Schanzenkönig', 'Springe 100 m weit', 100, g => best(g, 'jump'), 8000],
  ['trap250', 'Können', 'Geblitzt!', 'Fahre mit 250 km/h durch einen Blitzer', 250, g => best(g, 'trap'), 8000],
  ['speed3', 'Können', 'Tempomacher', '3 Sterne in einer Tempozone', 1, g => starsOf(g, 'speed'), 5000],
  ['chain50', 'Können', 'Kettenreaktion', 'Skill-Kette mit 50.000 Punkten', 50000, g => g.save.stats.bestChain, 10000],
  ['near100', 'Können', 'Haarscharf', '100× knapp vorbei', 100, g => g.save.stats.near, 6000],
  ['smash200', 'Können', 'Abrissbirne', 'Zerstöre 200 Dinge', 200, g => g.save.stats.smashed, 6000],
  ['post10', 'Entdecken', 'Plakatjäger', 'Finde 10 Festival-Plakate', 10, g => g.save.posters.length, 5000],
  ['post20', 'Entdecken', 'Alle Plakate', 'Finde alle 20 Plakate', 20, g => g.save.posters.length, 15000],
  ['barn1', 'Entdecken', 'Schatzsucher', 'Finde einen Scheunenfund', 1, g => (g.save.barns || []).length, 5000],
  ['barn4', 'Entdecken', 'Scheunen-Profi', 'Finde alle 4 Scheunenfunde', 4, g => (g.save.barns || []).length, 12000],
  ['view4', 'Entdecken', 'Ausblick', 'Entdecke 4 Aussichtspunkte', 4, g => (g.save.views || []).length, 4000],
  ['view8', 'Entdecken', 'Panorama', 'Entdecke alle 8 Aussichtspunkte', 8, g => (g.save.views || []).length, 10000],
  ['cars5', 'Sammeln', 'Sammler', 'Besitze 5 Autos', 5, g => Object.keys(g.save.owned).length, 8000],
  ['cars15', 'Sammeln', 'Großer Fuhrpark', 'Besitze 15 Autos', 15, g => Object.keys(g.save.owned).length, 15000],
  ['carsAll', 'Sammeln', 'Komplette Garage', `Besitze alle ${CARS.length} Autos`, CARS.length, g => Object.keys(g.save.owned).length, 40000],
  ['million', 'Sammeln', 'Millionär', 'Verdiene insgesamt 1.000.000 CR', 1e6, g => g.save.stats.earned, 12000],
  ['paint', 'Sammeln', 'Lackierer', 'Gib einem Auto ein Design in der Lackiererei', 1, g => (Object.values(g.save.owned).some(o => o.livery && o.livery.p && o.livery.p !== 'none') ? 1 : 0), 2000],
  ['tune', 'Sammeln', 'Tuner', 'Tune ein Auto in allen Bereichen auf Stufe 3', 1, g => (tuned(g) ? 1 : 0), 10000],
  ['mp', 'Sammeln', 'Gesellig', 'Fahr im Mehrspieler-Raum mit Freunden', 1, g => (g.save.mpJoined ? 1 : 0), 3000],
  ['spin10', 'Sammeln', 'Glückspilz', 'Dreh 10× am Glücksrad', 10, g => g.save.stats.spins, 5000],
];

export class Achievements {
  constructor(g) { this.g = g; this.t = 0; }
  done() { return this.g.save.ach || (this.g.save.ach = []); }
  // alle 2 s prüfen (nicht während der Rennen-Ergebnisse/Kamerafahrten mit Meldungen fluten: max. eine Meldung pro Prüfung)
  tick(dt) {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 2;
    const g = this.g, got = this.done();
    for (const [id, , name, , goal, val, cr] of ACH) {
      if (got.includes(id)) continue;
      let v = 0; try { v = val(g) || 0; } catch { v = 0; }
      if (v >= goal) {
        got.push(id);
        g.reward(cr, Math.round(cr / 30), false);
        g.hud.toast(`🏅 Erfolg: ${name} · +${fmtNum(cr)} CR`, 'info');
        g.audio.play('bank');
        g.saveGame();
        return;
      }
    }
  }
  render(box) {
    const g = this.g, got = this.done();
    box.innerHTML = '';
    const head = document.createElement('div'); head.className = 'ac-sum';
    head.textContent = `${got.length} / ${ACH.length} erreicht`;
    box.appendChild(head);
    let group = '';
    for (const [id, grp, name, desc, goal, val, cr] of ACH) {
      if (grp !== group) { group = grp; const h = document.createElement('div'); h.className = 'ac-grp'; h.textContent = grp; box.appendChild(h); }
      let v = 0; try { v = val(g) || 0; } catch { v = 0; }
      const ok = got.includes(id), f = Math.min(1, v / goal);
      const row = document.createElement('div'); row.className = 'ac' + (ok ? ' ok' : '');
      row.innerHTML = `<div class="ac-i">${ok ? '🏅' : '○'}</div><div class="ac-b"><b></b><span></span><div class="bar"><i style="width:${(f * 100).toFixed(1)}%"></i></div></div><div class="ac-r">${ok ? '✓' : '+' + fmtNum(cr)}</div>`;
      row.querySelector('b').textContent = name;
      row.querySelector('span').textContent = `${desc}${!ok && goal > 1 ? ` · ${fmtNum(Math.floor(Math.min(v, goal)))} / ${fmtNum(goal)}` : ''}`;
      box.appendChild(row);
    }
  }
}
