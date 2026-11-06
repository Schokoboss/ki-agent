// Baut das ganze Spiel als EINE HTML-Datei (Code, three.js und alle Modelle eingebettet).
// Die Datei läuft ohne Server: aufs Handy laden und in Chrome öffnen.
// Aufruf (im Ordner app/spiele/nova-drive):  node werkstatt/handy-datei.mjs [ziel.html]
// Braucht esbuild:  npm i -g esbuild   (oder NODE_PATH auf ein node_modules mit esbuild setzen)
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// --hd: HD-Paket (2K-Texturen aus models/tex-hd) mit einbetten → NovaDrive-HD.html (~30 MB)
const HD = process.argv.includes('--hd');
const OUT = process.argv.slice(2).find(a => !a.startsWith('--')) || join(ROOT, HD ? 'NovaDrive-HD.html' : 'NovaDrive-Handy.html');
const require = createRequire(import.meta.url);
let esbuild;
try { esbuild = require('esbuild'); } catch { esbuild = require(require.resolve('esbuild', { paths: [process.cwd(), ...(process.env.NODE_PATH || '').split(':')] })); }

// 1) Code bündeln (das „three“ des GLTF-Laders zeigt auf dieselbe Bibliothek)
const res = await esbuild.build({
  entryPoints: [join(ROOT, 'js/main.js')], bundle: true, format: 'esm', minify: true, write: false,
  alias: { three: join(ROOT, 'lib/three.module.min.js') }, legalComments: 'none', target: 'es2020',
});
const code = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

// 2) Modelle als data-URLs
const models = {};
const walk = d => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (f !== 'tex-hd' || HD) walk(p); } else if (/\.(glb|webp)$/.test(f)) models[relative(ROOT, p).split('\\').join('/')] = `data:${f.endsWith('.webp') ? 'image/webp' : 'model/gltf-binary'};base64,` + readFileSync(p).toString('base64'); } };
walk(join(ROOT, 'models'));

// 3) HTML zusammensetzen
let html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const css = readFileSync(join(ROOT, 'style.css'), 'utf8');
const icon = 'data:image/svg+xml;base64,' + readFileSync(join(ROOT, 'icon.svg')).toString('base64');
html = html
  .replace(/<link rel="manifest"[^>]*>\n?/, '')
  .replace(/<link rel="apple-touch-icon"[^>]*>\n?/, '')
  .replace(/<link rel="icon"[^>]*>/, `<link rel="icon" href="${icon}" type="image/svg+xml">`)
  .replace(/<link rel="stylesheet" href="style.css">/, () => `<style>${css}</style>`)
  .replace(/<script type="importmap">[\s\S]*?<\/script>\n?/, '')
  .replace(/<script type="module" src="js\/main.js"><\/script>/, () =>
    `<script>window.__NOVA_MODELS=${JSON.stringify(models)};</script>\n<script type="module">${code}</script>`);
writeFileSync(OUT, html);
console.log(`${OUT}: ${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB, ${Object.keys(models).length} Modelle`);
