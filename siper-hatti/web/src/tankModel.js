// Ayrıntılı tank modelleri: birleştirilmiş geometri (az çizim çağrısı), gölgelendiricide kamuflaj.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { colorize } from './scene.js';
import { treadTexture, particleAtlas } from './textures.js';
import { lerp, damp, angDiff } from './util.js';

const SPECS = {
  light: { len: 3.1, hullW: 1.3, trackW: 0.42, hullH: 0.52, t: 0.8, bLen: 1.8, bR: 0.065, skirts: false, wheels: 5, boxy: false, twin: false },
  medium: { len: 3.5, hullW: 1.5, trackW: 0.5, hullH: 0.62, t: 1.0, bLen: 2.35, bR: 0.085, skirts: true, wheels: 6, boxy: false, twin: false },
  heavy: { len: 3.7, hullW: 1.62, trackW: 0.56, hullH: 0.68, t: 1.12, bLen: 2.5, bR: 0.11, skirts: true, wheels: 7, boxy: true, twin: false },
  boss: { len: 3.9, hullW: 1.75, trackW: 0.6, hullH: 0.72, t: 1.2, bLen: 2.4, bR: 0.1, skirts: true, wheels: 8, boxy: true, twin: true },
};

const tmpE = new THREE.Euler();
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const tmpS = new THREE.Vector3();

