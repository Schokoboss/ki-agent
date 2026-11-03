// Handy-Test: spielt die App in einem unsichtbaren Chrome auf mehreren Handy-Profilen durch und prüft jede Ansicht.
//
//   node werkzeuge/handytest.mjs                       → Handy-KI (Server: python werkzeuge/server.py, Port 5190)
//   node werkzeuge/handytest.mjs --app nova --url http://localhost:8799/   → Nova (mit werkzeuge/ui_testserver.py)
//   node werkzeuge/handytest.mjs --app seite --url file:///C:/.../START-HIER.html → eine einzelne Seite, ganz fotografiert
//
// Prüft je Ansicht: Seite breiter als der Bildschirm, Teile ragen über den Rand, Tippflächen zu klein (WCAG 2.5.8:
// mind. 24 px, empfohlen 40+), Schrift sehr klein, Dialog passt nicht, JavaScript-Fehler. Ergebnis: Bericht mit
// Bildschirmfotos in werkzeuge/handytest-ergebnis/index.html. Braucht nur Node 22 und Chrome – keine Pakete.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = (name, d) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : d; };
const APP = arg('app', 'handyki');
const URL_ = arg('url', APP === 'nova' ? 'http://localhost:8799/' : 'http://localhost:5190/');
const OUT = path.resolve(arg('out', path.join(path.dirname(fileURLToPath(import.meta.url)), 'handytest-ergebnis')));
const NUR = arg('geraet', '');  // z. B. --geraet "Galaxy S9"

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-G960F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const GERAETE = [
  { name: 'Kleines Android', w: 360, h: 640, dpr: 2, ua: ANDROID, ablauf: true },
  { name: 'Galaxy S9', w: 360, h: 740, dpr: 4, ua: ANDROID },
  { name: 'Pixel 8', w: 412, h: 915, dpr: 2.625, ua: ANDROID },
  { name: 'iPhone 15', w: 393, h: 852, dpr: 3, ua: IPHONE },
  { name: 'Pixel 8 · dunkel', w: 412, h: 915, dpr: 2.625, ua: ANDROID, dark: true, ablauf: true },
  { name: 'Tablet', w: 800, h: 1280, dpr: 2, ua: ANDROID.replace(' Mobile', '') },
].filter(g => !NUR || g.name === NUR);

