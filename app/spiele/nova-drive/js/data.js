// Spielinhalte: Straßen der Insel, Autos, Events. Koordinaten in Metern: x = Osten, z = Süden.
import { roundedPoly } from './util.js';

export const ROADS = [
  {
    id: 'kueste', name: 'Küstenstraße', closed: true, hw: 7, type: 'asphalt', lamps: false, fences: true,
    pts: [[0, 800], [330, 760], [620, 600], [800, 330], [850, 20], [800, -300], [640, -580], [380, -760], [60, -830],
      [-260, -800], [-540, -680], [-760, -450], [-860, -150], [-850, 170], [-740, 450], [-520, 660], [-260, 790]],
  },
  {
    id: 'festival', name: 'Festival-Rundkurs', closed: true, hw: 7.5, type: 'asphalt', lamps: true, cones: true,
    pts: roundedPoly([[-200, 440], [60, 430], [210, 470], [235, 600], [130, 690], [-50, 650], [-150, 720], [-245, 620]], 38),
  },
  {
    id: 'pass', name: 'Sonnenpass', closed: false, hw: 6, type: 'asphalt', lamps: false, fences: true,
    pts: [[40, 427], [60, 300], [130, 150], [110, 0], [175, -120], [85, -215], [205, -300], [95, -385], [215, -465],
      [140, -585], [130, -700], [60, -826]],
  },
  {
    id: 'stadt', name: 'Altstadtring', closed: true, hw: 6.5, type: 'asphalt', lamps: true,
    pts: roundedPoly([[-770, -120], [-560, -120], [-535, -150], [-470, -150], [-470, 200], [-640, 200], [-665, 232], [-770, 232]], 20),
  },
  {
    id: 'markt', name: 'Marktstraße', closed: false, hw: 6, type: 'asphalt', lamps: true,
    pts: [[-620, -150], [-620, 40], [-620, 232]],
  },
  {
    id: 'see', name: 'Seestraße', closed: false, hw: 6.5, type: 'asphalt', lamps: true,
    pts: [[-852, 40], [-700, 40], [-560, 40], [-440, 45], [-365, 135], [-295, 275], [-205, 378], [-100, 438], [-30, 433]],
  },
  {
    id: 'schnell', name: 'Schnellstraße', closed: false, hw: 8, type: 'asphalt', lamps: false, fences: true,
    pts: [[228, 560], [330, 475], [388, 330], [400, 100], [402, -150], [420, -380], [500, -520], [638, -578]],
  },
  {
    id: 'wald', name: 'Waldpiste', closed: true, hw: 5, type: 'dirt',
    pts: [[520, -10], [600, 95], [705, 60], [742, -80], [700, -222], [600, -292], [528, -210], [496, -100]],
  },
  {
    id: 'waldweg', name: 'Waldweg', closed: false, hw: 4.5, type: 'dirt',
    pts: [[401, -80], [432, -92], [466, -104], [497, -100]],
  },
  {
    id: 'berg', name: 'Bergpfad', closed: false, hw: 5, type: 'dirt',
    pts: [[-620, -152], [-575, -300], [-430, -410], [-330, -540], [-300, -660], [-262, -795]],
  },
];

// Querfeldein-Strecke (keine Straße, nur Tore)
export const CROSS = {
  id: 'quer', closed: false,
  pts: [[-300, 690], [-450, 640], [-580, 560], [-680, 440], [-650, 320], [-540, 280], [-430, 230], [-340, 170],
    [-210, 175], [-110, 250], [-60, 340], [-120, 420]],
};

