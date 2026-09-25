// Oda (lobi) yönetimi: oyuncu listesi, maç ayarları, maçı başlatma, geç katılanlar.
import { PROTOCOL, MAX_PLAYERS, PLAYER_COLORS, BOT_NAMES, BOT_COLORS, THEME_LIST, CLASS_LIST } from './config.js';
import { cleanName } from './util.js';

export class Session {
  constructor(app, net, cfg) {
    this.app = app;
    this.net = net;
    this.isHost = net.isHost;
    this.solo = !!net.offline;
    this.code = net.code;
    this.players = [];
    this.cfg = Object.assign({ mode: 'coop', theme: 'random', diff: 1, bots: 3, limit: 10, time: 6 }, cfg || {});
    this.myId = this.isHost ? 1 : 0;
    this.nextId = 2;
    this.game = null;
    this.lastStart = null;
    this.closed = false;
    net.on('msg', (from, m) => this.onNet(from, m));
    net.on('drop', peer => this.onDrop(peer));
    net.on('lost', reason => !this.closed && app.connectionLost(reason));
  }

  hostSetup(name, color, tank) {
    this.players = [{ id: 1, name, color, tank: CLASS_LIST.includes(tank) ? tank : 'medium', ready: true, peer: null }];
  }

  // ---------- ağ mesajları ----------
  onNet(from, m) {
    if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;
    if (this.isHost) {
      if (m.t === 'join') return this.hostJoin(from, m);
      const p = this.players.find(q => q.peer === from);
      if (!p) return;
      if (m.t === 'ready') {
        p.ready = !!m.r;
        this.pushLobby();
        return;
      }
      if (this.game) this.game.onHostMsg(p.id, m);
      return;
    }
    switch (m.t) {
      case 'welcome':
        this.myId = m.id;
        break;
      case 'lobby':
        this.players = Array.isArray(m.players) ? m.players : [];
        this.cfg = m.cfg || this.cfg;
        if (!this.game) this.app.ui.renderLobby(this);
        break;
      case 'start':
        this.lastStart = m;
        this.app.startGame(this, m);
        break;
      case 'toLobby':
        this.app.backToLobby();
        break;
      case 'deny':
        this.closed = true;
        this.app.connectionLost(m.reason || 'Odaya katılınamadı.');
        break;
      default:
        if (this.game) this.game.onMsg(m);
    }
  }

  hostJoin(peer, m) {
    if (this.players.some(p => p.peer === peer)) return;
    const deny = reason => {
      this.net.sendTo(peer, { t: 'deny', reason });
      this.net.kick(peer);
    };
    if (m.v !== PROTOCOL) return deny('Oyun sürümleri farklı. İkiniz de uygulamanın son sürümünü kullanın.');
    if (this.players.length >= MAX_PLAYERS) return deny('Oda dolu (en fazla ' + MAX_PLAYERS + ' oyuncu).');
    let color = typeof m.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(m.color) ? m.color : PLAYER_COLORS[0].hex;
    if (this.players.some(p => p.color === color)) {
      const free = PLAYER_COLORS.find(c => !this.players.some(p => p.color === c.hex));
      if (free) color = free.hex;
    }
    const tank = CLASS_LIST.includes(m.tank) ? m.tank : 'medium';
    const p = { id: this.nextId++, name: cleanName(m.name) || 'Oyuncu', color, tank, ready: false, peer };
    this.players.push(p);
    this.net.sendTo(peer, { t: 'welcome', id: p.id });
    this.pushLobby();
    this.app.ui.toast(`${p.name} odaya katıldı`);
    if (this.game && !this.game.over && this.lastStart) {
      // maç sürerken katılan oyuncu: aynı haritayı yükle
      const g = this.game;
      const start = Object.assign({}, this.lastStart, {
        players: this.publicPlayers(),
        spawns: {},
        sync: { bar: g.world.barrels.filter(b => !b.alive).map(b => b.bid), wave: g.wave },
      });
      this.net.sendTo(peer, start);
      g.setRoster(this.publicPlayers());
      this.net.broadcast({ t: 'roster', players: this.publicPlayers() }, peer);
    }
  }

  onDrop(peer) {
    const i = this.players.findIndex(p => p.peer === peer);
    if (i < 0) return;
    const [p] = this.players.splice(i, 1);
    this.app.ui.toast(`${p.name} ayrıldı`);
    this.pushLobby();
    if (this.game) {
      this.game.setRoster(this.publicPlayers());
      this.net.broadcast({ t: 'roster', players: this.publicPlayers() });
      this.game.checkEnd();
    }
  }

  publicPlayers() {
    return this.players.map(({ id, name, color, tank, ready }) => ({ id, name, color, tank, ready }));
  }

  pushLobby() {
    if (!this.isHost) return;
    this.net.broadcast({ t: 'lobby', players: this.publicPlayers(), cfg: this.cfg });
    if (!this.game) this.app.ui.renderLobby(this);
  }

  setCfg(ch) {
    if (!this.isHost) return;
    Object.assign(this.cfg, ch);
    if (this.cfg.mode === 'dm' && this.players.length === 1 && this.cfg.bots < 1) this.cfg.bots = 3;
    this.pushLobby();
  }

  setReady(r) {
    const me = this.players.find(p => p.id === this.myId);
    if (me) me.ready = r;
    this.net.sendHost({ t: 'ready', r });
    this.app.ui.renderLobby(this);
  }

  // ---------- maç ----------
  startMatch() {
    if (!this.isHost) return;
    const cfg = Object.assign({}, this.cfg);
    if (cfg.theme === 'random') cfg.theme = THEME_LIST[(Math.random() * THEME_LIST.length) | 0];
    if (cfg.mode === 'dm' && this.players.length === 1 && cfg.bots < 1) cfg.bots = 1;
    const seed = (Math.random() * 2 ** 31) | 0;
    const spawns = {};
    const order = [0, 4, 2, 6, 1, 5, 3, 7].sort(() => Math.random() - 0.5);
    this.players.forEach((p, i) => (spawns[p.id] = order[i % 8]));
    const bots = [];
    if (cfg.mode === 'dm') {
      const names = BOT_NAMES.slice().sort(() => Math.random() - 0.5);
      for (let i = 0; i < cfg.bots; i++) bots.push({ id: 100 + i, name: names[i % names.length], color: BOT_COLORS[i % BOT_COLORS.length], tank: CLASS_LIST[(Math.random() * 3) | 0] });
    }
    const msg = { t: 'start', cfg, seed, players: this.publicPlayers(), bots, spawns };
    this.lastStart = msg;
    for (const p of this.players) if (p.id !== 1) p.ready = false;
    this.net.broadcast(msg);
    this.app.startGame(this, msg);
  }

  backToLobby() {
    if (!this.isHost) return;
    this.net.broadcast({ t: 'toLobby' });
    this.app.backToLobby();
    this.pushLobby();
  }

  // oyun olayları
  send(m) {
    if (this.isHost) return;
    this.net.sendHost(m);
  }

  broadcast(m, exceptPid) {
    if (!this.isHost || this.solo) return;
    let peer;
    if (exceptPid != null) {
      const p = this.players.find(q => q.id === exceptPid);
      peer = p && p.peer;
    }
    this.net.broadcast(m, peer);
  }

  close() {
    this.closed = true;
    this.net.close();
  }
}
