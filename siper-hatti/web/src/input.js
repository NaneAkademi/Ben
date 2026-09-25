// Klavye, fare, dokunmatik (sanal joystick + tuşlar) ve oyun kolu girişi.
import { clamp } from './util.js';

const KEYS = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  Space: 'fire', KeyJ: 'fire', KeyE: 'he', KeyK: 'he', KeyQ: 'he',
  ShiftLeft: 'boost', ShiftRight: 'boost', KeyL: 'boost',
};

export class Input {
  constructor(opts) {
    this.layer = opts.layer; // joystick için dokunma katmanı
    this.canvas = opts.canvas;
    this.joyEl = opts.joy;
    this.btn = opts.buttons; // {fire, he, boost}
    this.keys = {};
    this.joy = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.held = { fire: new Set(), he: new Set(), boost: new Set() };
    this.mouse = { fire: false, he: false };
    this.pad = { x: 0, y: 0, fire: false, he: false, boost: false, start: false, prevStart: false };
    this.enabled = false;
    this.touchMode = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.onPause = null;
    this.radius = 58;
    this._bind();
  }

  _bind() {
    addEventListener('keydown', e => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      const k = KEYS[e.code];
      if (k && this.enabled) {
        this.keys[k] = true;
        e.preventDefault();
      }
      if ((e.code === 'Escape' || e.code === 'KeyP') && this.enabled && this.onPause) this.onPause();
      if (e.code === 'Tab' && this.enabled) {
        e.preventDefault();
        this.onScore && this.onScore(true);
      }
    });
    addEventListener('keyup', e => {
      const k = KEYS[e.code];
      if (k) this.keys[k] = false;
      if (e.code === 'Tab') this.onScore && this.onScore(false);
    });
    addEventListener('blur', () => this.reset());

    const L = this.layer;
    L.addEventListener('pointerdown', e => {
      if (!this.enabled) return;
      if (e.pointerType === 'mouse') {
        if (e.button === 0) this.mouse.fire = true;
        if (e.button === 2) this.mouse.he = true;
        return;
      }
      this.touchMode = true;
      document.body.classList.add('touch');
      const r = L.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      if (x < r.width * 0.5 && this.joy.id === null) {
        this.joy.id = e.pointerId;
        this.joy.ox = x;
        this.joy.oy = y;
        this.joy.x = this.joy.y = 0;
        this._drawJoy(x, y, 0, 0, true);
        try {
          L.setPointerCapture(e.pointerId);
        } catch (_) {}
      } else {
        // sağ tarafta boş alana dokunmak da ateş eder
        this.held.fire.add('L' + e.pointerId);
        try {
          L.setPointerCapture(e.pointerId);
        } catch (_) {}
      }
      e.preventDefault();
    });
    L.addEventListener('pointermove', e => {
      if (e.pointerId !== this.joy.id) return;
      const r = L.getBoundingClientRect();
      let dx = e.clientX - r.left - this.joy.ox, dy = e.clientY - r.top - this.joy.oy;
      const d = Math.hypot(dx, dy), R = this.radius;
      if (d > R) {
        // joystick parmağı takip eder (taban kayar)
        const k = (d - R) / d;
        this.joy.ox += dx * k;
        this.joy.oy += dy * k;
        dx *= R / d;
        dy *= R / d;
      }
      this.joy.x = dx / R;
      this.joy.y = dy / R;
      this._drawJoy(this.joy.ox, this.joy.oy, dx, dy, true);
    });
    const end = e => {
      if (e.pointerType === 'mouse') {
        if (e.button === 0) this.mouse.fire = false;
        if (e.button === 2) this.mouse.he = false;
        return;
      }
      if (e.pointerId === this.joy.id) {
        this.joy.id = null;
        this.joy.x = this.joy.y = 0;
        this._drawJoy(0, 0, 0, 0, false);
      }
      this.held.fire.delete('L' + e.pointerId);
    };
    L.addEventListener('pointerup', end);
    L.addEventListener('pointercancel', end);
    L.addEventListener('lostpointercapture', end);
    L.addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('mouseup', e => {
      if (e.button === 0) this.mouse.fire = false;
      if (e.button === 2) this.mouse.he = false;
    });

    for (const [name, el] of Object.entries(this.btn)) {
      if (!el) continue;
      el.addEventListener('pointerdown', e => {
        e.preventDefault();
        e.stopPropagation();
        this.held[name].add(e.pointerId);
        el.classList.add('on');
        try {
          el.setPointerCapture(e.pointerId);
        } catch (_) {}
      });
      const up = e => {
        this.held[name].delete(e.pointerId);
        if (!this.held[name].size) el.classList.remove('on');
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('lostpointercapture', up);
      el.addEventListener('contextmenu', e => e.preventDefault());
    }
  }

  _drawJoy(x, y, dx, dy, on) {
    const j = this.joyEl;
    if (!j) return;
    j.classList.toggle('on', on);
    if (on) {
      j.style.transform = `translate(${x - 70}px, ${y - 70}px)`;
      j.firstElementChild.style.transform = `translate(${dx}px, ${dy}px)`;
    }
  }

  pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const p = pads && [...pads].find(g => g && g.connected);
    const P = this.pad;
    if (!p) {
      P.x = P.y = 0;
      P.fire = P.he = P.boost = false;
      return;
    }
    const dz = v => (Math.abs(v) < 0.18 ? 0 : v);
    P.x = dz(p.axes[0] || 0);
    P.y = dz(p.axes[1] || 0);
    const b = i => p.buttons[i] && (p.buttons[i].pressed || p.buttons[i].value > 0.4);
    P.fire = b(7) || b(0);
    P.he = b(1) || b(5);
    P.boost = b(4) || b(2);
    if (b(12)) P.y = -1;
    if (b(13)) P.y = 1;
    if (b(14)) P.x = -1;
    if (b(15)) P.x = 1;
    const st = b(9);
    if (st && !P.prevStart && this.enabled && this.onPause) this.onPause();
    P.prevStart = st;
  }

  state() {
    const k = this.keys, j = this.joy, P = this.pad;
    let thr = -j.y - P.y + (k.up ? 1 : 0) - (k.down ? 1 : 0);
    let st = j.x + P.x + (k.right ? 1 : 0) - (k.left ? 1 : 0);
    thr = clamp(thr, -1, 1);
    st = clamp(st, -1, 1);
    if (Math.abs(thr) < 0.14) thr = 0;
    if (Math.abs(st) < 0.14) st = 0;
    return {
      throttle: thr,
      steer: st,
      fire: !!(k.fire || this.mouse.fire || this.held.fire.size || P.fire),
      he: !!(k.he || this.mouse.he || this.held.he.size || P.he),
      boost: !!(k.boost || this.held.boost.size || P.boost),
    };
  }

  setEnabled(on) {
    this.enabled = on;
    this.layer.style.pointerEvents = on ? 'auto' : 'none';
    if (!on) this.reset();
  }

  reset() {
    this.keys = {};
    this.joy.id = null;
    this.joy.x = this.joy.y = 0;
    this._drawJoy(0, 0, 0, 0, false);
    for (const s of Object.values(this.held)) s.clear();
    for (const el of Object.values(this.btn)) el && el.classList.remove('on');
    this.mouse.fire = this.mouse.he = false;
  }
}
