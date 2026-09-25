// Maç mantığı: tanklar, mermiler, bonuslar, dalgalar, puanlar ve ağ senkronizasyonu.
//
// Yetki kuralları (herkesin ekranı tutarlı kalsın diye):
//  - Her oyuncu kendi tankını yönetir ve KENDİSİNE gelen vuruşlara kendisi karar verir.
//  - Botlara isabet eden oyuncu mermisine atan oyuncu karar verir; bot mermileri oda sahibinde.
//  - Botlar, bonuslar, variller, dalgalar ve skor oda sahibinin (host) cihazında yönetilir.
import * as THREE from 'three';
import {
  TYPES, TYPE_LIST, ABILITY, PICKUPS, PICKUP_LIST, BARREL, INTERP_DELAY, SNAP_HZ,
  ENEMY_COLORS, THEMES, ARENA,
} from './config.js';
import { World } from './world.js';
import { TankView } from './tankModel.js';
import { Brain } from './ai.js';
import { sfx } from './audio.js';
import { clamp, lerp, angDiff, turnTo, lerpAng, damp, rand, segCircle, num, TAU } from './util.js';

const TV1 = new THREE.Vector3(), TV2 = new THREE.Vector3();
const q2 = v => Math.round(v * 100);
const q3 = v => Math.round(v * 1000);
const DIFF = [
  { hp: 0.8, dmg: 0.7 },
  { hp: 1, dmg: 1 },
  { hp: 1.25, dmg: 1.25 },
];

class Tank {
  constructor(game, o) {
    this.id = o.id;
    this.kind = o.kind; // player | bot | enemy
    this.type = o.type;
    this.spec = TYPES[o.type];
    this.name = o.name;
    this.color = o.color;
    this.team = o.team;
    this.local = !!o.local;
    this.maxHp = Math.round(this.spec.hp * (o.hpMul || 1));
    this.hp = this.maxHp;
    this.dmgMul = o.dmgMul || 1;
    this.alive = false;
    this.seen = false;
    this.x = 0;
    this.z = 0;
    this.a = 0;
    this.ta = 0;
    this.speed = 0;
    this.vx = 0;
    this.vz = 0;
    this.reload = 0;
    this.heCd = 0;
    this.boostCd = 0;
    this.boostT = 0;
    this.shieldT = 0;
    this.rapidT = 0;
    this.protT = 0;
    this.respawnT = 0;
    this.deadT = 99;
    this.seq = 0;
    this.buf = [];
    this.flags = 0;
    this.trackD = 0;
    this.dustT = 0;
    this.exT = rand(0, 0.3);
    this.fireT = 0;
    this.lo = 1;
    this.view = new TankView(game.stage, o.type, this.spec.model, o.color, this.spec.scale);
    this.view.root.visible = false;
  }
  get r() {
    return this.spec.r;
  }
}

export class Game {
  constructor(app, session, start) {
    this.app = app;
    this.session = session;
    this.stage = app.stage;
    this.fx = app.fx;
    this.ui = app.ui;
    this.isHost = session.isHost;
    this.myId = session.myId;
    this.cfg = start.cfg;
    this.mode = start.cfg.mode;
    this.theme = THEMES[start.cfg.theme] || THEMES.meadow;
    this.diff = DIFF[clamp(start.cfg.diff ?? 1, 0, 2)];
    this.world = new World(start.seed, this.theme, this.mode);
    this.stage.buildWorld(this.world);
    this.fx.clear();
    this.fx.setTheme(this.theme);

    this.tanks = new Map();
    this.shells = [];
    this.pickups = new Map();
    this.scores = new Map();
    this.ended = new Map(); // bitmiş mermiler (efekt tekrarı olmasın)
    this.directHits = new Set();
    this.time = 0;
    this.sendT = 0;
    this.snapT = 0;
    this.clockOffset = null;
    this.over = false;
    this.wave = 0;
    this.enemiesLeft = 0;
    this.timeLeft = (start.cfg.time || 0) * 60;
    this.shake = 0;
    this.cam = { yaw: 0, pos: new THREE.Vector3(), look: new THREE.Vector3(), init: false, fov: 0 };
    this.botInfo = new Map((start.bots || []).map(b => [b.id, b]));

    for (const p of start.players) this.addPlayer(p);
    this.me = this.tanks.get(this.myId);
    for (const b of start.bots || []) this.addBot(b);

    if (start.sync) {
      for (const b of start.sync.bar || []) this.barrelGone(b, null, false);
      this.wave = start.sync.wave || 0;
    }

    if (this.isHost) this.hostInit();
    const spawn = start.spawns && start.spawns[this.myId];
    this.spawnMe(spawn);
    this.ui.startHud(this);
    sfx.engineStart();
    if (this.mode === 'coop') this.ui.banner(this.wave ? 'Dalga ' + this.wave : 'Hazırlan!', 'Düşman dalgalarına karşı dayan', 2.2);
    else this.ui.banner('Ölüm Maçı', `${this.cfg.limit} vuruşa ilk ulaşan kazanır`, 2.2);
  }

  // ---------- oyuncu / bot kayıtları ----------
  addPlayer(p) {
    if (this.tanks.has(p.id)) return this.tanks.get(p.id);
    const t = new Tank(this, {
      id: p.id, kind: 'player', type: 'player', name: p.name, color: p.color,
      team: this.mode === 'coop' ? 1 : p.id, local: p.id === this.myId,
    });
    this.tanks.set(p.id, t);
    if (!this.scores.has(p.id)) this.scores.set(p.id, { k: 0, d: 0, s: 0 });
    return t;
  }

  addBot(b) {
    if (this.tanks.has(b.id)) return this.tanks.get(b.id);
    const t = new Tank(this, {
      id: b.id, kind: 'bot', type: 'bot', name: b.name, color: b.color, team: b.id, local: this.isHost,
      hpMul: 1, dmgMul: 1,
    });
    this.tanks.set(b.id, t);
    if (!this.scores.has(b.id)) this.scores.set(b.id, { k: 0, d: 0, s: 0 });
    if (this.isHost) {
      t.brain = new Brain(this, t, this.cfg.diff);
      this.placeAtSpawn(t, this.bestSpawn(t));
      t.protT = 1.5;
    }
    return t;
  }

  addEnemy(id, type) {
    const np = this.playerCount();
    const t = new Tank(this, {
      id, kind: 'enemy', type, name: { light: 'Hafif', medium: 'Orta', heavy: 'Ağır', boss: 'KOMUTAN' }[type],
      color: ENEMY_COLORS[type], team: 2, local: this.isHost,
      hpMul: this.diff.hp * (1 + 0.28 * (np - 1)), dmgMul: this.diff.dmg,
    });
    this.tanks.set(id, t);
    if (this.isHost) {
      t.brain = new Brain(this, t, this.cfg.diff);
      // ilk dalgalarda düşmanlar daha az isabetli
      t.brain.extraErr = Math.max(0, 0.06 - this.wave * 0.012);
    }
    return t;
  }

