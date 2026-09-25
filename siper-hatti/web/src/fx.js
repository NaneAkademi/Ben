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
const SMOKE_D = [0.16, 0.15, 0.14], SMOKE_L = [0.42, 0.4, 0.37];
const SPARK = [1.0, 0.85, 0.45];

export class FX {
  constructor(stage) {
    this.stage = stage;
    const scene = stage.scene;
    const n = stage.q.particles;
    this.add = new PSystem(scene, Math.round(n * 0.55), true);
    this.alpha = new PSystem(scene, n, false);
    this.dustColor = [0.55, 0.49, 0.36];
    // mermiler: uzatılmış parlak kapsül
    const g = new THREE.SphereGeometry(1, 8, 6);
    this.shellMat = new THREE.MeshBasicMaterial({ color: '#ffdb8a', toneMapped: false });
    this.shellMesh = new THREE.InstancedMesh(g, this.shellMat, 160);
    this.shellMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shellMesh.count = 0;
    this.shellMesh.frustumCulled = false;
    this.shellMesh.setColorAt(0, new THREE.Color());
    scene.add(this.shellMesh);
    // şok dalgası halkaları
    this.rings = [];
    const rg = new THREE.RingGeometry(0.8, 1, 40);
    rg.rotateX(-Math.PI / 2);
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: '#ffcf8a', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
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

  muzzle(x, y, z, dx, dz, big = false) {
    const k = big ? 1.4 : 1;
    this.add.add(x, y, z, dx * 2, 0, dz * 2, 0.07, 3.2 * k, 4.5 * k, FIRE0, FIRE1, 1, 0, 0);
    for (let i = 0; i < 7; i++) {
      const s = rand(4, 16) * k, sp = rand(-0.35, 0.35);
      const ca = Math.cos(sp), sa = Math.sin(sp);
      const vx = (dx * ca - dz * sa) * s, vz = (dx * sa + dz * ca) * s;
      this.add.add(x, y, z, vx, rand(-0.5, 1), vz, rand(0.06, 0.14), rand(0.8, 1.6) * k, 0.3, FIRE0, FIRE1, 1, 0.2, 2, 6);
    }
    for (let i = 0; i < 5; i++) {
      const s = rand(1.5, 6);
      this.alpha.add(x + dx * 0.4, y, z + dz * 0.4, dx * s + rand(-0.6, 0.6), rand(0.2, 1.2), dz * s + rand(-0.6, 0.6), rand(0.8, 1.6), rand(0.8, 1.2) * k, rand(2.5, 4) * k, SMOKE_L, SMOKE_L, 0.45, 0, 1, 2.2, -0.5);
    }
    // namlu gerisinde yer tozu
    const dc = this.dustColor;
    for (let i = 0; i < 4; i++) this.alpha.add(x - dx * 1.5 + rand(-1, 1), y - 1.1, z - dz * 1.5 + rand(-1, 1), rand(-2, 2), rand(0.3, 1), rand(-2, 2), rand(0.6, 1.1), 1.2, 3.2, dc, dc, 0.35, 0, 1, 2);
    this.stage.pointFlash(x + dx, y + 0.3, z + dz, big ? 45 : 30, 0.07);
  }

  sparks(x, y, z, n = 10, speed = 9) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), up = rand(0.5, 1.5), s = rand(0.3, 1) * speed;
      this.add.add(x, y, z, Math.cos(a) * s, up * speed * 0.6, Math.sin(a) * s, rand(0.2, 0.5), rand(0.25, 0.45), 0.1, SPARK, FIRE1, 1, 0.5, 3, 1.5, 14);
    }
  }

  impact(x, y, z, kind) {
    if (kind === 'metal') {
      this.sparks(x, y, z, 14, 10);
      this.add.add(x, y, z, 0, 0, 0, 0.09, 2.2, 3, FIRE0, FIRE1, 1, 0, 0);
      for (let i = 0; i < 3; i++) this.alpha.add(x, y, z, rand(-1, 1), rand(0.5, 1.5), rand(-1, 1), rand(0.7, 1.2), 0.8, 2.4, SMOKE_D, SMOKE_L, 0.5, 0, 1, 1.5, -0.4);
      this.stage.pointFlash(x, y + 0.3, z, 18, 0.06);
    } else {
      const dc = kind === 'rock' || kind === 'wall' ? [0.55, 0.52, 0.48] : this.dustColor;
      this.sparks(x, y, z, 5, 7);
      for (let i = 0; i < 7; i++) {
        const a = rand(0, TAU), s = rand(0.5, 3);
        this.alpha.add(x, y, z, Math.cos(a) * s, rand(1, 4), Math.sin(a) * s, rand(0.6, 1.2), rand(0.6, 1), rand(2, 3.4), dc, dc, 0.6, 0, 1, 2.5, 1.5);
      }
      for (let i = 0; i < 6; i++) {
        const a = rand(0, TAU), s = rand(2, 6);
        this.alpha.add(x, y, z, Math.cos(a) * s, rand(3, 7), Math.sin(a) * s, rand(0.4, 0.8), 0.25, 0.2, [0.2, 0.18, 0.15], [0.2, 0.18, 0.15], 0.95, 0.9, 0, 0.5, 16);
      }
    }
  }

  explosion(x, y, z, size = 1) {
    const k = size;
    this.add.add(x, y + 0.8, z, 0, 0, 0, 0.14, 7 * k, 12 * k, [1, 0.95, 0.8], FIRE1, 1, 0, 0);
    for (let i = 0; i < 22 * k; i++) {
      const a = rand(0, TAU), s = rand(1, 7) * k, up = rand(1, 6) * k;
      this.add.add(x + rand(-0.5, 0.5), y + rand(0.3, 1.5), z + rand(-0.5, 0.5), Math.cos(a) * s, up, Math.sin(a) * s, rand(0.35, 0.8), rand(1.5, 2.6) * k, rand(3, 5) * k, FIRE0, EMBER, 1, 0, 2, 2.5, -1);
    }
    for (let i = 0; i < 18 * k; i++) {
      const a = rand(0, TAU), s = rand(0.5, 4) * k;
      this.alpha.add(x + rand(-1, 1), y + rand(0.5, 2), z + rand(-1, 1), Math.cos(a) * s, rand(1.5, 5) * k, Math.sin(a) * s, rand(1.6, 3.2), rand(2, 3) * k, rand(5, 8) * k, [0.12, 0.11, 0.1], SMOKE_L, 0.75, 0, 1, 1.4, -0.6);
    }
    for (let i = 0; i < 16 * k; i++) {
      const a = rand(0, TAU), s = rand(4, 13) * k;
      this.alpha.add(x, y + 0.8, z, Math.cos(a) * s, rand(4, 12), Math.sin(a) * s, rand(0.7, 1.4), rand(0.25, 0.45), 0.25, [0.12, 0.1, 0.08], [0.12, 0.1, 0.08], 1, 1, 0, 0.4, 18);
    }
    this.sparks(x, y + 0.8, z, 20 * k, 14 * k);
    const dc = this.dustColor;
    for (let i = 0; i < 10 * k; i++) {
      const a = (i / (10 * k)) * TAU, s = rand(6, 10) * k;
      this.alpha.add(x, y + 0.2, z, Math.cos(a) * s, rand(0.2, 1), Math.sin(a) * s, rand(0.8, 1.4), 1.5 * k, 4 * k, dc, dc, 0.55, 0, 1, 3);
    }
    this.ring(x, y + 0.15, z, 7 * k, 0.45);
    this.stage.pointFlash(x, y + 1.5, z, 80 * k, 0.22);
  }

  ring(x, y, z, r, dur) {
    const rr = this.rings.find(q => !q.m.visible) || this.rings[0];
    rr.m.visible = true;
    rr.m.position.set(x, y, z);
    rr.t = dur;
    rr.max = dur;
    rr.r = r;
  }

  dust(x, y, z, amount, vx = 0, vz = 0) {
    const dc = this.dustColor;
    this.alpha.add(x + rand(-0.3, 0.3), y + 0.15, z + rand(-0.3, 0.3), vx + rand(-0.6, 0.6), rand(0.3, 1.1), vz + rand(-0.6, 0.6), rand(0.7, 1.3), 0.6 * amount, 2.4 * amount, dc, dc, 0.32 * Math.min(1, amount), 0, 1, 1.8);
  }

  exhaust(x, y, z, dx, dz, heavy) {
    this.alpha.add(x, y, z, dx * 1.5 + rand(-0.3, 0.3), rand(0.6, 1.2), dz * 1.5 + rand(-0.3, 0.3), rand(0.6, 1.1), 0.3, heavy ? 1.8 : 1.1, SMOKE_D, SMOKE_L, heavy ? 0.4 : 0.22, 0, 1, 1.5, -0.3);
  }

  fire(x, y, z, k = 1) {
    this.add.add(x + rand(-0.6, 0.6), y + rand(0, 0.5), z + rand(-0.6, 0.6), rand(-0.3, 0.3), rand(1.5, 3), rand(-0.3, 0.3), rand(0.3, 0.6), rand(0.8, 1.4) * k, 0.2, FIRE0, EMBER, 0.9, 0, 2, 1);
    if (Math.random() < 0.5) this.alpha.add(x + rand(-0.4, 0.4), y + 0.8, z + rand(-0.4, 0.4), rand(-0.4, 0.4), rand(1.5, 2.5), rand(-0.4, 0.4), rand(1.8, 3), 1, 4.5 * k, [0.08, 0.08, 0.08], [0.35, 0.34, 0.33], 0.6, 0, 1, 0.5, -0.4);
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

  // mermi listesi: {x,y,z,vx,vz,heavy,own}
  drawShells(list, trail) {
    const M = this.shellMesh;
    let i = 0;
    for (const s of list) {
      if (i >= 160) break;
      const sp = Math.hypot(s.vx, s.vz) || 1;
      this.v.set(s.vx / sp, 0, s.vz / sp);
      this.q.setFromUnitVectors(this.xAxis, this.v);
      const w = s.heavy ? 0.2 : 0.13;
      this.m4.compose(this.s.set(s.x, s.y, s.z), this.q, this.sc.set(s.heavy ? 1.1 : 0.8, w, w));
      M.setMatrixAt(i, this.m4);
      this.c.set(s.enemy ? '#ff7a45' : s.heavy ? '#ffd07a' : '#fff0b8');
      M.setColorAt(i, this.c);
      i++;
      if (trail) {
        this.add.add(s.x, s.y, s.z, 0, 0, 0, 0.12, s.heavy ? 1.2 : 0.8, 0.2, s.enemy ? [1, 0.45, 0.2] : [1, 0.8, 0.45], [0.8, 0.3, 0.05], 0.7, 0, 0);
        if (Math.random() < 0.35) this.alpha.add(s.x, s.y, s.z, 0, 0.3, 0, 0.5, 0.25, 0.7, SMOKE_L, SMOKE_L, 0.25, 0, 1, 1);
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
      r.m.material.opacity = (1 - p) * 0.8;
    }
  }
}
