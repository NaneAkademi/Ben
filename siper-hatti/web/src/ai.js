// Bot / düşman tank yapay zekâsı (yalnız oda sahibinde çalışır).
import { angDiff, clamp, rand, segCircle } from './util.js';

const DIFF = [
  { aimErr: 0.13, react: 0.6, lead: 0.35, hesitate: 0.5 },
  { aimErr: 0.07, react: 0.38, lead: 0.75, hesitate: 0.25 },
  { aimErr: 0.035, react: 0.22, lead: 1.0, hesitate: 0.08 },
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
    this.jitterT = 0;
    this.fireHold = 0;
    this.attacker = null;
    this.wander = null;
    const s = tank.spec;
    this.pref = tank.type === 'light' ? 13 : tank.type === 'heavy' ? 24 : tank.type === 'boss' ? 22 : 19;
    this.out = { throttle: 0, steer: 0, aim: null, fire: false, he: false, boost: false };
    this.range = s.range;
  }

  onHit(by) {
    const a = this.g.tanks.get(by);
    if (a && a.alive && a.team !== this.t.team) this.attacker = a;
  }

  pickTarget() {
    const t = this.t, g = this.g;
    let best = null, bs = 1e9;
    for (const o of g.tanks.values()) {
      if (o === t || !o.alive || o.team === t.team || !o.seen) continue;
      const d = Math.hypot(o.x - t.x, o.z - t.z);
      let sc = d;
      if (!g.world.los(t.x, t.z, o.x, o.z)) sc += 22;
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
    if (this.thinkT <= 0) {
      this.thinkT = this.d.react * rand(0.8, 1.3);
      this.pickTarget();
      this.decideGoal();
    }
    this.strafeT -= dt;
    if (this.strafeT <= 0) {
      this.strafe *= -1;
      this.strafeT = rand(2, 5);
    }

    // hedefe dön
    let gx = this.goal ? this.goal.x : t.x, gz = this.goal ? this.goal.z : t.z;
    const dist = Math.hypot(gx - t.x, gz - t.z);
    let heading = Math.atan2(gz - t.z, gx - t.x);
    let throttle = 0, steer = 0;
    if (dist > 1.5) {
      // engelden kaçınma: önünü yokla, tıkalıysa alternatif yönler dene
      const look = 6 + Math.abs(t.speed) * 0.6;
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

    // sıkışma algılama
    this.checkT -= dt;
    if (this.checkT <= 0) {
      const moved = Math.hypot(t.x - this.lastX, t.z - this.lastZ);
      if (moved < 1.1 && throttle > 0.3 && this.stuckT <= 0) this.stuckT = rand(0.7, 1.2);
      this.lastX = t.x;
      this.lastZ = t.z;
      this.checkT = 1.2;
    }
    if (this.stuckT > 0) {
      this.stuckT -= dt;
      throttle = -1;
      steer = this.avoid >= 0 ? 0.8 : -0.8;
    }
    o.throttle = throttle;
    o.steer = steer;

    // nişan ve ateş
    o.fire = false;
    o.he = false;
    o.boost = false;
    const tg = this.target;
    if (tg && tg.alive) {
      this.jitterT -= dt;
      if (this.jitterT <= 0) {
        this.jitter = rand(-1, 1) * (this.d.aimErr + (this.extraErr || 0));
        this.jitterT = rand(0.4, 0.9);
      }
      const sp = t.spec.shell;
      let px = tg.x, pz = tg.z;
      for (let i = 0; i < 2; i++) {
        const tt = Math.hypot(px - t.x, pz - t.z) / sp;
        px = tg.x + tg.vx * tt * this.d.lead;
        pz = tg.z + tg.vz * tt * this.d.lead;
      }
      const aim = Math.atan2(pz - t.z, px - t.x) + this.jitter;
      o.aim = aim;
      const d = Math.hypot(tg.x - t.x, tg.z - t.z);
      if (d < this.range && Math.abs(angDiff(t.ta, aim)) < 0.12) {
        if (W.los(t.x, t.z, tg.x, tg.z) && !this.friendInPath(tg)) {
          this.fireHold += dt;
          if (this.fireHold > this.d.hesitate) o.fire = true;
        }
      } else this.fireHold = 0;
      if (t.kind === 'bot') {
        o.he = d < 30 && t.heCd <= 0 && Math.random() < 0.02;
        o.boost = t.boostCd <= 0 && (d > 30 || t.hp < 35) && Math.random() < 0.02;
      }
    } else o.aim = null;
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
    // canı azsa onarım bonusuna git (serbest botlar)
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
      const los = g.world.los(t.x, t.z, tg.x, tg.z);
      if (!los || d > this.pref + 7) this.goal = { x: tg.x - nx * this.pref * 0.6, z: tg.z - nz * this.pref * 0.6 };
      else if (d < this.pref - 7) this.goal = { x: t.x - nx * 8 - nz * this.strafe * 4, z: t.z - nz * 8 + nx * this.strafe * 4 };
      else this.goal = { x: t.x - nz * this.strafe * 9 + nx * (d - this.pref) * 0.3, z: t.z + nx * this.strafe * 9 + nz * (d - this.pref) * 0.3 };
      return;
    }
    // dolaş
    if (!this.wander || Math.hypot(this.wander.x - t.x, this.wander.z - t.z) < 4) {
      const spots = g.world.pickupSpots;
      const s = spots.length ? spots[(Math.random() * spots.length) | 0] : { x: rand(-30, 30), z: rand(-30, 30) };
      this.wander = { x: s.x + rand(-4, 4), z: s.z + rand(-4, 4) };
    }
    this.goal = this.wander;
  }
}

