// Maç mantığı: tanklar, balistik mermiler, zırh, bonuslar, dalgalar, puanlar ve ağ senkronizasyonu.
//
// Yetki kuralları (herkesin ekranı tutarlı kalsın diye):
//  - Her oyuncu kendi tankını yönetir ve KENDİSİNE gelen vuruşlara (hasar/sekme) kendisi karar verir.
//  - Botlara isabet eden oyuncu mermisine atan oyuncu karar verir; bot mermileri oda sahibinde.
//  - Botlar, bonuslar, variller, dalgalar ve skor oda sahibinin (host) cihazında yönetilir.
import * as THREE from 'three';
import {
  TYPES, TYPE_LIST, AMMO, CONSUMABLES, CAMERA, PICKUPS, PICKUP_LIST, BARREL, INTERP_DELAY, SNAP_HZ,
  ENEMY_COLORS, THEMES, ARENA, GRAVITY, CLASS_LIST,
} from './config.js';
import { World } from './world.js';
import { TankView, modelInfo } from './tankModel.js';
import { Brain } from './ai.js';
import { sfx } from './audio.js';
import { clamp, lerp, angDiff, turnTo, lerpAng, damp, rand, segCircle, num, TAU, solveElev, ELEV_MIN, ELEV_MAX } from './util.js';

