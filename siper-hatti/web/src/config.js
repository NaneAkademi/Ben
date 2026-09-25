// Oyun genel ayarları ve dengeleri.

export const VERSION = '2.1';
export const PROTOCOL = 4; // ağ mesaj biçimi değişince artır
export const PEER_PREFIX = 'siperhatti4-';
export const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const MAX_PLAYERS = 4;

export const ARENA = 48; // arenanın yarı genişliği (metre)
export const SNAP_HZ = 20;
export const INTERP_DELAY = 110; // ms
export const GRAVITY = 9.81;

// Tank sınıfları ve düşman türleri.
// hp: can, speed/rev: ileri/geri m/s, accel: m/s², turn: gövde dönüşü rad/s, turret: taret dönüşü rad/s,
// elev: namlu kaldırma rad/s, reload: s, dmg: hasar, shell: mermi hızı m/s, disp: temel sapma (rad), aimTime: nişan toplama süresi
// armor: [ön, yan, arka] hasar çarpanı
export const TYPES = {
  light: {
    name: 'Çita', role: 'Hafif tank', hp: 85, speed: 12.5, rev: 6, accel: 7, turn: 1.9, turret: 2.1, elev: 0.9,
    reload: 1.7, dmg: 27, shell: 105, range: 75, r: 1.55, scale: 0.9, model: 'light', disp: 0.017, aimTime: 0.45,
    armor: [0.9, 1.05, 1.35], stats: { fire: 0.45, armor: 0.3, speed: 1.0, reload: 0.9 },
  },
  medium: {
    name: 'Kurt', role: 'Orta tank', hp: 115, speed: 10, rev: 5, accel: 5.2, turn: 1.55, turret: 1.6, elev: 0.7,
    reload: 2.2, dmg: 36, shell: 100, range: 80, r: 1.75, scale: 1, model: 'medium', disp: 0.013, aimTime: 0.6,
    armor: [0.8, 1, 1.3], stats: { fire: 0.65, armor: 0.6, speed: 0.72, reload: 0.65 },
  },
  heavy: {
    name: 'Ayı', role: 'Ağır tank', hp: 160, speed: 7.6, rev: 3.6, accel: 3.6, turn: 1.15, turret: 1.15, elev: 0.5,
    reload: 3.0, dmg: 50, shell: 95, range: 85, r: 2.0, scale: 1.12, model: 'heavy', disp: 0.011, aimTime: 0.75,
    armor: [0.65, 0.95, 1.25], stats: { fire: 0.95, armor: 1.0, speed: 0.45, reload: 0.35 },
  },
  elight: {
    name: 'Keşif', hp: 55, speed: 10, rev: 5, accel: 6, turn: 2.0, turret: 1.8, elev: 0.8,
    reload: 3.3, dmg: 8, shell: 90, range: 60, r: 1.5, scale: 0.86, model: 'light', disp: 0.032, aimTime: 0.8,
    armor: [0.9, 1.05, 1.35], score: 100,
  },
  emedium: {
    name: 'Muhafız', hp: 95, speed: 7.5, rev: 4, accel: 4.5, turn: 1.5, turret: 1.4, elev: 0.6,
    reload: 3.6, dmg: 14, shell: 90, range: 65, r: 1.75, scale: 1, model: 'medium', disp: 0.026, aimTime: 0.9,
    armor: [0.8, 1, 1.3], score: 150,
  },
  eheavy: {
    name: 'Kale', hp: 210, speed: 5, rev: 3, accel: 3, turn: 1.0, turret: 1.0, elev: 0.45,
    reload: 4.2, dmg: 28, shell: 85, range: 70, r: 2.05, scale: 1.15, model: 'heavy', disp: 0.022, aimTime: 1.0,
    armor: [0.65, 0.95, 1.25], score: 300,
  },
  boss: {
    name: 'KOMUTAN', hp: 900, speed: 3.8, rev: 2.5, accel: 2.5, turn: 0.8, turret: 0.9, elev: 0.4,
    reload: 1.8, dmg: 30, shell: 85, range: 75, r: 2.8, scale: 1.55, model: 'boss', disp: 0.02, aimTime: 1.0,
    armor: [0.6, 0.9, 1.2], score: 2000,
  },
};
export const TYPE_LIST = ['light', 'medium', 'heavy', 'elight', 'emedium', 'eheavy', 'boss'];
export const CLASS_LIST = ['light', 'medium', 'heavy'];

export const AMMO = {
  ap: { name: 'Zırh Delici', short: 'ZD', dmgMul: 1, reloadMul: 1 },
  he: { name: 'Yüksek Patlayıcı', short: 'YP', dmgMul: 0.72, reloadMul: 1.15, splash: 4.8, splashMul: 0.5 },
};

export const CONSUMABLES = {
  smoke: { name: 'Sis', cd: 26, dur: 10, r: 7 },
  repair: { name: 'Tamir', cd: 32, heal: 35 },
};

export const CAMERA = { dist: 8.8, pitch: 0.16, minPitch: -0.22, maxPitch: 0.62, touchSens: 0.0052, mouseSens: 0.0024, zoomFov: 22 };

export const PICKUPS = {
  repair: { color: '#57d163', label: '+35 Onarım', hp: 35 },
  rapid: { color: '#ffb13b', label: 'Hızlı Doldurma', time: 10 },
};
export const PICKUP_LIST = ['repair', 'rapid'];

export const BARREL = { r: 0.6, splash: 6, dmg: 45 };