/* ---------- Ablauf je App: Ansichten öffnen (js), warten (warte), Foto + Prüfung, aufräumen (nach) */
const zu = sel => `document.querySelector('${sel}')?.close()`;
const SZENEN = {
  handyki: [
    { name: 'Einführung', warte: `$('#intro').open`, nach: `$('#introGo').click()` },
    { name: 'Startseite', warte: `!$('#intro').open` },
    { name: 'Zum Startbildschirm', warte: `!$('#installCard').hidden`, dann: `$('#installCard').scrollIntoView({ block: 'center' })` },
    { name: 'Arbeitszeit', js: `$('#btnWork').click()`, nach: zu('#work') },
    ...[['allg', 'Allgemein'], ['modell', 'KI-Modell'], ['schutz', 'Datenschutz'], ['ueber', 'Über']].map(([t, n]) =>
      ({ name: `Einstellungen · ${n}`, js: `openSettings('${t}')`, warte: `!$('[data-panel="${t}"]').hidden`, nach: `els.settings.close()` })),
    { name: 'Assistent wählen', js: `openAssistantPicker()`, nach: zu('#pickAssistant') },
    { name: 'Chats', js: `openDrawer()`, nach: `closeDrawer()` },
    { name: 'Wissenskarte', js: `newChat('erbrecht'); els.input.value = 'Wie hoch ist der Pflichtteil?'; send()`, warte: `document.querySelector('.k-card')` },
    { name: 'Auftrag läuft (bis fertig)', ablauf: true, warte: `document.querySelector('.wc-plan:not([hidden])')`, js: `
      const call = (n, a) => '<tool_call>' + JSON.stringify({ name: n, arguments: a }) + '</tool_call>';
      const r = [call('notes', { text: '- [ ] Kartons besorgen\\n- [ ] Helfer fragen\\n- [ ] Ummelden' }), call('calculate', { expression: '12*4' }),
        call('notes', { text: '- [x] Kartons besorgen\\n- [x] Helfer fragen\\n- [ ] Ummelden' }), call('save_file', { name: 'umzug.txt', content: 'Plan' }),
        call('notes', { text: '- [x] Kartons besorgen\\n- [x] Helfer fragen\\n- [x] Ummelden' }), 'FERTIG Der Umzugsplan steht, alles in **umzug.txt**.'];
      let n = 0;
      LocalAI._setEngine({ chat: { completions: { create: async () => { await new Promise(x => setTimeout(x, 900));
        const t = r[n++] ?? 'FERTIG ok'; return (async function* () { yield { choices: [{ delta: { content: t } }] }; })(); } } },
        interruptGenerate() {}, unload: async () => {} }, state.settings.model);
      state.modelReady = true; newChat('allgemein'); setWork(-1); els.input.value = 'Plane meinen Umzug'; send();` },
    { name: 'Auftrag pausiert', ablauf: true, js: `document.querySelector('.wc-ctrl [data-a=pause]').click()`, warte: `document.querySelector('.work-card.paused')` },
    { name: 'Abschlussbericht', ablauf: true, js: `document.querySelector('.wc-ctrl [data-a=pause]').click()`, warte: `document.querySelector('.report-card')`,
      dann: `document.querySelector('.report-card').scrollIntoView({ block: 'end' })`, zeit: 30000 },
    { name: 'Bericht ansehen', ablauf: true, js: `document.querySelector('.rc-open').click()`, warte: `$('#viewer').open`, nach: zu('#viewer') },
    { name: 'Unterbrochener Auftrag', js: `
      const c = { id: 'c_handytest', title: 'Steuerunterlagen sortieren', assistant: 'allgemein', created: Date.now() / 1000, _taskIndex: 0,
        messages: [{ role: 'user', content: 'Sortier meine Steuerunterlagen', _display: 'Sortier meine Steuerunterlagen', _work: -1 }],
        _work_state: { started: Date.now() - 6e5, deadline: Date.now() + 6e8, minutes: 0, endless: true, pausedTotal: 0, files: [],
          toolCounts: {}, restarts: 0, steps: 7, saved: Date.now() - 36e5 } };
      saveChat(c); offerResume();`, warte: `document.querySelector('.resume-card')` },
  ],
  seite: [{ name: 'Ganze Seite', warte: `document.readyState === 'complete'` }],
  nova: [
    { name: 'Startseite', warte: `state.online` },
    { name: 'Arbeitszeit', js: `$('#btnWork').click()`, nach: zu('#work') },
    ...[['allg', 'Allgemein', '#laptopModels .model-row'], ['sicher', 'Sicherheit', '#permList .perm-row'], ['integ', 'Integrationen', '.mcp-card'],
      ['auto', 'Automatik', '#routineList > *'], ['daten', 'Daten', '#memoryList > *']].map(([t, n, w]) =>
      ({ name: `Einstellungen · ${n}`, js: `openSettings('${t}')`, warte: `document.querySelector('${w}')`, nach: `els.settings.close()` })),
    { name: 'Chats', js: `openDrawer()`, nach: `closeDrawer()` },
    { name: 'Freigabe', ablauf: true, warte: `document.querySelector('.approval')`, zeit: 30000,
      js: `newChat(); setWork(-1); els.input.value = 'Erstell ein Angebot für ein Café'; send()` },
    { name: 'Auftrag läuft (bis fertig)', ablauf: true, js: `document.querySelector('.approval .allow').click()`,
      warte: `document.querySelector('.wc-plan:not([hidden])') && !document.querySelector('.approval')`, zeit: 30000 },
    { name: 'Auftrag pausiert', ablauf: true, js: `document.querySelector('.wc-ctrl [data-a=pause]').click()`, warte: `document.querySelector('.work-card.paused')` },
    { name: 'Abschlussbericht', ablauf: true, zeit: 60000, js: `document.querySelector('.wc-ctrl [data-a=pause]').click();
      window._ok = setInterval(() => document.querySelector('.approval .allow')?.click(), 500)`,
      warte: `document.querySelector('.report-card')`, dann: `clearInterval(window._ok); document.querySelector('.report-card').scrollIntoView({ block: 'end' })` },
    { name: 'Bericht ansehen', ablauf: true, js: `document.querySelector('.rc-open').click()`, warte: `document.querySelector('#viewerBody h4')`, nach: zu('#viewer') },
  ],
};