function part(list, geo, color, paint, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const g = colorize(geo, color);
  const n = g.attributes.position.count;
  const p = new Float32Array(n).fill(paint);
  g.setAttribute('paint', new THREE.BufferAttribute(p, 1));
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
  const y0 = 0.36, top = y0 + H;
  const DARK = '#2a2b25', METAL = '#3b3c36', PAINT = '#ffffff', PAINT_D = '#b9b9b9';

  // --- gövde ---
  const hull = [];
  const hs = new THREE.Shape();
  hs.moveTo(-L / 2, y0);
  hs.lineTo(-L / 2 - 0.06, y0 + H * 0.62);
  hs.lineTo(-L / 2 + 0.22, top);
  hs.lineTo(L / 2 - 0.85, top);
  hs.lineTo(L / 2 + 0.06, y0 + H * 0.42);
  hs.lineTo(L / 2 - 0.18, y0);
  hs.closePath();
  const hg = new THREE.ExtrudeGeometry(hs, { depth: W, bevelEnabled: true, bevelSize: 0.035, bevelThickness: 0.035, bevelSegments: 1 });
  hg.translate(0, 0, -W / 2);
  part(hull, hg, PAINT, 1);
  // çamurluklar ve etekler
  const fz = W / 2 + TW / 2 + 0.02;
  for (const s of [-1, 1]) {
    part(hull, box(L + 0.12, 0.05, TW + 0.1), PAINT_D, 1, 0.02, 0.8, s * fz);
    if (S.skirts) part(hull, box(L * 0.84, 0.34, 0.05), PAINT, 1, -0.05, 0.62, s * (W / 2 + TW + 0.07));
    // tekerlekler
    const nW = S.wheels, span = L - 0.9;
    const wz = s * (W / 2 + 0.02 + TW - 0.02);
    for (let i = 0; i < nW; i++) {
      const x = -span / 2 + (i / (nW - 1)) * span;
      part(hull, cyl(0.27, 0.27, 0.14, 14), '#44453d', 0, x, 0.3, wz, Math.PI / 2);
      part(hull, cyl(0.1, 0.12, 0.17, 8), PAINT_D, 1, x, 0.3, wz + s * 0.01, Math.PI / 2);
    }
    // ön dişli ve arka avara
    part(hull, cyl(0.24, 0.24, 0.16, 10), METAL, 0, L / 2 - 0.05, 0.46, wz, Math.PI / 2);
    part(hull, cyl(0.22, 0.22, 0.16, 10), METAL, 0, -L / 2 + 0.05, 0.44, wz, Math.PI / 2);
    // alet kutusu
    part(hull, box(0.8, 0.2, TW * 0.7), PAINT_D, 1, -0.55, 0.92, s * fz);
    // farlar
    part(hull, cyl(0.07, 0.08, 0.1, 8), '#e9e3c4', 0, L / 2 - 0.62, top + 0.06, s * (W / 2 - 0.16), 0, 0, Math.PI / 2);
    // egzoz
    part(hull, cyl(0.075, 0.075, 0.34, 8), '#2d2a26', 0, -L / 2 - 0.08, y0 + H * 0.72, s * 0.42, 0, 0, Math.PI / 2);
  }
  // motor ızgarası
  part(hull, box(0.95, 0.03, W * 0.72), DARK, 0, -L / 2 + 0.72, top + 0.02, 0);
  for (let i = 0; i < 5; i++) part(hull, box(0.05, 0.035, W * 0.66), '#1b1c18', 0, -L / 2 + 0.36 + i * 0.18, top + 0.035, 0);
  // ön zırhta yedek palet
  part(hull, box(0.12, 0.08, W * 0.75), METAL, 0, L / 2 - 0.42, y0 + H * 0.66, 0, 0, 0, -0.6);

  // --- palet (ayrı; dokusu kayar) ---
  const Lt = L + 0.22, ht = 0.72, rr = 0.34;
  const ts = new THREE.Shape();
  ts.moveTo(-Lt / 2 + rr, 0.02);
  ts.lineTo(Lt / 2 - rr, 0.02);
  ts.absarc(Lt / 2 - rr, 0.02 + rr, rr, -Math.PI / 2, Math.PI / 2, false);
  ts.lineTo(-Lt / 2 + rr, 0.02 + ht - 0.04);
  ts.absarc(-Lt / 2 + rr, 0.02 + rr, rr, Math.PI / 2, (3 * Math.PI) / 2, false);
  const track = new THREE.ExtrudeGeometry(ts, { depth: TW, bevelEnabled: false, curveSegments: 6 });
  track.translate(0, 0, -TW / 2);

  // --- taret ---
  const tur = [];
  const pts = S.boxy
    ? [[1.05, 0.55], [0.82, 0.86], [-0.88, 0.86], [-1.12, 0.6], [-1.12, -0.6], [-0.88, -0.86], [0.82, -0.86], [1.05, -0.55]]
    : [[1.0, 0.4], [0.55, 0.78], [-0.72, 0.75], [-1.0, 0.46], [-1.0, -0.46], [-0.72, -0.75], [0.55, -0.78], [1.0, -0.4]];
  const shp = new THREE.Shape();
  pts.forEach(([x, z], i) => (i ? shp.lineTo(x * t, -z * t) : shp.moveTo(x * t, -z * t)));
  shp.closePath();
  const th = 0.5 * t;
  const tg = new THREE.ExtrudeGeometry(shp, { depth: th, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 2 });
  tg.rotateX(-Math.PI / 2);
  part(tur, tg, PAINT, 1, 0, 0.04, 0);
  part(tur, box(0.32, 0.42 * t, 0.62 * t), PAINT_D, 1, 1.0 * t + 0.08, 0.3 * t, 0);
  part(tur, cyl(0.24 * t, 0.26 * t, 0.2, 12), PAINT, 1, -0.3 * t, th + 0.14, -0.3 * t);
  part(tur, cyl(0.2 * t, 0.2 * t, 0.05, 12), PAINT_D, 1, -0.3 * t, th + 0.26, -0.3 * t);
  part(tur, cyl(0.025, 0.025, 0.7, 6), '#1e1f1a', 0, 0.05, th + 0.3, -0.3 * t, 0, 0, Math.PI / 2);
  part(tur, cyl(0.012, 0.018, 1.5, 4), '#1e1f1a', 0, -0.78 * t, th + 0.75, 0.46 * t);
  part(tur, box(0.34, 0.3 * t, 1.1 * t), PAINT_D, 1, -1.12 * t - 0.12, 0.26 * t, 0);
  for (const s of [-1, 1]) for (let k = 0; k < 3; k++) {
    part(tur, cyl(0.045, 0.045, 0.22, 6), '#2b2c27', 0, 0.62 * t - k * 0.1, 0.36 * t + k * 0.03, s * 0.74 * t, s * 0.9, 0, -0.5);
  }

  // --- namlu (geri tepme için ayrı) ---
  const bar = [];
  const bl = S.bLen, br = S.bR;
  const zs = S.twin ? [-0.24 * t, 0.24 * t] : [0];
  for (const z of zs) {
    part(bar, cyl(br, br * 1.08, bl, 12), PAINT_D, 1, bl / 2, 0, z, 0, 0, -Math.PI / 2);
    part(bar, cyl(br * 1.55, br * 1.55, 0.36, 12), PAINT_D, 1, bl * 0.46, 0, z, 0, 0, -Math.PI / 2);
    part(bar, cyl(br * 1.6, br * 1.5, 0.3, 10), '#2f302b', 0, bl + 0.1, 0, z, 0, 0, -Math.PI / 2);
  }

  const g = {
    spec: S,
    hull: mergeGeometries(hull),
    track,
    turret: mergeGeometries(tur),
    barrel: mergeGeometries(bar),
    turretPos: new THREE.Vector3(-0.12, top, 0),
    barrelPos: new THREE.Vector3(1.0 * t + 0.24, 0.3 * t, 0),
    muzzle: 1.0 * t + 0.24 + bl + 0.24,
    trackZ: W / 2 + TW / 2 + 0.02,
    height: top + th,
  };
  geoCache[key] = g;
  return g;
}

