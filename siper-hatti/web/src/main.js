// Uygulama: ekranlar arası akış, garaj sahnesi, ilerleme (seviye/TP), ana döngü ve ayarlar.
import * as THREE from 'three';
import { Stage } from './scene.js';
import { FX } from './fx.js';
import { UI } from './ui.js';
import { Input } from './input.js';
import { Net, LocalNet, errText } from './net.js';
import { Session } from './session.js';
import { Game } from './game.js';
import { World } from './world.js';
import { TankView } from './tankModel.js';
import { sfx } from './audio.js';
import { PLAYER_COLORS, THEMES, THEME_LIST, PROTOCOL, ROOM_ALPHABET, TYPES, CLASS_LIST, levelXp } from './config.js';
import { cleanName, damp, lerp } from './util.js';

const $ = id => document.getElementById(id);
const native = window.SiperNative || null;

function loadSettings() {
  let s = {};
  try {
    s = JSON.parse(localStorage.getItem('siper_settings') || '{}') || {};
  } catch (e) {}
  const d = {
    name: '', color: PLAYER_COLORS[(Math.random() * 5) | 0].hex, tank: 'medium', quality: 'auto', volume: 0.85,
    brightness: 1, sens: 1, assist: true, invertY: false, vibrate: true, shake: true, fps: false, xp: 0,
    stats: { matches: 0, wins: 0, kills: 0, bestWave: 0 },
    soloCfg: { mode: 'coop', theme: 'random', diff: 1, bots: 3, limit: 10, time: 6 },
    roomCfg: { mode: 'coop', theme: 'random', diff: 1, bots: 0, limit: 10, time: 6 },
  };
  const out = Object.assign(d, s);
  if (!CLASS_LIST.includes(out.tank)) out.tank = 'medium';
  return out;
}

function resolveQuality(q) {
  if (q !== 'auto') return q;
  const mobile = matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad/i.test(navigator.userAgent);
  if (!mobile) return 'high';
  const cores = navigator.hardwareConcurrency || 4, mem = navigator.deviceMemory || 4;
  return cores <= 4 || mem < 3 ? 'low' : 'medium';
}

export const levelOf = xp => {
  let l = 1;
  while (xp >= levelXp(l + 1) && l < 99) l++;
  return l;
};

