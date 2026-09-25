// Tuval (canvas) ile üretilen dokular — harici görsel dosyası gerekmez.
import * as THREE from 'three';
import { mulberry32 } from './util.js';

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function tex(c, { srgb = true, repeat = null, aniso = 4 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  t.anisotropy = aniso;
  return t;
}

const cache = {};
const once = (k, f) => cache[k] || (cache[k] = f());

// Zemin detay dokusu (gri tonlu, köşe noktası rengiyle çarpılır)
export function groundDetail(kind) {
  return once('ground_' + kind, () => {
    const S = 512;
    const [c, g] = canvas(S);
    const R = mulberry32(7 + kind.length);
    g.fillStyle = '#d8d8d8';
    g.fillRect(0, 0, S, S);
    // yumuşak lekeler
    for (let i = 0; i < 90; i++) {
      const x = R() * S, y = R() * S, r = 20 + R() * 70;
      const v = 190 + R() * 65;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, `rgba(${v},${v},${v},0.35)`);
      grd.addColorStop(1, `rgba(${v},${v},${v},0)`);
      g.fillStyle = grd;
      for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
        g.save();
        g.translate(ox, oy);
        g.beginPath();
        g.arc(x, y, r, 0, 7);
        g.fill();
        g.restore();
      }
    }
    if (kind === 'meadow') {
      // çimen çizgileri
      for (let i = 0; i < 5000; i++) {
        const x = R() * S, y = R() * S, l = 3 + R() * 6, v = 150 + R() * 105;
        g.strokeStyle = `rgba(${v},${v},${v},0.55)`;
        g.lineWidth = 1 + R();
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + (R() - 0.5) * 3, y - l);
        g.stroke();
      }
    } else if (kind === 'desert') {
      // kum dalgacıkları
      g.globalAlpha = 0.25;
      for (let y = 0; y < S; y += 6 + R() * 5) {
        g.strokeStyle = R() < 0.5 ? '#ffffff' : '#a8a8a8';
        g.lineWidth = 1.5;
        g.beginPath();
        for (let x = 0; x <= S; x += 16) g.lineTo(x, y + Math.sin(x * 0.03 + y) * 3);
        g.stroke();
      }
      g.globalAlpha = 1;
      for (let i = 0; i < 2500; i++) {
        const v = 160 + R() * 95;
        g.fillStyle = `rgba(${v},${v},${v},0.5)`;
        g.fillRect(R() * S, R() * S, 1.5, 1.5);
      }
    } else {
      // kar: parıltı ve hafif izler
      for (let i = 0; i < 2000; i++) {
        const v = 215 + R() * 40;
        g.fillStyle = `rgba(${v},${v},${v + 5},0.6)`;
        g.fillRect(R() * S, R() * S, 2, 2);
      }
    }
    // küçük taşlar
    for (let i = 0; i < 260; i++) {
      const x = R() * S, y = R() * S, r = 1 + R() * 2.5, v = 110 + R() * 90;
      g.fillStyle = `rgba(${v},${v},${v},0.8)`;
      g.beginPath();
      g.ellipse(x, y, r, r * 0.7, R() * 3, 0, 7);
      g.fill();
    }
    return tex(c, { repeat: [1, 1], aniso: 8 });
  });
}

// Palet dokusu (tank tırtılı)
export function treadTexture() {
  return once('tread', () => {
    const [c, g] = canvas(64, 32);
    g.fillStyle = '#2a2b26';
    g.fillRect(0, 0, 64, 32);
    for (let x = 0; x < 64; x += 8) {
      g.fillStyle = '#4a4b42';
      g.fillRect(x, 0, 4, 32);
      g.fillStyle = '#16170f';
      g.fillRect(x + 4, 0, 1, 32);
    }
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(0, 13, 64, 6);
    return tex(c, { repeat: [7, 1] });
  });
}

// Tahta sandık
export function crateTexture() {
  return once('crate', () => {
    const S = 256;
    const [c, g] = canvas(S);
    const R = mulberry32(3);
    g.fillStyle = '#8b6a3e';
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 6; i++) {
      const y = (i * S) / 6;
      g.fillStyle = i % 2 ? '#94734a' : '#7f5f36';
      g.fillRect(0, y, S, S / 6 - 2);
      g.fillStyle = 'rgba(40,25,10,0.6)';
      g.fillRect(0, y + S / 6 - 2, S, 2);
      for (let k = 0; k < 30; k++) {
        g.fillStyle = `rgba(60,40,20,${0.1 + R() * 0.2})`;
        g.fillRect(R() * S, y + R() * (S / 6), 10 + R() * 40, 1);
      }
    }
    g.strokeStyle = '#5e4524';
    g.lineWidth = 22;
    g.strokeRect(11, 11, S - 22, S - 22);
    g.beginPath();
    g.moveTo(16, 16);
    g.lineTo(S - 16, S - 16);
    g.stroke();
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 2;
    g.strokeRect(22, 22, S - 44, S - 44);
    g.fillStyle = '#2b2b2b';
    for (const [x, y] of [[12, 12], [S - 12, 12], [12, S - 12], [S - 12, S - 12]]) {
      g.beginPath();
      g.arc(x, y, 4, 0, 7);
      g.fill();
    }
    g.fillStyle = 'rgba(30,30,20,0.55)';
    g.font = 'bold 34px sans-serif';
    g.textAlign = 'center';
    g.fillText('7.62', S * 0.68, S * 0.3);
    return tex(c);
  });
}

