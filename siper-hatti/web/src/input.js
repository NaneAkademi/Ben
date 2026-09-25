// Kontroller:
//  Dokunmatik: sol yarıda joystick (sürüş), sağ yarıda kaydırma (kamera/nişan), ATEŞ tuşu (üstünden kaydırınca da nişan alır)
//  Bilgisayar: W A S D sürüş, fare ile nişan (tıklayınca imleç kilitlenir), sol tık ateş, sağ tık dürbün
//  Oyun kolu: sol çubuk sürüş, sağ çubuk nişan, RT ateş, LT dürbün
import { clamp } from './util.js';

const KEYS = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  Space: 'fire',
};
const ACTION_KEYS = { Digit1: 'ap', Digit2: 'he', KeyQ: 'smoke', KeyF: 'smoke', KeyR: 'repair', KeyZ: 'zoom', ShiftLeft: 'zoom' };

export class Input {
  constructor(opts) {
    this.layer = opts.layer;
    this.canvas = opts.canvas;
    this.joyEl = opts.joy;
    this.fireBtn = opts.fire;
    this.buttons = opts.buttons || {}; // ad -> eleman (dokununca eylem)
    this.keys = {};
    this.joy = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.looks = new Map(); // pointerId -> {x,y}
    this.lookDX = 0;
    this.lookDY = 0;
    this.fireHeld = new Set();
    this.mouseFire = false;
    this.pad = { x: 0, y: 0, lx: 0, ly: 0, fire: false, prev: {} };
    this.enabled = false;
    this.touchMode = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.sens = 1;
    this.invertY = false;
    this.onAction = null;
    this.radius = 58;
    this.locked = false;
    this._bind();
  }

  action(name) {
    if (this.enabled && this.onAction) this.onAction(name);
  }

  _bind() {
    addEventListener('keydown', e => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      if (!this.enabled) return;
      const k = KEYS[e.code];
      if (k) {
        this.keys[k] = true;
        e.preventDefault();
      }
      if (!e.repeat && ACTION_KEYS[e.code]) {
        this.action(ACTION_KEYS[e.code]);
        e.preventDefault();
      }
      if (e.code === 'Escape' || e.code === 'KeyP') this.action('pause');
      if (e.code === 'Tab') {
        e.preventDefault();
        this.action('score+');
      }
    });
    addEventListener('keyup', e => {
      const k = KEYS[e.code];
      if (k) this.keys[k] = false;
      if (e.code === 'Tab') this.action('score-');
    });
    addEventListener('blur', () => this.reset());

