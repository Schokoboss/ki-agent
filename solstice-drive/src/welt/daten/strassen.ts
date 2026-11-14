import type { OrtDef, StrassenDef } from './strassentypen';

/**
 * Orte, Kreuzungen und Straßen von Kap Aurora. Koordinaten in m (x nach Osten, z nach Süden).
 * Straßen verbinden zwei Orte; den Verlauf dazwischen sucht der Generator im Gelände
 * (`gerade: true` und Bauwerke ausgenommen). Reihenfolge = Baureihenfolge: frühere Straßen
 * werden von späteren möglichst nicht gekreuzt.
 */

/** Punkte auf einem Kreisbogen (Winkel in Grad, 0 = Norden, im Uhrzeigersinn). */
function bogen(cx: number, cz: number, radius: number, von: number, bis: number, schritte: number): [number, number][] {
  const p: [number, number][] = [];
  for (let i = 1; i < schritte; i++) {
    const w = ((von + ((bis - von) * i) / schritte) * Math.PI) / 180;
    p.push([Math.round(cx + Math.sin(w) * radius), Math.round(cz - Math.cos(w) * radius)]);
  }
  return p;
}

// Stadtraster von Hafenstadt Aurora: 4 × 3 Kreuzungen
const SX = [-3060, -2840, -2620, -2400];
const SZ = [1880, 2100, 2320];
const stadtOrte: OrtDef[] = [];
const stadtStrassen: StrassenDef[] = [];
for (let i = 0; i < SX.length; i++) {
  for (let j = 0; j < SZ.length; j++) {
    stadtOrte.push({ id: `s${i}${j}`, x: SX[i], z: SZ[j] });
    if (i > 0) stadtStrassen.push({ id: `stadt-q${i}${j}`, typ: 'stadtstrasse', von: `s${i - 1}${j}`, nach: `s${i}${j}`, gerade: true });
    if (j > 0) stadtStrassen.push({ id: `stadt-l${i}${j}`, typ: 'stadtstrasse', von: `s${i}${j - 1}`, nach: `s${i}${j}`, gerade: true });
  }
}

export const ORTE: readonly OrtDef[] = [
  // Festivalgelände
  { id: 'festival', x: 150, z: 350, benannt: true },
  { id: 'f-nord', x: 150, z: -90 },
  { id: 'f-ost', x: 590, z: 350 },
  { id: 'f-sued', x: 150, z: 790 },
  { id: 'f-west', x: -290, z: 350 },
  // Hafenstadt
  ...stadtOrte,
  { id: 'hafen', x: -3330, z: 2100, benannt: true },
  { id: 'stadt-ost', x: -1950, z: 1980 },
  { id: 'stadt-nord', x: -2620, z: 1450 },
  // Küstenstraße (im Uhrzeigersinn ab Stadt)
  { id: 'k-sw', x: -1900, z: 2720 },
  { id: 'brueckenkopf', x: 40, z: 2230, benannt: true },
  { id: 'bruecke-nord', x: -10, z: 2420 },
  { id: 'bruecke-sued', x: -80, z: 2900 },
  { id: 'suedkap', x: -150, z: 3380, benannt: true },
  { id: 'k-so', x: 1650, z: 2950 },
  { id: 'k-ost', x: 3120, z: 1500 },
  { id: 'watt-west', x: 2470, z: 205, benannt: true },
  { id: 'wattinsel', x: 3560, z: 150, benannt: true },
  { id: 'k-no', x: 3180, z: -1650 },
  { id: 'k-nord', x: 1850, z: -3120, benannt: true },
  { id: 'nordbucht', x: -330, z: -2130, benannt: true },
  { id: 'k-nw', x: -1900, z: -2720 },
  { id: 'k-nwkap', x: -2780, z: -2330 },
  { id: 'leuchtfeuer', x: -3350, z: -3120, benannt: true },
  { id: 'k-west', x: -2900, z: -1300 },
  { id: 'westbucht', x: -2250, z: 380, benannt: true },
  // Binnenland
  { id: 'westkreuz', x: -1150, z: 620 },
  { id: 'nordkreuz', x: -120, z: -950 },
  { id: 'suedkreuz', x: 430, z: 1520 },
  { id: 'ostkreuz', x: 1250, z: 520 },
  { id: 'hof-sued', x: -820, z: 1900, benannt: true },
  // Hochgebirge
  { id: 'bergdorf', x: 760, z: -820, benannt: true },
  { id: 'talkessel', x: 1450, z: -1500, benannt: true },
  { id: 'sternwarte', x: 2230, z: -1330, benannt: true },
  { id: 'bergfuss-nord', x: 1500, z: -2760 },
  { id: 'tunnel-w-aussen', x: -149, z: -1500 },
  { id: 'tunnel-w-innen', x: 1244, z: -1515 },
  { id: 'tunnel-o-innen', x: 1633, z: -1521 },
  { id: 'tunnel-o-aussen', x: 3000, z: -1279 },
  // Nebelwald
  { id: 'waldrand-sued', x: -1250, z: -180 },
  { id: 'waldrand-ost', x: -640, z: -1350 },
  { id: 'seehuette', x: -1390, z: -1240, benannt: true },
  { id: 'saegewerk', x: -1950, z: -1750, benannt: true },
  { id: 'lichtung', x: -2380, z: -720, benannt: true },
  { id: 'see-sued', x: -1380, z: -400 },
  // Glutdünen
  { id: 'oase', x: 1950, z: 1750, benannt: true },
  { id: 'duene-nord', x: 1650, z: 1020 },
  { id: 'duene-ost', x: 2720, z: 1560 },
  { id: 'duene-sued', x: 1900, z: 2520 },
  { id: 'duene-west', x: 1130, z: 1760 },
];

