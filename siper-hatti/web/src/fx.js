// Parçacık efektleri (namlu alevi, patlama, duman, toz, kıvılcım) ve mermi izleri.
import * as THREE from 'three';
import { particleAtlas } from './textures.js';
import { rand, TAU } from './util.js';

const VS = `
attribute vec4 pcolor; attribute float psize; attribute float pcell;
varying vec4 vColor; varying float vCell; varying float vDepth;
uniform float uScale;
void main(){
  vColor = pcolor; vCell = pcell;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDepth = -mv.z;
  gl_PointSize = psize * uScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const FS = `
uniform sampler2D map; uniform vec3 fogColor; uniform float fogNear; uniform float fogFar; uniform float uAdd;
varying vec4 vColor; varying float vCell; varying float vDepth;
void main(){
  vec2 pc = gl_PointCoord;
  float fl = step(4.0, vCell); float cell = mod(vCell, 4.0);
  pc.x = mix(pc.x, 1.0 - pc.x, fl);
  vec2 uv = vec2((pc.x + mod(cell, 2.0)) * 0.5, 1.0 - (pc.y + floor(cell / 2.0)) * 0.5);
  vec4 t = texture2D(map, uv);
  float a = t.a * vColor.a;
  if (a < 0.004) discard;
  float f = smoothstep(fogNear, fogFar, vDepth);
  vec3 c = vColor.rgb * mix(vec3(1.0), t.rgb, 0.3);
  if (uAdd > 0.5) { gl_FragColor = vec4(c * a * (1.0 - f), 1.0); }
  else { gl_FragColor = vec4(mix(c, fogColor, f), a); }
}`;

class PSystem {
  constructor(scene, max, additive) {
    this.max = max;
    this.n = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.cell = new Float32Array(max);
    // yaşam, maks, s0, s1, a0, a1, sürtünme, yerçekimi, r,g,b başlangıç, r,g,b bitiş
    this.data = new Float32Array(max * 14);
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.aCell = new THREE.BufferAttribute(this.cell, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('pcolor', this.aCol);
    g.setAttribute('psize', this.aSize);
    g.setAttribute('pcell', this.aCell);
    g.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: particleAtlas() }, uScale: { value: 500 }, uAdd: { value: additive ? 1 : 0 },
        fogColor: { value: new THREE.Color('#cccccc') }, fogNear: { value: 60 }, fogFar: { value: 200 },
      },
      vertexShader: VS,
      fragmentShader: FS,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
    scene.add(this.points);
  }

  add(x, y, z, vx, vy, vz, life, s0, s1, c0, c1, a0, a1, cell, drag = 0, grav = 0) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    const d = i * 14;
    const D = this.data;
    D[d] = life; D[d + 1] = life; D[d + 2] = s0; D[d + 3] = s1; D[d + 4] = a0; D[d + 5] = a1;
    D[d + 6] = drag; D[d + 7] = grav;
    D[d + 8] = c0[0]; D[d + 9] = c0[1]; D[d + 10] = c0[2];
    D[d + 11] = c1[0]; D[d + 12] = c1[1]; D[d + 13] = c1[2];
    this.cell[i] = cell + (Math.random() < 0.5 ? 4 : 0);
  }

  update(dt) {
    const P = this.pos, V = this.vel, D = this.data, C = this.col, S = this.size;
    let i = 0;
    while (i < this.n) {
      const d = i * 14;
      D[d] -= dt;
      if (D[d] <= 0) {
        const last = --this.n;
        if (i !== last) {
          P.copyWithin(i * 3, last * 3, last * 3 + 3);
          V.copyWithin(i * 3, last * 3, last * 3 + 3);
          D.copyWithin(d, last * 14, last * 14 + 14);
          this.cell[i] = this.cell[last];
        }
        continue;
      }
      const t = 1 - D[d] / D[d + 1];
      const drag = Math.exp(-D[d + 6] * dt);
      const j = i * 3;
      V[j] *= drag;
      V[j + 1] = V[j + 1] * drag - D[d + 7] * dt;
      V[j + 2] *= drag;
      P[j] += V[j] * dt;
      P[j + 1] += V[j + 1] * dt;
      P[j + 2] += V[j + 2] * dt;
      S[i] = D[d + 2] + (D[d + 3] - D[d + 2]) * t;
      const k = i * 4;
      C[k] = D[d + 8] + (D[d + 11] - D[d + 8]) * t;
      C[k + 1] = D[d + 9] + (D[d + 12] - D[d + 9]) * t;
      C[k + 2] = D[d + 10] + (D[d + 13] - D[d + 10]) * t;
      // hızlı belir, yavaş kaybol
      const fade = Math.min(1, t * 8);
      C[k + 3] = (D[d + 4] + (D[d + 5] - D[d + 4]) * t) * fade;
      i++;
    }
    const g = this.points.geometry;
    g.setDrawRange(0, this.n);
    if (this.n) {
      this.aPos.needsUpdate = this.aCol.needsUpdate = this.aSize.needsUpdate = this.aCell.needsUpdate = true;
      this.aPos.clearUpdateRanges(); this.aPos.addUpdateRange(0, this.n * 3);
      this.aCol.clearUpdateRanges(); this.aCol.addUpdateRange(0, this.n * 4);
      this.aSize.clearUpdateRanges(); this.aSize.addUpdateRange(0, this.n);
      this.aCell.clearUpdateRanges(); this.aCell.addUpdateRange(0, this.n);
    }
  }

  clear() {
    this.n = 0;
    this.points.geometry.setDrawRange(0, 0);
  }

  dispose() {
    this.points.parent && this.points.parent.remove(this.points);
    this.points.geometry.dispose();
    this.mat.dispose();
  }
}


const hex = h => {
  const c = new THREE.Color(h);
  return [c.r, c.g, c.b];
};
const FIRE0 = [1.0, 0.92, 0.6], FIRE1 = [1.0, 0.42, 0.08], EMBER = [0.6, 0.12, 0.02];
const SMOKE_D = [0.14, 0.13, 0.12], SMOKE_L = [0.5, 0.48, 0.45], SMOKE_W = [0.78, 0.77, 0.75];
const SPARK = [1.0, 0.85, 0.45];
const DIRT = [0.24, 0.2, 0.15];

export class FX {
  constructor(stage) {
    this.stage = stage;
    const scene = stage.scene;
    const n = stage.q.particles;
    this.add = new PSystem(scene, Math.round(n * 0.55), true);
    this.alpha = new PSystem(scene, n, false);
    this.dustColor = [0.55, 0.49, 0.36];
    const g = new THREE.SphereGeometry(1, 8, 6);
    this.shellMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
    this.shellMesh = new THREE.InstancedMesh(g, this.shellMat, 160);
    this.shellMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shellMesh.count = 0;
    this.shellMesh.frustumCulled = false;
    this.shellMesh.setColorAt(0, new THREE.Color());
    scene.add(this.shellMesh);
    this.rings = [];
    const rg = new THREE.RingGeometry(0.8, 1, 40);
    rg.rotateX(-Math.PI / 2);
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: '#ffe0b0', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      m.visible = false;
      scene.add(m);
      this.rings.push({ m, t: 0, max: 1, r: 1 });
    }
    this.m4 = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.v = new THREE.Vector3();
    this.s = new THREE.Vector3();
    this.sc = new THREE.Vector3();
    this.c = new THREE.Color();
    this.xAxis = new THREE.Vector3(1, 0, 0);
  }

  setTheme(theme) {
    this.dustColor = theme.dust;
  }

  clear() {
    this.add.clear();
    this.alpha.clear();
    this.shellMesh.count = 0;
    this.rings.forEach(r => (r.m.visible = false));
  }

  // Top atışı: ateş topu, namlu freni yan jetleri, ileri duman bulutu, yerde toz halkası
  muzzle(x, y, z, dx, dy, dz, big = false, groundY = null) {
    const k = big ? 1.35 : 1;
    const px = -dz, pz = dx; // yatay dik
    this.add.add(x, y, z, dx * 3, dy * 3, dz * 3, 0.08, 3.6 * k, 5.5 * k, [1, 0.97, 0.8], FIRE1, 1, 0, 0);
    for (let i = 0; i < 10; i++) {
      const s = rand(8, 26) * k, sp = rand(-0.18, 0.18);
      this.add.add(x, y, z, (dx + px * sp) * s, dy * s + rand(-0.5, 1), (dz + pz * sp) * s, rand(0.05, 0.13), rand(0.9, 1.8) * k, 0.3, FIRE0, FIRE1, 1, 0.2, 2, 9);
    }
    // namlu freni: iki yana alev ve duman jeti
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const s = rand(6, 14) * k;
        this.add.add(x, y, z, px * side * s + dx * 2, rand(-0.3, 0.6), pz * side * s + dz * 2, rand(0.05, 0.1), rand(0.8, 1.3) * k, 0.3, FIRE0, FIRE1, 1, 0.1, 2, 10);
      }
      for (let i = 0; i < 4; i++) {
        const s = rand(3, 7);
        this.alpha.add(x, y, z, px * side * s + dx, rand(0.1, 0.8), pz * side * s + dz, rand(1.2, 2.2), 0.8 * k, rand(2.8, 4.2) * k, SMOKE_W, SMOKE_L, 0.5, 0, 1, 1.8, -0.3);
      }
    }
    for (let i = 0; i < 9; i++) {
      const s = rand(2, 9);
      this.alpha.add(x + dx * 0.6, y, z + dz * 0.6, dx * s + rand(-0.8, 0.8), dy * s + rand(0.2, 1.2), dz * s + rand(-0.8, 0.8), rand(1.5, 2.8), rand(1, 1.5) * k, rand(4, 6.5) * k, SMOKE_W, SMOKE_L, 0.5, 0, 1, 1.6, -0.35);
    }
    // basınç dalgasıyla kalkan yer tozu
    if (groundY != null) {
      const dc = this.dustColor;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU, s = rand(4, 8) * k;
        this.alpha.add(x - dx * 1.2 + Math.cos(a) * 0.8, groundY + 0.25, z - dz * 1.2 + Math.sin(a) * 0.8, Math.cos(a) * s + dx * 3, rand(0.3, 1.2), Math.sin(a) * s + dz * 3, rand(0.8, 1.5), 1.4, 4.2 * k, dc, dc, 0.42, 0, 1, 2.6);
      }
      this.ring(x + dx * 1.5, groundY + 0.1, z + dz * 1.5, 5 * k, 0.28, 0.35);
    }
    this.stage.pointFlash(x + dx, y + 0.3, z + dz, big ? 60 : 42, 0.08);
  }

  sparks(x, y, z, n = 10, speed = 9, dir = null) {
    for (let i = 0; i < n; i++) {
      let vx, vz, vy;
      if (dir) {
        const s = rand(0.5, 1) * speed;
        vx = (dir[0] + rand(-0.35, 0.35)) * s;
        vy = (dir[1] + rand(0, 0.5)) * s;
        vz = (dir[2] + rand(-0.35, 0.35)) * s;
      } else {
        const a = rand(0, TAU), up = rand(0.5, 1.5), s = rand(0.3, 1) * speed;
        vx = Math.cos(a) * s;
        vz = Math.sin(a) * s;
        vy = up * speed * 0.6;
      }
      this.add.add(x, y, z, vx, vy, vz, rand(0.2, 0.55), rand(0.25, 0.5), 0.1, SPARK, FIRE1, 1, 0.5, 3, 1.5, 14);
    }
  }

  // Zırhı delen isabet
  penetration(x, y, z) {
    this.sparks(x, y, z, 22, 12);
    this.add.add(x, y, z, 0, 0, 0, 0.12, 3.2, 4.5, [1, 0.95, 0.7], FIRE1, 1, 0, 0);
    for (let i = 0; i < 8; i++) this.add.add(x, y, z, rand(-2, 2), rand(0.5, 3), rand(-2, 2), rand(0.25, 0.5), rand(1, 1.8), 0.4, FIRE0, EMBER, 1, 0, 2, 2);
    for (let i = 0; i < 6; i++) this.alpha.add(x, y, z, rand(-1, 1), rand(0.8, 2), rand(-1, 1), rand(1.4, 2.4), 1, 3.8, SMOKE_D, SMOKE_L, 0.7, 0, 1, 1.2, -0.5);
    this.stage.pointFlash(x, y + 0.3, z, 40, 0.1);
  }

  // Sekme: yansıyan kıvılcım çizgisi
  ricochet(x, y, z, rx, ry, rz) {
    this.sparks(x, y, z, 16, 16, [rx, ry, rz]);
    this.add.add(x, y, z, rx * 40, ry * 40, rz * 40, 0.12, 0.9, 0.4, [1, 0.9, 0.6], FIRE1, 1, 0, 3);
    this.alpha.add(x, y, z, 0, 0.5, 0, 0.8, 0.5, 1.6, SMOKE_L, SMOKE_L, 0.4, 0, 1, 1);
  }

  // Yere isabet: toprak fıskiyesi
  impact(x, y, z, kind) {
    if (kind === 'metal') return this.penetration(x, y, z);
    if (kind === 'water') {
      for (let i = 0; i < 26; i++) {
        const a = rand(0, TAU), s = rand(0.5, 3);
        this.alpha.add(x, y, z, Math.cos(a) * s, rand(5, 11), Math.sin(a) * s, rand(0.7, 1.3), rand(0.4, 0.8), rand(1, 1.8), [0.9, 0.95, 1], [0.85, 0.9, 0.95], 0.8, 0, 1, 0.4, 14);
      }
      this.ring(x, y + 0.05, z, 3, 0.7, 0.6);
      return;
    }
    const dc = kind === 'rock' || kind === 'wall' ? [0.62, 0.6, 0.56] : this.dustColor;
    this.sparks(x, y, z, 4, 6);
    for (let i = 0; i < 10; i++) {
      const a = rand(0, TAU), s = rand(0.5, 3);
      this.alpha.add(x, y, z, Math.cos(a) * s, rand(1.5, 5), Math.sin(a) * s, rand(0.8, 1.6), rand(0.7, 1.1), rand(2.4, 3.8), dc, dc, 0.65, 0, 1, 2.2, 1.2);
    }
    const debris = kind === 'wall' || kind === 'rock' ? [0.45, 0.42, 0.38] : DIRT;
    for (let i = 0; i < 14; i++) {
      const a = rand(0, TAU), s = rand(1.5, 5);
      this.alpha.add(x, y, z, Math.cos(a) * s, rand(5, 11), Math.sin(a) * s, rand(0.6, 1.1), rand(0.2, 0.4), 0.2, debris, debris, 1, 0.9, 0, 0.3, 18);
    }
  }

  explosion(x, y, z, size = 1) {
    const k = size;
    this.add.add(x, y + 0.8, z, 0, 0, 0, 0.16, 8 * k, 13 * k, [1, 0.96, 0.82], FIRE1, 1, 0, 0);
    for (let i = 0; i < 24 * k; i++) {
      const a = rand(0, TAU), s = rand(1, 7) * k, up = rand(1, 6) * k;
      this.add.add(x + rand(-0.5, 0.5), y + rand(0.3, 1.5), z + rand(-0.5, 0.5), Math.cos(a) * s, up, Math.sin(a) * s, rand(0.35, 0.85), rand(1.5, 2.7) * k, rand(3, 5.5) * k, FIRE0, EMBER, 1, 0, 2, 2.5, -1);
    }
    for (let i = 0; i < 20 * k; i++) {
      const a = rand(0, TAU), s = rand(0.5, 4) * k;
      this.alpha.add(x + rand(-1, 1), y + rand(0.5, 2), z + rand(-1, 1), Math.cos(a) * s, rand(1.5, 5) * k, Math.sin(a) * s, rand(2, 3.6), rand(2, 3) * k, rand(5.5, 9) * k, [0.1, 0.09, 0.08], SMOKE_L, 0.8, 0, 1, 1.4, -0.6);
    }
    for (let i = 0; i < 18 * k; i++) {
      const a = rand(0, TAU), s = rand(4, 13) * k;
      this.alpha.add(x, y + 0.8, z, Math.cos(a) * s, rand(4, 13), Math.sin(a) * s, rand(0.8, 1.5), rand(0.25, 0.5), 0.25, [0.12, 0.1, 0.08], [0.12, 0.1, 0.08], 1, 1, 0, 0.4, 18);
    }
    this.sparks(x, y + 0.8, z, 22 * k, 15 * k);
    const dc = this.dustColor;
    for (let i = 0; i < 12 * k; i++) {
      const a = (i / (12 * k)) * TAU, s = rand(6, 11) * k;
      this.alpha.add(x, y + 0.2, z, Math.cos(a) * s, rand(0.2, 1), Math.sin(a) * s, rand(0.8, 1.5), 1.5 * k, 4.5 * k, dc, dc, 0.55, 0, 1, 3);
    }
    this.ring(x, y + 0.15, z, 8 * k, 0.45);
    this.stage.pointFlash(x, y + 1.5, z, 90 * k, 0.25);
  }

  // Sis perdesi: tankın etrafında yoğun beyaz duman
  smokeScreen(x, y, z, r, dur) {
    for (let i = 0; i < 34; i++) {
      const a = rand(0, TAU), d = Math.sqrt(Math.random()) * r;
      this.alpha.add(x + Math.cos(a) * d * 0.3, y + rand(0.5, 1.5), z + Math.sin(a) * d * 0.3, Math.cos(a) * d * 1.4, rand(0.2, 0.8), Math.sin(a) * d * 1.4, dur * rand(0.75, 1.05), 2, rand(7, 10), SMOKE_W, [0.86, 0.86, 0.86], 0.9, 0, 1, 1.6, -0.02);
    }
    for (let i = 0; i < 8; i++) this.add.add(x, y + 1.6, z, rand(-6, 6), rand(3, 6), rand(-6, 6), 0.3, 0.8, 0.2, SPARK, FIRE1, 1, 0, 3, 0, 9);
  }

  ring(x, y, z, r, dur, op = 0.8) {
    const rr = this.rings.find(q => !q.m.visible) || this.rings[0];
    rr.m.visible = true;
    rr.m.position.set(x, y, z);
    rr.t = dur;
    rr.max = dur;
    rr.r = r;
    rr.op = op;
  }

  dust(x, y, z, amount, vx = 0, vz = 0) {
    const dc = this.dustColor;
    this.alpha.add(x + rand(-0.3, 0.3), y + 0.15, z + rand(-0.3, 0.3), vx + rand(-0.6, 0.6), rand(0.3, 1.1), vz + rand(-0.6, 0.6), rand(0.8, 1.5), 0.7 * amount, 2.8 * amount, dc, dc, 0.34 * Math.min(1, amount), 0, 1, 1.8);
  }

  splash(x, y, z, amount) {
    for (let i = 0; i < 2; i++) this.alpha.add(x + rand(-0.4, 0.4), y + 0.1, z + rand(-0.4, 0.4), rand(-1, 1), rand(1.5, 3.5), rand(-1, 1), rand(0.5, 0.9), 0.3, 1.1 * amount, [0.9, 0.95, 1], [0.85, 0.9, 0.95], 0.7, 0, 1, 0.5, 9);
  }

  exhaust(x, y, z, dx, dz, heavy) {
    this.alpha.add(x, y, z, dx * 1.5 + rand(-0.3, 0.3), rand(0.6, 1.2), dz * 1.5 + rand(-0.3, 0.3), rand(0.7, 1.3), 0.3, heavy ? 2 : 1.2, SMOKE_D, SMOKE_L, heavy ? 0.48 : 0.24, 0, 1, 1.5, -0.3);
  }

  fire(x, y, z, k = 1) {
    this.add.add(x + rand(-0.6, 0.6), y + rand(0, 0.5), z + rand(-0.6, 0.6), rand(-0.3, 0.3), rand(1.5, 3), rand(-0.3, 0.3), rand(0.3, 0.6), rand(0.8, 1.4) * k, 0.2, FIRE0, EMBER, 0.9, 0, 2, 1);
    if (Math.random() < 0.5) this.alpha.add(x + rand(-0.4, 0.4), y + 0.8, z + rand(-0.4, 0.4), rand(-0.4, 0.4), rand(1.5, 2.5), rand(-0.4, 0.4), rand(2, 3.4), 1, 5 * k, [0.07, 0.07, 0.07], [0.35, 0.34, 0.33], 0.65, 0, 1, 0.5, -0.4);
  }

  sparkle(x, y, z, color) {
    const c = hex(color);
    this.add.add(x + rand(-0.8, 0.8), y + rand(-0.2, 1), z + rand(-0.8, 0.8), 0, rand(0.5, 1.5), 0, rand(0.5, 0.9), 0.5, 0.1, c, c, 1, 0, 3);
  }

  spawnFx(x, y, z, color) {
    const c = hex(color);
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU;
      this.add.add(x + Math.cos(a) * 2.2, y + 0.2, z + Math.sin(a) * 2.2, 0, rand(2, 5), 0, rand(0.5, 0.9), 0.8, 0.2, c, c, 1, 0, 3);
    }
    this.ring(x, y + 0.1, z, 4, 0.5);
  }

  // mermiler: {x,y,z,vx,vy,vz,heavy,enemy}
  drawShells(list, trail) {
    const M = this.shellMesh;
    let i = 0;
    for (const s of list) {
      if (i >= 160) break;
      const sp = Math.hypot(s.vx, s.vy, s.vz) || 1;
      this.v.set(s.vx / sp, s.vy / sp, s.vz / sp);
      this.q.setFromUnitVectors(this.xAxis, this.v);
      const w = s.heavy ? 0.12 : 0.09;
      this.m4.compose(this.s.set(s.x, s.y, s.z), this.q, this.sc.set(2.4, w, w));
      M.setMatrixAt(i, this.m4);
      this.c.set(s.he ? '#ffb36a' : s.enemy ? '#ff8a55' : '#fff2c4');
      M.setColorAt(i, this.c);
      i++;
      if (trail) {
        this.add.add(s.x, s.y, s.z, 0, 0, 0, 0.1, s.heavy ? 1.2 : 0.9, 0.3, s.enemy ? [1, 0.5, 0.25] : [1, 0.85, 0.5], [0.8, 0.3, 0.05], 0.8, 0, 0);
        if (Math.random() < 0.5) this.alpha.add(s.x, s.y, s.z, 0, 0.3, 0, 0.9, 0.25, 0.9, SMOKE_W, SMOKE_L, 0.28, 0, 1, 1);
      }
    }
    M.count = i;
    M.instanceMatrix.needsUpdate = true;
    if (M.instanceColor) M.instanceColor.needsUpdate = true;
  }

  update(dt) {
    const st = this.stage;
    const fog = st.scene.fog;
    const scale = (st.renderer.getDrawingBufferSize(this._sz || (this._sz = new THREE.Vector2())).y) / (2 * Math.tan((st.camera.fov * Math.PI) / 360));
    for (const p of [this.add, this.alpha]) {
      const u = p.mat.uniforms;
      u.uScale.value = scale;
      if (fog) {
        u.fogColor.value.copy(fog.color);
        u.fogNear.value = fog.near;
        u.fogFar.value = fog.far;
      }
      p.update(dt);
    }
    for (const r of this.rings) {
      if (!r.m.visible) continue;
      r.t -= dt;
      if (r.t <= 0) {
        r.m.visible = false;
        continue;
      }
      const p = 1 - r.t / r.max;
      const s = r.r * (0.2 + p * 0.9);
      r.m.scale.set(s, 1, s);
      r.m.material.opacity = (1 - p) * (r.op || 0.8);
    }
  }
}
