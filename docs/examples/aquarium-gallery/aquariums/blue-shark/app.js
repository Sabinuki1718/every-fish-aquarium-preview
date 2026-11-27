/* ヨシキリザメの大水槽 — three.js r170 (window.THREE) + AquariumLib (aquarium-state / mobile-quality).
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
  const QUALITY_KEY = 'blue-shark-aquarium:quality';
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
  // outside the tank the page's own paper colour shows (also what the water's refraction/reflection passes see beyond the tank)
  const clearColor = new THREE.Color();
  const paperColor = () => { clearColor.set(getComputedStyle(document.documentElement).getPropertyValue('--paper').trim() || '#eef2f4'); renderer.setClearColor(clearColor, 1); };
  paperColor(); matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paperColor);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 140);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xaec3d0, 2.2));
  const sun = new THREE.DirectionalLight(0xf4faff, 1.0); sun.position.set(-0.3, 1, 0.5); scene.add(sun);

  // ---------- tank ----------
  const L = A.layout, cm = 0.01;
  const W = L.tank.w * cm, D = L.tank.d * cm, H = L.tank.h * cm, WL = L.tank.water * cm;
  const ground = (x, z) => 0.10 + 0.10 * (0.5 - z / D) + 0.025 * Math.sin(x * 1.1 + 1.3) * Math.cos(z * 1.3) + 0.012 * Math.sin(x * 3.1 - z * 2.3);

  const uniformsCommon = { uTime: { value: 0 }, uCaustic: { value: STD ? 0.30 : 0.18 } };
  const loader = new THREE.TextureLoader();
  const tex = (url, { repeat, srgb = true } = {}) => new Promise((ok, fail) => loader.load(url, t => {
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
    t.anisotropy = STD ? 4 : 1; ok(t);
  }, undefined, () => fail(new Error('画像を読み込めませんでした: ' + url))));

  // Shared shader snippets: soft wandering caustic veins, world position varying.
  const CAUSTIC = `
    uniform float uTime; uniform float uCaustic; varying vec3 vWorldC;
    float causticAt(vec2 p, float t){
      float c = 0.;
      c += sin(p.x*3.4 + t*0.9 + sin(p.y*2.6 - t*0.7)*1.6);
      c += sin(p.y*4.0 - t*0.8 + sin(p.x*3.0 + t*0.6)*1.4);
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
        diffuseColor.rgb *= 1. + uCaustic * causticAt(vWorldC.xz, uTime) * (1. - 0.6*cDepth);`);
    };
    material.customProgramCacheKey = () => key;
    return material;
  };

  let shafts = [], plankton = null;
  async function buildTank() {
    const [bgT, sandT] = await Promise.all([tex(A.textures.background), tex(A.textures.sand, { repeat: [W / 2.4, D / 2.4] })]);
    // back wall and side walls: the painted open-water background (unlit, so the painted colours stay as supplied)
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.02, H), new THREE.MeshBasicMaterial({ map: bgT }));
    bg.position.set(0, H / 2, -D / 2 - 0.01); scene.add(bg);
    for (const s of [-1, 1]) {
      const t = bgT.clone(); t.needsUpdate = true; t.repeat.set(0.3, 1); t.offset.set(s < 0 ? 0 : 0.7, 0);
      const w = new THREE.Mesh(new THREE.PlaneGeometry(D, H), new THREE.MeshBasicMaterial({ map: t }));
      w.rotation.y = -s * Math.PI / 2; w.position.set(s * (W / 2 + 0.01), H / 2, 0); scene.add(w);
    }
    // sand floor, higher at the back
    const g = new THREE.PlaneGeometry(W, D, 150, 75); g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, ground(p.getX(i), p.getZ(i)));
    g.computeVertexNormals();
    scene.add(new THREE.Mesh(g, withCaustics(new THREE.MeshLambertMaterial({ map: sandT }), 'sand')));
    const lip = new THREE.Mesh(new THREE.PlaneGeometry(W, 0.24), new THREE.MeshLambertMaterial({ color: 0xc9d1cc }));
    lip.position.set(0, 0.12, D / 2 - 0.002); scene.add(lip);
    // water tint (front and sides only: the top is the water surface itself)
    const tintMat = new THREE.MeshBasicMaterial({ color: 0x2f7fb0, transparent: true, opacity: 0.10, depthWrite: false });
    for (const [w, h, x, y, z, ry] of [[W, WL, 0, WL / 2, D / 2 - 0.004, 0], [D, WL, -W / 2 + 0.004, WL / 2, 0, Math.PI / 2], [D, WL, W / 2 - 0.004, WL / 2, 0, -Math.PI / 2]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), tintMat); m.position.set(x, y, z); m.rotation.y = ry; m.renderOrder = 4; scene.add(m);
    }
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(W, H, D)), new THREE.LineBasicMaterial({ color: 0x8fb2c8 }));
    edges.position.y = H / 2; scene.add(edges);
    // light shafts from the surface, fading with depth
    const nShaft = STD ? 7 : 4;
    for (let i = 0; i < nShaft; i++) {
      const w = 0.9 + 1.4 * ((i * 0.37) % 1);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, WL), new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        vertexShader: 'varying vec2 u;void main(){u=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
        fragmentShader: 'varying vec2 u;void main(){float a=pow(max(0.,1.-abs(u.x-.5)*2.),1.6)*(.05+.95*pow(u.y,1.4))*.16;gl_FragColor=vec4(.70,.88,1.,a);}',
      }));
      m.position.set((-0.42 + 0.84 * ((i * 0.618) % 1)) * W, WL / 2, (-0.32 + 0.5 * ((i * 0.381) % 1)) * D);
      m.rotation.set(0, ((i * 0.7) % 1.6) - 0.8, 0.16 + 0.08 * ((i * 0.29) % 1)); m.userData.ph = i; m.renderOrder = 1;
      scene.add(m); shafts.push(m);
    }
    // plankton
    const n = STD ? 1400 : 500, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { pos[i * 3] = (Math.random() - .5) * W; pos[i * 3 + 1] = 0.3 + Math.random() * (WL - 0.4); pos[i * 3 + 2] = (Math.random() - .5) * D; }
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    plankton = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xd8eeff, size: 0.035, transparent: true, opacity: 0.45, depthWrite: false }));
    scene.add(plankton);
  }

  // ---------- rocks (editable) ----------
  const editables = new Map();      // id -> {root, mesh, kind, radius, label, sink}
  let stoneMats;
  function stoneMaterial(map) {
    const m = new THREE.MeshLambertMaterial({ map });
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, uniformsCommon);
      sh.vertexShader = 'varying vec3 vObjP; varying vec3 vObjN; varying vec3 vWorldC;\n' + sh.vertexShader
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjP = position; vObjN = normal;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldC = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      // triplanar in object space: the rock's surface stays put when the rock is moved
      sh.fragmentShader = 'varying vec3 vObjP; varying vec3 vObjN;\n' + CAUSTIC + sh.fragmentShader.replace('#include <map_fragment>', `
        vec3 bw = pow(abs(normalize(vObjN)), vec3(4.)); bw /= (bw.x + bw.y + bw.z);
        vec3 P = vObjP * 0.85;                 // one texture tile per ~1.2 m of rock
        vec4 tri = texture2D(map, P.zy) * bw.x + texture2D(map, P.xz) * bw.y + texture2D(map, P.xy) * bw.z;
        diffuseColor *= tri;
        diffuseColor.rgb *= 1. + uCaustic * causticAt(vWorldC.xz, uTime) * smoothstep(-0.2, 0.6, normalize(vObjN).y);`);
    };
    m.customProgramCacheKey = () => 'stone-triplanar';
    return m;
  }
  function seeded(id) { let h = 2166136261; for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) / 4294967296); }
  function stoneGeometry(o) {
    const rnd = seeded(o.id), geo = new THREE.IcosahedronGeometry(0.5, STD ? 5 : 4), p = geo.attributes.position, v = new THREE.Vector3();
    const k = [rnd() * 6, rnd() * 6, rnd() * 6, rnd() * 6];
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const n = v.clone().normalize();
      const r = 1 + 0.10 * Math.sin(n.x * 3.1 + k[0]) * Math.cos(n.z * 2.7 + k[1]) + 0.06 * Math.sin(n.y * 4.3 + n.x * 2.1 + k[2]) + 0.03 * Math.sin(n.x * 9.0 + n.z * 7.0 + k[3]);
      v.multiplyScalar(r);
      if (v.y < -0.1) v.y = -0.1 + (v.y + 0.1) * 0.35;           // flattened base resting in the sand
      p.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    geo.scale(o.size[0] * cm, o.size[1] * cm * 1.55, o.size[2] * cm);
    return geo;
  }
  function makeStone(o) {
    const mesh = new THREE.Mesh(stoneGeometry(o), stoneMats[o.color]);
    const root = new THREE.Group(); root.add(mesh); root.userData.id = o.id; scene.add(root);
    editables.set(o.id, { root, mesh, kind: 'stone', radius: Math.max(o.size[0], o.size[2]) * cm / 2, label: '岩' + o.id.split('-')[1], sink: 0.12 * o.size[1] * cm });
  }

  // ---------- layout state (approved layout -> aquarium-state) ----------
  const approved = L.objects.filter(o => o.kind === 'stone').map(o => ({
    id: o.id, kind: o.kind, position: [o.pos[0] * cm, 0, o.pos[2] * cm], rotation: [0, (o.rot_deg || 0) * Math.PI / 180, 0], colorId: o.color,
  }));
  const REVISION = 'layout-v' + L.version;
  const SAVE_KEY = 'blue-shark-aquarium:aquarium:' + REVISION;
  const state = LIB.createAquariumState(approved, { palette: ['blue', 'red'], revision: REVISION });
  function clampPos(id, x, z) {
    const e = editables.get(id), r = e.radius + 0.05;
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

  // ---------- sharks ----------
  const fishes = [];
  const SWIM_VERT = `uniform float uSwimPhase; uniform float uSwimAmp; uniform float uXmin; uniform float uLen;\n`;
  // Each model has its head toward -x. A travelling wave grows toward the tail (head stays nearly still).
  const SWIM_BEGIN = `#include <begin_vertex>
    float s = clamp((transformed.x - uXmin) / uLen, 0., 1.);
    float bend = uSwimAmp * pow(smoothstep(0.12, 1., s), 1.5);
    transformed.z += bend * sin(uSwimPhase - s * 4.0);`;
  function fishMaterial(map, u) {
    const m = new THREE.MeshLambertMaterial({ map, side: THREE.FrontSide });
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = SWIM_VERT + sh.vertexShader.replace('#include <begin_vertex>', SWIM_BEGIN);
    };
    m.customProgramCacheKey = () => 'shark-swim';
    return m;
  }
  async function loadFish(f, i, shared) {
    const M = A.models[f.id];
    let sh = shared[M.geometry];
    if (!sh) {      // fish of one species share their geometry data and texture
      const res = await fetch(M.geometry);
      if (!res.ok) throw new Error('モデルを読み込めませんでした: ' + M.geometry);
      const data = await res.json();
      let x0 = Infinity, x1 = -Infinity;
      for (const m of data.meshes) for (let k = 0; k < m.p.length; k += 3) { x0 = Math.min(x0, m.p[k]); x1 = Math.max(x1, m.p[k]); }
      const map = await tex(M[quality.name === 'light' ? 'light' : 'standard']);
      map.flipY = false;                         // glTF-style UVs (v = 0 at the top of the atlas)
      sh = shared[M.geometry] = { data, map, x0, len: x1 - x0 };
    }
    // body wave amplitude: about 4.6% of the body length at the tail
    const u = { uSwimPhase: { value: i * 2.1 }, uSwimAmp: { value: 0.046 * sh.len }, uXmin: { value: sh.x0 }, uLen: { value: sh.len } };
    const mat = fishMaterial(sh.map, u);
    const model = new THREE.Group();
    for (const m of sh.data.meshes) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(m.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(m.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(m.uv, 2));
      g.setIndex(m.i);
      const mesh = new THREE.Mesh(g, mat); mesh.name = m.name; mesh.frustumCulled = false;   // vertex animation moves parts beyond the static bounds
      model.add(mesh);
    }
    const root = new THREE.Group();
    root.add(model); root.scale.setScalar(f.length_cm * cm / sh.len); root.rotation.order = 'YZX'; scene.add(root);
    const P = f.path, hs = P.half_straight_cm * cm, R = P.radius_cm * cm;
    const path = { c: [P.center[0] * cm, P.center[1] * cm, P.center[2] * cm], hs, R, len: 4 * hs + 2 * Math.PI * R };
    // start where the approved layout put this shark: nearest point on its loop
    let best = 0, bd = 1e9;
    for (let s = 0; s < path.len; s += 0.05) { const q = stadium(path, s); const d = Math.hypot(q.x - f.pos[0] * cm, q.z - f.pos[2] * cm); if (d < bd) { bd = d; best = s; } }
    fishes.push({ root, u, path, s: best, speed: f.speed ?? 0.55, amp: 0.046 * sh.len, ph: i * 2.3, id: f.id });
  }
  // Racetrack loop: front straight (toward -x), left turn, back straight (toward +x), right turn.
  function stadium(P, s) {
    const { c, hs, R } = P, arc = Math.PI * R;
    s = ((s % P.len) + P.len) % P.len;
    if (s < 2 * hs) return { x: c[0] + hs - s, z: c[2] + R, vx: -1, vz: 0 };
    s -= 2 * hs;
    if (s < arc) { const a = s / R; return { x: c[0] - hs - R * Math.sin(a), z: c[2] + R * Math.cos(a), vx: -Math.cos(a), vz: -Math.sin(a) }; }
    s -= arc;
    if (s < 2 * hs) return { x: c[0] - hs + s, z: c[2] - R, vx: 1, vz: 0 };
    s -= 2 * hs;
    const a = s / R; return { x: c[0] + hs + R * Math.sin(a), z: c[2] - R * Math.cos(a), vx: Math.cos(a), vz: Math.sin(a) };
  }
  function updateFish(F, t, dt) {
    F.s += F.speed * dt;
    const q = stadium(F.path, F.s);
    const y = F.path.c[1] + 0.12 * Math.sin(0.27 * t + F.ph), vy = 0.12 * 0.27 * Math.cos(0.27 * t + F.ph);
    F.root.position.set(q.x, y, q.z);
    const yaw = Math.atan2(q.vz, -q.vx);
    let dyaw = yaw - (F.yaw ?? yaw); dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    F.yaw = yaw; F.turn = (F.turn ?? 0) * 0.94 + (dt > 0 ? dyaw / dt : 0) * 0.06;
    F.root.rotation.set(-0.5 * F.turn, yaw, Math.atan2(vy, F.speed) * 0.8);      // bank into the turn, pitch with the vertical drift
    F.u.uSwimPhase.value += dt * (2 * Math.PI * 0.55) * (F.speed / 0.55);
    F.u.uSwimAmp.value = F.amp * (0.95 + 0.4 * Math.min(Math.abs(F.turn) * 3, 1));
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
        uTint: { value: new THREE.Color(0x6fa9cf) }, uSky: { value: new THREE.Color(0xdcebf4) }, uHalf: { value: new THREE.Vector2(W / 2, D / 2) },
      },
      vertexShader: `
        uniform float uTime; uniform mat4 uReflVP; varying vec3 vW; varying vec4 vReflClip; varying vec3 vN;
        float wave(vec2 p, float t){ return 0.012*sin(p.x*2.1+t*1.0) + 0.008*sin(p.y*2.9-t*0.9+p.x*0.6) + 0.005*sin((p.x+p.y)*4.8+t*1.6); }
        void main(){
          vec3 p = position; vec4 w = modelMatrix * vec4(p,1.);
          float e = 0.01;
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
          vec2 off = vN.xz * 0.5;
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
          vec3 Ld = normalize(vec3(-0.3, 1., 0.5));
          float spec = pow(max(dot(reflect(-Ld, vN), V), 0.), 90.);
          if (above) col += spec * 0.35;
          vec2 edge = uHalf - abs(vW.xz);                          // meniscus: a fine bright line along the glass
          col += 0.18 * (1. - smoothstep(0.0, 0.05, min(edge.x, edge.y)));
          gl_FragColor = vec4(col, uUseRT > .5 ? 1. : 0.28 + 0.4 * (1. - cosT));
          #include <colorspace_fragment>
        }`,
    });
    surface = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.004, D - 0.004, STD ? 120 : 60, STD ? 60 : 30), mat);
    surface.rotation.x = -Math.PI / 2; surface.position.y = WL; surface.renderOrder = 3; scene.add(surface);
    return res;
  }
  let surfRes;

  // ---------- camera & views ----------
  const controls = new THREE.OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.minDistance = 2; controls.maxDistance = 48;
  controls.maxPolarAngle = Math.PI * 0.62; controls.target.set(0, 2.2, 0);
  function fitDistance(margin = 1.08) {
    const vFov = THREE.MathUtils.degToRad(camera.fov), hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    return Math.max((W / 2 * margin) / Math.tan(hFov / 2) + D / 2, (H / 2 * margin) / Math.tan(vFov / 2) + D / 2);
  }
  const VIEWS = {
    front: () => [[0, 2.3, fitDistance()], [0, 2.15, 0]],
    oblique: () => { const d = fitDistance(1.02); return [[d * 0.5, 2.3 + d * 0.3, d * 0.78], [0, 1.9, -0.2]]; },
    top: () => [[0, fitDistance(1.15) + WL, 0.001], [0, 0, 0]],
  };
  function setView(n) { const [p, t] = VIEWS[n](); camera.position.set(...p); controls.target.set(...t); controls.update(); }
  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));

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
  const ring = new THREE.Mesh(new THREE.RingGeometry(1, 1.06, 64), new THREE.MeshBasicMaterial({ color: 0x9fd2f2, transparent: true, opacity: .85, depthTest: false }));
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
    if (!selected) { $('obj-controls').hidden = true; return; }
    const e = editables.get(selected), o = state.snapshot().objects.find(o => o.id === selected);
    $('obj-controls').hidden = false;
    $('pos-x').value = (o.position[0] / cm).toFixed(0); $('pos-z').value = (o.position[2] / cm).toFixed(0);
    $('rot-y').value = Math.round(THREE.MathUtils.radToDeg(o.rotation[1]) % 360);
    document.querySelectorAll('[data-color]').forEach(b => b.setAttribute('aria-pressed', b.dataset.color === o.colorId));
    ring.scale.setScalar(e.radius + 0.1); ring.position.set(e.root.position.x, e.root.position.y + e.sink + 0.02, e.root.position.z);
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
  const BGM_VOL = 'blue-shark-aquarium:bgm-volume';
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
    for (const F of fishes) updateFish(F, t, dt);
    for (const m of shafts) m.rotation.z = 0.2 + 0.03 * Math.sin(t * 0.15 + m.userData.ph);
    if (plankton) plankton.position.y = 0.08 * Math.sin(t * 0.2);
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
      await buildTank();
      for (const o of L.objects) if (o.kind === 'stone') makeStone(o);
      const sel = $('obj-select');
      for (const o of approved) sel.append(new Option(editables.get(o.id).label, o.id));
      if (loadSaved()) flash('前回の配置を読み込みました');
      applyState();
      surfRes = buildWater();
      resize(); setView('front');
      addEventListener('resize', resize);
      say('サメを呼んでいます…');
      const shared = {};
      for (const [i, f] of L.fish.entries()) await loadFish(f, i, shared);
      status.hidden = true;
      window.__ready = true;
      loop();
    } catch (e) {
      console.error(e);
      say('読み込みに失敗しました。通信状態を確かめて再読み込みしてください。（' + (e.message || e) + '）', true);
    }
  })();
  window.__aq = { setView, setMode, select, state: () => state.snapshot(), fishes, camera, controls };
  setMode('view');
})();
