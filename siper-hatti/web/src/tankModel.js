// Ayrıntılı tank modelleri: birleştirilmiş geometri (az çizim çağrısı), gölgelendiricide kamuflaj,
// gövdede yay-sönümleyici salınımı (hızlanma, fren, dönüş, geri tepme) ve namlu yükselişi.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { colorize } from './scene.js';
import { treadTexture, particleAtlas, numberDecal } from './textures.js';
import { lerp, damp, angDiff, clamp } from './util.js';

const SPECS = {
  light: { len: 3.2, hullW: 1.36, trackW: 0.44, hullH: 0.54, t: 0.82, bLen: 2.1, bR: 0.07, skirts: false, wheels: 5, boxy: false, twin: false },
  medium: { len: 3.6, hullW: 1.52, trackW: 0.5, hullH: 0.62, t: 1.0, bLen: 2.7, bR: 0.088, skirts: true, wheels: 6, boxy: false, twin: false },
  heavy: { len: 3.8, hullW: 1.64, trackW: 0.56, hullH: 0.7, t: 1.14, bLen: 2.9, bR: 0.11, skirts: true, wheels: 7, boxy: true, twin: false },
  boss: { len: 4.0, hullW: 1.76, trackW: 0.6, hullH: 0.74, t: 1.22, bLen: 2.7, bR: 0.1, skirts: true, wheels: 8, boxy: true, twin: true },
};

const tmpE = new THREE.Euler();
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const tmpS = new THREE.Vector3();

function part(list, geo, color, paint, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const g = colorize(geo, color);
  const n = g.attributes.position.count;
  g.setAttribute('paint', new THREE.BufferAttribute(new Float32Array(n).fill(paint), 1));
  tmpE.set(rx, ry, rz);
  tmpQ.setFromEuler(tmpE);
  tmpM.compose(tmpV.set(x, y, z), tmpQ, tmpS.set(1, 1, 1));
  g.applyMatrix4(tmpM);
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color', 'paint'].includes(k)) g.deleteAttribute(k);
  list.push(g);
}
const cyl = (r1, r2, h, s = 12) => new THREE.CylinderGeometry(r1, r2, h, s);
const box = (x, y, z) => new THREE.BoxGeometry(x, y, z);

