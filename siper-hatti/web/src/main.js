// Uygulama: ekranlar arası akış, menü sahnesi, ana döngü ve ayarlar.
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
import { PLAYER_COLORS, THEMES, THEME_LIST, PROTOCOL, ROOM_ALPHABET } from './config.js';
import { cleanName, damp, lerp } from './util.js';

const $ = id => document.getElementById(id);
const native = window.SiperNative || null;

function loadSettings() {
  let s = {};
  try {
    s = JSON.parse(localStorage.getItem('siper_settings') || '{}') || {};
  } catch (e) {}
  return Object.assign({
    name: '', color: PLAYER_COLORS[(Math.random() * PLAYER_COLORS.length) | 0].hex, quality: 'auto', volume: 0.8,
    vibrate: true, shake: true, fps: false,
    soloCfg: { mode: 'coop', theme: 'random', diff: 1, bots: 3, limit: 10, time: 6 },
    roomCfg: { mode: 'coop', theme: 'random', diff: 1, bots: 0, limit: 10, time: 6 },
  }, s);
}

function resolveQuality(q) {
  if (q !== 'auto') return q;
  const mobile = matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad/i.test(navigator.userAgent);
  if (!mobile) return 'high';
  const cores = navigator.hardwareConcurrency || 4, mem = navigator.deviceMemory || 4;
  return cores <= 4 || mem < 3 ? 'low' : 'medium';
}

class App {
  constructor() {
    this.settings = loadSettings();
    this.autoplay = new URLSearchParams(location.search).has('autoplay');
    this.soloCfg = this.settings.soloCfg;
    this.quality = resolveQuality(this.settings.quality);
    this.stage = new Stage($('gl'), this.quality);
    this.fx = new FX(this.stage);
    this.input = new Input({
      layer: $('touch'), canvas: $('gl'), joy: $('joy'),
      buttons: { fire: $('btnFire'), he: $('btnHe'), boost: $('btnBoost') },
    });
    this.input.onPause = () => this.togglePause();
    this.input.onScore = on => this.game && this.ui.toggleScoreboard(on, this.game);
    if (this.input.touchMode) document.body.classList.add('touch');
    this.ui = new UI(this);
    sfx.setVolume(this.settings.volume);
    this.session = null;
    this.net = null;
    this.game = null;
    this.paused = false;
    this.menu = null;
    this.last = 0;
    this.frameAvg = 1 / 60;
    this.slowT = 0;
    this.fastT = 0;
    this.buildMenuScene();
    this.frame = this.frame.bind(this);
    requestAnimationFrame(this.frame);
    addEventListener('resize', () => this.stage.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        sfx.suspend(true);
        if (this.game && this.session && this.session.solo && !this.game.over && !this.paused) this.togglePause(true);
      } else sfx.suspend(false);
    });
    window.onAndroidBack = () => this.back();
    this.ui.loaded();
    const code = new URLSearchParams(location.search).get('oda');
    if (code) {
      this.ui.show('scrJoin');
      $('codeIn').value = code.toUpperCase().slice(0, 4);
    }
  }

  saveSettings() {
    try {
      localStorage.setItem('siper_settings', JSON.stringify(this.settings));
    } catch (e) {}
  }
  applySettings() {
    $('fps').hidden = !this.settings.fps;
    sfx.setVolume(this.settings.volume);
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

  // ---------- menü sahnesi ----------
  buildMenuScene() {
    this.clearMenuScene();
    const theme = THEME_LIST[(Math.random() * THEME_LIST.length) | 0];
    const world = new World(424242 + ((Math.random() * 1000) | 0), THEMES[theme], 'coop');
    this.stage.buildWorld(world);
    this.fx.clear();
    this.fx.setTheme(THEMES[theme]);
    const tank = new TankView(this.stage, 'player', 'medium', this.settings.color, 1.25);
    this.menu = { world, tank, t: 0, boomT: 3, a: 0.4 };
  }
  clearMenuScene() {
    if (!this.menu) return;
    this.menu.tank.dispose();
    this.menu = null;
  }
  menuUpdate(dt) {
    const M = this.menu;
    if (!M) return;
    M.t += dt;
    const ta = Math.sin(M.t * 0.4) * 0.9;
    M.tank.update(dt, { x: 0, z: 0, a: M.a, ta: M.a + ta, alive: true }, M.world);
    const cam = this.stage.camera;
    const r = 13, ang = M.t * 0.07 + 2.2;
    const wide = this.stage.w > this.stage.h;
    // tank ekranın sağında kalsın (menü solda)
    const off = wide ? 0.6 : 0;
    const cx = Math.cos(ang) * r, cz = Math.sin(ang) * r;
    cam.position.set(cx, M.world.height(cx, cz) + 3.6, cz);
    const rx = -Math.sin(ang) * off, rz = Math.cos(ang) * off;
    cam.lookAt(rx, 2.2, rz);
    M.boomT -= dt;
    if (M.boomT <= 0) {
      M.boomT = 2.5 + Math.random() * 4;
      const a = Math.random() * 6.28, d = 25 + Math.random() * 15;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      this.fx.explosion(x, M.world.height(x, z), z, 0.8 + Math.random() * 0.5);
    }
    if (Math.random() < dt * 2) this.fx.exhaust(-2.2 * Math.cos(M.a), 1.1, -2.2 * Math.sin(M.a), -Math.cos(M.a), -Math.sin(M.a), false);
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
    this.session.hostSetup(this.myName, this.settings.color);
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
    net.sendHost({ t: 'join', v: PROTOCOL, name: this.myName, color: this.settings.color });
    this.ui.show('scrLobby');
    this.ui.renderLobby(this.session);
  }

  startSolo() {
    sfx.unlock();
    const net = new LocalNet();
    this.net = net;
    this.session = new Session(this, net, this.soloCfg);
    this.session.hostSetup(this.myName, this.settings.color);
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
    if (!s) return this.leaveRoom();
    if (s.solo) return this.leaveRoom();
    if (s.isHost) {
      if (this.game && !this.game.over) {
        this.game.over = true;
        s.backToLobby();
      } else s.backToLobby();
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
      if (solo) sfx.engineSet(0, false);
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
    const code = this.session && this.session.code;
    return `Siper Hattı'nda tank savaşına gel! Oda kodu: ${code}`;
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
      this.input.pollPad();
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

  // Kare hızına göre çözünürlüğü otomatik ayarla
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
    } else {
      this.slowT = this.fastT = 0;
    }
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