  removeTank(id) {
    const t = this.tanks.get(id);
    if (!t) return;
    t.view.dispose();
    this.tanks.delete(id);
  }

  setRoster(players) {
    const ids = new Set(players.map(p => p.id));
    for (const p of players) {
      const t = this.addPlayer(p);
      t.name = p.name;
    }
    for (const t of [...this.tanks.values()]) if (t.kind === 'player' && !ids.has(t.id) && t.id !== this.myId) {
      this.ui.feedText(`${t.name} oyundan ayrıldı`);
      this.removeTank(t.id);
    }
  }

  playerCount() {
    let n = 0;
    for (const t of this.tanks.values()) if (t.kind === 'player') n++;
    return Math.max(1, n);
  }

  placeAtSpawn(t, s) {
    t.x = s.x;
    t.z = s.z;
    t.a = s.a;
    t.ta = s.a;
    t.speed = 0;
    t.vx = t.vz = 0;
    t.hp = t.maxHp;
    t.alive = true;
    t.seen = true;
    t.deadT = 99;
    t.reload = 0.5;
    t.buf = [];
    t.view.revive();
    t.view.root.visible = true;
    t.view.lastA = null;
    this.fx.spawnFx(s.x, this.world.height(s.x, s.z), s.z, t.color);
  }

  bestSpawn(t) {
    let best = this.world.spawns[0], bs = -1;
    for (const s of this.world.spawns) {
      let d = 200;
      for (const o of this.tanks.values()) if (o !== t && o.alive && o.seen) d = Math.min(d, Math.hypot(o.x - s.x, o.z - s.z));
      d += Math.random() * 10;
      if (d > bs) {
        bs = d;
        best = s;
      }
    }
    return best;
  }

  spawnMe(idx) {
    const m = this.me;
    if (!m) return;
    let s;
    if (this.mode === 'coop') {
      const ids = [...this.tanks.values()].filter(t => t.kind === 'player').map(t => t.id).sort((a, b) => a - b);
      s = this.world.coopSpawns[Math.max(0, ids.indexOf(this.myId)) % 4];
    } else s = idx != null ? this.world.spawns[idx % this.world.spawns.length] : this.bestSpawn(m);
    this.placeAtSpawn(m, s);
    m.protT = this.mode === 'dm' ? 2.5 : 1.5;
    m.shieldT = m.rapidT = m.boostT = 0;
    m.heCd = 2;
    this.cam.init = false;
    this.ui.dead(false);
    this.sendState(true);
  }

  // ---------- ağ yardımcıları ----------
  emit(m) {
    if (this.isHost) this.session.broadcast(m);
    else this.session.send(m);
  }

  isAuthForShell(s) {
    const o = this.tanks.get(s.owner);
    if (o && o.kind === 'player') return s.owner === this.myId;
    return this.isHost;
  }

  hostile(a, b) {
    return a.team !== b.team;
  }

  // ---------- ana döngü ----------
  update(dt) {
    this.time += dt;
    const inp = this.app.input.state();
    this.updateMe(dt, inp);
    if (this.isHost) this.hostUpdate(dt);
    this.updateRemotes(dt);
    this.updateShells(dt);
    this.updatePickups(dt);
    this.updateVisuals(dt);
    this.sendT += dt;
    if (!this.isHost && this.sendT >= 1 / SNAP_HZ) {
      this.sendT = 0;
      this.sendState();
    }
    this.updateCamera(dt);
    this.ui.hudTick(this, dt);
    for (const [k, t] of this.ended) if (this.time - t > 6) this.ended.delete(k);
    if (this.directHits.size > 200) this.directHits.clear();
  }

  sendState(force) {
    if (this.isHost || !this.me) return;
    const m = this.me;
    this.session.send({ t: 'st', s: [q2(m.x), q2(m.z), q3(m.a), q3(m.ta), Math.max(0, Math.round(m.hp)), this.flagsOf(m)] });
  }

  flagsOf(t) {
    return (t.alive ? 1 : 0) | (t.shieldT > 0 ? 2 : 0) | (t.boostT > 0 ? 4 : 0) | (t.rapidT > 0 ? 8 : 0) | (t.protT > 0 ? 16 : 0);
  }

  timers(t, dt) {
    t.reload -= dt;
    t.heCd -= dt;
    t.boostCd -= dt;
    t.boostT -= dt;
    t.shieldT -= dt;
    t.rapidT -= dt;
    t.protT -= dt;
  }

  updateMe(dt, inp) {
    const m = this.me;
    if (!m) return;
    this.timers(m, dt);
    if (!m.alive) {
      m.deadT += dt;
      if (this.mode === 'dm' && !this.over) {
        m.respawnT -= dt;
        this.ui.dead(true, Math.ceil(m.respawnT));
        if (m.respawnT <= 0) this.spawnMe();
      }
      sfx.engineSet(0, false);
      return;
    }
    if (this.app.autoplay) {
      // test/demo: oyuncuyu yapay zekâ sürer (?autoplay=1)
      if (!this.autoBrain) this.autoBrain = new Brain(this, m, 2);
      const c = this.autoBrain.update(dt);
      inp = { throttle: c.throttle, steer: c.steer, fire: c.fire, he: Math.random() < 0.01, boost: Math.random() < 0.005 };
    }
    if (this.over) inp = { throttle: 0, steer: 0, fire: false, he: false, boost: false };
    this.drive(m, inp.throttle, inp.steer, dt);
    const tg = this.pickTarget(m);
    m.target = tg;
    const aim = tg ? this.leadAim(m, tg) : m.a;
    m.ta = turnTo(m.ta, aim, m.spec.turret * dt);
    if (inp.fire && m.reload <= 0) this.fire(m, false);
    if (inp.he && m.heCd <= 0) {
      this.fire(m, true);
      m.heCd = ABILITY.heCooldown;
    }
    if (inp.boost && m.boostCd <= 0) {
      m.boostT = ABILITY.boostTime;
      m.boostCd = ABILITY.boostCooldown;
      sfx.boost();
    }
    for (const p of this.pickups.values()) {
      if (p.claimed) continue;
      if (Math.hypot(p.x - m.x, p.z - m.z) < m.r + 1.4) {
        p.claimed = true;
        if (this.isHost) this.hostPick(this.myId, p.id);
        else this.session.send({ t: 'pick', id: p.id });
      }
    }
    sfx.engineSet(Math.abs(m.speed) / m.spec.speed, true);
  }