export const PLAYER_COLORS = [
  { name: 'Haki', hex: '#B9A56A', lvl: 1 },
  { name: 'Orman', hex: '#62763F', lvl: 1 },
  { name: 'Deniz', hex: '#557596', lvl: 1 },
  { name: 'Kum', hex: '#D0AE74', lvl: 1 },
  { name: 'Gri', hex: '#8E979C', lvl: 1 },
  { name: 'Bordo', hex: '#93403A', lvl: 2 },
  { name: 'Mor', hex: '#76619A', lvl: 2 },
  { name: 'Turuncu', hex: '#C97A3C', lvl: 3 },
  { name: 'Gece', hex: '#3A3D40', lvl: 4 },
  { name: 'Buz', hex: '#C9D7DE', lvl: 5 },
  { name: 'Zümrüt', hex: '#2F8F6B', lvl: 6 },
  { name: 'Altın', hex: '#D9A92E', lvl: 8 },
];
export const ENEMY_COLORS = { elight: '#7B3A2C', emedium: '#6A3228', eheavy: '#4A4B45', boss: '#2C2D2F' };
export const BOT_COLORS = ['#7E8A5A', '#8A6E52', '#5E6F7C', '#8B5D6E', '#6D7F6A', '#9A8A5E'];
export const BOT_NAMES = ['Kurt', 'Şahin', 'Kartal', 'Pars', 'Bora', 'Tufan', 'Yıldırım', 'Kaplan', 'Atmaca', 'Doğan', 'Poyraz', 'Karakurt'];

// Seviye için gereken toplam tecrübe puanı
export const levelXp = lvl => Math.round(250 * Math.pow(Math.max(0, lvl - 1), 1.35));

export const THEMES = {
  meadow: {
    name: 'Yeşil Vadi',
    skyTop: '#3d82d4', skyHorizon: '#c4e2f6', sunGlow: '#fff1c9',
    fog: '#cfe2f1', fogNear: 95, fogFar: 340,
    sunDir: [-0.45, 0.74, 0.34], sunColor: '#fff3de', sunI: 3.1,
    hemiSky: '#dcefff', hemiGround: '#6f7d3c', hemiI: 1.25, exposure: 1.05,
    ground: ['#6e9a3a', '#88ae47', '#5c8833', '#a08457'], hill: '#6b9437', road: '#a88f64',
    grass: ['#6c9c33', '#9cbf48', '#c4c65c'], grassDensity: 1, flowers: ['#f7e25b', '#ffffff', '#c47fdc', '#ff8a5c'],
    trees: ['pine', 'oak', 'birch'], rock: '#a09a8d', wall: '#dcd3c1', roof: '#b0563a', wood: '#7a5a3a',
    water: '#3e86ad', props: ['house', 'house', 'barn', 'hay', 'ruin'], pond: true,
    mountain: '#7f9bb5', snowCap: true, dust: [0.6, 0.53, 0.4], snow: false,
  },
  desert: {
    name: 'Çöl Üssü',
    skyTop: '#2d7fd2', skyHorizon: '#f3e6c8', sunGlow: '#fff3d0',
    fog: '#eee0c0', fogNear: 100, fogFar: 360,
    sunDir: [-0.3, 0.82, 0.28], sunColor: '#fff6e2', sunI: 3.3,
    hemiSky: '#e0efff', hemiGround: '#b08a55', hemiI: 1.2, exposure: 1.0,
    ground: ['#dab676', '#e6c68c', '#cda465', '#b58e5c'], hill: '#d2ab6d', road: '#b99466',
    grass: ['#a8955a', '#c2ac6a', '#8d7c46'], grassDensity: 0.22, flowers: null,
    trees: ['palm', 'dead'], rock: '#c29470', wall: '#e6d5b0', roof: '#b97a4b', wood: '#8a6a45',
    water: '#2fa3b8', props: ['container', 'container', 'tent', 'tower', 'jersey', 'ruin'], pond: true,
    mountain: '#c9a37a', snowCap: false, dust: [0.85, 0.74, 0.54], snow: false,
  },
  snow: {
    name: 'Kuzey Cephesi',
    skyTop: '#6f98c6', skyHorizon: '#e8f0f7', sunGlow: '#fff8ea',
    fog: '#e1e9f1', fogNear: 70, fogFar: 260,
    sunDir: [-0.5, 0.58, -0.4], sunColor: '#f6f8ff', sunI: 2.6,
    hemiSky: '#eaf2ff', hemiGround: '#9aa4b2', hemiI: 1.45, exposure: 1.08,
    ground: ['#f1f5fa', '#e4ecf4', '#fbfdff', '#a8a69e'], hill: '#f3f7fb', road: '#b9b8b0',
    grass: ['#8d8a72', '#a09a80', '#6f6b58'], grassDensity: 0.14, flowers: null,
    trees: ['snowpine', 'snowpine', 'birch'], rock: '#8c929a', wall: '#a8a397', roof: '#5d4a3c', wood: '#5a4232',
    water: '#bcd9ea', props: ['cabin', 'cabin', 'ruin', 'jersey', 'container'], pond: true, ice: true,
    mountain: '#9fb3c8', snowCap: true, dust: [0.96, 0.97, 1.0], snow: true,
  },
};
export const THEME_LIST = ['meadow', 'desert', 'snow'];

export const QUALITY = {
  low: { dpr: 0.9, shadows: false, shadowSize: 0, grass: 0, particles: 800, bloom: false, antialias: false, lights: false, env: false },
  medium: { dpr: 1.4, shadows: true, shadowSize: 1024, grass: 2200, particles: 1600, bloom: false, antialias: true, lights: true, env: true },
  high: { dpr: 2, shadows: true, shadowSize: 2048, grass: 4500, particles: 2600, bloom: true, antialias: true, lights: true, env: true },
};
