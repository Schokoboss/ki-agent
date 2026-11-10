// Autoschau: rendert jedes Auto aus mehreren Blickwinkeln (Kontrolle der prozeduralen Karosserien).
// Aufruf: npm run build && node werkzeuge/autoschau.mjs [auto-id ...]
import { starteServer, oeffneSpiel } from './browser.mjs';

const server = await starteServer();
const spiel = await oeffneSpiel(server.url, { viewport: { width: 1200, height: 520 } });
try {
  await spiel.seite.evaluate(() => { document.getElementById('laden')?.remove(); document.getElementById('ui').style.display = 'none'; });
  const ids = process.argv.length > 2 ? process.argv.slice(2) : await spiel.seite.evaluate(() => window.__sd.autoIds());
  for (const id of ids) {
    await spiel.seite.evaluate((id) => window.__sd.setzeAuto(id), id);
    await spiel.bilder(20);
    // vier Ansichten nebeneinander über Viewports
    await spiel.seite.evaluate(() => {
      const sd = window.__sd, g = sd.grafik, r = g.renderer, k = g.kamera;
      const p = sd.ansicht.gruppe.position;
      const sichten = [[-0.75, 0.32, 6.2], [0.6, 0.25, 6.2], [2.5, 0.3, 6.4], [0.0, 1.2, 7.5]];
      const b = g.pixelBreite, h = g.pixelHoehe;
      r.setScissorTest(true);
      r.autoClear = false;
      k.fov = 38; k.aspect = (b / 2) / (h / 2); k.updateProjectionMatrix();
      sichten.forEach(([azimut, hoch, abstand], i) => {
        const x = (i % 2) * (b / 2), y = Math.floor(i / 2) * (h / 2);
        r.setViewport(x, y, b / 2, h / 2); r.setScissor(x, y, b / 2, h / 2);
        r.clear();
        k.position.set(p.x + Math.sin(azimut) * Math.cos(hoch) * abstand, p.y + Math.sin(hoch) * abstand, p.z + Math.cos(azimut) * Math.cos(hoch) * abstand);
        k.up.set(0, 1, 0);
        k.lookAt(p.x, p.y, p.z);
        r.render(g.szene, k);
      });
      r.setScissorTest(false); r.autoClear = true;
      r.setViewport(0, 0, b, h);
    });
    console.log(await spiel.foto(`auto-${id}`));
  }
  if (spiel.fehler.length) console.error(spiel.fehler);
} finally {
  await spiel.schliesse();
  server.stop();
}
process.exit(0);
