/** Kleine DOM-Helfer für die Oberfläche. */

export type Kinder = (Node | string | null | undefined | false)[];

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | ((e: Event) => void) | undefined> = {},
  ...kinder: Kinder
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'klasse') e.className = String(v);
    else if (k === 'text') e.textContent = String(v);
    else if (k === 'html') e.innerHTML = String(v);
    else if (k.startsWith('bei') && typeof v === 'function') e.addEventListener(k.slice(3).toLowerCase(), v as EventListener);
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, String(v));
  }
  for (const k of kinder) {
    if (k === null || k === undefined || k === false) continue;
    e.append(k);
  }
  return e;
}

export function leere(e: Element): void {
  while (e.firstChild) e.removeChild(e.firstChild);
}

/** Inline-SVG-Symbol aus einem Pfad (24er-Raster). */
export function symbol(pfad: string, groesse = 24): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(groesse));
  svg.setAttribute('height', String(groesse));
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', pfad);
  p.setAttribute('fill', 'currentColor');
  svg.append(p);
  return svg;
}

export const SYMBOLE = {
  pause: 'M6 4h4v16H6zM14 4h4v16h-4z',
  kamera: 'M4 7h3l2-2h6l2 2h3v12H4zM12 9.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7z',
  zurueckspulen: 'M11 6v12L3 12zM21 6v12l-8-6z',
  zuruecksetzen: 'M12 5V2L7 6l5 4V7a5 5 0 11-5 5H5a7 7 0 107-7z',
  links: 'M15 4l-9 8 9 8z',
  rechts: 'M9 4l9 8-9 8z',
  karte: 'M9 4l6 2 5-2v14l-5 2-6-2-5 2V6zM9 6v12M15 6v12',
  radio: 'M4 9h16v11H4zM7 9l10-5M8 14.5a2.5 2.5 0 105 0 2.5 2.5 0 00-5 0zM15 13h3v1h-3zM15 16h3v1h-3z',
  hupe: 'M3 10v4h4l6 5V5l-6 5zM16 8a5 5 0 010 8M18.5 5.5a9 9 0 010 13',
  duell: 'M4 20L14 6l4-2-2 4L6 20zM20 20L10 6 6 4l2 4 10 12z',
  vollbild: 'M4 9V4h5v2H6v3zM15 4h5v5h-2V6h-3zM4 15h2v3h3v2H4zM18 15h2v5h-5v-2h3z',
  haken: 'M5 12l5 5 9-11-2-1.5-7.2 9L6.5 10.5z',
  schloss: 'M7 10V7a5 5 0 0110 0v3h1v10H6V10zm2 0h6V7a3 3 0 00-6 0z',
  stern: 'M12 3l2.6 5.8 6.4.7-4.8 4.3 1.4 6.2-5.6-3.3-5.6 3.3 1.4-6.2L3 9.5l6.4-.7z',
  schliessen: 'M6 4.6L4.6 6l6 6-6 6L6 19.4l6-6 6 6 1.4-1.4-6-6 6-6L18 4.6l-6 6z',
  foto: 'M4 7h3l2-2h6l2 2h3v12H4zM12 9.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7z',
  handbremse: 'M12 3a9 9 0 100 18 9 9 0 000-18zm0 2a7 7 0 110 14 7 7 0 010-14zm-1 3v5h2V8zm0 6.5v2h2v-2z',
} as const;