export const CARS = [
  { id: 'kestrel', maker: 'Kestrel', name: 'Hatch 1.8', drive: 'FWD', top: 194, accel: 8.4, grip: 1.0, handling: 1.12, offroad: 0.3,
    price: 15000, style: 'hatch', colors: ['#e8432e', '#2f7cf0', '#f2f2f2', '#22232a', '#f5c518', '#3dbb6a'] },
  { id: 'tundra', maker: 'Tundra', name: 'Rover 4x4', drive: 'AWD', top: 186, accel: 8.6, grip: 0.97, handling: 0.95, offroad: 1.0,
    price: 22000, style: 'truck', colors: ['#3d6b3a', '#d9a441', '#f2f2f2', '#22232a', '#c0392b', '#2e86c1'] },
  { id: 'velora', maker: 'Velora', name: 'Spyder', drive: 'RWD', top: 226, accel: 9.6, grip: 1.12, handling: 1.25, offroad: 0.1,
    price: 32000, style: 'roadster', colors: ['#d7263d', '#ffe066', '#1b98e0', '#f4f4f4', '#13293d', '#ff7a1a'] },
  { id: 'ostwind', maker: 'Ostwind', name: 'Rallye R', drive: 'AWD', top: 221, accel: 10.4, grip: 1.08, handling: 1.15, offroad: 0.85,
    price: 45000, style: 'rally', colors: ['#1f4e9c', '#f2f2f2', '#e63946', '#ffb703', '#2a9d8f', '#111111'] },
  { id: 'brenner', maker: 'Brenner', name: 'Bolt V8', drive: 'RWD', top: 252, accel: 11.2, grip: 0.96, handling: 0.96, offroad: 0.15,
    price: 52000, style: 'muscle', colors: ['#ff6b00', '#111111', '#2b59c3', '#e8e8e8', '#9b1d20', '#2ec4b6'] },
  { id: 'aurum', maker: 'Aurum', name: 'GT-S', drive: 'RWD', top: 292, accel: 13.2, grip: 1.2, handling: 1.15, offroad: 0.1,
    price: 125000, style: 'gt', colors: ['#c9a227', '#b3001b', '#0d1b2a', '#e5e5e5', '#2d6a4f', '#5a189a'] },
  { id: 'volt', maker: 'Volt', name: 'Arrow E', drive: 'AWD', top: 300, accel: 16, grip: 1.22, handling: 1.1, offroad: 0.15,
    price: 210000, style: 'ev', colors: ['#f1f1f1', '#00b4d8', '#7209b7', '#111111', '#80ed99', '#ff006e'] },
  { id: 'phantom', maker: 'Nova', name: 'Phantom', drive: 'RWD', top: 346, accel: 16.6, grip: 1.32, handling: 1.2, offroad: 0.05,
    price: 350000, style: 'hyper', colors: ['#6d5dfc', '#0a0a0a', '#ff3d00', '#e0e0e0', '#00e5ff', '#ffd400'] },
  // neue Blender-Autos (hinten angehängt, damit Herausforderungs-Links gültig bleiben)
  { id: 'sundog', maker: 'Sundog', name: 'Camper 2.0', drive: 'RWD', top: 158, accel: 6.6, grip: 0.9, handling: 0.86, offroad: 0.4,
    price: 9000, style: 'van', colors: ['#e8432e', '#f2c14e', '#5fa8d3', '#7bc47f', '#2a9d8f', '#ff8fab'] },
  { id: 'pixie', maker: 'Pixie', name: 'City 1.3', drive: 'FWD', top: 178, accel: 8.0, grip: 1.04, handling: 1.22, offroad: 0.2,
    price: 12000, style: 'mini', colors: ['#d7263d', '#2a9d8f', '#f4a261', '#264653', '#e9c46a', '#1b98e0'] },
  { id: 'dune', maker: 'Dune', name: 'Sandfloh', drive: 'RWD', top: 175, accel: 10.2, grip: 0.95, handling: 1.18, offroad: 1.0,
    price: 28000, style: 'buggy', colors: ['#c9a227', '#ff6b00', '#2ec4b6', '#e63946', '#f2f2f2', '#3d6b3a'] },
  { id: 'atlas', maker: 'Atlas', name: 'Terra 4x4', drive: 'AWD', top: 205, accel: 9.4, grip: 1.0, handling: 0.98, offroad: 0.9,
    price: 34000, style: 'suv', colors: ['#3d6b3a', '#22232a', '#f2f2f2', '#8d99ae', '#b5651d', '#1d3557'] },
  { id: 'vira', maker: 'Vira', name: 'Classica 64', drive: 'RWD', top: 205, accel: 8.8, grip: 0.98, handling: 1.0, offroad: 0.1,
    price: 38000, style: 'classic', colors: ['#2d6a4f', '#9b1d20', '#f1e3c8', '#1b3a5c', '#c9a227', '#111111'] },
  { id: 'nordwind', maker: 'Nordwind', name: 'Kombi R', drive: 'AWD', top: 248, accel: 11.8, grip: 1.1, handling: 1.08, offroad: 0.4,
    price: 68000, style: 'wagon', colors: ['#1f4e9c', '#3d405b', '#f2f2f2', '#81b29a', '#e07a5f', '#111111'] },
  { id: 'gruppo', maker: 'Gruppo', name: 'Rallye 86', drive: 'AWD', top: 232, accel: 12.4, grip: 1.12, handling: 1.18, offroad: 0.9,
    price: 95000, style: 'rally80', colors: ['#f2f2f2', '#6d5dfc', '#e63946', '#1f4e9c', '#ffb703', '#111111'] },
  { id: 'strato', maker: 'Strato', name: 'Keil V12', drive: 'RWD', top: 305, accel: 14.2, grip: 1.22, handling: 1.12, offroad: 0.05,
    price: 180000, style: 'wedge', colors: ['#f1f1f1', '#ff3d00', '#111111', '#ffd400', '#00b4d8', '#d7263d'] },
];

