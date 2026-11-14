import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const CRC = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC[n] = c >>> 0;
}
function crc32(daten: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < daten.length; i++) c = CRC[(c ^ daten[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function block(typ: string, daten: Uint8Array): Uint8Array {
  const aus = new Uint8Array(12 + daten.length);
  const sicht = new DataView(aus.buffer);
  sicht.setUint32(0, daten.length);
  for (let i = 0; i < 4; i++) aus[4 + i] = typ.charCodeAt(i);
  aus.set(daten, 8);
  sicht.setUint32(8 + daten.length, crc32(aus.subarray(4, 8 + daten.length)));
  return aus;
}

/** Kodiert RGBA-Pixel als PNG (ohne Fremdbibliotheken). */
export function kodierePng(breite: number, hoehe: number, rgba: Uint8Array): Uint8Array {
  const roh = new Uint8Array((breite * 4 + 1) * hoehe);
  for (let y = 0; y < hoehe; y++) {
    roh[y * (breite * 4 + 1)] = 0;
    roh.set(rgba.subarray(y * breite * 4, (y + 1) * breite * 4), y * (breite * 4 + 1) + 1);
  }
  const kopf = new Uint8Array(13);
  const sicht = new DataView(kopf.buffer);
  sicht.setUint32(0, breite); sicht.setUint32(4, hoehe);
  kopf[8] = 8; kopf[9] = 6; kopf[10] = 0; kopf[11] = 0; kopf[12] = 0;
  const teile = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), block('IHDR', kopf), block('IDAT', deflateSync(roh, { level: 9 })), block('IEND', new Uint8Array(0))];
  const gesamt = new Uint8Array(teile.reduce((s, t) => s + t.length, 0));
  let o = 0;
  for (const t of teile) { gesamt.set(t, o); o += t.length; }
  return gesamt;
}

export function schreibePng(datei: string, breite: number, hoehe: number, rgba: Uint8Array): void {
  mkdirSync(path.dirname(datei), { recursive: true });
  writeFileSync(datei, kodierePng(breite, hoehe, rgba));
}
