// Fahrtest: fährt im Headless-Browser per Skript und legt Bildschirmfotos ab.
// Aufruf: npm run build && npm run fahrtest
import { starteServer, oeffneSpiel } from './browser.mjs';

const server = await starteServer();
const spiel = await oeffneSpiel(server.url);
try {
  await spiel.seite.evaluate(() => document.getElementById('laden')?.remove());
  await spiel.bilder(30);
  console.log('Start:', await spiel.zustand());
  await spiel.foto('01-start');
  await spiel.eingabe({ gas: 1, bremse: 0, lenkung: 0, handbremse: 0 });
  await spiel.bilder(180);
  console.log('3 s Vollgas:', await spiel.zustand());
  await spiel.foto('02-vollgas');
  await spiel.eingabe({ gas: 1, bremse: 0, lenkung: -1, handbremse: 0 });
  await spiel.bilder(90);
  console.log('Linkskurve:', await spiel.zustand());
  await spiel.foto('03-kurve');
  await spiel.eingabe({ gas: 0, bremse: 1, lenkung: 0, handbremse: 0 });
  await spiel.bilder(150);
  console.log('Gebremst:', await spiel.zustand());
  if (spiel.fehler.length) { console.error('Konsolenfehler:', spiel.fehler); process.exitCode = 1; }
} finally {
  await spiel.schliesse();
  server.stop();
}
process.exit(process.exitCode ?? 0);
