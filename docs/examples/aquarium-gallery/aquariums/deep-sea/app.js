/* 深海の水槽 — three.js r170 (window.THREE) + AquariumLib (aquarium-state / mobile-quality).
   Assets come from window.AQUARIUM_ASSETS: relative URLs (published page) or data: URIs (offline file).
   Units: metres. Tank centre on the floor at the origin, front glass +z, left -x. Approved layout: layout v2. */
(() => {
  'use strict';
  const A = window.AQUARIUM_ASSETS, LIB = window.AquariumLib;
  const $ = id => document.getElementById(id);
  const status = $('status');
  const say = (text, retry) => {
    status.hidden = false; status.querySelector('p').textContent = text;
    status.querySelector('button').hidden = !retry;
  };
  status.querySelector('button').addEventListener('click', () => location.reload());

  // ---------- quality ----------
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable: keep running */ } },
  };
  const QUALITY_KEY = 'deep-sea-aquarium:quality';
  const requested = store.get(QUALITY_KEY) || 'auto';
  const quality = LIB.chooseAquariumQuality({
    userAgent: navigator.userAgent, userAgentMobile: navigator.userAgentData?.mobile,
    maxTouchPoints: navigator.maxTouchPoints, coarsePointer: matchMedia('(pointer:coarse)').matches,
    requestedQuality: requested,
  });
  $('quality').value = requested;
  $('quality').addEventListener('change', e => { store.set(QUALITY_KEY, e.target.value); location.reload(); });
  $('quality-now').textContent = quality.name === 'light' ? '軽量で表示中' : '標準で表示中';
  const STD = quality.name === 'standard';

  // ---------- renderer ----------
  const canvas = $('view'), stage = $('stage');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: quality.antialias, powerPreference: 'high-performance' });
  } catch (e) {
    say('この端末・ブラウザでは3D表示（WebGL）を開始できませんでした。別のブラウザで開くか、ほかのアプリを閉じてから再読み込みしてください。', true);
    return;
  }
  canvas.addEventListener('webglcontextlost', e => {
    e.preventDefault(); say('画面の描画が中断されました（メモリー不足など）。再読み込みしてください。軽量表示にすると安定することがあります。', true);
  });
  const ABYSS = 0x02060c;
  renderer.setClearColor(ABYSS, 1);
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x061a2c, 0.13);           // the deep water swallows the far side
  const camera = new THREE.PerspectiveCamera(34, 1, 0.02, 30);
  // dark: faint blue ambient + one weak top spotlight, like a submersible's lamp (approved layout v2)
  scene.add(new THREE.HemisphereLight(0x7fa6d0, 0x1a2430, 0.55));
  const spot = new THREE.SpotLight(0xf2f7ff, 11, 7, 0.45, 0.7, 1.0);
  spot.position.set(0.1, 2.4, 0.6); spot.target.position.set(0, 0, -0.05); scene.add(spot, spot.target);
  const fill = new THREE.DirectionalLight(0x9fc0e0, 0.18); fill.position.set(-0.5, 1, 1); scene.add(fill);

  // ---------- tank ----------
  const L = A.layout, cm = 0.01;
  const W = L.tank.w * cm, D = L.tank.d * cm, H = L.tank.h * cm, WL = L.tank.water * cm;
  // same floor as the approved layout render: higher at the back, gentle silt undulation
  const ground = (x, z) => (0.05 - 0.035 * (z / D + 0.5)) + 0.008 * Math.sin(x * 6.0 + z * 3.1) + 0.004 * Math.cos(x * 13.0 - z * 9.0);

  const uTime = { value: 0 };
  const loader = new THREE.TextureLoader();
  const tex = (url, { repeat, srgb = true } = {}) => new Promise((ok, fail) => loader.load(url, t => {
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
    t.anisotropy = STD ? 4 : 1; ok(t);
  }, undefined, () => fail(new Error('画像を読み込めませんでした: ' + url))));

  let snow;
  async function buildTank() {
    const sandT = await tex(A.textures.sand, { repeat: [L.tank.w / 45, L.tank.d / 45] });
    // back wall: deep navy fading to black (unlit, no fog)
    const back = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.02, H), new THREE.ShaderMaterial({
      vertexShader: 'varying vec2 u;void main(){u=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: 'varying vec2 u;void main(){vec3 a=vec3(.0,.012,.03),b=vec3(.02,.08,.16);float c=smoothstep(0.,1.,u.y)*(1.-.5*abs(u.x-.5));gl_FragColor=vec4(mix(a,b,c),1.);}',
    }));
    back.position.set(0, H / 2, -D / 2 - 0.004); scene.add(back);
    // silt floor with the user's sand texture
    const g = new THREE.PlaneGeometry(W, D, 100, 45); g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, ground(p.getX(i), p.getZ(i)));
    g.computeVertexNormals();
    scene.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: sandT })));
    // the bed is solid: its four cut faces (from the tank floor up to the silt surface) and an opaque floor plate,
    // so the sand never shows through from the sides or from below
    const cut = [], cutUv = [], N = 120;
    const sides = [[[-W / 2, D / 2], [W / 2, D / 2]], [[W / 2, D / 2], [W / 2, -D / 2]], [[W / 2, -D / 2], [-W / 2, -D / 2]], [[-W / 2, -D / 2], [-W / 2, D / 2]]];
    for (const [[x0, z0], [x1, z1]] of sides) {
      const len = Math.hypot(x1 - x0, z1 - z0);
      for (let k = 0; k < N; k++) {
        const q = [k / N, (k + 1) / N].map(f => [x0 + (x1 - x0) * f, z0 + (z1 - z0) * f, f * len]);
        const [[xa, za, la], [xb, zb, lb]] = q, ya = ground(xa, za), yb = ground(xb, zb);
        cut.push(xa, 0, za, xb, 0, zb, xb, yb, zb, xa, 0, za, xb, yb, zb, xa, ya, za);   // outward-facing
        cutUv.push(la / W, 0, lb / W, 0, lb / W, yb / D, la / W, 0, lb / W, yb / D, la / W, ya / D);
      }
    }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(cut, 3)); cg.setAttribute('uv', new THREE.Float32BufferAttribute(cutUv, 2));
    cg.computeVertexNormals();
    scene.add(new THREE.Mesh(cg, new THREE.MeshLambertMaterial({ map: sandT, color: 0x8a8274, side: THREE.DoubleSide })));
    // seen only from underneath (BackSide), drawn last over everything: the sunk rock bases never poke through it
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshBasicMaterial({ color: 0x0b0d10, side: THREE.BackSide, fog: false, transparent: true, depthTest: false }));
    plate.rotation.x = -Math.PI / 2; plate.position.y = -0.0005; plate.renderOrder = 10; scene.add(plate);
    // glass: faint panes and dim edges
    const glassMat = new THREE.MeshBasicMaterial({ color: 0x9fc4dd, transparent: true, opacity: 0.035, depthWrite: false, side: THREE.DoubleSide, fog: false });
    for (const [w, h, x, y, z, ry] of [[W, H, 0, H / 2, D / 2, 0], [D, H, -W / 2, H / 2, 0, Math.PI / 2], [D, H, W / 2, H / 2, 0, Math.PI / 2]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glassMat); m.position.set(x, y, z); m.rotation.y = ry; scene.add(m);
    }
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(W, H, D)), new THREE.LineBasicMaterial({ color: 0x35506a, fog: false }));
    edges.position.y = H / 2; scene.add(edges);
    // marine snow: slow sinking specks, wrapped in the water volume (one draw call)
    const n = STD ? 1400 : 700, pos = new Float32Array(n * 3), seed = new Float32Array(n);
    const r = seeded('marine-snow');
    for (let i = 0; i < n; i++) { pos[i * 3] = (r() - .5) * W; pos[i * 3 + 1] = r() * WL; pos[i * 3 + 2] = (r() - .5) * D; seed[i] = r(); }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); sg.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    snow = new THREE.Points(sg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTime, uWL: { value: WL }, uHalf: { value: new THREE.Vector2(W / 2, D / 2) }, uScale: { value: 1 } },
      vertexShader: `uniform float uTime, uWL, uScale; uniform vec2 uHalf; attribute float aSeed; varying float vA;
        void main(){
          vec3 p = position;
          p.y = mod(p.y - uTime * (0.004 + 0.006 * aSeed), uWL);
          p.x += 0.01 * sin(uTime * 0.2 + aSeed * 40.);
          vec4 mv = modelViewMatrix * vec4(p, 1.);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uScale * (1.2 + 1.8 * aSeed) / -mv.z;
          vA = (0.35 + 0.45 * aSeed) * smoothstep(7., 1.5, -mv.z);
        }`,
      fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - .5); gl_FragColor = vec4(vec3(.82,.88,.94), vA * smoothstep(.5, .1, d)); }`,
    }));
    snow.frustumCulled = false; scene.add(snow);
  }

  // ---------- rocks (editable) ----------
  const editables = new Map();      // id -> {root, mesh, kind, radius, label, sink}
  let stoneMats;
  function stoneMaterial(map) {
    const m = new THREE.MeshLambertMaterial({ map });
    m.onBeforeCompile = sh => {
      sh.vertexShader = 'varying vec3 vObjP; varying vec3 vObjN;\n' + sh.vertexShader
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjP = position; vObjN = normal;');
      // triplanar in object space: the texture never stretches on the rock tops and stays put when a rock is moved
      sh.fragmentShader = 'varying vec3 vObjP; varying vec3 vObjN;\n' + sh.fragmentShader.replace('#include <map_fragment>', `
        vec3 bw = pow(abs(normalize(vObjN)), vec3(4.)); bw /= (bw.x + bw.y + bw.z);
        vec3 P = vObjP * 4.0;                  // one tile per ~25 cm of rock
        vec4 tri = texture2D(map, P.zy) * bw.x + texture2D(map, P.xz) * bw.y + texture2D(map, P.xy) * bw.z;
        diffuseColor *= tri;`);
    };
    m.customProgramCacheKey = () => 'rock-triplanar';
    return m;
  }
  function seeded(id) { let h = 2166136261; for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) / 4294967296); }
  function rockGeometry(o) {
    // the approved layout's rock shapes: a lumpy dome, flattened underneath and sunk into the silt
    const geo = new THREE.IcosahedronGeometry(0.5, STD ? 5 : 4), q = geo.attributes.position, v = new THREE.Vector3(), n = new THREE.Vector3();
    let s = o.id.length * 97 + 7; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const bumps = [...Array(6)].map(() => { const d = new THREE.Vector3(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).normalize(); return [d, r() * 0.18]; });
    for (let i = 0; i < q.count; i++) {
      v.fromBufferAttribute(q, i); n.copy(v).normalize();
      let k = 1; for (const [d, a] of bumps) k += a * Math.max(0, n.dot(d)) ** 3;
      v.multiplyScalar(k); if (v.y < 0) v.y *= 0.35; q.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    geo.scale(o.size[0] * cm, o.size[1] * cm * 1.4, o.size[2] * cm);
    return geo;
  }
  function makeRock(o) {
    const mesh = new THREE.Mesh(rockGeometry(o), stoneMats[o.color]);
    const root = new THREE.Group(); root.add(mesh); root.userData.id = o.id; scene.add(root);
    editables.set(o.id, { root, mesh, kind: 'stone', radius: Math.max(o.size[0], o.size[2]) * cm / 2, label: '岩' + o.id.split('-')[1], sink: 0.01 });
  }

  // ---------- layout state (approved layout -> aquarium-state) ----------
  const approved = L.objects.filter(o => o.kind === 'stone').map(o => ({
    id: o.id, kind: 'stone', position: [o.pos[0] * cm, 0, o.pos[2] * cm], rotation: [0, (o.rot_deg || 0) * Math.PI / 180, 0], colorId: o.color,
  }));
  const REVISION = 'layout-v' + L.version;
  const SAVE_KEY = 'deep-sea-aquarium:aquarium:' + REVISION;
  const state = LIB.createAquariumState(approved, { palette: ['dark', 'red'], revision: REVISION });
  function clampPos(id, x, z) {
    const e = editables.get(id), r = e.radius + 0.01;
    return [Math.min(W / 2 - r, Math.max(-W / 2 + r, x)), Math.min(D / 2 - r, Math.max(-D / 2 + r, z))];
  }
  function applyState() {
    for (const o of state.snapshot().objects) {
      const e = editables.get(o.id); if (!e) continue;
      const [x, z] = clampPos(o.id, o.position[0], o.position[2]);
      e.root.position.set(x, ground(x, z) - e.sink, z); e.root.rotation.y = o.rotation[1];
      e.mesh.material = stoneMats[o.colorId];
    }
    updatePanel();
  }
  const save = () => store.set(SAVE_KEY, JSON.stringify(state.snapshot()));
  function loadSaved() {
    const raw = store.get(SAVE_KEY); if (!raw) return false;
    try { return state.load(JSON.parse(raw)); } catch { return false; }
  }

  // ---------- fish ----------
  // One shader structure for every fish part; per-individual values are uniforms so the programs are shared.
  // s: 0 at the snout, 1 at the tail tip (model space, head at -x). aFinH: 0 at a median fin's base, 1 at its edge.
  const SWIM_VERT = `
    uniform float uSwimPhase, uSwimAmp, uX0, uLen, uBendStart, uWaves;
    uniform float uRipple, uRipplePhase, uRippleWaves;
    uniform float uFlapAngle, uFlapZ0, uFlapSide, uIsPec;
    uniform float uFlutter, uFlutterPhase, uFlutterK;
    attribute float aFinH;
