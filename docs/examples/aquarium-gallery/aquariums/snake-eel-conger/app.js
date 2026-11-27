/* シマウミヘビとマアナゴの水槽 — three.js r170 (window.THREE) + AquariumLib (aquarium-state / mobile-quality / fish-watch).
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
  const QUALITY_KEY = 'snake-eel-conger-aquarium:quality';
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
  const PAGE_CLEAR = 0xf0ebe1, WATER_CLEAR = 0x9fbcc0;
  renderer.setClearColor(PAGE_CLEAR, 1);
  renderer.localClippingEnabled = true;     // fish are clipped to the tank: the part of a buried eel that is out of the tank never shows
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 10);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xcdbfa6, 2.2));
  const sun = new THREE.DirectionalLight(0xfff6e6, 1.1); sun.position.set(-0.2, 1, 0.45); scene.add(sun);

  // ---------- tank ----------
  const L = A.layout, cm = 0.01;
  const W = L.tank.w * cm, D = L.tank.d * cm, H = L.tank.h * cm, WL = L.tank.water * cm;
  // fine sand: 4.5 cm at the front, 7.5 cm at the back, with soft ripples
  const ground = (x, z) => 0.045 + 0.03 * (0.5 - z / D) + 0.0022 * Math.sin(x * 47 + 1.3) * Math.cos(z * 61) + 0.0015 * Math.sin(x * 19 - z * 23);
  const CM = 0.003;                       // clip a hair outside the glass, so a body touching the glass is not cut
  const clip = [new THREE.Plane(new THREE.Vector3(1, 0, 0), W / 2 + CM), new THREE.Plane(new THREE.Vector3(-1, 0, 0), W / 2 + CM),
                new THREE.Plane(new THREE.Vector3(0, 0, 1), D / 2 + CM), new THREE.Plane(new THREE.Vector3(0, 0, -1), D / 2 + CM),
                new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)];

  const uniformsCommon = { uTime: { value: 0 }, uCaustic: { value: STD ? 0.3 : 0.18 } };
  const loader = new THREE.TextureLoader();
  const tex = (url, { repeat, srgb = true } = {}) => new Promise((ok, fail) => loader.load(url, t => {
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
    t.anisotropy = STD ? 4 : 1; ok(t);
  }, undefined, () => fail(new Error('画像を読み込めませんでした: ' + url))));

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

  // the cut face of the sand bed along the front / side / back glass (so the bed has a visible thickness)
  function sandWall(points, material) {       // points: [[x, z], ...] along the wall, outward normal given by winding
    const pos = [], uv = [], idx = [];
    points.forEach(([x, z], i) => {
      const g = ground(x, z), u = i / (points.length - 1);
      pos.push(x, 0, z, x, g, z); uv.push(u * 4, 0, u * 4, g * 8);
      if (i) { const a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    return new THREE.Mesh(geo, material);
  }

  async function buildTank() {
    const [bgT, sandT] = await Promise.all([tex(A.textures.background), tex(A.textures.sand, { repeat: [W * 11.7, D * 11.7] })]);
    // back screen behind the back glass (unlit: keeps the picture's own colours); one-sided so the tank is seen through from behind
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.02, H), new THREE.MeshBasicMaterial({ map: bgT, side: THREE.FrontSide }));
    bg.position.set(0, H / 2, -D / 2 - 0.004); scene.add(bg);
    const g = new THREE.PlaneGeometry(W, D, 120, 60); g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, ground(p.getX(i), p.getZ(i)));
    g.computeVertexNormals();
    scene.add(new THREE.Mesh(g, withCaustics(new THREE.MeshLambertMaterial({ map: sandT }), 'sand')));
    const sandT2 = sandT.clone(); sandT2.repeat.set(1, 1); sandT2.needsUpdate = true;
    const wallMat = new THREE.MeshLambertMaterial({ map: sandT2, color: 0xd9ccb4, side: THREE.DoubleSide });
    const row = n => Array.from({ length: n }, (_, i) => i / (n - 1));
    scene.add(sandWall(row(80).map(u => [-W / 2 + u * W, D / 2 - 0.0004]), wallMat));
    scene.add(sandWall(row(40).map(u => [-W / 2 + 0.0004, D / 2 - u * D]), wallMat));
    scene.add(sandWall(row(40).map(u => [W / 2 - 0.0004, D / 2 - u * D]), wallMat));
    scene.add(sandWall(row(80).map(u => [-W / 2 + u * W, -D / 2 + 0.0004]), wallMat));
    const glassMat = new THREE.MeshBasicMaterial({ color: 0xe4efef, transparent: true, opacity: 0.06, depthWrite: false, side: THREE.DoubleSide });
    for (const [w, h, x, y, z, ry] of [[W, H, 0, H / 2, D / 2, 0], [D, H, -W / 2, H / 2, 0, Math.PI / 2], [D, H, W / 2, H / 2, 0, Math.PI / 2]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glassMat); m.position.set(x, y, z); m.rotation.y = ry; scene.add(m);
    }
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(W, H, D)), new THREE.LineBasicMaterial({ color: 0x8e9a9c }));
    edges.position.y = H / 2; scene.add(edges);
  }

  // ---------- stones: modelled from the user's side / top / bottom views (coloured stone on a white crystal base) ----------
  const editables = new Map();      // id -> {root, parts, baked, own, kind, radius, label}
  let stoneMats;
  // the other two colours: a tile cut from the views, projected from three sides in object space
  function stoneMaterial(map, tile) {
    const m = new THREE.MeshLambertMaterial({ map });
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, uniformsCommon);
      sh.vertexShader = 'varying vec3 vObjP; varying vec3 vObjN; varying vec3 vWorldC;\n' + sh.vertexShader
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjP = position; vObjN = normal;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldC = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = 'varying vec3 vObjP; varying vec3 vObjN;\n' + CAUSTIC + sh.fragmentShader.replace('#include <map_fragment>', `
        vec3 bw = pow(abs(normalize(vObjN)), vec3(4.)); bw /= (bw.x + bw.y + bw.z);
        vec3 P = vObjP * ${tile.toFixed(1)};
        vec4 tri = texture2D(map, P.zy) * bw.x + texture2D(map, P.xz) * bw.y + texture2D(map, P.xy) * bw.z;
        diffuseColor *= tri;
        diffuseColor.rgb *= 1. + uCaustic * causticAt(vWorldC.xz, uTime) * smoothstep(-0.2, 0.6, normalize(vObjN).y);`);
    };
    m.customProgramCacheKey = () => 'stone-triplanar-' + tile;
    return m;
  }
  async function makeStone(o) {
    const M = A.models[o.id];
    const res = await fetch(M.geometry);
    if (!res.ok) throw new Error('石のモデルを読み込めませんでした: ' + M.geometry);
    const data = await res.json();
    const map = await tex(M[quality.name === 'light' ? 'light' : 'standard']);
    map.flipY = false;
    const baked = withCaustics(new THREE.MeshLambertMaterial({ map }), 'stone-baked-' + o.id);
    const root = new THREE.Group(), parts = [], k = o.length_cm / o.model_length_cm;
    for (const m of data.meshes) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(m.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(m.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(m.uv, 2));
      g.setIndex(m.i);
      const mesh = new THREE.Mesh(g, baked); mesh.scale.setScalar(k); root.add(mesh);
      if (m.name !== 'base') parts.push(mesh);                    // the white crystal base never changes colour
    }
    root.userData.id = o.id; scene.add(root);
    editables.set(o.id, { root, parts, baked, own: o.color, kind: 'stone', radius: o.length_cm * cm / 2 * 0.92, label: o.label, sink: 0.012 });
  }

  // ---------- layout state (approved layout -> aquarium-state) ----------
  const stonesL = L.objects.filter(o => o.kind === 'stone');
  const approved = stonesL.map(o => ({ id: o.id, kind: 'stone', position: [o.pos[0] * cm, 0, o.pos[2] * cm],
                                       rotation: [0, o.rot_deg * Math.PI / 180, 0], colorId: o.color }));
  const REVISION = 'layout-v' + L.version;
  const SAVE_KEY = 'snake-eel-conger-aquarium:aquarium:' + REVISION;
  const state = LIB.createAquariumState(approved, { palette: ['red', 'peach', 'yellow'], revision: REVISION });
  function clampPos(id, x, z) {
    const e = editables.get(id), r = e.radius + 0.006;
    return [Math.min(W / 2 - r, Math.max(-W / 2 + r, x)), Math.min(D / 2 - r, Math.max(-D / 2 + r, z))];
  }
  function applyState() {
    for (const o of state.snapshot().objects) {
      const e = editables.get(o.id); if (!e) continue;
      const [x, z] = clampPos(o.id, o.position[0], o.position[2]);
      e.root.position.set(x, ground(x, z) - e.sink, z); e.root.rotation.y = o.rotation[1];
      for (const m of e.parts) m.material = o.colorId === e.own ? e.baked : stoneMats[o.colorId];
    }
    updatePanel();
  }
  const save = () => store.set(SAVE_KEY, JSON.stringify(state.snapshot()));
  function loadSaved() {
    const raw = store.get(SAVE_KEY); if (!raw) return false;
    try { return state.load(JSON.parse(raw)); } catch { return false; }
  }
  // a stone (or its white base) the eels must not crawl through: circle around the stone's centre
  const stoneAt = (x, z, margin = 0.012) => {
    for (const e of editables.values()) if (Math.hypot(x - e.root.position.x, z - e.root.position.z) < e.radius * 0.92 + margin) return e;
    return null;
  };

  // ---------- fish: a body bent along a spine that follows the head (snake-like), see updateEel ----------
  const NSP = 24;
  const fishes = [];
  const SWIM_VERT = `
    uniform vec3 uSpine[${NSP}]; uniform float uHalf; uniform float uScale; uniform float uPhase; uniform float uAmp;
    uniform float uFlapAngle; uniform float uFlapZ0; uniform float uFlapSide; uniform float uIsPec;
    vec3 spP(float s){ float f = clamp(s, 0., 1.) * ${(NSP - 1).toFixed(1)}; int i = min(int(floor(f)), ${NSP - 2}); return mix(uSpine[i], uSpine[i + 1], f - float(i)); }
`;
  const SWIM_NORMAL = `
    float sS = clamp((position.x + uHalf) / (2. * uHalf), 0., 1.);
    vec3 sP0 = spP(sS);
    vec3 sT = normalize(spP(min(sS + 0.04, 1.)) - spP(max(sS - 0.04, 0.)));
    vec3 sR = normalize(cross(sT, vec3(0., 1., 0.)));
    vec3 sU = cross(sR, sT);
    vec3 objectNormal = normal.x * sT + normal.y * sU + normal.z * sR;`;
  const SWIM_BEGIN = `
    vec3 transformed = vec3(position);
    if (uIsPec > 0.5) {             // pectoral fin: opens and closes about its root line
      float d = max(abs(transformed.z) - uFlapZ0, 0.);
      transformed.z = uFlapSide * (uFlapZ0 + d * cos(uFlapAngle));
      transformed.y += d * sin(uFlapAngle);
    }
    float wv = uAmp * smoothstep(0.24, 0.75, sS) * sin(uPhase - sS * 4.2);   // gentle travelling wave: the head and gills stay rigid, the tail moves most
    transformed = sP0 + uScale * (transformed.y * sU + (transformed.z + wv) * sR);`;
  function fishMaterial(kind, map, u) {
    const m = kind === 'fin' ? new THREE.MeshLambertMaterial({ map, transparent: true, depthWrite: false, side: THREE.FrontSide })
                             : new THREE.MeshLambertMaterial({ map, side: THREE.DoubleSide });
    m.clippingPlanes = clip;
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = SWIM_VERT + sh.vertexShader.replace('#include <beginnormal_vertex>', SWIM_NORMAL).replace('#include <begin_vertex>', SWIM_BEGIN);
      if (kind === 'fin') sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        // translucent membrane: pale, white and grey parts of the painted fin let the water show through
        float lum = dot(diffuseColor.rgb, vec3(.299, .587, .114));
        float chroma = max(max(diffuseColor.r, diffuseColor.g), diffuseColor.b) - min(min(diffuseColor.r, diffuseColor.g), diffuseColor.b);
        float ink = clamp((0.78 - lum) * 2.2 + chroma * 1.8, 0., 1.);
        diffuseColor.a = mix(0.25, 0.92, ink);`);
    };
    m.customProgramCacheKey = () => 'eel-' + kind;
    return m;
  }
  const FIN = /^(dorsal|anal|pectoral)/;
  const FISH_NAMES = { 'fish-snake-eel': 'シマウミヘビ', 'fish-conger': 'マアナゴ' };
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
      const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map }));
      mesh.name = m.name; model.add(mesh);
    }
    const root = new THREE.Group();
    const scale = f.length_cm / f.model_length_cm, lenW = f.length_cm * cm;
    const spine = Array.from({ length: NSP }, () => new THREE.Vector3());
    const u = { uSpine: { value: spine }, uHalf: { value: f.model_length_cm * cm / 2 }, uScale: { value: scale },
                uPhase: { value: i * 2.1 }, uAmp: { value: 0 }, uFlapAngle: { value: 0 }, uFlapZ0: { value: 0 }, uFlapSide: { value: 1 }, uIsPec: { value: 0 } };
    const pecs = [], mats = {};
    model.traverse(o => {
      if (!o.isMesh) return;
      const map = o.material.map;
      if (/^pectoral/.test(o.name)) {       // own uniforms: root line and side of this fin
        o.geometry.computeBoundingBox();
        const bb = o.geometry.boundingBox, side = (bb.min.z + bb.max.z) > 0 ? 1 : -1;
        const pu = { ...u, uIsPec: { value: 1 }, uFlapSide: { value: side }, uFlapZ0: { value: side > 0 ? bb.min.z : -bb.max.z }, uFlapAngle: { value: 0 } };
        o.material = fishMaterial('fin', map, pu); pecs.push(pu);
      } else if (FIN.test(o.name)) o.material = mats.fin ??= fishMaterial('fin', map, u);
      else o.material = mats.body ??= fishMaterial('body', map, u);
      if (o.material.transparent) o.renderOrder = 2;
      o.frustumCulled = false;            // the vertex shader bends the body away from the static bounds
    });
    root.add(model); scene.add(root);
    // invisible pick proxies along the body (the bent mesh itself is not where the CPU geometry is)
    const proxies = [0.08, 0.3, 0.55].map(() => { const p = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), new THREE.MeshBasicMaterial({ visible: false })); p.userData.fishId = f.id; root.add(p); return p; });
    const F = { id: f.id, root, u, pecs, spine, proxies, lenW, cfg: f.behavior, name: FISH_NAMES[f.id] ?? f.id, hold: false, pos: new THREE.Vector3(), yaw: 0, tClock: 0 };
    initEel(F, i);
    fishes.push(F);
  }

  // ---------- eel behaviour: rise → peek → crawl on the sand → dive head-first → (hidden swap) → rise ----------
  const DS = 0.003, RISE_PITCH = 0.85, PEEK_H = 0.045;                                   // spacing of the recorded head trail
  const rad = d => d * Math.PI / 180, rand = (a, b) => a + Math.random() * (b - a);
  const dirOf = (psi, theta) => new THREE.Vector3(Math.cos(psi) * Math.cos(theta), Math.sin(theta), Math.sin(psi) * Math.cos(theta));
  function siteXZ(s) { return [s.pos[0] * cm, s.pos[1] * cm]; }
  function placeAtSite(F, site, hidden) {
    const [x, z] = siteXZ(site), g = ground(x, z), floor = g - 0.035;
    F.psi = rad(site.heading_deg); F.theta = RISE_PITCH;
    F.head = new THREE.Vector3(x, hidden ? floor : g + PEEK_H, z);
    if (hidden) F.head.addScaledVector(dirOf(F.psi, 0), -(PEEK_H + 0.035) / Math.tan(RISE_PITCH));   // starts under the sand behind the site, comes up at the site
    F.pts = [];
    const back = dirOf(F.psi, 0.5).multiplyScalar(-DS), flat = dirOf(F.psi, 0).multiplyScalar(-DS);
    const p = F.head.clone();
    for (let n = 0; n < Math.ceil((F.lenW + 0.12) / DS); n++) {
      p.add(p.y > floor + DS * 0.3 ? back : flat); if (p.y < floor) p.y = floor;
      F.pts.push(p.clone());
    }
  }
  function fitSite(site, margin) {          // a site must leave room: the buried back-run inside the glass, and 13 cm free in front of the head
    for (let round = 0; round < 4; round++) {
      for (let n = 0; n < 40; n++) {      // move inward until the visible back-run of the body is clear of the glass
        const [x, z] = siteXZ(site), g = ground(x, z), back = dirOf(rad(site.heading_deg), 0.5).multiplyScalar(-DS), p = new THREE.Vector3(x, g + PEEK_H, z);
        let ox = 0, oz = 0;
        for (let k = 0; k < 90 && p.y > g - 0.01; k++) {
          p.add(back);
          ox = Math.max(ox, Math.abs(p.x) - (W / 2 - margin)); oz = Math.max(oz, Math.abs(p.z) - (D / 2 - margin));
        }
        ox = Math.max(ox, Math.abs(x) - (W / 2 - margin)); oz = Math.max(oz, Math.abs(z) - (D / 2 - margin));
        if (ox <= 0 && oz <= 0) break;
        if (ox > 0) site.pos[0] -= Math.sign(x) * ox / cm * 1.05;
        if (oz > 0) site.pos[1] -= Math.sign(z) * oz / cm * 1.05;
      }
      let ok = true;
      for (let n = 0; n < 36; n++) {      // turn the head toward the tank's middle until there is room to swim out
        const [x, z] = siteXZ(site), h = rad(site.heading_deg), fx = x + Math.cos(h) * 0.13, fz = z + Math.sin(h) * 0.13;
        if (Math.abs(fx) <= W / 2 - SAFE && Math.abs(fz) <= D / 2 - SAFE) break;
        ok = false;
        const diff = ((Math.atan2(-z, -x) * 180 / Math.PI - site.heading_deg + 540) % 360) - 180;
        site.heading_deg += Math.sign(diff || 1) * 10;
      }
      if (ok) return;
    }
  }
  function initEel(F, i) {
    for (const st of F.cfg.sites) fitSite(st, 0.04);
    const c = F.cfg; F.site = i % c.sites.length; F.dive = i % c.dives.length;
    F.speed = c.speed_cm_s * cm; F.r = c.radius_cm * cm;
    placeAtSite(F, c.sites[F.site], false);
    F.base = F.head.clone(); F.stage = 0;
    F.state = 'peek'; F.timer = rand(2, 6) + i * 3; F.t = 0; F.travel = 0;
  }
  function pushHead(F) {
    if (F.head.distanceTo(F.pts[0]) >= DS) {
      F.pts.unshift(F.head.clone());
      const keep = Math.ceil((F.lenW + 0.1) / DS); if (F.pts.length > keep) F.pts.length = keep;
    }
  }
  const SAFE = 0.04;
  const keepInside = F => {
    F.head.x = Math.min(W / 2 - SAFE, Math.max(-W / 2 + SAFE, F.head.x));
    F.head.z = Math.min(D / 2 - SAFE, Math.max(-D / 2 + SAFE, F.head.z));
  };
  const tmpA = new THREE.Vector3();
  function fillSpine(F) {         // NSP points at equal arc length from the head backward
    const poly = [F.head, ...F.pts], total = F.lenW;
    let seg = 0, acc = 0, segLen = poly[1].distanceTo(poly[0]);
    for (let k = 0; k < NSP; k++) {
      const a = k / (NSP - 1) * total;
      while (acc + segLen < a && seg < poly.length - 2) { acc += segLen; seg++; segLen = poly[seg + 1].distanceTo(poly[seg]); }
      const t = segLen > 1e-9 ? Math.min(1, Math.max(0, (a - acc) / segLen)) : 0;
      F.spine[k].lerpVectors(poly[seg], poly[seg + 1], t);
    }
    F.raw = F.spine.map(v => v.clone());
    // the head (first 17%) is a straight rigid piece: no joints, no kinks in the head itself
    const kE = Math.round(0.17 * (NSP - 1));
    for (let k = 1; k < kE; k++) F.spine[k].lerpVectors(F.spine[0], F.spine[kE], k / kE);
    // the rest: smooth the polyline so a tight turn bends the body evenly (the inner side no longer folds over itself)
    for (let pass = 0; pass < 4; pass++) {
      for (let k = kE; k < NSP - 1; k++) SPINE_TMP[k].copy(F.spine[k - 1]).add(F.spine[k + 1]).multiplyScalar(0.25).addScaledVector(F.spine[k], 0.5);
      for (let k = kE; k < NSP - 1; k++) F.spine[k].copy(SPINE_TMP[k]);
    }
  }
  const SPINE_TMP = Array.from({ length: NSP }, () => new THREE.Vector3());
  const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
  function steer(F, tx, tz, dt, rate) {       // turn toward (tx, tz); stones push the heading away
    let dx = tx - F.head.x, dz = tz - F.head.z;
    const n = Math.hypot(dx, dz) || 1; dx /= n; dz /= n;
    for (const e of editables.values()) {
      const ex = F.head.x - e.root.position.x, ez = F.head.z - e.root.position.z, d = Math.hypot(ex, ez), R = e.radius * 0.92 + 0.045;
      if (d < R) { const w = (1 - d / R) * 2.2; dx += ex / (d || 1) * w; dz += ez / (d || 1) * w; }
    }
    // glass walls: when heading toward one, turn away early (a head pinned against the glass would pivot on the spot and fold the body)
    const hx = Math.cos(F.psi), hz = Math.sin(F.psi), WALL = SAFE + 0.10;
    for (const [dist, nx, nz] of [[W / 2 + F.head.x, 1, 0], [W / 2 - F.head.x, -1, 0], [D / 2 + F.head.z, 0, 1], [D / 2 - F.head.z, 0, -1]]) {
      if (dist < WALL && -(hx * nx + hz * nz) > 0.05) { const w = (1 - dist / WALL) * 4; dx += nx * w; dz += nz * w; }
    }
    const want = Math.atan2(dz, dx), da = angDiff(want, F.psi);
    rate = Math.min(rate, F.speed / (F.cfg.min_turn_radius_cm * cm));      // never turn tighter than the body can bend
    F.psi += Math.max(-rate * dt, Math.min(rate * dt, da));
  }
  const diveDir = d => { const x = d.spot[0] - d.pre[0], z = d.spot[1] - d.pre[1], n = Math.hypot(x, z) || 1; return [x / n, z / n]; };
  const approachOf = d => { const [ux, uz] = diveDir(d); return [d.pre[0] - ux * 12, d.pre[1] - uz * 12]; };
  function updateEel(F, dt) {
    const c = F.cfg, g0 = ground(F.head.x, F.head.z);
    let amp = 0.004, swimV = 0.35;
    F.t += dt;
    switch (F.state) {
      case 'rise': {                                   // up out of the sand at the site, head first
        F.theta = RISE_PITCH; amp = 0.004;
        F.head.addScaledVector(dirOf(F.psi, F.theta), F.speed * 0.9 * dt);
        if (F.head.y >= ground(F.head.x, F.head.z) + PEEK_H) { F.state = 'peek'; F.timer = rand(...c.peek_s); F.base = F.head.clone(); F.theta = 0.5; }
        break;
      }
      case 'peek': {                                   // only the head and the front of the body out of the sand
        F.timer -= dt; amp = 0.0035; swimV = 0.3;
        const s = Math.sin(F.t * 0.4 + F.site), perp = new THREE.Vector3(-Math.sin(F.psi), 0, Math.cos(F.psi));
        F.head.copy(F.base).addScaledVector(perp, 0.003 * s); F.head.y = F.base.y + 0.002 * Math.sin(F.t * 0.6);
        F.theta = 0.5;
        if (F.timer <= 0) { F.state = 'exit'; F.timer = 2.4; }
        break;
      }
      case 'exit': {                                   // slide out and flatten onto the sand
        F.timer -= dt; amp = 0.009; swimV = 1;     // exit
        const pre = approachOf(c.dives[F.dive]); steer(F, pre[0] * cm, pre[1] * cm, dt, 0.7);
        // the neck arches over the rim of the hole: the pitch follows the height error with a limited turn rate (no cusp at the top)
        const wantTheta = Math.max(-0.45, Math.min(0.45, (g0 + F.r - F.head.y) * 6));
        F.theta += Math.max(-0.9 * dt, Math.min(0.9 * dt, wantTheta - F.theta));
        F.head.addScaledVector(dirOf(F.psi, F.theta), F.speed * dt); keepInside(F);
        if (F.timer <= 0) F.state = 'crawl';
        break;
      }
      case 'crawl': {                                  // along the sand to the dive spot (via a point on the way in)
        amp = 0.012; swimV = 1;
        const d = c.dives[F.dive];
        const tgt = F.stage === 2 ? d.spot : F.stage === 1 ? d.pre : approachOf(d);      // approach point -> entry point -> hole
        steer(F, tgt[0] * cm, tgt[1] * cm, dt, 1.3);
        F.head.addScaledVector(dirOf(F.psi, 0), F.speed * dt);
        keepInside(F);
        F.head.y += (ground(F.head.x, F.head.z) + F.r - F.head.y) * Math.min(1, dt * 6);
        if (Math.hypot(F.head.x - tgt[0] * cm, F.head.z - tgt[1] * cm) < 0.015) {
          if (F.stage === 2) { F.state = 'dive'; F.stage = 0; F.travel = 0; }
          else F.stage++;
        }
        break;
      }
      case 'dive': {                                   // head first into the sand; the body follows the same path
        amp = 0.01; swimV = 1;
        const under = F.head.y < ground(F.head.x, F.head.z) - 0.03;
        if (!under) { const dd = c.dives[F.dive], [ux, uz] = diveDir(dd); steer(F, F.head.x + ux, F.head.z + uz, dt, 0.8); }
        F.theta += ((under ? 0 : -0.5) - F.theta) * Math.min(1, dt * 1.3);
        const step = F.speed * 1.1 * dt;
        F.head.addScaledVector(dirOf(F.psi, F.theta), step); F.travel += step;
        if (F.head.y < ground(F.head.x, F.head.z) - 0.045) F.head.y = ground(F.head.x, F.head.z) - 0.045 + 0.0;
        if (F.travel > F.lenW + 0.08) {                // fully under: swap to the next site while nothing is visible
          F.site = (F.site + 1) % c.sites.length; F.dive = (F.dive + 1) % c.dives.length;
          let tries = c.sites.length;
          while (tries-- > 0) { const [sx, sz] = siteXZ(c.sites[F.site]); if (!stoneAt(sx, sz, 0.02)) break; F.site = (F.site + 1) % c.sites.length; }
          placeAtSite(F, c.sites[F.site], true); F.state = 'rise'; F.stage = 0;
        }
        break;
      }
    }
    if (F.stage === undefined) F.stage = 0;
    if (F.state === 'crawl' || F.state === 'dive' || F.state === 'exit' || F.state === 'rise') pushHead(F);
    if (F.state === 'peek') pushHead(F);
    // body wave: faster while moving, slow idle sway while peeking
    F.u.uPhase.value += dt * (1.2 + 2.6 * swimV);
    F.u.uAmp.value = amp * (c.wave_scale ?? 1) / F.u.uScale.value;
    const flap = 0.12 + 0.1 * Math.sin(F.t * 2.6);
    for (const pu of F.pecs) { pu.uPhase.value = F.u.uPhase.value; pu.uAmp.value = F.u.uAmp.value; pu.uFlapAngle.value = flap; }
    fillSpine(F);
    F.pos.copy(F.spine[3]);                            // follow / watch point just behind the head
    F.yaw = Math.atan2(F.spine[0].z - F.spine[3].z, -(F.spine[0].x - F.spine[3].x));
    F.proxies.forEach((p, k) => p.position.copy(F.spine[[2, 7, 13][k]]));
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
        uTint: { value: new THREE.Color(0xb7d4d4) }, uSky: { value: new THREE.Color(0xf4f1ea) }, uHalf: { value: new THREE.Vector2(W / 2, D / 2) },
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
          vec2 off = vN.xz * (above ? 0.07 : 0.22);
          vec3 refr = uUseRT > .5 ? texture2D(uRefr, clamp(sUV + off, 0.001, .999)).rgb : uTint;
          vec3 col;
          if (above) {
            float fres = 0.04 + 0.6 * pow(1. - cosT, 5.);
            col = mix(refr * mix(vec3(1.), uTint, .25), uSky, fres);
          } else {
            vec2 rUV = vReflClip.xy / vReflClip.w * .5 + .5;
            vec3 refl = uUseRT > .5 ? texture2D(uRefl, clamp(rUV + off, 0.001, .999)).rgb : uTint * .85;
            float tir = 1. - smoothstep(0.6, 0.72, cosT);
            col = mix(mix(refr, uSky, .35), refl, max(tir, 0.25));
          }
          vec3 L = normalize(vec3(-0.2, 1., 0.45));
          float spec = pow(max(dot(reflect(-L, vN), V), 0.), 90.);
          col += spec * 0.35;
          vec2 edge = uHalf - abs(vW.xz);
          col += 0.18 * (1. - smoothstep(0.0, 0.004, min(edge.x, edge.y)));
          gl_FragColor = vec4(col, uUseRT > .5 ? 1. : 0.28 + 0.4 * (1. - cosT));
          #include <colorspace_fragment>
        }`,
    });
    surface = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.0004, D - 0.0004, STD ? 120 : 60, STD ? 60 : 30), mat);
    surface.rotation.x = -Math.PI / 2; surface.position.y = WL; surface.renderOrder = 3; scene.add(surface);
    return res;
  }
  let surfRes;

  // ---------- camera & views ----------
  const controls = new THREE.OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.minDistance = 0.09; controls.maxDistance = 1.6;
  controls.maxPolarAngle = Math.PI * 0.62; controls.target.set(0, H * 0.4, 0);
  function fitDistance(margin = 1.08) {
    const vFov = THREE.MathUtils.degToRad(camera.fov), hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    return Math.max((W / 2 * margin) / Math.tan(hFov / 2) + D / 2, (H / 2 * margin) / Math.tan(vFov / 2) + D / 2);
  }
  const VIEWS = {
    front: () => [[0, H * 0.43, fitDistance()], [0, H * 0.385, 0]],
    oblique: () => { const d = fitDistance(1.02); return [[d * 0.5, H * 0.43 + d * 0.3, d * 0.78], [0, H * 0.27, 0]]; },
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
    $('watch-name').textContent = F.name;
    $('watch-hold').setAttribute('aria-pressed', 'false'); $('watch-hold').textContent = '止める';
    $('watch-panel').hidden = false;
    controls.minDistance = 0.04;
    const start = LIB.watchStart(F.pos.toArray(), F.yaw, { aspect: camera.aspect, distance: camera.aspect < 1 ? 0.2 : 0.15 });
    if (start.camera[2] > D / 2 - 0.02) start.camera[2] = Math.max(-D / 2 + 0.012, 2 * F.pos.z - start.camera[2]);   // no room in front of the fish: look from behind it
    camera.position.fromArray(start.camera); keepCameraInFront();
    controls.target.fromArray(start.target); lastFishPos.copy(F.pos); controls.update();
    document.body.dataset.watching = '';
    renderer.setClearColor(WATER_CLEAR, 1);      // close up, the view can pass the side glass: show water there, not the page
  }
  function unwatch(resetView) {
    if (watching) watching.hold = false;
    watching = null; $('watch').value = ''; $('watch-panel').hidden = true; controls.minDistance = 0.09;
    delete document.body.dataset.watching;
    renderer.setClearColor(PAGE_CLEAR, 1);
    if (resetView) setView('front');
  }
  function followWatched() {
    if (!watching) return;
    tmpV.fromArray(LIB.followDelta(lastFishPos.toArray(), watching.pos.toArray())); camera.position.add(tmpV); controls.target.add(tmpV); lastFishPos.copy(watching.pos);
    keepCameraInFront();
  }
  const MIN_WATCH = 0.1;                                // closer than this the body is cut by the camera's near plane
  const clampCam = v => { const c = LIB.clampWatchCamera(v.toArray(), { w: W, d: D }); c[2] = Math.min(c[2], D / 2 - 0.01); return v.fromArray(c); };
  function keepCameraInFront() {
    clampCam(camera.position);
    if (!watching || camera.position.distanceTo(controls.target) >= MIN_WATCH) return;
    // the fish is beside a glass wall: step back along the free side (or the other side) instead of squeezing against the fish
    const t = controls.target, v = new THREE.Vector3().copy(camera.position).sub(t); v.y = 0;
    if (v.lengthSq() < 1e-8) v.set(0, 0, 1);
    v.setLength(0.14);
    const perp = new THREE.Vector3(-v.z, 0, v.x), y = camera.position.y;
    for (const d of [v, v.clone().negate(), perp, perp.clone().negate()]) {
      const c = clampCam(new THREE.Vector3(t.x + d.x, y, t.z + d.z));
      if (c.distanceTo(t) >= MIN_WATCH) { camera.position.copy(c); return; }
    }
  }
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
  const ring = new THREE.Mesh(new THREE.RingGeometry(1, 1.08, 48), new THREE.MeshBasicMaterial({ color: 0x2a7f8c, transparent: true, opacity: .8, depthTest: false }));
  ring.rotation.x = -Math.PI / 2; ring.renderOrder = 5; ring.visible = false; scene.add(ring);
  function setMode(m) {
    mode = m; document.body.dataset.mode = m;
    $('mode-view').setAttribute('aria-pressed', m === 'view'); $('mode-edit').setAttribute('aria-pressed', m === 'edit');
    $('edit-panel').hidden = m !== 'edit';
    if (m === 'view') select(null); else { if (watching) unwatch(true); if (!selected) select(approved[0].id); }
    resize();
  }
  $('pos-x').min = -L.tank.w / 2; $('pos-x').max = L.tank.w / 2; $('pos-z').min = -L.tank.d / 2; $('pos-z').max = L.tank.d / 2;
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
    document.querySelectorAll('[data-color]').forEach(b => b.setAttribute('aria-pressed', b.dataset.color === o.colorId));
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
    for (const h of ray.intersectObjects(fishes.flatMap(f => f.proxies), true)) { if (h.object.userData.fishId) { watch(h.object.userData.fishId); return; } }
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
  const BGM_VOL = 'snake-eel-conger-aquarium:bgm-volume';
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
    for (const F of fishes) updateEel(F, F.hold ? dt * 0.12 : dt);
    followWatched();
    controls.update();
    if (STD && surface) renderWaterPasses();
    renderer.render(scene, camera);
  }
  window.__aquarium = { camDist() { return watching ? +camera.position.distanceTo(controls.target).toFixed(3) : null; }, put(id, x, z, h) { const F = fishes.find(f => f.id === id); placeAtSite(F, { pos: [x, z], heading_deg: h }, false); F.base = F.head.clone(); F.state = 'peek'; F.timer = 1e9; F.stage = 0; }, audit(sec) {
      let n = 0, worst = 0; const maxBend = { 'fish-conger': 0, 'fish-snake-eel': 0 };
      for (let i = 0; i < sec * 20; i++) for (const F of fishes) {
        updateEel(F, 0.05);
        for (let k = 1; k < NSP - 1; k++) {           // sharpest bend between neighbouring spine segments
          const a = tmpV.copy(F.spine[k]).sub(F.spine[k - 1]), b = tmpA.copy(F.spine[k + 1]).sub(F.spine[k]);
          const ang = a.angleTo(b) * 180 / Math.PI; if (ang > maxBend[F.id] && k < NSP - 3) { maxBend[F.id] = ang; (window.__worst ??= {})[F.id] = {  raw: F.raw.slice(18).map(v => v.toArray().map(x => +(x * 100).toFixed(2))), poly: [F.head, ...F.pts].filter((_, i) => i % 6 === 0).map(v => v.toArray().map(x => +(x * 100).toFixed(1))).slice(-14), polyLen: (() => { let L2 = 0, q = F.head; for (const r of F.pts) { L2 += q.distanceTo(r); q = r; } return +(L2 * 100).toFixed(1); })(), npts: F.pts.length, id: F.id, k, state: F.state, ang, theta: F.theta, psi: F.psi, head: F.head.toArray(), spine: F.spine.map(v => v.toArray().map(x => +(x * 100).toFixed(2))) }; }
        }
        for (const p of F.spine) {
          if (p.y < ground(p.x, p.z) + 0.004) continue;           // under the sand: not drawn anyway
          const out = Math.max(Math.abs(p.x) - W / 2, Math.abs(p.z) - D / 2);
          if (out > -0.02) { n++; worst = Math.max(worst, out); }
        }
      }
      return { violations: n, worstOutsideCm: +(worst * 100).toFixed(2), maxBendDegPerSegment: maxBend };
    }, watchAudit(id, sec) {            // follow one fish for a while: how close does the camera get, does it leave the tank?
      watch(id); let minD = 9, outside = 0;
      for (let i = 0; i < sec * 20; i++) {
        for (const F of fishes) updateEel(F, 0.05);
        followWatched();
        minD = Math.min(minD, camera.position.distanceTo(controls.target));
        const c = camera.position; if (Math.abs(c.x) > W / 2 || Math.abs(c.z) > D / 2) outside++;
      }
      unwatch(true); return { minDistCm: +(minD * 100).toFixed(1), framesOutside: outside };
    }, sites() { return fishes.map(F => F.cfg.sites.map(s => s.pos.map(v => +v.toFixed(1)))); }, tick(sec) { for (let i = 0; i < sec * 20; i++) for (const F of fishes) updateEel(F, 0.05); }, fishes, state: () => fishes.map(F => ({ id: F.id, state: F.state, head: F.head.toArray() })), watch, setView, setMode, select, editables };

  // ---------- start ----------
  (async () => {
    try {
      say('水槽を準備しています…');
      const [redT, peachT, yellowT] = await Promise.all(['stone-red', 'stone-peach', 'stone-yellow'].map(n => tex(A.textures[n], { repeat: [1, 1] })));
      stoneMats = { red: stoneMaterial(redT, 11), peach: stoneMaterial(peachT, 11), yellow: stoneMaterial(yellowT, 11) };
      await buildTank();
      for (const o of stonesL) await makeStone(o);
      const sel = $('obj-select');
      for (const o of approved) sel.append(new Option(editables.get(o.id).label, o.id));
      if (loadSaved()) flash('前回の配置を読み込みました');
      applyState();
      surfRes = buildWater();
      resize(); setView('front');
      addEventListener('resize', resize);
      say('2匹を呼んでいます…');
      for (const [i, f] of L.fish.entries()) await loadFish(f, i);   // one at a time: lower peak memory on phones
      for (const F of fishes) $('watch').append(new Option('観察：' + F.name, F.id));
      status.hidden = true;
      loop();
    } catch (e) {
      console.error(e);
      say('読み込みに失敗しました。通信状態を確かめて再読み込みしてください。（' + (e.message || e) + '）', true);
    }
  })();
  setMode('view');
})();
