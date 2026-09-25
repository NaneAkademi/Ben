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
const ni = g => (g.index ? g.toNonIndexed() : g);
function mergeList(list, keep = ['position', 'normal', 'uv']) {
  const arr = list.map(g => {
    g = ni(g);
    for (const k of Object.keys(g.attributes)) if (!keep.includes(k)) g.deleteAttribute(k);
    if (keep.includes('uv') && !g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    return g;
  });
  return mergeGeometries(arr);
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
        if (tt > 0.0 && tt < 0.86 && distance(vFadeW, cameraPosition + ct * tt) < 2.8 && mod(floor(gl_FragCoord.x) + floor(gl_FragCoord.y), 2.0) < 1.0) discard;
      }`);
  };
  mat.customProgramCacheKey = () => 'fade' + mat.type + (mat.map ? 'm' : '') + (mat.vertexColors ? 'v' : '');
  return mat;
}

const SKY_VS = `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`;
const SKY_FS = `uniform vec3 top; uniform vec3 horizon; uniform vec3 glow; uniform vec3 sunDir; varying vec3 vDir;
  void main(){
    float h = clamp(vDir.y, -0.25, 1.0);
    vec3 c = mix(horizon, top, pow(max(h,0.0), 0.5));
    c = mix(c, horizon*0.95, smoothstep(0.0,-0.25,h));
    float s = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
    c += glow * (pow(s, 10.0)*0.28 + pow(s, 600.0)*3.0);
    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export class Stage {
  constructor(canvas, qualityKey, brightness = 1) {
    this.canvas = canvas;
    this.qKey = qualityKey;
    this.q = QUALITY[qualityKey];
    this.brightness = brightness;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.q.antialias, powerPreference: 'high-performance', stencil: false });
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = this.q.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.maxDpr = Math.min(window.devicePixelRatio || 1, this.q.dpr);
    this.dpr = this.maxDpr;
    this.renderer.setPixelRatio(this.dpr);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.3, 900);
    this.camera.position.set(0, 30, 60);
    this.baseFov = 60;

    this.hemi = new THREE.HemisphereLight('#ffffff', '#444444', 1);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#ffffff', 2.5);
    this.sun.castShadow = this.q.shadows;
    if (this.q.shadows) {
      this.sun.shadow.mapSize.set(this.q.shadowSize, this.q.shadowSize);
      const sc = this.sun.shadow.camera;
      sc.left = -42;
      sc.right = 42;
      sc.top = 42;
      sc.bottom = -42;
      sc.near = 1;
      sc.far = 180;
      this.sun.shadow.bias = -0.0005;
      this.sun.shadow.normalBias = 0.04;
      if ('intensity' in this.sun.shadow) this.sun.shadow.intensity = 0.82;
    }
    this.scene.add(this.sun, this.sun.target);
    this.sunDir = new V3(-0.5, 0.7, 0.3).normalize();

    this.flashLights = [];
    if (this.q.lights) {
      for (let i = 0; i < 2; i++) {
        const l = new THREE.PointLight('#ffb35a', 0, 16, 2);
        this.scene.add(l);
        this.flashLights.push({ l, t: 0, max: 0 });
      }
    }

    this.skyUniforms = {
      top: { value: new THREE.Color('#4d7fb8') }, horizon: { value: new THREE.Color('#f0cfa2') },
      glow: { value: new THREE.Color('#ffcf8a') }, sunDir: { value: new V3(0, 1, 0) },
    };
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(800, 32, 16),
      new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, uniforms: this.skyUniforms, vertexShader: SKY_VS, fragmentShader: SKY_FS }));
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);

    this.world = null;
    this.worldGroup = null;
    this.time = 0;
    this.grassMats = [];
    this.snow = null;
    this.water = [];
    this.clouds = [];
    this.pmrem = this.q.env ? new THREE.PMREMGenerator(this.renderer) : null;
    this.envRT = null;

    this.composer = null;
    if (this.q.bloom) this.setupBloom();
    this.resize();
  }

  setupBloom() {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.45, 0.45, 0.9);
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
    this.baseFov = w < h ? 74 : 60;
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

  setBrightness(b) {
    this.brightness = b;
    if (this.world) this.renderer.toneMappingExposure = this.world.theme.exposure * b;
  }

  // ----- dünya kurulumu -----
  buildWorld(world) {
    this.clearWorld();
    this.world = world;
    const T = world.theme;
    const G = new THREE.Group();
    this.worldGroup = G;
    this.scene.add(G);

    this.sunDir.set(...T.sunDir).normalize();
    this.sun.color.set(T.sunColor);
    this.sun.intensity = T.sunI;
    this.hemi.color.set(T.hemiSky);
    this.hemi.groundColor.set(T.hemiGround);
    this.hemi.intensity = T.hemiI * (this.q.env ? 0.7 : 1);
    this.renderer.toneMappingExposure = T.exposure * this.brightness;
    this.scene.fog = new THREE.Fog(T.fog, T.fogNear, T.fogFar);
    const su = this.skyUniforms;
    su.top.value.set(T.skyTop);
    su.horizon.value.set(T.skyHorizon);
    su.glow.value.set(T.sunGlow);
    su.sunDir.value.copy(this.sunDir);
    this.buildEnv();

    const R = mulberry32(world.seed ^ 0x2f6b);
    this.buildGround(world, G, R);
    this.buildDecals(G);
    this.buildWater(world, G);
    this.buildObstacles(world, G, R);
    this.buildBuildings(world, G, R);
    this.buildBackdrop(world, G, R);
    this.buildSkyDecor(world, G, R);
    if (this.q.grass > 0) this.buildGrass(world, G, R);
    if (T.snow) this.buildSnow(G);
  }

  // Gökyüzünden ortam ışığı (metal ve boyalı yüzeyler daha gerçekçi görünür)
  buildEnv() {
    if (!this.pmrem) return;
    if (this.envRT) this.envRT.dispose();
    const s = new THREE.Scene();
    const m = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16),
      new THREE.ShaderMaterial({ side: THREE.BackSide, uniforms: this.skyUniforms, vertexShader: SKY_VS.replace('p.xyww', 'p'), fragmentShader: SKY_FS, toneMapped: false }));
    const ground = new THREE.Mesh(new THREE.CircleGeometry(49, 24), new THREE.MeshBasicMaterial({ color: this.world.theme.hemiGround }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -3;
    s.add(m, ground);
    this.envRT = this.pmrem.fromScene(s, 0.02);
    this.scene.environment = this.envRT.texture;
    if ('environmentIntensity' in this.scene) this.scene.environmentIntensity = 0.55;
    m.geometry.dispose();
    m.material.dispose();
    ground.geometry.dispose();
    ground.material.dispose();
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
    this.grassMats = [];
    this.decals = null;
    this.water = [];
    this.clouds = [];
    this.barrelMesh = null;
  }

  buildGround(world, G, R) {
    const T = world.theme;
    const SIZE = 400, SEG = 180;
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const n1 = valueNoise(world.seed + 1), n2 = valueNoise(world.seed + 2);
    const cs = T.ground.map(h => new THREE.Color(h));
    const hill = new THREE.Color(T.hill), road = new THREE.Color(T.road);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const y = world.height(x, z);
      pos.setY(i, y);
      const a = n1(x * 0.04 + 10, z * 0.04 + 10), b = n2(x * 0.1, z * 0.1);
      c.copy(cs[0]).lerp(cs[1], a).lerp(cs[2], b * 0.5);
      const dirt = Math.max(0, n2(x * 0.03 + 5, z * 0.03 + 5) - 0.66) * 2.2;
      c.lerp(cs[3], Math.min(1, dirt));
      const d = Math.max(Math.abs(x), Math.abs(z));
      if (d > ARENA) c.lerp(hill, Math.min(1, (d - ARENA) / 30));
      if (d < ARENA + 40) {
        const rd = world.roadDist(x, z);
        if (rd < 3.6) c.lerp(road, (1 - Math.max(0, rd - 1.8) / 1.8) * 0.85);
      }
      const base = world.baseHeight(x, z);
      if (y < base - 0.2) c.lerp(new THREE.Color(T.ice ? '#e8f0f6' : '#7a6a4a'), Math.min(1, (base - y) * 0.8));
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 6, pos.getZ(i) / 6);
    const kind = T.snow ? 'snow' : T.trees[0] === 'palm' ? 'desert' : 'meadow';
    const mat = new THREE.MeshStandardMaterial({ map: TX.groundDetail(kind), vertexColors: true, roughness: T.snow ? 0.8 : 1, metalness: 0 });
    const ground = new THREE.Mesh(geo, mat);
    ground.receiveShadow = true;
    G.add(ground);
    this.ground = ground;
  }

  // Palet izi ve yanık izleri: örneklenmiş dörtgenler
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
    this.decals = { track: make(1400, 0), scorch: make(80, 1) };
  }

  _decal(d, x, z, rot, sx, sz, alpha) {
    if (!d) return;
    const y = this.world.height(x, z) + 0.03;
    tmpQ.setFromAxisAngle(UP, -rot);
    tmpM.compose(tmpP.set(x, y, z), tmpQ, tmpS.set(sx, 1, sz));
    d.m.setMatrixAt(d.i, tmpM);
    d.a.array[d.i] = alpha;
    d.i = (d.i + 1) % d.count;
    d.dirty = true;
  }
  trackMark(x, z, a, width, alpha = 0.35) {
    if (this.world && this.world.inWater(x, z)) return;
    this._decal(this.decals && this.decals.track, x, z, a, 1.0, width, alpha);
  }
  scorch(x, z, r) {
    if (this.world && this.world.inWater(x, z)) return;
    this._decal(this.decals && this.decals.scorch, x, z, Math.random() * TAU, r * 2, r * 2, 0.75);
  }

  buildWater(world, G) {
    const T = world.theme;
    for (const p of world.ponds) {
      const y = world.baseHeight(p.x, p.z) - (p.ice ? 0.35 : 0.45);
      const geo = new THREE.CircleGeometry(p.r * 1.3, 40);
      geo.rotateX(-Math.PI / 2);
      const mat = p.ice
        ? new THREE.MeshStandardMaterial({ color: T.water, roughness: 0.25, metalness: 0.05 })
        : new THREE.MeshStandardMaterial({ color: T.water, roughness: 0.06, metalness: 0.2, transparent: true, opacity: 0.86, normalMap: TX.waterNormal(), normalScale: new THREE.Vector2(0.35, 0.35) });
      if (mat.normalMap) mat.normalMap.repeat.set(3, 3);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(p.x, y, p.z);
      m.receiveShadow = true;
      m.renderOrder = 1;
      G.add(m);
      if (!p.ice) this.water.push(m);
      // kıyıdaki sazlıklar / kayalar
      const R = mulberry32(p.x * 100 | 0);
      const reeds = [];
      for (let i = 0; i < 26; i++) {
        const a = R() * TAU, d = p.r * (0.95 + R() * 0.35);
        const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
        const h = 0.6 + R() * 0.9;
        reeds.push(colorize(xf(new THREE.ConeGeometry(0.05, h, 3), x, world.height(x, z) + h / 2, z, (R() - 0.5) * 0.3, 0, (R() - 0.5) * 0.3), T.ice ? '#a39c86' : '#6d8a3a'));
      }
      const rm = new THREE.Mesh(mergeList(reeds, ['position', 'normal', 'color']), new THREE.MeshLambertMaterial({ vertexColors: true }));
      G.add(rm);
    }
  }

  buildObstacles(world, G, R) {
    const T = world.theme;
    const std = o => new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, ...o });
    const H = (x, z) => world.height(x, z);

    // Yıkık duvarlar: hepsi tek geometride birleşir
    const wallGeos = [];
    for (const o of world.obstacles) {
      if (o.kind !== 'wall') continue;
      const w = o.hw * 2, d = o.hd * 2, h = o.h;
      const g = new THREE.BoxGeometry(w, h + 0.6, d);
      const uv = g.attributes.uv, p = g.attributes.position, nrm = g.attributes.normal;
      for (let i = 0; i < uv.count; i++) {
        const ax = Math.abs(nrm.getX(i)), ay = Math.abs(nrm.getY(i));
        const u = ax > 0.5 ? p.getZ(i) : p.getX(i);
        const v = ay > 0.5 ? p.getZ(i) : p.getY(i);
        uv.setXY(i, u / 2.6, (v + h / 2) / 2.6);
      }
      xf(g, o.x, H(o.x, o.z) + h / 2 - 0.3, o.z, 0, -o.rot, 0);
      wallGeos.push(g);
      const n = 1 + ((R() * 3) | 0);
      for (let k = 0; k < n; k++) {
        const L = Math.max(w, d), along = w > d;
        const off = (R() - 0.5) * (L - 0.6);
        const bw = 0.4 + R() * 0.7, bh = 0.2 + R() * 0.5;
        const b = new THREE.BoxGeometry(along ? bw : w, bh, along ? d : bw);
        const lx = along ? off : 0, lz = along ? 0 : off;
        xf(b, o.x + lx * o.c - lz * o.s, H(o.x, o.z) + h - 0.3 + bh / 2, o.z + lx * o.s + lz * o.c, 0, -o.rot, 0);
        wallGeos.push(b);
      }
    }
    if (wallGeos.length) {
      const m = new THREE.Mesh(mergeList(wallGeos), occluderFade(std({ map: TX.wallTexture(T.wall), roughness: 0.95 })));
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
        c.setHSL(0.11, 0.25 + b[4] * 0.15, 0.6 + b[4] * 0.12);
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
      const ng = ni(g);
      ng.computeVertexNormals();
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
    for (let i = 0; i < 70; i++) {
      const a = R() * TAU, d = ARENA + 4 + R() * 55;
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

    // Variller
    if (world.barrels.length) {
      const g = new THREE.CylinderGeometry(0.58, 0.58, 1.25, 16);
      const m = new THREE.InstancedMesh(g, std({ map: TX.barrelTexture(), roughness: 0.5, metalness: 0.35 }), world.barrels.length);
      world.barrels.forEach((o, i) => {
        tmpQ.setFromAxisAngle(UP, o.rnd * TAU);
        tmpM.compose(tmpP.set(o.x, H(o.x, o.z) + 0.62, o.z), tmpQ, tmpS.set(1, 1, 1));
        m.setMatrixAt(i, tmpM);
      });
      m.castShadow = m.receiveShadow = true;
      G.add(m);
      this.barrelMesh = m;
    }

    // Tank tuzakları
    const hog = world.obstacles.filter(o => o.kind === 'hedgehog');
    if (hog.length) {
      const parts = [];
      for (let k = 0; k < 3; k++) {
        const b = new THREE.BoxGeometry(2.2, 0.16, 0.16);
        const r = [[0, 0, 0.62], [0, Math.PI / 2, 0.62], [Math.PI / 2, 0, 0]][k];
        b.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(r[0], r[1], r[2])));
        parts.push(b);
      }
      const g = mergeList(parts);
      g.translate(0, 0.62, 0);
      const m = new THREE.InstancedMesh(g, std({ color: '#5a4a3e', roughness: 0.55, metalness: 0.55 }), hog.length);
      hog.forEach((o, i) => {
        tmpQ.setFromAxisAngle(UP, o.rot);
        tmpM.compose(tmpP.set(o.x, H(o.x, o.z), o.z), tmpQ, tmpS.set(1, 1, 1));
        m.setMatrixAt(i, tmpM);
      });
      m.castShadow = true;
      G.add(m);
    }

    // Konteynerler
    const cont = world.obstacles.filter(o => o.kind === 'container');
    if (cont.length) {
      const list = [];
      for (const o of cont) {
        list.push([o.x, H(o.x, o.z) + 1.3 - 0.1, o.z, o.rot, o.color]);
        if (o.stack > 1) list.push([o.x, H(o.x, o.z) + 3.9 - 0.1, o.z, o.rot + 0.04, o.color2]);
      }
      const g = new THREE.BoxGeometry(6.1, 2.6, 2.44);
      const uv = g.attributes.uv, nrm = g.attributes.normal;
      for (let i = 0; i < uv.count; i++) if (Math.abs(nrm.getX(i)) < 0.5) uv.setX(i, uv.getX(i) * 3);
      const m = new THREE.InstancedMesh(g, occluderFade(std({ map: TX.containerTexture(), roughness: 0.55, metalness: 0.45 })), list.length);
      const c = new THREE.Color();
      list.forEach((q, i) => {
        tmpQ.setFromAxisAngle(UP, -q[3]);
        tmpM.compose(tmpP.set(q[0], q[1], q[2]), tmpQ, tmpS.set(1, 1, 1));
        m.setMatrixAt(i, tmpM);
        m.setColorAt(i, c.set(q[4]));
      });
      m.castShadow = m.receiveShadow = true;
      G.add(m);
    }

    // Beton bariyerler
    const jer = world.obstacles.filter(o => o.kind === 'jersey');
    if (jer.length) {
      const s = new THREE.Shape();
      s.moveTo(-0.36, 0);
      s.lineTo(0.36, 0);
      s.lineTo(0.3, 0.12);
      s.lineTo(0.12, 0.3);
      s.lineTo(0.1, 0.85);
      s.lineTo(-0.1, 0.85);
      s.lineTo(-0.12, 0.3);
      s.lineTo(-0.3, 0.12);
      s.closePath();
      const g = new THREE.ExtrudeGeometry(s, { depth: 3.1, bevelEnabled: false });
      g.translate(0, 0, -1.55);
      g.rotateY(Math.PI / 2);
      const pa = g.attributes.position, uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, pa.getX(i) / 3.1 + 0.5, pa.getY(i) / 0.85);
      const m = new THREE.InstancedMesh(g, std({ map: TX.concreteTexture(), roughness: 0.9 }), jer.length);
      jer.forEach((o, i) => {
        tmpQ.setFromAxisAngle(UP, -o.rot);
        tmpM.compose(tmpP.set(o.x, H(o.x, o.z) - 0.05, o.z), tmpQ, tmpS.set(1, 1, 1));
        m.setMatrixAt(i, tmpM);
      });
      m.castShadow = m.receiveShadow = true;
      G.add(m);
    }

    // Saman balyaları
    const hay = world.obstacles.filter(o => o.kind === 'hay');
    if (hay.length) {
      const m = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.85, 0.85, 1.5, 18), std({ map: TX.hayTexture(), roughness: 1 }), hay.length);
      hay.forEach((o, i) => {
        if (o.stand) tmpE.set(0, o.rot, 0);
        else tmpE.set(Math.PI / 2, 0, o.rot, 'YXZ');
        tmpQ.setFromEuler(tmpE);
        tmpM.compose(tmpP.set(o.x, H(o.x, o.z) + (o.stand ? 0.75 : 0.8), o.z), tmpQ, tmpS.set(1, 1, 1));
        m.setMatrixAt(i, tmpM);
      });
      m.castShadow = m.receiveShadow = true;
      G.add(m);
    }

    // Çadırlar
    const tents = world.obstacles.filter(o => o.kind === 'tent');
    if (tents.length) {
      const geos = [];
      for (const o of tents) {
        const w = o.hw * 2, d = o.hd * 2, h = o.h;
        const pts = [
          [-w / 2, 0, -d / 2], [w / 2, 0, -d / 2], [w / 2, h, 0], [-w / 2, h, 0],
          [-w / 2, 0, d / 2], [w / 2, 0, d / 2], [w / 2, h, 0], [-w / 2, h, 0],
        ];
        const tri = [[0, 2, 1], [0, 3, 2], [5, 7, 4], [5, 6, 7], [1, 6, 5], [4, 3, 0]];
        const pos = [], uvs = [];
        for (const t of tri) for (const k of t) {
          pos.push(...pts[k]);
          uvs.push(pts[k][0] / 2 + 0.5, pts[k][1] / 2);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        g.computeVertexNormals();
        xf(g, o.x, H(o.x, o.z) - 0.05, o.z, 0, -o.rot, 0);
        geos.push(g);
      }
      const m = new THREE.Mesh(mergeList(geos), occluderFade(std({ map: TX.canvasTexture(), color: T.trees[0] === 'palm' ? '#b4a276' : '#6f7a4a', side: THREE.DoubleSide })));
      m.castShadow = m.receiveShadow = true;
      G.add(m);
    }

    // Gözetleme kuleleri
    const towers = world.obstacles.filter(o => o.kind === 'tower');
    if (towers.length) {
      const geos = [];
      for (const o of towers) {
        const y0 = H(o.x, o.z) - 0.2;
        const parts = [];
        for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) parts.push(xf(new THREE.BoxGeometry(0.22, 6.2, 0.22), sx * 1.1, 3.1, sz * 1.1, sz * 0.05, 0, -sx * 0.05));
        for (const y of [1.6, 3.4]) {
          parts.push(xf(new THREE.BoxGeometry(2.4, 0.12, 0.12), 0, y, 1.1, 0, 0, 0.6));
          parts.push(xf(new THREE.BoxGeometry(2.4, 0.12, 0.12), 0, y, -1.1, 0, 0, -0.6));
        }
        parts.push(xf(new THREE.BoxGeometry(3.0, 0.2, 3.0), 0, 6.2, 0));
        for (const s of [-1, 1]) {
          parts.push(xf(new THREE.BoxGeometry(3.0, 0.9, 0.1), 0, 6.75, s * 1.45));
          parts.push(xf(new THREE.BoxGeometry(0.1, 0.9, 3.0), s * 1.45, 6.75, 0));
        }
        for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) parts.push(xf(new THREE.BoxGeometry(0.12, 1.6, 0.12), sx * 1.4, 7.6, sz * 1.4));
        parts.push(xf(new THREE.ConeGeometry(2.4, 1.1, 4), 0, 8.9, 0, 0, Math.PI / 4, 0));
        const g = mergeList(parts);
        xf(g, o.x, y0, o.z, 0, o.rnd * TAU, 0);
        geos.push(g);
      }
      const m = new THREE.Mesh(mergeList(geos), occluderFade(std({ color: T.wood, roughness: 0.95 })));
      m.castShadow = m.receiveShadow = true;
      G.add(m);
    }

    // Süsler: çalı, moloz, çit
    const bushes = world.decor.filter(d => d.kind === 'bush');
    if (bushes.length) {
      const g = new THREE.IcosahedronGeometry(0.8, 0);
      g.scale(1, 0.7, 1);
      const bc = T.snow ? '#e6ecf2' : T.trees[0] === 'palm' ? '#9a8a52' : '#5b8a34';
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
    const fences = world.decor.filter(d => d.kind === 'fence');
    if (fences.length) {
      const geos = [];
      for (const f of fences) {
        const n = Math.max(2, Math.round(f.len / 2.2));
        const ca = Math.cos(f.a), sa = Math.sin(f.a);
        for (let k = 0; k < n; k++) {
          const u = (k / (n - 1) - 0.5) * f.len;
          const x = f.x + ca * u, z = f.z + sa * u;
          geos.push(xf(new THREE.BoxGeometry(0.12, 1.2, 0.12), x, H(x, z) + 0.5, z));
        }
        for (const hh of [0.45, 0.9]) geos.push(xf(new THREE.BoxGeometry(f.len, 0.1, 0.05), f.x, H(f.x, f.z) + hh, f.z, 0, -f.a, 0));
      }
      const m = new THREE.Mesh(mergeList(geos), std({ color: '#8a6a45' }));
      m.castShadow = true;
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
    const pm = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.09, 1.5, 5), std({ color: '#6a5236' }), posts.length);
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
        g.applyMatrix4(new THREE.Matrix4().makeRotationZ(Math.atan2(b[1] - a[1], len)));
        xf(g, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + hh, (a[2] + b[2]) / 2, 0, -ang, 0);
        wires.push(g);
      }
    }
    if (wires.length) G.add(new THREE.Mesh(mergeList(wires), std({ color: '#3a3a36', metalness: 0.6, roughness: 0.5 })));
  }

  // Çatılı evler, ahır ve kütük evler
  buildBuildings(world, G, R) {
    const T = world.theme;
    const H = (x, z) => world.height(x, z);
    const walls = { house: [], barn: [], cabin: [] }, roofs = { house: [], barn: [], cabin: [] }, extra = [];
    for (const b of world.buildings) {
      if (!walls[b.kind]) continue;
      const { w, d, wallH } = b;
      const y0 = H(b.x, b.z) - 0.6;
      const wh = wallH + 0.6;
      const box = new THREE.BoxGeometry(w, wh, d);
      const uv = box.attributes.uv, p = box.attributes.position, nrm = box.attributes.normal;
      for (let i = 0; i < uv.count; i++) {
        const ax = Math.abs(nrm.getX(i)), ay = Math.abs(nrm.getY(i));
        const u = ax > 0.5 ? p.getZ(i) : p.getX(i);
        uv.setXY(i, ay > 0.5 ? 0 : u / 8 + 0.5, ay > 0.5 ? 0 : (p.getY(i) + wh / 2) / 4.2);
      }
      box.translate(0, wh / 2, 0);
      // üçgen alınlıklar
      const rh = d * 0.42;
      const gp = [], gu = [];
      for (const s of [-1, 1]) {
        const tri = s > 0 ? [[w / 2, wh, d / 2], [w / 2, wh, -d / 2], [w / 2, wh + rh, 0]] : [[-w / 2, wh, -d / 2], [-w / 2, wh, d / 2], [-w / 2, wh + rh, 0]];
        for (const q of tri) {
          gp.push(...q);
          gu.push(q[2] / 8 + 0.5, 0.85);
        }
      }
      const gable = new THREE.BufferGeometry();
      gable.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3));
      gable.setAttribute('uv', new THREE.Float32BufferAttribute(gu, 2));
      gable.computeVertexNormals();
      const wallGeo = mergeList([box, gable]);
      xf(wallGeo, b.x, y0, b.z, 0, -b.rot, 0);
      walls[b.kind].push(wallGeo);
      // çatı
      const o = 0.4;
      const rp = [], ru = [];
      const quads = [
        [[-w / 2 - o, wh - o * 0.84, d / 2 + o], [w / 2 + o, wh - o * 0.84, d / 2 + o], [w / 2 + o, wh + rh, 0], [-w / 2 - o, wh + rh, 0]],
        [[w / 2 + o, wh - o * 0.84, -d / 2 - o], [-w / 2 - o, wh - o * 0.84, -d / 2 - o], [-w / 2 - o, wh + rh, 0], [w / 2 + o, wh + rh, 0]],
      ];
      const slope = Math.hypot(d / 2 + o, rh + o * 0.84);
      for (const q of quads) {
        const uvq = [[0, 0], [w / 3, 0], [w / 3, slope / 3], [0, slope / 3]];
        for (const k of [0, 1, 2, 0, 2, 3]) {
          rp.push(...q[k]);
          ru.push(...uvq[k]);
        }
      }
      const roof = new THREE.BufferGeometry();
      roof.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
      roof.setAttribute('uv', new THREE.Float32BufferAttribute(ru, 2));
      roof.computeVertexNormals();
      xf(roof, b.x, y0, b.z, 0, -b.rot, 0);
      roofs[b.kind].push(roof);
      // baca
      if (b.kind !== 'barn') {
        const ch = xf(new THREE.BoxGeometry(0.6, 1.6, 0.6), w * 0.25, wh + rh * 0.6, d * 0.2);
        xf(ch, b.x, y0, b.z, 0, -b.rot, 0);
        extra.push(ch);
      }
    }
    const tints = { house: T.wall, barn: '#a3402f', cabin: T.wood };
    for (const k of Object.keys(walls)) {
      if (!walls[k].length) continue;
      const map = k === 'cabin' ? TX.logTexture() : TX.facadeTexture(tints[k]);
      const wm = new THREE.Mesh(mergeList(walls[k]), occluderFade(new THREE.MeshStandardMaterial({ map, color: k === 'cabin' ? T.wood : '#ffffff', roughness: 0.9 })));
      wm.castShadow = wm.receiveShadow = true;
      G.add(wm);
      const rm = new THREE.Mesh(mergeList(roofs[k]), occluderFade(new THREE.MeshStandardMaterial({
        map: TX.roofTexture(), color: T.snow ? '#e8eef4' : k === 'barn' ? '#6f6a64' : T.roof, roughness: 0.8, side: THREE.DoubleSide,
      })));
      rm.castShadow = rm.receiveShadow = true;
      G.add(rm);
    }
    if (extra.length) {
      const m = new THREE.Mesh(mergeList(extra), new THREE.MeshStandardMaterial({ color: '#8b5a44', roughness: 0.9 }));
      m.castShadow = true;
      G.add(m);
    }
  }

  // Ağaç geometrileri (tek parça, köşe renkli)
  treeGeo(kind) {
    this._treeGeos = this._treeGeos || {};
    if (this._treeGeos[kind]) return this._treeGeos[kind];
    const parts = [];
    const add = (g, color) => parts.push(colorize(g, color));
    if (kind === 'pine' || kind === 'snowpine') {
      add(xf(new THREE.CylinderGeometry(0.18, 0.32, 2.4, 6), 0, 1.2, 0), '#5a3f28');
      const greens = ['#2e5a2a', '#346531', '#3b7036', '#447a3b'];
      for (let i = 0; i < 4; i++) {
        const r = 2.3 - i * 0.48, y = 2.0 + i * 1.25;
        add(xf(new THREE.ConeGeometry(r, 2.4, 9), 0, y, 0, 0, i * 0.4, 0), greens[i]);
        if (kind === 'snowpine') add(xf(new THREE.ConeGeometry(r * 0.78, 1.0, 9), 0, y + 0.72, 0, 0, i * 0.4, 0), '#f3f7fa');
      }
    } else if (kind === 'oak') {
      add(xf(new THREE.CylinderGeometry(0.25, 0.42, 3, 7), 0, 1.5, 0), '#5a4330');
      add(xf(new THREE.CylinderGeometry(0.08, 0.14, 1.6, 5), 0.5, 2.9, 0, 0, 0, -0.7), '#5a4330');
      const g = ['#4e7f2d', '#5f9236', '#467527', '#6a9c3a', '#58892f'];
      [[0, 4.0, 0, 2.0], [1.3, 3.5, 0.4, 1.4], [-1.1, 3.6, -0.5, 1.5], [0.3, 5.1, -0.3, 1.4], [-0.4, 4.2, 1.1, 1.3]].forEach((q, i) =>
        add(xf(new THREE.IcosahedronGeometry(q[3], 1), q[0], q[1], q[2], i, i * 2, 0), g[i]));
    } else if (kind === 'birch') {
      add(xf(new THREE.CylinderGeometry(0.14, 0.22, 5, 6), 0, 2.5, 0), '#e8e6df');
      for (let i = 0; i < 5; i++) add(xf(new THREE.CylinderGeometry(0.15, 0.15, 0.12, 6), 0, 0.8 + i * 0.9, 0), '#2c2a26');
      const g = ['#8fbf4a', '#7fb040', '#a3c95a'];
      [[0, 4.6, 0, 1.3], [0.7, 4.0, 0.3, 1.0], [-0.6, 4.2, -0.3, 1.05], [0, 5.5, 0.2, 0.9]].forEach((q, i) =>
        add(xf(new THREE.IcosahedronGeometry(q[3], 1), q[0], q[1], q[2], i, i, 0, 1, 1.25, 1), g[i % 3]));
    } else if (kind === 'palm') {
      let x = 0, y = 0;
      for (let i = 0; i < 6; i++) {
        const seg = xf(new THREE.CylinderGeometry(0.19 - i * 0.012, 0.23 - i * 0.012, 1.2, 6), x, y + 0.6, 0, 0, 0, -0.07 * i);
        add(seg, i % 2 ? '#8a6c44' : '#7a5d3a');
        x += Math.sin(0.07 * i) * 1.2;
        y += 1.16;
      }
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * TAU;
        const leaf = new THREE.ConeGeometry(0.4, 3.2, 4);
        leaf.scale(1, 1, 0.22);
        xf(leaf, 0, 0, 0, 0, 0, -Math.PI / 2 - 0.45);
        xf(leaf, x + Math.cos(a) * 1.35, y - 0.25, Math.sin(a) * 1.35, 0, -a, 0);
        add(leaf, k % 2 ? '#4f8a2e' : '#62a03a');
      }
    } else {
      add(xf(new THREE.CylinderGeometry(0.18, 0.3, 3.2, 5), 0, 1.6, 0), '#7a6650');
      [[0.6, 2.4, 0.9], [-0.5, 2.8, -0.8], [0.2, 3.1, 0.5]].forEach((q, i) =>
        add(xf(new THREE.CylinderGeometry(0.05, 0.1, 1.6, 4), q[0] * 0.6, q[1], q[2] * 0.4, q[2], i * 2, q[0]), '#7a6650'));
    }
    // alt kısımlar biraz daha koyu (sahte ortam kapanması)
    const g = mergeGeometries(parts.map(p => {
      p.deleteAttribute('uv');
      const pos = p.attributes.position, col = p.attributes.color;
      for (let i = 0; i < pos.count; i++) {
        const k = 0.7 + 0.3 * Math.min(1, pos.getY(i) / 5);
        col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k);
      }
      return p;
    }));
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
    const n = T.trees[0] === 'palm' ? 70 : 300;
    for (let i = 0; i < n; i++) {
      const a = R() * TAU;
      const d = ARENA + 5 + Math.pow(R(), 0.7) * 80;
      const f = 1 + 0.25 * Math.abs(Math.sin(2 * a));
      const x = Math.cos(a) * d * f, z = Math.sin(a) * d * f;
      if (Math.max(Math.abs(x), Math.abs(z)) < ARENA + 4) continue;
      if (world.roadDist(x, z) < 4) continue;
      this.addTree(kinds[(R() * kinds.length) | 0], x, z, 1 + R() * 0.9, R());
    }
    this.flushTrees(G);
  }

  // Uzak dağlar ve bulutlar
  buildSkyDecor(world, G, R) {
    const T = world.theme;
    const fogC = new THREE.Color(T.skyHorizon);
    const geos = [];
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * TAU + R() * 0.2;
      const d = 330 + R() * 120;
      const h = 45 + R() * 75, r = 70 + R() * 70;
      const cone = new THREE.ConeGeometry(r, h, 7, 3);
      const p = cone.attributes.position;
      for (let k = 0; k < p.count; k++) {
        const y = p.getY(k);
        if (y > -h / 2 + 1 && y < h / 2 - 1) {
          p.setX(k, p.getX(k) * (0.85 + R() * 0.3));
          p.setZ(k, p.getZ(k) * (0.85 + R() * 0.3));
        }
      }
      const g = ni(cone);
      g.computeVertexNormals();
      const col = new Float32Array(g.attributes.position.count * 3);
      const base = new THREE.Color(T.mountain), snowC = new THREE.Color('#f4f8fc'), c = new THREE.Color();
      for (let k = 0; k < g.attributes.position.count; k++) {
        const y = g.attributes.position.getY(k);
        c.copy(base).lerp(fogC, 0.35 + (d - 330) / 400);
        if (T.snowCap && y > h * 0.18) c.lerp(snowC, 0.85);
        col.set([c.r, c.g, c.b], k * 3);
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.deleteAttribute('uv');
      xf(g, Math.cos(a) * d, h / 2 - 12, Math.sin(a) * d);
      geos.push(g);
    }
    const mm = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, fog: false }));
    G.add(mm);
    const ctex = TX.cloudTexture();
    for (let i = 0; i < 16; i++) {
      const mat = new THREE.SpriteMaterial({ map: ctex, transparent: true, depthWrite: false, fog: false, opacity: T.snow ? 0.9 : 0.8, color: T.snow ? '#eef2f6' : '#ffffff' });
      const s = new THREE.Sprite(mat);
      const a = R() * TAU, d = 120 + R() * 260;
      s.position.set(Math.cos(a) * d, 70 + R() * 70, Math.sin(a) * d);
      const k = 90 + R() * 110;
      s.scale.set(k, k * 0.42, 1);
      s.renderOrder = -5;
      G.add(s);
      this.clouds.push({ s, sp: 1 + R() * 2 });
    }
  }

  buildGrass(world, G, R) {
    const T = world.theme;
    const count = Math.round(this.q.grass * T.grassDensity);
    const windify = mat => {
      mat.onBeforeCompile = s => {
        s.uniforms.uTime = { value: 0 };
        this.grassMats.push(s);
        s.vertexShader = 'uniform float uTime;\n' + s.vertexShader.replace('#include <begin_vertex>',
          `#include <begin_vertex>
          vec4 ip = instanceMatrix[3];
          float sw = sin(uTime*1.7 + ip.x*0.35 + ip.z*0.27) * 0.5 + sin(uTime*2.9 + ip.x*0.8) * 0.25;
          transformed.x += sw * 0.14 * position.y;
          transformed.z += sw * 0.08 * position.y;`);
      };
      return mat;
    };
    const lim = ARENA + 14;
    const place = (m, n, palette, scale) => {
      const c = new THREE.Color();
      let k = 0;
      for (let i = 0; i < n * 3 && k < n; i++) {
        const x = (R() * 2 - 1) * lim, z = (R() * 2 - 1) * lim;
        if (Math.max(Math.abs(x), Math.abs(z)) < ARENA - 1 && !world.freeSpot(x, z, 0.4)) continue;
        if (world.roadDist(x, z) < 2.2 || world.inWater(x, z)) continue;
        const s = scale * (0.7 + R() * 0.8);
        tmpQ.setFromAxisAngle(UP, R() * TAU);
        tmpM.compose(tmpP.set(x, world.height(x, z) - 0.02, z), tmpQ, tmpS.set(s, s * (0.8 + R() * 0.5), s));
        m.setMatrixAt(k, tmpM);
        c.set(palette[(R() * palette.length) | 0]).multiplyScalar(0.85 + R() * 0.3);
        m.setColorAt(k, c);
        k++;
      }
      m.count = k;
      m.receiveShadow = true;
      G.add(m);
    };
    if (count >= 10) {
      const pos = [], col = [];
      for (let b = 0; b < 7; b++) {
        const a = (b / 7) * TAU + R(), r = 0.12 + R() * 0.22;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        const h = 0.35 + R() * 0.45, w = 0.06;
        const lean = 0.15 + R() * 0.2;
        const dx = Math.cos(a) * lean, dz = Math.sin(a) * lean;
        const px = -Math.sin(a) * w, pz = Math.cos(a) * w;
        pos.push(x - px, 0, z - pz, x + px, 0, z + pz, x + dx, h, z + dz);
        col.push(0.45, 0.45, 0.42, 0.45, 0.45, 0.42, 1.12, 1.12, 1.02);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.computeVertexNormals();
      const nn = g.attributes.normal;
      for (let i = 0; i < nn.count; i++) nn.setXYZ(i, nn.getX(i) * 0.3, 1, nn.getZ(i) * 0.3);
      place(new THREE.InstancedMesh(g, windify(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })), count), count, T.grass, 1);
    }
    if (T.flowers) {
      const pos = [], col = [];
      for (let b = 0; b < 3; b++) {
        const a = R() * TAU, r = R() * 0.2, x = Math.cos(a) * r, z = Math.sin(a) * r, h = 0.3 + R() * 0.25;
        pos.push(x - 0.01, 0, z, x + 0.01, 0, z, x, h, z);
        col.push(0.3, 0.5, 0.2, 0.3, 0.5, 0.2, 0.3, 0.5, 0.2);
        for (let p = 0; p < 4; p++) {
          const pa = (p / 4) * TAU;
          pos.push(x, h, z, x + Math.cos(pa) * 0.07, h + 0.02, z + Math.sin(pa) * 0.07, x + Math.cos(pa + 0.9) * 0.07, h + 0.02, z + Math.sin(pa + 0.9) * 0.07);
          col.push(1, 1, 1, 1, 1, 1, 1, 1, 1);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.computeVertexNormals();
      const nn = g.attributes.normal;
      for (let i = 0; i < nn.count; i++) nn.setXYZ(i, 0, 1, 0);
      const n = Math.round(count * 0.35);
      place(new THREE.InstancedMesh(g, windify(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })), n), n, T.flowers, 1.1);
    }
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

  setFadeTarget(x, y, z) {
    if (x == null) FADE.uFadeOn.value = 0;
    else {
      FADE.uFadeOn.value = 1;
      FADE.uFadeTarget.value.set(x, y, z);
    }
  }

  update(dt, fx, fz) {
    this.time += dt;
    for (const g of this.grassMats) g.uniforms.uTime.value = this.time;
    const snap = 84 / (this.q.shadowSize || 1024);
    const sx = Math.round(fx / snap) * snap, sz = Math.round(fz / snap) * snap;
    this.sun.target.position.set(sx, 0, sz);
    this.sun.position.set(sx + this.sunDir.x * 90, this.sunDir.y * 90, sz + this.sunDir.z * 90);
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
    for (const w of this.water) {
      const n = w.material.normalMap;
      n.offset.x = this.time * 0.02;
      n.offset.y = this.time * 0.013;
    }
    for (const c of this.clouds) {
      c.s.position.x += c.sp * dt;
      if (c.s.position.x > 400) c.s.position.x -= 800;
    }
    if (this.snow) {
      const p = this.snow.pos, cx = this.camera.position.x, cz = this.camera.position.z, cy = this.camera.position.y;
      for (let i = 0; i < p.length; i += 3) {
        p[i + 1] -= dt * (1.4 + (i % 7) * 0.12);
        p[i] += Math.sin(this.time + i) * dt * 0.3;
        if (p[i + 1] < cy - 12) p[i + 1] += 30;
        if (p[i] - cx > 40) p[i] -= 80;
        else if (p[i] - cx < -40) p[i] += 80;
        if (p[i + 2] - cz > 40) p[i + 2] -= 80;
        else if (p[i + 2] - cz < -40) p[i + 2] += 80;
      }
      this.snow.p.geometry.attributes.position.needsUpdate = true;
    }
    this.sky.position.copy(this.camera.position);
  }

  render() {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