/* ---------- Prüfungen, laufen in der Seite */
const PRUEFEN = `(() => {
  const W = innerWidth, H = innerHeight, out = [];
  const add = (art, was, detail) => out.push({ art, was, detail });
  const docW = document.documentElement.scrollWidth;
  if (docW > W + 1) add('fehler', 'Seite breiter als der Bildschirm', docW + ' px bei ' + W + ' px');
  const sichtbar = e => { const r = e.getBoundingClientRect(), s = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && +s.opacity > 0.05 && r.right > 0 && r.left < W; };
  const name = e => (e.getAttribute('aria-label') || e.innerText || e.placeholder || e.id || e.className || e.tagName)
    .toString().trim().replace(/\\s+/g, ' ').slice(0, 42);
  const modal = [...document.querySelectorAll('dialog[open]')].pop();
  const wurzel = modal || document.body;
  const scroller = e => { for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
    const s = getComputedStyle(p); if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) return true; } return false; };
  for (const e of wurzel.querySelectorAll('*')) {
    if (!sichtbar(e) || e.closest('svg')) continue;
    const r = e.getBoundingClientRect();
    if ((r.right > W + 1 || r.left < -1) && !scroller(e)) add('fehler', 'Ragt über den Rand', name(e) + ' (' + Math.round(r.left) + '…' + Math.round(r.right) + ' px)');
  }
  for (const e of wurzel.querySelectorAll('button, a[href], input:not([type=checkbox]):not([type=file]), select, textarea, summary, label.switch')) {
    if (!sichtbar(e) || e.closest('[hidden]') || e.disabled) continue;
    const r = e.getBoundingClientRect(), m = Math.min(r.width, r.height);
    const groesse = name(e) + ' ' + Math.round(r.width) + '×' + Math.round(r.height);
    if (m < 24) add('fehler', 'Tippfläche zu klein (unter 24 px)', groesse);
    else if (m < 40 && !e.matches('input, textarea, select')) add('hinweis', 'Tippfläche knapp (unter 40 px)', groesse);
  }
  for (const e of wurzel.querySelectorAll('*')) {
    if (!sichtbar(e) || ![...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const fs = parseFloat(getComputedStyle(e).fontSize);
    if (fs < 11.5) add('hinweis', 'Schrift sehr klein', name(e) + ' (' + fs + ' px)');
  }
  const lineal = document.createElement('canvas').getContext('2d');
  for (const e of wurzel.querySelectorAll('input[placeholder], textarea[placeholder]')) {
    if (!sichtbar(e) || e.value || !e.placeholder) continue;
    const s = getComputedStyle(e);
    lineal.font = s.fontStyle + ' ' + s.fontWeight + ' ' + s.fontSize + ' ' + s.fontFamily;
    const frei = e.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
    if (lineal.measureText(e.placeholder).width > frei + 1) add('hinweis', 'Platzhalter abgeschnitten', '„' + e.placeholder + '“ in ' + Math.round(frei) + ' px');
  }
  if (modal) { const r = modal.getBoundingClientRect();
    if (r.width > W + 1 || r.height > H + 1) add('fehler', 'Dialog größer als der Bildschirm', Math.round(r.width) + '×' + Math.round(r.height)); }
  const gesehen = new Set();
  return out.filter(x => { const k = x.was + x.detail; if (gesehen.has(k)) return false; gesehen.add(k); return true; });
})()`;