class App {
  constructor() {
    this.settings = loadSettings();
    this.autoplay = new URLSearchParams(location.search).has('autoplay');
    this.soloCfg = this.settings.soloCfg;
    this.quality = resolveQuality(this.settings.quality);
    this.stage = new Stage($('gl'), this.quality, this.settings.brightness);
    this.fx = new FX(this.stage);
    this.input = new Input({
      layer: $('touch'), canvas: $('gl'), joy: $('joy'), fire: $('btnFire'),
      buttons: { ap: $('btnAP'), he: $('btnHE'), zoom: $('btnZoom'), smoke: $('btnSmoke'), repair: $('btnRepair') },
    });
    this.input.onAction = a => this.onAction(a);
    if (this.input.touchMode) document.body.classList.add('touch');
    this.session = null;
    this.net = null;
    this.game = null;
    this.paused = false;
    this.menu = null;
    this.last = 0;
    this.frameAvg = 1 / 60;
    this.slowT = 0;
    this.fastT = 0;
    this.ui = new UI(this);
    this.applySettings();
    this.buildMenuScene();
    this.wireGarageDrag();
    this.frame = this.frame.bind(this);
    requestAnimationFrame(this.frame);
    addEventListener('resize', () => this.stage.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        sfx.suspend(true);
        if (this.game && this.session && this.session.solo && !this.game.over && !this.paused) this.togglePause(true);
      } else sfx.suspend(false);
    });
    document.addEventListener('pointerdown', () => setTimeout(() => sfx.ambienceStart(0.7), 50), { once: true });
    window.onAndroidBack = () => this.back();
    addEventListener('pagehide', () => this.net && !this.net.offline && this.net.close());
    setTimeout(() => this.ui.loaded(), 350);
    const code = new URLSearchParams(location.search).get('oda');
    if (code) {
      this.ui.show('scrJoin');
      $('codeIn').value = code.toUpperCase().slice(0, 4);
    }
  }

  get level() {
    return levelOf(this.settings.xp || 0);
  }

  saveSettings() {
    try {
      localStorage.setItem('siper_settings', JSON.stringify(this.settings));
    } catch (e) {}
  }
  applySettings() {
    const S = this.settings;
    $('fps').hidden = !S.fps;
    sfx.setVolume(S.volume);
    this.input.sens = S.sens;
    this.input.invertY = S.invertY;
  }
  setProfile(p) {
    if (p.name != null) this.settings.name = cleanName(p.name);
    if (p.color) {
      this.settings.color = p.color;
      if (this.menu && this.menu.tank) this.menu.tank.setColor(p.color);
    }
    this.saveSettings();
  }
  get myName() {
    return this.settings.name || 'Komutan';
  }
  vibrate(ms) {
    if (!this.settings.vibrate) return;
    try {
      if (native && native.vibrate) native.vibrate(ms);
      else if (navigator.vibrate) navigator.vibrate(ms);
    } catch (e) {}
  }

  onAction(a) {
    if (a === 'pause') return this.togglePause();
    if (a === 'score+') return this.game && this.ui.toggleScoreboard(true, this.game);
    if (a === 'score-') return this.ui.toggleScoreboard(false);
    if (this.game && !this.paused) this.game.action(a);
  }

  // ---------- garaj sahnesi ----------
  buildMenuScene() {
    this.clearMenuScene();
    const theme = THEME_LIST[(Math.random() * THEME_LIST.length) | 0];
    const world = new World(424242 + ((Math.random() * 1000) | 0), THEMES[theme], 'coop');
    this.stage.buildWorld(world);
    this.fx.clear();
    this.fx.setTheme(THEMES[theme]);
    const g = new THREE.Group();
    const y = world.height(0, 0);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(3.8, 4.1, 0.3, 48), new THREE.MeshStandardMaterial({ color: '#2a3038', roughness: 0.45, metalness: 0.7 }));
    disc.position.y = y + 0.1;
    disc.receiveShadow = true;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.95, 0.05, 8, 64), new THREE.MeshBasicMaterial({ color: '#ffb23f', toneMapped: false }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y + 0.26;
    g.add(disc, ring);
    this.stage.scene.add(g);
    this.menu = { world, platform: g, tank: null, t: 0, spin: 0.6, spinV: 0.12, boomT: 3, y };
    this.garageTankChanged();
  }
  garageTankChanged() {
    const M = this.menu;
    if (!M) return;
    if (M.tank) M.tank.dispose();
    const spec = TYPES[this.settings.tank] || TYPES.medium;
    M.tank = new TankView(this.stage, this.settings.tank, spec.model, this.settings.color, spec.scale * 1.15);
  }
  clearMenuScene() {
    if (!this.menu) return;
    if (this.menu.tank) this.menu.tank.dispose();
    this.stage.scene.remove(this.menu.platform);
    this.menu.platform.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    this.menu = null;
  }
  wireGarageDrag() {
    const scr = $('scrMenu');
    let last = null;
    scr.addEventListener('pointerdown', e => {
      if (e.target !== scr && !e.target.classList.contains('garage')) return;
      last = e.clientX;
    });
    addEventListener('pointermove', e => {
      if (last == null || !this.menu) return;
      this.menu.spinV = (e.clientX - last) * 0.25;
      this.menu.spin += (e.clientX - last) * 0.01;
      last = e.clientX;
    });
    addEventListener('pointerup', () => (last = null));
  }
  menuUpdate(dt) {
    const M = this.menu;
    if (!M) return;
    M.t += dt;
    M.spinV = lerp(M.spinV, 0.12, damp(1.5, dt));
    M.spin += M.spinV * dt;
    const ta = M.spin + Math.sin(M.t * 0.5) * 0.6;
    M.tank.update(dt, { x: 0, z: 0, a: M.spin, ta, elev: 0.04 + Math.sin(M.t * 0.7) * 0.05 }, M.world);
    M.tank.root.position.y = M.y + 0.25;
    const cam = this.stage.camera;
    const wide = this.stage.w > this.stage.h;
    const ang = 2.4 + Math.sin(M.t * 0.05) * 0.2;
    const r = wide ? 11.5 : 14;
    cam.position.set(Math.cos(ang) * r, M.y + (wide ? 3.6 : 5), Math.sin(ang) * r);
    cam.lookAt(0, M.y + (wide ? 2.1 : 3.2), 0);
    M.boomT -= dt;
    if (M.boomT <= 0) {
      M.boomT = 3 + Math.random() * 5;
      const a = Math.random() * 6.28, d = 30 + Math.random() * 18;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      this.fx.explosion(x, M.world.height(x, z), z, 0.7 + Math.random() * 0.5);
      if (Math.random() < 0.5) sfx.distantBattle();
    }
    if (Math.random() < dt * 2.5) {
      const c = Math.cos(M.spin), s = Math.sin(M.spin);
      this.fx.exhaust(-2.2 * c, M.y + 1.2, -2.2 * s, -c, -s, false);
    }
  }

  // ---------- oda akışları ----------
  async hostRoom() {
    sfx.unlock();
    if (this.busy) return;
    this.busy = true;
    this.ui.show('scrLobby');
    $('roomCode').textContent = '····';
    $('lobbyMsg').textContent = 'Oda kuruluyor…';
    $('plist').textContent = '';
    $('lobbyOpts').textContent = '';
    $('startBtn').hidden = true;
    $('readyBtn').hidden = true;
    const net = new Net();
    try {
      await net.host();
    } catch (e) {
      net.close();
      this.busy = false;
      this.ui.toast(errText(e), 4000);
      this.ui.show('scrMenu', false);
      this.ui.stack = [];
      return;
    }
    this.busy = false;
    this.net = net;
    this.session = new Session(this, net, this.settings.roomCfg);
    this.session.hostSetup(this.myName, this.settings.color, this.settings.tank);
    this.ui.renderLobby(this.session);
  }

  async joinRoom(code) {
    sfx.unlock();
    code = String(code || '').toUpperCase().trim();
    if (code.length !== 4 || [...code].some(c => !ROOM_ALPHABET.includes(c))) {
      $('joinMsg').textContent = 'Oda kodu 4 karakter olmalı (ör. K7QX).';
      return;
    }
    if (this.busy) return;
    this.busy = true;
    $('joinMsg').textContent = 'Bağlanılıyor…';
    $('joinBtn').disabled = true;
    const net = new Net();
    try {
      await net.join(code);
    } catch (e) {
      this.busy = false;
      $('joinBtn').disabled = false;
      $('joinMsg').textContent = errText(e);
      return;
    }
    this.busy = false;
    $('joinBtn').disabled = false;
    this.net = net;
    this.session = new Session(this, net);
    this.session.code = code;
    net.sendHost({ t: 'join', v: PROTOCOL, name: this.myName, color: this.settings.color, tank: this.settings.tank });
    this.ui.show('scrLobby');
    this.ui.renderLobby(this.session);
  }

  startSolo() {
    sfx.unlock();
    const net = new LocalNet();
    this.net = net;
    this.session = new Session(this, net, this.soloCfg);
    this.session.hostSetup(this.myName, this.settings.color, this.settings.tank);
    this.session.startMatch();
  }

  startGame(session, start) {
    if (this.game) this.game.dispose();
    this.clearMenuScene();
    this.paused = false;
    try {
      this.game = new Game(this, session, start);
    } catch (e) {
      console.error(e);
      this.ui.toast('Maç başlatılamadı: ' + e.message, 5000);
      this.game = null;
      this.buildMenuScene();
      return;
    }
    session.game = this.game;
  }

  // maç bitti: tecrübe puanı ve istatistikler
  matchEnded(r, g) {
    const S = this.settings;
    const st = g.stats;
    const win = r.mode === 'dm' && r.rows[0] && r.rows[0][0] === g.myId;
    const parts = [['Katılım', 40]];
    if (st.kills) parts.push(['İmha', st.kills * 60]);
    if (st.dmg) parts.push(['Hasar', Math.round(st.dmg * 0.8)]);
    if (r.mode === 'coop' && r.wave) parts.push(['Dalga', r.wave * 30]);
    if (win) parts.push(['Zafer', 150]);
    const gained = parts.reduce((a, p) => a + p[1], 0);
    const before = S.xp || 0;
    S.xp = before + gained;
    S.stats = S.stats || {};
    S.stats.matches = (S.stats.matches || 0) + 1;
    S.stats.kills = (S.stats.kills || 0) + st.kills;
    if (win) S.stats.wins = (S.stats.wins || 0) + 1;
    if (r.mode === 'coop') S.stats.bestWave = Math.max(S.stats.bestWave || 0, r.wave || 0);
    this.saveSettings();
    this.ui.renderProfile();
    this.ui.renderGarage();
    this.ui.showResults(r, g, { gained, parts, before, after: S.xp, levelBefore: levelOf(before), level: levelOf(S.xp) });
  }

  endGame() {
    if (this.game) {
      this.game.dispose();
      this.game = null;
    }
    if (this.session) this.session.game = null;
    this.paused = false;
    if (!this.menu) this.buildMenuScene();
  }

  backToLobby() {
    this.endGame();
    this.ui.hideScreens();
    this.ui.show('scrMenu', false);
    this.ui.show('scrLobby');
    this.ui.renderLobby(this.session);
  }

  leaveRoom() {
    if (this.session) this.session.close();
    this.session = null;
    this.net = null;
    this.endGame();
    this.ui.hideScreens();
    this.ui.show('scrMenu', false);
  }

  connectionLost(reason) {
    this.leaveRoom();
    this.ui.toast(reason || 'Bağlantı koptu.', 4500);
  }

  quitMatch() {
    const s = this.session;
    if (!s || s.solo) return this.leaveRoom();
    if (s.isHost) {
      if (this.game) this.game.over = true;
      s.backToLobby();
    } else this.leaveRoom();
  }

  again() {
    if (this.session && this.session.isHost) this.session.startMatch();
  }

  resultsLeave() {
    const s = this.session;
    if (!s || s.solo) return this.leaveRoom();
    if (s.isHost) s.backToLobby();
    else this.leaveRoom();
  }

  togglePause(force) {
    if (!this.game || this.game.over) return;
    const show = force != null ? force : this.ui.screen !== 'scrPause';
    const solo = this.session && this.session.solo;
    if (show) {
      this.ui.show('scrPause', false);
      this.ui.stack = [];
      $('pauseTitle').textContent = solo ? 'Duraklatıldı' : 'Menü';
      $('pauseHint').textContent = solo ? '' : 'Çevrimiçi maç arka planda sürüyor.';
      $('quitBtn').textContent = solo ? 'Maçtan Çık' : this.session.isHost ? 'Maçı Bitir (Lobiye Dön)' : 'Odadan Çık';
      this.input.setEnabled(false);
      this.paused = !!solo;
      if (solo) sfx.engineSet(0, 0, false, 0, 0.1);
    } else {
      this.ui.hideScreens();
      this.input.setEnabled(true);
      this.paused = false;
    }
  }

  back() {
    const scr = this.ui.screen;
    if (this.game && !this.game.over) {
      if (scr === 'scrSettings' || scr === 'scrHelp') {
        this.ui.back();
        return true;
      }
      this.togglePause();
      return true;
    }
    if (scr === 'scrResults') {
      this.resultsLeave();
      return true;
    }
    if (scr === 'scrLobby') {
      this.leaveRoom();
      return true;
    }
    if (scr && scr !== 'scrMenu') {
      if (!this.ui.back()) this.ui.show('scrMenu', false);
      return true;
    }
    return false;
  }

  toggleReady() {
    const s = this.session;
    if (!s || s.isHost) return;
    const me = s.players.find(p => p.id === s.myId);
    s.setReady(!(me && me.ready));
  }

  shareText() {
    return `Siper Hattı'nda tank savaşına gel! Oda kodu: ${this.session && this.session.code}`;
  }
  shareCode() {
    const text = this.shareText();
    if (native && native.share) return native.share(text);
    if (navigator.share) return navigator.share({ text }).catch(() => {});
    this.copyCode();
  }
  copyCode() {
    const code = this.session && this.session.code;
    if (!code) return;
    try {
      if (native && native.copy) native.copy(code);
      else navigator.clipboard.writeText(code);
      this.ui.toast('Oda kodu kopyalandı: ' + code);
    } catch (e) {
      this.ui.toast('Oda kodu: ' + code);
    }
  }

  // ---------- döngü ----------
  frame(t) {
    requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, (t - this.last) / 1000 || 1 / 60);
    this.last = t;
    try {
      this.input.pollPad(dt);
      if (this.game) {
        if (!this.paused) this.game.update(dt);
      } else this.menuUpdate(dt);
      const f = this.game && this.game.me ? this.game.me : { x: 0, z: 0 };
      this.stage.update(dt, f.x, f.z);
      if (!this.paused) this.fx.update(dt);
      this.stage.render();
      if (this.game) this.adapt(dt);
    } catch (e) {
      console.error(e);
      if (!this._errShown) {
        this._errShown = true;
        this.ui.toast('Hata: ' + e.message, 5000);
      }
    }
  }

  adapt(dt) {
    this.frameAvg = lerp(this.frameAvg, dt, damp(3, dt));
    if (this.frameAvg > 1 / 40) {
      this.slowT += dt;
      this.fastT = 0;
      if (this.slowT > 2) {
        this.slowT = 0;
        this.stage.setDpr(this.stage.dpr * 0.85);
      }
    } else if (this.frameAvg < 1 / 57) {
      this.fastT += dt;
      this.slowT = 0;
      if (this.fastT > 6) {
        this.fastT = 0;
        this.stage.setDpr(this.stage.dpr * 1.1);
      }
    } else this.slowT = this.fastT = 0;
  }
}

function boot() {
  try {
    window.app = new App();
  } catch (e) {
    console.error(e);
    const l = document.getElementById('loading');
    if (l) l.querySelector('p').textContent = 'Başlatılamadı: ' + e.message + ' (WebGL desteği gerekli)';
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