    // fare: imleç kilidiyle nişan
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === this.layer;
      // Esc ile kilit bırakılınca menüyü aç
      if (was && !this.locked && this.enabled) this.action('pause');
    });
    addEventListener('mousemove', e => {
      if (!this.enabled || !this.locked) return;
      this.lookDX += e.movementX * 0.0024 * this.sens;
      this.lookDY += e.movementY * 0.0024 * this.sens * (this.invertY ? -1 : 1);
    });

    const L = this.layer;
    L.addEventListener('pointerdown', e => {
      if (!this.enabled) return;
      if (e.pointerType === 'mouse') {
        if (!this.locked && !this.touchMode && L.requestPointerLock) {
          try {
            const p = L.requestPointerLock();
            if (p && p.catch) p.catch(() => {});
          } catch (_) {}
        }
        if (e.button === 0) this.mouseFire = true;
        if (e.button === 2) this.action('zoom');
        return;
      }
      this.touchMode = true;
      document.body.classList.add('touch');
      const r = L.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      if (x < r.width * 0.45 && this.joy.id === null) {
        this.joy.id = e.pointerId;
        this.joy.ox = x;
        this.joy.oy = y;
        this.joy.x = this.joy.y = 0;
        this._drawJoy(x, y, 0, 0, true);
      } else {
        this.looks.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }
      try {
        L.setPointerCapture(e.pointerId);
      } catch (_) {}
      e.preventDefault();
    });
    L.addEventListener('pointermove', e => {
      if (e.pointerId === this.joy.id) {
        const r = L.getBoundingClientRect();
        let dx = e.clientX - r.left - this.joy.ox, dy = e.clientY - r.top - this.joy.oy;
        const d = Math.hypot(dx, dy), R = this.radius;
        if (d > R) {
          const k = (d - R) / d;
          this.joy.ox += dx * k;
          this.joy.oy += dy * k;
          dx *= R / d;
          dy *= R / d;
        }
        this.joy.x = dx / R;
        this.joy.y = dy / R;
        this._drawJoy(this.joy.ox, this.joy.oy, dx, dy, true);
        return;
      }
      this._lookMove(e);
    });
    const end = e => {
      if (e.pointerType === 'mouse') {
        if (e.button === 0) this.mouseFire = false;
        return;
      }
      if (e.pointerId === this.joy.id) {
        this.joy.id = null;
        this.joy.x = this.joy.y = 0;
        this._drawJoy(0, 0, 0, 0, false);
      }
      this.looks.delete(e.pointerId);
    };
    L.addEventListener('pointerup', end);
    L.addEventListener('pointercancel', end);
    L.addEventListener('lostpointercapture', end);
    L.addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('mouseup', e => {
      if (e.button === 0) this.mouseFire = false;
    });

    // ATEŞ tuşu: basılı tutunca ateş, parmak kayarsa kamera döner
    const F = this.fireBtn;
    if (F) {
      F.addEventListener('pointerdown', e => {
        e.preventDefault();
        e.stopPropagation();
        this.fireHeld.add(e.pointerId);
        this.looks.set(e.pointerId, { x: e.clientX, y: e.clientY });
        F.classList.add('on');
        try {
          F.setPointerCapture(e.pointerId);
        } catch (_) {}
      });
      F.addEventListener('pointermove', e => this._lookMove(e));
      const up = e => {
        this.fireHeld.delete(e.pointerId);
        this.looks.delete(e.pointerId);
        if (!this.fireHeld.size) F.classList.remove('on');
      };
      F.addEventListener('pointerup', up);
      F.addEventListener('pointercancel', up);
      F.addEventListener('lostpointercapture', up);
      F.addEventListener('contextmenu', e => e.preventDefault());
    }
    for (const [name, el] of Object.entries(this.buttons)) {
      if (!el) continue;
      el.addEventListener('pointerdown', e => {
        e.preventDefault();
        e.stopPropagation();
        el.classList.add('on');
        this.action(name);
      });
      const up = () => el.classList.remove('on');
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('pointerleave', up);
      el.addEventListener('contextmenu', e => e.preventDefault());
    }
  }

  _lookMove(e) {
    const p = this.looks.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    this.lookDX += dx * 0.0052 * this.sens;
    this.lookDY += dy * 0.0052 * this.sens * (this.invertY ? -1 : 1);
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

  pollPad(dt) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const p = pads && [...pads].find(g => g && g.connected);
    const P = this.pad;
    if (!p) {
      P.x = P.y = 0;
      P.fire = false;
      return;
    }
    const dz = v => (Math.abs(v) < 0.18 ? 0 : v);
    P.x = dz(p.axes[0] || 0);
    P.y = dz(p.axes[1] || 0);
    const lx = dz(p.axes[2] || 0), ly = dz(p.axes[3] || 0);
    if (this.enabled) {
      this.lookDX += lx * Math.abs(lx) * 2.6 * dt * this.sens;
      this.lookDY += ly * Math.abs(ly) * 1.6 * dt * this.sens * (this.invertY ? -1 : 1);
    }
    const b = i => p.buttons[i] && (p.buttons[i].pressed || p.buttons[i].value > 0.4);
    P.fire = b(7) || b(0);
    if (b(12)) P.y = -1;
    if (b(13)) P.y = 1;
    if (b(14)) P.x = -1;
    if (b(15)) P.x = 1;
    const edge = (i, name) => {
      const v = b(i);
      if (v && !P.prev[i]) this.action(name);
      P.prev[i] = v;
    };
    edge(6, 'zoom');
    edge(1, 'he');
    edge(2, 'ap');
    edge(4, 'smoke');
    edge(5, 'repair');
    edge(9, 'pause');
  }

  consumeLook() {
    const r = { dx: this.lookDX, dy: this.lookDY };
    this.lookDX = this.lookDY = 0;
    return r;
  }

  state() {
    const k = this.keys, j = this.joy, P = this.pad;
    let thr = -j.y - P.y + (k.up ? 1 : 0) - (k.down ? 1 : 0);
    let st = j.x + P.x + (k.right ? 1 : 0) - (k.left ? 1 : 0);
    thr = clamp(thr, -1, 1);
    st = clamp(st, -1, 1);
    if (Math.abs(thr) < 0.12) thr = 0;
    if (Math.abs(st) < 0.12) st = 0;
    return { throttle: thr, steer: st, fire: !!(k.fire || this.mouseFire || this.fireHeld.size || P.fire) };
  }

  setEnabled(on) {
    this.enabled = on;
    this.layer.style.pointerEvents = on ? 'auto' : 'none';
    if (!on) {
      this.reset();
      if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
    }
  }

  reset() {
    this.keys = {};
    this.joy.id = null;
    this.joy.x = this.joy.y = 0;
    this._drawJoy(0, 0, 0, 0, false);
    this.looks.clear();
    this.fireHeld.clear();
    this.mouseFire = false;
    this.lookDX = this.lookDY = 0;
    if (this.fireBtn) this.fireBtn.classList.remove('on');
  }
}
