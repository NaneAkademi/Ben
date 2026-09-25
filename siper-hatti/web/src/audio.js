// Tüm sesler Web Audio ile anlık üretilir; ses dosyası gerekmez.
import { clamp, rand } from './util.js';

class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = 0.8;
    this.listener = { x: 0, z: 0, a: 0 };
    this.lastPlay = {};
    this.engine = null;
  }

  // İlk dokunuşta çağrılır (tarayıcılar sesi kullanıcı etkileşimiyle açar)
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC({ latencyHint: 'interactive' });
      } catch (e) {
        return;
      }
      const c = this.ctx;
      this.master = c.createGain();
      this.master.gain.value = this.volume;
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master.connect(comp);
      comp.connect(c.destination);
      this.noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
      const d = this.noise.getChannelData(0);
      let b = 0;
      for (let i = 0; i < d.length; i++) {
        // hafif kırmızımsı gürültü
        b = 0.97 * b + 0.03 * (Math.random() * 2 - 1);
        d[i] = (Math.random() * 2 - 1) * 0.6 + b * 3;
      }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  suspend(on) {
    if (!this.ctx) return;
    if (on) this.ctx.suspend().catch(() => {});
    else this.ctx.resume().catch(() => {});
  }

  get ok() {
    return this.ctx && this.ctx.state === 'running' && this.volume > 0;
  }

  // konuma göre ses seviyesi ve stereo
  spatial(x, z, range = 70) {
    if (x == null) return { g: 1, p: 0 };
    const L = this.listener;
    const dx = x - L.x, dz = z - L.z;
    const d = Math.hypot(dx, dz);
    const g = clamp(1 - d / range, 0, 1) ** 1.6;
    // dinleyicinin sağı: (−sin a, cos a) -> kamera arkadan baktığı için
    const right = -dx * Math.sin(L.a) + dz * Math.cos(L.a);
    const p = clamp(right / 25, -0.8, 0.8);
    return { g, p };
  }

  throttle(key, ms) {
    const t = performance.now();
    if (this.lastPlay[key] && t - this.lastPlay[key] < ms) return false;
    this.lastPlay[key] = t;
    return true;
  }

  out(gain, pan) {
    const c = this.ctx;
    const g = c.createGain();
    g.gain.value = gain;
    if (c.createStereoPanner && pan) {
      const p = c.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      p.connect(this.master);
    } else g.connect(this.master);
    return g;
  }

  noiseSrc(t0, dur, filterType, f0, f1, q = 0.7) {
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    s.playbackRate.value = rand(0.85, 1.15);
    const f = c.createBiquadFilter();
    f.type = filterType;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    s.connect(f);
    s.start(t0, rand(0, 1));
    s.stop(t0 + dur + 0.05);
    return f;
  }

  env(node, t0, peak, attack, decay, dest) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    node.connect(g);
    g.connect(dest);
    return g;
  }

  osc(type, t0, f0, f1, dur) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t0 + dur);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
    return o;
  }

  shot(x, z, heavy = false, mine = false) {
    if (!this.ok || !this.throttle('shot', 35)) return;
    const { g, p } = this.spatial(x, z, 90);
    if (g < 0.02) return;
    const c = this.ctx, t = c.currentTime;
    const o = this.out(g * (mine ? 1 : 0.8), p);
    this.env(this.osc('sine', t, heavy ? 95 : 130, 32, 0.35), t, 0.9, 0.004, heavy ? 0.45 : 0.3, o);
    this.env(this.noiseSrc(t, 0.5, 'lowpass', heavy ? 1400 : 2600, 180, 0.8), t, 0.85, 0.003, heavy ? 0.6 : 0.4, o);
    this.env(this.noiseSrc(t, 0.06, 'highpass', 3000, 1500), t, 0.35, 0.001, 0.05, o);
  }

  explosion(x, z, big = true) {
    if (!this.ok || !this.throttle('boom', 60)) return;
    const { g, p } = this.spatial(x, z, 120);
    if (g < 0.02) return;
    const c = this.ctx, t = c.currentTime;
    const o = this.out(g, p);
    this.env(this.osc('sine', t, big ? 80 : 110, 25, 0.9), t, 1, 0.005, big ? 1.1 : 0.6, o);
    this.env(this.noiseSrc(t, big ? 1.8 : 0.9, 'lowpass', big ? 1600 : 2200, 90, 0.9), t, 1, 0.006, big ? 1.7 : 0.8, o);
    this.env(this.noiseSrc(t + 0.05, 0.4, 'bandpass', 900, 300, 1.2), t + 0.05, 0.35, 0.01, 0.35, o);
  }

  hit(x, z, mine = false) {
    if (!this.ok || !this.throttle('hit', 40)) return;
    const { g, p } = this.spatial(x, z, 60);
    if (g < 0.02) return;
    const c = this.ctx, t = c.currentTime;
    const o = this.out(g * (mine ? 1.2 : 0.8), p);
    this.env(this.osc('triangle', t, 820, 700, 0.25), t, 0.3, 0.002, 0.22, o);
    this.env(this.osc('square', t, 1310, 1200, 0.18), t, 0.08, 0.002, 0.14, o);
    this.env(this.noiseSrc(t, 0.15, 'bandpass', 2400, 900, 1.5), t, 0.6, 0.002, 0.12, o);
  }

  thud(x, z) {
    if (!this.ok || !this.throttle('thud', 50)) return;
    const { g, p } = this.spatial(x, z, 50);
    if (g < 0.03) return;
    const c = this.ctx, t = c.currentTime;
    const o = this.out(g * 0.6, p);
    this.env(this.noiseSrc(t, 0.25, 'lowpass', 900, 150), t, 0.7, 0.003, 0.22, o);
  }

  hitMarker() {
    if (!this.ok || !this.throttle('hm', 60)) return;
    const c = this.ctx, t = c.currentTime;
    const o = this.out(0.25, 0);
    this.env(this.osc('square', t, 1800, 1700, 0.06), t, 0.25, 0.001, 0.05, o);
  }

  pickup() {
    if (!this.ok) return;
    const c = this.ctx, t = c.currentTime;
    const o = this.out(0.35, 0);
    [660, 880, 1320].forEach((f, i) => this.env(this.osc('triangle', t + i * 0.07, f, f, 0.2), t + i * 0.07, 0.5, 0.005, 0.18, o));
  }

  click() {
    if (!this.ok || !this.throttle('click', 40)) return;
    const c = this.ctx, t = c.currentTime;
    const o = this.out(0.18, 0);
    this.env(this.osc('square', t, 520, 380, 0.05), t, 0.4, 0.001, 0.05, o);
  }

  horn() {
    if (!this.ok) return;
    const c = this.ctx, t = c.currentTime;
    const o = this.out(0.22, 0);
    [0, 0.32].forEach((d, i) => {
      const f = i ? 330 : 247;
      const a = this.osc('sawtooth', t + d, f, f, 0.5);
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1100;
      a.connect(lp);
      this.env(lp, t + d, 0.6, 0.03, 0.45, o);
    });
  }

  boost() {
    if (!this.ok) return;
    const c = this.ctx, t = c.currentTime;
    const o = this.out(0.3, 0);
    this.env(this.noiseSrc(t, 0.6, 'bandpass', 400, 1600, 2), t, 0.8, 0.05, 0.55, o);
  }

  // Oyuncunun kendi motor sesi (sürekli)
  engineStart() {
    if (!this.ctx || this.engine) return;
    const c = this.ctx;
    const g = c.createGain();
    g.gain.value = 0;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    lp.Q.value = 1.2;
    const o1 = c.createOscillator();
    o1.type = 'sawtooth';
    o1.frequency.value = 38;
    const o2 = c.createOscillator();
    o2.type = 'square';
    o2.frequency.value = 19.3;
    const g2 = c.createGain();
    g2.gain.value = 0.35;
    const n = c.createBufferSource();
    n.buffer = this.noise;
    n.loop = true;
    const nf = c.createBiquadFilter();
    nf.type = 'lowpass';
    nf.frequency.value = 260;
    const ng = c.createGain();
    ng.gain.value = 0.5;
    o1.connect(lp);
    o2.connect(g2);
    g2.connect(lp);
    n.connect(nf);
    nf.connect(ng);
    ng.connect(lp);
    lp.connect(g);
    g.connect(this.master);
    o1.start();
    o2.start();
    n.start();
    this.engine = { g, lp, o1, o2, nodes: [o1, o2, n] };
  }

  engineSet(speed01, alive) {
    const e = this.engine;
    if (!e) return;
    const t = this.ctx.currentTime;
    const s = clamp(speed01, 0, 1.6);
    e.o1.frequency.setTargetAtTime(34 + s * 30, t, 0.12);
    e.o2.frequency.setTargetAtTime(17 + s * 15, t, 0.12);
    e.lp.frequency.setTargetAtTime(240 + s * 520, t, 0.12);
    e.g.gain.setTargetAtTime(alive ? 0.1 + s * 0.12 : 0, t, 0.2);
  }

  engineStop() {
    const e = this.engine;
    if (!e) return;
    this.engine = null;
    const t = this.ctx.currentTime;
    e.g.gain.setTargetAtTime(0, t, 0.1);
    setTimeout(() => {
      for (const n of e.nodes) {
        try {
          n.stop();
        } catch (_) {}
      }
      e.g.disconnect();
    }, 600);
  }
}

export const sfx = new Sfx();