const geoCache = {};
function buildGeos(key) {
  if (geoCache[key]) return geoCache[key];
  const S = SPECS[key];
  const L = S.len, W = S.hullW, H = S.hullH, TW = S.trackW, t = S.t;
  const y0 = 0.38, top = y0 + H;
  const DARK = '#2a2b25', METAL = '#3b3c36', PAINT = '#ffffff', PAINT_D = '#bdbdbd';

  // --- gövde (salınır) ---
  const hull = [];
  const hs = new THREE.Shape();
  hs.moveTo(-L / 2, y0);
  hs.lineTo(-L / 2 - 0.06, y0 + H * 0.62);
  hs.lineTo(-L / 2 + 0.22, top);
  hs.lineTo(L / 2 - 0.9, top);
  hs.lineTo(L / 2 + 0.07, y0 + H * 0.4);
  hs.lineTo(L / 2 - 0.2, y0);
  hs.closePath();
  const hg = new THREE.ExtrudeGeometry(hs, { depth: W, bevelEnabled: true, bevelSize: 0.035, bevelThickness: 0.035, bevelSegments: 1 });
  hg.translate(0, 0, -W / 2);
  part(hull, hg, PAINT, 1);
  const fz = W / 2 + TW / 2 + 0.02;
  for (const s of [-1, 1]) {
    part(hull, box(L + 0.14, 0.05, TW + 0.12), PAINT_D, 1, 0.02, 0.82, s * fz);
    part(hull, box(0.5, 0.05, TW + 0.1), PAINT_D, 1, L / 2 + 0.2, 0.7, s * fz, 0, 0, -0.5);
    if (S.skirts) {
      part(hull, box(L * 0.86, 0.36, 0.05), PAINT, 1, -0.04, 0.64, s * (W / 2 + TW + 0.08));
      for (let k = 0; k < 4; k++) part(hull, box(0.02, 0.36, 0.06), PAINT_D, 1, -L * 0.43 + (k + 0.5) * (L * 0.86 / 4), 0.64, s * (W / 2 + TW + 0.09));
    }
    part(hull, box(0.8, 0.2, TW * 0.7), PAINT_D, 1, -0.6, 0.94, s * fz);
    part(hull, box(0.5, 0.16, TW * 0.6), '#5a4a32', 0, 0.5, 0.92, s * fz);
    part(hull, cyl(0.08, 0.09, 0.1, 10), '#f4efd8', 0, L / 2 - 0.66, top + 0.07, s * (W / 2 - 0.16), 0, 0, Math.PI / 2);
    part(hull, cyl(0.075, 0.075, 0.36, 8), '#2d2a26', 0, -L / 2 - 0.08, y0 + H * 0.72, s * 0.42, 0, 0, Math.PI / 2);
  }
  part(hull, box(1.0, 0.03, W * 0.72), DARK, 0, -L / 2 + 0.76, top + 0.02, 0);
  for (let i = 0; i < 6; i++) part(hull, box(0.05, 0.035, W * 0.66), '#1b1c18', 0, -L / 2 + 0.34 + i * 0.16, top + 0.035, 0);
  for (let i = 0; i < 3; i++) part(hull, box(0.12, 0.07, W * 0.78), METAL, 0, L / 2 - 0.28 - i * 0.16, y0 + H * 0.6 + i * 0.08, 0, 0, 0, -0.6);
  part(hull, box(0.14, 0.5, 0.06), '#3a2c1c', 0, -L / 2 + 0.6, top + 0.06, W / 2 - 0.12, 0, 0, Math.PI / 2);

  // --- yürür takım (salınmaz) ---
  const gear = [];
  for (const s of [-1, 1]) {
    const nW = S.wheels, span = L - 0.9;
    const wz = s * (W / 2 + TW);
    for (let i = 0; i < nW; i++) {
      const x = -span / 2 + (i / (nW - 1)) * span;
      part(gear, cyl(0.28, 0.28, 0.14, 16), '#40413a', 0, x, 0.3, wz, Math.PI / 2);
      part(gear, cyl(0.17, 0.17, 0.16, 12), PAINT_D, 1, x, 0.3, wz + s * 0.01, Math.PI / 2);
      part(gear, cyl(0.06, 0.06, 0.18, 8), METAL, 0, x, 0.3, wz + s * 0.015, Math.PI / 2);
    }
    for (let i = 0; i < 3; i++) part(gear, cyl(0.08, 0.08, 0.12, 8), METAL, 0, -span / 3 + i * span / 3, 0.66, wz - s * 0.05, Math.PI / 2);
    part(gear, cyl(0.26, 0.26, 0.16, 12), METAL, 0, L / 2 - 0.02, 0.48, wz, Math.PI / 2);
    part(gear, cyl(0.23, 0.23, 0.16, 12), METAL, 0, -L / 2 + 0.04, 0.46, wz, Math.PI / 2);
  }

  // --- palet ---
  const Lt = L + 0.24, ht = 0.74, rr = 0.35;
  const ts = new THREE.Shape();
  ts.moveTo(-Lt / 2 + rr, 0.02);
  ts.lineTo(Lt / 2 - rr, 0.02);
  ts.absarc(Lt / 2 - rr, 0.02 + rr, rr, -Math.PI / 2, Math.PI / 2, false);
  ts.lineTo(-Lt / 2 + rr, 0.02 + ht - 0.04);
  ts.absarc(-Lt / 2 + rr, 0.02 + rr, rr, Math.PI / 2, (3 * Math.PI) / 2, false);
  const track = new THREE.ExtrudeGeometry(ts, { depth: TW, bevelEnabled: false, curveSegments: 7 });
  track.translate(0, 0, -TW / 2);

  // --- taret ---
  const tur = [];
  const pts = S.boxy
    ? [[1.08, 0.56], [0.84, 0.88], [-0.9, 0.88], [-1.15, 0.62], [-1.15, -0.62], [-0.9, -0.88], [0.84, -0.88], [1.08, -0.56]]
    : [[1.02, 0.4], [0.56, 0.8], [-0.74, 0.77], [-1.02, 0.48], [-1.02, -0.48], [-0.74, -0.77], [0.56, -0.8], [1.02, -0.4]];
  const shp = new THREE.Shape();
  pts.forEach(([x, z], i) => (i ? shp.lineTo(x * t, -z * t) : shp.moveTo(x * t, -z * t)));
  shp.closePath();
  const th = 0.52 * t;
  const tg = new THREE.ExtrudeGeometry(shp, { depth: th, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.07, bevelSegments: 2 });
  tg.rotateX(-Math.PI / 2);
  part(tur, tg, PAINT, 1, 0, 0.04, 0);
  part(tur, box(0.34, 0.44 * t, 0.64 * t), PAINT_D, 1, 1.02 * t + 0.08, 0.3 * t, 0);
  part(tur, cyl(0.25 * t, 0.27 * t, 0.22, 14), PAINT, 1, -0.3 * t, th + 0.15, -0.32 * t);
  part(tur, cyl(0.21 * t, 0.21 * t, 0.05, 14), PAINT_D, 1, -0.3 * t, th + 0.28, -0.32 * t);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    part(tur, box(0.07, 0.05, 0.05), '#9fc4d8', 0, -0.3 * t + Math.cos(a) * 0.25 * t, th + 0.2, -0.32 * t + Math.sin(a) * 0.25 * t);
  }
  part(tur, cyl(0.025, 0.025, 0.75, 6), '#1e1f1a', 0, 0.08, th + 0.34, -0.32 * t, 0, 0, Math.PI / 2);
  part(tur, box(0.18, 0.12, 0.14), '#2a2b25', 0, -0.22, th + 0.34, -0.32 * t);
  part(tur, cyl(0.2 * t, 0.2 * t, 0.12, 12), PAINT_D, 1, 0.2 * t, th + 0.08, 0.34 * t);
  part(tur, cyl(0.012, 0.018, 1.7, 4), '#1e1f1a', 0, -0.8 * t, th + 0.85, 0.48 * t);
  part(tur, box(0.36, 0.32 * t, 1.16 * t), PAINT_D, 1, -1.14 * t - 0.14, 0.26 * t, 0);
  part(tur, box(0.4, 0.06, 1.2 * t), '#2a2b25', 0, -1.14 * t - 0.14, 0.44 * t, 0);
  for (const s of [-1, 1]) for (let k = 0; k < 3; k++) {
    part(tur, cyl(0.045, 0.045, 0.24, 6), '#2b2c27', 0, 0.62 * t - k * 0.1, 0.36 * t + k * 0.03, s * 0.76 * t, s * 0.9, 0, -0.5);
  }

  // --- namlu (yükselir ve geri teper) ---
  const bar = [];
  const bl = S.bLen, br = S.bR;
  const zs = S.twin ? [-0.25 * t, 0.25 * t] : [0];
  for (const z of zs) {
    part(bar, cyl(br, br * 1.1, bl, 14), PAINT_D, 1, bl / 2, 0, z, 0, 0, -Math.PI / 2);
    part(bar, cyl(br * 1.6, br * 1.6, 0.4, 14), PAINT_D, 1, bl * 0.5, 0, z, 0, 0, -Math.PI / 2);
    part(bar, cyl(br * 1.65, br * 1.5, 0.32, 12), '#2f302b', 0, bl + 0.12, 0, z, 0, 0, -Math.PI / 2);
    part(bar, box(0.14, br * 2.2, br * 3.6), '#2f302b', 0, bl + 0.1, 0, z);
    part(bar, cyl(br * 1.25, br * 1.25, 0.3, 12), PAINT_D, 1, 0.15, 0, z, 0, 0, -Math.PI / 2);
  }

  const g = {
    spec: S,
    hull: mergeGeometries(hull),
    gear: mergeGeometries(gear),
    track,
    turret: mergeGeometries(tur),
    barrel: mergeGeometries(bar),
    turretPos: new THREE.Vector3(-0.12, top, 0),
    barrelPos: new THREE.Vector3(1.02 * t + 0.24, 0.3 * t, 0),
    muzzle: bl + 0.3,
    trackZ: W / 2 + TW / 2 + 0.02,
    height: top + th + 0.05,
    decalZ: 0.8 * t,
    th,
  };
  geoCache[key] = g;
  return g;
}

