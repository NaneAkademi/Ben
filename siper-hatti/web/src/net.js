// Eşler arası (P2P) bağlantı: oda sahibinin cihazı sunucu görevi görür.
// Eşleştirme için PeerJS'in ücretsiz genel sunucusu kullanılır; oyun verisi
// doğrudan cihazlar arasında WebRTC ile akar. Kendi sunucumuz gerekmez.
import { Peer } from 'peerjs';
import { PEER_PREFIX, ROOM_ALPHABET, PROTOCOL } from './config.js';

const ICE = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
];

function peerOptions() {
  const o = { debug: 0, config: { iceServers: ICE, sdpSemantics: 'unified-plan' } };
  // Test ya da kendi PeerServer'ın için: ?peer=host:port  (ör. localhost:9000)
  let custom = null;
  try {
    custom = new URLSearchParams(location.search).get('peer') || localStorage.getItem('siper_peer');
  } catch (e) {}
  if (custom) {
    const [host, port] = custom.split(':');
    o.host = host;
    o.port = +(port || 443);
    o.path = '/';
    o.secure = o.port === 443;
    if (host === 'localhost' || host === '127.0.0.1') o.config = { iceServers: [] };
  }
  return o;
}

export function randomCode() {
  let s = '';
  const buf = new Uint32Array(4);
  (window.crypto || {}).getRandomValues ? crypto.getRandomValues(buf) : buf.forEach((_, i) => (buf[i] = Math.random() * 1e9));
  for (let i = 0; i < 4; i++) s += ROOM_ALPHABET[buf[i] % ROOM_ALPHABET.length];
  return s;
}

const ERR_TR = {
  'peer-unavailable': 'Oda bulunamadı. Kodu kontrol et.',
  network: 'Eşleştirme sunucusuna ulaşılamadı. İnternet bağlantını kontrol et.',
  'server-error': 'Eşleştirme sunucusu yanıt vermedi. Biraz sonra tekrar dene.',
  'socket-error': 'Eşleştirme sunucusuna bağlanılamadı.',
  'socket-closed': 'Eşleştirme sunucusu bağlantısı kapandı.',
  'browser-incompatible': 'Bu cihaz WebRTC desteklemiyor.',
  'webrtc': 'Doğrudan bağlantı kurulamadı (ağ engelliyor olabilir).',
  'unavailable-id': 'Bu oda kodu kullanımda.',
};
export const errText = e => ERR_TR[e && e.type] || (e && e.message) || 'Bağlantı hatası';

class Emitter {
  constructor() {
    this._h = {};
  }
  on(ev, fn) {
    (this._h[ev] = this._h[ev] || []).push(fn);
    return this;
  }
  emit(ev, ...a) {
    for (const fn of this._h[ev] || []) {
      try {
        fn(...a);
      } catch (e) {
        console.error(e);
      }
    }
  }
}

// Tek oyunculu mod için ağsız sahte bağlantı
export class LocalNet extends Emitter {
  constructor() {
    super();
    this.isHost = true;
    this.offline = true;
    this.code = null;
    this.rtt = 0;
  }
  broadcast() {}
  sendTo() {}
  sendHost() {}
  clientIds() {
    return [];
  }
  close() {}
}

export class Net extends Emitter {
  constructor() {
    super();
    this.peer = null;
    this.isHost = false;
    this.offline = false;
    this.code = null;
    this.conns = new Map(); // host: connId -> {conn, last}
    this.hostConn = null;
    this.hostLast = 0;
    this.rtt = 0;
    this.closed = false;
    this.timer = null;
  }

  // Oda kur: benzersiz kod bulunana kadar dener
  host() {
    this.isHost = true;
    return new Promise((resolve, reject) => {
      let tries = 0, pending = null;
      const attempt = () => {
        const code = randomCode();
        const p = new Peer(PEER_PREFIX + code, peerOptions());
        pending = p;
        let opened = false;
        p.on('open', () => {
          opened = true;
          this.peer = p;
          this.code = code;
          this._wireHost(p);
          resolve(code);
        });
        p.on('error', e => {
          if (!opened) {
            p.destroy();
            if (e.type === 'unavailable-id' && ++tries < 6) attempt();
            else reject(e);
          } else this._peerError(e);
        });
      };
      attempt();
      setTimeout(() => {
        if (!this.peer) {
          if (pending) pending.destroy();
          reject({ type: 'network' });
        }
      }, 15000);
    });
  }

