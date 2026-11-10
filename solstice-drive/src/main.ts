import './ui/stil.css';
import { Spiel } from './spiel';

const canvas = document.getElementById('buehne') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;
const laden = document.getElementById('laden') as HTMLElement;

function start(): void {
  const spiel = new Spiel(canvas, ui);
  // Für Werkzeuge (Fahrtest, Bildraten-Messung) und die Fehlersuche
  (window as unknown as { __sd: Spiel }).__sd = spiel;
  spiel.schleife.start();
  laden.style.opacity = '0';
  setTimeout(() => laden.remove(), 600);
}

try {
  start();
} catch (fehler) {
  const text = document.getElementById('ladetext');
  if (text) text.textContent = `Fehler beim Start: ${(fehler as Error).message}`;
  throw fehler;
}