  drive(t, thr, st, dt) {
    const s = t.spec, boost = t.boostT > 0 ? ABILITY.boostMul : 1;
    thr = clamp(thr, -1, 1);
    st = clamp(st, -1, 1);
    const target = thr >= 0 ? thr * s.speed * boost : thr * s.rev;
    const accel = Math.abs(target) > Math.abs(t.speed) && (t.speed === 0 || Math.sign(target) === Math.sign(t.speed)) ? 10 * boost : 22;
    t.speed += clamp(target - t.speed, -accel * dt, accel * dt);
    const rev = t.speed < -0.4 || thr < -0.25;
    t.a += (rev ? -st : st) * s.turn * dt * (1 - 0.25 * Math.min(1, Math.abs(t.speed) / s.speed));
    if (t.a > Math.PI) t.a -= TAU;
    else if (t.a < -Math.PI) t.a += TAU;
    const px = t.x, pz = t.z;
    t.x += Math.cos(t.a) * t.speed * dt;
    t.z += Math.sin(t.a) * t.speed * dt;
    t.bumped = false;
    this.world.collide(t, t.r * 0.88);
    for (const o of this.tanks.values()) {
      if (o === t || !o.alive || !o.seen) continue;
      const dx = t.x - o.x, dz = t.z - o.z, mm = (t.r + o.r) * 0.82, d2 = dx * dx + dz * dz;
      if (d2 < mm * mm) {
        const d = Math.sqrt(d2) || 0.01, k = (mm - d) / d;
        if (o.local && o !== this.me) {
          t.x += dx * k * 0.5;
          t.z += dz * k * 0.5;
          o.x -= dx * k * 0.5;
          o.z -= dz * k * 0.5;
        } else {
          t.x += dx * k;
          t.z += dz * k;
        }
        t.bumped = true;
      }
    }
    this.world.collide(t, t.r * 0.88);
    if (t.bumped) t.speed *= Math.pow(0.1, dt);
    const k = damp(10, dt);
    t.vx = lerp(t.vx, (t.x - px) / Math.max(dt, 1e-3), k);
    t.vz = lerp(t.vz, (t.z - pz) / Math.max(dt, 1e-3), k);
  }

  pickTarget(m) {
    let best = null, bs = 1e9;
    const yaw = this.cam.yaw;
    for (const o of this.tanks.values()) {
      if (o === m || !o.alive || !o.seen || !this.hostile(m, o)) continue;
      const dx = o.x - m.x, dz = o.z - m.z, d = Math.hypot(dx, dz);
      if (d > m.spec.range) continue;
      const off = Math.abs(angDiff(yaw, Math.atan2(dz, dx)));
      let sc = d * (1 + off * 0.9);
      if (!this.world.los(m.x, m.z, o.x, o.z)) sc += 30;
      if (o === m.target) sc *= 0.75;
      if (sc < bs) {
        bs = sc;
        best = o;
      }
    }
    return best;
  }

  leadAim(m, o) {
    let tx = o.x, tz = o.z;
    for (let i = 0; i < 2; i++) {
      const tt = Math.hypot(tx - m.x, tz - m.z) / m.spec.shell;
      tx = o.x + o.vx * tt;
      tz = o.z + o.vz * tt;
    }
    return Math.atan2(tz - m.z, tx - m.x);
  }

  // ---------- ateş ve mermiler ----------
  fire(t, he) {
    t.reload = t.spec.reload * (t.rapidT > 0 ? 0.5 : 1);
    const n = ++t.seq;
    let lo = 0;
    if (t.type === 'boss') {
      t.lo = -t.lo;
      lo = t.lo * 0.29 * t.spec.scale;
    }
    const msg = { t: 'fire', o: t.id, n, x: q2(t.x), z: q2(t.z), a: q3(t.ta), he: he ? 1 : 0, lo: q2(lo) };
    this.spawnShell(msg);
    this.emit(msg);
  }

  spawnShell(m) {
    const t = this.tanks.get(m.o);
    const x = num(m.x) / 100, z = num(m.z) / 100, a = num(m.a) / 1000, lo = num(m.lo) / 100;
    const spec = t ? t.spec : TYPES.player;
    const md = t ? t.view.muzzleDist : 3.6;
    const c = Math.cos(a), s = Math.sin(a);
    const he = !!m.he || (t && t.type === 'boss');
    const speed = spec.shell * (m.he ? 0.85 : 1);
    const sx = x + c * md - s * lo, sz = z + s * md + c * lo;
    const hy = t ? (t.view.g.turretPos.y + t.view.g.barrelPos.y) * t.spec.scale : 1.35;
    const shell = {
      key: m.o + ':' + m.n, owner: m.o, team: t ? t.team : -1,
      x: x - s * lo, z: z + c * lo, pre: md, vx: c * speed, vz: s * speed, dist: 0, max: spec.range,
      dmg: m.he ? ABILITY.heDamage : spec.dmg * (t ? t.dmgMul : 1), he, heavy: he || spec.dmg > 20, enemy: t && t.kind === 'enemy',
      hy, y: 0,
    };
    this.shells.push(shell);
    const gy = this.world.height(sx, sz) + hy;
    this.fx.muzzle(sx, gy, sz, c, s, shell.heavy);
    const mine = m.o === this.myId;
    sfx.shot(sx, sz, shell.heavy, mine);
    if (t) {
      t.view.kick();
      if (t.alive && !t.seen) t.seen = true;
    }
    if (mine) {
      this.shake = Math.max(this.shake, m.he ? 0.35 : 0.18);
      this.app.vibrate(m.he ? 35 : 18);
    }
  }

