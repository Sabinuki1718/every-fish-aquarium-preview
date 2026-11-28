/* Runtime part of rig-tripo-fish-fins, taken from projects/goldfish-aquarium/aquarium/src/app.js (three.js r170).
   Not a standalone module: copy the pieces into the aquarium page. Needs: fishGeo (geometry JSON with bones, skinIndex,
   skinWeight, iBody, iFin), helpers ease(), _q1/_q2/_q3/_v, _zAxis, and per fish: hover (0 swimming .. 1 hovering),
   F.brake, F.turn (rad/s), dt. */

// ---- 1. fin materials: depth pre-pass + translucent colour pass (no sorting artefacts) ----
    transformed.z += bend * sin(uSwimPhase - s * 4.6);`;
  function fishMaterial(kind, map, u) {
    const m = kind === 'fin'
      ? new THREE.MeshStandardMaterial({ map, transparent: true, depthWrite: false, depthFunc: THREE.LessEqualDepth, side: THREE.DoubleSide, roughness: 0.45 })
      : kind === 'finDepth'
      ? new THREE.MeshStandardMaterial({ colorWrite: false, depthWrite: true, side: THREE.DoubleSide })
      : (STD ? new THREE.MeshPhysicalMaterial({ map, roughness: 0.38, clearcoat: 0.35, clearcoatRoughness: 0.35, side: THREE.FrontSide })
             : new THREE.MeshStandardMaterial({ map, roughness: 0.42, side: THREE.FrontSide }));
    m.onBeforeCompile = sh => {
// ...
    // fins: first write their depth only, then draw the colour over that depth. Only the nearest fin layer is blended,
    // so lobes crossing each other or the body never pop in front/behind as the view turns.
    const finDepth = new THREE.SkinnedMesh(fishGeo.fin, fishMaterial('finDepth', map, u)); finDepth.renderOrder = 1;
    const fin = new THREE.SkinnedMesh(fishGeo.fin, fishMaterial('fin', map, u)); fin.renderOrder = 2;
    for (const m of [body, finDepth, fin]) { m.frustumCulled = false; m.userData.fishId = f.id; }
    body.castShadow = STD; finDepth.castShadow = STD;
    // skeleton: root bone + base/tip bone per pectoral and pelvic fin (built from the fin attachments)
    const bones = fishGeo.bones.map(b => { const bone = new THREE.Bone(); bone.name = b.name; bone.position.fromArray(b.pos); return bone; });
    fishGeo.bones.forEach((b, k) => { if (b.parent >= 0) bones[b.parent].add(bones[k]); });
    // each fin base bone gets its own frame (x = width along the attachment, y = out along the fin, z = fin normal), so
    // scaling x fans the rays and the tip bone bends about the fin normal
    fishGeo.bones.forEach((b, k) => {
      if (!b.name.endsWith('_base')) return;
      const h = new THREE.Vector3().fromArray(b.axis), o = new THREE.Vector3().fromArray(b.out), n = new THREE.Vector3().crossVectors(h, o).normalize();
      const q0 = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(h, o, n));
      bones[k].quaternion.copy(q0); bones[k].userData.q0 = q0;
      const tipK = fishGeo.bones.findIndex(x => x.name === b.name.replace('_base', '_tip'));
      bones[tipK].position.applyQuaternion(q0.clone().invert());
    });
    const rig = new THREE.Group(); rig.add(bones[0], body, finDepth, fin); rig.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(bones);
    for (const m of [body, finDepth, fin]) m.bind(skeleton);
    const finBones = [];
    fishGeo.bones.forEach((b, k) => {
      if (!b.name.endsWith('_base')) return;
      const hinge = new THREE.Vector3().fromArray(b.axis), out = new THREE.Vector3().fromArray(b.out);
      const sweep = new THREE.Vector3().crossVectors(hinge, out).normalize();       // normal to the fin: rowing fore and aft
      const tip = bones[fishGeo.bones.findIndex(x => x.name === b.name.replace('_base', '_tip'))];
      // pelvic rest pose: swung about its own attachment line (no twist of the fin plane) toward straight down
      let best = 0, lowest = Infinity;
      for (let a = -1.4; a <= 1.4; a += 0.02) { const y = out.clone().applyAxisAngle(hinge, a).y; if (y < lowest) { lowest = y; best = a; } }
      const rest = new THREE.Quaternion().setFromAxisAngle(hinge, best * 0.7), downAngle = best;
      const side = b.name.includes('_L_') ? 1 : -1;
      // signs so that +open moves the fin away from the body and +back sweeps it toward the tail
      const sOpen = Math.sign((out.clone().applyAxisAngle(hinge, 0.1).z - out.z) * side) || 1;
      const sBack = Math.sign(out.clone().applyAxisAngle(sweep, 0.1).x - out.x) || 1;
      finBones.push({ base: bones[k], tip, hinge, sweep, out, rest, downAngle, sOpen, sBack, pec: b.name.startsWith('pectoral'), side });
    });
    const root = new THREE.Group(); root.add(rig); root.scale.setScalar(f.length_cm / 12); root.rotation.order = 'YZX';
    root.userData.fishId = f.id; scene.add(root);
    fishes.push({ id: f.id, root, u, finBones, scale: f.length_cm / 12, mode: 'cruise', nextForage: 14 + i * 11 + Math.random() * 10, path: PATHS[f.id] || { c: [0, 0.18, 0.04], a: [0.14, 0.01, 0.03], w: 0.18, ph: i }, t: i * 7.3, paused: false });
  }
  const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
  const _v = new THREE.Vector3(), _e = new THREE.Euler(0, 0, 0, 'YZX'), _zAxis = new THREE.Vector3(0, 0, 1), _xAxis = new THREE.Vector3(1, 0, 0);

// ---- 2. per frame: paired fins ----
    // Two clear states: REST (fins pressed flat against the belly, still) and ROW (a set of full strokes, then back to rest).
    // A set is always finished: each side's last stroke ends folded, so the switch is crisp.
    const P_ = F.pec ??= { mode: 'rest', t: 0, dur: 1 + Math.random() * 2, n: 0 };
    P_.t += dt;
    const STROKE = 0.72;
    // the fish's own motion, in its body frame (model: forward = -x, up = +y): what the strokes have to produce
    if (F.prevPos && dt > 0) {
      _v.copy(F.root.position).sub(F.prevPos).divideScalar(dt).applyQuaternion(_q3.copy(F.root.quaternion).invert());
      const k = Math.min(1, dt * 1.2);                                                    // ignore the small rocking of each peck
      const fwd0 = F.mv?.fwd ?? -_v.x;
      F.mv = { fwd: fwd0 + (-_v.x - fwd0) * k, up: (F.mv?.up ?? _v.y) + (_v.y - (F.mv?.up ?? _v.y)) * k,
               acc: (F.mv?.acc ?? 0) + (((-_v.x - fwd0) * k) / dt - (F.mv?.acc ?? 0)) * k };
    }
    (F.prevPos ??= new THREE.Vector3()).copy(F.root.position);
    const mv = F.mv ?? { fwd: 0, up: 0, acc: 0 };
    const rise = THREE.MathUtils.clamp(mv.up / 0.008, -1, 1);                         // + rising, - diving
    const slowDown = Math.max(F.brake, THREE.MathUtils.clamp(-mv.acc / 0.01, 0, 1));
    // straight cruising: fins stay folded (as in the reference video); they work when hovering, rising, diving, braking or turning
    const needRow = hover > 0.4 || slowDown > 0.4 || Math.abs(rise) > 0.45 || Math.abs(F.turn) > 0.35;
    if (P_.mode === 'rest') {
      if (!needRow) P_.t = Math.min(P_.t, P_.dur * 0.6);
      const wantNow = needRow && (F.brake > 0.5 || P_.t > P_.dur * 0.5);
      if (needRow && (P_.t >= P_.dur || wantNow)) {
        P_.mode = 'row'; P_.t = 0;
        P_.n = hover > 0.5 || F.brake > 0.5 ? 3 + Math.floor(Math.random() * 4) : 1 + Math.floor(Math.random() * 2);
        P_.amp = hover > 0.5 || F.brake > 0.5 ? 1 : 0.65;
      }
    } else if (P_.t >= (P_.n + 0.5) * STROKE) {
      P_.mode = 'rest'; P_.t = 0;
      P_.dur = hover > 0.5 ? 0.8 + Math.random() * 1.4 : 2.5 + Math.random() * 3.5;
    }
    const inner = Math.sign(F.turn), turnAmt = Math.min(Math.abs(F.turn) / 0.5, 1);
    for (const B of F.finBones) {
      if (B.pec) {
        let s = 0, u = 0;
        if (P_.mode === 'row') {
          const c = P_.t / STROKE - (B.side > 0 ? 0 : 0.5);                                 // left leads, right half a stroke later
          if (c >= 0 && c < P_.n) { u = c - Math.floor(c); s = P_.amp * (u < 0.28 ? ease(u / 0.28) : 1 - ease((u - 0.28) / 0.72)); }
        }
        if (B.side === inner) s = Math.max(s, 0.3 * turnAmt);                                // inside fin held out as a rudder
        s = THREE.MathUtils.clamp(s, 0, 1);
        const drive = P_.mode === 'row' ? P_.amp : 0;
        // stroke direction follows the motion: forward -> sweep down-and-back; rising -> push straight down;
        // diving -> swing forward-and-up; braking -> swing forward
        const want = _v.set(0.55 + 0.35 * Math.max(0, rise) * -1 + 0.4 * THREE.MathUtils.clamp(mv.fwd / 0.02, 0, 1) * (1 - slowDown)
                              - 1.1 * slowDown - 0.9 * Math.max(0, -rise),
                            -1 + 0.55 * Math.max(0, -rise),
                            0.32 * B.side).normalize();
        B.aim = (B.aim ??= want.clone()).lerp(want, Math.min(1, dt * 1.2)).normalize();   // the aim settles between strokes
        if (P_.mode !== 'row' || s < 0.05) (B.hangQ ??= new THREE.Quaternion()).setFromUnitVectors(B.out, B.aim);
        B.reach ??= 1; if (P_.mode !== 'row' || s < 0.05) B.reach = Math.min(1, 1.0 / Math.max(0.01, B.out.angleTo(B.aim)));   // never swing more than ~57 deg
        _q1.identity().slerp(B.hangQ, s * B.reach);
        B.base.quaternion.copy(_q1).multiply(_q2.setFromAxisAngle(B.out, 0.15 * drive * Math.sin(u * 6.283) * B.side)).multiply(B.base.userData.q0);
        B.base.scale.set(0.85 + 0.25 * s, 1, 1);                                           // rays close at rest, spread as the fin drops
        B.tip.quaternion.setFromAxisAngle(_zAxis, B.sBack * 0.18 * s * (u < 0.28 ? 1 : -0.5));
      } else {                // pelvic: held pointing down, only a small trim
        const p = F.u.uFinPhase.value * 0.55 + (B.side > 0 ? 0 : 0.6) + 1.1;
        _q1.setFromAxisAngle(B.sweep, 0.1 * Math.sin(p)); _q2.setFromAxisAngle(B.hinge, 0.06 * B.side * Math.sin(p + 1.2));
        B.base.quaternion.copy(B.rest).multiply(_q1).multiply(_q2).multiply(B.base.userData.q0);
        B.tip.quaternion.setFromAxisAngle(_zAxis, 0.05 * Math.sin(p - 0.7));
      }
    }
  }