const TV1 = new THREE.Vector3(), TV2 = new THREE.Vector3(), TV3 = new THREE.Vector3();
const q2 = v => Math.round(v * 100);
const q3 = v => Math.round(v * 1000);
const DIFF = [
  { hp: 0.8, dmg: 0.7 },
  { hp: 1, dmg: 1 },
  { hp: 1.25, dmg: 1.25 },
];
// 3B parça - yönlendirilmiş kutu (tank gövdesi) kesişimi. Yüz: 0 ön, 1 yan, 2 arka, 3 üst
function segTank(t, x0, y0, z0, x1, y1, z1) {
  const c = Math.cos(t.a), s = Math.sin(t.a);
  const base = t.baseY;
  const ax = (x0 - t.x) * c + (z0 - t.z) * s, az = -(x0 - t.x) * s + (z0 - t.z) * c, ay = y0 - base;
  const bx = (x1 - t.x) * c + (z1 - t.z) * s, bz = -(x1 - t.x) * s + (z1 - t.z) * c, by = y1 - base;
  const d = [bx - ax, by - ay, bz - az], o = [ax, ay, az];
  const lo = [-t.hl, 0, -t.hw], hi = [t.hl, t.hh, t.hw];
  let tmin = 0, tmax = 1, axis = -1, sign = 1;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < lo[i] || o[i] > hi[i]) return null;
      continue;
    }
    let t1 = (lo[i] - o[i]) / d[i], t2 = (hi[i] - o[i]) / d[i], sg = -1;
    if (t1 > t2) {
      [t1, t2] = [t2, t1];
      sg = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      axis = i;
      sign = sg;
    }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (axis < 0) axis = 2;
  const len = Math.hypot(d[0], d[1], d[2]) || 1;
  let face, cosI;
  if (axis === 0) {
    face = sign > 0 ? 0 : 2;
    cosI = Math.abs(d[0]) / len;
  } else if (axis === 2) {
    face = 1;
    cosI = Math.abs(d[2]) / len;
  } else {
    face = 3;
    cosI = Math.abs(d[1]) / len;
  }
  return { t: tmin, face, cosI };
}

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
    this.x = this.z = this.a = this.ta = this.elev = 0;
    this.speed = 0;
    this.vx = this.vz = 0;
    this.reload = 0;
    this.ammo = 'ap';
    this.smokeCd = 0;
    this.repairCd = 0;
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
    this.disp = this.spec.disp * 3;
    this.turnRate = 0;
    this.turretRate = 0;
    const info = modelInfo(this.spec.model);
    const sc = this.spec.scale;
    this.hl = (info.len / 2) * sc;
    this.hw = (info.width / 2) * sc;
    this.hh = info.height * sc;
    this.gunH = info.gunH * sc;
    this.gunX = info.gunX * sc;
    this.pivotX = info.pivotX * sc;
    this.muzzleLen = info.muzzle * sc;
    this.baseY = 0;
    this.view = new TankView(game.stage, o.type, this.spec.model, o.color, sc);
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
    this.smokes = [];
    this.ended = new Map();
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
    this.stats = { shots: 0, hits: 0, dmg: 0, kills: 0, taken: 0 };
    this.cam = { yaw: 0, pitch: CAMERA.pitch, zoom: false, pos: new THREE.Vector3(), init: false, fov: 0, dist: CAMERA.dist };
    this.aim = { x: 0, y: 0, z: 0, target: null, marker: null };
    this.botInfo = new Map((start.bots || []).map(b => [b.id, b]));

    for (const p of start.players) this.addPlayer(p);
    this.me = this.tanks.get(this.myId);
    for (const b of start.bots || []) this.addBot(b);

    if (start.sync) {
      for (const b of start.sync.bar || []) this.barrelGone(b, null, false);
      this.wave = start.sync.wave || 0;
    }

    if (this.isHost) this.hostInit();
    this.spawnMe(start.spawns && start.spawns[this.myId]);
    this.ui.startHud(this);
    sfx.engineStart();
    sfx.ambienceStart(1);
    if (this.mode === 'coop') this.ui.banner(this.wave ? 'Dalga ' + this.wave : 'Hazırlan!', 'Düşman dalgalarına karşı dayan', 2.4);
    else this.ui.banner('Ölüm Maçı', `${this.cfg.limit} vuruşa ilk ulaşan kazanır`, 2.4);
  }

  // ---------- oyuncu / bot kayıtları ----------
  addPlayer(p) {
    if (this.tanks.has(p.id)) return this.tanks.get(p.id);
    const type = CLASS_LIST.includes(p.tank) ? p.tank : 'medium';
    const t = new Tank(this, {
      id: p.id, kind: 'player', type, name: p.name, color: p.color,
      team: this.mode === 'coop' ? 1 : p.id, local: p.id === this.myId,
    });
    this.tanks.set(p.id, t);
    if (!this.scores.has(p.id)) this.scores.set(p.id, { k: 0, d: 0, s: 0 });
    return t;
  }

  addBot(b) {
    if (this.tanks.has(b.id)) return this.tanks.get(b.id);
    const type = CLASS_LIST.includes(b.tank) ? b.tank : 'medium';
    const t = new Tank(this, { id: b.id, kind: 'bot', type, name: b.name, color: b.color, team: b.id, local: this.isHost });
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
      id, kind: 'enemy', type, name: TYPES[type].name, color: ENEMY_COLORS[type], team: 2, local: this.isHost,
      hpMul: this.diff.hp * (1 + 0.28 * (np - 1)), dmgMul: this.diff.dmg,
    });
    this.tanks.set(id, t);
    if (this.isHost) {
      t.brain = new Brain(this, t, this.cfg.diff);
      t.brain.extraErr = Math.max(0, 0.05 - this.wave * 0.01);
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
    for (const p of players) this.addPlayer(p).name = p.name;
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
    t.elev = 0;
    t.speed = 0;
    t.vx = t.vz = 0;
    t.hp = t.maxHp;
    t.alive = true;
    t.seen = true;
    t.deadT = 99;
    t.reload = 0.8;
    t.buf = [];
    t.disp = t.spec.disp * 3;
    t.baseY = this.world.height(s.x, s.z);
    t.view.revive();
    t.view.root.visible = true;
    t.view.lastA = null;
    this.fx.spawnFx(s.x, t.baseY, s.z, t.color);
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
    m.rapidT = 0;
    this.cam.yaw = s.a;
    this.cam.pitch = CAMERA.pitch;
    this.cam.init = false;
    this.cam.zoom = false;
    this.ui.dead(false);
    this.sendState();
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

  // ---------- oyuncu eylemleri ----------
  action(name) {
    const m = this.me;
    if (!m) return;
    if (name === 'zoom') {
      if (m.alive) this.cam.zoom = !this.cam.zoom;
      return;
    }
    if (!m.alive || this.over) return;
    if (name === 'ap' || name === 'he') {
      if (m.ammo !== name) {
        m.ammo = name;
        m.reload = Math.max(m.reload, m.spec.reload * 0.6);
        this.ui.hitInfo(AMMO[name].name + ' yükleniyor', 'info');
        sfx.click();
      }
    } else if (name === 'ammo') this.action(m.ammo === 'ap' ? 'he' : 'ap');
    else if (name === 'smoke' && m.smokeCd <= 0) {
      m.smokeCd = CONSUMABLES.smoke.cd;
      const msg = { t: 'smoke', o: m.id, x: q2(m.x), z: q2(m.z) };
      this.onSmoke(msg);
      this.emit(msg);
    } else if (name === 'repair' && m.repairCd <= 0 && m.hp < m.maxHp) {
      m.repairCd = CONSUMABLES.repair.cd;
      m.hp = Math.min(m.maxHp, m.hp + CONSUMABLES.repair.heal);
      sfx.repair();
      this.ui.hitInfo('+' + CONSUMABLES.repair.heal + ' ONARIM', 'good');
      this.sendState();
    }
  }

  onSmoke(m) {
    const x = num(m.x) / 100, z = num(m.z) / 100;
    const C = CONSUMABLES.smoke;
    this.smokes.push({ x, z, r: C.r, until: this.time + C.dur });
    this.fx.smokeScreen(x, this.world.height(x, z), z, C.r, C.dur);
    if (m.o === this.myId) sfx.smoke();
  }

  smokeBlocks(x0, z0, x1, z1) {
    for (const s of this.smokes) if (s.until > this.time && segCircle(x0, z0, x1, z1, s.x, s.z, s.r * 0.85) >= 0) return true;
    return false;
  }
  inSmoke(x, z) {
    for (const s of this.smokes) if (s.until > this.time && Math.hypot(x - s.x, z - s.z) < s.r * 0.9) return true;
    return false;
  }

  // ---------- ana döngü ----------
  update(dt) {
    this.time += dt;
    this.updateCameraInput();
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
    this.updateGunMarker();
    this.ui.hudTick(this, dt);
    for (const [k, t] of this.ended) if (this.time - t > 6) this.ended.delete(k);
    if (this.directHits.size > 200) this.directHits.clear();
    if (this.smokes.length) this.smokes = this.smokes.filter(s => s.until > this.time);
  }

  sendState() {
    if (this.isHost || !this.me) return;
    const m = this.me;
    this.session.send({ t: 'st', s: [q2(m.x), q2(m.z), q3(m.a), q3(m.ta), q3(m.elev), Math.max(0, Math.round(m.hp)), this.flagsOf(m)] });
  }

  flagsOf(t) {
    return (t.alive ? 1 : 0) | (t.rapidT > 0 ? 8 : 0) | (t.protT > 0 ? 16 : 0);
  }

  timers(t, dt) {
    const was = t.reload;
    t.reload -= dt;
    t.smokeCd -= dt;
    t.repairCd -= dt;
    t.rapidT -= dt;
    t.protT -= dt;
    if (t === this.me && was > 0 && t.reload <= 0 && t.alive) sfx.reload();
  }

  updateCameraInput() {
    const c = this.cam;
    const look = this.app.input.consumeLook();
    const zf = c.zoom ? 0.28 : 1;
    c.yaw += look.dx * zf;
    c.pitch = clamp(c.pitch + look.dy * zf, c.zoom ? -0.35 : CAMERA.minPitch, CAMERA.maxPitch);
    if (c.yaw > Math.PI) c.yaw -= TAU;
    else if (c.yaw < -Math.PI) c.yaw += TAU;
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
      sfx.engineSet(0, 0, false, 0, dt);
      return;
    }
    let fire = inp.fire;
    let auto = null;
    if (this.app.autoplay) {
      if (!this.autoBrain) this.autoBrain = new Brain(this, m, 2);
      auto = this.autoBrain.update(dt);
      inp = { throttle: auto.throttle, steer: auto.steer };
      fire = auto.fire;
      if (auto.aim != null) this.cam.yaw = lerpAng(this.cam.yaw, auto.aim, damp(5, dt));
    }
    if (this.over) {
      inp = { throttle: 0, steer: 0 };
      fire = false;
    }
    const pa = m.a;
    this.drive(m, inp.throttle, inp.steer, dt);
    m.turnRate = angDiff(pa, m.a) / Math.max(dt, 1e-3);

    // nişan: kameranın gösterdiği nokta
    this.computeAim();
    const A = this.aim;
    const gx = m.x + Math.cos(m.a) * m.gunX, gz = m.z + Math.sin(m.a) * m.gunX;
    let wantYaw = Math.atan2(A.z - gz, A.x - gx);
    let wantElev = solveElev(Math.hypot(A.x - gx, A.z - gz) - m.pivotX, A.y - (m.baseY + m.gunH), m.spec.shell);
    if (auto && auto.aim != null) {
      wantYaw = auto.aim;
      wantElev = auto.elev ?? wantElev;
    }
    const pta = m.ta;
    m.ta = turnTo(m.ta, wantYaw, m.spec.turret * dt);
    m.turretRate = Math.abs(angDiff(pta, m.ta)) / Math.max(dt, 1e-3);
    m.elev += clamp(wantElev - m.elev, -m.spec.elev * dt, m.spec.elev * dt);
    this.updateDispersion(m, dt);

    if (fire && m.reload <= 0) this.fire(m);
    for (const p of this.pickups.values()) {
      if (p.claimed) continue;
      if (Math.hypot(p.x - m.x, p.z - m.z) < m.r + 1.4) {
        p.claimed = true;
        if (this.isHost) this.hostPick(this.myId, p.id);
        else this.session.send({ t: 'pick', id: p.id });
      }
    }
    sfx.engineSet(Math.abs(m.speed) / m.spec.speed, Math.abs(inp.throttle), true, m.turretRate / m.spec.turret, dt);
  }

  // Sapma (isabet dağılımı): hareket, dönüş ve atış büyütür; durunca toplanır
  updateDispersion(t, dt) {
    const s = t.spec;
    const target = s.disp * (1 + (Math.abs(t.speed) / s.speed) * 2.2 + Math.min(1.5, Math.abs(t.turnRate) / s.turn) * 1.2 + Math.min(1.5, t.turretRate / s.turret) * 1.0);
    if (target > t.disp) t.disp = lerp(t.disp, target, damp(12, dt));
    else t.disp = target + (t.disp - target) * Math.exp((-dt * 2.3) / s.aimTime);
  }

  drive(t, thr, st, dt) {
    const s = t.spec;
    thr = clamp(thr, -1, 1);
    st = clamp(st, -1, 1);
    const ca = Math.cos(t.a), sa = Math.sin(t.a);
    // yokuş yukarı yavaşlar, aşağı hızlanır
    const hf = this.world.height(t.x + ca * 2, t.z + sa * 2), hb = this.world.height(t.x - ca * 2, t.z - sa * 2);
    const slope = (hf - hb) / 4;
    let target = thr >= 0 ? thr * s.speed : thr * s.rev;
    target *= clamp(1 - slope * Math.sign(target) * 2.5, 0.55, 1.15);
    let accel;
    if (thr === 0) accel = 4;
    else if (Math.sign(target) === Math.sign(t.speed) || Math.abs(t.speed) < 0.2) accel = Math.abs(target) > Math.abs(t.speed) ? s.accel : s.accel * 1.6;
    else accel = s.accel * 2.4;
    t.speed += clamp(target - t.speed, -accel * dt, accel * dt);
    const rev = t.speed < -0.4 || thr < -0.25;
    t.a += (rev ? -st : st) * s.turn * dt * (1 - 0.35 * Math.min(1, Math.abs(t.speed) / s.speed));
    if (t.a > Math.PI) t.a -= TAU;
    else if (t.a < -Math.PI) t.a += TAU;
    const px = t.x, pz = t.z;
    t.x += Math.cos(t.a) * t.speed * dt;
    t.z += Math.sin(t.a) * t.speed * dt;
    t.bumped = false;
    this.world.collide(t, t.r * 0.88);
    for (const o of this.tanks.values()) {
      if (o === t || !o.alive || !o.seen) continue;
      const dx = t.x - o.x, dz = t.z - o.z, mm = (t.r + o.r) * 0.85, d2 = dx * dx + dz * dz;
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
    if (t.bumped) t.speed *= Math.pow(0.08, dt);
    const k = damp(10, dt);
    t.vx = lerp(t.vx, (t.x - px) / Math.max(dt, 1e-3), k);
    t.vz = lerp(t.vz, (t.z - pz) / Math.max(dt, 1e-3), k);
    t.baseY = this.world.height(t.x, t.z);
  }

  camDir(out) {
    const c = this.cam;
    return out.set(Math.cos(c.yaw) * Math.cos(c.pitch), -Math.sin(c.pitch), Math.sin(c.yaw) * Math.cos(c.pitch));
  }

  // Nişangâhın gösterdiği dünya noktası (+ isteğe bağlı nişan yardımı)
  computeAim() {
    const m = this.me, A = this.aim;
    const o = this.stage.camera.position, d = this.camDir(TV1);
    const hit = this.raycast(o.x, o.y, o.z, d.x, d.y, d.z, 260, m);
    A.x = hit.x;
    A.y = hit.y;
    A.z = hit.z;
    A.target = hit.tank && this.hostile(m, hit.tank) ? hit.tank : null;
    A.dist = hit.dist;
    A.assisted = false;
    if (this.app.settings.assist && !A.target) {
      let best = null, bestAng = ((this.cam.zoom ? 1.2 : 3.2) * Math.PI) / 180;
      for (const t of this.tanks.values()) {
        if (t === m || !t.alive || !t.seen || !this.hostile(m, t) || this.inSmoke(t.x, t.z)) continue;
        const cx = t.x - o.x, cy = t.baseY + t.hh * 0.5 - o.y, cz = t.z - o.z;
        const dist = Math.hypot(cx, cy, cz);
        if (dist > m.spec.range * 1.3) continue;
        const ang = Math.acos(clamp((cx * d.x + cy * d.y + cz * d.z) / dist, -1, 1)) - Math.atan(t.hw / dist);
        if (ang < bestAng && this.world.los(m.x, m.z, t.x, t.z, 2)) {
          bestAng = ang;
          best = t;
        }
      }
      if (best) {
        const tt = Math.hypot(best.x - m.x, best.z - m.z) / m.spec.shell;
        A.x = best.x + best.vx * tt * 0.8;
        A.z = best.z + best.vz * tt * 0.8;
        A.y = best.baseY + best.hh * 0.45;
        A.target = best;
        A.assisted = true;
      }
    }
  }

  // Işın izleme: arazi, engeller ve tanklar
  raycast(ox, oy, oz, dx, dy, dz, max, skip) {
    const ex = ox + dx * max, ey = oy + dy * max, ez = oz + dz * max;
    let best = 1, tank = null;
    const oh = this.world.shellHit(ox, oy, oz, ex, ey, ez);
    if (oh && oh.t < best) best = oh.t;
    for (const t of this.tanks.values()) {
      if (t === skip || !t.alive || !t.seen) continue;
      const h = segTank(t, ox, oy, oz, ex, ey, ez);
      if (h && h.t < best) {
        best = h.t;
        tank = t;
      }
    }
    const W = this.world;
    const steps = 90;
    let prev = 0;
    for (let i = 1; i <= steps; i++) {
      const t = (i / steps) * best;
      const x = ox + dx * max * t, y = oy + dy * max * t, z = oz + dz * max * t;
      if (y < W.height(x, z)) {
        let a = prev, b = t;
        for (let k = 0; k < 6; k++) {
          const mid = (a + b) / 2;
          if (oy + dy * max * mid < W.height(ox + dx * max * mid, oz + dz * max * mid)) b = mid;
          else a = mid;
        }
        best = b;
        tank = null;
        break;
      }
      prev = t;
    }
    return { x: ox + dx * max * best, y: oy + dy * max * best, z: oz + dz * max * best, dist: max * best, tank };
  }

  // Namlunun şu an vuracağı nokta (nişan halkası için)
  updateGunMarker() {
    const m = this.me;
    if (!m || !m.alive) {
      this.aim.marker = null;
      return;
    }
    const mz = this.muzzle(m, m.ta, m.elev);
    const v = m.spec.shell;
    let x = mz.x, y = mz.y, z = mz.z, vx = mz.dx * v, vy = mz.dy * v, vz = mz.dz * v;
    const dt = 0.035;
    let hit = null;
    for (let i = 0; i < 40 && !hit; i++) {
      const x1 = x + vx * dt, y1 = y + vy * dt - 0.5 * GRAVITY * dt * dt, z1 = z + vz * dt;
      vy -= GRAVITY * dt;
      const c = this.collideSeg(x, y, z, x1, y1, z1, m.id, m.team);
      if (c) hit = { x: x + (x1 - x) * c.t, y: y + (y1 - y) * c.t, z: z + (z1 - z) * c.t };
      x = x1;
      y = y1;
      z = z1;
    }
    if (!hit) hit = { x, y, z };
    this.aim.marker = { x: hit.x, y: hit.y, z: hit.z, dist: Math.hypot(hit.x - mz.x, hit.y - mz.y, hit.z - mz.z) };
  }

  // Namlu ağzı konumu ve yönü
  muzzle(t, yaw, elev) {
    const gx = t.x + Math.cos(t.a) * t.gunX + Math.cos(yaw) * t.pivotX;
    const gz = t.z + Math.sin(t.a) * t.gunX + Math.sin(yaw) * t.pivotX;
    const gy = t.baseY + t.gunH;
    const ce = Math.cos(elev), se = Math.sin(elev);
    const dx = Math.cos(yaw) * ce, dy = se, dz = Math.sin(yaw) * ce;
    return { x: gx + dx * t.muzzleLen, y: gy + dy * t.muzzleLen, z: gz + dz * t.muzzleLen, dx, dy, dz, px: gx, pz: gz, py: gy };
  }

  // ---------- ateş ve mermiler ----------
  fire(t) {
    const he = t.ammo === 'he' || t.type === 'boss';
    const A = he ? AMMO.he : AMMO.ap;
    t.reload = t.spec.reload * A.reloadMul * (t.rapidT > 0 ? 0.6 : 1);
    // dağılım dairesi içinde rastgele sapma
    const r = t.disp * Math.sqrt(Math.random()), ang = Math.random() * TAU;
    const yaw = t.ta + Math.cos(ang) * r, elev = clamp(t.elev + Math.sin(ang) * r * 0.7, ELEV_MIN - 0.02, ELEV_MAX + 0.02);
    let lo = 0;
    if (t.type === 'boss') {
      t.lo = -t.lo;
      lo = t.lo * 0.3 * t.spec.scale;
    }
    const mz = this.muzzle(t, yaw, elev);
    const msg = { t: 'fire', o: t.id, n: ++t.seq, x: q2(mz.x - Math.sin(yaw) * lo), y: q2(mz.y), z: q2(mz.z + Math.cos(yaw) * lo), a: q3(yaw), e: q3(elev), he: he ? 1 : 0 };
    this.spawnShell(msg);
    this.emit(msg);
    t.disp += t.spec.disp * 4;
    if (t === this.me) this.stats.shots++;
  }

  spawnShell(m) {
    const t = this.tanks.get(m.o);
    const spec = t ? t.spec : TYPES.medium;
    const x = num(m.x) / 100, y = num(m.y) / 100, z = num(m.z) / 100, a = num(m.a) / 1000, e = num(m.e) / 1000;
    const he = !!m.he;
    const v = spec.shell * (he ? 0.92 : 1);
    const ce = Math.cos(e);
    const dx = Math.cos(a) * ce, dy = Math.sin(e), dz = Math.sin(a) * ce;
    const base = spec.dmg * (t ? t.dmgMul : 1);
    this.shells.push({
      key: m.o + ':' + m.n, owner: m.o, team: t ? t.team : -1, x, y, z, vx: dx * v, vy: dy * v, vz: dz * v,
      life: 0, dmg: base * (he ? AMMO.he.dmgMul : 1), baseDmg: base, he, heavy: spec.dmg > 40 || he, enemy: !!(t && t.kind === 'enemy'), whiz: false,
    });
    this.fx.muzzle(x, y, z, dx, dy, dz, spec.dmg > 40, this.world.height(x, z));
    const mine = m.o === this.myId;
    sfx.cannon(x, z, clamp(spec.dmg / 50, 0.3, 1), mine);
    if (t) {
      t.view.kick(angDiff(t.a, a), clamp(spec.dmg / 36, 0.6, 1.5));
      if (!t.local) t.disp = spec.disp * 4;
    }
    if (mine) {
      this.shake = Math.max(this.shake, spec.dmg > 40 ? 0.55 : 0.4);
      this.app.vibrate(35);
    } else {
      const d = Math.hypot(x - this.cam.pos.x, z - this.cam.pos.z);
      if (d < 25) this.shake = Math.max(this.shake, 0.25 * (1 - d / 25));
    }
  }

  // parça boyunca en yakın çarpışma
  collideSeg(x0, y0, z0, x1, y1, z1, owner, team) {
    const W = this.world;
    let best = 2, res = null;
    if (y1 < W.height(x1, z1)) {
      let a = 0, b = 1;
      for (let k = 0; k < 6; k++) {
        const mid = (a + b) / 2;
        if (y0 + (y1 - y0) * mid < W.height(x0 + (x1 - x0) * mid, z0 + (z1 - z0) * mid)) b = mid;
        else a = mid;
      }
      best = b;
      res = { t: b, kind: 'ground' };
    }
    const oh = W.shellHit(x0, y0, z0, x1, y1, z1);
    if (oh && oh.t < best) {
      best = oh.t;
      res = { t: oh.t, kind: 'obs', o: oh.o };
    }
    for (const t of this.tanks.values()) {
      if (!t.alive || !t.seen || t.id === owner || t.team === team) continue;
      const h = segTank(t, x0, y0, z0, x1, y1, z1);
      if (h && h.t < best) {
        best = h.t;
        res = { t: h.t, kind: 'tank', tank: t, face: h.face, cosI: h.cosI };
      }
    }
    return res;
  }

  updateShells(dt) {
    const m = this.me;
    const steps = Math.max(1, Math.ceil(dt * 60));
    const h = dt / steps;
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      let done = false;
      for (let k = 0; k < steps; k++) {
        const x1 = s.x + s.vx * h, y1 = s.y + s.vy * h - 0.5 * GRAVITY * h * h, z1 = s.z + s.vz * h;
        const c = this.collideSeg(s.x, s.y, s.z, x1, y1, z1, s.owner, s.team);
        if (c) {
          this.shellImpact(s, s.x + (x1 - s.x) * c.t, s.y + (y1 - s.y) * c.t, s.z + (z1 - s.z) * c.t, c);
          done = true;
          break;
        }
        s.x = x1;
        s.y = y1;
        s.z = z1;
        s.vy -= GRAVITY * h;
        s.life += h;
      }
      if (!done && m && m.alive && !s.whiz && s.owner !== m.id && s.team !== m.team && Math.hypot(s.x - m.x, s.z - m.z) < 7) {
        s.whiz = true;
        sfx.whiz(s.x, s.z);
      }
      if (done || s.life > 3.2 || Math.abs(s.x) > ARENA + 80 || Math.abs(s.z) > ARENA + 80) this.shells.splice(i, 1);
    }
    this.fx.drawShells(this.shells, true);
  }

  shellImpact(s, x, y, z, c) {
    this.ended.set(s.key, this.time);
    const auth = this.isAuthForShell(s);
    if (c.kind === 'tank') {
      const tank = c.tank;
      const decides = tank.kind === 'player' ? tank.id === this.myId : auth;
      // dik açıyla gelmeyen zırh delici mermi sekebilir
      const rico = !s.he && c.face !== 3 && c.cosI < 0.3;
      if (rico) {
        const sp = Math.hypot(s.vx, s.vy, s.vz) || 1;
        this.fx.ricochet(x, y, z, (s.vx / sp) * 0.4 + rand(-0.4, 0.4), 0.5, (s.vz / sp) * 0.4 + rand(-0.4, 0.4));
        sfx.ricochet(x, z);
      } else {
        this.fx.impact(x, y, z, 'metal');
        sfx.metal(x, z, true, tank.id === this.myId);
      }
      tank.view.hit(angDiff(tank.a, Math.atan2(s.vz, s.vx)));
      if (decides) this.applyHit(tank, s, x, y, z, c, rico);
    } else if (c.kind === 'obs') {
      const o = c.o;
      const kind = o.kind === 'rock' ? 'rock' : ['wall', 'crate', 'house', 'barn', 'cabin', 'jersey', 'tower', 'tent', 'hay'].includes(o.kind) ? 'wall' : 'metal';
      if (kind === 'metal') {
        this.fx.sparks(x, y, z, 14, 9);
        sfx.metal(x, z, false);
      } else {
        this.fx.impact(x, y, z, kind);
        sfx.thud(x, z);
      }
      if (o.kind === 'barrel' && auth) {
        if (this.isHost) this.hostBarrel(o.bid, s.owner);
        else this.session.send({ t: 'barrel', b: o.bid, by: s.owner });
      }
    } else if (this.world.inWater(x, z)) {
      this.fx.impact(x, y, z, 'water');
      sfx.splash(x, z);
    } else {
      this.fx.impact(x, y, z, 'ground');
      sfx.thud(x, z);
      this.stage.scorch(x, z, s.he ? 1.6 : 0.8);
    }
    if (s.he) {
      if (!this.world.inWater(x, z)) {
        this.fx.explosion(x, this.world.height(x, z), z, 0.55);
        this.stage.scorch(x, z, 1.8);
      }
      sfx.explosion(x, z, 0.5);
      if (auth) {
        const m = { t: 'ex', x: q2(x), z: q2(z), by: s.owner, k: s.key, d: Math.round(s.baseDmg * AMMO.he.splashMul) };
        this.onExplosion(m);
        this.emit(m);
      }
    }
  }

  // yetkili cihaz isabeti hesaplar ve bildirir
  applyHit(tank, s, x, y, z, c, rico) {
    const face = c.face === 3 ? 2 : c.face;
    const mul = tank.spec.armor[face] || 1;
    const dmg = rico ? 0 : Math.round(s.dmg * mul * rand(0.88, 1.12));
    const m = { t: 'hit', v: tank.id, by: s.owner, d: dmg, x: q2(x), y: q2(y), z: q2(z), k: s.key, f: c.face, r: rico ? 1 : 0 };
    if (tank.kind === 'player') {
      this.directHits.add(s.key);
      this.emit(m);
      this.damageMe(dmg, s.owner, x, z, rico);
    } else {
      if (s.owner === this.myId) this.hitFeedback(tank, dmg, c.face, rico, x, y, z);
      if (this.isHost) {
        this.session.broadcast(m);
        this.damageBot(tank, dmg, s.owner);
      } else this.session.send(m);
    }
  }

  // atan oyuncuya isabet geri bildirimi
  hitFeedback(tank, dmg, face, rico, x, y, z) {
    if (rico) {
      this.ui.hitInfo('SEKTİ!', 'rico');
      sfx.hitMarker('rico');
      return;
    }
    this.stats.hits++;
    this.stats.dmg += dmg;
    const lethal = tank.alive && tank.hp - dmg <= 0;
    this.ui.hitMarker(lethal);
    sfx.hitMarker(lethal ? 'kill' : 'hit');
    this.ui.dmgNumber(x, y + 1, z, dmg, face === 2 || face === 3);
    this.ui.hitInfo(face === 2 || face === 3 ? 'KRİTİK VURUŞ' : 'DELİNDİ', face === 2 || face === 3 ? 'crit' : 'hit');
  }

  damageMe(d, by, x, z, rico) {
    const m = this.me;
    if (!m || !m.alive || m.protT > 0 || this.over) return;
    if (x != null) this.ui.damageDir(angDiff(this.cam.yaw, Math.atan2(z - m.z, x - m.x)));
    if (rico) {
      this.ui.hitInfo('Zırhından sekti', 'rico');
      this.shake = Math.max(this.shake, 0.3);
      return;
    }
    m.hp -= d;
    this.stats.taken += d;
    m.view.hit();
    this.shake = Math.max(this.shake, 0.6);
    this.app.vibrate(60);
    this.ui.flashDamage();
    if (m.hp <= 0) this.killMe(by);
    else this.sendState();
  }

  killMe(by) {
    const m = this.me;
    m.alive = false;
    m.hp = 0;
    m.respawnT = 4;
    m.deadT = 0;
    this.cam.zoom = false;
    this.tankDeathFx(m);
    this.shake = 1;
    this.app.vibrate(250);
    const k = this.tanks.get(by);
    this.ui.banner('İMHA EDİLDİN', k ? `${k.name} tarafından` : '', 2.2);
    if (this.mode === 'coop') this.ui.dead(true, null, 'Sonraki dalgada geri döneceksin');
    else this.ui.dead(true, 4);
    if (this.isHost) this.hostRecordDeath(this.myId, by);
    else {
      this.sendState();
      this.session.send({ t: 'die', v: this.myId, by });
    }
  }

  damageBot(t, d, by) {
    if (!t.alive || t.protT > 0) return;
    t.hp -= d;
    if (t.brain) t.brain.onHit(by);
    if (t.hp <= 0) {
      t.hp = 0;
      t.alive = false;
      t.deadT = 0;
      t.respawnT = 4;
      this.tankDeathFx(t);
      this.hostRecordDeath(t.id, by);
    }
  }

  tankDeathFx(t) {
    const y = this.world.height(t.x, t.z);
    const size = t.type === 'boss' ? 1.9 : t.type === 'heavy' || t.type === 'eheavy' ? 1.35 : 1.1;
    this.fx.explosion(t.x, y, t.z, size);
    sfx.explosion(t.x, t.z, size);
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
      this.fx.explosion(x, this.world.height(x, z), z, 0.55);
      sfx.explosion(x, z, 0.5);
      this.stage.scorch(x, z, 1.8);
    }
    this.splash(x, z, AMMO.he.splash, num(m.d) || 18, m.by, m.k);
  }

  // alan hasarı: herkes kendi tankına, oda sahibi botlara uygular
  splash(x, z, R, dmg, by, key) {
    const att = this.tanks.get(by);
    const me = this.me;
    if (me && me.alive && by !== this.myId && !(key && this.directHits.has(key)) && (!att || this.hostile(att, me))) {
      const d = Math.hypot(me.x - x, me.z - z) - me.r * 0.6;
      if (d < R) this.damageMe(Math.round(dmg * (1 - Math.max(0, d) / R)), by, x, z);
    }
    if (this.isHost) {
      for (const t of this.tanks.values()) {
        if (t.kind === 'player' || !t.alive || t.id === by) continue;
        if (att && !this.hostile(att, t)) continue;
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
        const x = num(m.x) / 100, y = num(m.y) / 100, z = num(m.z) / 100;
        const v = this.tanks.get(m.v);
        if (!this.ended.has(m.k)) {
          this.ended.set(m.k, this.time);
          if (this.removeShell(m.k)) {
            if (m.r) {
              this.fx.ricochet(x, y, z, rand(-0.5, 0.5), 0.5, rand(-0.5, 0.5));
              sfx.ricochet(x, z);
            } else {
              this.fx.impact(x, y, z, 'metal');
              sfx.metal(x, z, true);
            }
          }
        }
        if (v) v.view.hit();
        if (m.by === this.myId && m.v !== this.myId && v) this.hitFeedback(v, num(m.d), m.f, !!m.r, x, y, z);
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
      case 'smoke':
        if (m.o !== this.myId) this.onSmoke(m);
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
      this.stats.kills++;
      this.ui.killNotice(vt.name, vt.kind === 'enemy' ? TYPES[vt.type].score : 100);
    }
  }

  // ---------- oda sahibi (host) ----------
  hostInit() {
    this.nextEnemy = 1000;
    this.nextPickup = 1;
    this.pickupT = 8;
    this.waveState = { queue: [], spawnT: 0, breakT: this.wave ? 0 : 3.5, active: false };
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
      case 'smoke':
        if (m.o !== from) return;
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
    const st = { T: performance.now(), x: num(s[0]) / 100, z: num(s[1]) / 100, a: num(s[2]) / 1000, ta: num(s[3]) / 1000, e: num(s[4]) / 1000 };
    this.applyRemote(t, st, num(s[5]), num(s[6]));
    t.last = s;
  }

  applyRemote(t, st, hp, flags) {
    const alive = !!(flags & 1);
    t.flags = flags;
    t.hp = hp;
    if (alive && !t.alive) {
      t.alive = true;
      t.seen = true;
      t.buf = [];
      t.x = st.x;
      t.z = st.z;
      t.a = st.a;
      t.ta = st.ta;
      t.baseY = this.world.height(st.x, st.z);
      t.view.revive();
      t.view.root.visible = true;
      t.view.lastA = null;
      this.fx.spawnFx(st.x, t.baseY, st.z, t.color);
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
    this.session.broadcast({ t: 'kill', v, by });
    this.onKill(v, by);
    if (vt && vt.kind === 'enemy' && Math.random() < 0.14) this.spawnPickup(vt.x, vt.z, 'repair');
    this.checkEnd();
  }

  hostPick(pid, id) {
    const p = this.pickups.get(id);
    const t = this.tanks.get(pid);
    if (!p || !t || !t.alive) return;
    this.session.broadcast({ t: 'pk', id, by: pid });
    this.onPickupTaken(id, pid);
  }

  hostBarrel(b, by) {
    const o = this.world.barrels[b];
    if (!o || !o.alive) return;
    this.session.broadcast({ t: 'boom', b, by });
    this.barrelGone(b, by, true);
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
    sfx.explosion(o.x, o.z, 1);
    this.stage.scorch(o.x, o.z, 2.4);
    this.splash(o.x, o.z, BARREL.splash, BARREL.dmg, by, null);
    const d = Math.hypot(o.x - this.cam.pos.x, o.z - this.cam.pos.z);
    this.shake = Math.max(this.shake, clamp(1 - d / 40, 0, 0.7));
  }

  hostUpdate(dt) {
    for (const t of [...this.tanks.values()]) {
      if (!t.local || t.kind === 'player') continue;
      this.timers(t, dt);
      if (!t.alive) {
        t.deadT += dt;
        if (t.kind === 'bot' && t.deadT > 4 && !this.over) {
          this.placeAtSpawn(t, this.bestSpawn(t));
          t.protT = 2;
        } else if (t.kind === 'enemy' && t.deadT > 8) this.removeTank(t.id);
        continue;
      }
      if (this.over) continue;
      const c = t.brain.update(dt);
      const pa = t.a;
      this.drive(t, c.throttle, c.steer, dt);
      t.turnRate = angDiff(pa, t.a) / Math.max(dt, 1e-3);
      const pta = t.ta;
      t.ta = turnTo(t.ta, c.aim != null ? c.aim : t.a, t.spec.turret * dt);
      t.turretRate = Math.abs(angDiff(pta, t.ta)) / Math.max(dt, 1e-3);
      t.elev += clamp((c.elev ?? 0) - t.elev, -t.spec.elev * dt, t.spec.elev * dt);
      this.updateDispersion(t, dt);
      if (c.fire && t.reload <= 0) this.fire(t);
      if (c.smoke && t.smokeCd <= 0) {
        t.smokeCd = CONSUMABLES.smoke.cd * 1.4;
        const msg = { t: 'smoke', o: t.id, x: q2(t.x), z: q2(t.z) };
        this.onSmoke(msg);
        this.session.broadcast(msg);
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
        this.pickupT = rand(12, 18);
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
        if (t.local) p.push([t.id, q2(t.x), q2(t.z), q3(t.a), q3(t.ta), q3(t.elev), Math.max(0, Math.round(t.hp)), this.flagsOf(t)]);
        else if (t.last) p.push([t.id, ...t.last]);
      } else {
        b.push([t.id, TYPE_LIST.indexOf(t.type), q2(t.x), q2(t.z), q3(t.a), q3(t.ta), q3(t.elev), Math.max(0, Math.round(t.hp)), this.flagsOf(t), t.maxHp]);
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
    for (const r of sc) if (Array.isArray(r)) this.scores.set(r[0], { k: num(r[1]), d: num(r[2]), s: num(r[3]) });
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
        this.applyRemote(t, { T, x: num(r[1]) / 100, z: num(r[2]) / 100, a: num(r[3]) / 1000, ta: num(r[4]) / 1000, e: num(r[5]) / 1000 }, num(r[6]), num(r[7]));
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
          const type = TYPE_LIST[num(r[1])] || 'emedium';
          if (id < 1000) t = this.addBot(this.botInfo.get(id) || { id, name: 'Bot', color: '#7E8A5A', tank: type });
          else t = this.addEnemy(id, type);
        }
        if (r[9]) t.maxHp = num(r[9]);
        this.applyRemote(t, { T, x: num(r[2]) / 100, z: num(r[3]) / 100, a: num(r[4]) / 1000, ta: num(r[5]) / 1000, e: num(r[6]) / 1000 }, num(r[7]), num(r[8]));
      }
    }
    for (const t of [...this.tanks.values()]) {
      if (t.kind === 'player' || seenB.has(t.id)) continue;
      this.removeTank(t.id);
    }
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

  updateRemotes(dt) {
    const now = performance.now();
    const rt = this.isHost ? now - INTERP_DELAY : now - (this.clockOffset || 0) - INTERP_DELAY;
    for (const t of this.tanks.values()) {
      if (t.local) continue;
      const b = t.buf;
      if (!b.length) continue;
      const px = t.x, pz = t.z, pa = t.a, pta = t.ta;
      while (b.length > 2 && b[1].T <= rt) b.shift();
      const s0 = b[0];
      let x, z, a, ta, e;
      if (b.length >= 2 && s0.T <= rt) {
        const s1 = b[1];
        const k = clamp((rt - s0.T) / Math.max(1, s1.T - s0.T), 0, 1.15);
        x = lerp(s0.x, s1.x, k);
        z = lerp(s0.z, s1.z, k);
        a = lerpAng(s0.a, s1.a, k);
        ta = lerpAng(s0.ta, s1.ta, k);
        e = lerp(s0.e || 0, s1.e || 0, k);
      } else {
        x = s0.x;
        z = s0.z;
        a = s0.a;
        ta = s0.ta;
        e = s0.e || 0;
      }
      t.x = x;
      t.z = z;
      t.a = a;
      t.ta = ta;
      t.elev = e;
      t.seen = true;
      t.baseY = this.world.height(x, z);
      const k = damp(6, dt);
      t.vx = lerp(t.vx, (x - px) / Math.max(dt, 1e-3), k);
      t.vz = lerp(t.vz, (z - pz) / Math.max(dt, 1e-3), k);
      t.speed = Math.hypot(t.vx, t.vz);
      t.turnRate = angDiff(pa, a) / Math.max(dt, 1e-3);
      t.turretRate = Math.abs(angDiff(pta, ta)) / Math.max(dt, 1e-3);
      t.protT = t.flags & 16 ? 1 : 0;
      t.rapidT = t.flags & 8 ? 1 : 0;
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
    if (!type) type = Math.random() < 0.6 ? 'repair' : 'rapid';
    this.addPickup(this.nextPickup++, type, x, z);
  }

  addPickup(id, type, x, z) {
    const col = PICKUPS[type].color;
    const g = new THREE.Group();
    const crate = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.8, 1.1), new THREE.MeshStandardMaterial({ color: '#3f4435', roughness: 0.55, metalness: 0.35 }));
    const band = new THREE.Mesh(new THREE.BoxGeometry(1.14, 0.2, 1.14), new THREE.MeshBasicMaterial({ color: col, toneMapped: false }));
    const iconMat = new THREE.MeshBasicMaterial({ color: col, toneMapped: false });
    const icon = new THREE.Group();
    if (type === 'repair') {
      const b1 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.16), iconMat);
      const b2 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.16), iconMat);
      icon.add(b1, b2);
    } else icon.add(new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.55, 3), iconMat));
    icon.position.y = 0.8;
    crate.castShadow = true;
    g.add(crate, band, icon);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.9, 7, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
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
      else t.rapidT = PICKUPS.rapid.time;
    }
    if (by === this.myId) {
      sfx.pickup();
      this.ui.hitInfo(PICKUPS[type].label, 'good');
      this.app.vibrate(25);
      this.sendState();
    }
  }

  updatePickups(dt) {
    for (const p of this.pickups.values()) {
      p.t += dt;
      p.g.position.y = p.y + 0.75 + Math.sin(p.t * 2.2) * 0.18;
      for (let i = 0; i < 3; i++) p.g.children[i].rotation.y = p.t * (i === 2 ? -1.6 : 0.9);
      p.g.visible = !(p.life < 5 && Math.floor(p.t * 6) % 2);
      if (Math.random() < dt * 3) this.fx.sparkle(p.x, p.y + 0.4, p.z, PICKUPS[p.type].color);
    }
  }

  // ---------- dalgalar ----------
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
    const maxAlive = 5 + 2 * this.playerCount();
    W.spawnT -= dt;
    if (W.queue.length && W.spawnT <= 0 && alive < maxAlive) {
      this.spawnEnemy(W.queue.shift());
      W.spawnT = rand(0.8, 1.8);
    }
    if (!W.queue.length && alive === 0) {
      W.active = false;
      W.breakT = 5;
      this.ui.banner('Dalga temizlendi!', 'Sıradaki dalga geliyor…', 2);
    }
  }

  startWave() {
    const W = this.waveState;
    const n = this.wave + 1;
    const np = this.playerCount();
    const count = Math.round((2.5 + n * 1.4) * (1 + 0.45 * (np - 1)));
    const q = [];
    for (let i = 0; i < count; i++) {
      const r = Math.random();
      const pH = n >= 4 ? Math.min(0.3, 0.045 * n) : 0;
      const pM = n >= 2 ? Math.min(0.45, 0.12 * n) : 0;
      q.push(r < pH ? 'eheavy' : r < pH + pM ? 'emedium' : 'elight');
    }
    const boss = n % 5 === 0;
    if (boss) q.splice(2, 0, 'boss');
    W.queue = q;
    W.active = true;
    W.spawnT = 1;
    this.session.broadcast({ t: 'wave', n, boss: boss ? 1 : 0 });
    this.onWave(n, boss);
  }

  onWave(n, boss) {
    if (n <= this.wave && this.wave) return;
    this.wave = n;
    sfx.horn();
    this.ui.banner('Dalga ' + n, boss ? 'KOMUTAN TANKI geliyor!' : n === 1 ? 'Düşmanlar kenarlardan geliyor' : '', 2.4);
    const m = this.me;
    if (m) {
      if (!m.alive) this.spawnMe();
      else if (n > 1) {
        m.hp = Math.min(m.maxHp, m.hp + 35);
        this.sendState();
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
    this.session.broadcast({ t: 'sc', sc: this.packScores() });
    this.session.broadcast({ t: 'end', r });
    setTimeout(() => !this.disposed && this.finish(r), 50);
  }

  finish(r) {
    if (this.over) return;
    this.over = true;
    this.cam.zoom = false;
    sfx.engineSet(0, 0, false, 0, 0.1);
    setTimeout(() => {
      if (!this.disposed) this.app.matchEnded(r, this);
    }, 1600);
  }

  // ---------- görseller ----------
  updateVisuals(dt) {
    const camX = this.cam.pos.x, camZ = this.cam.pos.z;
    for (const t of this.tanks.values()) {
      const shown = t.seen && (t.alive || t.deadT < 12);
      t.view.update(dt, { x: t.x, z: t.z, a: t.a, ta: t.ta, elev: t.elev, prot: t.protT > 0, visible: shown && !(t === this.me && this.cam.zoom) }, this.world);
      if (!shown) continue;
      const near = Math.hypot(t.x - camX, t.z - camZ) < 80;
      if (!t.alive) {
        if (!t.local) t.deadT += dt;
        t.fireT -= dt;
        if (near && t.deadT < 8 && t.fireT <= 0) {
          t.fireT = 0.05;
          this.fx.fire(t.x, t.baseY + 0.9 * t.spec.scale, t.z, t.spec.scale * Math.max(0.3, 1 - t.deadT / 8));
        }
        continue;
      }
      if (!near) continue;
      const sp = Math.hypot(t.vx, t.vz);
      const c = Math.cos(t.a), s = Math.sin(t.a);
      const L = t.hl, wz = t.view.g.trackZ * t.spec.scale;
      const gy = t.baseY;
      const wet = this.world.inWater(t.x, t.z);
      t.trackD += sp * dt;
      if (t.trackD > 0.9) {
        t.trackD = 0;
        this.stage.trackMark(t.x - c * L * 0.7, t.z - s * L * 0.7, t.a, wz * 2 + 0.5, this.theme.snow ? 0.5 : 0.34);
      }
      t.dustT -= dt;
      if (sp > 1.2 && t.dustT <= 0) {
        t.dustT = 0.07;
        const amt = Math.min(1.5, sp / 7) * (this.theme.snow ? 1.2 : this.theme.trees[0] === 'palm' ? 1.6 : 0.9);
        for (const side of [-1, 1]) {
          const x = t.x - c * L - s * wz * side, z = t.z - s * L + c * wz * side;
          if (wet) this.fx.splash(x, gy, z, amt);
          else this.fx.dust(x, gy, z, amt, -c * sp * 0.2, -s * sp * 0.2);
        }
      }
      t.exT -= dt;
      if (t.exT <= 0) {
        const hard = Math.abs(t.view.acc || 0) > 1.5;
        t.exT = hard ? 0.05 : sp > 1 ? 0.14 : 0.32;
        const ex = t.x - c * (L + 0.1), ez = t.z - s * (L + 0.1);
        this.fx.exhaust(ex, gy + 0.9 * t.spec.scale, ez, -c, -s, hard);
      }
    }
  }

  updateCamera(dt) {
    const m = this.me, c = this.cam, cam = this.stage.camera;
    if (!m) return;
    if (!m.alive) c.yaw += dt * 0.15;
    const portrait = this.stage.h > this.stage.w;
    const D = this.camDir(TV2);
    if (c.zoom && m.alive) {
      // dürbün: nişancı görüşü (taretin üstünden)
      const gx = m.x + Math.cos(m.a) * m.gunX, gz = m.z + Math.sin(m.a) * m.gunX;
      c.pos.set(gx + Math.cos(c.yaw) * 1.2, m.baseY + m.gunH + 0.6, gz + Math.sin(c.yaw) * 1.2);
      c.init = true;
    } else {
      const dist = (m.alive ? c.dist : 16) * (portrait ? 1.25 : 1) * (0.9 + m.spec.scale * 0.1);
      const pivotY = m.baseY + m.hh + 0.9;
      TV3.set(m.x - D.x * dist, pivotY - D.y * dist + 0.2, m.z - D.z * dist);
      TV3.y = Math.max(TV3.y, this.world.height(TV3.x, TV3.z) + 0.9);
      if (!c.init) {
        c.pos.copy(TV3);
        c.init = true;
      }
      c.pos.lerp(TV3, damp(14, dt));
    }
    cam.position.copy(c.pos);
    this.shake = Math.max(0, this.shake - dt * 2.4);
    if (this.shake > 0 && this.app.settings.shake) {
      const s = this.shake * this.shake * (c.zoom ? 0.12 : 0.45);
      cam.position.x += rand(-s, s);
      cam.position.y += rand(-s, s);
      cam.position.z += rand(-s, s);
    }
    TV1.copy(cam.position).addScaledVector(D, 50);
    cam.lookAt(TV1);
    const baseFov = c.zoom ? (portrait ? 30 : CAMERA.zoomFov) : this.stage.baseFov;
    c.fov = c.zoom ? baseFov : lerp(c.fov || baseFov, baseFov + clamp(Math.abs(m.speed) / m.spec.speed, 0, 1) * 4, damp(4, dt));
    if (Math.abs(cam.fov - c.fov) > 0.05) {
      cam.fov = c.fov;
      cam.updateProjectionMatrix();
    }
    this.stage.setFadeTarget(c.zoom ? null : m.x, m.baseY + 1.2, m.z);
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
    const cam = this.stage.camera;
    cam.fov = this.stage.baseFov;
    cam.updateProjectionMatrix();
  }
}
