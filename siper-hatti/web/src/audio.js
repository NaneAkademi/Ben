// Tüm sesler Web Audio ile anlık üretilir (dosya gerekmez).
// Gerçekçilik için: açık alan yankısı (konvolüsyon), bozulmalı top gürlemesi, uzaktaki seslerde
// gecikme (ses hızı) ve hava sönümlemesi, dizel motor + palet tıkırtısı.
import { clamp, rand } from './util.js';

class Sfx {
  constructor() {
    this.ctx = null;
    this.volume = 0.85;
    this.listener = { x: 0, z: 0, a: 0 };
    this.lastPlay = {};
    this.engine = null;
    this.ambience = null;
  }

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
      comp.threshold.value = -12;
      comp.knee.value = 10;
      comp.ratio.value = 5;
      comp.attack.value = 0.003;
      comp.release.value = 0.2;
      this.master.connect(comp);
      comp.connect(c.destination);
      // açık alan yankısı
      this.reverb = c.createConvolver();
      this.reverb.buffer = this.makeIR(2.6);
      this.revGain = c.createGain();
      this.revGain.gain.value = 0.55;
      this.reverb.connect(this.revGain);
      this.revGain.connect(this.master);
      this.white = this.makeNoise(false);
      this.brown = this.makeNoise(true);
      this.curve = this.makeCurve(3.5);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  makeNoise(brown) {
    const c = this.ctx, n = c.sampleRate * 2;
    const b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = w;
    }
    return b;
  }

  makeIR(sec) {
    const c = this.ctx, n = Math.floor(c.sampleRate * sec);
    const b = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / c.sampleRate;
        const env = Math.exp(-t / 0.55) * (t < 0.02 ? t / 0.02 : 1);
        lp = lp * 0.6 + (Math.random() * 2 - 1) * 0.4;
        d[i] = lp * env * 0.5;
      }
      // yankı: uzak tepelerden gelen gecikmeli geri dönüşler
      for (const [dl, g] of [[0.23, 0.35], [0.41, 0.22], [0.78, 0.14]]) {
        const s = Math.floor((dl + ch * 0.013) * c.sampleRate);
        for (let i = 0; i < 2400 && s + i < n; i++) d[s + i] += (Math.random() * 2 - 1) * g * Math.exp(-i / 700);
      }
    }
    return b;
  }

  makeCurve(k) {
    const n = 1024, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
    }
    return curve;
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

  throttle(key, ms) {
    const t = performance.now();
    if (this.lastPlay[key] && t - this.lastPlay[key] < ms) return false;
    this.lastPlay[key] = t;
    return true;
  }

  // konum: kazanç, stereo, gecikme, hava sönümü
  place(x, z, range = 140) {
    if (x == null) return { g: 1, p: 0, delay: 0, lp: 20000, d: 0 };
    const L = this.listener;
    const dx = x - L.x, dz = z - L.z;
    const d = Math.hypot(dx, dz);
    const g = clamp(1 / (1 + d * d / 180), 0, 1) * clamp(1 - d / range, 0, 1);
    const right = -dx * Math.sin(L.a) + dz * Math.cos(L.a);
    return { g, p: clamp(right / 30, -0.85, 0.85), delay: d > 25 ? (d - 25) / 343 : 0, lp: 18000 * Math.exp(-d / 55) + 700, d };
  }

  // çıkış zinciri: kazanç -> alçak geçiren (hava) -> panoramik -> ana + yankı
  chain(pl, gain, rev = 0.3) {
    const c = this.ctx;
    const g = c.createGain();
    g.gain.value = gain * pl.g;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = pl.lp;
    g.connect(lp);
    let out = lp;
    if (c.createStereoPanner && pl.p) {
      const p = c.createStereoPanner();
      p.pan.value = pl.p;
      lp.connect(p);
      out = p;
    }
    out.connect(this.master);
    const s = c.createGain();
    s.gain.value = rev * (0.4 + Math.min(1, pl.d / 40) * 0.6);
    out.connect(s);
    s.connect(this.reverb);
    return g;
  }

  noise(t0, dur, type, f0, f1, q = 0.7, brown = false) {
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = brown ? this.brown : this.white;
    s.playbackRate.value = rand(0.9, 1.1);
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    s.connect(f);
    s.start(t0, rand(0, 1));
    s.stop(t0 + dur + 0.05);
    return f;
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

  env(node, t0, peak, attack, decay, dest) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    node.connect(g);
    g.connect(dest);
    return g;
  }

  // ---------- olay sesleri ----------
  cannon(x, z, cal = 0.6, mine = false) {
    if (!this.ok || !this.throttle('cannon', 30)) return;
    const pl = this.place(x, z, 220);
    if (pl.g < 0.004) return;
    const c = this.ctx, t = c.currentTime + pl.delay;
    const out = this.chain(pl, mine ? 1.1 : 1, 0.45);
    // keskin patlama çıtırtısı (yakında)
    if (pl.d < 50) this.env(this.noise(t, 0.05, 'highpass', 2500, 1200), t, 0.9 * (1 - pl.d / 60), 0.001, 0.045, out);
    // gövde gürlemesi (bozulmalı)
    const ws = c.createWaveShaper();
    ws.curve = this.curve;
    ws.connect(out);
    this.env(this.osc('sine', t, 78 - cal * 20, 32, 0.5), t, 0.9, 0.004, 0.55 + cal * 0.3, ws);
    // orta frekans patlaması
    this.env(this.noise(t, 0.7, 'lowpass', 3200, 220, 0.9), t, 1, 0.003, 0.5 + cal * 0.25, out);
    // uzun gök gürültüsü kuyruğu
    this.env(this.noise(t + 0.02, 1.8, 'lowpass', 500, 60, 0.7, true), t + 0.02, 0.7, 0.03, 1.5, out);
  }

  explosion(x, z, size = 1) {
    if (!this.ok || !this.throttle('boom', 50)) return;
    const pl = this.place(x, z, 260);
    if (pl.g < 0.004) return;
    const c = this.ctx, t = c.currentTime + pl.delay;
    const out = this.chain(pl, 1.1, 0.5);
    this.env(this.osc('sine', t, 62, 22, 1.4), t, 1.2, 0.006, 0.9 + size * 0.5, out);
    this.env(this.noise(t, 2.2, 'lowpass', 1800, 70, 0.9), t, 1, 0.008, 1.1 + size * 0.7, out);
    this.env(this.noise(t, 2.4, 'lowpass', 300, 40, 0.7, true), t, 0.8, 0.05, 2, out);
    // enkaz çıtırtıları
    for (let i = 0; i < 10 * size; i++) {
      const tt = t + 0.15 + Math.random() * 1.2;
      this.env(this.noise(tt, 0.03, 'bandpass', rand(1500, 4000), 1000, 2), tt, rand(0.05, 0.18), 0.001, 0.03, out);
    }
  }

  // metale isabet: uyumsuz kısmi tonlarla çınlama
  metal(x, z, pen, mine = false) {
    if (!this.ok || !this.throttle('metal', 35)) return;
    const pl = mine ? { g: 1, p: 0, delay: 0, lp: 12000, d: 0 } : this.place(x, z, 120);
    if (pl.g < 0.004) return;
    const c = this.ctx, t = c.currentTime + pl.delay;
    const out = this.chain(pl, mine ? 1.2 : 0.9, 0.3);
    const base = rand(150, 190);
    [1, 2.38, 4.03, 6.5, 10.3].forEach((m, i) => {
      this.env(this.osc('sine', t, base * m, base * m * 0.985, 1.2), t, 0.35 / (i + 1), 0.001, 0.9 - i * 0.12, out);
    });
    this.env(this.noise(t, 0.12, 'bandpass', 2600, 1200, 1.5), t, 0.8, 0.001, 0.1, out);
    if (pen) {
      this.env(this.noise(t, 0.4, 'bandpass', 900, 300, 1), t, 0.9, 0.002, 0.35, out);
      this.env(this.osc('sine', t, 90, 40, 0.4), t, 0.9, 0.003, 0.35, out);
    }
    if (mine) {
      // içeriden boğuk darbe
      this.env(this.noise(t, 0.6, 'lowpass', 400, 80, 1, true), t, 1, 0.005, 0.5, out);
    }
  }

  ricochet(x, z) {
    if (!this.ok || !this.throttle('rico', 60)) return;
    const pl = this.place(x, z, 120);
    if (pl.g < 0.004) return;
    const c = this.ctx, t = c.currentTime + pl.delay;
    const out = this.chain(pl, 0.9, 0.35);
    this.env(this.osc('sine', t, 3200, 900, 0.5), t, 0.35, 0.004, 0.45, out);
    this.env(this.osc('triangle', t, 1800, 1650, 0.3), t, 0.2, 0.001, 0.25, out);
    this.env(this.noise(t, 0.06, 'highpass', 3000, 2000), t, 0.5, 0.001, 0.05, out);
  }

  // yakından geçen mermi vızıltısı
  whiz(x, z) {
    if (!this.ok || !this.throttle('whiz', 120)) return;
    const pl = this.place(x, z, 40);
    const c = this.ctx, t = c.currentTime;
    const out = this.chain({ ...pl, delay: 0, g: Math.max(0.35, pl.g) }, 0.7, 0.1);
    const f = this.noise(t, 0.35, 'bandpass', 2600, 500, 3);
    this.env(f, t, 0.9, 0.08, 0.25, out);
  }

  thud(x, z) {
    if (!this.ok || !this.throttle('thud', 40)) return;
    const pl = this.place(x, z, 150);
    if (pl.g < 0.004) return;
    const c = this.ctx, t = c.currentTime + pl.delay;
    const out = this.chain(pl, 0.9, 0.4);
    this.env(this.osc('sine', t, 90, 35, 0.4), t, 0.8, 0.004, 0.35, out);
    this.env(this.noise(t, 0.6, 'lowpass', 1400, 120), t, 0.8, 0.003, 0.5, out);
    for (let i = 0; i < 5; i++) {
      const tt = t + 0.2 + Math.random() * 0.6;
      this.env(this.noise(tt, 0.03, 'bandpass', 1200, 800, 1), tt, 0.08, 0.001, 0.03, out);
    }
  }

  splash(x, z) {
    if (!this.ok || !this.throttle('splash', 60)) return;
    const pl = this.place(x, z, 100);
    const c = this.ctx, t = c.currentTime + pl.delay;
    const out = this.chain(pl, 0.9, 0.3);
    this.env(this.noise(t, 0.9, 'highpass', 900, 400), t, 0.7, 0.01, 0.7, out);
    this.env(this.osc('sine', t, 110, 50, 0.3), t, 0.6, 0.003, 0.25, out);
  }

  // doldurma tamamlandı: mekanik kilit sesi
  reload() {
    if (!this.ok) return;
    const c = this.ctx, t = c.currentTime;
    const out = this.chain({ g: 1, p: 0, delay: 0, lp: 12000, d: 0 }, 0.5, 0.05);
    this.env(this.noise(t, 0.03, 'bandpass', 3000, 2500, 2), t, 0.5, 0.001, 0.025, out);
    this.env(this.osc('sine', t + 0.1, 190, 90, 0.08), t + 0.1, 0.6, 0.002, 0.08, out);
    this.env(this.noise(t + 0.1, 0.1, 'lowpass', 900, 300), t + 0.1, 0.6, 0.002, 0.08, out);
    this.env(this.noise(t + 0.2, 0.05, 'bandpass', 4200, 3000, 3), t + 0.2, 0.25, 0.001, 0.04, out);
  }

  hitMarker(kind = 'hit') {
    if (!this.ok || !this.throttle('hm', 60)) return;
    const c = this.ctx, t = c.currentTime;
    const out = this.chain({ g: 1, p: 0, delay: 0, lp: 16000, d: 0 }, 0.35, 0);
    const f = kind === 'kill' ? 1400 : kind === 'rico' ? 700 : 2000;
    this.env(this.osc('triangle', t, f, f * 0.96, 0.08), t, 0.5, 0.001, 0.07, out);
    if (kind === 'kill') this.env(this.osc('triangle', t + 0.08, f * 1.5, f * 1.5, 0.12), t + 0.08, 0.5, 0.001, 0.12, out);
  }

  pickup() {
    if (!this.ok) return;
    const c = this.ctx, t = c.currentTime;
    const out = this.chain({ g: 1, p: 0, delay: 0, lp: 16000, d: 0 }, 0.35, 0.1);
    [523, 659, 784, 1046].forEach((f, i) => this.env(this.osc('triangle', t + i * 0.06, f, f, 0.2), t + i * 0.06, 0.45, 0.004, 0.2, out));
  }

  smoke() {
    if (!this.ok) return;
    const c = this.ctx, t = c.currentTime;
    const out = this.chain({ g: 1, p: 0, delay: 0, lp: 9000, d: 0 }, 0.7, 0.3);
    for (let i = 0; i < 4; i++) {
      const tt = t + i * 0.08;
      this.env(this.osc('sine', tt, 160, 60, 0.12), tt, 0.6, 0.002, 0.1, out);
      this.env(this.noise(tt, 0.6, 'lowpass', 2000, 300), tt + 0.05, 0.3, 0.02, 0.5, out);
    }
  }

  repair() {
    if (!this.ok) return;
    const c = this.ctx, t = c.currentTime;
    const out = this.chain({ g: 1, p: 0, delay: 0, lp: 12000, d: 0 }, 0.4, 0.05);
    for (let i = 0; i < 6; i++) {
      const tt = t + i * 0.13;
      this.env(this.noise(tt, 0.04, 'bandpass', 3500, 3000, 4), tt, 0.35, 0.001, 0.035, out);
      this.env(this.osc('square', tt, 700 + i * 60, 700 + i * 60, 0.03), tt, 0.05, 0.001, 0.03, out);
    }
  }

  click() {
    if (!this.ok || !this.throttle('click', 40)) return;
    const c = this.ctx, t = c.currentTime;
    const out = this.chain({ g: 1, p: 0, delay: 0, lp: 16000, d: 0 }, 0.22, 0);
    this.env(this.noise(t, 0.02, 'bandpass', 2800, 2500, 2), t, 0.6, 0.001, 0.018, out);
    this.env(this.osc('sine', t, 900, 600, 0.04), t, 0.3, 0.001, 0.035, out);
  }

  confirm() {
    if (!this.ok) return;
    const c = this.ctx, t = c.currentTime;
    const out = this.chain({ g: 1, p: 0, delay: 0, lp: 16000, d: 0 }, 0.3, 0.1);
    this.env(this.osc('triangle', t, 660, 660, 0.1), t, 0.5, 0.004, 0.1, out);
    this.env(this.osc('triangle', t + 0.09, 990, 990, 0.18), t + 0.09, 0.5, 0.004, 0.18, out);
  }

  levelUp() {
    if (!this.ok) return;
    const c = this.ctx, t = c.currentTime;
    const out = this.chain({ g: 1, p: 0, delay: 0, lp: 16000, d: 0 }, 0.35, 0.25);
    [392, 523, 659, 784, 1046].forEach((f, i) => this.env(this.osc('triangle', t + i * 0.09, f, f, 0.35), t + i * 0.09, 0.5, 0.005, 0.35, out));
  }

  // dalga uyarısı: sis düdüğü / siren
  horn() {
    if (!this.ok) return;
    const c = this.ctx, t = c.currentTime;
    const out = this.chain({ g: 1, p: 0, delay: 0, lp: 6000, d: 30 }, 0.28, 0.6);
    const o = this.osc('sawtooth', t, 280, 420, 0.8);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    o.connect(lp);
    this.env(lp, t, 0.6, 0.15, 1.1, out);
    const o2 = this.osc('sawtooth', t, 282, 424, 0.8);
    o2.connect(lp);
  }

  // ---------- sürekli sesler ----------
  engineStart() {
    if (!this.ctx || this.engine) return;
    const c = this.ctx;
    const out = c.createGain();
    out.gain.value = 0;
    out.connect(this.master);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 300;
    lp.Q.value = 1.4;
    lp.connect(out);
    const saw = c.createOscillator();
    saw.type = 'sawtooth';
    const sq = c.createOscillator();
    sq.type = 'square';
    const sqg = c.createGain();
    sqg.gain.value = 0.45;
    saw.connect(lp);
    sq.connect(sqg);
    sqg.connect(lp);
    // silindir ateşleme dalgalanması (genlik modülasyonu)
    const am = c.createGain();
    am.gain.value = 0.7;
    const lfo = c.createOscillator();
    lfo.type = 'sine';
    const lfoG = c.createGain();
    lfoG.gain.value = 0.3;
    lfo.connect(lfoG);
    lfoG.connect(am.gain);
    lp.disconnect();
    lp.connect(am);
    am.connect(out);
    // yanma gürültüsü
    const nz = c.createBufferSource();
    nz.buffer = this.brown;
    nz.loop = true;
    const nzf = c.createBiquadFilter();
    nzf.type = 'lowpass';
    nzf.frequency.value = 400;
    const nzg = c.createGain();
    nzg.gain.value = 0.5;
    nz.connect(nzf);
    nzf.connect(nzg);
    nzg.connect(out);
    // turbo ıslığı
    const tb = c.createOscillator();
    tb.type = 'sine';
    const tbg = c.createGain();
    tbg.gain.value = 0;
    tb.connect(tbg);
    tbg.connect(out);
    // palet gıcırtısı
    const sq2 = c.createBufferSource();
    sq2.buffer = this.white;
    sq2.loop = true;
    const sqf = c.createBiquadFilter();
    sqf.type = 'bandpass';
    sqf.frequency.value = 3200;
    sqf.Q.value = 6;
    const sqg2 = c.createGain();
    sqg2.gain.value = 0;
    sq2.connect(sqf);
    sqf.connect(sqg2);
    sqg2.connect(this.master);
    // taret motoru
    const tm = c.createOscillator();
    tm.type = 'sawtooth';
    tm.frequency.value = 120;
    const tmf = c.createBiquadFilter();
    tmf.type = 'bandpass';
    tmf.frequency.value = 800;
    tmf.Q.value = 2;
    const tmg = c.createGain();
    tmg.gain.value = 0;
    tm.connect(tmf);
    tmf.connect(tmg);
    tmg.connect(this.master);
    for (const s of [saw, sq, lfo, nz, tb, sq2, tm]) s.start();
    this.engine = { out, lp, saw, sq, lfo, nzf, nzg, tb, tbg, sqg2, tmg, tm, rpm: 0.25, clank: 0, nodes: [saw, sq, lfo, nz, tb, sq2, tm] };
  }

  // speed01: 0..1+, load: gaz (0..1), turret: taret dönüş hızı (0..1)
  engineSet(speed01, load, alive, turret = 0, dt = 0.016) {
    const e = this.engine;
    if (!e) return;
    const t = this.ctx.currentTime;
    const target = alive ? clamp(0.22 + speed01 * 0.55 + load * 0.3, 0.2, 1.1) : 0;
    e.rpm += (target - e.rpm) * Math.min(1, dt * (target > e.rpm ? 2.2 : 1.4));
    const r = e.rpm;
    const f = 24 + r * 58;
    e.saw.frequency.setTargetAtTime(f, t, 0.05);
    e.sq.frequency.setTargetAtTime(f * 0.5, t, 0.05);
    e.lfo.frequency.setTargetAtTime(f * 0.25, t, 0.05);
    e.lp.frequency.setTargetAtTime(160 + r * 700 + load * 300, t, 0.08);
    e.nzf.frequency.setTargetAtTime(250 + r * 900, t, 0.08);
    e.tb.frequency.setTargetAtTime(1500 + r * 2600, t, 0.1);
    e.tbg.gain.setTargetAtTime(alive ? 0.004 + load * r * 0.012 : 0, t, 0.15);
    e.out.gain.setTargetAtTime(alive ? 0.13 + r * 0.14 : 0, t, 0.15);
    e.sqg2.gain.setTargetAtTime(alive ? clamp(speed01, 0, 1) * 0.018 : 0, t, 0.1);
    e.tmg.gain.setTargetAtTime(alive ? clamp(turret, 0, 1) * 0.035 : 0, t, 0.06);
    e.tm.frequency.setTargetAtTime(100 + turret * 60, t, 0.05);
    // palet baklası tıkırtısı (hızla orantılı)
    if (alive && speed01 > 0.03 && this.ok) {
      e.clank += dt * speed01 * 26;
      while (e.clank > 1) {
        e.clank -= 1;
        const tt = t + Math.random() * 0.02;
        const out = this.chain({ g: 1, p: rand(-0.3, 0.3), delay: 0, lp: 9000, d: 0 }, 0.12 + speed01 * 0.08, 0.05);
        this.env(this.noise(tt, 0.02, 'bandpass', rand(1800, 3200), 1500, 3), tt, 0.5, 0.001, 0.018, out);
        if (Math.random() < 0.3) this.env(this.osc('sine', tt, 140, 90, 0.04), tt, 0.4, 0.001, 0.035, out);
      }
    }
  }

  engineStop() {
    const e = this.engine;
    if (!e) return;
    this.engine = null;
    const t = this.ctx.currentTime;
    e.out.gain.setTargetAtTime(0, t, 0.1);
    e.sqg2.gain.setTargetAtTime(0, t, 0.05);
    e.tmg.gain.setTargetAtTime(0, t, 0.05);
    setTimeout(() => {
      for (const n of e.nodes) {
        try {
          n.stop();
        } catch (_) {}
      }
      e.out.disconnect();
    }, 600);
  }

  // rüzgâr ve uzak savaş ambiyansı
  ambienceStart(level = 1) {
    if (!this.ctx || this.ambience) return;
    const c = this.ctx;
    const n = c.createBufferSource();
    n.buffer = this.brown;
    n.loop = true;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 500;
    f.Q.value = 0.5;
    const g = c.createGain();
    g.gain.value = 0.05 * level;
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.13;
    const lg = c.createGain();
    lg.gain.value = 0.03 * level;
    lfo.connect(lg);
    lg.connect(g.gain);
    n.connect(f);
    f.connect(g);
    g.connect(this.master);
    n.start();
    lfo.start();
    this.ambience = { n, lfo, g };
  }

  distantBattle() {
    if (!this.ok) return;
    const c = this.ctx, t = c.currentTime;
    const out = this.chain({ g: 0.25, p: rand(-0.7, 0.7), delay: 0, lp: 700, d: 200 }, 1, 0.8);
    this.env(this.osc('sine', t, 55, 25, 1.2), t, 0.8, 0.01, 1, out);
    this.env(this.noise(t, 1.6, 'lowpass', 500, 60, 0.7, true), t, 0.8, 0.02, 1.4, out);
  }
}

export const sfx = new Sfx();
