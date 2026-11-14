// Fahrtest: fährt im Headless-Browser per Skript über die Insel und legt Bildschirmfotos ab.
// Aufruf: npm run build && npm run fahrtest
import { starteServer, oeffneSpiel } from './browser.mjs';

const server = await starteServer();
const spiel = await oeffneSpiel(server.url, { abfrage: '?diagnose' });
const schritte = [
  ['01-start', { gas: 0, bremse: 0, lenkung: 0, handbremse: 0 }, 30],
  ['02-vollgas', { gas: 1, bremse: 0, lenkung: 0, handbremse: 0 }, 240],
  ['03-drift', { gas: 1, bremse: 0, lenkung: -1, handbremse: 0 }, 70],
  ['04-gegenlenken', { gas: 1, bremse: 0, lenkung: 0.6, handbremse: 0 }, 50],
  ['05-wiese', { gas: 1, bremse: 0, lenkung: 0.25, handbremse: 0 }, 200],
  ['06-bremsen', { gas: 0, bremse: 1, lenkung: 0, handbremse: 0 }, 160],
];
try {
  await spiel.seite.evaluate(() => document.getElementById('laden')?.remove());
  for (const [name, eingabe, bilder] of schritte) {
    await spiel.eingabe(eingabe);
    await spiel.bilder(bilder);
    const z = await spiel.zustand();
    console.log(name, `x=${z.x.toFixed(0)} y=${z.y.toFixed(1)} z=${z.z.toFixed(0)} ${z.kmh.toFixed(0)} km/h Gang ${z.gang} Räder ${z.raeder}`);
    await spiel.foto(name);
  }
  if (spiel.fehler.length) { console.error('Konsolenfehler:', spiel.fehler); process.exitCode = 1; }
} finally {
  await spiel.schliesse();
  server.stop();
}
process.exit(process.exitCode ?? 0);
