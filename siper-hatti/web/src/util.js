export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const angDiff = (a, b) => {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d < -Math.PI) d += TAU;
  return d;
};
export const turnTo = (a, b, s) => {
  const d = angDiff(a, b);
  return Math.abs(d) <= s ? b : a + Math.sign(d) * s;
};
export const lerpAng = (a, b, t) => a + angDiff(a, b) * t;
export const damp = (k, dt) => 1 - Math.exp(-k * dt);
export const rand = (a, b) => a + Math.random() * (b - a);
export const pick = arr => arr[(Math.random() * arr.length) | 0];
export const num = v => (typeof v === 'number' && isFinite(v) ? v : 0);

export function mulberry32(seed) {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function cleanName(s, max = 14) {
  return String(s || '')
    .replace(/[\u0000-\u001f\u007f-\u009f­​-‏‪-‮⁠-⁯﻿<>]/g, '')
    .trim()
    .slice(0, max);
}

export function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// --- 2B çarpışma yardımcıları (x,z düzlemi) ---

// Parça [p0,p1] ile çember kesişimi; ilk temasın t değeri (0..1) ya da -1
export function segCircle(x0, z0, x1, z1, cx, cz, r) {
  const dx = x1 - x0, dz = z1 - z0;
  const fx = x0 - cx, fz = z0 - cz;
  const c = fx * fx + fz * fz - r * r;
  if (c <= 0) return 0;
  const a = dx * dx + dz * dz;
  if (a < 1e-9) return -1;
  const b = 2 * (fx * dx + fz * dz);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : -1;
}

// Yönlendirilmiş kutu: {x,z,hw,hd,c,s} (c=cos rot, s=sin rot)
export function toLocal(b, x, z) {
  const dx = x - b.x, dz = z - b.z;
  return [dx * b.c + dz * b.s, -dx * b.s + dz * b.c];
}

export function segBox(x0, z0, x1, z1, b) {
  const [ax, az] = toLocal(b, x0, z0);
  const [bx, bz] = toLocal(b, x1, z1);
  const dx = bx - ax, dz = bz - az;
  let tmin = 0, tmax = 1;
  if (Math.abs(dx) < 1e-9) {
    if (ax < -b.hw || ax > b.hw) return -1;
  } else {
    let t1 = (-b.hw - ax) / dx, t2 = (b.hw - ax) / dx;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  if (Math.abs(dz) < 1e-9) {
    if (az < -b.hd || az > b.hd) return -1;
  } else {
    let t1 = (-b.hd - az) / dz, t2 = (b.hd - az) / dz;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  return tmin;
}

// Çemberi kutudan dışarı itmek için gereken vektör ya da null
export function circleBoxPush(x, z, r, b) {
  const [lx, lz] = toLocal(b, x, z);
  const cx = clamp(lx, -b.hw, b.hw), cz = clamp(lz, -b.hd, b.hd);
  let px = lx - cx, pz = lz - cz;
  const d2 = px * px + pz * pz;
  if (d2 >= r * r) return null;
  let ox, oz;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    const k = (r - d) / d;
    ox = px * k;
    oz = pz * k;
  } else {
    // merkez kutunun içinde: en kısa eksenden dışarı
    const ex = b.hw - Math.abs(lx), ez = b.hd - Math.abs(lz);
    if (ex < ez) {
      ox = (ex + r) * Math.sign(lx || 1);
      oz = 0;
    } else {
      ox = 0;
      oz = (ez + r) * Math.sign(lz || 1);
    }
  }
  return [ox * b.c - oz * b.s, ox * b.s + oz * b.c];
}

export function fmtTime(s) {
  s = Math.max(0, Math.ceil(s));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
