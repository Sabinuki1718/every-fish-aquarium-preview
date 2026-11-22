// fish-spec.json → three.js のメッシュ。
//
// 座標の決まり（docs/fish-spec.md）:
//   spec の x, y はすべて「全長 TL = 1」の単位。x=0 が吻端、x=1 が尾鰭後端。
//   y は上向きが正で、y=0 は吻端の高さ。側面図は「頭が左」。
//   モデル空間は cm 単位で、頭が +X、背が +Y、魚体の中心が原点。
//
// 胴体は、側面図の背側輪郭(top)・腹側輪郭(bottom)と、背面図の半幅(half_width)を
// 断面ごとの超楕円でつないで作る。鰭は側面図上の多角形を板として置く。
// テクスチャは側面図の座標にそのまま平行投影するので、三面図の側面図や
// 手続き的に描いた模様がそのまま体側に乗る。

import * as THREE from 'three';
import { curveOf, clamp } from './math.js';

export const MEDIAN_FINS = ['dorsal', 'dorsal1', 'dorsal2', 'dorsal3', 'adipose', 'anal', 'anal1', 'anal2', 'caudal', 'finlets'];
export const PAIRED_FINS = ['pectoral', 'pelvic'];

/** spec の輪郭を関数にまとめる。 */
export function bodyCurves(spec) {
  const b = spec.body;
  const top = curveOf(b.top);
  const bottom = curveOf(b.bottom);
  const halfWidth = curveOf(b.half_width);
  const exponent = curveOf(b.section_exponent, 2.2);
  const endX = b.end_x ?? 0.8;
  return { top, bottom, halfWidth, exponent, endX };
}

/** テクスチャが覆う範囲（spec 座標）。画像テクスチャはこの範囲を写した側面図とみなす。 */
export function textureBounds(spec) {
  const tb = spec.appearance?.texture_bounds;
  if (tb) return tb;
  // 体と鰭がすべて入る範囲を自動で求める
  let y0 = Infinity, y1 = -Infinity;
  const c = bodyCurves(spec);
  for (let i = 0; i <= 100; i++) {
    const x = (c.endX * i) / 100;
    y0 = Math.min(y0, c.bottom(x));
    y1 = Math.max(y1, c.top(x));
  }
  for (const f of spec.fins ?? []) for (const [, y] of f.outline ?? []) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const pad = 0.01;
  return { x0: -pad, x1: 1 + pad, y0: y0 - pad, y1: y1 + pad };
}

/** 体表の z（横幅方向）を求める。目や胸鰭の付け根を体表に置くのに使う。 */
export function surfaceZ(curves, x, y) {
  const t = curves.top(x), bo = curves.bottom(x), w = curves.halfWidth(x), n = curves.exponent(x);
  const c = (t + bo) / 2, a = Math.max(1e-6, (t - bo) / 2);
  const r = clamp(Math.abs((y - c) / a), 0, 1);
  return w * Math.pow(1 - Math.pow(r, n), 1 / n);
}

function uvOf(bounds, x, y) {
  return [(x - bounds.x0) / (bounds.x1 - bounds.x0), (y - bounds.y0) / (bounds.y1 - bounds.y0)];
}

/** 胴体のジオメトリ（cm 単位、頭が +X）。 */
export function buildBodyGeometry(spec, opts = {}) {
  const L = spec.length_cm;
  const c = bodyCurves(spec);
  const bounds = textureBounds(spec);
  const NX = opts.rings ?? 96, NA = opts.segments ?? 40;
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= NX; i++) {
    const u = i / NX;
    const x = c.endX * (0.5 - 0.5 * Math.cos(Math.PI * u)); // 吻端と尾柄を細かく
    const t = c.top(x), bo = c.bottom(x), w = Math.max(0, c.halfWidth(x)), n = c.exponent(x);
    const cy = (t + bo) / 2, a = Math.max(0, (t - bo) / 2);
    for (let j = 0; j < NA; j++) {
      const th = (j / NA) * Math.PI * 2;
      const s = Math.sin(th), co = Math.cos(th);
      const y = cy + a * Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
      const z = w * Math.sign(co) * Math.pow(Math.abs(co), 2 / n);
      pos.push((0.5 - x) * L, y * L, z * L);
      uv.push(...uvOf(bounds, x, y));
    }
  }
  for (let i = 0; i < NX; i++) {
    for (let j = 0; j < NA; j++) {
      const a = i * NA + j, b = i * NA + ((j + 1) % NA), cc = (i + 1) * NA + j, d = (i + 1) * NA + ((j + 1) % NA);
      idx.push(a, b, cc, b, d, cc); // 外向きの面になる順番
    }
  }
  // 尾柄の切り口をふさぐ
  const cap = pos.length / 3, xe = c.endX;
  pos.push((0.5 - xe) * L, ((c.top(xe) + c.bottom(xe)) / 2) * L, 0);
  uv.push(...uvOf(bounds, xe, (c.top(xe) + c.bottom(xe)) / 2));
  for (let j = 0; j < NA; j++) idx.push(NX * NA + j, NX * NA + ((j + 1) % NA), cap);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** 輪郭を一定間隔に打ち直す（曲げ変形をなめらかにするため）。 */
