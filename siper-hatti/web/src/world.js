// Harita üretimi (tohumdan, tüm oyuncularda aynı) ve çarpışma sorguları.
import { ARENA, BARREL } from './config.js';
import { TAU, mulberry32, smoothstep, segCircle, segBox, circleBoxPush, clamp } from './util.js';

export class World {
  constructor(seed, theme, mode) {
    this.seed = seed;
    this.theme = theme;
    this.mode = mode;
    const R = mulberry32(seed ^ 0x51ed270b);
    this.ph = [R() * TAU, R() * TAU, R() * TAU, R() * TAU, R() * TAU, R() * TAU];
    this.obstacles = [];
    this.barrels = [];
    this.buildings = [];
    this.spawns = [];
    this.coopSpawns = [];
    this.enemySpawns = [];
    this.pickupSpots = [];
    this.decor = []; // çarpışmasız süsler (moloz, çalı)
    generate(this, R);
  }

  // Arazi yüksekliği: arena içinde hafif dalgalı, dışarıda tepeler
  height(x, z) {
    const p = this.ph;
    let h = 0.32 * Math.sin(x * 0.085 + p[0]) * Math.cos(z * 0.071 + p[1]) +
      0.22 * Math.sin((x + z) * 0.12 + p[2]) +
      0.12 * Math.sin(x * 0.2 - z * 0.17 + p[3]);
    const d = Math.max(Math.abs(x), Math.abs(z));
    if (d > ARENA - 1) {
      const k = smoothstep(ARENA + 1, ARENA + 34, d);
      const hill = 7 + 4 * Math.sin(x * 0.05 + p[4]) * Math.cos(z * 0.043 + p[5]) + 2.5 * Math.sin((x - z) * 0.09 + p[1]);
      h += k * hill;
    }
    return h;
  }

  // Tankı engellerden ve sınırlardan dışarı it
  collide(t, r) {
    for (let pass = 0; pass < 2; pass++) {
      for (const o of this.obstacles) {
        if (!o.alive) continue;
        const dx = t.x - o.x, dz = t.z - o.z;
        const lim = o.br + r;
        if (dx * dx + dz * dz > lim * lim) continue;
        if (o.shape === 'c') {
          const d = Math.hypot(dx, dz) || 1e-4, m = o.r + r;
          if (d < m) {
            t.x = o.x + (dx / d) * m;
            t.z = o.z + (dz / d) * m;
            t.bumped = true;
          }
        } else {
          const push = circleBoxPush(t.x, t.z, r, o);
          if (push) {
            t.x += push[0];
            t.z += push[1];
            t.bumped = true;
          }
        }
      }
    }
    const lim = ARENA - r;
    if (t.x < -lim || t.x > lim || t.z < -lim || t.z > lim) {
      t.x = clamp(t.x, -lim, lim);
      t.z = clamp(t.z, -lim, lim);
      t.bumped = true;
    }
  }

  // Mermi yolu üzerindeki ilk engel
  shellHit(x0, z0, x1, z1) {
    let best = 2, hit = null;
    const minx = Math.min(x0, x1), maxx = Math.max(x0, x1), minz = Math.min(z0, z1), maxz = Math.max(z0, z1);
    for (const o of this.obstacles) {
      if (!o.alive || !o.shells) continue;
      if (o.x + o.br < minx || o.x - o.br > maxx || o.z + o.br < minz || o.z - o.br > maxz) continue;
      const t = o.shape === 'c' ? segCircle(x0, z0, x1, z1, o.x, o.z, o.r) : segBox(x0, z0, x1, z1, o);
      if (t >= 0 && t < best) {
        best = t;
        hit = o;
      }
    }
    return hit ? { t: best, o: hit } : null;
  }

  los(x0, z0, x1, z1) {
    return !this.shellHit(x0, z0, x1, z1);
  }

  // Yapay zekâ için: tank genişliğiyle şişirilmiş engellere ışın
  probe(x0, z0, x1, z1, inflate) {
    let best = 2;
    const minx = Math.min(x0, x1) - inflate, maxx = Math.max(x0, x1) + inflate;
    const minz = Math.min(z0, z1) - inflate, maxz = Math.max(z0, z1) + inflate;
    for (const o of this.obstacles) {
      if (!o.alive) continue;
      if (o.x + o.br < minx || o.x - o.br > maxx || o.z + o.br < minz || o.z - o.br > maxz) continue;
      const t = o.shape === 'c'
        ? segCircle(x0, z0, x1, z1, o.x, o.z, o.r + inflate)
        : segBox(x0, z0, x1, z1, { x: o.x, z: o.z, hw: o.hw + inflate, hd: o.hd + inflate, c: o.c, s: o.s });
      if (t >= 0 && t < best) best = t;
    }
    const lim = ARENA - inflate;
    if (Math.abs(x1) > lim || Math.abs(z1) > lim) {
      // sınıra ne kadar kala çarptığını kaba hesapla
      const tx = Math.abs(x1 - x0) > 1e-6 ? (Math.sign(x1) * lim - x0) / (x1 - x0) : 2;
      const tz = Math.abs(z1 - z0) > 1e-6 ? (Math.sign(z1) * lim - z0) / (z1 - z0) : 2;
      const tb = Math.min(tx >= 0 ? tx : 2, tz >= 0 ? tz : 2);
      if (tb < best) best = Math.max(0, tb);
    }
    return best <= 1 ? best : -1;
  }

