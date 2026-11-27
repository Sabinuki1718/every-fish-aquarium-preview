/* ムツゴロウの干潟水槽 — three.js r170 (window.THREE) + AquariumLib (aquarium-state / mobile-quality / fish-watch).
   Assets come from window.AQUARIUM_ASSETS: relative URLs (published page) or data: URIs (offline file).
   Units: metres. Tank centre on the floor at the origin, front glass +z, left -x. Approved layout: layout v2.
   The mud is one height field (higher at the back); the channel, pools and burrow mouths dip below a flat water
   plane, so water shows only there. Four mudskippers crawl on their pectoral fins, feed, go into their burrows,
   raise and fold their dorsal fins, and leap (coil, launch, arch in the air, land with a splash). */
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
  const QUALITY_KEY = 'mutsugoro-higata-aquarium:quality';
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
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0xe9e8e3, 1);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.005, 10);
  // soft daylight from a hazy sky, a little from the front
  scene.add(new THREE.HemisphereLight(0xf3f5fa, 0x6b5f4e, 1.0));
  const sun = new THREE.DirectionalLight(0xfff1dc, 1.15); sun.position.set(-0.3, 1.2, 0.6); scene.add(sun);

  // ---------- mud height field ----------
  const L = A.layout, cm = 0.01;
  const W = L.tank.w * cm, D = L.tank.d * cm, H = L.tank.h * cm, WL = L.tank.water_level * cm;
  const MP = L.tank.mud_profile;                   // land at the back, shore in the middle, the water's floor at the front
  const smooth = (e0, e1, v) => { const t = Math.max(0, Math.min(1, (v - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  function baseY(x, z) {
    const s = smooth(MP.t0, MP.t1, 0.5 - z / D) ** 0.9;
    return (MP.front_cm + (MP.back_cm - MP.front_cm) * s) * cm + 0.003 * Math.sin(x * 31 + z * 17) + 0.0015 * Math.sin(x * 83 - z * 57);
  }
  // burrows and pools as they are now (the editor moves them): [{id, kind, x, z, r | sx, sz, level}]
  // level: the surface of the puddle at a burrow mouth / of a pool on the land (above the sea's water line)
  let holes = [];
  function mudY(x, z) {
    let y = baseY(x, z);
    for (const o of holes) {
      if (o.kind === 'pool') { const e = Math.hypot((x - o.x) / o.sx, (z - o.z) / o.sz); y = Math.min(y, y - (y - (o.level - 0.011)) * (1 - smooth(0.6, 1.3, e))); }
      else {
        const r = Math.hypot(x - o.x, z - o.z) / o.r;
        y += 0.9 * cm * Math.exp(-(((r - 1.25) / 0.35) ** 2));                    // raised rim of dug-out mud
        y = Math.min(y, y - (y - (o.level - 0.007)) * (1 - smooth(0.55, 1.05, r))); // puddle at the mouth
        if (r < 0.32) y = Math.min(y, o.level - 0.08 + 0.06 * r / 0.32);            // the hole itself
      }
    }
    return y;
  }
  // the water surface over (x, z): the sea in front, or a puddle / pool on the land; null on dry mud
  function waterAt(x, z) {
    const m = mudY(x, z);
    if (m < WL - 0.0005) return WL;
    for (const o of holes) {
      const inside = o.kind === 'pool' ? Math.hypot((x - o.x) / o.sx, (z - o.z) / o.sz) < 1.2 : Math.hypot(x - o.x, z - o.z) < o.r * 1.05;
      if (inside && m < o.level - 0.0005) return o.level;
    }
    return null;
  }
  const inWater = (x, z) => waterAt(x, z) !== null;
  const underSea = (x, z, depth = 0.012) => WL - mudY(x, z) > depth;

  const uTime = { value: 0 };
  const loader = new THREE.TextureLoader();
  const tex = (url, { repeat, srgb = true } = {}) => new Promise((ok, fail) => loader.load(url, t => {
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
    t.anisotropy = STD ? 4 : 1; ok(t);
  }, undefined, () => fail(new Error('画像を読み込めませんでした: ' + url))));
  function seeded(id) { let h = 2166136261; for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) / 4294967296); }

  // below the sea's surface: the muddy water absorbs a little (greener, darker with depth) and the rippling surface
  // throws a moving net of light (caustics) on the floor and on the fish
  const UNDERWATER_GLSL = `uniform float uTime; uniform float uWL;
    float cnet(vec2 p, float t){
      float a = sin(p.x + t * 1.1 + sin(p.y * 0.7 + t * 0.6) * 1.7) * sin(p.y * 1.13 - t * 0.9 + sin(p.x * 0.8 - t * 0.5) * 1.7);
      return pow(1. - abs(a), 6.);
    }
    vec3 underwater(vec3 c, vec3 w){
      if (w.y > uWL) return c;
      float d = clamp((uWL - w.y) / 0.07, 0., 1.);
      vec2 p = w.xz * 52.;
      float k = 0.6 * cnet(p, uTime) + 0.4 * cnet(p * 1.7 + 3.1, uTime * 1.3);
      c *= 1. + 0.32 * k * (1. - 0.4 * d);
      return mix(c, c * vec3(.74, .84, .78), 0.45 + 0.4 * d);
    }
`;
  let mudGeo, skirtGeos = [], mudMat;
  const MUD_TILE = 0.26;                           // one mud image per 26 cm
  function fillMud() {
    const p = mudGeo.attributes.position, c = mudGeo.attributes.color;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), y = mudY(x, z); p.setY(i, y);
      // wetter (darker) toward the water line, darkest under the water
      const wet = waterAt(x, z) !== null ? 1 : 1 - smooth(WL, WL + 0.02, y);
      const k = 1 - 0.22 * wet; c.setXYZ(i, k, k * 0.99, k * 0.97);
    }
    p.needsUpdate = true; c.needsUpdate = true; mudGeo.computeVertexNormals();
    for (const s of skirtGeos) s.fill();
    for (const g of waterSides) g.fill();
  }
  async function buildTank() {
    const [mudT, backT] = await Promise.all([tex(A.textures.mud, { repeat: [W / MUD_TILE, D / MUD_TILE] }), tex(A.textures.background)]);
    // back screen: the mudflat picture, unlit and one-sided (from behind the tank it disappears)
    const back = new THREE.Mesh(new THREE.PlaneGeometry(W, H - 0.05), new THREE.MeshBasicMaterial({ map: backT, side: THREE.FrontSide }));
    back.position.set(0, 0.05 + (H - 0.05) / 2, -D / 2 - 0.002); scene.add(back);
    // a soft sky light for the wet sheen (the picture as a rough environment)
    const pm = new THREE.PMREMGenerator(renderer);
    const envT = backT.clone(); envT.mapping = THREE.EquirectangularReflectionMapping; envT.needsUpdate = true;
    scene.environment = pm.fromEquirectangular(envT).texture; scene.environmentIntensity = 0.4;
    // mud surface
    mudGeo = new THREE.PlaneGeometry(W, D, STD ? 240 : 160, STD ? 120 : 80); mudGeo.rotateX(-Math.PI / 2);
    mudGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(mudGeo.attributes.position.count * 3), 3));
    mudMat = new THREE.MeshStandardMaterial({ map: mudT, vertexColors: true, roughness: 0.38, metalness: 0, side: THREE.DoubleSide });
    // fine glints on the wet mud: a little roughness noise so the sheen breaks up as on a real mudflat
    mudMat.onBeforeCompile = sh => {
      sh.uniforms.uTime = uTime; sh.uniforms.uWL = { value: WL };
      sh.vertexShader = 'varying vec3 vMudW;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\nvMudW = (modelMatrix * vec4(transformed,1.)).xyz;');
      sh.fragmentShader = 'varying vec3 vMudW;\n' + UNDERWATER_GLSL + sh.fragmentShader.replace('#include <opaque_fragment>', 'outgoingLight = underwater(outgoingLight, vMudW);\n#include <opaque_fragment>').replace('#include <map_fragment>', `
        // the mud image at two scales and angles, mixed by a slow noise, so its repeat does not show as bands
        vec2 uvB = mat2(0.8, -0.6, 0.6, 0.8) * vMapUv * 0.61 + vec2(0.37, 0.71);
        float mixK = smoothstep(-0.6, 0.6, sin(vMudW.x * 9.1 + sin(vMudW.z * 7.3) * 1.7) * sin(vMudW.z * 8.3 - vMudW.x * 3.1));
        vec4 mudC = mix(texture2D(map, vMapUv), texture2D(map, uvB), 0.35 + 0.4 * mixK);
        diffuseColor *= mudC;`).replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        float gl = sin(vMudW.x * 233. + sin(vMudW.z * 71. + vMudW.x * 37.) * 3.1) * sin(vMudW.z * 197. - sin(vMudW.x * 53.) * 2.7);
        roughnessFactor = clamp(roughnessFactor + 0.03 * gl, 0.25, 0.9);   // only a faint break-up: the mud image carries the wet sheen`);
    };
    mudMat.customProgramCacheKey = () => 'mud-glint';
    scene.add(new THREE.Mesh(mudGeo, mudMat));
    // the mud is a solid layer: its four cut faces down to the tank floor and its underside
    const cutT = mudT.clone(); cutT.repeat.set(1, 1); cutT.needsUpdate = true;
    const cutMat = new THREE.MeshLambertMaterial({ map: cutT, color: 0x8a7c68, side: THREE.DoubleSide });
    const N = 180;
    const skirt = (x0, z0, x1, z1) => {
      const g = new THREE.BufferGeometry(), P = new Float32Array((N + 1) * 6), UV = [], I = [];
      for (let i = 0; i <= N; i++) {
        const d = Math.hypot((x1 - x0) * i / N, (z1 - z0) * i / N); UV.push(d / MUD_TILE, 0.6, d / MUD_TILE, 0);
        if (i) { const a = (i - 1) * 2; I.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
      g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2)); g.setIndex(I);
      g.fill = () => {
        for (let i = 0; i <= N; i++) { const k = i / N, x = x0 + (x1 - x0) * k, z = z0 + (z1 - z0) * k; P.set([x, mudY(x, z), z, x, 0, z], i * 6); }
        g.attributes.position.needsUpdate = true; g.computeVertexNormals(); g.computeBoundingSphere();
      };
      skirtGeos.push(g); scene.add(new THREE.Mesh(g, cutMat));
    };
    const hw = W / 2 - 0.0004, hd = D / 2 - 0.0004;
    skirt(-hw, hd, hw, hd); skirt(-hw, -hd, hw, -hd); skirt(-hw, -hd, -hw, hd); skirt(hw, -hd, hw, hd);
    const base = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshLambertMaterial({ color: 0x4a4034, side: THREE.DoubleSide }));
    base.rotation.x = -Math.PI / 2; base.position.y = 0.0003; scene.add(base);
    // glass: faint panes and thin edges
    const glassMat = new THREE.MeshBasicMaterial({ color: 0xeef2f2, transparent: true, opacity: 0.05, depthWrite: false, side: THREE.DoubleSide });
    for (const [w, h, x, y, z, ry] of [[W, H, 0, H / 2, D / 2, 0], [D, H, -W / 2, H / 2, 0, Math.PI / 2], [D, H, W / 2, H / 2, 0, Math.PI / 2]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glassMat); m.position.set(x, y, z); m.rotation.y = ry; m.renderOrder = 4; scene.add(m);
    }
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(W, H, D)), new THREE.LineBasicMaterial({ color: 0x7c7b76 }));
    edges.position.y = H / 2; scene.add(edges);
  }

  // ---------- layout state (approved layout -> aquarium-state) ----------
  // aquarium-state knows stones, wood and plants; burrows and pools use its 'wood' slot (transform only, no colour)
  const approved = L.objects.filter(o => o.kind === 'burrow' || o.kind === 'pool').map(o => ({
    id: o.id, kind: 'wood', position: [o.pos[0] * cm, 0, o.pos[2] * cm], rotation: [0, 0, 0],
  }));
  const META = Object.fromEntries(L.objects.map(o => [o.id, o]));
  const LABEL = id => (META[id].kind === 'burrow' ? '巣穴' : '水たまり') + id.split('-')[1];
  const REVISION = 'layout-v' + L.version;
  const SAVE_KEY = 'mutsugoro-higata-aquarium:aquarium:' + REVISION;
  const state = LIB.createAquariumState(approved, { palette: ['none'], revision: REVISION });
  const current = id => state.snapshot().objects.find(o => o.id === id);
  function footprint(id) { const o = META[id]; return o.kind === 'burrow' ? o.radius * 1.6 * cm : Math.max(...o.size) / 2 * cm; }
  function clampPos(id, x, z) {
    const e = footprint(id) + 0.01;
    return [Math.min(W / 2 - e, Math.max(-W / 2 + e, x)), Math.min(D / 2 - e, Math.max(-D / 2 + e, z))];
  }
  function applyState(rebuild = true) {
    holes = state.snapshot().objects.map(s => {
      const o = META[s.id], [x, z] = clampPos(s.id, s.position[0], s.position[2]);
      const level = baseY(x, z) - 0.004;
      return o.kind === 'burrow' ? { id: s.id, kind: 'burrow', x, z, r: o.radius * cm, level } : { id: s.id, kind: 'pool', x, z, sx: o.size[0] * cm / 2, sz: o.size[1] * cm / 2, level };
    });
    updatePuddles();
    if (rebuild && mudGeo) fillMud();
    updatePanel();
  }
  const save = () => store.set(SAVE_KEY, JSON.stringify(state.snapshot()));
  function loadSaved() {
    const raw = store.get(SAVE_KEY); if (!raw) return false;
    try { return state.load(JSON.parse(raw)); } catch { return false; }
  }
  const burrows = () => holes.filter(h => h.kind === 'burrow');

  // ---------- water: one flat plane, seen only where the mud dips below it ----------
  let water, rtRefl, reflCam;
  const reflClip = new THREE.Plane(new THREE.Vector3(0, 1, 0), -WL);
  function buildWater() {
    if (STD) { rtRefl = new THREE.WebGLRenderTarget(2, 2, { depthBuffer: true }); rtRefl.texture.colorSpace = THREE.SRGBColorSpace; reflCam = camera.clone(); }
    const res = new THREE.Vector2();
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTime, uRefl: { value: STD ? rtRefl.texture : null }, uUseRT: { value: STD ? 1 : 0 }, uRes: { value: res }, uReflVP: { value: new THREE.Matrix4() },
        uTint: { value: new THREE.Color(0x857c6c) }, uSky: { value: new THREE.Color(0xdfe5ec) } },
      vertexShader: `
        uniform float uTime; uniform mat4 uReflVP; varying vec3 vW; varying vec3 vN; varying vec4 vRC;
        float wave(vec2 p, float t){ return 0.00025*sin(p.x*70.+t*1.6) + 0.0002*sin(p.y*93.-t*1.3+p.x*13.) + 0.0001*sin((p.x+p.y)*170.+t*2.4); }
        void main(){
          vec4 w = modelMatrix * vec4(position,1.); float e = 0.0005;
          float h = wave(w.xz,uTime), hx = wave(w.xz+vec2(e,0.),uTime), hz = wave(w.xz+vec2(0.,e),uTime);
          w.y += h; vN = normalize(vec3(-(hx-h)/e, 1., -(hz-h)/e)); vW = w.xyz; vRC = uReflVP * w;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: `
        uniform sampler2D uRefl; uniform float uUseRT; uniform vec2 uRes; uniform vec3 uTint; uniform vec3 uSky;
        varying vec3 vW; varying vec3 vN; varying vec4 vRC;
        void main(){
          vec3 V = normalize(cameraPosition - vW);
          float cosT = clamp(dot(V, vN), 0., 1.);
          float fres = 0.1 + 0.7 * pow(1. - cosT, 3.);
          vec3 refl = uSky;
          if (uUseRT > .5) { vec2 s = vRC.xy / vRC.w * .5 + .5; refl = mix(uSky, texture2D(uRefl, clamp(s + vN.xz * 0.04, 0.001, .999)).rgb, 0.85); }
          vec3 Ld = normalize(vec3(-0.3, 1.2, 0.6));
          float spec = pow(max(dot(reflect(-Ld, vN), V), 0.), 220.);
          vec3 col = mix(uTint, refl, fres) + spec * 0.6;
          gl_FragColor = vec4(col, clamp(0.35 + 0.6 * fres, 0., 0.92));
          #include <colorspace_fragment>
        }`,
    });
    water = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.0008, D - 0.0008, 90, 45), mat);
    water.rotation.x = -Math.PI / 2; water.position.y = WL; water.renderOrder = 3; scene.add(water);
    // the body of water seen through the glass: the front and side panes from the mud up to the surface, tinted
    // like the turbid water of the Ariake Sea (where the land is higher than the water line the strip has no height)
    const volMat = new THREE.MeshBasicMaterial({ color: 0x6d7a68, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide });
    const N = 180, hw = W / 2 - 0.0006, hd = D / 2 - 0.0006;
    for (const [x0, z0, x1, z1] of [[-hw, hd, hw, hd], [-hw, -hd, -hw, hd], [hw, -hd, hw, hd]]) {
      const g = new THREE.BufferGeometry(), P = new Float32Array((N + 1) * 6), I = [];
      for (let i = 1; i <= N; i++) { const a = (i - 1) * 2; I.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setIndex(I);
      g.fill = () => {
        for (let i = 0; i <= N; i++) { const k = i / N, x = x0 + (x1 - x0) * k, z = z0 + (z1 - z0) * k; P.set([x, WL, z, x, Math.min(WL, mudY(x, z)), z], i * 6); }
        g.attributes.position.needsUpdate = true; g.computeBoundingSphere();
      };
      g.fill(); waterSides.push(g);
      const m = new THREE.Mesh(g, volMat); m.renderOrder = 3; scene.add(m);
    }
    return res;
  }
  const waterSides = [];
  // puddles at the burrow mouths and the pool on the land: small glossy water discs at their own level
  const puddleMat = new THREE.MeshStandardMaterial({ color: 0x8b8475, roughness: 0.06, metalness: 0, transparent: true, opacity: 0.72, depthWrite: false });
  const puddles = new Map();
  function updatePuddles() {
    for (const h of holes) {
      let m = puddles.get(h.id);
      if (!m) { m = new THREE.Mesh(new THREE.CircleGeometry(1, 48), puddleMat); m.rotation.x = -Math.PI / 2; m.renderOrder = 3; scene.add(m); puddles.set(h.id, m); }
      m.position.set(h.x, h.level, h.z);
      if (h.kind === 'pool') m.scale.set(h.sx * 1.25, h.sz * 1.25, 1); else m.scale.set(h.r * 1.08, h.r * 1.08, 1);
      m.visible = h.level > WL + 0.002;                          // a burrow moved into the sea needs no puddle
    }
  }
  let waterRes;

  // ---------- fish ----------
  // One shader for every part of a fish; the motion values are uniforms (shared program, per-fish values).
  // Order: dorsal fold -> pectoral swing -> tail wave -> lateral curl (C) -> vertical arch, then the model matrix.
  const FISH_HEAD = `
    attribute float aKind; attribute float aBase; attribute vec3 aRoot;
    uniform float uFold1, uFold2, uPecSwing, uPecSpread, uPecAlt, uPecAltSpread, uCurl, uArch, uWaveAmp, uWavePhase, uX0, uLen, uPivot;
    vec2 rot2(vec2 v, float a){ float c = cos(a), s = sin(a); return vec2(v.x * c + v.y * s, -v.x * s + v.y * c); }
    void fishDeform(in vec3 P, in vec3 N, out vec3 oP, out vec3 oN){
      vec3 p = P, n = N;
      // dorsal fins: each column of the fin turns back about its base on the back (fold 0 = raised, 1 = laid flat)
      if (aKind > 0.5 && aKind < 2.5) {
        bool first = aKind < 1.5;
        float f = first ? uFold1 : uFold2, ang = f * (first ? 1.36 : 1.46);
        float h = p.y - aBase;
        if (h > 0.) { float sh = h * (1. - (first ? 0.3 : 0.08) * f); p.x += sh * sin(ang); p.y = aBase + sh * cos(ang); n.xy = rot2(n.xy, -ang); }
      }
      // pectoral 'arms': swing fore and aft about the root (crutching), and spread / tuck about the long axis
      if (aKind > 2.5) {
        vec3 d = p - aRoot; float side = sign(aRoot.z);
        // uPecAlt / uPecAltSpread: the same stroke on both sides but half a beat apart (left and right alternate)
        float sw = uPecSwing + side * uPecAlt, spr = uPecSpread + side * uPecAltSpread;
        d.xy = rot2(d.xy, sw); n.xy = rot2(n.xy, sw);
        float b = -spr * side; d.yz = rot2(d.yz, -b); n.yz = rot2(n.yz, -b);
        p = aRoot + d;
      }
      float s = clamp((P.x - uX0) / uLen, 0., 1.);
      p.z += uWaveAmp * pow(smoothstep(0.25, 1., s), 1.3) * sin(uWavePhase - s * 5.5);
      // lateral curl about the pivot: the body follows a circular arc (C shape when coiling for a jump)
      if (abs(uCurl) > 0.05) {
        float ph = uCurl * (p.x - uPivot), c = cos(ph), sn = sin(ph);
        p = vec3(uPivot + sn / uCurl - p.z * sn, p.y, (1. - c) / uCurl + p.z * c);
        n.xz = vec2(n.x * c - n.z * sn, n.x * sn + n.z * c);
      }
      // vertical arch (head and tail up for positive values)
      if (abs(uArch) > 0.05) {
        float ph = uArch * (p.x - uPivot), c = cos(ph), sn = sin(ph);
        p = vec3(uPivot + sn / uArch - p.y * sn, (1. - c) / uArch + p.y * c, p.z);
        n.xy = vec2(n.x * c - n.y * sn, n.x * sn + n.y * c);
      }
      oP = p; oN = normalize(n);
    }
