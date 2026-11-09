// Dino-Sprint 3D im unsichtbaren Chrome: Solo (ein Bot spielt), Power-ups, Unfall + Weiterlaufen, Shop und
// Mehrspieler mit zwei Spielern (PC + Handy) – Lobby, Rennen, Meteor-Angriff, Ergebnis mit Bonus-Münzen.
//
//   node werkzeuge/dinotest.mjs                              → startet python server/dino_mp.py selbst
//   node werkzeuge/dinotest.mjs --url http://localhost:8765   → gegen laufenden Nova (Spiel unter /dino/)
//   --three <datei>   three.js aus einer Datei statt aus dem Internet · --chrome <pfad>   anderes Chrome
//
// Bildschirmfotos: werkzeuge/dinotest-ergebnis/index.html. Braucht nur Node 22, Python und Chrome – keine Pakete.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HIER, '..');
const arg = (name, d) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : d; };
const OUT = path.join(HIER, 'dinotest-ergebnis');
const THREE = arg('three', process.env.DINO_THREE || '');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fehler = 0;
const bilder = [];
function check(name, ok, extra = '') {
  console.log(`${ok ? 'OK    ' : 'FEHLER'} ${name}${extra ? ' – ' + extra : ''}`);
  if (!ok) fehler++;
}

