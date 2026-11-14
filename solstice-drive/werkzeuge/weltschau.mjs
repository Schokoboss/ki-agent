// Weltschau: teleportiert an Orte der Insel und legt Bildschirmfotos ab (Sichtprüfung der Welt).
// Aufruf: npm run build && node werkzeuge/weltschau.mjs [name:x:z:gier ...]
import { starteServer, oeffneSpiel } from './browser.mjs';

const STANDARD = [
  'festival:153:250:3.14', 'ring:590:300:0', 'stadt:-2840:2000:1.57', 'hafen:-3250:2100:1.57', 'kueste:-1900:2700:1.2',
  'bruecke:-10:2440:3.3', 'duenen:1900:1500:0', 'wald:-1390:-1200:2.0', 'see:-1380:-420:3.14', 'tunnel:-100:-1500:1.57',
  'kessel:1450:-1480:1.0', 'sternwarte:2200:-1340:4.0', 'watt:2500:205:1.57',
];
// Format: name:x:z:gier[:wetter[:stunde[:jahreszeit]]]
const ziele = (process.argv.length > 2 ? process.argv.slice(2) : STANDARD).map((s) => { const [name, x, z, gier, wetter, stunde, jahreszeit] = s.split(':'); return { name, x: +x, z: +z, gier: +gier, wetter: wetter || 'sonne', stunde: stunde ? +stunde : 15.5, jahreszeit: jahreszeit || 'sommer' }; });
const server = await starteServer();
const spiel = await oeffneSpiel(server.url, { abfrage: '?diagnose' });
try {
  await spiel.seite.evaluate(() => document.getElementById('laden')?.remove());
  console.log('Ladezeit (ms):', await spiel.seite.evaluate(() => Math.round(window.__ladezeit)));
  for (const z of ziele) {
    await spiel.seite.evaluate((z) => { const sd = window.__sd; sd.setzeJahreszeit(z.jahreszeit); sd.setzeWetter(z.wetter, z.stunde); sd.teleportiere(z.x, z.z, z.gier); }, z);
    await spiel.bilder(40);
    const info = await spiel.seite.evaluate(() => { const r = window.__sd.grafik.renderer.info.render; return { aufrufe: r.calls, dreiecke: r.triangles }; });
    console.log(z.name, JSON.stringify(info), await spiel.foto(`welt-${z.name}`));
  }
  if (spiel.fehler.length) { console.error('Konsolenfehler:', spiel.fehler); process.exitCode = 1; }
} finally {
  await spiel.schliesse();
  server.stop();
}
process.exit(process.exitCode ?? 0);