  updateShells(dt) {
    const W = this.world;
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      let step = Math.hypot(s.vx, s.vz) * dt;
      let dx = s.vx * dt, dz = s.vz * dt;
      if (s.pre) {
        const k = (s.pre + step) / step;
        dx *= k;
        dz *= k;
        step += s.pre;
        s.pre = 0;
      }
      let end = false;
      if (s.dist + step >= s.max) {
        const k = Math.max(0, (s.max - s.dist) / step);
        dx *= k;
        dz *= k;
        step *= k;
        end = true;
      }
      const x1 = s.x + dx, z1 = s.z + dz;
      let bt = 2, hitT = null, hitO = null;
      const oh = W.shellHit(s.x, s.z, x1, z1);
      if (oh) {
        bt = oh.t;
        hitO = oh.o;
      }
      for (const t of this.tanks.values()) {
        if (!t.alive || !t.seen || t.id === s.owner || t.team === s.team) continue;
        const tt = segCircle(s.x, s.z, x1, z1, t.x, t.z, t.r * 0.95);
        if (tt >= 0 && tt < bt) {
          bt = tt;
          hitT = t;
          hitO = null;
        }
      }
      if (bt <= 1) {
        this.shellImpact(s, s.x + dx * bt, s.z + dz * bt, hitT, hitO);
        this.shells.splice(i, 1);
        continue;
      }
      s.x = x1;
      s.z = z1;
      s.dist += step;
      s.y = W.height(s.x, s.z) + s.hy - (s.dist / s.max) * 0.5;
      if (end) {
        this.shellImpact(s, s.x, s.z, null, null);
        this.shells.splice(i, 1);
      }
    }
    this.fx.drawShells(this.shells, true);
  }

  shellImpact(s, x, z, tank, obs) {
    const y = this.world.height(x, z) + Math.min(s.hy, 1.3);
    this.ended.set(s.key, this.time);
    const auth = this.isAuthForShell(s);
    if (tank) {
      this.fx.impact(x, y, z, 'metal');
      sfx.hit(x, z, tank.id === this.myId);
      tank.view.hit();
      const decides = tank.kind === 'player' ? tank.id === this.myId : auth;
      if (decides) this.applyHit(tank, s, x, z);
    } else {
      const kind = obs ? (obs.kind === 'rock' ? 'rock' : obs.kind === 'wall' || obs.kind === 'crate' ? 'wall' : obs.kind === 'barrel' ? 'metal' : 'ground') : 'ground';
      this.fx.impact(x, obs ? y : this.world.height(x, z) + 0.2, z, kind);
      sfx.thud(x, z);
      if (!obs) this.stage.scorch(x, z, 0.7);
      if (obs && obs.kind === 'barrel' && auth) {
        if (this.isHost) this.hostBarrel(obs.bid, s.owner);
        else this.session.send({ t: 'barrel', b: obs.bid, by: s.owner });
      }
    }
    if (s.he) {
      this.fx.explosion(x, this.world.height(x, z), z, 0.6);
      sfx.explosion(x, z, false);
      this.stage.scorch(x, z, 1.8);
      if (auth) {
        const m = { t: 'ex', x: q2(x), z: q2(z), by: s.owner, k: s.key };
        this.onExplosion(m);
        this.emit(m);
      }
    }
  }

  applyHit(tank, s, x, z) {
    const m = { t: 'hit', v: tank.id, by: s.owner, d: Math.round(s.dmg), x: q2(x), z: q2(z), k: s.key };
    if (tank.kind === 'player') {
      this.directHits.add(s.key);
      this.damageMe(s.dmg, s.owner, x, z);
      this.emit(m);
    } else {
      if (s.owner === this.myId) {
        this.ui.hitMarker();
        sfx.hitMarker();
      }
      if (this.isHost) {
        this.damageBot(tank, s.dmg, s.owner);
        this.session.broadcast(m);
      } else this.session.send(m);
    }
  }

  damageMe(d, by, x, z) {
    const m = this.me;
    if (!m || !m.alive || m.protT > 0 || this.over) return;
    const dmg = d * (m.shieldT > 0 ? 0.5 : 1);
    m.hp -= dmg;
    m.view.hit();
    if (x != null) this.ui.damageDir(angDiff(this.cam.yaw, Math.atan2(z - m.z, x - m.x)));
    this.shake = Math.max(this.shake, 0.45);
    this.app.vibrate(45);
    if (m.hp <= 0) this.killMe(by);
    else this.sendState(true);
  }

  killMe(by) {
    const m = this.me;
    m.alive = false;
    m.hp = 0;
    m.respawnT = 3.5;
    m.deadT = 0;
    this.tankDeathFx(m);
    this.shake = 1;
    this.app.vibrate(220);
    const k = this.tanks.get(by);
    this.ui.banner('Vuruldun!', k ? `${k.name} seni vurdu` : '', 2);
    if (this.mode === 'coop') this.ui.dead(true, null, 'Sonraki dalgada geri döneceksin');
    else this.ui.dead(true, 4);
    if (this.isHost) this.hostRecordDeath(this.myId, by);
    else {
      this.sendState(true);
      this.session.send({ t: 'die', v: this.myId, by });
    }
  }

  damageBot(t, d, by) {
    if (!t.alive || t.protT > 0) return;
    t.hp -= d * (t.shieldT > 0 ? 0.5 : 1);
    if (t.brain) t.brain.onHit(by);
    if (t.hp <= 0) {
      t.hp = 0;
      t.alive = false;
      t.deadT = 0;
      t.respawnT = 3.5;
      this.tankDeathFx(t);
      this.hostRecordDeath(t.id, by);
    }
  }

  tankDeathFx(t) {
    const y = this.world.height(t.x, t.z);
    const size = t.type === 'boss' ? 1.9 : t.type === 'heavy' ? 1.35 : 1.1;
    this.fx.explosion(t.x, y, t.z, size);
    sfx.explosion(t.x, t.z, true);
    this.stage.scorch(t.x, t.z, 2.6 * t.spec.scale);
    t.view.die();
    t.deadT = 0;
    const d = Math.hypot(t.x - this.cam.pos.x, t.z - this.cam.pos.z);
    this.shake = Math.max(this.shake, clamp(1 - d / 45, 0, 0.8));
  }

  onExplosion(m) {
    const x = num(m.x) / 100, z = num(m.z) / 100;
    if (!this.ended.has(m.k)) {
      this.ended.set(m.k, this.time);
      this.removeShell(m.k);
      this.fx.explosion(x, this.world.height(x, z), z, 0.6);
      sfx.explosion(x, z, false);
      this.stage.scorch(x, z, 1.8);
    }
    this.splash(x, z, ABILITY.heSplash, ABILITY.heSplashDmg, m.by, m.k);
  }

  // alan hasarı: herkes kendi tankına, oda sahibi botlara uygular
  splash(x, z, R, dmg, by, key) {
    const att = this.tanks.get(by);
    const me = this.me;
    if (me && me.alive && by !== this.myId && !(key && this.directHits.has(key)) && (!att || this.hostile(att, me))) {
      const d = Math.hypot(me.x - x, me.z - z) - me.r * 0.6;
      if (d < R) this.damageMe(dmg * (1 - Math.max(0, d) / R), by, x, z);
    }
    if (this.isHost) {
      for (const t of this.tanks.values()) {
        if (t.kind === 'player' || !t.alive) continue;
        if (att && !this.hostile(att, t) && t.id !== by) continue;
        if (t.id === by) continue;
        const d = Math.hypot(t.x - x, t.z - z) - t.r * 0.6;
        if (d < R) this.damageBot(t, dmg * (1 - Math.max(0, d) / R), by);
      }
    }
  }

  removeShell(key) {
    const i = this.shells.findIndex(s => s.key === key);
    if (i >= 0) {
      this.shells.splice(i, 1);
      return true;
    }
    return false;
  }

  // ---------- gelen olaylar (herkes) ----------
  onMsg(m) {
    switch (m.t) {
      case 'snap':
        if (!this.isHost) this.applySnap(m);
        break;
      case 'fire':
        if (m.o !== this.myId) this.spawnShell(m);
        break;
      case 'hit': {
        const x = num(m.x) / 100, z = num(m.z) / 100;
        const v = this.tanks.get(m.v);
        if (!this.ended.has(m.k)) {
          this.ended.set(m.k, this.time);
          if (this.removeShell(m.k)) {
            const y = this.world.height(x, z) + 1.2;
            this.fx.impact(x, y, z, 'metal');
            sfx.hit(x, z, false);
          }
        }
        if (v) v.view.hit();
        if (m.by === this.myId && m.v !== this.myId) {
          this.ui.hitMarker();
          sfx.hitMarker();
        }
        if (this.isHost && v && v.kind !== 'player') this.damageBot(v, num(m.d), m.by);
        break;
      }
      case 'kill':
        this.onKill(m.v, m.by);
        break;
      case 'pk':
        this.onPickupTaken(m.id, m.by);
        break;
      case 'boom':
        this.barrelGone(m.b, m.by, true);
        break;
      case 'ex':
        this.onExplosion(m);
        break;
      case 'wave':
        this.onWave(m.n, m.boss);
        break;
      case 'end':
        this.finish(m.r);
        break;
      case 'roster':
        this.setRoster(m.players);
        break;
      case 'sc':
        this.applyScores(m.sc);
        break;
    }
  }

  onKill(v, by) {
    const vt = this.tanks.get(v), kt = this.tanks.get(by);
    if (vt && v !== this.myId && !vt.view.dead) {
      vt.alive = false;
      vt.hp = 0;
      this.tankDeathFx(vt);
    }
    if (vt) this.ui.feed(kt, vt);
    if (by === this.myId && v !== this.myId && vt) {
      const pts = vt.kind === 'enemy' ? TYPES[vt.type].score : 100;
      this.ui.popup(vt.kind === 'enemy' ? `+${pts}` : 'VURUŞ! +1');
    }
  }

  // ---------- oda sahibi (host) ----------
  hostInit() {
    this.nextEnemy = 1000;
    this.nextPickup = 1;
    this.pickupT = 6;
    this.waveState = { queue: [], spawnT: 0, breakT: this.wave ? 0 : 3, active: false };
    this.scoreDirty = true;
    this.snapCount = 0;
  }

  onHostMsg(from, m) {
    const t = this.tanks.get(from);
    switch (m.t) {
      case 'st':
        if (t) this.recvState(t, m.s);
        break;
      case 'fire':
        if (m.o !== from) return;
        this.onMsg(m);
        this.session.broadcast(m, from);
        break;
      case 'hit':
        if (m.by !== from && m.v !== from) return;
        this.onMsg(m);
        this.session.broadcast(m, from);
        break;
      case 'ex':
        if (m.by !== from) return;
        this.onMsg(m);
        this.session.broadcast(m, from);
        break;
      case 'die':
        if (m.v !== from) return;
        if (t) {
          t.alive = false;
          t.hp = 0;
          if (!t.view.dead) this.tankDeathFx(t);
        }
        this.hostRecordDeath(from, m.by);
        break;
      case 'pick':
        this.hostPick(from, m.id);
        break;
      case 'barrel':
        this.hostBarrel(m.b, m.by);
        break;
    }
  }

  recvState(t, s) {
    if (!Array.isArray(s)) return;
    const st = { T: performance.now(), x: num(s[0]) / 100, z: num(s[1]) / 100, a: num(s[2]) / 1000, ta: num(s[3]) / 1000 };
    this.applyRemote(t, st, num(s[4]), num(s[5]));
    t.last = s;
  }

  // uzak tankın yeni durumu
  applyRemote(t, st, hp, flags) {
    const alive = !!(flags & 1);
    t.flags = flags;
    t.hp = hp;
    if (alive && !t.alive) {
      // yeniden doğdu: ara değerleme geçmişini sil
      t.alive = true;
      t.seen = true;
      t.buf = [];
      t.x = st.x;
      t.z = st.z;
      t.a = st.a;
      t.ta = st.ta;
      t.view.revive();
      t.view.root.visible = true;
      t.view.lastA = null;
      this.fx.spawnFx(st.x, this.world.height(st.x, st.z), st.z, t.color);
    } else if (!alive && t.alive) {
      t.alive = false;
      if (!t.view.dead) this.tankDeathFx(t);
    }
    t.buf.push(st);
    if (t.buf.length > 30) t.buf.shift();
  }

  hostRecordDeath(v, by) {
    const vt = this.tanks.get(v);
    const vs = this.scores.get(v);
    if (vs) vs.d++;
    const ks = by !== v ? this.scores.get(by) : null;
    const kt = this.tanks.get(by);
    if (ks && kt && vt && this.hostile(kt, vt)) {
      ks.k++;
      ks.s += vt.kind === 'enemy' ? TYPES[vt.type].score : 100;
    }
    this.scoreDirty = true;
    const msg = { t: 'kill', v, by };
    this.session.broadcast(msg);
    this.onKill(v, by);
    if (vt && vt.kind === 'enemy' && Math.random() < 0.14) this.spawnPickup(vt.x, vt.z, 'repair');
    this.checkEnd();
  }

  hostPick(pid, id) {
    const p = this.pickups.get(id);
    const t = this.tanks.get(pid);
    if (!p || !t || !t.alive) return;
    const m = { t: 'pk', id, by: pid };
    this.session.broadcast(m);
    this.onPickupTaken(id, pid);
  }

  hostBarrel(b, by) {
    const o = this.world.barrels[b];
    if (!o || !o.alive) return;
    const m = { t: 'boom', b, by };
    this.session.broadcast(m);
    this.barrelGone(b, by, true);
    // zincirleme patlama
    for (const n of this.world.barrels) {
      if (n.alive && Math.hypot(n.x - o.x, n.z - o.z) < 3.6) setTimeout(() => !this.disposed && this.hostBarrel(n.bid, by), 220);
    }
  }

  barrelGone(b, by, fx) {
    const o = this.world.barrels[b];
    if (!o || !o.alive) return;
    o.alive = false;
    this.stage.hideBarrel(b);
    if (!fx) return;
    const y = this.world.height(o.x, o.z);
    this.fx.explosion(o.x, y, o.z, 1.05);
    sfx.explosion(o.x, o.z, true);
    this.stage.scorch(o.x, o.z, 2.4);
    this.splash(o.x, o.z, BARREL.splash, BARREL.dmg, by, null);
    const d = Math.hypot(o.x - this.cam.pos.x, o.z - this.cam.pos.z);
    this.shake = Math.max(this.shake, clamp(1 - d / 40, 0, 0.7));
  }

  hostUpdate(dt) {
    // botlar
    for (const t of [...this.tanks.values()]) {
      if (!t.local || t.kind === 'player') continue;
      this.timers(t, dt);
      if (!t.alive) {
        t.deadT += dt;
        if (t.kind === 'bot' && t.deadT > 3.5 && !this.over) {
          this.placeAtSpawn(t, this.bestSpawn(t));
          t.protT = 2;
        } else if (t.kind === 'enemy' && t.deadT > 7) this.removeTank(t.id);
        continue;
      }
      if (this.over) continue;
      const c = t.brain.update(dt);
      this.drive(t, c.throttle, c.steer, dt);
      t.ta = turnTo(t.ta, c.aim != null ? c.aim : t.a, t.spec.turret * dt);
      if (c.fire && t.reload <= 0) this.fire(t, false);
      if (c.he && t.heCd <= 0) {
        this.fire(t, true);
        t.heCd = ABILITY.heCooldown * 1.5;
      }
      if (c.boost && t.boostCd <= 0) {
        t.boostT = ABILITY.boostTime;
        t.boostCd = ABILITY.boostCooldown * 1.3;
      }
      if (t.kind === 'bot') {
        for (const p of this.pickups.values()) if (Math.hypot(p.x - t.x, p.z - t.z) < t.r + 1.4) this.hostPick(t.id, p.id);
      }
    }
    if (!this.over) {
      if (this.mode === 'coop') this.waveUpdate(dt);
      else {
        this.timeLeft -= dt;
        if (this.timeLeft <= 0) this.checkEnd(true);
      }
      this.pickupT -= dt;
      if (this.pickupT <= 0) {
        this.pickupT = rand(10, 16);
        if (this.pickups.size < 3) this.spawnPickup();
      }
      for (const p of [...this.pickups.values()]) {
        p.life -= dt;
        if (p.life <= 0) this.removePickup(p.id);
      }
    }
    this.snapT += dt;
    if (this.snapT >= 1 / SNAP_HZ) {
      this.snapT = 0;
      this.sendSnap();
    }
  }

  sendSnap() {
    if (this.session.solo) return;
    const p = [], b = [], pk = [];
    for (const t of this.tanks.values()) {
      if (t.kind === 'player') {
        if (t.local) p.push([t.id, q2(t.x), q2(t.z), q3(t.a), q3(t.ta), Math.max(0, Math.round(t.hp)), this.flagsOf(t)]);
        else if (t.last) p.push([t.id, ...t.last]);
      } else {
        b.push([t.id, TYPE_LIST.indexOf(t.type), q2(t.x), q2(t.z), q3(t.a), q3(t.ta), Math.max(0, Math.round(t.hp)), this.flagsOf(t), t.maxHp]);
      }
    }
    for (const q of this.pickups.values()) pk.push([q.id, PICKUP_LIST.indexOf(q.type), Math.round(q.x * 10), Math.round(q.z * 10)]);
    const msg = { t: 'snap', T: Math.round(performance.now()), p, b, pk, m: [Math.ceil(this.timeLeft), this.wave, this.enemiesLeft] };
    if (this.scoreDirty || ++this.snapCount % 20 === 0) {
      msg.sc = this.packScores();
      this.scoreDirty = false;
    }
    this.session.broadcast(msg);
  }

  packScores() {
    return [...this.scores.entries()].map(([id, s]) => [id, s.k, s.d, s.s]);
  }

  applyScores(sc) {
    if (!Array.isArray(sc)) return;
    for (const r of sc) {
      if (!Array.isArray(r)) continue;
      this.scores.set(r[0], { k: num(r[1]), d: num(r[2]), s: num(r[3]) });
    }
  }

  // ---------- istemci: anlık görüntü ----------
  applySnap(m) {
    const now = performance.now();
    const off = now - num(m.T);
    if (this.clockOffset == null || off < this.clockOffset) this.clockOffset = off;
    else this.clockOffset += (off - this.clockOffset) * 0.02;
    const T = num(m.T);
    if (Array.isArray(m.p)) {
      for (const r of m.p) {
        if (!Array.isArray(r) || r[0] === this.myId) continue;
        const t = this.tanks.get(r[0]);
        if (!t) continue;
        this.applyRemote(t, { T, x: num(r[1]) / 100, z: num(r[2]) / 100, a: num(r[3]) / 1000, ta: num(r[4]) / 1000 }, num(r[5]), num(r[6]));
      }
    }
    const seenB = new Set();
    if (Array.isArray(m.b)) {
      for (const r of m.b) {
        if (!Array.isArray(r)) continue;
        const id = r[0];
        seenB.add(id);
        let t = this.tanks.get(id);
        if (!t) {
          const type = TYPE_LIST[num(r[1])] || 'medium';
          if (type === 'bot') {
            const info = this.botInfo.get(id) || { id, name: 'Bot', color: '#7E8A5A' };
            t = this.addBot(info);
          } else t = this.addEnemy(id, type);
        }
        if (r[8]) t.maxHp = num(r[8]);
        this.applyRemote(t, { T, x: num(r[2]) / 100, z: num(r[3]) / 100, a: num(r[4]) / 1000, ta: num(r[5]) / 1000 }, num(r[6]), num(r[7]));
      }
    }
    for (const t of [...this.tanks.values()]) {
      if (t.kind === 'player' || seenB.has(t.id)) continue;
      this.removeTank(t.id);
    }
    // bonuslar
    const seenP = new Set();
    if (Array.isArray(m.pk)) {
      for (const r of m.pk) {
        if (!Array.isArray(r)) continue;
        seenP.add(r[0]);
        if (!this.pickups.has(r[0])) this.addPickup(r[0], PICKUP_LIST[num(r[1])] || 'repair', num(r[2]) / 10, num(r[3]) / 10);
      }
    }
    for (const id of [...this.pickups.keys()]) if (!seenP.has(id)) this.removePickup(id, false);
    if (Array.isArray(m.m)) {
      this.timeLeft = num(m.m[0]);
      if (num(m.m[1]) > this.wave) this.onWave(num(m.m[1]));
      this.enemiesLeft = num(m.m[2]);
    }
    if (m.sc) this.applyScores(m.sc);
  }

  // uzak tankları geçmiş tampondan yumuşakça çiz
  updateRemotes(dt) {
    const now = performance.now();
    const rt = this.isHost ? now - INTERP_DELAY : now - (this.clockOffset || 0) - INTERP_DELAY;
    for (const t of this.tanks.values()) {
      if (t.local) continue;
      const b = t.buf;
      if (!b.length) continue;
      const px = t.x, pz = t.z;
      while (b.length > 2 && b[1].T <= rt) b.shift();
      let x, z, a, ta;
      if (b.length >= 2 && b[0].T <= rt) {
        const k = clamp((rt - b[0].T) / Math.max(1, b[1].T - b[0].T), 0, 1.15);
        x = lerp(b[0].x, b[1].x, k);
        z = lerp(b[0].z, b[1].z, k);
        a = lerpAng(b[0].a, b[1].a, k);
        ta = lerpAng(b[0].ta, b[1].ta, k);
      } else {
        const s = b[0];
        x = s.x;
        z = s.z;
        a = s.a;
        ta = s.ta;
      }
      t.x = x;
      t.z = z;
      t.a = a;
      t.ta = ta;
      t.seen = true;
      if (t.alive) t.view.root.visible = true;
      const k = damp(6, dt);
      t.vx = lerp(t.vx, (x - px) / Math.max(dt, 1e-3), k);
      t.vz = lerp(t.vz, (z - pz) / Math.max(dt, 1e-3), k);
      t.shieldT = t.flags & 2 ? 1 : 0;
      t.boostT = t.flags & 4 ? 1 : 0;
      t.protT = t.flags & 16 ? 1 : 0;
    }
  }

  // ---------- bonuslar ----------
  spawnPickup(x, z, type) {
    if (x == null) {
      const spots = this.world.pickupSpots.filter(s => {
        for (const p of this.pickups.values()) if (Math.hypot(p.x - s.x, p.z - s.z) < 5) return false;
        for (const t of this.tanks.values()) if (t.alive && Math.hypot(t.x - s.x, t.z - s.z) < 7) return false;
        return true;
      });
      if (!spots.length) return;
      const s = spots[(Math.random() * spots.length) | 0];
      x = s.x;
      z = s.z;
    }
    if (!type) {
      const r = Math.random();
      type = r < 0.45 ? 'repair' : r < 0.72 ? 'rapid' : 'shield';
    }
    const id = this.nextPickup++;
    this.addPickup(id, type, x, z);
  }

  addPickup(id, type, x, z) {
    const col = PICKUPS[type].color;
    const g = new THREE.Group();
    const crate = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.8, 1.1), new THREE.MeshStandardMaterial({ color: '#3b3f32', roughness: 0.6, metalness: 0.3 }));
    const band = new THREE.Mesh(new THREE.BoxGeometry(1.14, 0.22, 1.14), new THREE.MeshBasicMaterial({ color: col, toneMapped: false }));
    const icon = new THREE.Mesh(
      type === 'repair' ? new THREE.BoxGeometry(0.16, 0.5, 0.5) : type === 'shield' ? new THREE.SphereGeometry(0.3, 12, 8) : new THREE.ConeGeometry(0.25, 0.55, 3),
      new THREE.MeshBasicMaterial({ color: col, toneMapped: false }));
    icon.position.y = 0.75;
    if (type === 'repair') {
      const i2 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.5), icon.material);
      i2.position.y = 0.75;
      g.add(i2);
    }
    crate.castShadow = true;
    g.add(crate, band, icon);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.9, 7, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    beam.position.y = 3;
    g.add(beam);
    const y = this.world.height(x, z);
    g.position.set(x, y + 0.7, z);
    this.stage.scene.add(g);
    this.pickups.set(id, { id, type, x, z, y, g, life: 30, t: Math.random() * 6 });
  }

  removePickup(id, fx = true) {
    const p = this.pickups.get(id);
    if (!p) return;
    this.stage.scene.remove(p.g);
    p.g.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    this.pickups.delete(id);
    if (fx) for (let i = 0; i < 16; i++) this.fx.sparkle(p.x, p.y + 0.6, p.z, PICKUPS[p.type].color);
  }

  onPickupTaken(id, by) {
    const p = this.pickups.get(id);
    const type = p ? p.type : null;
    this.removePickup(id);
    const t = this.tanks.get(by);
    if (!type || !t) return;
    if (by === this.myId || (this.isHost && t.local && t.kind !== 'player')) {
      if (type === 'repair') t.hp = Math.min(t.maxHp, t.hp + PICKUPS.repair.hp);
      else if (type === 'shield') t.shieldT = PICKUPS.shield.time;
      else t.rapidT = PICKUPS.rapid.time;
    }
    if (by === this.myId) {
      sfx.pickup();
      this.ui.banner(PICKUPS[type].label, '', 1.2);
      this.app.vibrate(25);
      this.sendState(true);
    }
  }

  updatePickups(dt) {
    for (const p of this.pickups.values()) {
      p.t += dt;
      p.g.position.y = p.y + 0.75 + Math.sin(p.t * 2.2) * 0.18;
      p.g.children[0].rotation.y = p.t * 0.9;
      p.g.children[1].rotation.y = p.t * 0.9;
      p.g.children[2].rotation.y = -p.t * 1.6;
      p.g.visible = !(p.life < 5 && Math.floor(p.t * 6) % 2);
      if (Math.random() < dt * 3) this.fx.sparkle(p.x, p.y + 0.4, p.z, PICKUPS[p.type].color);
    }
  }

  // ---------- dalgalar (birlikte savaş) ----------
  waveUpdate(dt) {
    const W = this.waveState;
    let alive = 0;
    for (const t of this.tanks.values()) if (t.kind === 'enemy' && t.alive) alive++;
    this.enemiesLeft = alive + W.queue.length;
    if (!W.active) {
      W.breakT -= dt;
      if (W.breakT <= 0) this.startWave();
      return;
    }
    const np = this.playerCount();
    const maxAlive = 6 + 2 * np;
    W.spawnT -= dt;
    if (W.queue.length && W.spawnT <= 0 && alive < maxAlive) {
      this.spawnEnemy(W.queue.shift());
      W.spawnT = rand(0.7, 1.6);
    }
    if (!W.queue.length && alive === 0) {
      W.active = false;
      W.breakT = 4;
      this.ui.banner('Dalga temizlendi!', 'Sıradaki dalga geliyor…', 2);
    }
  }

  startWave() {
    const W = this.waveState;
    const n = this.wave + 1;
    const np = this.playerCount();
    const count = Math.round((2.5 + n * 1.5) * (1 + 0.45 * (np - 1)));
    const q = [];
    for (let i = 0; i < count; i++) {
      const r = Math.random();
      const pH = n >= 4 ? Math.min(0.3, 0.045 * n) : 0;
      const pM = n >= 2 ? Math.min(0.45, 0.12 * n) : 0;
      q.push(r < pH ? 'heavy' : r < pH + pM ? 'medium' : 'light');
    }
    const boss = n % 5 === 0;
    if (boss) q.splice(2, 0, 'boss');
    W.queue = q;
    W.active = true;
    W.spawnT = 1;
    const m = { t: 'wave', n, boss: boss ? 1 : 0 };
    this.session.broadcast(m);
    this.onWave(n, boss);
  }

  onWave(n, boss) {
    if (n <= this.wave && this.wave) return;
    this.wave = n;
    sfx.horn();
    this.ui.banner('Dalga ' + n, boss ? 'KOMUTAN TANKI geliyor!' : n === 1 ? 'Düşmanlar kenarlardan geliyor' : '', 2.2);
    const m = this.me;
    if (m) {
      if (!m.alive) this.spawnMe();
      else if (n > 1) {
        m.hp = Math.min(m.maxHp, m.hp + 35);
        this.sendState(true);
      }
    }
  }

  spawnEnemy(type) {
    let best = null, bs = -1;
    for (const s of this.world.enemySpawns) {
      let d = 200;
      for (const t of this.tanks.values()) if (t.kind === 'player' && t.alive) d = Math.min(d, Math.hypot(t.x - s.x, t.z - s.z));
      d = Math.min(d, 40) + Math.random() * 25;
      if (d > bs) {
        bs = d;
        best = s;
      }
    }
    const t = this.addEnemy(this.nextEnemy++, type);
    this.placeAtSpawn(t, best);
    t.protT = 0.8;
  }

  // ---------- maç sonu ----------
  checkEnd(timeUp) {
    if (this.over || !this.isHost) return;
    let reason = null;
    if (this.mode === 'coop') {
      let players = 0, alive = 0;
      for (const t of this.tanks.values()) if (t.kind === 'player') {
        players++;
        if (t.alive) alive++;
      }
      if (players && !alive) reason = 'wiped';
    } else {
      for (const s of this.scores.values()) if (s.k >= this.cfg.limit) reason = 'limit';
      if (timeUp) reason = 'time';
    }
    if (!reason) return;
    const rows = [];
    for (const [id, s] of this.scores) {
      const t = this.tanks.get(id);
      if (!t && !(id < 100)) continue;
      rows.push([id, t ? t.name : '?', t ? t.color : '#888', s.k, s.d, s.s, t && t.kind === 'bot' ? 1 : 0]);
    }
    if (this.mode === 'dm') rows.sort((a, b) => b[3] - a[3] || a[4] - b[4]);
    else rows.sort((a, b) => b[5] - a[5]);
    const r = { mode: this.mode, reason, wave: this.wave, rows, winner: rows.length ? rows[0][0] : null };
    const msg = { t: 'end', r };
    // son skorları gönder, sonra bitir
    this.session.broadcast({ t: 'sc', sc: this.packScores() });
    this.session.broadcast(msg);
    setTimeout(() => !this.disposed && this.finish(r), 50);
  }

  finish(r) {
    if (this.over) return;
    this.over = true;
    sfx.engineSet(0, false);
    setTimeout(() => {
      if (!this.disposed) this.ui.showResults(r, this);
    }, 1400);
  }

  // ---------- görseller ----------
  updateVisuals(dt) {
    const camX = this.cam.pos.x, camZ = this.cam.pos.z;
    for (const t of this.tanks.values()) {
      const vis = t.seen && (t.alive || t.deadT < 12);
      t.view.update(dt, { x: t.x, z: t.z, a: t.a, ta: t.ta, shield: t.protT > 0 ? 2 : t.shieldT > 0 ? 1 : 0, visible: vis }, this.world);
      if (!vis) continue;
      const near = Math.hypot(t.x - camX, t.z - camZ) < 75;
      if (!t.alive) {
        if (!t.local) t.deadT += dt;
        t.fireT -= dt;
        if (near && t.deadT < 7 && t.fireT <= 0) {
          t.fireT = 0.05;
          this.fx.fire(t.x, this.world.height(t.x, t.z) + 0.9 * t.spec.scale, t.z, t.spec.scale * Math.max(0.3, 1 - t.deadT / 7));
        }
        continue;
      }
      if (!near) continue;
      const sp = Math.hypot(t.vx, t.vz);
      const c = Math.cos(t.a), s = Math.sin(t.a);
      const L = t.view.g.spec.len * 0.5 * t.spec.scale, wz = t.view.g.trackZ * t.spec.scale;
      const gy = this.world.height(t.x, t.z);
      t.trackD += sp * dt;
      if (t.trackD > 0.9) {
        t.trackD = 0;
        this.stage.trackMark(t.x - c * L * 0.7, t.z - s * L * 0.7, t.a, wz * 2 + 0.5, this.theme.snow ? 0.5 : 0.32);
      }
      t.dustT -= dt;
      if (sp > 1.5 && t.dustT <= 0) {
        t.dustT = 0.07;
        const amt = Math.min(1.4, sp / 7) * (this.theme.snow ? 1.2 : this.theme.trees[0] === 'palm' ? 1.5 : 0.9);
        for (const side of [-1, 1]) this.fx.dust(t.x - c * L - s * wz * side, gy, t.z - s * L + c * wz * side, amt, -c * sp * 0.2, -s * sp * 0.2);
      }
      t.exT -= dt;
      if (t.exT <= 0) {
        t.exT = t.boostT > 0 ? 0.04 : sp > 1 ? 0.14 : 0.3;
        const ex = t.x - c * (L + 0.1), ez = t.z - s * (L + 0.1);
        this.fx.exhaust(ex, gy + 0.85 * t.spec.scale, ez, -c, -s, t.boostT > 0);
        if (t.boostT > 0) this.fx.fire(ex, gy + 0.6, ez, 0.4);
      }
    }
  }

  updateCamera(dt) {
    const m = this.me, c = this.cam, cam = this.stage.camera;
    if (!m) return;
    if (!c.init) {
      c.yaw = m.a;
    }
    if (m.alive) c.yaw = lerpAng(c.yaw, m.a, damp(3.2, dt));
    else c.yaw += dt * 0.3;
    const portrait = this.stage.h > this.stage.w;
    const dist = (m.alive ? 10.5 : 17) * (portrait ? 1.3 : 1), hgt = (m.alive ? 5.6 : 10) * (portrait ? 1.35 : 1);
    const gy = this.world.height(m.x, m.z);
    const cx = Math.cos(c.yaw), cz = Math.sin(c.yaw);
    const wx = m.x - cx * dist, wz = m.z - cz * dist;
    const wy = Math.max(gy + hgt, this.world.height(wx, wz) + 2.5);
    const lx = m.x + cx * 5, lz = m.z + cz * 5;
    if (!c.init) {
      c.pos.set(wx, wy, wz);
      c.look.set(lx, gy + 1.2, lz);
      c.init = true;
    }
    c.pos.lerp(TV1.set(wx, wy, wz), damp(6, dt));
    c.look.lerp(TV2.set(lx, gy + 1.2, lz), damp(9, dt));
    cam.position.copy(c.pos);
    this.shake = Math.max(0, this.shake - dt * 2.2);
    if (this.shake > 0 && this.app.settings.shake) {
      const s = this.shake * this.shake * 0.7;
      cam.position.x += rand(-s, s);
      cam.position.y += rand(-s, s);
      cam.position.z += rand(-s, s);
    }
    cam.lookAt(c.look);
    this.stage.setFadeTarget(m.x, gy + 1.2, m.z);
    const baseFov = portrait ? 72 : 58;
    c.fov = lerp(c.fov || baseFov, baseFov + (m.boostT > 0 ? 7 : 0), damp(4, dt));
    if (Math.abs(cam.fov - c.fov) > 0.05) {
      cam.fov = c.fov;
      cam.updateProjectionMatrix();
    }
    sfx.listener.x = m.x;
    sfx.listener.z = m.z;
    sfx.listener.a = c.yaw;
  }

  dispose() {
    this.disposed = true;
    this.stage.setFadeTarget(null);
    sfx.engineStop();
    for (const t of this.tanks.values()) t.view.dispose();
    this.tanks.clear();
    for (const id of [...this.pickups.keys()]) this.removePickup(id, false);
    this.shells = [];
    this.fx.clear();
    this.ui.endHud();
  }
}
