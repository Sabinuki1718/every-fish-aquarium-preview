import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  isTap, watchStart, followDelta, clampWatchCamera, nextWatchId, backScreenVisible,
} from '../../.agents/skills/build-aquarium-from-fish-model/assets/fish-watch.mjs';

test('a small pointer movement is a tap, a drag is not', () => {
  assert.equal(isTap({ x: 10, y: 10 }, { x: 14, y: 13 }), true);
  assert.equal(isTap({ x: 10, y: 10 }, { x: 40, y: 10 }), false);
  assert.equal(isTap(null, { x: 0, y: 0 }), false);
});

test('the camera starts in front of the fish, closer on wide screens', () => {
  const fish = [0.02, 0.12, -0.03];
  for (const yaw of [0, 1.2, Math.PI, -2.5]) {
    const wide = watchStart(fish, yaw, { aspect: 1.6 });
    const tall = watchStart(fish, yaw, { aspect: 0.5 });
    assert.ok(wide.camera[2] > fish[2], 'camera is on the front-glass side');
    const dist = (s) => Math.hypot(s.camera[0] - fish[0], s.camera[2] - fish[2]);
    assert.ok(dist(tall) > dist(wide), 'phones step further back');
    assert.ok(wide.target[1] <= fish[1], 'aims at or below the fish');
  }
});

test('following moves camera and target by the fish movement', () => {
  assert.deepEqual(followDelta([0, 0.1, 0], [0.01, 0.1, -0.02]), [0.01, 0, -0.02]);
});

test('the close-up camera stays inside the side glasses and in front of the back glass', () => {
  const tank = { w: 0.3, d: 0.18 };
  const [x, y, z] = clampWatchCamera([0.5, -1, -0.5], tank);
  assert.ok(x < 0.15 && y >= 0.05 && z > -0.09);
  assert.deepEqual(clampWatchCamera([0, 0.1, 0.3], tank), [0, 0.1, 0.3]);   // in front of the tank is fine
});

test('next fish wraps around', () => {
  assert.equal(nextWatchId(['a', 'b', 'c'], 'c'), 'a');
  assert.equal(nextWatchId(['a', 'b', 'c'], null), 'a');
  assert.equal(nextWatchId([], 'a'), null);
});

test('a one-sided back screen is seen from the front and see-through from behind', () => {
  const backZ = -0.09;
  assert.equal(backScreenVisible(0.6, backZ), true);
  assert.equal(backScreenVisible(-0.6, backZ), false);
  // the three.js form of the same rule: a FrontSide plane facing +z is not hit from behind
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.24), new THREE.MeshBasicMaterial({ side: THREE.FrontSide }));
  screen.position.z = backZ; screen.updateMatrixWorld();
  const hit = (z) => new THREE.Raycaster(new THREE.Vector3(0, 0, z), new THREE.Vector3(0, 0, Math.sign(backZ - z)))
    .intersectObject(screen).length > 0;
  assert.equal(hit(0.6), true);
  assert.equal(hit(-0.6), false);
});