export const UPGRADES = [
  { key: 'motor', name: 'Motor', desc: '+ Beschleunigung & Spitze', cost: [6000, 14000, 30000] },
  { key: 'reifen', name: 'Reifen', desc: '+ Haftung in Kurven', cost: [4000, 9000, 20000] },
  { key: 'fahrwerk', name: 'Fahrwerk', desc: '+ Lenkung & Stabilität', cost: [3500, 8000, 18000] },
  { key: 'nitro', name: 'Nitro', desc: '+ mehr Nitro, schneller voll', cost: [3000, 7000, 15000] },
];

export function carStats(spec, up = {}) {
  const m = up.motor || 0, r = up.reifen || 0, f = up.fahrwerk || 0, n = up.nitro || 0;
  return {
    top: spec.top * (1 + 0.045 * m),
    accel: spec.accel * (1 + 0.09 * m),
    grip: spec.grip * (1 + 0.055 * r),
    handling: spec.handling * (1 + 0.05 * f),
    offroad: spec.offroad,
    drive: spec.drive,
    nitroCap: 3.2 + 0.9 * n,
    nitroRegen: 0.05 + 0.02 * n,
  };
}

export function rating(st) {
  const r = 100 + (st.top - 170) * 1.6 + (st.accel - 7) * 32 + (st.grip - 0.9) * 520 + (st.handling - 0.85) * 260;
  return Math.max(100, Math.min(999, Math.round(r)));
}
export function carClass(r) {
  return r >= 900 ? 'X' : r >= 800 ? 'S2' : r >= 700 ? 'S1' : r >= 600 ? 'A' : r >= 500 ? 'B' : r >= 400 ? 'C' : 'D';
}
export const CLASS_COLORS = { D: '#3fb8f0', C: '#f5d400', B: '#ff8a00', A: '#ff3b3b', S1: '#b84dff', S2: '#2f6bff', X: '#36e27a' };

