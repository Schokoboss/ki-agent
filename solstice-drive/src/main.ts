import './ui/stil.css';
import { Spiel } from './spiel';
import { erzeugeWeltkarteAsync } from './welt/weltkarte';

const canvas = document.getElementById('buehne') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;
const laden = document.getElementById('laden') as HTMLElement;
const balken = document.getElementById('ladebalken') as HTMLElement;
const text = document.getElementById('ladetext') as HTMLElement;

async function start(): Promise<void> {
  const parameter = new URLSearchParams(location.search);
  const t0 = performance.now();
  const test = parameter.get('welt') === 'test';
  const karte = test ? null : await erzeugeWeltkarteAsync((anteil) => { balken.style.width = `${Math.round(anteil * 90)}%`; });
  const spiel = new Spiel(canvas, ui, karte);
  spiel.diagnose = parameter.has('diagnose');
  balken.style.width = '100%';
  // Für Werkzeuge (Fahrtest, Bildraten-Messung) und die Fehlersuche
  const w = window as unknown as { __sd: Spiel; __ladezeit: number };
  w.__ladezeit = performance.now() - t0;
  w.__sd = spiel;
  spiel.schleife.start();
  laden.style.opacity = '0';
  setTimeout(() => laden.remove(), 600);
}

start().catch((fehler: Error) => {
  text.textContent = `Fehler beim Start: ${fehler.message}`;
  console.error(fehler);
});