  freeSpot(x, z, r) {
    if (Math.abs(x) > ARENA - r || Math.abs(z) > ARENA - r) return false;
    for (const o of this.obstacles) {
      if (!o.alive) continue;
      if (Math.hypot(o.x - x, o.z - z) < o.br + r) return false;
    }
    return true;
  }
}

function generate(W, R) {
  const obs = W.obstacles;
  const reserved = [];
  const coop = W.mode === 'coop';
  let oid = 0;

  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + 0.39;
    const rr = ARENA - 6.5;
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    W.spawns.push({ x, z, a: Math.atan2(-z, -x) });
    reserved.push({ x, z, r: 7 });
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4;
    W.coopSpawns.push({ x: Math.cos(a) * 4.5, z: Math.sin(a) * 4.5, a: a });
  }
  reserved.push({ x: 0, z: 0, r: coop ? 11 : 6 });
  for (let side = 0; side < 4; side++) {
    for (let k = 0; k < 5; k++) {
      const u = -ARENA + 10 + (k / 4) * (2 * ARENA - 20);
      const e = ARENA - 3;
      const p = [[u, -e], [e, u], [u, e], [-e, u]][side];
      W.enemySpawns.push({ x: p[0], z: p[1], a: Math.atan2(-p[1], -p[0]) });
      reserved.push({ x: p[0], z: p[1], r: 4 });
    }
  }

  const free = (x, z, br, gap = 4.3) => {
    if (Math.abs(x) > ARENA - br - 3 || Math.abs(z) > ARENA - br - 3) return false;
    for (const q of reserved) if (Math.hypot(q.x - x, q.z - z) < q.r + br) return false;
    for (const o of obs) if (Math.hypot(o.x - x, o.z - z) < o.br + br + gap) return false;
    return true;
  };
  const circle = (kind, x, z, r, extra = {}) => {
    const o = { id: oid++, kind, shape: 'c', x, z, r, br: r, h: r, shells: true, alive: true, rnd: R(), ...extra };
    obs.push(o);
    return o;
  };
  const box = (kind, x, z, hw, hd, rot, h, extra = {}) => {
    const o = {
      id: oid++, kind, shape: 'b', x, z, hw, hd, rot, c: Math.cos(rot), s: Math.sin(rot),
      br: Math.hypot(hw, hd), h, shells: true, alive: true, rnd: R(), ...extra,
    };
    obs.push(o);
    return o;
  };
  const rp = m => (R() * 2 - 1) * (ARENA - m);

  // Yıkık binalar
  const nb = 2 + ((R() * 2) | 0) + (coop ? 0 : 1);
  for (let i = 0, made = 0; i < 60 && made < nb; i++) {
    const w = 7 + R() * 4, d = 6 + R() * 3.5, rot = R() * Math.PI;
    const x = rp(8), z = rp(8), br = Math.hypot(w, d) / 2 + 0.6;
    if (!free(x, z, br, 5)) continue;
    made++;
    const bi = W.buildings.length;
    W.buildings.push({ x, z, w, d, rot });
    const skip = new Set([(R() * 4) | 0]);
    if (R() < 0.4) skip.add((R() * 4) | 0);
    const cr = Math.cos(rot), sr = Math.sin(rot);
    for (let s = 0; s < 4; s++) {
      if (skip.has(s)) continue;
      const along = s % 2 === 0; // 0,2: x boyunca; 1,3: z boyunca
      const L = along ? w : d;
      const off = s < 2 ? 1 : -1;
      let segs = [[-L / 2, L / 2]];
      if (R() < 0.6 && L > 6) {
        const g0 = -L / 2 + 1.3 + R() * (L - 4.1 - 2.6);
        segs = [[-L / 2, g0], [g0 + 4.1, L / 2]];
      }
      for (const [a0, a1] of segs) {
        const len = a1 - a0;
        if (len < 0.8) continue;
        const mid = (a0 + a1) / 2;
        const lx = along ? mid : (off * w) / 2, lz = along ? (off * d) / 2 : mid;
        const wx = x + lx * cr - lz * sr, wz = z + lx * sr + lz * cr;
        const h = R() < 0.35 ? 1.2 + R() * 0.9 : 2.5 + R() * 1.3;
        box('wall', wx, wz, along ? len / 2 : 0.28, along ? 0.28 : len / 2, rot, h, { bld: bi });
      }
    }
    // moloz
    for (let k = 0; k < 5; k++) W.decor.push({ kind: 'rubble', x: x + (R() - 0.5) * w * 1.3, z: z + (R() - 0.5) * d * 1.3, s: 0.3 + R() * 0.5, r: R() * TAU });
  }

  // Siper hatları (kum torbası)
  const nl = 2 + ((R() * 2) | 0);
  for (let i = 0, made = 0; i < 40 && made < nl; i++) {
    let x = rp(10), z = rp(10), a = R() * TAU;
    const segN = 2 + ((R() * 2) | 0);
    const parts = [];
    let ok = true;
    for (let s = 0; s < segN; s++) {
      const len = 6 + R() * 6;
      const cx = x + (Math.cos(a) * len) / 2, cz = z + (Math.sin(a) * len) / 2;
      if (!free(cx, cz, len / 2 + 0.6, 4.4)) {
        ok = false;
        break;
      }
      parts.push([cx, cz, len, a]);
      x += Math.cos(a) * (len + 4.6);
      z += Math.sin(a) * (len + 4.6);
      a += (R() - 0.5) * 1.1;
    }
    if (!ok || parts.length < 2) continue;
    made++;
    for (const [cx, cz, len, aa] of parts) box('sandbag', cx, cz, len / 2, 0.6, aa, 1.05);
  }

  // Kayalar
  const nr = 7 + ((R() * 5) | 0);
  for (let i = 0, made = 0; i < 90 && made < nr; i++) {
    const r = 1.3 + R() * 1.6, x = rp(6), z = rp(6);
    if (!free(x, z, r + 1.5)) continue;
    made++;
    circle('rock', x, z, r, { h: r * (0.8 + R() * 0.5) });
    const extra = (R() * 3) | 0;
    for (let k = 0; k < extra; k++) {
      const a = R() * TAU, r2 = 0.7 + R() * 0.9;
      circle('rock', x + Math.cos(a) * (r + r2 * 0.7), z + Math.sin(a) * (r + r2 * 0.7), r2, { h: r2 * (0.7 + R() * 0.5) });
    }
  }

  // Ağaçlar
  const treeKinds = W.theme.trees;
  const ng = W.theme.snow ? 9 : treeKinds[0] === 'palm' ? 5 : 8;
  for (let i = 0, made = 0; i < 90 && made < ng; i++) {
    const x = rp(6), z = rp(6);
    if (!free(x, z, 3.2)) continue;
    made++;
    const n = 1 + ((R() * 3) | 0);
    for (let k = 0; k < n; k++) {
      const a = R() * TAU, d = k ? 2.2 + R() * 0.8 : 0;
      circle('tree', x + Math.cos(a) * d, z + Math.sin(a) * d, 0.6, { variant: treeKinds[(R() * treeKinds.length) | 0], s: 0.8 + R() * 0.55, h: 6 });
    }
  }

  // Sandıklar
  const nc = 4 + ((R() * 3) | 0);
  for (let i = 0, made = 0; i < 60 && made < nc; i++) {
    const x = rp(7), z = rp(7);
    if (!free(x, z, 2)) continue;
    made++;
    const rot = R() * Math.PI;
    const n = 1 + ((R() * 2) | 0);
    for (let k = 0; k < n; k++) {
      const ox = k * 1.75 * Math.cos(rot), oz = k * 1.75 * Math.sin(rot);
      box('crate', x + ox, z + oz, 0.82, 0.82, rot + (R() - 0.5) * 0.25, 1.64, { stack: R() < 0.35 });
    }
  }

  // Patlayıcı variller
  const nbar = 5 + ((R() * 3) | 0);
  for (let i = 0, made = 0; i < 70 && made < nbar; i++) {
    const x = rp(7), z = rp(7);
    if (!free(x, z, 1.6)) continue;
    made++;
    const n = 1 + ((R() * 3) | 0);
    for (let k = 0; k < n; k++) {
      const a = R() * TAU, d = k ? 1.3 : 0;
      const o = circle('barrel', x + Math.cos(a) * d, z + Math.sin(a) * d, BARREL.r, { h: 1.25, bid: W.barrels.length });
      W.barrels.push(o);
    }
  }

  // Tank tuzakları (mermiler geçer)
  const nh = 6 + ((R() * 5) | 0);
  for (let i = 0, made = 0; i < 70 && made < nh; i++) {
    const x = rp(6), z = rp(6);
    if (!free(x, z, 1)) continue;
    made++;
    circle('hedgehog', x, z, 0.85, { shells: false, h: 1.1, rot: R() * TAU });
  }

  // Bonus noktaları
  for (let i = 0; i < 300 && W.pickupSpots.length < 12; i++) {
    const x = rp(8), z = rp(8);
    if (!W.freeSpot(x, z, 3)) continue;
    if (W.pickupSpots.some(p => Math.hypot(p.x - x, p.z - z) < 12)) continue;
    W.pickupSpots.push({ x, z });
  }

  // Çarpışmasız çalılar
  for (let i = 0; i < 60; i++) {
    const x = rp(2), z = rp(2);
    if (!W.freeSpot(x, z, 1.2)) continue;
    W.decor.push({ kind: 'bush', x, z, s: 0.5 + R() * 0.7, r: R() * TAU });
  }
}
