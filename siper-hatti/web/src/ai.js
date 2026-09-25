// Bot / düşman tank yapay zekâsı (yalnız oda sahibinde çalışır; test için oyuncuyu da sürebilir).
import { angDiff, clamp, rand, segCircle, solveElev } from './util.js';

const DIFF = [
  { aimErr: 0.03, react: 0.6, lead: 0.4, hesitate: 0.6 },
  { aimErr: 0.017, react: 0.38, lead: 0.75, hesitate: 0.3 },
  { aimErr: 0.008, react: 0.22, lead: 1.0, hesitate: 0.1 },
];

export class Brain {
  constructor(game, tank, diff = 1) {
    this.g = game;
    this.t = tank;
    this.d = DIFF[clamp(diff | 0, 0, 2)];
    this.target = null;
    this.thinkT = rand(0, 0.3);
    this.strafe = Math.random() < 0.5 ? 1 : -1;
    this.strafeT = rand(2, 5);
    this.goal = null;
    this.avoid = 0;
    this.stuckT = 0;
    this.checkT = 1.2;
    this.lastX = tank.x;
    this.lastZ = tank.z;
    this.jitter = 0;
    this.jitterE = 0;
    this.jitterT = 0;
    this.fireHold = 0;
    this.attacker = null;
    this.hitT = 0;
    this.wander = null;
    this.extraErr = 0;
    const ty = tank.type;
    this.pref = ty === 'light' || ty === 'elight' ? 16 : ty === 'heavy' || ty === 'eheavy' ? 28 : ty === 'boss' ? 26 : 22;
    this.out = { throttle: 0, steer: 0, aim: null, elev: 0, fire: false, smoke: false };
  }

  onHit(by) {
    const a = this.g.tanks.get(by);
    this.hitT = 3;
    if (a && a.alive && a.team !== this.t.team) this.attacker = a;
  }

  visible(o) {
    const t = this.t, g = this.g;
    return g.world.los(t.x, t.z, o.x, o.z, 1.8) && !g.smokeBlocks(t.x, t.z, o.x, o.z);
  }

  pickTarget() {
    const t = this.t, g = this.g;
    let best = null, bs = 1e9;
    for (const o of g.tanks.values()) {
      if (o === t || !o.alive || o.team === t.team || !o.seen) continue;
      const d = Math.hypot(o.x - t.x, o.z - t.z);
      let sc = d;
      if (!this.visible(o)) sc += 30;
      if (o === this.target) sc *= 0.7;
      if (o === this.attacker) sc *= 0.6;
      if (o.kind === 'player') sc *= 0.92;
      if (sc < bs) {
        bs = sc;
        best = o;
      }
    }
    this.target = best;
    this.attacker = null;
  }

  update(dt) {
    const t = this.t, g = this.g, o = this.out, W = g.world;
    this.thinkT -= dt;
    this.hitT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = this.d.react * rand(0.8, 1.3);
      this.pickTarget();
      this.decideGoal();
    }
    this.strafeT -= dt;
    if (this.strafeT <= 0) {
      this.strafe *= -1;
      this.strafeT = rand(2.5, 6);
    }

    // hedefe sür, engellerden kaçın
    const gx = this.goal ? this.goal.x : t.x, gz = this.goal ? this.goal.z : t.z;
    const dist = Math.hypot(gx - t.x, gz - t.z);
    let heading = Math.atan2(gz - t.z, gx - t.x);
    let throttle = 0, steer = 0;
    if (dist > 1.5) {
      const look = 6 + Math.abs(t.speed) * 0.7;
      const free = h => W.probe(t.x, t.z, t.x + Math.cos(h) * look, t.z + Math.sin(h) * look, t.r * 0.85) < 0;
      if (!free(heading)) {
        let found = false;
        for (let k = 1; k <= 7 && !found; k++) {
          for (const sgn of this.avoid >= 0 ? [1, -1] : [-1, 1]) {
            const h = heading + sgn * k * 0.38;
            if (free(h)) {
              heading = h;
              this.avoid = sgn;
              found = true;
              break;
            }
          }
        }
      }
      const da = angDiff(t.a, heading);
      steer = clamp(da * 2.4, -1, 1);
      throttle = Math.abs(da) > 1.3 ? 0.12 : clamp(Math.cos(da) * 1.15, 0.2, 1);
      if (dist < 4) throttle *= dist / 4;
    }
    this.checkT -= dt;
    if (this.checkT <= 0) {
      const moved = Math.hypot(t.x - this.lastX, t.z - this.lastZ);
      if (moved < 1.1 && throttle > 0.3 && this.stuckT <= 0) this.stuckT = rand(0.7, 1.3);
      this.lastX = t.x;
      this.lastZ = t.z;
      this.checkT = 1.2;
    }
    if (this.stuckT > 0) {
      this.stuckT -= dt;
      throttle = -1;
      steer = this.avoid >= 0 ? 0.8 : -0.8;
    }