// Kırmızı patlayıcı varil
export function barrelTexture() {
  return once('barrel', () => {
    const [c, g] = canvas(256, 128);
    g.fillStyle = '#a3261c';
    g.fillRect(0, 0, 256, 128);
    const R = mulberry32(9);
    for (let i = 0; i < 400; i++) {
      g.fillStyle = `rgba(${60 + R() * 40},20,10,${R() * 0.25})`;
      g.fillRect(R() * 256, R() * 128, 2 + R() * 6, 1 + R() * 3);
    }
    for (const y of [18, 64, 110]) {
      g.fillStyle = '#6f160f';
      g.fillRect(0, y - 4, 256, 8);
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.fillRect(0, y - 4, 256, 2);
    }
    // uyarı şeridi
    g.save();
    g.beginPath();
    g.rect(0, 34, 256, 22);
    g.clip();
    g.fillStyle = '#f2c230';
    g.fillRect(0, 34, 256, 22);
    g.fillStyle = '#1b1b1b';
    for (let x = -30; x < 280; x += 22) {
      g.beginPath();
      g.moveTo(x, 56);
      g.lineTo(x + 11, 56);
      g.lineTo(x + 22, 34);
      g.lineTo(x + 11, 34);
      g.fill();
    }
    g.restore();
    // pas / aşınma
    for (let i = 0; i < 30; i++) {
      g.fillStyle = `rgba(90,60,30,${0.2 + R() * 0.3})`;
      g.beginPath();
      g.arc(R() * 256, 90 + R() * 38, 2 + R() * 7, 0, 7);
      g.fill();
    }
    return tex(c);
  });
}