/* ---------- Mini-CDP-Client (wie in handytest.mjs) */
class CDP {
  constructor(url) { this.ws = new WebSocket(url); this.id = 0; this.wait = new Map(); this.hooks = []; }
  open() {
    return new Promise((ok, fail) => {
      this.ws.onopen = ok;
      this.ws.onerror = fail;
      this.ws.onmessage = m => {
        const d = JSON.parse(m.data);
        if (d.id && this.wait.has(d.id)) { const [res, rej] = this.wait.get(d.id); this.wait.delete(d.id); d.error ? rej(new Error(d.error.message)) : res(d.result); }
        else if (d.method) this.hooks.forEach(h => h(d));
      };
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((res, rej) => this.wait.set(id, [res, rej]));
  }
  on(fn) { this.hooks.push(fn); }
}

function chromePfad() {
  const kand = [arg('chrome'), process.env.CHROME, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'), '/usr/bin/google-chrome', '/usr/bin/chromium',
    '/opt/pw-browsers/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  for (const p of kand) if (p && fs.existsSync(p)) return p;
  throw new Error('Chrome nicht gefunden (--chrome <pfad>).');
}

async function dinoServer() {
  const py = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const srv = spawn(py, ['-u', path.join(ROOT, 'server', 'dino_mp.py'), '--port', '0', '--host', '127.0.0.1']);
  const url = await new Promise((ok, fail) => {
    let buf = '';
    srv.stdout.on('data', d => { buf += d; const m = buf.match(/http:\/\/localhost:(\d+)\/dino\//); if (m) ok(`http://127.0.0.1:${m[1]}`); });
    srv.on('exit', c => fail(new Error('Dino-Server beendet sich (' + c + ')')));
    setTimeout(() => fail(new Error('Dino-Server startet nicht.')), 15000);
  });
  return { srv, url };
}

// Ein Tab mit eigenem Speicher (wie ein eigenes Gerät)
async function tab(cdp, name, geraet, speicher) {
  const { browserContextId } = await cdp.send('Target.createBrowserContext');
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId: s } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const t = { name, s, fehlerJs: [], geraet };
  cdp.on(d => {
    if (d.sessionId !== s) return;
    if (d.method === 'Runtime.exceptionThrown') t.fehlerJs.push(d.params.exceptionDetails.exception?.description?.split('\n')[0] || d.params.exceptionDetails.text);
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') t.fehlerJs.push(d.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 200));
    if (d.method === 'Fetch.requestPaused') {
      cdp.send('Fetch.fulfillRequest', { requestId: d.params.requestId, responseCode: 200, body: fs.readFileSync(THREE).toString('base64'),
        responseHeaders: [{ name: 'Content-Type', value: 'text/javascript' }, { name: 'Access-Control-Allow-Origin', value: '*' }] }, s);
    }
  });
  for (const m of ['Page.enable', 'Runtime.enable']) await cdp.send(m, {}, s);
  if (THREE) await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*cdn.jsdelivr.net/npm/three@*' }] }, s);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: geraet.w, height: geraet.h, deviceScaleFactor: 1, mobile: !!geraet.mobile }, s);
  if (geraet.mobile) await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, s);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { if (!localStorage.getItem('dino3d.v1')) localStorage.setItem('dino3d.v1', ${JSON.stringify(JSON.stringify(speicher))}); } catch {}` }, s);
  t.js = async (code) => {
    const r = await cdp.send('Runtime.evaluate', { expression: `(async () => { ${code} })()`, awaitPromise: true, returnByValue: true }, s);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split('\n')[0] || r.exceptionDetails.text);
    return r.result.value;
  };
  t.warte = async (bed, ms = 10000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { try { if (await t.js(`return !!(${bed})`)) return true; } catch { /* lädt noch */ } await sleep(150); }
    return false;
  };
  t.go = url => cdp.send('Page.navigate', { url }, s);
  t.foto = async (titel) => {
    await sleep(350);  // Einblend-Animationen auslaufen lassen
    const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 80 }, s);
    const datei = `${String(bilder.length).padStart(2, '0')}-${name}.jpg`;
    fs.writeFileSync(path.join(OUT, datei), Buffer.from(shot.data, 'base64'));
    bilder.push({ datei, titel: `${name}: ${titel}`, w: geraet.w });
  };
  t.zu = async () => { await cdp.send('Target.closeTarget', { targetId }); await cdp.send('Target.disposeBrowserContext', { browserContextId }); };
  return t;
}

// Bot fürs Solo-Spiel: läuft in der Seite (jedes Bild), weicht aus, springt, duckt
const BOT = `
  const LW = 2.4;
  const step = () => {
    requestAnimationFrame(step);
    if (dino.phase !== 'run') return;
    const a = dino.debug.ahead();
    const win = 4 + a.speed * 0.42;
    const block = (lane, from, to) => a.objs.filter(o => (o.full || Math.abs(o.x - lane * LW) < o.w + 0.5) && o.d - a.d > from && o.d - a.d < to);
    const mine = block(a.lane, -0.5, win).sort((p, q) => p.d - q.d);
    if (!mine.length) return;
    const o = mine[0];
    if (!o.full) for (const l of [a.lane - 1, a.lane + 1].filter(l => l >= -1 && l <= 1)) {
      if (!block(l, -1.5, win + 6).length) { dino.debug.act(l < a.lane ? 'left' : 'right'); return; }
    }
    if (o.y0 > 0.9) { dino.debug.act('duck'); return; }
    if (!a.air && o.d - a.d < 0.3 * a.speed + 1.5) dino.debug.act('jump');
  };
  requestAnimationFrame(step);`;

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  let server = null, base = arg('url', '');
  if (!base) { server = await dinoServer(); base = server.url; }
  base = base.replace(/\/+$/, '');
  console.log(`Dino-Test → ${base}/dino/${THREE ? '  (three.js aus ' + THREE + ')' : ''}\n`);

  const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'dinotest-'));
  const chrome = spawn(chromePfad(), ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profil}`, '--no-first-run',
    '--no-default-browser-check', '--hide-scrollbars', '--mute-audio', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--autoplay-policy=no-user-gesture-required', 'about:blank']);
  const wsUrl = await new Promise((ok, fail) => {
    let buf = '';
    chrome.stderr.on('data', d => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) ok(m[1]); });
    setTimeout(() => fail(new Error('Chrome startet nicht.')), 15000);
  });
  const cdp = new CDP(wsUrl);
  await cdp.open();

  try {
    // ------------------------------------------------------------ Solo am PC
    const A = await tab(cdp, 'PC', { w: 1280, h: 720 }, { help: true, name: 'Anna', dino: 'trike', owned: ['rex', 'trike'] });
    await A.go(base + '/dino/');
    check('Spiel lädt (three.js + Szene)', await A.warte('window.__dinoReady && dino.frames > 10', 30000));
    check('Menü sichtbar', await A.warte(`dino.screen === 'scrMenu'`));
    await A.foto('Menü');
    await A.js(`document.querySelector('#bSolo').click(); ${BOT}`);
    check('Solo startet', await A.warte(`dino.phase === 'run'`, 8000));
    const weit = await A.warte('dino.d > 250', 90000);
    const st = await A.js('return { d: Math.round(dino.d), coins: dino.coins, phase: dino.phase }');
    check('Bot läuft 250 m ohne Unfall (Strecke fair)', weit, JSON.stringify(st));
    check('Münzen gesammelt', st.coins > 0, `${st.coins}`);
    await A.foto('Solo-Lauf');
    await A.js(`['turbo','magnet','shield','double','jump','meteor'].forEach(k => dino.debug.power(k))`);
    await sleep(1500);
    check('alle Power-ups ohne Fehler', A.fehlerJs.length === 0, A.fehlerJs.join(' | '));
    await A.foto('Power-ups');
    const vorher = await A.js('return dino.save.coins');
    await A.js('dino.debug.kill()');
    check('Unfall → Ergebnis', await A.warte(`dino.screen === 'scrOver'`, 8000));
    check('Münzen gutgeschrieben', (await A.js('return dino.save.coins')) > vorher);
    await A.foto('Unfall');
    await A.js(`dino.debug.give(500); document.querySelector('#bRevive').disabled = false; document.querySelector('#bRevive').click()`);
    check('Weiterlaufen für Münzen', await A.warte(`dino.phase === 'run'`, 8000));
    await A.js('dino.debug.kill()');
    await A.warte(`dino.screen === 'scrOver'`, 8000);
    await A.js(`document.querySelector('#bOverMenu').click()`);
    check('zurück ins Menü', await A.warte(`dino.screen === 'scrMenu' && dino.phase === 'idle'`));

    // ------------------------------------------------------------ Shop
    await A.js(`dino.debug.give(1000); document.querySelector('#bShop').click()`);
    await A.warte(`dino.screen === 'scrShop'`);
    await A.js(`document.querySelector('.card[data-id=raptor] [data-act=buy]').click()`);
    const sv = await A.js('return dino.save');
    check('Dino kaufen', sv.owned.includes('raptor') && sv.dino === 'raptor', JSON.stringify({ owned: sv.owned, dino: sv.dino }));
    await A.foto('Shop');
    await A.js(`document.querySelector('.tab[data-tab=ups]').click(); document.querySelector('[data-up=magnet]').click()`);
    check('Upgrade kaufen', (await A.js('return dino.save.up.magnet')) === 1);
    await A.js(`document.querySelector('#scrShop [data-back]').click()`);

    // ------------------------------------------------------------ Mehrspieler: PC + Handy
    await A.js(`document.querySelector('#bMulti').click()`);
    check('Mehrspieler-Server gefunden', await A.warte(`!document.querySelector('#bCreate').disabled`, 10000));
    await A.js(`document.querySelector('#bCreate').click()`);
    check('Raum erstellt', await A.warte(`dino.screen === 'scrLobby' && dino.netz.room`, 8000));
    const link = await A.js('return dino.netz.inviteLink()');
    const B = await tab(cdp, 'Handy', { w: 412, h: 915, mobile: true }, { help: true, name: 'Ben', dino: 'brachio', owned: ['rex', 'brachio'] });
    await B.go(link);
    check('Einladungs-Link führt in den Raum', await B.warte(`window.__dinoReady && dino.screen === 'scrLobby'`, 30000), link);
    check('Host sieht beide Spieler', await A.warte('dino.netz.state.players.length === 2', 5000));
    await A.foto('Lobby');
    await B.foto('Lobby');
    await A.js(`document.querySelector('#bStart').click()`);
    check('Countdown bei beiden', await A.warte(`dino.phase === 'countdown'`, 5000) && await B.warte(`dino.phase === 'countdown'`, 5000));
    check('Rennen läuft bei beiden', await A.warte(`dino.phase === 'run'`, 9000) && await B.warte(`dino.phase === 'run'`, 9000));
    await sleep(1500);
    check('Gegner als Geist sichtbar', (await A.js('return dino.ghosts')) === 1 && (await B.js('return dino.ghosts')) === 1);
    await A.js(`dino.debug.power('meteor')`);
    check('Meteor kommt beim Gegner an', await B.warte('dino.meteorsIn > 0', 5000));
    await sleep(500);
    await B.foto('Rennen mit Meteor');
    await B.js('dino.debug.kill()');
    check('Ausgeschieden → zuschauen', await B.warte(`dino.phase === 'spect'`, 8000));
    await A.js('dino.debug.kill()');
    check('Ergebnis bei beiden', await A.warte(`dino.screen === 'scrResults'`, 10000) && await B.warte(`dino.screen === 'scrResults'`, 10000));
    const rA = await A.js(`return document.querySelector('#rReward').textContent`);
    const rB = await B.js(`return document.querySelector('#rReward').textContent`);
    check('Bonus-Münzen für die Plätze', /\+(150|75)/.test(rA) && /\+(150|75)/.test(rB) && rA !== rB, `${rA} / ${rB}`);
    await A.foto('Ergebnis');
    await B.foto('Ergebnis');
    await A.js(`document.querySelector('#bRAgain').click()`);
    check('zweites Rennen', await B.warte(`dino.phase === 'countdown' || dino.phase === 'run'`, 6000));
    await B.js('await dino.netz.leave()');
    check('Verlassen', await A.warte('dino.netz.state.players.length === 1', 5000));
    for (const t of [A, B]) check(`${t.name}: keine JavaScript-Fehler`, t.fehlerJs.length === 0, t.fehlerJs.slice(0, 3).join(' | '));
    await A.zu();
    await B.zu();
  } catch (e) {
    check('Ablauf', false, e.message);
  } finally {
    chrome.kill();
    server?.srv.kill();
    try { fs.rmSync(profil, { recursive: true, force: true }); } catch { /* Chrome räumt noch */ }
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  fs.writeFileSync(path.join(OUT, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Dino-Test</title>
<style>body{font:15px system-ui,sans-serif;margin:20px;background:#f4f1fa}figure{display:inline-block;margin:8px;vertical-align:top;background:#fff;padding:8px;border-radius:12px}img{display:block;max-height:420px;border-radius:8px}</style>
<h1>Dino-Sprint 3D – ${fehler ? fehler + ' Fehler' : 'alles OK'}</h1>
${bilder.map(b => `<figure><img src="${b.datei}" alt=""><figcaption>${esc(b.titel)}</figcaption></figure>`).join('\n')}`);
  console.log(`\n${fehler ? fehler + ' FEHLER' : 'Alles OK'} – Dino-Test → ${path.join(OUT, 'index.html')}`);
  process.exit(fehler ? 1 : 0);
}

main().catch(e => { console.error('FEHLER', e.message); process.exit(1); });