// Kamuflaj ve kirlilik ekleyen gövde malzemesi
function bodyMaterial(hex) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.18 });
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
        vec3 camo = uTeam * (cn > 0.56 ? 0.6 : (cn < 0.34 ? 1.14 : 1.0));
        camo *= 0.88 + 0.22*vn(vObj*11.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * camo, vPaint);
        float low = 1.0 - smoothstep(0.1, 0.8, vObj.y);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb*0.55 + vec3(0.075,0.06,0.04), low*0.55);
        diffuseColor.rgb *= 1.0 - uChar*0.86;`);
  };
  return m;
}

const capMat = new THREE.MeshStandardMaterial({ color: '#23241f', roughness: 0.9, metalness: 0.2 });
let shieldMat = null;
function getShieldMat() {
  if (shieldMat) return shieldMat;
  shieldMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uCol: { value: new THREE.Color('#5fb8ff') } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); vP = position; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform float uTime; uniform vec3 uCol; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 2.2); float band = 0.5+0.5*sin(vP.y*10.0 - uTime*4.0);
      gl_FragColor = vec4(uCol * (f*0.55 + band*0.03), 1.0); }`,
  });
  return shieldMat;
}
let blobMat = null;

export class TankView {
  constructor(stage, type, modelKey, hex, scale) {
    this.stage = stage;
    this.g = buildGeos(modelKey);
    this.scale = scale;
    const root = new THREE.Group();
    this.root = root;
    this.body = bodyMaterial(hex);
    this.hull = new THREE.Mesh(this.g.hull, this.body);
    root.add(this.hull);
    this.tracks = [];
    for (const s of [-1, 1]) {
      const tm = new THREE.MeshStandardMaterial({ map: treadTexture().clone(), color: '#9a9a8e', roughness: 0.9, metalness: 0.25 });
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
    this.barrel = new THREE.Group();
    this.barrel.position.copy(this.g.barrelPos);
    this.barrelMesh = new THREE.Mesh(this.g.barrel, this.body);
    this.barrel.add(this.barrelMesh);
    this.turret.add(this.barrel);
    root.add(this.turret);
    root.traverse(o => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    root.scale.setScalar(scale);

    this.shield = new THREE.Mesh(new THREE.SphereGeometry(2.6, 20, 14), getShieldMat());
    this.shield.scale.set(1.15, 0.72, 1.0);
    this.shield.position.y = 0.9;
    this.shield.visible = false;
    root.add(this.shield);

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
    this.recoil = 0;
    this.flash = 0;
    this.dead = false;
    this.fly = null;
    this.lastA = null;
    stage.scene.add(root);
  }

  get muzzleDist() {
    return this.g.muzzle * this.scale;
  }

  setColor(hex) {
    this.body.userData.team.value.set(hex);
  }

  kick() {
    this.recoil = 1;
  }

  hit() {
    this.flash = 1;
  }

  die() {
    this.dead = true;
    this.body.userData.char.value = 1;
    this.tracks.forEach(t => t.mat.color.set('#2a2a26'));
    this.fly = { x: 0, y: 0, z: 0, vx: (Math.random() - 0.5) * 3, vy: 6 + Math.random() * 3, vz: (Math.random() - 0.5) * 3, rx: (Math.random() - 0.5) * 6, rz: (Math.random() - 0.5) * 6, landed: false };
    this.shield.visible = false;
  }

  revive() {
    this.dead = false;
    this.body.userData.char.value = 0;
    this.tracks.forEach(t => t.mat.color.set('#9a9a8e'));
    this.fly = null;
    this.turret.position.copy(this.g.turretPos);
    this.turret.rotation.set(0, 0, 0);
  }

  // durum: {x, z, a, ta, alive, shield}
  update(dt, st, world) {
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

    // palet kaydırma: iki taraf dönüşe göre farklı
    if (this.lastA != null && !this.dead) {
      const dx = st.x - this.lastX, dz = st.z - this.lastZ;
      const fwd = dx * ca + dz * sa;
      const turn = angDiff(this.lastA, st.a);
      const w = this.g.trackZ * sc;
      const left = fwd + turn * w, right = fwd - turn * w;
      this.tracks[0].off -= left / sc * 1.3;
      this.tracks[1].off -= right / sc * 1.3;
      this.tracks[0].mat.map.offset.x = this.tracks[0].off;
      this.tracks[1].mat.map.offset.x = this.tracks[1].off;
    }
    this.lastX = st.x;
    this.lastZ = st.z;
    this.lastA = st.a;

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
    }

    this.recoil = Math.max(0, this.recoil - dt * 4.5);
    const rc = this.recoil;
    this.barrel.position.x = this.g.barrelPos.x - rc * rc * 0.45;
    this.turretMesh.position.x = -rc * 0.06;

    this.flash = Math.max(0, this.flash - dt * 6);
    this.body.emissive.setRGB(this.flash * 0.9, this.flash * 0.35, this.flash * 0.1);

    this.shield.visible = !!st.shield && !this.dead;
    if (this.shield.visible) {
      shieldMat.uniforms.uTime.value += dt / 3;
      shieldMat.uniforms.uCol.value.set(st.shield === 2 ? '#ffffff' : '#5fb8ff');
    }
    R.visible = st.visible !== false;
  }

  dispose() {
    this.stage.scene.remove(this.root);
    this.body.dispose();
    this.tracks.forEach(t => {
      t.mat.map.dispose();
      t.mat.dispose();
    });
    this.shield.geometry.dispose();
    if (this.blob) this.blob.geometry.dispose();
  }
}

export function tankHeight(modelKey) {
  return buildGeos(modelKey).height;
}