`;
  const FLOOR_CLIP = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.001);
  renderer.localClippingEnabled = true;
  function fishMaterial(map, u) {
    // a fish going down its burrow is hidden by the mud around it; anything below the tank floor is never drawn
    const m = new THREE.MeshLambertMaterial({ map, side: THREE.DoubleSide, clippingPlanes: [FLOOR_CLIP] });
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, u);
      sh.uniforms.uTime = uTime; sh.uniforms.uWL = { value: WL };
      sh.vertexShader = FISH_HEAD + 'varying vec3 vFishW;\n' + sh.vertexShader
        .replace('#include <beginnormal_vertex>', 'vec3 fishP; vec3 fishN; fishDeform(position, normal, fishP, fishN);\nvec3 objectNormal = fishN;')
        .replace('#include <begin_vertex>', 'vec3 transformed = fishP;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvFishW = (modelMatrix * vec4(transformed, 1.)).xyz;');
      sh.fragmentShader = 'varying vec3 vFishW;\n' + UNDERWATER_GLSL + sh.fragmentShader
        .replace('#include <opaque_fragment>', 'outgoingLight = underwater(outgoingLight, vFishW);\n#include <opaque_fragment>');
    };
    m.customProgramCacheKey = () => 'mudskipper';
    return m;
  }
  async function loadModel(key) {
    const M = A.models[key];
    const res = await fetch(M.geometry);
    if (!res.ok) throw new Error('モデルを読み込めませんでした: ' + M.geometry);
    const data = await res.json();
    const map = await tex(M[quality.name === 'light' ? 'light' : 'standard']);
    map.flipY = false;                                       // glTF-style UVs (v = 0 at the top of the atlas)
    const parts = [], box = new THREE.Box3();
    for (const m of data.meshes) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(m.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(m.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(m.uv, 2));
      g.setIndex(m.i); g.computeBoundingBox(); box.union(g.boundingBox);
      parts.push({ name: m.name, g });
    }
    // motion attributes: which part a vertex belongs to, the fin base under each dorsal column, the pectoral roots
    const baseFrom = g => {
      // the fin's attachment line on the back: a straight line through the lowest point of each column where the
      // fin meets the body (columns of a lobe hanging free over the back are left out, so they fold about the back too)
      const p = g.attributes.position, bb = g.boundingBox, n = 48, lo = new Array(n).fill(Infinity);
      const bin = x => Math.min(n - 1, Math.max(0, Math.floor((x - bb.min.x) / (bb.max.x - bb.min.x) * n)));
      for (let i = 0; i < p.count; i++) { const b = bin(p.getX(i)); lo[b] = Math.min(lo[b], p.getY(i)); }
      const xs = [], ys = [], cx = b => bb.min.x + (b + 0.5) / n * (bb.max.x - bb.min.x);
      const floor = Math.min(...lo), span = bb.max.y - bb.min.y;
      for (let b = 0; b < n; b++) if (isFinite(lo[b])) {
        // attached columns follow the back's slope: within a band above the lowest point that grows along the fin
        const band = 0.04 * span + Math.abs(cx(b) - bb.min.x) * 0.12;
        if (lo[b] - floor < band) { xs.push(cx(b)); ys.push(lo[b]); }
      }
      const mx = xs.reduce((a, v) => a + v, 0) / xs.length, my = ys.reduce((a, v) => a + v, 0) / ys.length;
      let sxy = 0, sxx = 0; xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; });
      const slope = sxx > 0 ? sxy / sxx : 0;
      return x => my + slope * (x - mx);
    };
    const d1 = parts.find(P => P.name === 'dorsal1'), d2 = parts.find(P => P.name === 'dorsal2');
    const base1 = baseFrom(d1.g), base2 = baseFrom(d2.g);
    for (const P of parts) {
      const p = P.g.attributes.position, n = p.count;
      const kind = new Float32Array(n), base = new Float32Array(n), root = new Float32Array(n * 3);
      const k = P.name === 'dorsal1' || /^filament/.test(P.name) ? 1 : P.name === 'dorsal2' ? 2 : /^pectoral/.test(P.name) ? 3 : 0;
      let rx = 0, ry = 0, rz = 0;
      if (k === 3) {                      // root: the middle of the topmost 15 % of the fin (the muscular base)
        const bb = P.g.boundingBox, cut = bb.max.y - 0.15 * (bb.max.y - bb.min.y); let c = 0;
        for (let i = 0; i < n; i++) if (p.getY(i) >= cut) { rx += p.getX(i); ry += p.getY(i); rz += p.getZ(i); c++; }
        rx /= c; ry /= c; rz /= c;
      }
      for (let i = 0; i < n; i++) {
        kind[i] = k;
        if (k === 1) base[i] = base1(p.getX(i)); else if (k === 2) base[i] = base2(p.getX(i));
        if (k === 3) root.set([rx, ry, rz], i * 3);
      }
      P.g.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
      P.g.setAttribute('aBase', new THREE.BufferAttribute(base, 1));
      P.g.setAttribute('aRoot', new THREE.BufferAttribute(root, 3));
    }
    return { parts, map, box };
  }

  // shadow under each fish: a soft dark blot that shrinks and fades as the fish leaves the mud
  const shadowTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    const r = g.createRadialGradient(32, 32, 2, 32, 32, 31); r.addColorStop(0, 'rgba(30,24,16,0.55)'); r.addColorStop(1, 'rgba(30,24,16,0)');
    g.fillStyle = r; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
  })();

  const fishes = [];
  let model = null;
  async function addFish(f, idx) {
    model ??= await loadModel(f.model);
    const { parts, map, box } = model;
    const len = box.max.x - box.min.x, k = f.length_cm * cm / len;
    const u = {
      uFold1: { value: 1 }, uFold2: { value: 1 }, uPecSwing: { value: 0 }, uPecSpread: { value: 0 }, uPecAlt: { value: 0 }, uPecAltSpread: { value: 0 },
      uCurl: { value: 0 }, uArch: { value: 0 }, uWaveAmp: { value: 0 }, uWavePhase: { value: 0 },
      uX0: { value: box.min.x }, uLen: { value: len }, uPivot: { value: box.min.x + len * 0.42 },
    };
    const mat = fishMaterial(map, u);
    const mdl = new THREE.Group();
    for (const P of parts) { const mesh = new THREE.Mesh(P.g, mat); mesh.name = P.name; mesh.frustumCulled = false; mdl.add(mesh); }
    mdl.scale.setScalar(k);
    // support points (scaled model space): the lowest points of both pectoral fans (front), the pelvic disc (middle)
    // and the lowest point of the tail fins (rear)
    const low = (names, filt = () => true) => {
      let best = null;
      for (const P of parts) if (names.test(P.name)) {
        const p = P.g.attributes.position;
        for (let i = 0; i < p.count; i++) if (filt(p.getX(i)) && (!best || p.getY(i) < best[1])) best = [p.getX(i), p.getY(i), p.getZ(i)];
      }
      return best.map(v => v * k);
    };
    const sup = {
      front: [low(/^pectoral_left/), low(/^pectoral_right/)],
      mid: low(/^pelvic_disc/),
      rear: low(/^(anal|caudal)$/, x => x > box.min.x + len * 0.8),
    };
    const root = new THREE.Group(), tilt = new THREE.Group();
    tilt.add(mdl); root.add(tilt); scene.add(root);
    root.userData.fish = f.id;
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.renderOrder = 1; scene.add(shadow);
    const F = { id: f.id, f, idx, root, tilt, mdl, u, sup, len: f.length_cm * cm, shadow, rnd: seeded('mutsu-' + f.id),
      x: f.pos[0] * cm, z: f.pos[2] * cm, y: 0, yaw: (f.heading_deg || 0) * Math.PI / 180, pitch: 0, roll: 0, lift: 0,
      state: 'rest', t: 0, dur: 2, fold: 1, fold2: 1, swing: 0, spread: 0, curl: 0, arch: 0, wave: 0, wavePhase: 0, squash: 1,
      hold: false, jumps: 0 };
    F.home = nearestBurrow(F.x, F.z)?.id;
    fishes.push(F);
    const sel = $('watch-select'); sel.append(new Option(`観察：ムツゴロウ ${fishes.length}`, f.id));
    // the layout's opening poses
    if (/ジャンプ/.test(f.note)) startDisplay(F, 1.2, true);
    else if (/巣穴/.test(f.note)) setState(F, 'rest', 3 + 3 * F.rnd());
    else if (/なめ取る/.test(f.note)) setState(F, 'feed', 4 + 3 * F.rnd());
    else if (/泳ぐ/.test(f.note)) startCrawl(F, randomTarget(F, 'water'));
    else if (/水際/.test(f.note)) setState(F, 'rest', 3 + 3 * F.rnd());
    else startCrawl(F, randomTarget(F));
    settle(F, 1);
  }

  const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
  const lerp = (a, b, k) => a + (b - a) * k;
  const approach = (v, goal, rate, dt) => v + (goal - v) * Math.min(1, rate * dt);
  const XMAX = W / 2 - 0.09, ZMIN = -D / 2 + 0.055, ZMAX = D / 2 - 0.06;
  const inside = (x, z) => [Math.min(XMAX, Math.max(-XMAX, x)), Math.min(ZMAX, Math.max(ZMIN, z))];
  function nearestBurrow(x, z) { let b = null, d = 1e9; for (const h of burrows()) { const e = Math.hypot(h.x - x, h.z - z); if (e < d) d = e, b = h; } return b; }
  const SHORE_Z = (() => { let z = -D / 2; while (z < D / 2 && baseY(0, z) > WL) z += 0.002; return z; })();   // where the land meets the water
  function randomTarget(F, where) {
    // on the land (mostly near where it is, often along the water's edge) or out in the water, away from the other fish
    where ??= F.rnd() < 0.33 ? 'water' : 'land';
    for (let tries = 0; tries < 24; tries++) {
      let x, z;
      if (where === 'water') { x = (F.rnd() - 0.5) * 2 * XMAX; z = SHORE_Z + 0.05 + F.rnd() * (ZMAX - SHORE_Z - 0.05); }
      else if (F.rnd() < 0.35) { x = (F.rnd() - 0.5) * 2 * XMAX; z = SHORE_Z - 0.01 - 0.03 * F.rnd(); }
      else { const a = F.rnd() * Math.PI * 2, r = 0.06 + 0.16 * F.rnd(); x = F.x + Math.cos(a) * r; z = Math.min(F.z + Math.sin(a) * r * 0.6, SHORE_Z - 0.02); }
      [x, z] = inside(x, z);
      if (fishes.every(o => o === F || Math.hypot(o.x - x, o.z - z) > 0.12)) return { x, z };
    }
    return { x: F.x, z: F.z };
  }

  // rest height and body tilt from the mud under the support points: the pectoral fans and the tail touch the mud
  const qT = new THREE.Quaternion(), eT = new THREE.Euler(), vT = new THREE.Vector3();
  function restPose(F, x, z, yaw, pitch0 = 0) {
    let pitch = pitch0, y = 0;
    for (let it = 0; it < 3; it++) {
      qT.setFromEuler(eT.set(0, yaw, pitch, 'YXZ'));
      const need = p => { vT.set(...p).applyQuaternion(qT); return { r: mudY(x + vT.x, z + vT.z) - vT.y, x: vT.x, z: vT.z }; };
      const f = F.sup.front.map(need), m = need(F.sup.mid), r = need(F.sup.rear);
      const front = Math.max(f[0].r, f[1].r);
      y = Math.max(front, m.r, r.r) + 0.0004;
      const dx = Math.hypot((f[0].x + f[1].x) / 2 - r.x, (f[0].z + f[1].z) / 2 - r.z);
      pitch = THREE.MathUtils.clamp(pitch + Math.atan2(r.r - front, dx) * 0.9, -0.5, 0.4);
    }
    return { y, pitch };
  }
  function settle(F, k) {
    const P = restPose(F, F.x, F.z, F.yaw, F.pitch);
    F.y = lerp(F.y, P.y, k); F.restPitch = P.pitch;
    return P;
  }
  function setState(F, s, dur) { F.state = s; F.t = 0; F.dur = dur; }
  function startCrawl(F, target, then) { F.target = target; F.then = then || null; F.stepPhase = 0; F.stepT = 0.38 + 0.12 * F.rnd(); F.stride = 0.014 + 0.006 * F.rnd(); setState(F, 'crawl', 30); }
  function startDisplay(F, dur, thenJump) { F.thenJump = thenJump; setState(F, 'display', dur); }
  function startJump(F) {
    const h = (0.09 + 0.09 * F.rnd()) * (F.jumps ? 0.75 : 1);                 // up to about one body length
    const turn = (F.rnd() - 0.5) * 2.2, adv = 0.01 + 0.05 * F.rnd();
    const yaw1 = F.yaw + turn, dir = F.yaw + turn * 0.5;
    let [x1, z1] = inside(F.x - Math.cos(dir) * adv, F.z + Math.sin(dir) * adv);
    F.jump = { h, x0: F.x, z0: F.z, y0: F.y, x1, z1, yaw0: F.yaw, yaw1, side: F.rnd() < 0.5 ? -1 : 1, T: 2 * Math.sqrt(2 * h / 9.81) * 1.08 };
    setState(F, 'coil', 0.16);
  }
  // what the user asked for with the 背鰭 buttons: 'auto' follows the behaviour, otherwise held open / closed
  let finMode = 'auto';
  const finWant = F => finMode === 'open' ? 0 : finMode === 'closed' ? 1 :
    ({ display: 0, coil: 0, air: 0, land: 0, after: 0, alert: 0.45 })[F.state] ?? 1;

  // ---------- splashes: mud droplets and a spreading ring where a fish lands ----------
  const DROPS = 260;
  const dropPos = new Float32Array(DROPS * 3), dropVel = new Float32Array(DROPS * 3), dropLife = new Float32Array(DROPS), dropWet = new Float32Array(DROPS);
  let dropNext = 0, drops;
  function buildSplashes() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(dropPos, 3)); g.setAttribute('aLife', new THREE.BufferAttribute(dropLife, 1)); g.setAttribute('aWet', new THREE.BufferAttribute(dropWet, 1));
    drops = new THREE.Points(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, uniforms: { uScale: { value: 1 } },
      vertexShader: `uniform float uScale; attribute float aLife; attribute float aWet; varying float vL; varying float vWet;
        void main(){ vL = aLife; vWet = aWet; vec4 mv = modelViewMatrix * vec4(position,1.); gl_Position = projectionMatrix * mv;
          gl_PointSize = aLife > 0. ? uScale * (0.0016 + 0.0012 * aWet) / -mv.z : 0.; }`,
      fragmentShader: `varying float vL; varying float vWet; void main(){ float d = length(gl_PointCoord - .5); if (vL <= 0. || d > .5) discard;
        vec3 c = mix(vec3(.36,.30,.22), vec3(.78,.80,.80), vWet); gl_FragColor = vec4(c, min(1., vL * 2.) * smoothstep(.5, .2, d)); }`,
    }));
    drops.frustumCulled = false; scene.add(drops);
  }
  const rings = [];
  function splash(x, z, strength) {
    const y = mudY(x, z), ws = waterAt(x, z), wet = ws !== null ? 1 : 0;
    for (let i = 0; i < Math.round(26 * strength); i++) {
      const j = dropNext = (dropNext + 1) % DROPS, a = Math.random() * Math.PI * 2, sp = (0.25 + 0.55 * Math.random()) * strength;
      dropPos.set([x + Math.cos(a) * 0.012, (wet ? ws : y) + 0.002, z + Math.sin(a) * 0.012], j * 3);
      dropVel.set([Math.cos(a) * sp * 0.6, (0.6 + 0.9 * Math.random()) * strength, Math.sin(a) * sp * 0.6], j * 3);
      dropLife[j] = 0.5 + 0.4 * Math.random(); dropWet[j] = wet ? 0.6 + 0.4 * Math.random() : Math.random() * 0.25;
    }
    let r = rings.find(r => r.life <= 0);
    if (!r) {
      r = { mesh: new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 48), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false })), life: 0 };
      r.mesh.rotation.x = -Math.PI / 2; r.mesh.renderOrder = 2; scene.add(r.mesh); rings.push(r);
    }
    r.life = 1; r.wet = wet; r.mesh.position.set(x, (wet ? ws : y) + 0.0012, z); r.mesh.visible = true;
    r.mesh.material.color.set(wet ? 0xe8eef0 : 0x3b3126);
  }
  function updateSplashes(dt) {
    for (let j = 0; j < DROPS; j++) {
      if (dropLife[j] <= 0) continue;
      dropVel[j * 3 + 1] -= 9.81 * dt;
      for (let a = 0; a < 3; a++) dropPos[j * 3 + a] += dropVel[j * 3 + a] * dt;
      const x = dropPos[j * 3], z = dropPos[j * 3 + 2];
      if (dropPos[j * 3 + 1] < Math.max(mudY(x, z), waterAt(x, z) ?? 0)) dropLife[j] = 0; else dropLife[j] -= dt;
    }
    drops.geometry.attributes.position.needsUpdate = true; drops.geometry.attributes.aLife.needsUpdate = true; drops.geometry.attributes.aWet.needsUpdate = true;
    for (const r of rings) {
      if (r.life <= 0) continue;
      r.life -= dt * 0.9; const k = 1 - r.life;
      r.mesh.scale.setScalar(0.012 + 0.07 * k); r.mesh.material.opacity = Math.max(0, r.life) * (r.wet ? 0.7 : 0.35);
      if (r.life <= 0) r.mesh.visible = false;
    }
  }

  // ---------- behaviour ----------
  function nextAfterRest(F) {
    const roll = F.rnd(), b = burrows().find(h => h.id === F.home) || nearestBurrow(F.x, F.z);
    if (underSea(F.x, F.z)) {                    // in the water: swim somewhere, or back up onto the land
      if (roll < 0.55) startCrawl(F, randomTarget(F, 'land')); else if (roll < 0.85) startCrawl(F, randomTarget(F, 'water')); else setState(F, 'rest', 2 + 3 * F.rnd());
      return;
    }
    if (roll < 0.38) startCrawl(F, randomTarget(F));
    else if (roll < 0.6) setState(F, 'feed', 3 + 4 * F.rnd());
    else if (roll < 0.78) startDisplay(F, 1.0 + 1.5 * F.rnd(), F.rnd() < 0.8);
    else if (roll < 0.9 && b) {                                             // go home and down the burrow
      F.home = b.id; const a = Math.atan2(F.z - b.z, F.x - b.x);
      startCrawl(F, { x: b.x + Math.cos(a) * b.r * 1.1, z: b.z + Math.sin(a) * b.r * 1.1 }, 'burrow');
    } else setState(F, 'alert', 1.5 + 2 * F.rnd());
  }
  function updateFish(F, dt, t) {
    if (F.hold && !['air', 'coil'].includes(F.state)) { poseFish(F, dt, t); return; }    // 止める: frozen in place, fins still breathe
    F.t += dt;
    let pitchGoal = F.restPitch ?? 0, liftGoal = 0, swingGoal = 0.05, spreadGoal = 0, curlGoal = 0, archGoal = 0, waveGoal = 0, yawOff = 0;
    switch (F.state) {
      case 'rest': case 'alert': {
        settle(F, Math.min(1, dt * 8));
        swingGoal = 0.05 + 0.03 * Math.sin(t * 1.3 + F.idx); spreadGoal = 0.05;
        if (F.state === 'alert') { pitchGoal -= 0.12; liftGoal = 0.003; }
        if (F.t > F.dur) nextAfterRest(F);
        break;
      }
      case 'crawl': {
        const dx = F.target.x - F.x, dz = F.target.z - F.z, dist = Math.hypot(dx, dz);
        if (underSea(F.x, F.z, 0.014)) {
          // swimming: steady tail beats and fluttering pectorals, gliding a little above the floor
          F.swimming = true;
          const want = Math.atan2(dz, -dx);
          F.yaw += THREE.MathUtils.clamp(angDiff(want, F.yaw), -2.6 * dt, 2.6 * dt);
          const sp = Math.min(dist, dt * 0.075 * Math.max(0.35, Math.cos(angDiff(want, F.yaw))));
          const [nx, nz] = inside(F.x - Math.cos(F.yaw) * sp, F.z + Math.sin(F.yaw) * sp); F.x = nx; F.z = nz;
          const P = restPose(F, F.x, F.z, F.yaw, 0);
          F.y = approach(F.y, Math.min(P.y + 0.007, WL - 0.008), 4, dt); F.restPitch = 0;
          pitchGoal = 0; waveGoal = 0.011; curlGoal = 2.5 * angDiff(want, F.yaw);
          // pectorals laid back along the body, moving only slightly as a goby swims: a slow, small lift away from
          // the body and back (about 1.2 per second), barely noticeable; the two sides slightly out of step
          F.pecPhase = (F.pecPhase || 0) + dt * 2 * Math.PI * 1.2;
          swingGoal = -0.72; spreadGoal = 0.0 + 0.05 * Math.sin(F.pecPhase);
          F.pecAltGoal = 0.02 * Math.sin(F.pecPhase + 0.9); F.pecAltSpreadGoal = 0.02 * Math.cos(F.pecPhase);
          F.wavePhase += dt * 2 * Math.PI * 3.2;
          if (dist < 0.008 || F.t > F.dur) setState(F, 'rest', 1.5 + 3 * F.rnd());
          break;
        }
        F.swimming = false;
        // crutching on the pectoral fins: plant and push (the body lifts and slides forward), then swing the fins forward
        const prev = F.stepPhase; F.stepPhase += dt / F.stepT;
        const ph = F.stepPhase % 1, push = ph < 0.42;
        const P = s => s < 0.42 ? smooth(0, 1, s / 0.42) : 1;
        let adv = (Math.floor(F.stepPhase) - Math.floor(prev)) + P(ph) - P(prev % 1);
        if (dist > 0.004) {
          const want = Math.atan2(dz, -dx);
          if (push) F.yaw += THREE.MathUtils.clamp(angDiff(want, F.yaw), -2.4 * dt, 2.4 * dt);
          const step = Math.min(dist, adv * F.stride * Math.max(0.3, Math.cos(angDiff(want, F.yaw))));
          F.x -= Math.cos(F.yaw) * step; F.z += Math.sin(F.yaw) * step;
        }
        settle(F, Math.min(1, dt * 12));
        liftGoal = push ? 0.004 * Math.sin(Math.PI * ph / 0.42) : 0;
        swingGoal = push ? lerp(0.5, -0.38, smooth(0, 1, ph / 0.42)) : lerp(-0.38, 0.5, smooth(0, 1, (ph - 0.42) / 0.58));
        spreadGoal = push ? 0.05 : 0.28 * Math.sin(Math.PI * (ph - 0.42) / 0.58);
        waveGoal = 0.004; F.wavePhase += dt * 2 * Math.PI / F.stepT;
        pitchGoal -= push ? 0.06 * Math.sin(Math.PI * ph / 0.42) : 0;
        if (dist < 0.006 || F.t > F.dur) {
          if (F.then === 'burrow') { const b = burrows().find(h => h.id === F.home); if (b) { F.burrow = b; setState(F, 'enter', 1.7); break; } }
          setState(F, 'rest', 1.5 + 4 * F.rnd());
        }
        break;
      }
      case 'feed': {
        // grazing the diatom film: head low, sweeping from side to side, inching forward now and then
        settle(F, Math.min(1, dt * 8));
        const sw = Math.sin(t * 2 * Math.PI * 1.25 + F.idx);
        yawOff = 0.2 * sw; curlGoal = 3.5 * sw; pitchGoal += 0.07;
        swingGoal = 0.12; spreadGoal = 0.02;
        if (F.rnd() < dt * 0.5) { const [x, z] = inside(F.x - Math.cos(F.yaw) * 0.006, F.z + Math.sin(F.yaw) * 0.006); F.x = x; F.z = z; }
        if (F.t > F.dur) setState(F, 'rest', 1 + 3 * F.rnd());
        break;
      }
      case 'display': {
        // fins up, head raised high on straightened pectorals: the courtship / threat posture before a leap
        settle(F, Math.min(1, dt * 8));
        pitchGoal -= 0.28; liftGoal = 0.006; swingGoal = -0.15; spreadGoal = 0.12;
        if (F.t > F.dur) { if (F.thenJump) startJump(F); else setState(F, 'rest', 2 + 2 * F.rnd()); }
        break;
      }
      case 'coil': {
        // the body curls into a C (tail toward the head), pressing on the mud
        const J = F.jump, k = smooth(0, 1, F.t / F.dur);
        curlGoal = 24 * J.side * k; pitchGoal -= 0.35; swingGoal = -0.25; spreadGoal = 0.1; liftGoal = 0;
        F.curl = curlGoal;                                         // fast: no smoothing lag
        if (F.t >= F.dur) { setState(F, 'air', J.T); F.wave = 0.02; F.wavePhase = 0; }
        break;
      }
      case 'air': {
        // the tail snaps the coil straight: a ballistic leap, nose up at take-off, arched in mid-air, turning, nose down to land
        const J = F.jump, s = Math.min(1, F.t / J.T);
        const end = restPose(F, J.x1, J.z1, J.yaw1).y;
        F.x = lerp(J.x0, J.x1, s); F.z = lerp(J.z0, J.z1, s);
        F.y = lerp(J.y0, end, s) + 4 * J.h * s * (1 - s);
        F.yaw = J.yaw0 + angDiff(J.yaw1, J.yaw0) * smooth(0, 1, s);
        F.curl = 24 * J.side * Math.max(0, 1 - s / 0.06) - 9 * J.side * Math.sin(Math.PI * Math.min(1, s / 0.3)) * (s < 0.3 ? 1 : 0);
        archGoal = 7 * Math.sin(Math.PI * s); F.arch = archGoal;
        F.pitch = lerp(-1.0, 0.1, s); F.roll = 0.55 * J.side * Math.sin(Math.PI * s);
        swingGoal = -0.6; spreadGoal = 0.55; waveGoal = 0.012 * (1 - s); F.wavePhase += dt * 40;
        if (s >= 1) { splash(F.x, F.z, 0.8 + J.h * 3); F.squash = 0.84; F.curl = 0; setState(F, 'land', 0.22); }
        poseFish(F, dt, t, true); return;
      }
      case 'land': {
        settle(F, Math.min(1, dt * 20));
        swingGoal = 0.2; spreadGoal = 0.25; waveGoal = 0.006; F.wavePhase += dt * 30;
        if (F.t > F.dur) {
          // males often leap again straight away
          if (F.jumps < 2 && F.rnd() < 0.35) { F.jumps++; startDisplay(F, 0.35 + 0.4 * F.rnd(), true); }
          else { F.jumps = 0; setState(F, 'after', 1.2 + 1.5 * F.rnd()); }
        }
        break;
      }
      case 'after': {
        settle(F, Math.min(1, dt * 8)); pitchGoal -= 0.15; liftGoal = 0.003; spreadGoal = 0.08;
        if (F.t > F.dur) setState(F, 'rest', 2 + 3 * F.rnd());
        break;
      }
      case 'enter': {
        // turn to the hole, tip nose-down and slide in; the mud around the mouth hides the body as it goes
        const B = F.burrow, s = smooth(0, 1, F.t / F.dur);
        if (!F.enter0) F.enter0 = { x: F.x, z: F.z, y: F.y, yaw: F.yaw };
        const E = F.enter0, want = Math.atan2(B.z - E.z, -(B.x - E.x));
        F.yaw = E.yaw + angDiff(want, E.yaw) * Math.min(1, s * 2.5);
        F.x = lerp(E.x, B.x - Math.cos(want) * 0.02, s); F.z = lerp(E.z, B.z + Math.sin(want) * 0.02, s);
        F.y = E.y - 0.13 * smooth(0.25, 1, s);
        F.pitch = lerp(F.restPitch ?? 0, 0.95, smooth(0.1, 0.6, s)); F.roll = 0;
        waveGoal = 0.008; F.wavePhase += dt * 18; swingGoal = -0.5; spreadGoal = -0.1;
        if (F.t >= F.dur) { F.enter0 = null; setState(F, 'hidden', 3 + 7 * F.rnd()); }
        poseFish(F, dt, t, true); return;
      }
      case 'hidden': {
        const B = burrows().find(h => h.id === F.home);
        F.y = B ? mudY(B.x, B.z) - 0.06 : 0.02;
        if (B) { F.x = B.x; F.z = B.z; }
        if (F.t > F.dur && B) { F.yaw = F.rnd() * Math.PI * 2; F.burrow = B; setState(F, 'exit', 1.5); }
        poseFish(F, dt, t, true); return;
      }
      case 'exit': {
        const B = F.burrow, s = smooth(0, 1, F.t / F.dur);
        const ox = B.x - Math.cos(F.yaw) * B.r * 0.9, oz = B.z + Math.sin(F.yaw) * B.r * 0.9;
        const P = restPose(F, ox, oz, F.yaw);
        F.x = lerp(B.x, ox, s); F.z = lerp(B.z, oz, s);
        F.y = lerp(P.y - 0.12, P.y, smooth(0, 0.85, s)); F.pitch = lerp(-0.9, P.pitch, smooth(0.3, 1, s)); F.roll = 0;
        waveGoal = 0.008; F.wavePhase += dt * 18; swingGoal = 0.4 * Math.sin(t * 12); spreadGoal = 0.2;
        if (F.t >= F.dur) setState(F, 'alert', 1.5 + 2 * F.rnd());
        poseFish(F, dt, t, true); return;
      }
    }
    if (!(F.state === 'crawl' && F.swimming)) F.pecAltGoal = F.pecAltSpreadGoal = 0;
    F.pecAlt = approach(F.pecAlt || 0, F.pecAltGoal || 0, 18, dt); F.pecAltSpread = approach(F.pecAltSpread || 0, F.pecAltSpreadGoal || 0, 18, dt);
    const swimming = F.state === 'crawl' && F.swimming;
    F.pitch = approach(F.pitch, pitchGoal, 6, dt); F.roll = approach(F.roll, 0, 6, dt);
    F.lift = approach(F.lift, liftGoal, 10, dt);
    F.swing = approach(F.swing, swingGoal, 12, dt); F.spread = approach(F.spread, spreadGoal, swimming ? 20 : 10, dt);
    if (F.state !== 'coil') F.curl = approach(F.curl, curlGoal, 8, dt);
    F.arch = approach(F.arch, archGoal, 8, dt); F.wave = approach(F.wave, waveGoal, 6, dt);
    F.yawOff = approach(F.yawOff || 0, yawOff, 10, dt);
    poseFish(F, dt, t);
  }
  function poseFish(F, dt, t, direct) {
    if (direct) {
      F.swing = approach(F.swing, F.state === 'air' ? -0.6 : F.swing, 14, dt);
      F.spread = approach(F.spread, F.state === 'air' ? 0.55 : 0.1, 10, dt);
      F.wave = approach(F.wave, 0.006, 4, dt); F.arch = F.state === 'air' ? F.arch : approach(F.arch, 0, 8, dt);
      if (F.state !== 'air') F.curl = approach(F.curl, 0, 8, dt);
      F.yawOff = 0;
    }
    // dorsal fins: raised quickly (a flick), folded more slowly; the second fin follows the first
    const want = finWant(F);
    F.fold = approach(F.fold, want, want < F.fold ? 14 : 3.2, dt);
    F.fold2 = approach(F.fold2, want, want < F.fold2 ? 9 : 2.4, dt);
    F.squash = approach(F.squash, 1, 9, dt);
    F.root.visible = F.state !== 'hidden';
    F.root.position.set(F.x, F.y + F.lift, F.z); F.root.rotation.set(0, F.yaw + (F.yawOff || 0), 0);
    F.tilt.rotation.set(F.roll, 0, F.pitch); F.tilt.scale.set(1, F.squash, 1 + (1 - F.squash) * 0.5);
    const u = F.u;
    u.uFold1.value = F.fold; u.uFold2.value = F.fold2; u.uPecSwing.value = F.swing; u.uPecSpread.value = F.spread; u.uPecAlt.value = F.pecAlt || 0; u.uPecAltSpread.value = F.pecAltSpread || 0;
    u.uCurl.value = F.curl; u.uArch.value = F.arch; u.uWaveAmp.value = F.wave; u.uWavePhase.value = F.wavePhase;
    // shadow on the mud under the fish (gone while it is inside the burrow)
    const g = mudY(F.x, F.z), up = Math.max(0, F.y - g - 0.004);
    F.shadow.visible = F.state !== 'hidden';
    F.shadow.position.set(F.x, g + 0.0015, F.z);
    F.shadow.rotation.z = F.yaw; const sc = F.len * (0.9 + up * 3);
    F.shadow.scale.set(sc, F.len * 0.42 * (1 + up * 3), 1); F.shadow.material.opacity = Math.max(0.05, 0.85 - up * 7);
  }
  function separate() {
    // keep the fish from walking into each other (not during a leap or inside a burrow)
    for (const a of fishes) for (const b of fishes) {
      if (a === b || ['air', 'hidden', 'enter', 'exit'].includes(a.state) || ['air', 'hidden', 'enter', 'exit'].includes(b.state)) continue;
      const dx = a.x - b.x, dz = a.z - b.z, d = Math.hypot(dx, dz), min = 0.07;
      if (d < min && d > 1e-6) { const k = (min - d) * 0.5 / d; a.x += dx * k; a.z += dz * k; [a.x, a.z] = inside(a.x, a.z); }
    }
  }
  function jumpNow() {
    // the watched fish, or one that is out on the mud
    let F = watchId ? fishes.find(f => f.id === watchId) : null;
    const busy = f => ['air', 'coil', 'hidden', 'enter', 'exit'].includes(f.state) || underSea(f.x, f.z, 0.006);
    if (!F || busy(F)) {
      const free = fishes.filter(f => !busy(f));
      F = free[Math.floor(Math.random() * free.length)];
    }
    if (!F) { flash('いまは陸に跳べるムツゴロウがいません'); return; }
    F.hold = false; F.jumps = 0; startDisplay(F, 0.45, true);
  }

  // ---------- camera & views ----------
  const controls = new THREE.OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.minDistance = 0.08; controls.maxDistance = 2.6;
  controls.maxPolarAngle = Math.PI * 0.6; controls.target.set(0, 0.1, 0);
  function fitDistance(margin = 1.06) {
    const vFov = THREE.MathUtils.degToRad(camera.fov), hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    return Math.max((W / 2 * margin) / Math.tan(hFov / 2) + D / 2, (H / 2 * margin) / Math.tan(vFov / 2) + D / 2);
  }
  const VIEWS = {
    front: () => [[0, H * 0.48, fitDistance()], [0, H * 0.36, 0]],
    oblique: () => { const d = fitDistance(1.1); return [[-d * 0.5, H * 0.4 + d * 0.32, d * 0.78], [0, 0.07, 0]]; },
    top: () => [[0, fitDistance(1.15), 0.001], [0, 0, 0]],
  };
  function setView(n) { stopWatching(); const [p, tg] = VIEWS[n](); camera.position.set(...p); controls.target.set(...tg); controls.update(); }
  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));

  // ---------- watch one fish: the camera follows it, orbit and zoom stay free ----------
  let watchId = null; const lastWatch = [0, 0, 0];
  const fishPos = F => [F.x, Math.max(F.y, mudY(F.x, F.z) + 0.01), F.z];
  function startWatching(id) {
    const F = fishes.find(f => f.id === id); if (!F) return;
    if (mode === 'edit') setMode('view');
    const p = fishPos(F), tall = camera.aspect < 1;
    const s = LIB.watchStart(p, F.yaw, { aspect: camera.aspect, distance: tall ? 0.36 : 0.26, lift: tall ? 0.03 : 0.02 });
    camera.position.set(...LIB.clampWatchCamera(s.camera, { w: W, d: D }, { floorY: 0.07 })); controls.target.set(...s.target); controls.update();
    watchId = id; lastWatch.splice(0, 3, ...p);
    $('watch-select').value = id; $('watch-strip').hidden = false;
    $('watch-hold').setAttribute('aria-pressed', String(F.hold));
  }
  function stopWatching() {
    if (watchId) { const F = fishes.find(f => f.id === watchId); if (F) F.hold = false; }
    watchId = null; $('watch-select').value = ''; $('watch-strip').hidden = true;
  }
  function followWatched() {
    if (!watchId) return;
    const F = fishes.find(f => f.id === watchId), p = fishPos(F);
    if (F.state === 'hidden') { const B = burrows().find(h => h.id === F.home); if (B) p.splice(0, 3, B.x, mudY(B.x, B.z) + 0.01, B.z); }
    const d = LIB.followDelta(lastWatch, p); lastWatch.splice(0, 3, ...p);
    camera.position.x += d[0]; camera.position.y += d[1]; camera.position.z += d[2];
    controls.target.x += d[0]; controls.target.y += d[1]; controls.target.z += d[2];
    camera.position.set(...LIB.clampWatchCamera(camera.position.toArray(), { w: W, d: D }, { floorY: 0.07 }));
  }
  $('watch-select').addEventListener('change', e => { if (e.target.value) startWatching(e.target.value); else setView('front'); });
  $('watch-next').addEventListener('click', () => startWatching(LIB.nextWatchId(fishes.map(f => f.id), watchId)));
  $('watch-all').addEventListener('click', () => setView('front'));
  $('watch-hold').addEventListener('click', () => {
    const F = fishes.find(f => f.id === watchId); if (!F) return;
    F.hold = !F.hold; $('watch-hold').setAttribute('aria-pressed', String(F.hold));
  });
  document.querySelectorAll('[data-fin]').forEach(b => b.addEventListener('click', () => {
    finMode = b.dataset.fin;
    document.querySelectorAll('[data-fin]').forEach(o => o.setAttribute('aria-pressed', String(o === b)));
  }));
  $('jump').addEventListener('click', jumpNow);
  // BGM: browsers do not autoplay sound, so it starts with a tap; it loops, the volume is remembered
  const BGM_KEY = 'mutsugoro-higata-aquarium:bgm-volume';
  const bgm = new Audio(A.audio.bgm); bgm.loop = true; bgm.preload = 'none';
  bgm.volume = Number(store.get(BGM_KEY) ?? 0.5); $('bgm-vol').value = bgm.volume;
  const bgmLabel = on => { $('bgm').textContent = on ? 'BGM：オン' : 'BGM：オフ'; $('bgm').setAttribute('aria-pressed', String(on)); };
  $('bgm').addEventListener('click', async () => {
    if (bgm.paused) { try { await bgm.play(); bgmLabel(true); } catch { flash('音楽を再生できませんでした'); } }
    else { bgm.pause(); bgmLabel(false); }
  });
  $('bgm-vol').addEventListener('input', e => { bgm.volume = Number(e.target.value); store.set(BGM_KEY, e.target.value); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && !bgm.paused) { bgm.pause(); bgm.resumeOnShow = true; } else if (!document.hidden && bgm.resumeOnShow) { bgm.resumeOnShow = false; bgm.play().catch(() => bgmLabel(false)); } });
  let slow = false;
  $('slow').addEventListener('click', () => { slow = !slow; $('slow').setAttribute('aria-pressed', String(slow)); flash(slow ? 'スロー（約1/4の速さ）' : 'ふつうの速さ'); });

  function resize() {
    const r = stage.getBoundingClientRect();
    const size = LIB.aquariumDrawingSize(quality, r.width, r.height, devicePixelRatio);
    renderer.setPixelRatio(size.pixelRatio); renderer.setSize(size.cssWidth, size.cssHeight, false);
    camera.aspect = size.cssWidth / size.cssHeight; camera.fov = camera.aspect < 1 ? 52 : 34; camera.updateProjectionMatrix();
    if (rtRefl) rtRefl.setSize(size.drawingWidth >> 1, size.drawingHeight >> 1);
    waterRes?.set(size.drawingWidth, size.drawingHeight);
    if (drops) drops.material.uniforms.uScale.value = size.drawingHeight * 0.9;
    stage.style.setProperty('--bar-h', $('bar').getBoundingClientRect().height + 'px');
  }

  // ---------- editing: burrows and pools ----------
  let mode = 'view', selected = null, drag = null, down = null;
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
  const ring = new THREE.Mesh(new THREE.RingGeometry(1, 1.07, 64), new THREE.MeshBasicMaterial({ color: 0x2f6f8f, transparent: true, opacity: .9, depthTest: false }));
  ring.rotation.x = -Math.PI / 2; ring.renderOrder = 6; ring.visible = false; scene.add(ring);
  function setMode(m) {
    mode = m; document.body.dataset.mode = m;
    $('mode-view').setAttribute('aria-pressed', String(m === 'view')); $('mode-edit').setAttribute('aria-pressed', String(m === 'edit'));
    $('edit-panel').hidden = m !== 'edit';
    if (m === 'view') select(null); else { stopWatching(); if (!selected) select(approved[0].id); }
    resize();
  }
  $('mode-view').addEventListener('click', () => setMode('view'));
  $('mode-edit').addEventListener('click', () => setMode('edit'));
  function select(id) { selected = id; ring.visible = !!id; $('obj-select').value = id || ''; updatePanel(); }
  function updatePanel() {
    if (!selected) { $('obj-controls').hidden = true; return; }
    const h = holes.find(h => h.id === selected); if (!h) return;
    $('obj-controls').hidden = false;
    $('pos-x').value = (h.x / cm).toFixed(1); $('pos-z').value = (h.z / cm).toFixed(1);
    ring.scale.setScalar(footprint(selected) + 0.006); ring.position.set(h.x, mudY(h.x, h.z) + 0.004, h.z);
  }
  function move(id, x, z, rebuild = true) { const [cx, cz] = clampPos(id, x, z); state.setTransform(id, { position: [cx, 0, cz] }); applyState(rebuild); }
  $('obj-select').addEventListener('change', e => select(e.target.value || null));
  $('pos-x').addEventListener('input', e => { if (!selected) return; const h = holes.find(h => h.id === selected); move(selected, Number(e.target.value) * cm, h.z); save(); });
  $('pos-z').addEventListener('input', e => { if (!selected) return; const h = holes.find(h => h.id === selected); move(selected, h.x, Number(e.target.value) * cm); save(); });
  $('reset').addEventListener('click', () => { state.restoreDefault(); applyState(); save(); flash('承認した配置に戻しました'); });
  function flash(text) { const n = $('toast'); n.textContent = text; n.hidden = false; clearTimeout(flash.t); flash.t = setTimeout(() => n.hidden = true, 2200); }
  function rayFrom(ev) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera);
  }
  function pickHole(ev) {
    rayFrom(ev); plane.constant = -0.06;                       // the mud is 5-13 cm high; pick near its middle height
    let best = null;
    for (let k = 0; k < 2; k++) {
      if (!ray.ray.intersectPlane(plane, hit)) return null;
      plane.constant = -mudY(hit.x, hit.z);                      // refine once on the actual surface height
    }
    for (const h of holes) { const d = Math.hypot(h.x - hit.x, h.z - hit.z); if (d < footprint(h.id) + 0.015 && (!best || d < best.d)) best = { id: h.id, d }; }
    return best && { id: best.id, x: hit.x, z: hit.z };
  }
  function pickFish(ev) {
    rayFrom(ev);
    const hits = ray.intersectObjects(fishes.map(f => f.root), true);
    for (const h of hits) { let o = h.object; while (o && !o.userData.fish) o = o.parent; if (o) return o.userData.fish; }
    return null;
  }
  let lastRebuild = 0;
  canvas.addEventListener('pointerdown', ev => {
    down = { x: ev.clientX, y: ev.clientY };
    if (mode !== 'edit') return;
    const p = pickHole(ev); if (!p) return;
    select(p.id); const h = holes.find(h => h.id === p.id);
    drag = { id: p.id, dx: h.x - p.x, dz: h.z - p.z, pointer: ev.pointerId };
    controls.enabled = false; canvas.setPointerCapture(ev.pointerId);
  });
  canvas.addEventListener('pointermove', ev => {
    if (!drag || ev.pointerId !== drag.pointer) return;
    rayFrom(ev); if (!ray.ray.intersectPlane(plane, hit)) return;
    const now = performance.now(), rebuild = now - lastRebuild > 70; if (rebuild) lastRebuild = now;
    move(drag.id, hit.x + drag.dx, hit.z + drag.dz, rebuild);
  });
  const endDrag = ev => {
    if (mode === 'view' && down && LIB.isTap(down, { x: ev.clientX, y: ev.clientY })) { const id = pickFish(ev); if (id) startWatching(id); }
    down = null;
    if (!drag || ev.pointerId !== drag.pointer) return;
    drag = null; controls.enabled = true; fillMud(); save();
  };
  canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', ev => { down = null; endDrag(ev); });

  // ---------- loop ----------
  const clock = new THREE.Clock(); let acc = 0, t = 0;
  const frameMin = 1 / quality.fps;
  const tmpTarget = new THREE.Vector3();
  function renderReflection() {
    // mirror camera across the water plane; only what is above the water is reflected
    water.visible = false; ring.visible = false;
    reflCam.copy(camera);
    reflCam.position.set(camera.position.x, 2 * WL - camera.position.y, camera.position.z);
    tmpTarget.copy(controls.target); tmpTarget.y = 2 * WL - tmpTarget.y;
    reflCam.up.set(0, 1, 0); reflCam.lookAt(tmpTarget); reflCam.updateMatrixWorld();
    water.material.uniforms.uReflVP.value.multiplyMatrices(reflCam.projectionMatrix, reflCam.matrixWorldInverse);
    renderer.clippingPlanes = [reflClip];
    renderer.setRenderTarget(rtRefl); renderer.render(scene, reflCam);
    renderer.setRenderTarget(null); renderer.clippingPlanes = [];
    water.visible = true; ring.visible = !!selected;
  }
  let paused = false;
  function step(dt) {
    t += dt; uTime.value = t;
    for (const F of fishes) updateFish(F, dt, t);
    separate(); updateSplashes(dt);
  }
  function frame(dt) {
    step(slow ? dt * 0.25 : dt);
    followWatched(); controls.update();
    if (STD && water) renderReflection();
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
    setView, fishes, mudY, startWatching, jumpNow, holes: () => holes,
    pause(on) { paused = on; },
    cam(p, tgt) { camera.position.set(...p); controls.target.set(...tgt); controls.update(); },
    fin(m) { document.querySelector(`[data-fin="${m}"]`).click(); },
    force(id, st) { const F = fishes.find(f => f.id === id); if (st === 'jump') { F.jumps = 0; startJump(F); } else if (st === 'display') startDisplay(F, 30, false); else setState(F, st, st === 'enter' ? 1.7 : 30); },
    advance(sec, fps = 30) { for (let k = 0; k < Math.round(sec * fps); k++) step(1 / fps); followWatched(); controls.update(); if (STD && water) renderReflection(); renderer.render(scene, camera); },
  };

  // ---------- start ----------
  (async () => {
    try {
      say('干潟を準備しています…');
      if (loadSaved()) flash('前回の配置を読み込みました');
      applyState(false);
      await buildTank(); fillMud();
      const sel = $('obj-select');
      for (const o of approved) sel.append(new Option(LABEL(o.id), o.id));
      waterRes = buildWater(); buildSplashes();
      resize(); setView('front');
      addEventListener('resize', resize);
      say('ムツゴロウを呼んでいます…');
      for (const [i, f] of L.fish.entries()) await addFish(f, i);
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
