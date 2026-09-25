// Oyun genel ayarları ve dengeleri.

export const VERSION = '2.0';
export const PROTOCOL = 3; // ağ mesaj biçimi değişince artır
export const PEER_PREFIX = 'siperhatti3-';
export const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const MAX_PLAYERS = 4;

export const ARENA = 46; // arenanın yarı genişliği (metre)
export const SNAP_HZ = 20;
export const INTERP_DELAY = 110; // ms

export const SHELL = {
  speed: 62,
  range: 52,
  height: 1.35,
};

// Tank türleri. hp: can, speed: m/s, turn: rad/s, reload: s, dmg: hasar
export const TYPES = {
  player: { hp: 100, speed: 9.2, rev: 5.5, turn: 2.1, turret: 4.2, reload: 0.62, dmg: 25, shell: 62, range: 52, r: 1.75, scale: 1, model: 'medium' },
  bot: { hp: 100, speed: 8.4, rev: 5, turn: 1.9, turret: 3.2, reload: 0.8, dmg: 25, shell: 62, range: 46, r: 1.75, scale: 1, model: 'medium' },
  light: { hp: 45, speed: 9.4, rev: 6, turn: 2.6, turret: 3.6, reload: 1.9, dmg: 7, shell: 52, range: 38, r: 1.5, scale: 0.86, model: 'light', score: 100 },
  medium: { hp: 75, speed: 7, rev: 4.5, turn: 2.0, turret: 2.8, reload: 2.2, dmg: 11, shell: 55, range: 42, r: 1.75, scale: 1, model: 'medium', score: 150 },
  heavy: { hp: 170, speed: 4.6, rev: 3, turn: 1.3, turret: 1.9, reload: 2.8, dmg: 20, shell: 50, range: 46, r: 2.05, scale: 1.18, model: 'heavy', score: 300 },
  boss: { hp: 700, speed: 3.4, rev: 2.5, turn: 0.9, turret: 1.5, reload: 1.25, dmg: 22, shell: 54, range: 50, r: 2.8, scale: 1.6, model: 'boss', score: 2000 },
};
export const TYPE_LIST = ['player', 'bot', 'light', 'medium', 'heavy', 'boss'];

export const ABILITY = {
  heCooldown: 9, // ağır mermi (patlayıcı)
  heDamage: 55,
  heSplash: 4.5,
  heSplashDmg: 30,
  boostCooldown: 9,
  boostTime: 2.6,
  boostMul: 1.65,
};

export const PICKUPS = {
  repair: { color: '#57d163', label: '+40 Onarım', hp: 40 },
  shield: { color: '#5fb8ff', label: 'Kalkan', time: 9 },
  rapid: { color: '#ffb13b', label: 'Seri Atış', time: 9 },
};
export const PICKUP_LIST = ['repair', 'shield', 'rapid'];

export const BARREL = { r: 0.6, splash: 5.5, dmg: 45 };

export const PLAYER_COLORS = [
  { name: 'Haki', hex: '#B9A56A' },
  { name: 'Orman', hex: '#62763F' },
  { name: 'Deniz', hex: '#557596' },
  { name: 'Bordo', hex: '#93403A' },
  { name: 'Kum', hex: '#D0AE74' },
  { name: 'Gri', hex: '#8E979C' },
  { name: 'Mor', hex: '#76619A' },
  { name: 'Turuncu', hex: '#C97A3C' },
];
export const ENEMY_COLORS = { light: '#7B3A2C', medium: '#6A3228', heavy: '#4A4B45', boss: '#2C2D2F' };
export const BOT_COLORS = ['#7E8A5A', '#8A6E52', '#5E6F7C', '#8B5D6E', '#6D7F6A', '#9A8A5E'];

export const BOT_NAMES = ['Kurt', 'Şahin', 'Kartal', 'Pars', 'Bora', 'Tufan', 'Yıldırım', 'Kaplan', 'Atmaca', 'Doğan', 'Poyraz', 'Karakurt'];

export const THEMES = {
  meadow: {
    name: 'Çayır',
    skyTop: '#4d7fb8', skyHorizon: '#f0cfa2', sunGlow: '#ffcf8a',
    fog: '#d9c2a0', fogNear: 60, fogFar: 200,
    sunDir: [-0.62, 0.42, 0.38], sunColor: '#ffe2b8', sunI: 2.7,
    hemiSky: '#cfe0ff', hemiGround: '#50522c', hemiI: 0.95, exposure: 1.0,
    ground: ['#5b6a31', '#6c793a', '#4f5f2b', '#7b6a44'], hill: '#556530',
    grass: ['#5f7c2e', '#8a9a3e', '#b5ae5a'], grassDensity: 1,
    trees: ['pine', 'oak'], rock: '#817b6d', wall: '#a39a86', roof: '#6b4a36',
    dust: [0.55, 0.49, 0.36], snow: false,
  },
  desert: {
    name: 'Çöl',
    skyTop: '#3f86cf', skyHorizon: '#f6e3bb', sunGlow: '#fff1c8',
    fog: '#ead7b0', fogNear: 70, fogFar: 230,
    sunDir: [-0.35, 0.78, 0.3], sunColor: '#fff4dc', sunI: 3.0,
    hemiSky: '#d8ecff', hemiGround: '#9a7a4a', hemiI: 1.05, exposure: 0.95,
    ground: ['#c9a468', '#d6b67c', '#bb9458', '#a98452'], hill: '#c39e62',
    grass: ['#9c8a4e', '#b8a262', '#7d6f3e'], grassDensity: 0.25,
    trees: ['palm', 'dead'], rock: '#b08766', wall: '#d9c49b', roof: '#a8744a',
    dust: [0.82, 0.71, 0.5], snow: false,
  },
  snow: {
    name: 'Kar',
    skyTop: '#7f97b0', skyHorizon: '#e3e9ef', sunGlow: '#fff6e6',
    fog: '#d8e0e8', fogNear: 45, fogFar: 160,
    sunDir: [-0.5, 0.55, -0.45], sunColor: '#f4f7ff', sunI: 2.0,
    hemiSky: '#e6efff', hemiGround: '#8a93a0', hemiI: 1.35, exposure: 1.18,
    ground: ['#e9eef3', '#dfe6ee', '#f4f7fa', '#9b9a94'], hill: '#eef2f6',
    grass: ['#8d8a72', '#a09a80', '#6f6b58'], grassDensity: 0.18,
    trees: ['snowpine'], rock: '#868b92', wall: '#9d9990', roof: '#58504a',
    dust: [0.95, 0.97, 1.0], snow: true,
  },
};
export const THEME_LIST = ['meadow', 'desert', 'snow'];

export const QUALITY = {
  low: { dpr: 0.85, shadows: false, shadowSize: 0, grass: 0, particles: 700, bloom: false, antialias: false, lights: false },
  medium: { dpr: 1.35, shadows: true, shadowSize: 1024, grass: 1600, particles: 1400, bloom: false, antialias: true, lights: true },
  high: { dpr: 2, shadows: true, shadowSize: 2048, grass: 3600, particles: 2400, bloom: true, antialias: true, lights: true },
};