// Duvar (sıva + tuğla)
export function wallTexture(tint) {
  return once('wall' + tint, () => {
    const S = 256;
    const [c, g] = canvas(S);
    const R = mulberry32(11);
    g.fillStyle = tint;
    g.fillRect(0, 0, S, S);
    // sıva dokusu
    for (let i = 0; i < 1800; i++) {
      const v = R() < 0.5 ? 255 : 0;
      g.fillStyle = `rgba(${v},${v},${v},${0.03 + R() * 0.05})`;
      g.fillRect(R() * S, R() * S, 2 + R() * 3, 2 + R() * 3);
    }
    // sıvası dökülmüş tuğla alanları
    for (let p = 0; p < 3; p++) {
      const cx = R() * S, cy = R() * S, r = 22 + R() * 30;
      g.save();
      g.beginPath();
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * 6.283, rr = r * (0.55 + R() * 0.6);
        g.lineTo(cx + Math.cos(a) * rr * 1.4, cy + Math.sin(a) * rr * 0.8);
      }
      g.closePath();
      g.fillStyle = 'rgba(70,60,50,0.9)';
      g.fill();
      g.clip();
      const bh = 10, bw = 22;
      for (let row = -1; row < S / bh; row++) {
        const off = row % 2 ? bw / 2 : 0;
        for (let x = -bw; x < S + bw; x += bw) {
          const v = 0.75 + R() * 0.3;
          g.fillStyle = `rgb(${(128 * v) | 0},${(98 * v) | 0},${(80 * v) | 0})`;
          g.fillRect(x + off + 1, row * bh + 1, bw - 2, bh - 2);
        }
      }
      g.restore();
      g.strokeStyle = 'rgba(40,32,24,0.45)';
      g.lineWidth = 2;
      g.stroke();
    }
    // çatlaklar
    for (let i = 0; i < 6; i++) {
      let x = R() * S, y = R() * S;
      g.strokeStyle = 'rgba(40,32,24,0.35)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 6; k++) {
        x += (R() - 0.5) * 24;
        y += R() * 14;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    // lekeler ve kurşun izleri
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(30,25,20,${R() * 0.25})`;
      g.beginPath();
      g.arc(R() * S, R() * S, 1 + R() * 4, 0, 7);
      g.fill();
    }
    const grd = g.createLinearGradient(0, S, 0, S * 0.6);
    grd.addColorStop(0, 'rgba(40,32,20,0.55)');
    grd.addColorStop(1, 'rgba(40,32,20,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
    return tex(c, { repeat: [1, 1] });
  });
}

// Kum torbası çuval dokusu
export function burlapTexture() {
  return once('burlap', () => {
    const S = 128;
    const [c, g] = canvas(S);
    g.fillStyle = '#b39f72';
    g.fillRect(0, 0, S, S);
    g.globalAlpha = 0.35;
    for (let i = 0; i < S; i += 3) {
      g.fillStyle = i % 2 ? '#8d7a52' : '#cdb98a';
      g.fillRect(i, 0, 1, S);
      g.fillRect(0, i, S, 1);
    }
    g.globalAlpha = 1;
    return tex(c, { repeat: [1, 1] });
  });
}

// Parçacık atlası: 0 yumuşak ışık, 1 duman, 2 alev, 3 kıvılcım yıldızı
export function particleAtlas() {
  return once('atlas', () => {
    const S = 128;
    const [c, g] = canvas(S * 2);
    const R = mulberry32(5);
    // 0: yumuşak parıltı
    let grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.25, 'rgba(255,255,255,0.8)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
    // 1: duman bulutu
    g.save();
    g.translate(S, 0);
    for (let i = 0; i < 26; i++) {
      const x = S / 2 + (R() - 0.5) * S * 0.45, y = S / 2 + (R() - 0.5) * S * 0.45, r = S * (0.12 + R() * 0.2);
      grd = g.createRadialGradient(x, y, 0, x, y, r);
      const v = 200 + R() * 55;
      grd.addColorStop(0, `rgba(${v},${v},${v},0.32)`);
      grd.addColorStop(1, `rgba(${v},${v},${v},0)`);
      g.fillStyle = grd;
      g.fillRect(0, 0, S, S);
    }
    g.restore();
    // 2: alev
    g.save();
    g.translate(0, S);
    for (let i = 0; i < 18; i++) {
      const x = S / 2 + (R() - 0.5) * S * 0.35, y = S / 2 + (R() - 0.5) * S * 0.35, r = S * (0.1 + R() * 0.22);
      grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(255,255,255,0.7)');
      grd.addColorStop(0.5, 'rgba(255,255,255,0.3)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, S, S);
    }
    g.restore();
    // 3: kıvılcım / yıldız
    g.save();
    g.translate(S, S);
    grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.15, 'rgba(255,255,255,0.9)');
    grd.addColorStop(0.4, 'rgba(255,255,255,0.15)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
    g.fillStyle = 'rgba(255,255,255,0.8)';
    g.fillRect(S / 2 - 1, 8, 2, S - 16);
    g.fillRect(8, S / 2 - 1, S - 16, 2);
    g.restore();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.NoColorSpace;
    return t;
  });
}

// Zemin izleri: 0 palet izi (iki şerit), 1 yanık izi
export function decalAtlas() {
  return once('decal', () => {
    const S = 128;
    const [c, g] = canvas(S * 2, S);
    // palet izi
    for (const y of [10, S - 38]) {
      const grd = g.createLinearGradient(0, y, 0, y + 28);
      grd.addColorStop(0, 'rgba(0,0,0,0)');
      grd.addColorStop(0.3, 'rgba(0,0,0,0.9)');
      grd.addColorStop(0.7, 'rgba(0,0,0,0.9)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(0, y, S, 28);
      g.fillStyle = 'rgba(0,0,0,0.5)';
      for (let x = 0; x < S; x += 12) g.fillRect(x, y + 4, 5, 20);
    }
    // yanık
    const R = mulberry32(2);
    g.save();
    g.translate(S, 0);
    let grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grd.addColorStop(0, 'rgba(0,0,0,1)');
    grd.addColorStop(0.45, 'rgba(0,0,0,0.85)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 14; i++) {
      const a = R() * 6.283, l = S * (0.25 + R() * 0.25);
      g.strokeStyle = 'rgba(0,0,0,0.6)';
      g.lineWidth = 3 + R() * 4;
      g.beginPath();
      g.moveTo(S / 2, S / 2);
      g.lineTo(S / 2 + Math.cos(a) * l, S / 2 + Math.sin(a) * l);
      g.stroke();
    }
    g.restore();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.NoColorSpace;
    return t;
  });
}

export function fenceTexture() {
  return once('fence', () => {
    const [c, g] = canvas(32, 128);
    g.fillStyle = '#6a5438';
    g.fillRect(0, 0, 32, 128);
    for (let i = 0; i < 20; i++) {
      g.fillStyle = `rgba(30,20,10,${Math.random() * 0.3})`;
      g.fillRect(Math.random() * 32, 0, 1, 128);
    }
    return tex(c);
  });
}
