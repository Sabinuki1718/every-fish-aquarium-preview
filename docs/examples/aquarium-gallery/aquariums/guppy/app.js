/* グッピーの水草水槽 — three.js r170 (window.THREE) + AquariumLib (aquarium-state / mobile-quality).
   Assets come from window.AQUARIUM_ASSETS: relative URLs (published page) or data: URIs (offline file).
   Units: metres. Tank centre on the floor at the origin, front glass +z, left -x. */
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
  const QUALITY_KEY = 'guppy-aquarium:quality';
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
  renderer.setClearColor(0xeef4f1, 1);   // page tone: also what the water's refraction/reflection passes see beyond the tank
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 10);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb9c8bf, 2.2));
  const sun = new THREE.DirectionalLight(0xfffaf0, 1.1); sun.position.set(-0.2, 1, 0.45); scene.add(sun);

  // ---------- tank ----------
  const L = A.layout, cm = 0.01;
  const W = L.tank.w * cm, D = L.tank.d * cm, H = L.tank.h * cm, WL = L.tank.water * cm;
  const ground = (x, z) => 0.03 + 0.02 * (0.5 - z / D) + 0.0012 * Math.sin(x * 61 + 1.3) * Math.cos(z * 67);   // aqua soil: 3 cm front, 5 cm back

  const uniformsCommon = { uTime: { value: 0 }, uCaustic: { value: STD ? 0.32 : 0.2 } };
  const loader = new THREE.TextureLoader();
  const tex = (url, { repeat, srgb = true } = {}) => new Promise((ok, fail) => loader.load(url, t => {
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
    t.anisotropy = STD ? 4 : 1; ok(t);
  }, undefined, () => fail(new Error('画像を読み込めませんでした: ' + url))));

  // Shared shader snippets: caustics (soft wandering bright veins), world position varying.
  const CAUSTIC = `
    uniform float uTime; uniform float uCaustic; varying vec3 vWorldC;
    float causticAt(vec2 p, float t){
      float c = 0.;
      c += sin(p.x*95. + t*0.9 + sin(p.y*71. - t*0.7)*1.6);
      c += sin(p.y*109. - t*0.8 + sin(p.x*83. + t*0.6)*1.4);
      c = 1. - abs(c*0.5);
      return pow(clamp(c,0.,1.), 6.);
    }
`;
  const withCaustics = (material, key) => {
    material.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, uniformsCommon);
      sh.vertexShader = 'varying vec3 vWorldC;\n' + sh.vertexShader.replace('#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvWorldC = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = CAUSTIC + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        float cDepth = clamp((${WL.toFixed(4)} - vWorldC.y) / ${WL.toFixed(4)}, 0., 1.);
        diffuseColor.rgb *= 1. + uCaustic * causticAt(vWorldC.xz, uTime) * (1. - 0.5*cDepth);`);
    };
    material.customProgramCacheKey = () => key;
    return material;
  };

  async function buildTank() {
    const [bgT, soilT, woodT, spriteT] = await Promise.all([
      tex(A.textures.background), tex(A.textures.soil, { repeat: [6, 3.6] }), tex(A.textures.driftwood), tex(A.textures['water-sprite'])]);
    // background behind the back glass (unlit: keeps the picture's own colours)
    // one-sided (FrontSide): orbit behind the tank and the picture is culled, so the fish are seen through the back glass
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.02, H), new THREE.MeshBasicMaterial({ map: bgT, side: THREE.FrontSide }));
    bg.position.set(0, H / 2, -D / 2 - 0.004); scene.add(bg);
    // aqua soil floor, higher at the back
    const g = new THREE.PlaneGeometry(W, D, 60, 36); g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, ground(p.getX(i), p.getZ(i)));
    g.computeVertexNormals();
    scene.add(new THREE.Mesh(g, withCaustics(new THREE.MeshLambertMaterial({ map: soilT }), 'soil')));
    // front edge of the soil bed (a strip so the cut is not a hairline)
    const lip = new THREE.Mesh(new THREE.PlaneGeometry(W, 0.03), new THREE.MeshLambertMaterial({ color: 0x3e2f24 }));
    lip.position.set(0, 0.015, D / 2 - 0.0005); scene.add(lip);
    // glass: faint panes and thin grey edges
    const glassMat = new THREE.MeshBasicMaterial({ color: 0xdfeeee, transparent: true, opacity: 0.06, depthWrite: false, side: THREE.DoubleSide });
    for (const [w, h, x, y, z, ry] of [[W, H, 0, H / 2, D / 2, 0], [D, H, -W / 2, H / 2, 0, Math.PI / 2], [D, H, W / 2, H / 2, 0, Math.PI / 2]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glassMat); m.position.set(x, y, z); m.rotation.y = ry; scene.add(m);
    }
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(W, H, D)), new THREE.LineBasicMaterial({ color: 0x8e9a9c }));
    edges.position.y = H / 2; scene.add(edges);
    return { woodT, spriteT };
  }

  // ---------- stones & plants (editable) ----------
  const editables = new Map();      // id -> {root, kind, radius, label}
  let stoneMats;
  function stoneMaterial(map) {
    const m = new THREE.MeshLambertMaterial({ map });
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, uniformsCommon);
      sh.vertexShader = 'varying vec3 vObjP; varying vec3 vObjN; varying vec3 vWorldC;\n' + sh.vertexShader
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjP = position; vObjN = normal;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldC = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      // triplanar in object space: the stone's painting stays put when the stone is moved
      sh.fragmentShader = 'varying vec3 vObjP; varying vec3 vObjN;\n' + CAUSTIC + sh.fragmentShader.replace('#include <map_fragment>', `
        vec3 bw = pow(abs(normalize(vObjN)), vec3(4.)); bw /= (bw.x + bw.y + bw.z);
        vec3 P = vObjP * 22.0;                 // one painted tile per ~4.5 cm of stone
        vec4 tri = texture2D(map, P.zy) * bw.x + texture2D(map, P.xz) * bw.y + texture2D(map, P.xy) * bw.z;
        diffuseColor *= tri;
        diffuseColor.rgb *= 1. + uCaustic * causticAt(vWorldC.xz, uTime) * smoothstep(-0.2, 0.6, normalize(vObjN).y);`);
    };
    m.customProgramCacheKey = () => 'stone-triplanar';
    return m;
  }
  function seeded(id) { let h = 2166136261; for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) / 4294967296); }
  function stoneGeometry(o) {
    const rnd = seeded(o.id), geo = new THREE.IcosahedronGeometry(0.5, 5), p = geo.attributes.position, v = new THREE.Vector3();
    const k = [rnd() * 6, rnd() * 6, rnd() * 6, rnd() * 6];
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const n = v.clone().normalize();
      let r = 1 + 0.07 * Math.sin(n.x * 3.1 + k[0]) * Math.cos(n.z * 2.7 + k[1]) + 0.04 * Math.sin(n.y * 4.3 + n.x * 2.1 + k[2]);
      v.multiplyScalar(r);
      if (v.y < -0.1) v.y = -0.1 + (v.y + 0.1) * 0.35;           // flattened base resting in the gravel
      p.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    geo.scale(o.size[0] * cm, o.size[1] * cm * 1.55, o.size[2] * cm);
    return geo;
  }
  function makeStone(o) {
    const mesh = new THREE.Mesh(stoneGeometry(o), stoneMats[o.color]);
    const root = new THREE.Group(); root.add(mesh); root.userData.id = o.id; scene.add(root);
    editables.set(o.id, { root, mesh, kind: 'stone', radius: Math.max(o.size[0], o.size[2]) * cm / 2, label: '石' + o.id.split('-')[1], sink: 0.12 * o.size[1] * cm });
  }
  let plantMat;
  const BURY = 0.006;                      // frond stalk pushed into the soil
  function makePlant(o, spriteT) {
    // water sprite: a rosette of fronds, each one cut-out card leaning outward from the crown
    const rnd = seeded(o.id), root = new THREE.Group(), aspect = spriteT.image.width / spriteT.image.height;
    const baseU = A.spriteBaseU ?? 0.5;     // where the painted stalk leaves the bottom edge of the cut-out
    const crown = o.spread * cm * 0.12;
    for (let k = 0; k < o.fronds; k++) {
      const a = k * 2.39996 + rnd() * 0.5, h = o.height * cm * (0.55 + 0.45 * rnd()), w = h * aspect;
      const lean = 0.15 + 0.5 * rnd() * Math.min(1, o.spread / o.height);   // radians away from vertical
      const frond = new THREE.Group();
      frond.position.set(Math.cos(a) * crown * rnd(), 0, Math.sin(a) * crown * rnd());
      frond.rotation.order = 'YXZ'; frond.rotation.set(-lean, -a + Math.PI / 2, (rnd() - .5) * 0.2);
      const geo = new THREE.PlaneGeometry(w, h + BURY);
      geo.translate((0.5 - baseU) * w, (h + BURY) / 2 - BURY, 0);
      frond.add(new THREE.Mesh(geo, plantMat));
      root.add(frond);
    }
    root.userData.id = o.id; scene.add(root);
    editables.set(o.id, { root, kind: 'plant', radius: Math.max(0.025, o.spread * cm * 0.45), label: '水草' + o.id.split('-')[1] + '（ウォータースプライト）', sink: 0 });
  }
  function makeWood(o, woodT) {
    // branchy driftwood: tubes along the approved path, bark grain running along each branch
    const root = new THREE.Group(), [x0, , z0] = o.path[0];
    const mat = withCaustics(new THREE.MeshLambertMaterial({ map: woodT }), 'wood');
    for (const [bi, path] of [o.path, o.branch].filter(Boolean).entries()) {
      const pts = path.map(([x, y, z]) => new THREE.Vector3((x - x0) * cm, y * cm, (z - z0) * cm));
      if (bi === 0) pts.unshift(pts[0].clone().add(new THREE.Vector3(-0.012, -0.02, -0.004)));   // buried foot
      const curve = new THREE.CatmullRomCurve3(pts), len = curve.getLength(), r0 = o.radius * cm * (bi ? 0.7 : 1);
      const geo = new THREE.TubeGeometry(curve, 48, r0, 12, false);
      const pos = geo.attributes.position, uv = geo.attributes.uv, nrm = geo.attributes.normal;
      const ring = 13, segs = pos.count / ring, frames = curve.computeFrenetFrames(48, false), v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {      // taper toward the tip, grain (texture v) along the branch
        const seg = Math.floor(i / ring), t = seg / (segs - 1), c = curve.getPointAt(t);
        const taper = 1 - 0.55 * t * t;
        v.fromBufferAttribute(pos, i).sub(c).multiplyScalar(taper).add(c); pos.setXYZ(i, v.x, v.y, v.z);
        const u0 = uv.getX(i), u1 = uv.getY(i);
        uv.setXY(i, u1, u0 * len / (2 * Math.PI * r0) * 0.6);
      }
      geo.computeVertexNormals();
      const tube = new THREE.Mesh(geo, mat); root.add(tube);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(r0 * 0.45 * 1.0, 10, 8), new THREE.MeshLambertMaterial({ color: 0x8a6a4a }));
      cap.position.copy(curve.getPointAt(1)); root.add(cap);
    }
    root.userData.id = o.id; scene.add(root);
    editables.set(o.id, { root, kind: 'wood', radius: 0.05, label: '流木', sink: 0, fixedY: true });
  }

  // ---------- layout state (approved layout -> aquarium-state) ----------
  const approved = L.objects.filter(o => ['stone', 'fern', 'wood'].includes(o.kind)).map(o => ({
    id: o.id, kind: o.kind === 'fern' ? 'plant' : o.kind, position: o.kind === 'wood' ? [o.path[0][0] * cm, 0, o.path[0][2] * cm] : [o.pos[0] * cm, 0, o.pos[2] * cm], rotation: [0, (o.rot_deg || 0) * Math.PI / 180, 0],
    ...(o.kind === 'stone' ? { colorId: o.color } : {}),
  }));
  const REVISION = 'layout-v' + (L.objects_version ?? L.version);   // fish-only changes keep the visitor's saved arrangement
  const SAVE_KEY = 'guppy-aquarium:aquarium:' + REVISION;
  const state = LIB.createAquariumState(approved, { palette: ['blue', 'red'], revision: REVISION });
  function clampPos(id, x, z) {
    const e = editables.get(id), r = e.radius + 0.006;
    return [Math.min(W / 2 - r, Math.max(-W / 2 + r, x)), Math.min(D / 2 - r, Math.max(-D / 2 + r, z))];
  }
  function applyState() {
    for (const o of state.snapshot().objects) {
      const e = editables.get(o.id); if (!e) continue;
      const [x, z] = clampPos(o.id, o.position[0], o.position[2]);
      e.root.position.set(x, e.fixedY ? 0 : ground(x, z) - e.sink, z); e.root.rotation.y = o.rotation[1];
      if (e.kind === 'stone') e.mesh.material = stoneMats[o.colorId];
      if (e.kind === 'plant') {               // each stem stands in the gravel right under it (the bed slopes)
        const c = Math.cos(o.rotation[1]), s_ = Math.sin(o.rotation[1]);
        for (const stem of e.root.children) {
          const wx = x + stem.position.x * c + stem.position.z * s_, wz = z - stem.position.x * s_ + stem.position.z * c;
          stem.position.y = ground(wx, wz) - e.root.position.y;
        }
      }
    }
    updatePanel();
  }
  const save = () => store.set(SAVE_KEY, JSON.stringify(state.snapshot()));
  function loadSaved() {
    const raw = store.get(SAVE_KEY); if (!raw) return false;
    try { return state.load(JSON.parse(raw)); } catch { return false; }
  }

  // ---------- fish ----------
  const fishes = [];
  const SWIM_VERT = `
    uniform float uSwimPhase; uniform float uSwimAmp; uniform float uFlapAngle; uniform float uFlapZ0; uniform float uFlapSide; uniform float uIsPec;
`;
  const SWIM_BEGIN = `#include <begin_vertex>
    if (uIsPec > 0.5) {             // pectoral fin: open/close about its root line (outward from the body)
      float d = max(abs(transformed.z) - uFlapZ0, 0.);
      transformed.z = uFlapSide * (uFlapZ0 + d * cos(uFlapAngle));
      transformed.y += d * sin(uFlapAngle);
    }
    float s = clamp((transformed.x + 0.0225) / 0.045, 0., 1.);   // 0 = snout, 1 = tail tip (model is 0.045 m, head at -x)
    float bend = uSwimAmp * pow(smoothstep(0.15, 1., s), 1.3);
    transformed.z += bend * sin(uSwimPhase - s * 4.2);`;
  function fishMaterial(kind, map, u, opacity) {
    let m;
    if (kind === 'fin') m = new THREE.MeshLambertMaterial({ map, transparent: true, depthWrite: false, side: THREE.FrontSide });
    else if (kind === 'sac') m = new THREE.MeshLambertMaterial({ map, transparent: true, opacity, depthWrite: false, side: THREE.FrontSide });
    else m = new THREE.MeshLambertMaterial({ map, side: THREE.FrontSide });
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = SWIM_VERT + sh.vertexShader.replace('#include <begin_vertex>', SWIM_BEGIN);
      if (kind === 'fin') sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        // translucent membrane: pale, white and grey parts of the painted fin let the water show through
        float lum = dot(diffuseColor.rgb, vec3(.299, .587, .114));
        float chroma = max(max(diffuseColor.r, diffuseColor.g), diffuseColor.b) - min(min(diffuseColor.r, diffuseColor.g), diffuseColor.b);
        float ink = clamp((0.78 - lum) * 2.2 + chroma * 1.8, 0., 1.);
        diffuseColor.a = mix(0.2, 0.9, ink);`);
    };
    m.customProgramCacheKey = () => 'fish-' + kind;
    return m;
  }
  const FIN = /^(dorsal|caudal|pectoral|pelvic|anal|gonopodium|ribbon)/;
  async function loadFish(f, i) {
    const M = A.models[f.id];
    const res = await fetch(M.geometry);
    if (!res.ok) throw new Error('モデルを読み込めませんでした: ' + M.geometry);
    const data = await res.json();
    const map = await tex(M[quality.name === 'light' ? 'light' : 'standard']);
    map.flipY = false;                         // glTF-style UVs (v = 0 at the top of the atlas)
    const model = new THREE.Group();
    for (const m of data.meshes) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(m.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(m.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(m.uv, 2));
      g.setIndex(m.i);
      const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map, transparent: m.opacity < 1, opacity: m.opacity }));
      mesh.name = m.name; model.add(mesh);
    }
    const root = new THREE.Group();
    const u = { uSwimPhase: { value: i * 2.1 }, uSwimAmp: { value: 0.0022 }, uFlapAngle: { value: 0 }, uFlapZ0: { value: 0 }, uFlapSide: { value: 1 }, uIsPec: { value: 0 } };
    const pecs = [];
    const mats = {};
    model.traverse(o => {
      if (!o.isMesh) return;
      const src = o.material, map = src.map;
      if (/^pectoral/.test(o.name)) {       // own uniforms: root line and side of this fin
        o.geometry.computeBoundingBox();
        const bb = o.geometry.boundingBox, side = (bb.min.z + bb.max.z) > 0 ? 1 : -1;
        const pu = { ...u, uIsPec: { value: 1 }, uFlapSide: { value: side }, uFlapZ0: { value: side > 0 ? bb.min.z : -bb.max.z }, uFlapAngle: { value: 0 } };
        o.material = fishMaterial('fin', map, pu); pecs.push(pu);
      } else if (src.transparent) o.material = mats.sac ??= fishMaterial('sac', map, u, src.opacity);
      else if (FIN.test(o.name)) o.material = mats.fin ??= fishMaterial('fin', map, u);
      else o.material = mats.body ??= fishMaterial('body', map, u);
      if (o.material.transparent) o.renderOrder = 2;
      o.frustumCulled = false;            // vertex animation moves fins beyond the static bounds
    });
    root.add(model); root.scale.setScalar(f.length_cm / f.model_length_cm); root.rotation.order = 'YZX'; scene.add(root);
    root.userData.fishId = f.id;
    fishes.push({ root, u, pecs, path: PATHS[f.id], id: f.id, t: 0, hold: false });
  }
  // Loops in the open water above the driftwood (wood tops out ~13 cm), each guppy at its own height;
  // the sunset swims lowest, in front of the wood.
  const PATHS = {
    'fish-golden-king-cobra': { c: [-0.015, 0.145, 0.01], a: [0.085, 0.012, 0.038], w: 0.42, ph: 3.6 },
    'fish-galaxy-blue-grass': { c: [0.02, 0.118, 0.028], a: [0.075, 0.01, 0.03], w: -0.36, ph: 0.6 },
    'fish-rrea-red-grass-ribbon': { c: [0.0, 0.17, -0.012], a: [0.09, 0.01, 0.032], w: 0.33, ph: 5.0 },
    'fish-sunset-german-yellow-tuxedo': { c: [0.01, 0.103, 0.05], a: [0.085, 0.008, 0.018], w: -0.3, ph: 2.2 },
    'fish-marble-magenta': { c: [-0.01, 0.132, -0.03], a: [0.08, 0.01, 0.02], w: 0.38, ph: 4.1 },
  };
  const FISH_NAMES = {
    'fish-golden-king-cobra': 'ゴールデンキングコブラ',
    'fish-galaxy-blue-grass': 'ギャラクシーブルーグラス',
    'fish-rrea-red-grass-ribbon': 'RREA レッドグラス リボン',
    'fish-sunset-german-yellow-tuxedo': 'サンセット ドイツイエロー タキシード',
    'fish-marble-magenta': 'マーブルマゼンタ',
  };
  const pathAt = (P, t) => {
    const u = P.w * t + P.ph;
    return {
      p: [P.c[0] + P.a[0] * Math.sin(u), P.c[1] + P.a[1] * Math.sin(0.5 * u + 1.1), P.c[2] + P.a[2] * Math.cos(u)],
      v: [P.a[0] * Math.cos(u) * P.w, P.a[1] * 0.5 * Math.cos(0.5 * u + 1.1) * P.w, -P.a[2] * Math.sin(u) * P.w],
    };
  };
  function updateFish(F, t, dt) {
    const { p, v } = pathAt(F.path, t), hs = Math.hypot(v[0], v[2]);
    F.root.position.set(...p);
    const yaw = Math.atan2(v[2], -v[0]);
    let dyaw = yaw - (F.yaw ?? yaw); dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    F.yaw = yaw; F.turn = (F.turn ?? 0) * 0.92 + (dt > 0 ? dyaw / dt : 0) * 0.08;
    F.root.rotation.set(-0.35 * F.turn * 0.25, yaw, -Math.atan2(v[1], hs) * 0.8);
    const speed = Math.hypot(...v);
    F.u.uSwimPhase.value += dt * (11 + 160 * speed + 5 * Math.abs(F.turn));
    F.u.uSwimAmp.value = 0.0018 + 0.006 * Math.min(Math.abs(F.turn), 0.4);
    const flap = 0.3 + 0.25 * Math.sin(F.u.uSwimPhase.value * 0.8);
    for (const pu of F.pecs) { pu.uSwimPhase.value = F.u.uSwimPhase.value; pu.uSwimAmp.value = F.u.uSwimAmp.value; pu.uFlapAngle.value = flap; }
  }

  // ---------- water surface ----------
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
        uTime: uniformsCommon.uTime, uRefr: { value: STD ? rtRefr.texture : null }, uRefl: { value: STD ? rtRefl.texture : null },
        uReflVP: { value: new THREE.Matrix4() }, uRes: { value: res }, uUseRT: { value: STD ? 1 : 0 },
        uTint: { value: new THREE.Color(0x9fd8cf) }, uSky: { value: new THREE.Color(0xf2f7f4) }, uHalf: { value: new THREE.Vector2(W / 2, D / 2) },
      },
      vertexShader: `
        uniform float uTime; uniform mat4 uReflVP; varying vec3 vW; varying vec4 vReflClip; varying vec3 vN;
        float wave(vec2 p, float t){ return 0.0007*sin(p.x*61.+t*1.4) + 0.0005*sin(p.y*83.-t*1.2+p.x*17.) + 0.0003*sin((p.x+p.y)*131.+t*2.2); }
        void main(){
          vec3 p = position; vec4 w = modelMatrix * vec4(p,1.);
          float e = 0.0006;
          float h = wave(w.xz,uTime), hx = wave(w.xz+vec2(e,0.),uTime), hz = wave(w.xz+vec2(0.,e),uTime);
          w.y += h; vN = normalize(vec3(-(hx-h)/e, 1., -(hz-h)/e));
          vW = w.xyz; vReflClip = uReflVP * w;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: `
        uniform sampler2D uRefr; uniform sampler2D uRefl; uniform vec2 uRes; uniform float uUseRT; uniform float uTime;
        uniform vec3 uTint; uniform vec3 uSky; uniform vec2 uHalf;
        varying vec3 vW; varying vec4 vReflClip; varying vec3 vN;
        void main(){
          vec3 V = normalize(cameraPosition - vW);
          bool above = cameraPosition.y > vW.y;
          vec3 N = above ? vN : -vN;
          float cosT = clamp(abs(dot(V, N)), 0., 1.);
          vec2 sUV = gl_FragCoord.xy / uRes;
          vec2 off = vN.xz * 0.22;
          vec3 refr = uUseRT > .5 ? texture2D(uRefr, clamp(sUV + off, 0.001, .999)).rgb : uTint;
          vec3 col;
          if (above) {
            float fres = 0.04 + 0.6 * pow(1. - cosT, 5.);
            col = mix(refr * mix(vec3(1.), uTint, .25), uSky, fres);
          } else {
            vec2 rUV = vReflClip.xy / vReflClip.w * .5 + .5;
            vec3 refl = uUseRT > .5 ? texture2D(uRefl, clamp(rUV + off, 0.001, .999)).rgb : uTint * .85;
            float tir = 1. - smoothstep(0.6, 0.72, cosT);          // total internal reflection past ~48.6 deg
            col = mix(mix(refr, uSky, .35), refl, max(tir, 0.25));
          }
          vec3 L = normalize(vec3(-0.2, 1., 0.45));
          float spec = pow(max(dot(reflect(-L, vN), V), 0.), 90.);
          col += spec * 0.35;
          vec2 edge = uHalf - abs(vW.xz);                          // meniscus: a fine bright line along the glass
          col += 0.18 * (1. - smoothstep(0.0, 0.004, min(edge.x, edge.y)));
          gl_FragColor = vec4(col, uUseRT > .5 ? 1. : 0.28 + 0.4 * (1. - cosT));
          #include <colorspace_fragment>
        }`,
    });
    surface = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.0004, D - 0.0004, STD ? 96 : 48, STD ? 48 : 24), mat);
    surface.rotation.x = -Math.PI / 2; surface.position.y = WL; surface.renderOrder = 3; scene.add(surface);
    return res;
  }
  let surfRes;

  // ---------- camera & views ----------
  const controls = new THREE.OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.minDistance = 0.09; controls.maxDistance = 1.1;
  controls.maxPolarAngle = Math.PI * 0.62; controls.target.set(0, 0.11, 0);
  function fitDistance(margin = 1.08) {
    const vFov = THREE.MathUtils.degToRad(camera.fov), hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    return Math.max((W / 2 * margin) / Math.tan(hFov / 2) + D / 2, (H / 2 * margin) / Math.tan(vFov / 2) + D / 2);
  }
  const VIEWS = {
    front: () => [[0, 0.12, fitDistance()], [0, 0.115, 0]],
    oblique: () => { const d = fitDistance(1.02); return [[d * 0.5, 0.12 + d * 0.32, d * 0.78], [0, 0.09, 0]]; },
    top: () => [[0, fitDistance(1.15) + WL, 0.001], [0, 0, 0]],
  };
  function setView(n) { if (watching) unwatch(false); const [p, t] = VIEWS[n](); camera.position.set(...p); controls.target.set(...t); controls.update(); }
  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));

  // ---------- watch one fish: the camera follows it, orbit and zoom stay free ----------
  let watching = null;
  const lastFishPos = new THREE.Vector3(), tmpV = new THREE.Vector3();
  function watch(id) {
    const F = fishes.find(f => f.id === id);
    if (!F) { unwatch(true); return; }
    for (const f of fishes) f.hold = false;
    watching = F; $('watch').value = id;
    $('watch-name').textContent = FISH_NAMES[id] ?? id;
    $('watch-hold').setAttribute('aria-pressed', 'false'); $('watch-hold').textContent = '止める';
    $('watch-panel').hidden = false;
    controls.minDistance = 0.035;
    // start beside the fish on the front-glass side, a little below it (fish-watch.mjs)
    const p = F.root.position, start = LIB.watchStart(p.toArray(), F.root.rotation.y, { aspect: camera.aspect });
    camera.position.fromArray(start.camera); keepCameraInFront();
    controls.target.fromArray(start.target); lastFishPos.copy(p); controls.update();
    // plants close to the camera would hide the fish: make them faint while watching
    plantMat.transparent = true; plantMat.opacity = 0.22; plantMat.depthWrite = false; plantMat.needsUpdate = true;
    document.body.dataset.watching = '';
    renderer.setClearColor(0x86c3b9, 1);      // close up, the view can pass the side glass: show water there, not the page
  }
  function unwatch(resetView) {
    if (watching) watching.hold = false;
    watching = null; $('watch').value = ''; $('watch-panel').hidden = true; controls.minDistance = 0.09;
    plantMat.transparent = false; plantMat.opacity = 1; plantMat.depthWrite = true; plantMat.needsUpdate = true;
    delete document.body.dataset.watching;
    renderer.setClearColor(0xeef4f1, 1);
    if (resetView) setView('front');
  }
  function followWatched() {
    if (!watching) return;
    const p = watching.root.position;
    tmpV.fromArray(LIB.followDelta(lastFishPos.toArray(), p.toArray())); camera.position.add(tmpV); controls.target.add(tmpV); lastFishPos.copy(p);
    keepCameraInFront();
  }
  // stay between the side glasses and in front of the back glass, so the view is always into the water
  function keepCameraInFront() { camera.position.fromArray(LIB.clampWatchCamera(camera.position.toArray(), { w: W, d: D })); }
  $('watch').addEventListener('change', e => e.target.value ? watch(e.target.value) : unwatch(true));
  $('watch-exit').addEventListener('click', () => unwatch(true));
  $('watch-next').addEventListener('click', () => watch(LIB.nextWatchId(fishes.map(f => f.id), watching?.id ?? null)));
  $('watch-hold').addEventListener('click', () => {
    if (!watching) return; watching.hold = !watching.hold;
    $('watch-hold').setAttribute('aria-pressed', watching.hold); $('watch-hold').textContent = watching.hold ? '泳がせる' : '止める';
  });

  function resize() {
    const r = stage.getBoundingClientRect();
    const size = LIB.aquariumDrawingSize(quality, r.width, r.height, devicePixelRatio);
    renderer.setPixelRatio(size.pixelRatio); renderer.setSize(size.cssWidth, size.cssHeight, false);
    camera.aspect = size.cssWidth / size.cssHeight; camera.fov = camera.aspect < 1 ? 46 : 34; camera.updateProjectionMatrix();
    const dw = size.drawingWidth, dh = size.drawingHeight;
    if (rtRefr) { rtRefr.setSize(dw >> 1, dh >> 1); rtRefl.setSize(dw >> 1, dh >> 1); }
    surfRes?.set(dw, dh);
  }

  // ---------- editing ----------
  let mode = 'view', selected = null, drag = null;
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
  const ring = new THREE.Mesh(new THREE.RingGeometry(1, 1.12, 48), new THREE.MeshBasicMaterial({ color: 0x3a6f8f, transparent: true, opacity: .75, depthTest: false }));
  ring.rotation.x = -Math.PI / 2; ring.renderOrder = 5; ring.visible = false; scene.add(ring);
  function setMode(m) {
    mode = m; document.body.dataset.mode = m;
    $('mode-view').setAttribute('aria-pressed', m === 'view'); $('mode-edit').setAttribute('aria-pressed', m === 'edit');
    $('edit-panel').hidden = m !== 'edit';
    if (m === 'view') select(null); else { if (watching) unwatch(true); if (!selected) select(approved[0].id); }
    resize();
  }
  // the bottom bar wraps to several rows on phones: keep the sheets just above it
  const bar = document.querySelector('.bar');
  new ResizeObserver(() => document.documentElement.style.setProperty('--bar-h', bar.offsetHeight + 'px')).observe(bar);
  $('mode-view').addEventListener('click', () => setMode('view'));
  $('mode-edit').addEventListener('click', () => setMode('edit'));
  function select(id) {
    selected = id; ring.visible = !!id; $('obj-select').value = id || '';
    updatePanel();
  }
  function updatePanel() {
    if (!selected) { $('obj-controls').hidden = true; return; }
    const e = editables.get(selected), o = state.snapshot().objects.find(o => o.id === selected);
    $('obj-controls').hidden = false;
    $('pos-x').value = (o.position[0] / cm).toFixed(1); $('pos-z').value = (o.position[2] / cm).toFixed(1);
    $('rot-y').value = Math.round(THREE.MathUtils.radToDeg(o.rotation[1]) % 360);
    $('stone-color').hidden = e.kind !== 'stone';
    if (e.kind === 'stone') document.querySelectorAll('[data-color]').forEach(b => b.setAttribute('aria-pressed', b.dataset.color === o.colorId));
    ring.scale.setScalar(e.radius + 0.006); const rx = e.root.position.x, rz = e.root.position.z; ring.position.set(rx, ground(rx, rz) + 0.002, rz);
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
    if (!selected || editables.get(selected).kind !== 'stone') return;
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
    const roots = [...editables.values()].map(e => e.root);
    const hits = ray.intersectObjects(roots, true);
    for (const h of hits) { let o = h.object; while (o && !o.userData.id) o = o.parent; if (o) return { id: o.userData.id, point: h.point }; }
    return null;
  }
  let tap = null;
  canvas.addEventListener('pointerdown', ev => { if (mode === 'view') tap = { x: ev.clientX, y: ev.clientY }; });
  canvas.addEventListener('pointerup', ev => {
    if (mode !== 'view' || !tap) return;
    const up = { x: ev.clientX, y: ev.clientY }, down = tap; tap = null;
    if (!LIB.isTap(down, up)) return;        // a drag rotates the view; only a tap picks
    const r = canvas.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    for (const h of ray.intersectObjects(fishes.map(f => f.root), true)) {
      let o = h.object; while (o && !o.userData.fishId) o = o.parent;
      if (o) { watch(o.userData.fishId); return; }
    }
  });
  canvas.addEventListener('pointerdown', ev => {
    if (mode !== 'edit') return;
    const p = pick(ev);
    if (!p) return;
    select(p.id);
    const e = editables.get(p.id);
    plane.constant = -ground(e.root.position.x, e.root.position.z);
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
  const BGM_VOL = 'guppy-aquarium:bgm-volume';
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
    // mirror camera across the water plane
    reflCam.copy(camera);
    reflCam.position.set(camera.position.x, 2 * WL - camera.position.y, camera.position.z);
    tmpTarget.copy(controls.target); tmpTarget.y = 2 * WL - tmpTarget.y;
    reflCam.up.set(0, 1, 0); reflCam.lookAt(tmpTarget); reflCam.updateMatrixWorld();
    surface.material.uniforms.uReflVP.value.multiplyMatrices(reflCam.projectionMatrix, reflCam.matrixWorldInverse);
    renderer.setRenderTarget(rtRefl); renderer.render(scene, reflCam);
    renderer.setRenderTarget(null); surface.visible = true; ring.visible = !!selected;
  }
  function loop() {
    requestAnimationFrame(loop);
    if (document.hidden) { clock.getDelta(); return; }
    const d = Math.min(clock.getDelta(), 0.1); acc += d;
    if (acc < frameMin * 0.95) return;
    const dt = Math.min(acc, 0.1); acc = 0; t += dt;
    uniformsCommon.uTime.value = t;
    for (const F of fishes) { if (!F.hold) F.t += dt; updateFish(F, F.t, F.hold ? dt * 0.35 : dt); }
    followWatched();
    controls.update();
    if (STD && surface) renderWaterPasses();
    renderer.render(scene, camera);
  }

  // ---------- start ----------
  (async () => {
    try {
      say('水槽を準備しています…');
      const [blueT, redT] = await Promise.all([tex(A.textures['stone-blue'], { repeat: [1, 1] }), tex(A.textures['stone-red'], { repeat: [1, 1] })]);
      stoneMats = { blue: stoneMaterial(blueT), red: stoneMaterial(redT) };
      const { woodT, spriteT } = await buildTank();
      woodT.wrapS = woodT.wrapT = THREE.RepeatWrapping;
      plantMat = new THREE.MeshLambertMaterial({ map: spriteT, alphaTest: 0.4, side: THREE.DoubleSide });
      plantMat.onBeforeCompile = sh => {       // slow sway, stronger toward the tips
        Object.assign(sh.uniforms, uniformsCommon);
        sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
          vec4 wp0 = modelMatrix * vec4(0.,0.,0.,1.);
          float k = pow(clamp(position.y / 0.17, 0., 1.), 1.6);
          transformed.x += k * 0.006 * sin(uTime * 0.8 + wp0.x * 60. + wp0.z * 37.);
          transformed.z += k * 0.004 * sin(uTime * 0.6 + wp0.x * 23.);`);
      };
      plantMat.customProgramCacheKey = () => 'sprite-sway';
      for (const o of L.objects) { if (o.kind === 'stone') makeStone(o); if (o.kind === 'fern') makePlant(o, spriteT); if (o.kind === 'wood') makeWood(o, woodT); }
      const sel = $('obj-select');
      for (const o of approved) sel.append(new Option(editables.get(o.id).label, o.id));
      if (loadSaved()) flash('前回の配置を読み込みました');
      applyState();
      surfRes = buildWater();
      resize(); setView('front');
      addEventListener('resize', resize);
      say('グッピーを呼んでいます…');
      for (const [i, f] of L.fish.entries()) await loadFish(f, i);   // one at a time: lower peak memory on phones
      for (const f of L.fish) $('watch').append(new Option('観察：' + (FISH_NAMES[f.id] ?? f.id), f.id));
      status.hidden = true;
      loop();
    } catch (e) {
      console.error(e);
      say('読み込みに失敗しました。通信状態を確かめて再読み込みしてください。（' + (e.message || e) + '）', true);
    }
  })();
  setMode('view');
})();