  _wireHost(p) {
    p.on('connection', conn => {
      conn.on('open', () => {
        this.conns.set(conn.peer, { conn, last: performance.now() });
        this.emit('conn', conn.peer);
      });
      conn.on('data', d => {
        const c = this.conns.get(conn.peer);
        if (c) c.last = performance.now();
        if (d && d.t === 'ping') {
          this._send(conn, { t: 'pong', c: d.c });
          return;
        }
        this.emit('msg', conn.peer, d);
      });
      const drop = () => {
        if (this.conns.has(conn.peer)) {
          this.conns.delete(conn.peer);
          this.emit('drop', conn.peer);
        }
      };
      conn.on('close', drop);
      conn.on('error', drop);
    });
    p.on('disconnected', () => {
      // eşleştirme sunucusu koptu; mevcut oyuncular etkilenmez, yeni katılım için yeniden bağlan
      if (!this.closed) setTimeout(() => !this.closed && !p.destroyed && p.reconnect(), 1500);
    });
    this.timer = setInterval(() => {
      const now = performance.now();
      for (const [id, c] of this.conns) {
        if (now - c.last > 7000) {
          try {
            c.conn.close();
          } catch (e) {}
          this.conns.delete(id);
          this.emit('drop', id);
        }
      }
    }, 1000);
  }

  join(code) {
    this.isHost = false;
    this.code = code;
    return new Promise((resolve, reject) => {
      const p = new Peer(peerOptions());
      this.peer = p;
      let done = false;
      const fail = e => {
        if (done) return;
        done = true;
        this.close();
        reject(e);
      };
      const to = setTimeout(() => fail({ type: 'webrtc' }), 20000);
      p.on('error', e => {
        if (!done) {
          clearTimeout(to);
          fail(e);
        } else this._peerError(e);
      });
      p.on('open', () => {
        const conn = p.connect(PEER_PREFIX + code, { reliable: true, serialization: 'json', metadata: { v: PROTOCOL } });
        conn.on('open', () => {
          if (done) return;
          done = true;
          clearTimeout(to);
          this.hostConn = conn;
          this.hostLast = performance.now();
          this._wireClient(conn);
          resolve();
        });
        conn.on('error', e => {
          if (!done) {
            clearTimeout(to);
            fail(e);
          }
        });
      });
    });
  }

  _wireClient(conn) {
    conn.on('data', d => {
      this.hostLast = performance.now();
      if (d && d.t === 'pong') {
        const r = performance.now() - d.c;
        this.rtt = this.rtt ? this.rtt * 0.7 + r * 0.3 : r;
        return;
      }
      this.emit('msg', 'host', d);
    });
    const lost = () => {
      if (!this.closed) {
        this.emit('lost', 'Oda sahibiyle bağlantı koptu.');
        this.close();
      }
    };
    conn.on('close', lost);
    this.timer = setInterval(() => {
      this._send(conn, { t: 'ping', c: performance.now() });
      if (performance.now() - this.hostLast > 8000) lost();
    }, 1000);
    this.peer.on('disconnected', () => {
      if (!this.closed) setTimeout(() => !this.closed && this.peer && !this.peer.destroyed && this.peer.reconnect(), 1500);
    });
  }

  _peerError(e) {
    // bağlantı kurulduktan sonraki sunucu hataları oyunu durdurmaz
    console.warn('peer', e && e.type);
  }

  _send(conn, msg) {
    try {
      if (conn && conn.open) conn.send(msg);
    } catch (e) {}
  }

  sendHost(msg) {
    this._send(this.hostConn, msg);
  }
  sendTo(id, msg) {
    const c = this.conns.get(id);
    if (c) this._send(c.conn, msg);
  }
  broadcast(msg, except) {
    for (const [id, c] of this.conns) if (id !== except) this._send(c.conn, msg);
  }
  kick(id) {
    const c = this.conns.get(id);
    if (c) {
      setTimeout(() => {
        try {
          c.conn.close();
        } catch (e) {}
      }, 300);
      this.conns.delete(id);
    }
  }
  clientIds() {
    return [...this.conns.keys()];
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    try {
      for (const c of this.conns.values()) c.conn.close();
      if (this.hostConn) this.hostConn.close();
    } catch (e) {}
    setTimeout(() => {
      try {
        this.peer && this.peer.destroy();
      } catch (e) {}
    }, 200);
  }
}