function bodyMaterial(hex) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.28, envMapIntensity: 0.9 });
  m.userData.team = { value: new THREE.Color(hex) };
  m.userData.char = { value: 0 };
  m.customProgramCacheKey = () => 'tankbody';
  m.onBeforeCompile = s => {
    s.uniforms.uTeam = m.userData.team;
    s.uniforms.uChar = m.userData.char;
    s.vertexShader = 'attribute float paint; varying float vPaint; varying vec3 vObj;\n' +
      s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvPaint = paint; vObj = position;');
    s.fragmentShader = `uniform vec3 uTeam; uniform float uChar; varying float vPaint; varying vec3 vObj;
      float h3(vec3 p){ p = fract(p*0.3183099+0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      float vn(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
        return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x), mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x), mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y), f.z); }
      ` + s.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        float cn = vn(vObj*1.25+3.0)*0.65 + vn(vObj*2.9)*0.35;
        vec3 camo = uTeam * (cn > 0.57 ? 0.66 : (cn < 0.33 ? 1.12 : 1.0));
        camo *= 0.9 + 0.2*vn(vObj*11.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * camo, vPaint);
        float low = 1.0 - smoothstep(0.1, 0.8, vObj.y);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb*0.55 + vec3(0.08,0.065,0.045), low*0.5);
        diffuseColor.rgb *= 1.0 - uChar*0.86;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + (vn(vObj*7.0)-0.5)*0.25 + uChar*0.3, 0.2, 1.0);`);
  };
  return m;
}

const capMat = new THREE.MeshStandardMaterial({ color: '#25261f', roughness: 0.9, metalness: 0.2 });
let blobMat = null;
let numberSeq = 100 + ((Math.random() * 800) | 0);

export class TankView {
  constructor(stage, type, modelKey, hex, scale) {
    this.stage = stage;
    this.g = buildGeos(modelKey);
    this.scale = scale;
    const root = new THREE.Group();
    this.root = root;
    this.body = bodyMaterial(hex);
    this.bodyGroup = new THREE.Group();
    root.add(this.bodyGroup);
    this.hull = new THREE.Mesh(this.g.hull, this.body);
    this.bodyGroup.add(this.hull);
    this.gear = new THREE.Mesh(this.g.gear, this.body);
    root.add(this.gear);
    this.tracks = [];
    for (const s of [-1, 1]) {
      const tm = new THREE.MeshStandardMaterial({ map: treadTexture().clone(), color: '#a09f94', roughness: 0.85, metalness: 0.35 });
      tm.map.repeat.set(1.3, 1);
      tm.map.needsUpdate = true;
      const tr = new THREE.Mesh(this.g.track, [capMat, tm]);
      tr.position.z = s * this.g.trackZ;
      root.add(tr);
      this.tracks.push({ mesh: tr, mat: tm, off: 0 });
    }
    this.turret = new THREE.Group();
    this.turret.position.copy(this.g.turretPos);
    this.turretMesh = new THREE.Mesh(this.g.turret, this.body);
    this.turret.add(this.turretMesh);
    this.gun = new THREE.Group();
    this.gun.position.copy(this.g.barrelPos);
    this.barrel = new THREE.Group();
    this.barrelMesh = new THREE.Mesh(this.g.barrel, this.body);
    this.barrel.add(this.barrelMesh);
    this.gun.add(this.barrel);
    this.turret.add(this.gun);
    this.bodyGroup.add(this.turret);
    // taret numarası
    this.decalTex = numberDecal(String(numberSeq++ % 1000).padStart(3, '0'));
    const dm = new THREE.MeshBasicMaterial({ map: this.decalTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.decalMat = dm;
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.62 * this.g.spec.t, 0.31 * this.g.spec.t), dm);
      p.position.set(-0.25 * this.g.spec.t, this.g.th * 0.55, s * (this.g.decalZ + 0.005));
      if (s < 0) p.rotation.y = Math.PI;
      this.turret.add(p);
    }
    root.traverse(o => {
      if (o.isMesh && o.material !== dm) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    root.scale.setScalar(scale);

    if (!stage.q.shadows) {
      if (!blobMat) blobMat = new THREE.MeshBasicMaterial({ map: particleAtlas(), color: '#000', transparent: true, opacity: 0.45, depthWrite: false });
      const pg = new THREE.PlaneGeometry(1, 1);
      pg.rotateX(-Math.PI / 2);
      const uv = pg.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.5, uv.getY(i) * 0.5 + 0.5);
      this.blob = new THREE.Mesh(pg, blobMat);
      this.blob.scale.set(this.g.spec.len * 1.5, 1, this.g.spec.hullW * 2.4);
      this.blob.position.y = 0.05;
      root.add(this.blob);
    }

    this.pitch = 0;
    this.roll = 0;
    this.sway = { p: 0, r: 0, vp: 0, vr: 0 };
    this.recoil = 0;
    this.flash = 0;
    this.dead = false;
    this.fly = null;
    this.lastA = null;
    this.vf = 0;
    this.acc = 0;
    this.time = Math.random() * 10;
    stage.scene.add(root);
  }

  get muzzleDist() {
    return this.g.muzzle * this.scale;
  }

  setColor(hex) {
    this.body.userData.team.value.set(hex);
  }

  // atış: gövdeye geri tepme darbesi (namlunun gövdeye göre açısıyla)
  kick(rel = 0, power = 1) {
    this.recoil = 1;
    this.sway.vp += Math.cos(rel) * 0.9 * power;
    this.sway.vr += -Math.sin(rel) * 0.7 * power;
  }

  hit(rel = 0) {
    this.flash = 1;
    this.sway.vr += Math.sin(rel) * 0.5;
    this.sway.vp += -Math.cos(rel) * 0.3;
  }

  die() {
    this.dead = true;
    this.body.userData.char.value = 1;
    this.tracks.forEach(t => t.mat.color.set('#2a2a26'));
    this.decalMat.opacity = 0.15;
    this.fly = { x: 0, y: 0, z: 0, vx: (Math.random() - 0.5) * 3, vy: 6 + Math.random() * 3, vz: (Math.random() - 0.5) * 3, rx: (Math.random() - 0.5) * 6, rz: (Math.random() - 0.5) * 6, landed: false };
  }

  revive() {
    this.dead = false;
    this.body.userData.char.value = 0;
    this.tracks.forEach(t => t.mat.color.set('#a09f94'));
    this.decalMat.opacity = 1;
    this.fly = null;
    this.turret.position.copy(this.g.turretPos);
    this.turret.rotation.set(0, 0, 0);
  }

  // durum: {x, z, a, ta, elev, visible, prot}
  update(dt, st, world) {
    this.time += dt;
    const R = this.root;
    const spec = this.g.spec, sc = this.scale;
    const ca = Math.cos(st.a), sa = Math.sin(st.a);
    const hl = spec.len * 0.45 * sc, hw = (spec.hullW / 2 + spec.trackW) * sc;
    const hc = world.height(st.x, st.z);
    const hf = world.height(st.x + ca * hl, st.z + sa * hl), hb = world.height(st.x - ca * hl, st.z - sa * hl);
    const hr = world.height(st.x - sa * hw, st.z + ca * hw), hL = world.height(st.x + sa * hw, st.z - ca * hw);
    const k = damp(10, dt);
    this.pitch = lerp(this.pitch, Math.atan2(hf - hb, hl * 2), k);
    this.roll = lerp(this.roll, Math.atan2(hL - hr, hw * 2), k);
    R.position.set(st.x, Math.max(hc, (hf + hb + hr + hL) / 4) - 0.02, st.z);
    R.rotation.set(this.roll, -st.a, this.pitch, 'YZX');

    // hareket ölçümü: ileri hız, ivme, dönüş hızı
    let turnRate = 0;
    if (this.lastA != null && dt > 0) {
      const dx = st.x - this.lastX, dz = st.z - this.lastZ;
      const fwd = dx * ca + dz * sa;
      const turn = angDiff(this.lastA, st.a);
      turnRate = turn / dt;
      const vf = fwd / dt;
      this.acc = lerp(this.acc, (vf - this.vf) / dt, damp(8, dt));
      this.vf = vf;
      if (!this.dead) {
        const w = this.g.trackZ * sc;
        this.tracks[0].off -= ((fwd + turn * w) / sc) * 1.3;
        this.tracks[1].off -= ((fwd - turn * w) / sc) * 1.3;
        this.tracks[0].mat.map.offset.x = this.tracks[0].off;
        this.tracks[1].mat.map.offset.x = this.tracks[1].off;
      }
    }
    this.lastX = st.x;
    this.lastZ = st.z;
    this.lastA = st.a;

    // gövde salınımı (yay-sönümleyici)
    const S = this.sway;
    if (!this.dead) {
      const tp = clamp(this.acc * 0.011, -0.07, 0.07);
      const tr = clamp(-turnRate * this.vf * 0.006, -0.06, 0.06);
      const idle = Math.sin(this.time * 31) * 0.0012 * (1 + Math.min(1, Math.abs(this.vf) / 5));
      S.vp += ((tp - S.p) * 70 - S.vp * 7) * dt;
      S.vr += ((tr - S.r) * 60 - S.vr * 6.5) * dt;
      S.p = clamp(S.p + S.vp * dt, -0.12, 0.12);
      S.r = clamp(S.r + S.vr * dt, -0.1, 0.1);
      this.bodyGroup.rotation.set(S.r, 0, S.p + idle);
      this.bodyGroup.position.y = -Math.abs(S.p) * 0.4;
    }

    if (this.fly) {
      const f = this.fly;
      if (!f.landed) {
        f.vy -= 18 * dt;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        f.z += f.vz * dt;
        this.turret.rotation.x += f.rx * dt;
        this.turret.rotation.z += f.rz * dt;
        if (f.y < -0.5 && f.vy < 0) {
          f.y = -0.5;
          f.landed = true;
        }
      }
      this.turret.position.set(this.g.turretPos.x + f.x, this.g.turretPos.y + f.y, f.z);
    } else {
      this.turret.rotation.set(0, -angDiff(st.a, st.ta), 0);
      this.gun.rotation.z = st.elev || 0;
    }

    this.recoil = Math.max(0, this.recoil - dt * 3.2);
    const rc = this.recoil;
    this.barrel.position.x = -rc * rc * 0.55;

    this.flash = Math.max(0, this.flash - dt * 6);
    const prot = st.prot && !this.dead ? 0.25 + 0.2 * Math.sin(this.time * 12) : 0;
    this.body.emissive.setRGB(this.flash * 0.9 + prot * 0.6, this.flash * 0.35 + prot * 0.8, this.flash * 0.1 + prot);
    R.visible = st.visible !== false;
  }

  dispose() {
    this.stage.scene.remove(this.root);
    this.body.dispose();
    this.decalTex.dispose();
    this.decalMat.dispose();
    this.tracks.forEach(t => {
      t.mat.map.dispose();
      t.mat.dispose();
    });
    if (this.blob) this.blob.geometry.dispose();
    this.turret.children.forEach(o => {
      if (o.isMesh && o.geometry.type === 'PlaneGeometry') o.geometry.dispose();
    });
  }
}

// Mermi çarpışması ve atış noktası için model ölçüleri
export function modelInfo(modelKey) {
  const g = buildGeos(modelKey);
  return {
    len: g.spec.len, width: g.spec.hullW + 2 * g.spec.trackW, height: g.height,
    gunH: g.turretPos.y + g.barrelPos.y, gunX: g.turretPos.x, pivotX: g.barrelPos.x, muzzle: g.muzzle,
  };
}