    // nişan: öncülü hesapla, namlu açısını balistikle bul, taret hizalanınca ateş et
    o.fire = false;
    o.smoke = false;
    const tg = this.target;
    const s = t.spec;
    if (tg && tg.alive) {
      this.jitterT -= dt;
      if (this.jitterT <= 0) {
        const e = this.d.aimErr + this.extraErr;
        this.jitter = rand(-1, 1) * e;
        this.jitterE = rand(-1, 1) * e * 0.5;
        this.jitterT = rand(0.5, 1.1);
      }
      let px = tg.x, pz = tg.z;
      for (let i = 0; i < 2; i++) {
        const tt = Math.hypot(px - t.x, pz - t.z) / s.shell;
        px = tg.x + tg.vx * tt * this.d.lead;
        pz = tg.z + tg.vz * tt * this.d.lead;
      }
      const aim = Math.atan2(pz - t.z, px - t.x) + this.jitter;
      const d = Math.hypot(px - t.x, pz - t.z);
      const elev = solveElev(d - (t.pivotX || 1), tg.baseY + tg.hh * 0.45 - (t.baseY + (t.gunH || 1.3)), s.shell) + this.jitterE;
      o.aim = aim;
      o.elev = elev;
      const dd = Math.hypot(tg.x - t.x, tg.z - t.z);
      const vis = this.visible(tg);
      // menzildeyse yavaşla ve nişan topla
      if (dd < this.pref + 4 && vis && t.reload < 0.8) throttle *= 0.35;
      if (dd < s.range && Math.abs(angDiff(t.ta, aim)) < 0.03 + t.disp && Math.abs(t.elev - elev) < 0.03) {
        if (vis && !this.friendInPath(tg)) {
          this.fireHold += dt;
          if (this.fireHold > this.d.hesitate) o.fire = true;
        }
      } else this.fireHold = Math.max(0, this.fireHold - dt);
      if (t.kind === 'bot' && this.hitT > 0 && t.hp < t.maxHp * 0.45 && Math.random() < 0.02) o.smoke = true;
    } else {
      o.aim = null;
      o.elev = 0;
    }
    o.throttle = throttle;
    o.steer = steer;
    return o;
  }

  friendInPath(tg) {
    const t = this.t;
    for (const f of this.g.tanks.values()) {
      if (f === t || f === tg || !f.alive || f.team !== t.team) continue;
      if (segCircle(t.x, t.z, tg.x, tg.z, f.x, f.z, f.r + 0.4) >= 0) return true;
    }
    return false;
  }

  decideGoal() {
    const t = this.t, g = this.g, tg = this.target;
    if (t.kind === 'bot' && t.hp < t.maxHp * 0.4) {
      let best = null, bd = 40;
      for (const p of g.pickups.values()) {
        if (p.type !== 'repair') continue;
        const d = Math.hypot(p.x - t.x, p.z - t.z);
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
      if (best) {
        this.goal = { x: best.x, z: best.z };
        return;
      }
    }
    if (tg) {
      const dx = tg.x - t.x, dz = tg.z - t.z, d = Math.hypot(dx, dz) || 1;
      const nx = dx / d, nz = dz / d;
      if (!this.visible(tg) || d > this.pref + 8) this.goal = { x: tg.x - nx * this.pref * 0.6, z: tg.z - nz * this.pref * 0.6 };
      else if (d < this.pref - 8) this.goal = { x: t.x - nx * 8 - nz * this.strafe * 4, z: t.z - nz * 8 + nx * this.strafe * 4 };
      else this.goal = { x: t.x - nz * this.strafe * 9 + nx * (d - this.pref) * 0.3, z: t.z + nx * this.strafe * 9 + nz * (d - this.pref) * 0.3 };
      return;
    }
    if (!this.wander || Math.hypot(this.wander.x - t.x, this.wander.z - t.z) < 4) {
      const spots = g.world.pickupSpots;
      const s = spots.length ? spots[(Math.random() * spots.length) | 0] : { x: rand(-30, 30), z: rand(-30, 30) };
      this.wander = { x: s.x + rand(-4, 4), z: s.z + rand(-4, 4) };
    }
    this.goal = this.wander;
  }
}
