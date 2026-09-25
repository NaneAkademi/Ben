// 3B sahne: ışık, gökyüzü, arazi, çevre nesneleri, zemin izleri ve son işleme.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ARENA, QUALITY } from './config.js';
import { mulberry32, TAU, clamp } from './util.js';
import * as TX from './textures.js';

const V3 = THREE.Vector3;
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new V3();
const tmpP = new V3();
const tmpE = new THREE.Euler();
const UP = new V3(0, 1, 0);

// Geometriye köşe rengi ekle
export function colorize(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return g;
}

function xf(geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  tmpE.set(rx, ry, rz);
  tmpQ.setFromEuler(tmpE);
  tmpM.compose(tmpP.set(x, y, z), tmpQ, tmpS.set(sx, sy, sz));
  geo.applyMatrix4(tmpM);
  return geo;
}

// Basit değer gürültüsü (arazi renkleri için)
function valueNoise(seed) {
  const R = mulberry32(seed);
  const N = 64, grid = new Float32Array(N * N);
  for (let i = 0; i < grid.length; i++) grid[i] = R();
  const at = (i, j) => grid[((j & (N - 1)) * N) + (i & (N - 1))];
  return (x, y) => {
    const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

// Kamera ile oyuncu arasına giren nesneleri noktalı (dither) saydamlaştırır
const FADE = { uFadeTarget: { value: new V3() }, uFadeOn: { value: 0 } };
function occluderFade(mat) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (s, r) => {
    if (prev) prev(s, r);
    s.uniforms.uFadeTarget = FADE.uFadeTarget;
    s.uniforms.uFadeOn = FADE.uFadeOn;
    s.vertexShader = 'varying vec3 vFadeW;\n' + s.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      vec4 fw = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
      fw = instanceMatrix * fw;
      #endif
      vFadeW = (modelMatrix * fw).xyz;`);
    s.fragmentShader = 'uniform vec3 uFadeTarget; uniform float uFadeOn; varying vec3 vFadeW;\n' + s.fragmentShader.replace('void main() {', `void main() {
      if (uFadeOn > 0.5) {
        vec3 ct = uFadeTarget - cameraPosition;
        float tt = dot(vFadeW - cameraPosition, ct) / max(dot(ct, ct), 0.001);
        if (tt > 0.0 && tt < 0.88 && distance(vFadeW, cameraPosition + ct * tt) < 2.8 && mod(floor(gl_FragCoord.x) + floor(gl_FragCoord.y), 2.0) < 1.0) discard;
      }`);
  };
  mat.customProgramCacheKey = () => 'fade' + mat.type;
  return mat;
}

export class Stage {
  constructor(canvas, qualityKey) {
    this.canvas = canvas;
    this.qKey = qualityKey;
    this.q = QUALITY[qualityKey];
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.q.antialias, powerPreference: 'high-performance', stencil: false });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = this.q.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.maxDpr = Math.min(window.devicePixelRatio || 1, this.q.dpr);
    this.dpr = this.maxDpr;
    this.renderer.setPixelRatio(this.dpr);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.3, 700);
    this.camera.position.set(0, 30, 60);

    this.hemi = new THREE.HemisphereLight('#ffffff', '#444444', 1);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#ffffff', 2.5);
    this.sun.castShadow = this.q.shadows;
    if (this.q.shadows) {
      this.sun.shadow.mapSize.set(this.q.shadowSize, this.q.shadowSize);
      const sc = this.sun.shadow.camera;
      sc.left = -40;
      sc.right = 40;
      sc.top = 40;
      sc.bottom = -40;
      sc.near = 1;
      sc.far = 160;
      this.sun.shadow.bias = -0.0005;
      this.sun.shadow.normalBias = 0.04;
    }
    this.scene.add(this.sun, this.sun.target);
    this.sunDir = new V3(-0.5, 0.5, 0.3).normalize();

    // Namlu parlamaları için hazır nokta ışıkları (sayı sabit kalır, gölgelendirici yeniden derlenmez)
    this.flashLights = [];
    if (this.q.lights) {
      for (let i = 0; i < 2; i++) {
        const l = new THREE.PointLight('#ffb35a', 0, 14, 2);
        this.scene.add(l);
        this.flashLights.push({ l, t: 0, max: 0 });
      }
    }

    this.sky = this.makeSky();
    this.scene.add(this.sky);

    this.world = null;
    this.worldGroup = null;
    this.time = 0;
    this.grassMat = null;
    this.snow = null;

    this.composer = null;
    if (this.q.bloom) this.setupBloom();
    this.resize();
  }

  setupBloom() {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.55, 0.5, 0.88);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.w = w;
    this.h = h;
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.fov = w < h ? 72 : 58;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(this.dpr);
      this.composer.setSize(w, h);
    }
  }

  setDpr(d) {
    d = clamp(d, 0.55, this.maxDpr);
    if (Math.abs(d - this.dpr) < 0.04) return;
    this.dpr = d;
    this.resize();
  }

  makeSky() {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color('#4d7fb8') },
        horizon: { value: new THREE.Color('#f0cfa2') },
        glow: { value: new THREE.Color('#ffcf8a') },
        sunDir: { value: new V3(0, 1, 0) },
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 glow; uniform vec3 sunDir; varying vec3 vDir;
        void main(){
          float h = clamp(vDir.y, -0.2, 1.0);
          vec3 c = mix(horizon, top, pow(max(h,0.0), 0.55));
          c = mix(c, horizon*0.92, smoothstep(0.0,-0.2,h));
          float s = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
          c += glow * (pow(s, 12.0)*0.35 + pow(s, 400.0)*2.5);
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const m = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 16), mat);
    m.frustumCulled = false;
    m.renderOrder = -10;
    return m;
  }

  // ----- dünya kurulumu -----
  buildWorld(world) {
    this.clearWorld();
    this.world = world;
    const T = world.theme;
    const G = new THREE.Group();
    this.worldGroup = G;
    this.scene.add(G);
    this.disposables = [];

    this.sunDir.set(...T.sunDir).normalize();
    this.sun.color.set(T.sunColor);
    this.sun.intensity = T.sunI;
    this.hemi.color.set(T.hemiSky);
    this.hemi.groundColor.set(T.hemiGround);
    this.hemi.intensity = T.hemiI;
    this.renderer.toneMappingExposure = T.exposure;
    this.scene.fog = new THREE.Fog(T.fog, T.fogNear, T.fogFar);
    const su = this.sky.material.uniforms;
    su.top.value.set(T.skyTop);
    su.horizon.value.set(T.skyHorizon);
    su.glow.value.set(T.sunGlow);
    su.sunDir.value.copy(this.sunDir);

    const R = mulberry32(world.seed ^ 0x2f6b);
    this.buildGround(world, G, R);
    this.buildDecals(G);
    this.buildObstacles(world, G, R);
    this.buildBackdrop(world, G, R);
    if (this.q.grass > 0) this.buildGrass(world, G, R);
    if (T.snow) this.buildSnow(G);
  }

  clearWorld() {
    if (!this.worldGroup) return;
    this.scene.remove(this.worldGroup);
    this.worldGroup.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
    });
    this.worldGroup = null;
    this.snow = null;
    this.grassMat = null;
    this.decals = null;
  }

  buildGround(world, G, R) {
    const T = world.theme;
    const SIZE = 340, SEG = 170;
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const n1 = valueNoise(world.seed + 1), n2 = valueNoise(world.seed + 2);
    const cs = T.ground.map(h => new THREE.Color(h));
    const hill = new THREE.Color(T.hill);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const y = world.height(x, z);
      pos.setY(i, y);
      const a = n1(x * 0.045 + 10, z * 0.045 + 10), b = n2(x * 0.11, z * 0.11);
      c.copy(cs[0]).lerp(cs[1], a).lerp(cs[2], b * 0.6);
      const dirt = Math.max(0, n2(x * 0.03 + 5, z * 0.03 + 5) - 0.62) * 2.6;
      c.lerp(cs[3], Math.min(1, dirt));
      const d = Math.max(Math.abs(x), Math.abs(z));
      if (d > ARENA) c.lerp(hill, Math.min(1, (d - ARENA) / 25));
      const shade = 0.9 + (y > 0 ? 0 : y * 0.1);
      col[i * 3] = c.r * shade;
      col[i * 3 + 1] = c.g * shade;
      col[i * 3 + 2] = c.b * shade;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    // detay dokusu için dünya ölçekli uv
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 6, pos.getZ(i) / 6);
    const kind = T.snow ? 'snow' : T.trees[0] === 'palm' ? 'desert' : 'meadow';
    const map = TX.groundDetail(kind);
    const mat = new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: T.snow ? 0.85 : 1, metalness: 0 });
    const ground = new THREE.Mesh(geo, mat);
    ground.receiveShadow = true;
    G.add(ground);
    this.ground = ground;
  }

  // Palet izi ve yanık izleri: örneklenmiş dörtgenler (doku yüklemesi gerektirmez)
  buildDecals(G) {
    const atlas = TX.decalAtlas();
    const make = (count, cell) => {
      const geo = new THREE.PlaneGeometry(1, 1);
      geo.rotateX(-Math.PI / 2);
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 0.5 + cell * 0.5);
      const mat = new THREE.MeshBasicMaterial({
        map: atlas, transparent: true, depthWrite: false, color: '#000000', opacity: 1,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
      });
      // atlas alfa kanalını kullan, rengi siyah
      mat.onBeforeCompile = s => {
        s.fragmentShader = s.fragmentShader.replace('#include <map_fragment>', 'vec4 dc = texture2D(map, vMapUv); diffuseColor = vec4(0.0,0.0,0.0, dc.a * opacity * vInstA);')
          .replace('void main() {', 'varying float vInstA;\nvoid main() {');
        s.vertexShader = s.vertexShader.replace('void main() {', 'attribute float instA; varying float vInstA;\nvoid main() { vInstA = instA;');
      };
      const m = new THREE.InstancedMesh(geo, mat, count);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const a = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
      a.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('instA', a);
      tmpM.makeScale(0, 0, 0);
      for (let i = 0; i < count; i++) m.setMatrixAt(i, tmpM);
      m.frustumCulled = false;
      m.renderOrder = 1;
      G.add(m);
      return { m, a, i: 0, count, dirty: false };
    };
    this.decals = { track: make(1400, 0), scorch: make(60, 1) };
  }

  _decal(d, x, z, rot, sx, sz, alpha) {
    if (!this.decals) return;
    const y = this.world.height(x, z) + 0.03;
    tmpQ.setFromAxisAngle(UP, -rot);
    tmpM.compose(tmpP.set(x, y, z), tmpQ, tmpS.set(sx, 1, sz));
    d.m.setMatrixAt(d.i, tmpM);
    d.a.array[d.i] = alpha;
    d.i = (d.i + 1) % d.count;
    d.dirty = true;
  }
  trackMark(x, z, a, width, alpha = 0.35) {
    this._decal(this.decals && this.decals.track, x, z, a, 1.0, width, alpha);
  }
  scorch(x, z, r) {
    this._decal(this.decals && this.decals.scorch, x, z, Math.random() * TAU, r * 2, r * 2, 0.8);
  }

  buildObstacles(world, G, R) {
    const T = world.theme;
    const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, ...o });
    const H = (x, z) => world.height(x, z);

    // Duvarlar: hepsi tek geometride birleşir
    const wallGeos = [];
    for (const o of world.obstacles) {
      if (o.kind !== 'wall') continue;
      const w = o.hw * 2, d = o.hd * 2, h = o.h;
      const g = new THREE.BoxGeometry(w, h + 0.6, d);
      // uv'leri gerçek ölçüye göre ayarla (doku tekrar eder)
      const uv = g.attributes.uv, p = g.attributes.position, nrm = g.attributes.normal;
      for (let i = 0; i < uv.count; i++) {
        const ax = Math.abs(nrm.getX(i)), ay = Math.abs(nrm.getY(i));
        const u = ax > 0.5 ? p.getZ(i) : p.getX(i);
        const v = ay > 0.5 ? p.getZ(i) : p.getY(i);
        uv.setXY(i, u / 2.6, (v + h / 2) / 2.6);
      }
      xf(g, o.x, H(o.x, o.z) + h / 2 - 0.3, o.z, 0, -o.rot, 0);
      wallGeos.push(g);
      // kırık üst kenar
      const n = 1 + ((R() * 3) | 0);
      for (let k = 0; k < n; k++) {
        const L = Math.max(w, d), along = w > d;
        const off = (R() - 0.5) * (L - 0.6);
        const bw = 0.4 + R() * 0.7, bh = 0.2 + R() * 0.5;
        const b = new THREE.BoxGeometry(along ? bw : w, bh, along ? d : bw);
        const lx = along ? off : 0, lz = along ? 0 : off;
        const c = o.c, s = o.s;
        xf(b, o.x + lx * c - lz * s, H(o.x, o.z) + h - 0.3 + bh / 2, o.z + lx * s + lz * c, 0, -o.rot, 0);
        wallGeos.push(b);
      }
    }
    if (wallGeos.length) {
      const geo = mergeGeometries(wallGeos.map(g => g.index ? g.toNonIndexed() : g));
      const m = new THREE.Mesh(geo, occluderFade(std({ map: TX.wallTexture(T.wall), roughness: 0.95 })));
      m.castShadow = m.receiveShadow = true;
      G.add(m);
    }

    // Kum torbaları
    const bags = [];
    for (const o of world.obstacles) {
      if (o.kind !== 'sandbag') continue;
      const L = o.hw * 2;
      const n = Math.max(2, Math.round(L / 0.95));
      for (let layer = 0; layer < 3; layer++) {
        const rows = layer < 2 ? 2 : 1;
        for (let r = 0; r < rows; r++) {
          for (let i = 0; i < n - (layer % 2); i++) {
            const lx = -L / 2 + 0.48 + i * ((L - 0.96) / Math.max(1, n - 1)) + (layer % 2) * 0.47;
            const lz = rows === 2 ? (r ? 0.3 : -0.3) : 0;
            const wx = o.x + lx * o.c - lz * o.s, wz = o.z + lx * o.s + lz * o.c;
            bags.push([wx, H(wx, wz) + 0.16 + layer * 0.3, wz, -o.rot + (R() - 0.5) * 0.12, R()]);
          }
        }
      }
    }
    if (bags.length) {
      const g = new THREE.SphereGeometry(0.5, 9, 6);
      g.scale(0.98, 0.36, 0.62);
      const m = new THREE.InstancedMesh(g, std({ map: TX.burlapTexture(), color: '#ffffff', flatShading: true }), bags.length);
      const c = new THREE.Color();
      bags.forEach((b, i) => {
        tmpQ.setFromAxisAngle(UP, b[3]);
        tmpM.compose(tmpP.set(b[0], b[1], b[2]), tmpQ, tmpS.set(1, 1, 1));
        m.setMatrixAt(i, tmpM);
        c.setHSL(0.11, 0.25 + b[4] * 0.15, 0.55 + b[4] * 0.12);
        m.setColorAt(i, c);
      });
      m.castShadow = m.receiveShadow = true;
      G.add(m);
    }

    // Kayalar: 4 temel şekil, örneklenmiş
    const rocks = world.obstacles.filter(o => o.kind === 'rock');
    const rockCol = new THREE.Color(T.rock);
    const shapes = [];
    for (let s = 0; s < 4; s++) {
      const g = new THREE.IcosahedronGeometry(1, 1);
      const p = g.attributes.position;
      const RR = mulberry32(100 + s);
      const map = new Map();
      for (let i = 0; i < p.count; i++) {
        const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
        if (!map.has(key)) map.set(key, 0.75 + RR() * 0.4);
        const k = map.get(key);
        p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
      }
      g.computeVertexNormals();
      const ng = g.index ? g.toNonIndexed() : g;
      ng.computeVertexNormals();
      // üst yüzleri açık (karda beyaz)
      const nn = ng.attributes.normal, cols = new Float32Array(nn.count * 3);
      const top = new THREE.Color(T.snow ? '#f4f7fb' : T.rock).multiplyScalar(T.snow ? 1 : 1.15);
      const cc = new THREE.Color();
      for (let i = 0; i < nn.count; i += 3) {
        const ny = (nn.getY(i) + nn.getY(i + 1) + nn.getY(i + 2)) / 3;
        cc.copy(rockCol).multiplyScalar(0.85 + RR() * 0.25).lerp(top, ny > 0.55 ? (T.snow ? 0.9 : 0.35) : 0);
        for (let k = 0; k < 3; k++) cols.set([cc.r, cc.g, cc.b], (i + k) * 3);
      }
      ng.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      shapes.push(ng);
    }
    const rockMat = occluderFade(std({ vertexColors: true, flatShading: true, roughness: 0.95 }));
    const rockLists = [[], [], [], []];
    for (const o of rocks) rockLists[(o.rnd * 4) | 0].push([o.x, H(o.x, o.z) + o.h * 0.25, o.z, o.r * 1.08, o.h, o.rnd * 20]);
    // arena dışı süs kayaları
    for (let i = 0; i < 70; i++) {
      const a = R() * TAU, d = ARENA + 4 + R() * 50;
      const x = Math.cos(a) * d * 1.1, z = Math.sin(a) * d * 1.1, r = 1 + R() * 3.5;
      rockLists[i % 4].push([x, H(x, z) + r * 0.1, z, r, r * (0.6 + R() * 0.5), R() * 20]);
    }
    rockLists.forEach((list, s) => {
      if (!list.length) return;
      const m = new THREE.InstancedMesh(shapes[s], rockMat, list.length);
      list.forEach((q, i) => {
        tmpE.set(0, q[5], 0);
        tmpQ.setFromEuler(tmpE);
        tmpM.compose(tmpP.set(q[0], q[1], q[2]), tmpQ, tmpS.set(q[3], q[4], q[3]));
        m.setMatrixAt(i, tmpM);
      });
      m.castShadow = m.receiveShadow = true;
      G.add(m);
    });

    // Ağaçlar (arena içi, çarpışmalı)
    this.treeLists = {};
    for (const o of world.obstacles) if (o.kind === 'tree') this.addTree(o.variant, o.x, o.z, o.s, o.rnd);

    // Sandıklar
    const crates = [];
    for (const o of world.obstacles) {
      if (o.kind !== 'crate') continue;
      const y = H(o.x, o.z);
      crates.push([o.x, y + 0.82, o.z, o.rot]);
      if (o.stack) crates.push([o.x, y + 2.46, o.z, o.rot + 0.3]);
    }
    if (crates.length) {
      const m = new THREE.InstancedMesh(new THREE.BoxGeometry(1.64, 1.64, 1.64), occluderFade(std({ map: TX.crateTexture(), roughness: 0.85 })), crates.length);
      crates.forEach((q, i) => {
        tmpQ.setFromAxisAngle(UP, -q[3]);
        tmpM.compose(tmpP.set(q[0], q[1], q[2]), tmpQ, tmpS.set(1, 1, 1));
        m.setMatrixAt(i, tmpM);
      });
      m.castShadow = m.receiveShadow = true;
      G.add(m);
    }

    // Variller (vurulunca yok olur)
    if (world.barrels.length) {
      const g = new THREE.CylinderGeometry(0.58, 0.58, 1.25, 16);
      const m = new THREE.InstancedMesh(g, std({ map: TX.barrelTexture(), roughness: 0.55, metalness: 0.3 }), world.barrels.length);
      world.barrels.forEach((o, i) => {
        tmpQ.setFromAxisAngle(UP, o.rnd * TAU);
        tmpM.compose(tmpP.set(o.x, H(o.x, o.z) + 0.62, o.z), tmpQ, tmpS.set(1, 1, 1));
        m.setMatrixAt(i, tmpM);
      });
      m.castShadow = m.receiveShadow = true;
      G.add(m);
      this.barrelMesh = m;
    }

    // Tank tuzakları (çelik kirişler)
    const hog = world.obstacles.filter(o => o.kind === 'hedgehog');
    if (hog.length) {
      const parts = [];
      for (let k = 0; k < 3; k++) {
        const b = new THREE.BoxGeometry(2.2, 0.16, 0.16);
        const r = [[0, 0, 0.62], [0, Math.PI / 2, 0.62], [Math.PI / 2, 0, 0]][k];
        const e = new THREE.Euler(r[0], r[1], r[2]);
        b.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(e));
        parts.push(b.toNonIndexed());
      }
      const g = mergeGeometries(parts);
      g.translate(0, 0.62, 0);
      const m = new THREE.InstancedMesh(g, std({ color: '#4b4038', roughness: 0.6, metalness: 0.5 }), hog.length);
      hog.forEach((o, i) => {
        tmpQ.setFromAxisAngle(UP, o.rot);
        tmpM.compose(tmpP.set(o.x, H(o.x, o.z), o.z), tmpQ, tmpS.set(1, 1, 1));
        m.setMatrixAt(i, tmpM);
      });
      m.castShadow = true;
      G.add(m);
    }

    // Süsler: çalı ve moloz
    const bushes = world.decor.filter(d => d.kind === 'bush');
    if (bushes.length) {
      const g = new THREE.IcosahedronGeometry(0.8, 0);
      g.scale(1, 0.7, 1);
      const bc = T.snow ? '#dfe6ee' : T.trees[0] === 'palm' ? '#8a7a4a' : '#4c6a2c';
      const m = new THREE.InstancedMesh(g, std({ color: '#ffffff', flatShading: true }), bushes.length);
      const c = new THREE.Color();
      bushes.forEach((b, i) => {
        tmpQ.setFromAxisAngle(UP, b.r);
        tmpM.compose(tmpP.set(b.x, H(b.x, b.z) + 0.2, b.z), tmpQ, tmpS.set(b.s, b.s, b.s));
        m.setMatrixAt(i, tmpM);
        c.set(bc).multiplyScalar(0.8 + (i % 5) * 0.08);
        m.setColorAt(i, c);
      });
      m.castShadow = true;
      m.receiveShadow = true;
      G.add(m);
    }
    const rub = world.decor.filter(d => d.kind === 'rubble');
    if (rub.length) {
      const list = [];
      for (const r of rub) for (let k = 0; k < 4; k++) list.push([r.x + (R() - 0.5) * 2, r.z + (R() - 0.5) * 2, r.s * (0.4 + R()), R() * TAU]);
      const m = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.5, 0.7), std({ map: TX.wallTexture(T.wall) }), list.length);
      list.forEach((q, i) => {
        tmpE.set(R() * 0.5, q[3], R() * 0.5);
        tmpQ.setFromEuler(tmpE);
        tmpM.compose(tmpP.set(q[0], H(q[0], q[1]) + 0.1, q[1]), tmpQ, tmpS.set(q[2], q[2], q[2]));
        m.setMatrixAt(i, tmpM);
      });
      m.castShadow = m.receiveShadow = true;
      G.add(m);
    }

    // Arena sınırı: çit direkleri ve dikenli tel
    const posts = [], wires = [];
    const step = 3.2;
    for (let side = 0; side < 4; side++) {
      for (let u = -ARENA; u < ARENA; u += step) {
        const e = ARENA + 0.6;
        const [x, z] = [[u, -e], [e, u], [-u, e], [-e, -u]][side];
        posts.push([x, H(x, z), z]);
      }
    }
    const pm = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.09, 1.5, 5), std({ color: '#5a4630' }), posts.length);
    posts.forEach((p, i) => {
      tmpM.makeTranslation(p[0], p[1] + 0.7, p[2]);
      pm.setMatrixAt(i, tmpM);
    });
    pm.castShadow = true;
    G.add(pm);
    for (let i = 0; i < posts.length; i++) {
      const a = posts[i], b = posts[(i + 1) % posts.length];
      const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
      if (len > step * 1.5) continue;
      for (const hh of [0.55, 1.1]) {
        const g = new THREE.BoxGeometry(len, 0.025, 0.025);
        const ang = Math.atan2(b[2] - a[2], b[0] - a[0]);
        const dy = b[1] - a[1];
        g.applyMatrix4(new THREE.Matrix4().makeRotationZ(Math.atan2(dy, len)));
        xf(g, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + hh, (a[2] + b[2]) / 2, 0, -ang, 0);
        wires.push(g.toNonIndexed());
      }
    }
    if (wires.length) {
      const wm = new THREE.Mesh(mergeGeometries(wires), std({ color: '#3a3a36', metalness: 0.6, roughness: 0.5 }));
      G.add(wm);
    }
  }

  // Ağaç geometrileri (tek parça, köşe renkli)
  treeGeo(kind) {
    this._treeGeos = this._treeGeos || {};
    if (this._treeGeos[kind]) return this._treeGeos[kind];
    const parts = [];
    const add = (g, color) => parts.push(colorize(g, color));
    if (kind === 'pine' || kind === 'snowpine') {
      add(xf(new THREE.CylinderGeometry(0.2, 0.3, 2, 6), 0, 1, 0), '#4a3524');
      const greens = ['#2f4a26', '#355530', '#3c5e33'];
      for (let i = 0; i < 3; i++) {
        const r = 2.2 - i * 0.55, y = 2 + i * 1.5;
        add(xf(new THREE.ConeGeometry(r, 2.6, 8), 0, y, 0, 0, i * 0.4, 0), greens[i]);
        if (kind === 'snowpine') add(xf(new THREE.ConeGeometry(r * 0.72, 1.1, 8), 0, y + 0.85, 0, 0, i * 0.4, 0), '#f1f5f9');
      }
    } else if (kind === 'oak') {
      add(xf(new THREE.CylinderGeometry(0.25, 0.4, 3, 6), 0, 1.5, 0), '#4d3a27');
      const g = ['#46652c', '#557736', '#3e5c27', '#4f6f30'];
      [[0, 3.8, 0, 1.9], [1.1, 3.3, 0.4, 1.3], [-0.9, 3.4, -0.5, 1.4], [0.2, 4.8, -0.3, 1.3]].forEach((q, i) =>
        add(xf(new THREE.IcosahedronGeometry(q[3], 0), q[0], q[1], q[2], i, i * 2, 0), g[i]));
    } else if (kind === 'palm') {
      let x = 0, y = 0;
      for (let i = 0; i < 5; i++) {
        const seg = xf(new THREE.CylinderGeometry(0.2 - i * 0.015, 0.24 - i * 0.015, 1.3, 6), x, y + 0.65, 0, 0, 0, -0.08 * i);
        add(seg, i % 2 ? '#7a5d3a' : '#6c5233');
        x += Math.sin(0.08 * i) * 1.3;
        y += 1.25;
      }
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * TAU;
        const leaf = new THREE.ConeGeometry(0.35, 3, 4);
        leaf.scale(1, 1, 0.25);
        xf(leaf, 0, 0, 0, 0, 0, -Math.PI / 2 - 0.5);
        xf(leaf, x + Math.cos(a) * 1.3, y - 0.2, Math.sin(a) * 1.3, 0, -a, 0);
        add(leaf, k % 2 ? '#4c7a2e' : '#5d8a36');
      }
    } else {
      // kuru ağaç
      add(xf(new THREE.CylinderGeometry(0.18, 0.3, 3.2, 5), 0, 1.6, 0), '#6d5a45');
      [[0.6, 2.4, 0.9], [-0.5, 2.8, -0.8], [0.2, 3.1, 0.5]].forEach((q, i) =>
        add(xf(new THREE.CylinderGeometry(0.05, 0.1, 1.6, 4), q[0] * 0.6, q[1], q[2] * 0.4, q[2], i * 2, q[0]), '#6d5a45'));
    }
    const g = mergeGeometries(parts.map(p => { p.deleteAttribute('uv'); return p; }));
    this._treeGeos[kind] = g;
    return g;
  }

  addTree(kind, x, z, s, rnd) {
    (this.treeLists[kind] = this.treeLists[kind] || []).push([x, this.world.height(x, z) - 0.1, z, s, rnd * TAU]);
  }

  flushTrees(G) {
    const mat = occluderFade(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }));
    for (const [kind, list] of Object.entries(this.treeLists)) {
      const m = new THREE.InstancedMesh(this.treeGeo(kind), mat, list.length);
      list.forEach((q, i) => {
        tmpQ.setFromAxisAngle(UP, q[4]);
        tmpM.compose(tmpP.set(q[0], q[1], q[2]), tmpQ, tmpS.set(q[3], q[3] * (0.9 + (i % 3) * 0.08), q[3]));
        m.setMatrixAt(i, tmpM);
      });
      m.castShadow = true;
      m.receiveShadow = true;
      G.add(m);
    }
    this._treeGeos = null;
  }

  buildBackdrop(world, G, R) {
    const T = world.theme;
    const kinds = T.trees;
    const n = T.trees[0] === 'palm' ? 60 : 260;
    for (let i = 0; i < n; i++) {
      const a = R() * TAU;
      const d = ARENA + 5 + Math.pow(R(), 0.7) * 70;
      const x = Math.cos(a) * d * (1 + 0.25 * Math.abs(Math.sin(2 * a))), z = Math.sin(a) * d * (1 + 0.25 * Math.abs(Math.sin(2 * a)));
      if (Math.max(Math.abs(x), Math.abs(z)) < ARENA + 4) continue;
      this.addTree(kinds[(R() * kinds.length) | 0], x, z, 0.9 + R() * 0.8, R());
    }
    this.flushTrees(G);
  }

  buildGrass(world, G, R) {
    const T = world.theme;
    const count = Math.round(this.q.grass * T.grassDensity);
    if (count < 10) return;
    // çimen öbeği: birkaç ince yaprak
    const pos = [], col = [];
    const base = new THREE.Color(0.42, 0.42, 0.4), tip = new THREE.Color(1.1, 1.1, 1.0);
    for (let b = 0; b < 6; b++) {
      const a = (b / 6) * TAU + R(), r = 0.12 + R() * 0.2;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const h = 0.35 + R() * 0.4, w = 0.06;
      const lean = 0.15 + R() * 0.2;
      const dx = Math.cos(a) * lean, dz = Math.sin(a) * lean;
      const px = -Math.sin(a) * w, pz = Math.cos(a) * w;
      pos.push(x - px, 0, z - pz, x + px, 0, z + pz, x + dx, h, z + dz);
      col.push(base.r, base.g, base.b, base.r, base.g, base.b, tip.r, tip.g, tip.b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    // yaprak normallerini yukarı eğ (daha yumuşak ışık)
    const nn = g.attributes.normal;
    for (let i = 0; i < nn.count; i++) nn.setXYZ(i, nn.getX(i) * 0.3, 1, nn.getZ(i) * 0.3);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    mat.onBeforeCompile = s => {
      s.uniforms.uTime = { value: 0 };
      this.grassMat = s;
      s.vertexShader = 'uniform float uTime;\n' + s.vertexShader.replace('#include <begin_vertex>',
        `#include <begin_vertex>
        vec4 ip = instanceMatrix[3];
        float sw = sin(uTime*1.7 + ip.x*0.35 + ip.z*0.27) * 0.5 + sin(uTime*2.9 + ip.x*0.8) * 0.25;
        transformed.x += sw * 0.14 * position.y;
        transformed.z += sw * 0.08 * position.y;`);
    };
    const m = new THREE.InstancedMesh(g, mat, count);
    const c = new THREE.Color(), palette = T.grass.map(h => new THREE.Color(h));
    let k = 0;
    const lim = ARENA + 14;
    for (let i = 0; i < count * 3 && k < count; i++) {
      const x = (R() * 2 - 1) * lim, z = (R() * 2 - 1) * lim;
      if (Math.max(Math.abs(x), Math.abs(z)) < ARENA - 1 && !world.freeSpot(x, z, 0.4)) continue;
      const s = 0.7 + R() * 0.8;
      tmpQ.setFromAxisAngle(UP, R() * TAU);
      tmpM.compose(tmpP.set(x, world.height(x, z) - 0.02, z), tmpQ, tmpS.set(s, s * (0.8 + R() * 0.5), s));
      m.setMatrixAt(k, tmpM);
      c.copy(palette[(R() * palette.length) | 0]).multiplyScalar(0.85 + R() * 0.3);
      m.setColorAt(k, c);
      k++;
    }
    m.count = k;
    m.receiveShadow = true;
    G.add(m);
  }

  buildSnow(G) {
    const N = 1800;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 80;
      pos[i * 3 + 1] = Math.random() * 30;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 80;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: '#ffffff', size: 0.18, map: TX.particleAtlas(), transparent: true, depthWrite: false, opacity: 0.9 });
    // atlastan yumuşak nokta hücresini kullan
    mat.onBeforeCompile = s => {
      s.fragmentShader = s.fragmentShader.replace('#include <map_particle_fragment>',
        'vec4 mc = texture2D(map, gl_PointCoord*0.5 + vec2(0.0,0.5)); diffuseColor.a *= mc.a;');
    };
    const p = new THREE.Points(g, mat);
    p.frustumCulled = false;
    G.add(p);
    this.snow = { p, pos };
  }

  hideBarrel(bid) {
    if (!this.barrelMesh) return;
    tmpM.makeScale(0, 0, 0);
    this.barrelMesh.setMatrixAt(bid, tmpM);
    this.barrelMesh.instanceMatrix.needsUpdate = true;
  }

  pointFlash(x, y, z, intensity = 30, dur = 0.08) {
    if (!this.flashLights.length) return;
    let best = this.flashLights[0];
    for (const f of this.flashLights) if (f.t < best.t) best = f;
    best.l.position.set(x, y, z);
    best.t = dur;
    best.max = dur;
    best.i = intensity;
  }

  // oyuncu odağı: arada kalan nesneler saydamlaşır (null = kapalı)
  setFadeTarget(x, y, z) {
    if (x == null) FADE.uFadeOn.value = 0;
    else {
      FADE.uFadeOn.value = 1;
      FADE.uFadeTarget.value.set(x, y, z);
    }
  }

  // her karede
  update(dt, fx, fz) {
    this.time += dt;
    if (this.grassMat) this.grassMat.uniforms.uTime.value = this.time;
    // güneş gölgesi odak noktasını izler (doku pikseline hizalı -> titreme yok)
    const snap = 80 / (this.q.shadowSize || 1024);
    const sx = Math.round(fx / snap) * snap, sz = Math.round(fz / snap) * snap;
    this.sun.target.position.set(sx, 0, sz);
    this.sun.position.set(sx + this.sunDir.x * 80, this.sunDir.y * 80, sz + this.sunDir.z * 80);
    for (const f of this.flashLights) {
      if (f.t > 0) {
        f.t -= dt;
        f.l.intensity = Math.max(0, f.t / f.max) * f.i;
      } else f.l.intensity = 0;
    }
    if (this.decals) {
      for (const d of Object.values(this.decals)) {
        if (d.dirty) {
          d.m.instanceMatrix.needsUpdate = true;
          d.a.needsUpdate = true;
          d.dirty = false;
        }
      }
    }
    if (this.snow) {
      const p = this.snow.pos, cx = this.camera.position.x, cz = this.camera.position.z, cy = this.camera.position.y;
      for (let i = 0; i < p.length; i += 3) {
        p[i + 1] -= dt * (1.4 + (i % 7) * 0.12);
        p[i] += Math.sin(this.time + i) * dt * 0.3;
        if (p[i + 1] < cy - 12) p[i + 1] += 30;
        // kameranın çevresinde sar
        if (p[i] - cx > 40) p[i] -= 80;
        else if (p[i] - cx < -40) p[i] += 80;
        if (p[i + 2] - cz > 40) p[i + 2] -= 80;
        else if (p[i + 2] - cz < -40) p[i + 2] += 80;
      }
      this.snow.p.geometry.attributes.position.needsUpdate = true;
      this.snow.p.position.set(0, 0, 0);
    }
    this.sky.position.copy(this.camera.position);
  }

  render() {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
