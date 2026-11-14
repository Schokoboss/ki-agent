import { rechteckUeberlappung, stossFest } from '../physik/kollision';
import type { Physikwelt, Teilnehmer, WeltKollision } from '../physik/physikwelt';
import { KACHEL, KACHELN, WELT_HALB } from './daten/regionen';
import { OBJEKT_TYPEN, type Objektverwaltung } from './objekte';
import { FLAG_NORMAL, FLAG_TUNNEL, TUNNEL_HOEHE } from './strassennetz';
import type { Weltkarte } from './weltkarte';

/**
 * Kollision eines Autos mit der Welt: Bäume/Felsen (fest), Requisiten (zerstörbar),
 * Gebäude (Hindernisraster), Brückengeländer und Tunnelwände.
 */
export function erzeugeWeltKollision(karte: Weltkarte, objekte: Objektverwaltung): WeltKollision {
  const netz = karte.netz;
  return (t: Teilnehmer, welt: Physikwelt): void => {
    const f = t.f;
    const w = f.w;
    const fl = Math.hypot(f.vorn.x, f.vorn.z);
    if (fl < 0.3) return;
    const fx = f.vorn.x / fl, fz = f.vorn.z / fl;
    const lx = fz, lz = -fx; // links
    const hl = w.laenge / 2, hb = w.breite / 2;
    const unten = f.pos.y - w.schwerpunktHoehe + w.bodenfreiheit;
    const py = f.pos.y - 0.15;

    // ---- Kleinobjekte in den Kacheln rund ums Auto ----
    const reich = hl + 3;
    const k0x = Math.max(0, Math.floor((f.pos.x - reich + WELT_HALB) / KACHEL)), k1x = Math.min(KACHELN - 1, Math.floor((f.pos.x + reich + WELT_HALB) / KACHEL));
    const k0z = Math.max(0, Math.floor((f.pos.z - reich + WELT_HALB) / KACHEL)), k1z = Math.min(KACHELN - 1, Math.floor((f.pos.z + reich + WELT_HALB) / KACHEL));
    for (let kz = k0z; kz <= k1z; kz++) {
      for (let kx = k0x; kx <= k1x; kx++) {
        const ko = objekte.kachel(kz * KACHELN + kx);
        for (let i = 0; i < ko.n; i++) {
          if (ko.zustand[i]) continue;
          const typ = OBJEKT_TYPEN[ko.typ[i]];
          if (typ.radius === 0) continue;
          const dx = ko.x[i] - f.pos.x, dz = ko.z[i] - f.pos.z;
          if (dx > reich || dx < -reich || dz > reich || dz < -reich) continue;
          const r = typ.radius * ko.skala[i];
          const ox = dx * lx + dz * lz, oz = dx * fx + dz * fz;
          const cx = ox < -hb ? -hb : ox > hb ? hb : ox, cz = oz < -hl ? -hl : oz > hl ? hl : oz;
          const ex = ox - cx, ez = oz - cz;
          const d2 = ex * ex + ez * ez;
          if (d2 >= r * r) continue;
          if (unten > ko.y[i] + typ.hoehe * ko.skala[i]) continue;
          // Normale im Fahrzeugsystem (vom Objekt zum Auto)
          let nlx: number, nlz: number, tiefe: number;
          if (d2 > 1e-6) {
            const d = Math.sqrt(d2);
            nlx = -ex / d; nlz = -ez / d; tiefe = r - d;
          } else {
            // Mittelpunkt im Auto: über die nächste Seite hinausschieben
            const ax = hb - Math.abs(ox), az = hl - Math.abs(oz);
            if (ax < az) { nlx = ox > 0 ? -1 : 1; nlz = 0; tiefe = ax + r; } else { nlx = 0; nlz = oz > 0 ? -1 : 1; tiefe = az + r; }
          }
          const nx = lx * nlx + fx * nlz, nz = lz * nlx + fz * nlz;
          const px = f.pos.x + lx * cx + fx * cz, pz = f.pos.z + lz * cx + fz * cz;
          if (typ.fest) {
            const staerke = stossFest(f, px, py, pz, nx, nz, tiefe);
            if (staerke > 1) {
              t.schaden.aufprall(f, cx, cz, staerke);
              welt.melde({ art: 'aufprall', teilnehmer: t.id, anderer: 0, x: px, y: py, z: pz, staerke, objekt: ko.typ[i], lx: cx, lz: cz, nx, nz });
            }
          } else {
            const vn = -(f.v.x * nx + f.v.z * nz);
            if (vn < 1.2) { stossFest(f, px, py, pz, nx, nz, tiefe * 0.5, 0, 0.2); continue; }
            // Requisit zerbricht: das Auto verliert etwas Schwung
            ko.zustand[i] = 1; ko.version++;
            const j = Math.min(typ.masse * vn * 1.3, w.masse * vn * 0.35);
            f.impuls(px, py, pz, nx * j, 0, nz * j);
            if (typ.masse > 40) t.schaden.aufprall(f, cx, cz, vn * 0.25);
            welt.melde({ art: 'zerstoert', teilnehmer: t.id, anderer: 0, x: ko.x[i], y: ko.y[i], z: ko.z[i], staerke: vn, objekt: ko.typ[i], lx: cx, lz: cz, nx, nz });
          }
        }
      }
    }

    // ---- Gebäude und andere feste Rechtecke ----
    const hindernisse = welt.hindernisse.bei(f.pos.x, f.pos.z);
    if (hindernisse) {
      for (const h of hindernisse) {
        if (unten > h.y1 || f.pos.y + w.hoehe < h.y0) continue;
        const u = rechteckUeberlappung(f.pos.x, f.pos.z, fx, fz, hl, hb, h.x, h.z, Math.sin(h.gier), Math.cos(h.gier), h.hz, h.hx);
        if (!u) continue;
        const staerke = stossFest(f, u.px, py, u.pz, u.nx, u.nz, u.tiefe);
        if (staerke > 1) {
          const ax = u.px - f.pos.x, az = u.pz - f.pos.z;
          const clx = ax * lx + az * lz, clz = ax * fx + az * fz;
          t.schaden.aufprall(f, clx, clz, staerke);
          welt.melde({ art: 'aufprall', teilnehmer: t.id, anderer: 0, x: u.px, y: py, z: u.pz, staerke, objekt: -1, lx: clx, lz: clz, nx: u.nx, nz: u.nz });
        }
      }
    }

    // ---- Brückengeländer und Tunnelwände (Ecken des Autos gegen die Fahrbahnränder) ----
    const zelle = netz.zelle(f.pos.x, f.pos.z);
    if (zelle < 0) return;
    const starts = netz.starts, refs = netz.refs;
    for (let r = starts[zelle]; r < starts[zelle + 1]; r++) {
      const ref = refs[r];
      const st = netz.strassen[ref >> 14], k = ref & 16383;
      const flag = st.flag[k] | st.flag[k + 1];
      if (flag === FLAG_NORMAL) continue;
      const ax = st.x[k], az = st.z[k];
      const dx = st.x[k + 1] - ax, dz = st.z[k + 1] - az;
      const l2 = dx * dx + dz * dz, l = Math.sqrt(l2);
      const sx = dz / l, sz = -dx / l; // links der Straße
      const tunnel = (flag & FLAG_TUNNEL) !== 0;
      const grenze = st.halbbreite + (tunnel ? 0.5 : 0.1);
      for (let e = 0; e < 4; e++) {
        const ecx = e & 1 ? -hb : hb, ecz = e & 2 ? -hl : hl;
        const wx = f.pos.x + lx * ecx + fx * ecz, wz = f.pos.z + lz * ecx + fz * ecz;
        const tt = ((wx - ax) * dx + (wz - az) * dz) / l2;
        if (tt < 0 || tt > 1) continue;
        const u = (wx - ax - dx * tt) * sx + (wz - az - dz * tt) * sz;
        const au = Math.abs(u);
        if (au <= grenze || au > grenze + 2.5) continue;
        const deck = st.y[k] + (st.y[k + 1] - st.y[k]) * tt;
        if (unten < deck - 1.5 || unten > deck + (tunnel ? TUNNEL_HOEHE : 0.8)) continue;
        const s = u > 0 ? -1 : 1;
        const staerke = stossFest(f, wx, py, wz, sx * s, sz * s, au - grenze, 0.1, 0.25);
        if (staerke > 1.5) {
          t.schaden.aufprall(f, ecx, ecz, staerke);
          welt.melde({ art: 'aufprall', teilnehmer: t.id, anderer: 0, x: wx, y: py, z: wz, staerke, objekt: -1, lx: ecx, lz: ecz, nx: sx * s, nz: sz * s });
        }
      }
    }
  };
}