function resampleClosed(poly, step) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length];
    const len = Math.hypot(x1 - x0, y1 - y0), k = Math.max(1, Math.ceil(len / step));
    for (let s = 0; s < k; s++) out.push([x0 + ((x1 - x0) * s) / k, y0 + ((y1 - y0) * s) / k]);
  }
  return out;
}

/** 側面図上の多角形から鰭の板を作る（XY 平面、z=0）。 */
export function buildFinGeometry(spec, fin) {
  const L = spec.length_cm;
  const bounds = textureBounds(spec);
  const pts = resampleClosed(fin.outline, 0.01);
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2((0.5 - x) * L, y * L)));
  const g = new THREE.ShapeGeometry(shape);
  const p = g.attributes.position, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const x = 0.5 - p.getX(i) / L, y = p.getY(i) / L;
    const [u, v] = uvOf(bounds, x, y);
    uv[i * 2] = u; uv[i * 2 + 1] = v;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

function makeMaterials(spec, textures) {
  const ap = spec.appearance ?? {};
  const map = textures?.side ?? null;
  const body = new THREE.MeshPhysicalMaterial({
    color: map ? 0xffffff : new THREE.Color(ap.base_colors?.flank ?? '#9a9a90'),
    map,
    roughness: ap.roughness ?? 0.45,
    metalness: ap.metalness ?? 0.1,
    clearcoat: ap.clearcoat ?? 0.6,
    clearcoatRoughness: 0.35,
    iridescence: ap.iridescence ?? 0,
    iridescenceIOR: 1.6,
  });
  const fin = new THREE.MeshStandardMaterial({
    color: map ? 0xffffff : new THREE.Color(ap.fin_color ?? '#c8c0b0'),
    map,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: ap.fin_opacity ?? 0.92,
    roughness: 0.6,
    depthWrite: false,
    alphaTest: 0.04,
  });
  return { body, fin };
}

/**
 * 魚1匹分の Object3D を作る。
 * @param {object} spec fish-spec.json の中身
 * @param {object} [textures] { side: THREE.Texture } 側面投影テクスチャ（無ければ単色）
 */
