// Gemeinsame Helfer für Browser-Werkzeuge (Fahrtest, Bildraten-Messung, Bildschirmfotos).
// Startet einen Vite-Server und einen Headless-Chromium mit Pixel-Querformat.
import { createRequire } from 'node:module';
import { execSync, spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const AUSGABE = path.join(WURZEL, 'werkzeuge', 'ausgabe');

/** Google Pixel 10a im Querformat (CSS-Pixel). Gerätepixel: 2424 × 1080. */
export const PIXEL_QUER = { width: 915, height: 412 };

export async function ladePlaywright() {
  try {
    return await import('playwright');
  } catch {
    const global = execSync('npm root -g').toString().trim();
    const require = createRequire(path.join(global, 'x.js'));
    return require('playwright');
  }
}

/** Startet `vite preview` (gebaute Fassung) oder `vite` (Entwicklung) und wartet, bis der Server antwortet. */
export async function starteServer({ port = 4173, gebaut = true } = {}) {
  const vite = path.join(WURZEL, 'node_modules', 'vite', 'bin', 'vite.js');
  const args = gebaut ? [vite, 'preview', '--port', String(port), '--strictPort'] : [vite, '--port', String(port), '--strictPort'];
  const proc = spawn(process.execPath, args, { cwd: WURZEL, stdio: 'ignore' });
  const url = `http://localhost:${port}/`;
  const start = Date.now();
  for (;;) {
    try {
      const r = await fetch(url);
      if (r.ok) break;
    } catch { /* noch nicht bereit */ }
    if (Date.now() - start > 30000) { proc.kill(); throw new Error('Server startet nicht'); }
    await new Promise((r) => setTimeout(r, 200));
  }
  return { url, stop: () => proc.kill() };
}

/** Öffnet das Spiel. Liefert Seite und Hilfsfunktionen. */
export async function oeffneSpiel(url, { viewport = PIXEL_QUER, touch = true, dpr = 1, abfrage = '' } = {}) {
  const { chromium } = await ladePlaywright();
  const browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--mute-audio'],
  });
  const kontext = await browser.newContext({ viewport, deviceScaleFactor: dpr, hasTouch: touch, isMobile: touch });
  const seite = await kontext.newPage();
  const fehler = [];
  seite.on('console', (m) => { if (m.type() === 'error') fehler.push(m.text()); });
  seite.on('pageerror', (e) => fehler.push(String(e)));
  await seite.goto(url + abfrage);
  await seite.waitForFunction(() => window.__sd && window.__sd.bereit !== false, null, { timeout: 60000 });
  mkdirSync(AUSGABE, { recursive: true });
  // Schleife von Hand takten: deterministisch und unabhängig von der Software-Grafik
  await seite.evaluate(() => { window.__sd.schleife.stop(); window.__t = performance.now(); });
  const api = {
    seite, browser, fehler,
    /** Rechnet n Bilder mit 60 Hz. */
    bilder: (n, hz = 60, alleZeichnen = false) => seite.evaluate(([n, hz, alle]) => {
      const g = window.__sd.grafik;
      for (let i = 0; i < n; i++) {
        // nur das letzte Bild wirklich zeichnen – die Software-Grafik wäre sonst der Engpass
        g.ueberspringe = !alle && i < n - 1;
        window.__t += 1000 / hz; window.__sd.schleife.bild(window.__t);
      }
      g.ueberspringe = false;
      const gl = g.renderer.getContext();
      gl.finish();
    }, [n, hz, alleZeichnen]),
    /** Setzt die Skripteingabe (null = Spielereingabe). */
    eingabe: (e) => seite.evaluate((e) => { window.__sd.skript = e; }, e),
    foto: async (name) => {
      const datei = path.join(AUSGABE, name.endsWith('.png') ? name : `${name}.png`);
      await seite.screenshot({ path: datei, timeout: 120000 });
      return datei;
    },
    zustand: () => seite.evaluate(() => {
      const f = window.__sd.spieler;
      return { x: f.pos.x, y: f.pos.y, z: f.pos.z, kmh: f.tempo * 3.6, gang: f.gang, raeder: f.bodenRaeder, obenY: f.oben.y };
    }),
    schliesse: () => browser.close(),
  };
  return api;
}
