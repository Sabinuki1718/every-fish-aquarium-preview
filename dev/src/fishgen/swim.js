// 遊泳様式ごとの体のうねり。頂点を体軸方向の位置 s（吻端0〜尾端1）に応じて横へずらす。
// buildFish() の魚にも、外部 GLB（Tripo など）にも同じ仕組みで動きを付けられる。

import * as THREE from 'three';

// env: うねりの振幅分布、waves: 体に乗る波の数、amp: 尾端の振幅（体長比）、freq: 拍動数(Hz)の目安
export const SWIM_STYLES = {
  anguilliform: { env: (s) => 0.25 + 0.75 * s, waves: 1.4, amp: 0.09, freq: 1.4 },    // ウナギ・ドジョウ・ギンポ
  subcarangiform: { env: (s) => s * s, waves: 1.0, amp: 0.1, freq: 2.0 },              // コイ科・サケ科など多くの魚
  carangiform: { env: (s) => s * s * s, waves: 0.9, amp: 0.1, freq: 2.6 },             // アジ・ブリ
  thunniform: { env: (s) => Math.pow(s, 6), waves: 0.8, amp: 0.09, freq: 3.0 },        // マグロ・カツオ
  ostraciiform: { env: (s) => Math.pow(s, 10), waves: 0.4, amp: 0.05, freq: 2.2 },     // ハコフグ（尾だけ振る）
  labriform: { env: (s) => s * s * s, waves: 0.8, amp: 0.03, freq: 1.2, finFlap: 1.0 }, // ベラ・スズメダイ（胸鰭で泳ぐ）
  balistiform: { env: (s) => Math.pow(s, 4), waves: 0.6, amp: 0.025, freq: 1.2 },      // カワハギ・モンガラ（背鰭と臀鰭）
  benthic: { env: (s) => s * s, waves: 1.0, amp: 0.06, freq: 2.4 },                    // ハゼ・カジカ（底で休み、短く泳ぐ）
  hovering: { env: (s) => s * s, waves: 0.8, amp: 0.025, freq: 1.0, finFlap: 0.7 },    // タツノオトシゴ以外の停泊型
  drifting: { env: (s) => s, waves: 0.5, amp: 0.02, freq: 0.5 },                       // 深海魚などほとんど動かない
};

/**
 * 魚の Object3D に泳ぎを付ける。返り値の update(t, effort, turn) を毎フレーム呼ぶ。
 * effort: 0〜1.5 程度（加速中は大きく）。turn: -1〜1（曲がる向き。体を弓なりに曲げる）。
 */
export function createSwimRig(fish, swimSpec = {}) {
  const style = SWIM_STYLES[swimSpec.style] ?? SWIM_STYLES.subcarangiform;
  const amp = swimSpec.amplitude ?? style.amp;
  const freq = swimSpec.frequency ?? style.freq;
  const k = Math.PI * 2 * (swimSpec.waves ?? style.waves);
  const finFlap = swimSpec.fin_flap ?? style.finFlap ?? 0.25;

  // 体の前後の範囲を求める（外部モデルにも対応するため、頂点から測る）
  if (!fish.userData.deformables) prepareExternalModel(fish);
  const box = new THREE.Box3();
  for (const d of fish.userData.deformables) {
    const b = d.base;
    for (let i = 0; i < b.length; i += 3) box.expandByPoint(new THREE.Vector3(b[i], b[i + 1], b[i + 2]));
  }
  const xHead = box.max.x, L = Math.max(1e-6, box.max.x - box.min.x);
  const sOf = (x) => THREE.MathUtils.clamp((xHead - x) / L, 0, 1);
  const pivotS = 0.3;
  const lateral = (s, phase, turn) => L * (amp * style.env(s) * Math.sin(phase - k * s) + turn * 0.18 * (s - pivotS) * (s - pivotS));
  const slope = (s, phase, turn) => (lateral(Math.min(1, s + 0.01), phase, turn) - lateral(s, phase, turn)) / (0.01 * L);

  let phase = 0, last = null;
  return {
    update(t, effort = 1, turn = 0) {
      const dt = last == null ? 0 : Math.min(0.1, t - last);
      last = t;
      phase += dt * Math.PI * 2 * freq * (0.35 + 0.65 * effort);
      const ref = lateral(pivotS, phase, turn);
      for (const d of fish.userData.deformables) {
        const p = d.mesh.geometry.attributes.position, b = d.base;
        for (let i = 0; i < p.count; i++) {
          const s = sOf(b[i * 3]);
          p.array[i * 3 + 2] = b[i * 3 + 2] + (lateral(s, phase, turn) - ref) * Math.min(1.2, effort + 0.2);
        }
        p.needsUpdate = true;
        if (d.normals) d.mesh.geometry.computeVertexNormals();
        d.mesh.geometry.boundingSphere = null;
      }
      for (const g of fish.userData.attached ?? []) {
        g.position.z = g.userData.basePos.z + (lateral(g.userData.s, phase, turn) - ref) * Math.min(1.2, effort + 0.2);
      }
      for (const pv of fish.userData.pairedFins ?? []) {
        const u = pv.userData;
        const flap = Math.sin(phase * 0.8 + (u.side > 0 ? 0 : Math.PI * 0.15)) * 0.35 * u.flap * finFlap;
        pv.position.z = u.basePos.z + (lateral(u.s, phase, turn) - ref) * Math.min(1.2, effort + 0.2);
        pv.quaternion.setFromAxisAngle(u.axis, u.side * (u.baseAngle + flap));
        pv.rotateY(-Math.atan(slope(u.s, phase, turn)) * 0.5);
      }
    },
  };
}

/**
 * 外部 GLB を泳がせる準備。頭の向き（forward_axis）を +X にそろえ、
 * 全メッシュの頂点を「魚の座標」に焼き込んで deformables に登録する。
 */
export function prepareExternalModel(root, opts = {}) {
  const deformables = [];
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const meshes = [];
  root.traverse((o) => { if (o.isMesh && !o.isSkinnedMesh) meshes.push(o); });
  for (const m of meshes) {
    const g = m.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    m.geometry = g;
    // 頂点を root 座標に焼き込んだので、root 直下・無変換に置き直す
    if (m.parent !== root) { m.removeFromParent(); root.add(m); }
    m.position.set(0, 0, 0); m.quaternion.identity(); m.scale.set(1, 1, 1);
    deformables.push({ mesh: m, normals: !!g.attributes.normal, base: Float32Array.from(g.attributes.position.array) });
  }
  root.userData.deformables = deformables;
  root.userData.pairedFins = [];
  return root;
}

/** 外部モデルの向き・大きさを fish-spec の external_model に合わせる（全長 cm にそろえる）。 */
export function normalizeExternalModel(scene, ext, lengthCm) {
  const wrap = new THREE.Group();
  wrap.add(scene);
  const axis = ext.forward_axis ?? '+X';
  const rot = { '+X': [0, 0, 0], '-X': [0, Math.PI, 0], '+Z': [0, Math.PI / 2, 0], '-Z': [0, -Math.PI / 2, 0], '+Y': [0, 0, -Math.PI / 2], '-Y': [0, 0, Math.PI / 2] }[axis];
  scene.rotation.set(...rot);
  if (ext.up_fix_deg) scene.rotateX(THREE.MathUtils.degToRad(ext.up_fix_deg));
  wrap.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
  const s = lengthCm / Math.max(1e-6, size.x);
  scene.position.sub(center);
  const outer = new THREE.Group();
  outer.add(wrap);
  wrap.scale.setScalar(s);
  outer.updateMatrixWorld(true);
  return prepareExternalModel(outer);
}