export function buildFish(spec, textures = {}) {
  const L = spec.length_cm;
  const c = bodyCurves(spec);
  const mats = makeMaterials(spec, textures);
  const root = new THREE.Group();
  root.name = spec.id ?? 'fish';
  root.userData.spec = spec;
  root.userData.deformables = [];
  root.userData.pairedFins = [];

  const body = new THREE.Mesh(buildBodyGeometry(spec), mats.body);
  body.name = 'body';
  body.castShadow = true;
  root.add(body);
  root.userData.deformables.push({ mesh: body, normals: true });

  for (const fin of spec.fins ?? []) {
    if (!fin.outline || fin.outline.length < 3) continue;
    const isPaired = fin.paired ?? PAIRED_FINS.includes(fin.type);
    const geo = buildFinGeometry(spec, fin);
    if (!isPaired) {
      const m = new THREE.Mesh(geo, fin.opacity != null ? withOpacity(mats.fin, fin.opacity) : mats.fin);
      m.name = `fin_${fin.type}`;
      m.renderOrder = 1;
      root.add(m);
      root.userData.deformables.push({ mesh: m, normals: false });
      continue;
    }
    // 対鰭: 側面図上の輪郭（体側にたたんだ形）を、付け根の線を軸に開く
    const [b0, b1] = fin.base ?? [fin.outline[0], fin.outline[1]];
    const mid = [(b0[0] + b1[0]) / 2, (b0[1] + b1[1]) / 2];
    const axis = new THREE.Vector3(-(b1[0] - b0[0]) * L, (b1[1] - b0[1]) * L, 0).normalize();
    geo.translate(-(0.5 - mid[0]) * L, -mid[1] * L, 0);
    // 右体側（+z）で鰭先が外へ開く向きに軸をそろえる
    const cen = new THREE.Vector3();
    for (const [x, y] of fin.outline) cen.add(new THREE.Vector3((mid[0] - x) * L, (y - mid[1]) * L, 0));
    if (new THREE.Vector3().crossVectors(axis, cen).z < 0) axis.negate();
    for (const side of [1, -1]) {
      const pivot = new THREE.Group();
      pivot.name = `fin_${fin.type}_${side > 0 ? 'R' : 'L'}`;
      const zs = surfaceZ(c, mid[0], mid[1]) * L;
      pivot.position.set((0.5 - mid[0]) * L, mid[1] * L, side * zs);
      const mesh = new THREE.Mesh(geo, fin.opacity != null ? withOpacity(mats.fin, fin.opacity) : mats.fin);
      mesh.renderOrder = 1;
      pivot.add(mesh);
      const abd = THREE.MathUtils.degToRad(fin.spread_deg ?? (fin.type === 'pectoral' ? 35 : 25));
      pivot.userData = { axis, side, baseAngle: abd, flap: fin.flap ?? (fin.type === 'pectoral' ? 1 : 0.3), s: mid[0], basePos: pivot.position.clone() };
      pivot.quaternion.setFromAxisAngle(axis, side * abd);
      root.add(pivot);
      root.userData.pairedFins.push(pivot);
    }
  }

  // 目（体表に少し埋めた球。虹彩と瞳）
  const eye = spec.eye;
  if (eye) {
    const r = eye.r * L;
    const irisMat = new THREE.MeshPhysicalMaterial({ color: eye.iris ?? '#b8a060', roughness: 0.25, clearcoat: 1 });
    const pupilMat = new THREE.MeshPhysicalMaterial({ color: eye.pupil ?? '#0a0a0a', roughness: 0.1, clearcoat: 1 });
    for (const side of [1, -1]) {
      const g = new THREE.Group();
      g.name = `eye_${side > 0 ? 'R' : 'L'}`;
      const zs = surfaceZ(c, eye.x, eye.y) * L;
      g.position.set((0.5 - eye.x) * L, eye.y * L, side * (zs - r * (eye.inset ?? 0.2)));
      const iris = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), irisMat);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(r * (eye.pupil_ratio ?? 0.55), 16, 12), pupilMat);
      pupil.position.z = side * r * 0.55;
      g.add(iris, pupil);
      g.scale.z = eye.bulge ?? 0.45; // 眼球は体表から少しふくらむ程度にする
      root.add(g);
      g.userData.s = eye.x;
      g.userData.basePos = g.position.clone();
      root.userData.attached = [...(root.userData.attached ?? []), g];
    }
  }

  // ひげ（ドジョウ・ナマズ・コイなど）。側面図上の向き angle_deg は前向き0°・下向き90°
  for (const b of spec.barbels ?? []) {
    const len = b.length * L, a = THREE.MathUtils.degToRad(b.angle_deg ?? 60), sp = THREE.MathUtils.degToRad(b.spread_deg ?? 30);
    const mat = new THREE.MeshStandardMaterial({ color: b.color ?? '#b09a78', roughness: 0.6 });
    for (const side of [1, -1]) {
      const g = new THREE.Group();
      const zs = surfaceZ(c, b.x, b.y) * L;
      g.position.set((0.5 - b.x) * L, b.y * L, side * zs);
      const geo = new THREE.ConeGeometry((b.thickness ?? 0.004) * L, len, 6, 6);
      geo.translate(0, len / 2, 0);
      const pos = geo.attributes.position; // 先を少し曲げる
      for (let i = 0; i < pos.count; i++) { const t = pos.getY(i) / len; pos.setX(i, pos.getX(i) + t * t * len * 0.15); }
      const dir = new THREE.Vector3(Math.cos(a) * Math.cos(sp), -Math.sin(a) * Math.cos(sp), side * Math.sin(sp)).normalize();
      const m = new THREE.Mesh(geo, mat);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      g.add(m);
      g.name = 'barbel';
      g.userData.s = b.x;
      g.userData.basePos = g.position.clone();
      root.add(g);
      root.userData.attached = [...(root.userData.attached ?? []), g];
    }
  }

  for (const d of root.userData.deformables) d.base = Float32Array.from(d.mesh.geometry.attributes.position.array);
  return root;
}

function withOpacity(mat, opacity) {
  const m = mat.clone();
  m.opacity = opacity;
  return m;
}

/** 生成結果のおおまかな検査（テストと validate 用）。 */
export function measureFish(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  let vertices = 0;
  obj.traverse((o) => { if (o.isMesh) vertices += o.geometry.attributes.position.count; });
  return { length: size.x, height: size.y, width: size.z, vertices };
}