// Events. Position über Straße + Anteil (0…1) der Straßenlänge.
export const EVENTS = [
  { id: 'r_festival', type: 'race', name: 'Festival-Rundkurs', road: 'festival', laps: 3, at: 0.0, reward: 9000, fans: 900, ai: 7 },
  { id: 'r_stadt', type: 'race', name: 'Altstadt-Grand-Prix', road: 'stadt', laps: 3, at: 0.08, reward: 11000, fans: 1100, ai: 7 },
  { id: 'r_wald', type: 'race', name: 'Waldrallye', road: 'wald', laps: 3, at: 0.0, reward: 11000, fans: 1100, ai: 5, dirt: true },
  { id: 'r_pass', type: 'race', name: 'Gipfelsturm', road: 'pass', sprint: true, at: 0.0, to: 1.0, reward: 13000, fans: 1300, ai: 7 },
  { id: 'r_schnell', type: 'race', name: 'Vollgas-Sprint', road: 'schnell', sprint: true, at: 0.0, to: 1.0, reward: 10000, fans: 1000, ai: 7 },
  { id: 'r_see', type: 'race', name: 'Seebrücken-Sprint', road: 'see', sprint: true, at: 0.0, to: 1.0, reward: 10000, fans: 1000, ai: 7 },
  { id: 'r_berg', type: 'race', name: 'Bergpfad-Rallye', road: 'berg', sprint: true, at: 0.0, to: 1.0, reward: 12000, fans: 1200, ai: 5, dirt: true },
  { id: 'r_quer', type: 'race', name: 'Querfeldein', road: 'quer', sprint: true, at: 0.0, to: 1.0, reward: 14000, fans: 1400, ai: 5, dirt: true },
  { id: 'r_kueste', type: 'race', name: 'Küstenklassiker', road: 'kueste', laps: 1, at: 0.0, reward: 22000, fans: 2200, ai: 7 },

  { id: 't_schnell', type: 'trap', name: 'Blitzer Schnellstraße', road: 'schnell', at: 0.52, stars: [170, 215, 255] },
  { id: 't_kueste', type: 'trap', name: 'Blitzer Ostküste', road: 'kueste', at: 0.21, stars: [150, 190, 230] },
  { id: 't_see', type: 'trap', name: 'Blitzer Seedamm', road: 'see', at: 0.73, stars: [140, 175, 210] },
  { id: 't_pass', type: 'trap', name: 'Blitzer Passhöhe', road: 'pass', at: 0.58, stars: [110, 140, 170] },
  { id: 't_nord', type: 'trap', name: 'Blitzer Nordkap', road: 'kueste', at: 0.5, stars: [150, 190, 230] },

  { id: 'd_pass', type: 'drift', name: 'Driftzone Serpentinen', road: 'pass', at: 0.3, to: 0.62, stars: [6000, 15000, 30000] },
  { id: 'd_stadt', type: 'drift', name: 'Driftzone Altstadt', road: 'stadt', at: 0.0, to: 0.45, stars: [4000, 10000, 20000] },
  { id: 'd_wald', type: 'drift', name: 'Driftzone Waldpiste', road: 'wald', at: 0.15, to: 0.75, stars: [4000, 10000, 20000] },

  { id: 'j_feld', type: 'jump', name: 'Sprungschanze Feld', x: -95, z: 330, yaw: Math.PI * 1.05, stars: [50, 85, 120] },
  { id: 'j_strand', type: 'jump', name: 'Sprungschanze Strand', x: 560, z: 520, yaw: Math.PI * 1.75, stars: [50, 85, 120] },
  { id: 'j_steppe', type: 'jump', name: 'Sprungschanze Steppe', x: 610, z: -400, yaw: Math.PI * 0.833, stars: [50, 85, 120] },
];

// Gebäude-Modelle (Maße wie in werkstatt/welt.py: w = Breite der Vorderseite, d = Tiefe, Vorderseite = +z)
export const HOUSES = {
  town: [{ id: 'house_a', w: 10, d: 10 }, { id: 'house_b', w: 12, d: 11 }, { id: 'house_c', w: 9, d: 12 }, { id: 'house_e', w: 11, d: 13 }],
  center: [{ id: 'house_b', w: 12, d: 11 }, { id: 'house_c', w: 9, d: 12 }, { id: 'house_d', w: 14, d: 12 }, { id: 'house_f', w: 16, d: 14 }],
  farm: [{ id: 'farmhouse', w: 12, d: 10 }, { id: 'barn', w: 12, d: 18 }],
};

export const RADIO = ['Nova Pulse', 'Küstenwelle', 'Kiesel FM', 'Aus'];

export const TIPS = [
  'Handbremse in der Kurve = Drift. Drifts füllen das Nitro.',
  'Fahr knapp an anderen Autos vorbei: „Knapp vorbei“ gibt Skillpunkte.',
  'Zerstöre die 20 Festival-Plakate auf der Insel – jedes bringt Credits.',
  'Tippe auf die Karte, um Events per Schnellreise zu erreichen.',
  'Im Windschatten eines Gegners wirst du schneller.',
  'Nach einem Rennen: „Freund herausfordern“ schickt deinen Geist als Link.',
  'Geländewagen und Rallye-Autos sind abseits der Straße viel schneller.',
  'Upgrades in der Garage machen dein Auto stärker – aber auch die Gegner passen sich an.',
];
