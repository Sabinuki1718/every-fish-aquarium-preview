import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { buildFish, buildBodyGeometry, measureFish } from '../src/fishgen/fish-builder.js';
import { createSwimRig, SWIM_STYLES, prepareExternalModel } from '../src/fishgen/swim.js';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

// examples/*/fish-spec.js（window.FISH_SPECS = [...]）を読む
const EX = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../examples');
const loadSpecs = (file) => {
  const window = {};
  new Function('window', fs.readFileSync(file, 'utf8'))(window);
  return window.FISH_SPECS;
};
const specs = fs.readdirSync(EX).flatMap((d) => loadSpecs(path.join(EX, d, 'fish-spec.js')));

for (const spec of specs) {
  test(`${spec.name_ja}: 全長が spec どおりで、体の法線が外向き`, () => {
    const fish = buildFish(spec);
    const m = measureFish(fish);
    assert.ok(Math.abs(m.length - spec.length_cm) / spec.length_cm < 0.08, `全長 ${m.length} cm`);
    const g = buildBodyGeometry(spec), p = g.attributes.position, n = g.attributes.normal;
    let outward = 0, total = 0;
    for (let i = 0; i < p.count; i++) {
      if (Math.abs(p.getZ(i)) < spec.length_cm * 0.01) continue;
      total++;
      if (Math.sign(n.getZ(i)) === Math.sign(p.getZ(i))) outward++;
    }
    assert.ok(outward / total > 0.97, `外向きの法線 ${outward}/${total}`);
  });

  test(`${spec.name_ja}: 泳がせても頂点が壊れない`, () => {
    const fish = buildFish(spec);
    const rig = createSwimRig(fish, spec.swim);
    for (let t = 0; t < 2; t += 0.05) rig.update(t, 1, Math.sin(t));
    fish.traverse((o) => {
      if (!o.isMesh) return;
      for (const v of o.geometry.attributes.position.array) assert.ok(Number.isFinite(v));
    });
    const tail = fish.userData.deformables[0];
    const moved = tail.base.some((v, i) => Math.abs(v - tail.mesh.geometry.attributes.position.array[i]) > 1e-4);
    assert.ok(moved, '体がうねっていない');
  });
}

test('すべての遊泳様式でうねりの包絡は 0〜1 の範囲', () => {
  for (const [name, s] of Object.entries(SWIM_STYLES)) {
    for (let x = 0; x <= 1; x += 0.1) {
      const e = s.env(x);
      assert.ok(e >= 0 && e <= 1.0001, `${name} env(${x})=${e}`);
    }
  }
});

test('外部モデル（GLB 相当）も頂点を焼き込んで泳がせられる', () => {
  const root = new THREE.Group();
  const child = new THREE.Group();
  child.position.set(3, 0, 0);
  child.rotation.y = 0.3;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(10, 2, 1, 20, 2, 2), new THREE.MeshStandardMaterial());
  child.add(mesh);
  root.add(child);
  prepareExternalModel(root);
  assert.equal(mesh.parent, root);
  const rig = createSwimRig(root, { style: 'carangiform' });
  rig.update(0); rig.update(0.3, 1, 0);
  const p = mesh.geometry.attributes.position;
  for (let i = 0; i < p.count; i++) assert.ok(Number.isFinite(p.getZ(i)));
});