`;
  const SWIM_BEGIN = `#include <begin_vertex>
    if (uIsPec > 0.5) {             // pectoral fin: open/close about its root line, outward from the body
      float d = max(abs(transformed.z) - uFlapZ0, 0.);
      transformed.z = uFlapSide * (uFlapZ0 + d * cos(uFlapAngle));
      transformed.y += d * sin(uFlapAngle);
      // flutter: a soft wave running out from the root and back along the fin (0 for fins that only hinge)
      float fs = (transformed.x - uX0) / uLen;
      transformed.y += uFlutter * d * sin(uFlutterPhase - d * uFlutterK - fs * 7.);
      transformed.z += uFlapSide * 0.35 * uFlutter * d * sin(uFlutterPhase * 0.7 - d * uFlutterK * 0.6 - fs * 5. + 1.3);
    }
    float s = clamp((transformed.x - uX0) / uLen, 0., 1.);
    float bend = uSwimAmp * pow(smoothstep(uBendStart, 1., s), 1.35);
    transformed.z += bend * sin(uSwimPhase - s * uWaves);
    transformed.z += uRipple * aFinH * sin(uRipplePhase - s * uRippleWaves);   // travelling wave along a long fin`;
  function fishMaterial(kind, map, u, { opacity = 1, frontOnly = false, depthWrite } = {}) {
    const glass = kind === 'fin' || opacity < 1;
    const m = new THREE.MeshLambertMaterial({
      map, transparent: glass, opacity, side: frontOnly ? THREE.FrontSide : THREE.DoubleSide,
      depthWrite: depthWrite ?? !glass,
    });
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = SWIM_VERT + sh.vertexShader.replace('#include <begin_vertex>', SWIM_BEGIN);
      if (kind === 'fin') sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        // translucent membrane: pale areas between the drawn rays let the water show through, rays stay denser
        float lum = dot(diffuseColor.rgb, vec3(.299, .587, .114));
        diffuseColor.a *= mix(0.32, 0.85, clamp((0.8 - lum) * 2.4, 0., 1.));`);
    };
    m.customProgramCacheKey = () => 'fish-' + kind;
    return m;
  }

  // median fins: a per-vertex 0..1 height above the fin's base, binned along x (base = body side of the fin)
  function finHeight(g, fromTop) {
    const p = g.attributes.position, n = p.count, B = 96;
    let x0 = Infinity, x1 = -Infinity;
    for (let i = 0; i < n; i++) { x0 = Math.min(x0, p.getX(i)); x1 = Math.max(x1, p.getX(i)); }
    const lo = new Float32Array(B).fill(Infinity), hi = new Float32Array(B).fill(-Infinity);
    const bin = x => Math.min(B - 1, Math.max(0, Math.floor((x - x0) / (x1 - x0 + 1e-9) * B)));
    for (let i = 0; i < n; i++) { const b = bin(p.getX(i)), y = p.getY(i); lo[b] = Math.min(lo[b], y); hi[b] = Math.max(hi[b], y); }
    const h = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const b = bin(p.getX(i)), span = Math.max(hi[b] - lo[b], 1e-6), y = p.getY(i);
      h[i] = fromTop ? (y - lo[b]) / span : (hi[b] - y) / span;
    }
    return h;
  }
  const geoCache = {};
  async function loadModel(key) {
    if (geoCache[key]) return geoCache[key];
    const M = A.models[key];
    const res = await fetch(M.geometry);
    if (!res.ok) throw new Error('モデルを読み込めませんでした: ' + M.geometry);
    const data = await res.json();
    const map = await tex(M[quality.name === 'light' ? 'light' : 'standard']);
    map.flipY = false;                         // glTF-style UVs (v = 0 at the top of the atlas)
    const parts = [], box = new THREE.Box3();
    for (const m of data.meshes) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(m.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(m.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(m.uv, 2));
      g.setIndex(m.i);
      const ripple = /^dorsal/.test(m.name) ? finHeight(g, true) : /^anal/.test(m.name) ? finHeight(g, false) : new Float32Array(m.p.length / 3);
      g.setAttribute('aFinH', new THREE.BufferAttribute(ripple, 1));
      g.computeBoundingBox(); box.union(g.boundingBox);
      parts.push({ name: m.name, g, opacity: m.opacity, frontOnly: m.double_sided === false, depthWrite: m.depth_write });
    }
    return (geoCache[key] = { parts, map, box });
  }

  // species behaviour (shared shader, different uniforms and motion)
  const SPECIES = {
    oarfish: { amp: 0.0045, bendStart: 0.05, waves: 9, ripple: 0.012, rippleWaves: 46, finKind: 'solid' },
    mehikari: { amp: 0.0028, bendStart: 0.35, waves: 4.6, ripple: 0, rippleWaves: 0, finKind: 'fin' },
    otohime: { amp: 0.0032, bendStart: 0.25, waves: 4.0, ripple: 0.006, rippleWaves: 12, finKind: 'model' },
    mizuuo: { amp: 0.0035, bendStart: 0.3, waves: 4.8, ripple: 0.004, rippleWaves: 10, finKind: 'solid' },
  };
  const speciesOf = f => f.id.startsWith('mehikari') ? 'mehikari' : f.id === 'oarfish' ? 'oarfish' : f.id === 'mizuuo' ? 'mizuuo' : 'otohime';
  const FIN = /^(dorsal|caudal|pectoral|pelvic|anal|adipose)/;
  const fishes = [];
  async function addFish(f, i) {
    const sp = speciesOf(f), S = SPECIES[sp], { parts, map, box } = await loadModel(f.model);
    const len = box.max.x - box.min.x;
    const u = {
      uSwimPhase: { value: i * 2.1 }, uSwimAmp: { value: S.amp }, uX0: { value: box.min.x }, uLen: { value: len },
      uBendStart: { value: S.bendStart }, uWaves: { value: S.waves },
      uRipple: { value: S.ripple }, uRipplePhase: { value: i * 1.3 }, uRippleWaves: { value: S.rippleWaves },
      uFlapAngle: { value: 0 }, uFlapZ0: { value: 0 }, uFlapSide: { value: 1 }, uIsPec: { value: 0 },
      uFlutter: { value: 0 }, uFlutterPhase: { value: i * 0.9 }, uFlutterK: { value: 38 },
    };
    const model = new THREE.Group(), pecs = [], mats = {};
    for (const P of parts) {
      let mat;
      const isFin = FIN.test(P.name);
      const opts = { opacity: P.opacity, frontOnly: P.frontOnly, depthWrite: P.depthWrite };
      if (/^pectoral/.test(P.name)) {          // own uniforms: root line and side of this fin
        const bb = P.g.boundingBox, side = (bb.min.z + bb.max.z) > 0 ? 1 : -1;
        const pu = { ...u, uIsPec: { value: 1 }, uFlapSide: { value: side }, uFlapZ0: { value: side > 0 ? bb.min.z : -bb.max.z }, uFlapAngle: { value: 0 } };
        mat = fishMaterial(S.finKind === 'fin' ? 'fin' : 'body', map, pu, opts); pecs.push(pu);
      } else if (isFin && S.finKind === 'fin') mat = mats.fin ??= fishMaterial('fin', map, u, opts);
      else mat = mats[P.name + P.opacity] ??= fishMaterial('body', map, u, opts);
      const mesh = new THREE.Mesh(P.g, mat);
      mesh.name = P.name; mesh.frustumCulled = false;  // vertex animation moves fins beyond the static bounds
      if (mat.transparent) mesh.renderOrder = mat.depthWrite ? 1 : 2;
      model.add(mesh);
    }
    model.scale.setScalar(f.length_cm * cm / len);
    const inner = new THREE.Group(); inner.add(model);
    if (f.vertical) inner.rotation.z = -Math.PI / 2;   // head (-x) up: the oarfish's upright posture
    const root = new THREE.Group(); root.add(inner);
    root.position.set(f.pos[0] * cm, f.pos[1] * cm, f.pos[2] * cm);
    root.rotation.y = f.heading_deg * Math.PI / 180;
    scene.add(root);
    const F = { sp, f, root, u, pecs, base: root.position.clone(), yaw0: root.rotation.y, i, low: box.min.y * f.length_cm * cm / len };
    if (sp === 'otohime') F.base.y = ground(F.base.x, F.base.z) - F.low - 0.004;   // resting with its belly and fins on the silt
    fishes.push(F);
  }

  // mehikari schools: centre, half-extent along x / z (m), speed; checked against the rock footprints of layout v2
  const SCHOOLS = { 1: { c: [-0.28, 0.17], a: [0.34, 0.12], w: 0.15, ph: 0.0 }, 2: { c: [0.18, -0.08], a: [0.27, 0.10], w: -0.13, ph: 2.2 } };
  function mehikariAt(F, t) {
    const S = SCHOOLS[F.f.school || 1], k = Number(F.f.id.split('-')[2] || 1) - 1;
    const u = S.w * t + S.ph + 0.45 * Math.sin(0.045 * t + S.ph) - 0.3 * k * Math.sign(S.w);    // speed varies; followers trail along the path
    const x = S.c[0] + S.a[0] * Math.sin(u), z = S.c[1] + S.a[1] * (0.6 * Math.sin(2 * u) + 0.4 * Math.cos(u));
    // followers sit beside the leader by a fixed sideways shift (a plain translation of the path: it can never
    // fold into a loop at the tight ends of the figure-eight, which made the outer fish spin round in v2)
    const side = ((k % 2) ? 1 : -1) * (0.025 + 0.01 * k);
    const X = x, Z = z + side;
    return [X, ground(X, Z) + 0.1 + 0.025 * Math.sin(0.6 * u + k * 1.3) + 0.01 * k, Z];
  }
  // lancetfish: a stadium-shaped loop in mid-water (two straights joined by half circles), cm in layout.json
  function stadiumAt(P, t) {
    const s = P.half_straight_cm * cm, R = P.radius_cm * cm, per = 4 * s + 2 * Math.PI * R;
    let d = ((P.speed_cm_s * cm * t) % per + per) % per, x, z;
    if (d < 2 * s) { x = -s + d; z = R; }
    else if ((d -= 2 * s) < Math.PI * R) { const a = d / R; x = s + R * Math.sin(a); z = R * Math.cos(a); }
    else if ((d -= Math.PI * R) < 2 * s) { x = s - d; z = -R; }
    else { const a = (d - 2 * s) / R; x = -s - R * Math.sin(a); z = -R * Math.cos(a); }
    return [P.center[0] * cm + x, P.center[1] * cm + P.bob_cm * cm * Math.sin(0.21 * t), P.center[2] * cm + z];
  }
  function updateFish(F, t, dt) {
    const u = F.u, ph = F.i * 1.7;
    if (F.sp === 'oarfish') {
      // upright, nearly still: a slow bob and turn, the long dorsal fin rippling (that is how it swims)
      F.root.position.set(F.base.x + 0.03 * Math.sin(t * 0.11), F.base.y + 0.05 * Math.sin(t * 0.17), F.base.z + 0.03 * Math.cos(t * 0.09));
      F.root.rotation.y = F.yaw0 + 0.7 * Math.sin(t * 0.045);
      u.uSwimPhase.value += dt * 1.1; u.uRipplePhase.value += dt * 4.2;
      for (const pu of F.pecs) pu.uFlapAngle.value = 0.25 + 0.2 * Math.sin(t * 2.3);
    } else if (F.sp === 'mehikari') {
      // each school roams a slow figure-eight over the open silt, just above the bottom and clear of the rocks;
      // the five follow one another along it with small lateral offsets, heading where they swim
      const at = tt => mehikariAt(F, tt), p = at(t), q = at(t + 0.05);
      const vx = (q[0] - p[0]) / 0.05, vy = (q[1] - p[1]) / 0.05, vz = (q[2] - p[2]) / 0.05, hs = Math.hypot(vx, vz);
      F.root.position.set(...p);
      const yaw = Math.atan2(vz, -vx);
      let dyaw = yaw - (F.yaw ?? yaw); dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
      F.yaw = yaw; F.turn = (F.turn ?? 0) * 0.9 + (dt > 0 ? dyaw / dt : 0) * 0.1;
      F.root.rotation.set(-0.25 * F.turn, yaw, -Math.atan2(vy, hs) * 0.8);
      const speed = Math.hypot(vx, vy, vz);
      u.uSwimPhase.value += dt * (6 + 70 * speed + 3 * Math.abs(F.turn));
      u.uSwimAmp.value = SPECIES.mehikari.amp * (0.8 + 0.6 * Math.min(Math.abs(F.turn), 0.5));
      for (const pu of F.pecs) { pu.uFlapAngle.value = 0.2 + 0.15 * Math.sin(u.uSwimPhase.value * 0.4); }
    } else if (F.sp === 'mizuuo') {
      // cruises slowly round its loop in mid-water, the sail-like dorsal fin held up, body bending gently
      const P = F.f.path, p = stadiumAt(P, t), q = stadiumAt(P, t + 0.1);
      const vx = (q[0] - p[0]) / 0.1, vy = (q[1] - p[1]) / 0.1, vz = (q[2] - p[2]) / 0.1, hs = Math.hypot(vx, vz);
      F.root.position.set(...p);
      const yaw = Math.atan2(vz, -vx);
      let dyaw = yaw - (F.yaw ?? yaw); dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
      F.yaw = yaw; F.turn = (F.turn ?? 0) * 0.92 + (dt > 0 ? dyaw / dt : 0) * 0.08;
      F.root.rotation.set(-0.3 * F.turn, yaw, -Math.atan2(vy, hs) * 0.8);
      u.uSwimPhase.value += dt * (3.2 + 2 * Math.abs(F.turn)); u.uRipplePhase.value += dt * 2.5;
      u.uSwimAmp.value = SPECIES.mizuuo.amp * (1 + 0.8 * Math.min(Math.abs(F.turn), 0.5));
      for (const pu of F.pecs) pu.uFlapAngle.value = 0.3 + 0.08 * Math.sin(t * 1.4);
    } else {
      // rests on the bottom, then spreads its long pectoral fins and floats up like a dancer, and settles again
      const T = 26, c = ((t + 8) % T);
      // fins never stop: a slow, wide breathing open/close with a soft wave running through them (ふわふわ・ひらひら)
      let lift = 0, flap = 0.14 + 0.18 * Math.sin(t * 0.75), flutter = 0.32, fspeed = 2.6;
      if (c > 14 && c < 18) { const k = (c - 14) / 4; lift = 0.11 * (0.5 - 0.5 * Math.cos(Math.PI * k)); flap = 0.38 + 0.32 * Math.sin(t * 2.6); flutter = 0.4; fspeed = 4.2; }
      else if (c >= 18) { const k = (c - 18) / (T - 18); lift = 0.11 * (0.5 + 0.5 * Math.cos(Math.PI * k)); flap = 0.28 + 0.2 * Math.sin(t * 1.3); flutter = 0.32; fspeed = 3.0; }
      u.uFlutter.value += (flutter - u.uFlutter.value) * Math.min(1, dt * 1.5);    // ease between rest and dance
      F.fspeed = (F.fspeed ?? fspeed) + (fspeed - (F.fspeed ?? fspeed)) * Math.min(1, dt * 1.5);
      u.uFlutterPhase.value += dt * F.fspeed;
      F.root.position.set(F.base.x, F.base.y + lift, F.base.z);
      F.root.rotation.z = -0.08 * Math.sin(Math.PI * Math.min(lift / 0.11, 1));   // nose up a little while rising
      u.uSwimAmp.value = SPECIES.otohime.amp * (0.4 + 0.6 * Math.min(lift / 0.05, 1));
      u.uSwimPhase.value += dt * 2.2; u.uRipplePhase.value += dt * 2.0;
      for (const pu of F.pecs) pu.uFlapAngle.value = flap;
    }
    for (const pu of F.pecs) { pu.uSwimPhase.value = u.uSwimPhase.value; pu.uSwimAmp.value = u.uSwimAmp.value; pu.uRipplePhase.value = u.uRipplePhase.value; }
  }

  // ---------- water surface (dark: the lamp's glint and a faint ceiling) ----------
  let surface, rtRefr, rtRefl, reflCam;
  function buildWater() {
    const res = new THREE.Vector2();
    if (STD) {
      rtRefr = new THREE.WebGLRenderTarget(2, 2, { depthBuffer: true });
      rtRefl = new THREE.WebGLRenderTarget(2, 2, { depthBuffer: true });
      reflCam = camera.clone();
    }
    const mat = new THREE.ShaderMaterial({
      transparent: !STD, side: THREE.DoubleSide, depthWrite: true,
      uniforms: {
        uTime, uRefr: { value: STD ? rtRefr.texture : null }, uRefl: { value: STD ? rtRefl.texture : null },
        uReflVP: { value: new THREE.Matrix4() }, uRes: { value: res }, uUseRT: { value: STD ? 1 : 0 },
        uTint: { value: new THREE.Color(0x10304a) }, uSky: { value: new THREE.Color(0x0b1826) }, uHalf: { value: new THREE.Vector2(W / 2, D / 2) },
      },
      vertexShader: `
        uniform float uTime; uniform mat4 uReflVP; varying vec3 vW; varying vec4 vReflClip; varying vec3 vN;
        float wave(vec2 p, float t){ return 0.0018*sin(p.x*13.+t*0.9) + 0.0012*sin(p.y*19.-t*0.8+p.x*4.) + 0.0006*sin((p.x+p.y)*31.+t*1.5); }
        void main(){
          vec3 p = position; vec4 w = modelMatrix * vec4(p,1.);
          float e = 0.001;
          float h = wave(w.xz,uTime), hx = wave(w.xz+vec2(e,0.),uTime), hz = wave(w.xz+vec2(0.,e),uTime);
          w.y += h; vN = normalize(vec3(-(hx-h)/e, 1., -(hz-h)/e));
          vW = w.xyz; vReflClip = uReflVP * w;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: `
        uniform sampler2D uRefr; uniform sampler2D uRefl; uniform vec2 uRes; uniform float uUseRT;
        uniform vec3 uTint; uniform vec3 uSky; uniform vec2 uHalf;
        varying vec3 vW; varying vec4 vReflClip; varying vec3 vN;
        void main(){
          vec3 V = normalize(cameraPosition - vW);
          bool above = cameraPosition.y > vW.y;
          vec3 N = above ? vN : -vN;
          float cosT = clamp(abs(dot(V, N)), 0., 1.);
          vec2 sUV = gl_FragCoord.xy / uRes;
          vec2 off = vN.xz * 0.06;
          vec3 refr = uUseRT > .5 ? texture2D(uRefr, clamp(sUV + off, 0.001, .999)).rgb : uTint;
          vec3 col;
          if (above) {
            float fres = 0.04 + 0.6 * pow(1. - cosT, 5.);
            col = mix(refr * mix(vec3(1.), uTint * 3., .2), uSky, fres);
          } else {
            vec2 rUV = vReflClip.xy / vReflClip.w * .5 + .5;
            vec3 refl = uUseRT > .5 ? texture2D(uRefl, clamp(rUV + off, 0.001, .999)).rgb : uTint * .6;
            float tir = 1. - smoothstep(0.6, 0.72, cosT);          // total internal reflection past ~48.6 deg
            col = mix(mix(refr, uSky, .5), refl, max(tir, 0.25)) * 0.45;   // from below the deep ceiling stays dim
          }
          vec3 Ld = normalize(vec3(0.04, 1., 0.25));                // the spotlight above
          float spec = pow(max(dot(reflect(-Ld, vN), V), 0.), 120.);
          col += spec * 0.08;
          vec2 edge = uHalf - abs(vW.xz);                           // meniscus: a fine line along the glass
          col += 0.06 * (1. - smoothstep(0.0, 0.006, min(edge.x, edge.y)));
          gl_FragColor = vec4(col, uUseRT > .5 ? 1. : 0.35 + 0.4 * (1. - cosT));
          #include <colorspace_fragment>
        }`,
    });
    surface = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.0006, D - 0.0006, STD ? 120 : 60, STD ? 54 : 27), mat);
    surface.rotation.x = -Math.PI / 2; surface.position.y = WL; surface.renderOrder = 3; scene.add(surface);
    return res;
  }
  let surfRes;

  // ---------- camera & views ----------
  const controls = new THREE.OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.minDistance = 0.12; controls.maxDistance = 7;
  controls.maxPolarAngle = Math.PI * 0.62; controls.target.set(0, 0.62, 0);
  function fitDistance(margin = 1.06) {
    const vFov = THREE.MathUtils.degToRad(camera.fov), hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    return Math.max((W / 2 * margin) / Math.tan(hFov / 2) + D / 2, (H / 2 * margin) / Math.tan(vFov / 2) + D / 2);
  }
  const VIEWS = {
    front: () => [[0, 0.72, fitDistance()], [0, 0.66, 0]],
    oblique: () => { const d = fitDistance(1.12); return [[d * 0.5, 0.62 + d * 0.22, d * 0.82], [0, 0.6, -0.05]]; },
    top: () => [[0, fitDistance(1.15) + WL * 0.4, 0.001], [0, 0, 0]],
  };
  function setView(n) { stopWatching(); const [p, t] = VIEWS[n](); camera.position.set(...p); controls.target.set(...t); controls.update(); }

  // ---------- observe one species: the camera follows it (you can still orbit and zoom around it) ----------
  const INFO = {
    oarfish: ['リュウグウノツカイ', 'Regalecus russelii'],
    otohime: ['オトヒメコンニャクウオ', 'Careproctus shigemii'],
    mizuuo: ['ミズウオ', 'Alepisaurus ferox'],
    mehikari: ['メヒカリ（マルアオメエソ）', 'Chlorophthalmus borealis'],
  };
  let watch = null;                         // {F, dist}
  const watchTmp = new THREE.Vector3();
  function startWatching(sp, which = 0) {
    const list = fishes.filter(F => F.sp === sp); if (!list.length) return;
    const F = list[which % list.length];
    const size = F.f.length_cm * cm, portrait = Math.max(1, 0.8 / camera.aspect);   // a narrow screen needs more distance for the same fish
    const dist = Math.max(0.32, size * (F.f.vertical ? 2.4 : 1.7 * portrait));       // the upright oarfish needs the frame's height
    F.root.getWorldPosition(watchTmp);
    const dir = new THREE.Vector3(0.35, 0.18, 1).normalize();
    camera.position.copy(watchTmp).addScaledVector(dir, dist); controls.target.copy(watchTmp); controls.update();
    watch = { F, sp, which };
    const [name, sci] = INFO[sp];
    $('info-name').textContent = name; $('info-sci').textContent = sci;
    $('info-next').hidden = list.length < 2; $('info').hidden = false; $('info').classList.remove('open'); $('watch').value = sp;
  }
  function stopWatching() { watch = null; $('info').hidden = true; $('watch').value = ''; }
  function followWatched() {
    if (!watch) return;
    watch.F.root.getWorldPosition(watchTmp);
    watchTmp.sub(controls.target);                    // move camera and target together: keeps the user's orbit
    camera.position.add(watchTmp); controls.target.add(watchTmp);
  }
  $('watch').addEventListener('change', e => { if (e.target.value) { if (mode === 'edit') setMode('view'); startWatching(e.target.value); } else setView('front'); });
  $('info-next').addEventListener('click', () => watch && startWatching(watch.sp, watch.which + 1));
  $('info-close').addEventListener('click', () => setView('front'));
  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));

  function resize() {
    const r = stage.getBoundingClientRect();
    const size = LIB.aquariumDrawingSize(quality, r.width, r.height, devicePixelRatio);
    renderer.setPixelRatio(size.pixelRatio); renderer.setSize(size.cssWidth, size.cssHeight, false);
    camera.aspect = size.cssWidth / size.cssHeight; camera.fov = camera.aspect < 1 ? 50 : 34; camera.updateProjectionMatrix();
    const dw = size.drawingWidth, dh = size.drawingHeight;
    if (rtRefr) { rtRefr.setSize(dw >> 1, dh >> 1); rtRefl.setSize(dw >> 1, dh >> 1); }
    surfRes?.set(dw, dh);
    if (snow) snow.material.uniforms.uScale.value = dh * 0.0012;
  }

  // ---------- editing ----------
  let mode = 'view', selected = null, drag = null;
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
  const ring = new THREE.Mesh(new THREE.RingGeometry(1, 1.08, 64), new THREE.MeshBasicMaterial({ color: 0x7fb4d8, transparent: true, opacity: .8, depthTest: false, fog: false }));
  ring.rotation.x = -Math.PI / 2; ring.renderOrder = 5; ring.visible = false; scene.add(ring);
  function setMode(m) {
    mode = m; document.body.dataset.mode = m;
    $('mode-view').setAttribute('aria-pressed', m === 'view'); $('mode-edit').setAttribute('aria-pressed', m === 'edit');
    $('edit-panel').hidden = m !== 'edit';
    if (m === 'view') select(null); else if (!selected) select(approved[0].id);
    resize();
  }
  $('mode-view').addEventListener('click', () => setMode('view'));
  $('mode-edit').addEventListener('click', () => setMode('edit'));
  function select(id) {
    selected = id; ring.visible = !!id; $('obj-select').value = id || '';
    updatePanel();
  }
  function updatePanel() {
    if (!selected || !editables.get(selected)) { $('obj-controls').hidden = true; return; }
    const e = editables.get(selected), o = state.snapshot().objects.find(o => o.id === selected);
    $('obj-controls').hidden = false;
    $('pos-x').value = (o.position[0] / cm).toFixed(0); $('pos-z').value = (o.position[2] / cm).toFixed(0);
    $('rot-y').value = Math.round(THREE.MathUtils.radToDeg(o.rotation[1]) % 360);
    document.querySelectorAll('[data-color]').forEach(b => b.setAttribute('aria-pressed', b.dataset.color === o.colorId));
    ring.scale.setScalar(e.radius + 0.02); ring.position.set(e.root.position.x, e.root.position.y + e.sink + 0.004, e.root.position.z);
  }
  function setTransform(id, x, z, ry) {
    const [cx, cz] = clampPos(id, x, z);
    state.setTransform(id, { position: [cx, 0, cz], rotation: [0, ry, 0] }); applyState(); save();
  }
  const current = id => state.snapshot().objects.find(o => o.id === id);
  $('obj-select').addEventListener('change', e => select(e.target.value || null));
  for (const [inp, f] of [['pos-x', (o, v) => [v * cm, o.position[2], o.rotation[1]]], ['pos-z', (o, v) => [o.position[0], v * cm, o.rotation[1]]],
    ['rot-y', (o, v) => [o.position[0], o.position[2], THREE.MathUtils.degToRad(v)]]]) {
    $(inp).addEventListener('input', e => { if (!selected) return; const o = current(selected); setTransform(selected, ...f(o, Number(e.target.value))); });
  }
  document.querySelectorAll('[data-color]').forEach(b => b.addEventListener('click', () => {
    if (!selected) return;
    state.setStoneColor(selected, b.dataset.color); applyState(); save();
  }));
  document.querySelectorAll('[data-all-color]').forEach(b => b.addEventListener('click', () => {
    state.setAllStoneColors(b.dataset.allColor); applyState(); save();
  }));
  $('reset').addEventListener('click', () => { state.restoreDefault(); applyState(); save(); flash('承認した配置と色に戻しました'); });
  function flash(text) { const n = $('toast'); n.textContent = text; n.hidden = false; clearTimeout(flash.t); flash.t = setTimeout(() => n.hidden = true, 2200); }

  function pick(ev) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects([...editables.values()].map(e => e.root), true);
    for (const h of hits) { let o = h.object; while (o && !o.userData.id) o = o.parent; if (o) return { id: o.userData.id, point: h.point }; }
    return null;
  }
  canvas.addEventListener('pointerdown', ev => {
    if (mode !== 'edit') return;
    const p = pick(ev);
    if (!p) return;
    select(p.id);
    const e = editables.get(p.id);
    plane.constant = -e.root.position.y;
    ray.ray.intersectPlane(plane, hit);
    drag = { id: p.id, dx: e.root.position.x - hit.x, dz: e.root.position.z - hit.z, pointer: ev.pointerId };
    controls.enabled = false; canvas.setPointerCapture(ev.pointerId);
  });
  canvas.addEventListener('pointermove', ev => {
    if (!drag || ev.pointerId !== drag.pointer) return;
    const r = canvas.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (!ray.ray.intersectPlane(plane, hit)) return;
    const o = current(drag.id);
    const [cx, cz] = clampPos(drag.id, hit.x + drag.dx, hit.z + drag.dz);
    state.setTransform(drag.id, { position: [cx, 0, cz], rotation: o.rotation }); applyState();
  });
  const endDrag = ev => { if (!drag) return; if (ev.pointerId === drag.pointer) { drag = null; controls.enabled = true; save(); } };
  canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);

  // ---------- BGM (starts only from a tap: browsers block autoplay with sound) ----------
  const BGM_VOL = 'deep-sea-aquarium:bgm-volume';
  const bgm = new Audio(A.bgm); bgm.loop = true; bgm.preload = 'none';
  const vol = $('bgm-vol'), bgmBtn = $('bgm');
  vol.value = store.get(BGM_VOL) ?? vol.value; bgm.volume = Number(vol.value);
  vol.addEventListener('input', () => { bgm.volume = Number(vol.value); store.set(BGM_VOL, vol.value); });
  const bgmLabel = on => { bgmBtn.textContent = on ? 'BGM：オン' : 'BGM：オフ'; bgmBtn.setAttribute('aria-pressed', on); };
  bgmBtn.addEventListener('click', async () => {
    if (!bgm.paused) { bgm.pause(); bgmLabel(false); return; }
    try { await bgm.play(); bgmLabel(true); } catch (e) { console.error(e); flash('BGMを再生できませんでした'); }
  });
  bgm.addEventListener('pause', () => { if (!document.hidden) bgmLabel(false); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && !bgm.paused) { bgm.pause(); bgm.dataset.resume = '1'; }
    else if (!document.hidden && bgm.dataset.resume) { delete bgm.dataset.resume; bgm.play().then(() => bgmLabel(true), () => {}); } });

  // ---------- loop ----------
  const clock = new THREE.Clock(); let acc = 0, t = 0;
  const frameMin = 1 / quality.fps;
  const tmpTarget = new THREE.Vector3();
  function renderWaterPasses() {
    surface.visible = false; ring.visible = false;
    renderer.setRenderTarget(rtRefr); renderer.render(scene, camera);
    reflCam.copy(camera);                     // mirror camera across the water plane
    reflCam.position.set(camera.position.x, 2 * WL - camera.position.y, camera.position.z);
    tmpTarget.copy(controls.target); tmpTarget.y = 2 * WL - tmpTarget.y;
    reflCam.up.set(0, 1, 0); reflCam.lookAt(tmpTarget); reflCam.updateMatrixWorld();
    surface.material.uniforms.uReflVP.value.multiplyMatrices(reflCam.projectionMatrix, reflCam.matrixWorldInverse);
    renderer.setRenderTarget(rtRefl); renderer.render(scene, reflCam);
    renderer.setRenderTarget(null); surface.visible = true; ring.visible = !!selected;
  }
  let paused = false;                        // test hook: stop the loop so a slow (software) GPU can be screenshotted
  function step(dt) { t += dt; uTime.value = t; for (const F of fishes) updateFish(F, t, dt); }
  function frame(dt) {
    step(dt);
    followWatched();
    controls.update();
    if (STD && surface) renderWaterPasses();
    renderer.render(scene, camera);
  }
  function loop() {
    requestAnimationFrame(loop);
    if (document.hidden || paused) { clock.getDelta(); return; }
    const d = Math.min(clock.getDelta(), 0.1); acc += d;
    if (acc < frameMin * 0.95) return;
    const dt = Math.min(acc, 0.1); acc = 0;
    frame(dt);
  }
  window.__aquarium = {
    setView, fishes,
    pause(on) { paused = on; },
    cam(p, tgt) { camera.position.set(...p); controls.target.set(...tgt); controls.update(); },
    watch: startWatching,
    advance(sec) { for (let k = 0; k < Math.round(sec * 30); k++) step(1 / 30); followWatched(); controls.update(); if (STD && surface) renderWaterPasses(); renderer.render(scene, camera); },
  };

  // ---------- start ----------
  (async () => {
    try {
      say('水槽を準備しています…');
      const [darkT, redT] = await Promise.all([tex(A.textures['rock-dark'], { repeat: [1, 1] }), tex(A.textures['rock-red'], { repeat: [1, 1] })]);
      stoneMats = { dark: stoneMaterial(darkT), red: stoneMaterial(redT) };
      await buildTank();
      for (const o of L.objects) if (o.kind === 'stone') makeRock(o);
      const sel = $('obj-select');
      for (const o of approved) sel.append(new Option(editables.get(o.id).label, o.id));
      if (loadSaved()) flash('前回の配置を読み込みました');
      applyState();
      surfRes = buildWater();
      resize(); setView('front');
      addEventListener('resize', resize);
      say('深海の魚たちを呼んでいます…');
      for (const [i, f] of L.fish.entries()) await addFish(f, i);   // the three models load one at a time; the 10 mehikari share one
      status.hidden = true;
      window.__aquarium.ready = true;
      loop();
    } catch (e) {
      console.error(e);
      say('読み込みに失敗しました。通信状態を確かめて再読み込みしてください。（' + (e.message || e) + '）', true);
    }
  })();
  setMode('view');
})();