/* ---------- Mini-CDP-Client (Chrome DevTools Protocol über WebSocket, in Node 22 eingebaut) */
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
  for (const p of ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
    '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']) if (fs.existsSync(p)) return p;
  throw new Error('Chrome nicht gefunden.');
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'handytest-'));
  const chrome = spawn(chromePfad(), ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profil}`, '--no-first-run',
    '--no-default-browser-check', '--hide-scrollbars', '--mute-audio', 'about:blank']);
  const wsUrl = await new Promise((ok, fail) => {
    let buf = '';
    chrome.stderr.on('data', d => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) ok(m[1]); });
    setTimeout(() => fail(new Error('Chrome startet nicht.')), 15000);
  });
  const cdp = new CDP(wsUrl);
  await cdp.open();
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const ergebnis = [];
  if (!SZENEN[APP]) throw new Error(`Unbekannte App „${APP}“ – handyki, nova oder seite.`);
  console.log(`Handy-Test ${APP} → ${URL_}  (${GERAETE.length} Geräte)`);
  for (const g of GERAETE) {
    const { browserContextId } = await cdp.send('Target.createBrowserContext');  // eigener Speicher je Gerät = Erststart
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId: s } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const fehlerJs = [];
    cdp.on(d => {
      if (d.sessionId !== s) return;
      if (d.method === 'Runtime.exceptionThrown') fehlerJs.push(d.params.exceptionDetails.exception?.description?.split('\n')[0] || d.params.exceptionDetails.text);
      if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') fehlerJs.push(d.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 200));
      if (d.method === 'Page.javascriptDialogOpening') cdp.send('Page.handleJavaScriptDialog', { accept: true }, s);  // confirm() bestätigen
    });
    for (const m of ['Page.enable', 'Runtime.enable']) await cdp.send(m, {}, s);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: g.w, height: g.h, deviceScaleFactor: g.dpr, mobile: true }, s);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, s);
    await cdp.send('Emulation.setUserAgentOverride', { userAgent: g.ua }, s);
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: g.dark ? 'dark' : 'light' }] }, s);
    const ziel = APP === 'nova' ? URL_.replace(/#.*/, '') + '#t=uitest-token-123' : URL_;
    await cdp.send('Page.navigate', { url: ziel }, s);
    const js = async (code, warten = true) => {
      const r = await cdp.send('Runtime.evaluate', { expression: `(async () => { ${code} })()`, awaitPromise: warten, returnByValue: true }, s);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split('\n')[0] || r.exceptionDetails.text);
      return r.result.value;
    };
    const warte = async (bed, ms = 8000) => {
      const t = Date.now();
      while (Date.now() - t < ms) { try { if (await js(`return !!(${bed})`)) return true; } catch { /* Seite lädt noch */ } await sleep(200); }
      return false;
    };
    await warte('document.readyState === "complete"', 15000);
    await sleep(1200);
    const geraet = { ...g, szenen: [] };
    const dir = g.name.replace(/[^\w]+/g, '-');
    fs.mkdirSync(path.join(OUT, dir), { recursive: true });
    for (const [i, sz] of SZENEN[APP].entries()) {
      if (sz.ablauf && !g.ablauf) continue;
      const eintrag = { name: sz.name, probleme: [], js: [] };
      const vorher = fehlerJs.length;
      try {
        if (sz.js) await js(sz.js, false);
        if (sz.warte && !(await warte(sz.warte, sz.zeit || 8000))) eintrag.probleme.push({ art: 'fehler', was: 'Ansicht erscheint nicht', detail: sz.warte.slice(0, 80) });
        if (sz.dann) await js(sz.dann);
        await sleep(450);  // Animationen auslaufen lassen
        eintrag.probleme.push(...await js(`return ${PRUEFEN}`));
        const hoehe = APP === 'seite' ? Math.min(8000, await js('return document.documentElement.scrollHeight')) : g.h;  // einzelne Seite: ganz
        const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 78, captureBeyondViewport: APP === 'seite',
          clip: { x: 0, y: 0, width: g.w, height: hoehe, scale: 1.5 / g.dpr } }, s);
        eintrag.bild = `${dir}/${String(i).padStart(2, '0')}.jpg`;
        fs.writeFileSync(path.join(OUT, eintrag.bild), Buffer.from(shot.data, 'base64'));
        if (sz.nach) await js(sz.nach);
        await sleep(250);
      } catch (e) { eintrag.probleme.push({ art: 'fehler', was: 'Ablauf-Fehler', detail: e.message.slice(0, 160) }); }
      eintrag.js = fehlerJs.slice(vorher);
      eintrag.js.forEach(f => eintrag.probleme.push({ art: 'fehler', was: 'JavaScript-Fehler', detail: f }));
      geraet.szenen.push(eintrag);
      const f = eintrag.probleme.filter(p => p.art === 'fehler').length, h = eintrag.probleme.length - f;
      console.log(`  ${g.name.padEnd(17)} ${sz.name.padEnd(28)} ${f ? f + ' Fehler' : 'ok'}${h ? ` · ${h} Hinweise` : ''}`);
    }
    ergebnis.push(geraet);
    await cdp.send('Target.closeTarget', { targetId });
    await cdp.send('Target.disposeBrowserContext', { browserContextId });
  }
  chrome.kill();
  fs.writeFileSync(path.join(OUT, 'index.html'), bericht(ergebnis));
  fs.writeFileSync(path.join(OUT, 'ergebnis.json'), JSON.stringify(ergebnis, null, 1));
  const alle = ergebnis.flatMap(g => g.szenen.flatMap(s => s.probleme));
  const fehler = alle.filter(p => p.art === 'fehler').length;
  console.log(`\n${ergebnis.reduce((n, g) => n + g.szenen.length, 0)} Ansichten · ${fehler} Fehler · ${alle.length - fehler} Hinweise → ${path.join(OUT, 'index.html')}`);
  try { fs.rmSync(profil, { recursive: true, force: true }); } catch { /* Chrome räumt noch */ }
  process.exit(fehler ? 1 : 0);
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function bericht(ergebnis) {
  const datum = new Date().toLocaleString('de-DE');
  const zeile = g => { const p = g.szenen.flatMap(s => s.probleme), f = p.filter(x => x.art === 'fehler').length;
    return `<tr><td>${esc(g.name)}</td><td>${g.w}×${g.h} @${g.dpr}x${g.dark ? ' · dunkel' : ''}</td><td>${g.szenen.length}</td>
      <td class="${f ? 'bad' : 'good'}">${f}</td><td>${p.length - f}</td></tr>`; };
  const karte = s => `<figure><img src="${esc(s.bild || '')}" alt="${esc(s.name)}" loading="lazy"><figcaption><b>${esc(s.name)}</b>
    ${s.probleme.length ? `<ul>${s.probleme.map(p => `<li class="${p.art}">${esc(p.was)}: ${esc(p.detail)}</li>`).join('')}</ul>` : '<span class="good">✓ keine Auffälligkeiten</span>'}</figcaption></figure>`;
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Handy-Test ${esc(APP)}</title><style>
:root{--bg:#f5f6fa;--fg:#13151b;--mut:#646b7b;--card:#fff;--bd:#dde1ea;--ok:#1f9d68;--bad:#d93b45;--warn:#a86d00}
@media (prefers-color-scheme:dark){:root{--bg:#0e0f13;--fg:#eceef4;--mut:#8f96a6;--card:#16181e;--bd:#262a33;--ok:#3ccf8e;--bad:#ff5c66;--warn:#f5b13d}}
body{margin:0;padding:24px 16px;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}main{max-width:1200px;margin:auto}
h1{margin:0 0 4px}p.mut{color:var(--mut);margin:0 0 18px}table{border-collapse:collapse;margin-bottom:28px;background:var(--card);border-radius:12px;overflow:hidden}
td,th{padding:8px 12px;border-bottom:1px solid var(--bd);text-align:left}.good{color:var(--ok)}.bad{color:var(--bad);font-weight:700}
section{margin-bottom:34px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}
figure{margin:0;background:var(--card);border:1px solid var(--bd);border-radius:14px;overflow:hidden}figure img{width:100%;display:block;background:#888}
figcaption{padding:8px 10px;font-size:13px}figcaption ul{margin:4px 0 0;padding-left:16px}li.fehler{color:var(--bad)}li.hinweis{color:var(--warn)}
</style></head><body><main><h1>Handy-Test: ${esc(APP === 'nova' ? 'Nova' : 'Handy-KI')}</h1><p class="mut">${esc(datum)} · ${esc(URL_)} · unsichtbares Chrome mit Handy-Profilen</p>
<table><tr><th>Gerät</th><th>Bildschirm</th><th>Ansichten</th><th>Fehler</th><th>Hinweise</th></tr>${ergebnis.map(zeile).join('')}</table>
${ergebnis.map(g => `<section><h2>${esc(g.name)}</h2><div class="grid">${g.szenen.map(karte).join('')}</div></section>`).join('')}
</main></body></html>`;
}

main().catch(e => { console.error('Handy-Test abgebrochen:', e.message); process.exit(2); });