export const STRASSEN: readonly StrassenDef[] = [
  // --- Festivalring und Zufahrten ---
  { id: 'ring-no', typ: 'landstrasse', von: 'f-nord', nach: 'f-ost', gerade: true, ueber: bogen(150, 350, 440, 0, 90, 6) },
  { id: 'ring-so', typ: 'landstrasse', von: 'f-ost', nach: 'f-sued', gerade: true, ueber: bogen(150, 350, 440, 90, 180, 6) },
  { id: 'ring-sw', typ: 'landstrasse', von: 'f-sued', nach: 'f-west', gerade: true, ueber: bogen(150, 350, 440, 180, 270, 6) },
  { id: 'ring-nw', typ: 'landstrasse', von: 'f-west', nach: 'f-nord', gerade: true, ueber: bogen(150, 350, 440, 270, 360, 6) },
  { id: 'allee-nord', typ: 'stadtstrasse', von: 'festival', nach: 'f-nord', gerade: true },
  { id: 'allee-sued', typ: 'stadtstrasse', von: 'festival', nach: 'f-sued', gerade: true },
  { id: 'allee-ost', typ: 'stadtstrasse', von: 'festival', nach: 'f-ost', gerade: true },
  { id: 'allee-west', typ: 'stadtstrasse', von: 'festival', nach: 'f-west', gerade: true },
  // --- Schnellstraßen ---
  { id: 'a1-west', typ: 'schnellstrasse', von: 'f-west', nach: 'westkreuz' },
  { id: 'a1-stadt', typ: 'schnellstrasse', von: 'westkreuz', nach: 'stadt-ost' },
  { id: 'a1-ost', typ: 'schnellstrasse', von: 'f-ost', nach: 'ostkreuz' },
  { id: 'a1-watt', typ: 'schnellstrasse', von: 'ostkreuz', nach: 'watt-west' },
  { id: 'a2-nord', typ: 'schnellstrasse', von: 'f-nord', nach: 'nordkreuz' },
  { id: 'a2-bucht', typ: 'schnellstrasse', von: 'nordkreuz', nach: 'nordbucht' },
  { id: 'a3-sued', typ: 'schnellstrasse', von: 'f-sued', nach: 'suedkreuz' },
  { id: 'a3-bruecke', typ: 'schnellstrasse', von: 'suedkreuz', nach: 'brueckenkopf' },
  // --- Hafenstadt ---
  ...stadtStrassen,
  { id: 'hafenstrasse', typ: 'stadtstrasse', von: 'hafen', nach: 's01', gerade: true },
  { id: 'stadt-zufahrt-ost', typ: 'stadtstrasse', von: 's31', nach: 'stadt-ost', gerade: true },
  { id: 'stadt-zufahrt-nord', typ: 'stadtstrasse', von: 's20', nach: 'stadt-nord' },
  // --- Küstenstraße ---
  { id: 'kueste-sw', typ: 'landstrasse', von: 's32', nach: 'k-sw' },
  { id: 'kueste-s1', typ: 'landstrasse', von: 'k-sw', nach: 'brueckenkopf' },
  { id: 'kueste-s2', typ: 'landstrasse', von: 'brueckenkopf', nach: 'k-so' },
  { id: 'kueste-so', typ: 'landstrasse', von: 'k-so', nach: 'k-ost' },
  { id: 'kueste-o1', typ: 'landstrasse', von: 'k-ost', nach: 'watt-west' },
  { id: 'kueste-o2', typ: 'landstrasse', von: 'watt-west', nach: 'tunnel-o-aussen' },
  { id: 'kueste-o3', typ: 'landstrasse', von: 'tunnel-o-aussen', nach: 'k-no' },
  { id: 'kueste-no', typ: 'landstrasse', von: 'k-no', nach: 'k-nord' },
  { id: 'kueste-n1', typ: 'landstrasse', von: 'k-nord', nach: 'nordbucht' },
  { id: 'kueste-n2', typ: 'landstrasse', von: 'nordbucht', nach: 'k-nw' },
  { id: 'kueste-nw', typ: 'landstrasse', von: 'k-nw', nach: 'k-nwkap' },
  { id: 'kueste-w1', typ: 'landstrasse', von: 'k-nwkap', nach: 'k-west' },
  { id: 'kueste-w2', typ: 'landstrasse', von: 'k-west', nach: 'westbucht' },
  { id: 'kueste-w3', typ: 'landstrasse', von: 'westbucht', nach: 'stadt-nord' },
  // --- Inseln ---
  { id: 'bruecke-zufahrt', typ: 'landstrasse', von: 'brueckenkopf', nach: 'bruecke-nord', gerade: true },
  { id: 'suedkap-bruecke', typ: 'landstrasse', von: 'bruecke-nord', nach: 'bruecke-sued', bauwerk: 'bruecke' },
  { id: 'suedkap-strasse', typ: 'landstrasse', von: 'bruecke-sued', nach: 'suedkap' },
  { id: 'wattweg', typ: 'sandpiste', von: 'watt-west', nach: 'wattinsel', gerade: true, ueber: [[2800, 190], [3100, 178], [3330, 165]], furt: true },
  { id: 'leuchtfeuerweg', typ: 'schotter', von: 'k-nwkap', nach: 'leuchtfeuer', ueber: [[-3060, -2590]] },
  // --- Binnenland ---
  { id: 'west-wald', typ: 'landstrasse', von: 'westkreuz', nach: 'waldrand-sued' },
  { id: 'west-bucht', typ: 'landstrasse', von: 'westkreuz', nach: 'westbucht' },
  { id: 'sued-stadt', typ: 'landstrasse', von: 'suedkreuz', nach: 'hof-sued' },
  { id: 'hof-stadt', typ: 'landstrasse', von: 'hof-sued', nach: 'stadt-ost' },
  { id: 'hof-kueste', typ: 'feldweg', von: 'hof-sued', nach: 'k-sw' },
  { id: 'ost-berg', typ: 'bergstrasse', von: 'ostkreuz', nach: 'bergdorf' },
  { id: 'nord-berg', typ: 'bergstrasse', von: 'nordkreuz', nach: 'bergdorf' },
  { id: 'nord-wald', typ: 'landstrasse', von: 'nordkreuz', nach: 'waldrand-ost' },
  // --- Hochgebirge ---
  { id: 'tunnel-west', typ: 'landstrasse', von: 'tunnel-w-aussen', nach: 'tunnel-w-innen', bauwerk: 'tunnel' },
  { id: 'tunnel-ost', typ: 'landstrasse', von: 'tunnel-o-innen', nach: 'tunnel-o-aussen', bauwerk: 'tunnel' },
  { id: 'kessel-west', typ: 'landstrasse', von: 'tunnel-w-innen', nach: 'talkessel' },
  { id: 'kessel-ost', typ: 'landstrasse', von: 'talkessel', nach: 'tunnel-o-innen' },
  { id: 'tunnel-zufahrt', typ: 'landstrasse', von: 'nordkreuz', nach: 'tunnel-w-aussen' },
  { id: 'suedpass', typ: 'bergstrasse', von: 'bergdorf', nach: 'talkessel' },
  { id: 'nordpass', typ: 'bergstrasse', von: 'talkessel', nach: 'bergfuss-nord' },
  { id: 'pass-ausgang', typ: 'bergstrasse', von: 'bergfuss-nord', nach: 'k-nord' },
  { id: 'sternwartenweg', typ: 'bergstrasse', von: 'talkessel', nach: 'sternwarte' },
  { id: 'ostflanke', typ: 'bergstrasse', von: 'sternwarte', nach: 'k-no' },
  // --- Nebelwald ---
  { id: 'wald-see', typ: 'schotter', von: 'waldrand-sued', nach: 'see-sued' },
  { id: 'see-west', typ: 'schotter', von: 'see-sued', nach: 'seehuette', ueber: [[-1790, -640], [-1800, -1010]] },
  { id: 'see-ost', typ: 'feldweg', von: 'see-sued', nach: 'seehuette', ueber: [[-990, -620], [-960, -1010]] },
  { id: 'wald-ost', typ: 'schotter', von: 'seehuette', nach: 'waldrand-ost' },
  { id: 'wald-saege', typ: 'schotter', von: 'seehuette', nach: 'saegewerk' },
  { id: 'saege-nord', typ: 'schotter', von: 'saegewerk', nach: 'k-nw' },
  { id: 'saege-lichtung', typ: 'schotter', von: 'saegewerk', nach: 'lichtung' },
  { id: 'lichtung-west', typ: 'feldweg', von: 'lichtung', nach: 'k-west' },
  { id: 'lichtung-sued', typ: 'schotter', von: 'lichtung', nach: 'waldrand-sued' },
  // --- Glutdünen ---
  { id: 'duenen-zufahrt', typ: 'landstrasse', von: 'ostkreuz', nach: 'duene-nord' },
  { id: 'piste-n-oase', typ: 'sandpiste', von: 'duene-nord', nach: 'oase' },
  { id: 'piste-oase-o', typ: 'sandpiste', von: 'oase', nach: 'duene-ost' },
  { id: 'piste-oase-s', typ: 'sandpiste', von: 'oase', nach: 'duene-sued' },
  { id: 'piste-oase-w', typ: 'sandpiste', von: 'oase', nach: 'duene-west' },
  { id: 'piste-n-o', typ: 'sandpiste', von: 'duene-nord', nach: 'duene-ost' },
  { id: 'piste-o-s', typ: 'sandpiste', von: 'duene-ost', nach: 'duene-sued' },
  { id: 'piste-s-w', typ: 'sandpiste', von: 'duene-sued', nach: 'duene-west' },
  { id: 'duene-ost-kueste', typ: 'sandpiste', von: 'duene-ost', nach: 'k-ost' },
  { id: 'duene-sued-kueste', typ: 'sandpiste', von: 'duene-sued', nach: 'k-so' },
  { id: 'duene-west-sued', typ: 'landstrasse', von: 'duene-west', nach: 'suedkreuz' },
];
