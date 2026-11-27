/* ルリヨシノボリの水槽 — three.js r170 (window.THREE) + AquariumLib (aquarium-state / mobile-quality).
   Assets come from window.AQUARIUM_ASSETS: relative URLs (published page) or data: URIs (offline file).
   Units: metres. Tank centre on the floor at the origin, front glass +z, left -x. Approved layout: layout v4. */
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
  const QUALITY_KEY = 'ruri-yoshinobori-aquarium:quality';
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
  renderer.setClearColor(0xdbeef0, 1);
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xa9d3d4, 0.35);           // clear water: only a faint haze toward the back
  const camera = new THREE.PerspectiveCamera(34, 1, 0.005, 10);
  // bright daylight from above, as in the approved layout render
  scene.add(new THREE.HemisphereLight(0xf4fbff, 0x6d7a66, 1.45));
  const sun = new THREE.DirectionalLight(0xfff6e4, 1.6); sun.position.set(-0.25, 1.2, 0.35); scene.add(sun);

  // ---------- tank ----------
  const L = A.layout, cm = 0.01;
  const W = L.tank.w * cm, D = L.tank.d * cm, H = L.tank.h * cm, WL = L.tank.water * cm;
  // the same sand bed as the approved layout render: slightly higher at the back, gently uneven
  const ground = (x, z) => (0.025 - 0.012 * (z / D + 0.5)) + 0.002 * Math.sin(x * 40.0 + z * 23.0) + 0.0012 * Math.sin(x * 97.0 - z * 61.0);

  const uTime = { value: 0 };
  const loader = new THREE.TextureLoader();
  const tex = (url, { repeat, srgb = true } = {}) => new Promise((ok, fail) => loader.load(url, t => {
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
    t.anisotropy = STD ? 4 : 1; ok(t);
  }, undefined, () => fail(new Error('画像を読み込めませんでした: ' + url))));

  // Caustics: the moving net of light a riffle's rippling surface throws on the bed and the stones (world space,
  // strongest on up-facing surfaces). Added to Lambert materials without touching their other hooks.
  const CAUSTIC_VERT_HEAD = 'varying vec3 vCWorld; varying vec3 vCNormal;\n';
  const CAUSTIC_VERT = `#include <project_vertex>
    vCWorld = (modelMatrix * vec4(transformed, 1.)).xyz; vCNormal = normalize(mat3(modelMatrix) * objectNormal);`;
  const CAUSTIC_FRAG_HEAD = `uniform float uTime; uniform float uCaustic; varying vec3 vCWorld; varying vec3 vCNormal;
    float cnet(vec2 p, float t){
      float a = sin(p.x + t * 1.1 + sin(p.y * 0.7 + t * 0.6) * 1.7) * sin(p.y * 1.13 - t * 0.9 + sin(p.x * 0.8 - t * 0.5) * 1.7);
      return pow(1. - abs(a), 6.);
    }
    float caustic(vec3 w, float t){ vec2 p = w.xz * 46.; return 0.6 * cnet(p, t) + 0.4 * cnet(p * 1.7 + 3.1, t * 1.3); }\n`;
  const CAUSTIC_FRAG = `float cUp = smoothstep(0.1, 0.8, normalize(vCNormal).y);
    outgoingLight *= 1. + uCaustic * cUp * caustic(vCWorld, uTime);
    #include <opaque_fragment>`;
  function addCaustics(sh, strength) {
    sh.uniforms.uTime = uTime; sh.uniforms.uCaustic = { value: strength };
    sh.vertexShader = CAUSTIC_VERT_HEAD + sh.vertexShader.replace('#include <project_vertex>', CAUSTIC_VERT);
    sh.fragmentShader = CAUSTIC_FRAG_HEAD + sh.fragmentShader.replace('#include <opaque_fragment>', CAUSTIC_FRAG);
  }

  let specks;
  async function buildTank() {
    const [sandT, backT] = await Promise.all([tex(A.textures.sand, { repeat: [L.tank.w / 15, L.tank.d / 15] }), tex(A.textures.background)]);
    // back wall: the background painting, unlit so its colours come through as drawn
    const back = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.02, H * 1.02), new THREE.MeshBasicMaterial({ map: backT, fog: false }));
    back.position.set(0, H / 2, -D / 2 - 0.004); scene.add(back);
    // sand bed
    const g = new THREE.PlaneGeometry(W, D, 120, 60); g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, ground(p.getX(i), p.getZ(i)));
    g.computeVertexNormals();
    const sandMat = new THREE.MeshLambertMaterial({ map: sandT, side: THREE.DoubleSide });   // opaque from below too
    sandMat.onBeforeCompile = sh => addCaustics(sh, STD ? 0.5 : 0.35);
    sandMat.customProgramCacheKey = () => 'sand-caustic';
    scene.add(new THREE.Mesh(g, sandMat));
    // the bed is a solid layer: its four cut faces (from the sand surface down to the tank floor) and its underside,
    // so the side and bottom views show sand, not the water behind it
    const cutT = sandT.clone(); cutT.repeat.set(1, 1); cutT.needsUpdate = true;
    const cutMat = new THREE.MeshLambertMaterial({ map: cutT, color: 0xd8d0bd, side: THREE.DoubleSide });
    const TILE = 0.15, N = 120;
    const skirt = (x0, z0, x1, z1) => {
      const P = [], UV = [], I = [];
      for (let i = 0; i <= N; i++) {
        const k = i / N, x = x0 + (x1 - x0) * k, z = z0 + (z1 - z0) * k, top = ground(x, z), d = Math.hypot(x - x0, z - z0);
        P.push(x, top, z, x, 0, z); UV.push(d / TILE, top / TILE, d / TILE, 0);
        if (i) { const a = (i - 1) * 2; I.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); sg.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
      sg.setIndex(I); sg.computeVertexNormals();
      scene.add(new THREE.Mesh(sg, cutMat));
    };
    const hw = W / 2 - 0.0004, hd = D / 2 - 0.0004;
    skirt(-hw, hd, hw, hd); skirt(-hw, -hd, hw, -hd); skirt(-hw, -hd, -hw, hd); skirt(hw, -hd, hw, hd);
    const baseT = sandT.clone(); baseT.repeat.set(W / TILE, D / TILE); baseT.needsUpdate = true;
    const base = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshLambertMaterial({ map: baseT, color: 0xb9b19f, side: THREE.DoubleSide }));
    base.rotation.x = -Math.PI / 2; base.position.y = 0.0003; scene.add(base);
    // glass: faint panes and thin edges
    const glassMat = new THREE.MeshBasicMaterial({ color: 0xd8f0f2, transparent: true, opacity: 0.05, depthWrite: false, side: THREE.DoubleSide, fog: false });
    for (const [w, h, x, y, z, ry] of [[W, H, 0, H / 2, D / 2, 0], [D, H, -W / 2, H / 2, 0, Math.PI / 2], [D, H, W / 2, H / 2, 0, Math.PI / 2]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glassMat); m.position.set(x, y, z); m.rotation.y = ry; scene.add(m);
    }
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(W, H, D)), new THREE.LineBasicMaterial({ color: 0x6f969c, fog: false }));
    edges.position.y = H / 2; scene.add(edges);
    // fine drifting specks carried by the current (left to right), one draw call
    const n = STD ? 500 : 250, pos = new Float32Array(n * 3), seed = new Float32Array(n);
    const r = seeded('specks');
    for (let i = 0; i < n; i++) { pos[i * 3] = (r() - .5) * W; pos[i * 3 + 1] = r() * WL; pos[i * 3 + 2] = (r() - .5) * D; seed[i] = r(); }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); sg.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    specks = new THREE.Points(sg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTime, uW: { value: W }, uScale: { value: 1 } },
      vertexShader: `uniform float uTime, uW, uScale; attribute float aSeed; varying float vA;
        void main(){
          vec3 p = position;
          p.x = mod(p.x + uW * .5 + uTime * (0.006 + 0.012 * aSeed), uW) - uW * .5;
          p.y += 0.004 * sin(uTime * 0.7 + aSeed * 40.);
          vec4 mv = modelViewMatrix * vec4(p, 1.);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uScale * (0.5 + 0.9 * aSeed) / -mv.z;
          vA = 0.25 + 0.35 * aSeed;
        }`,
      fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - .5); gl_FragColor = vec4(vec3(.97,.99,.98), vA * smoothstep(.5, .1, d)); }`,
    }));
    specks.frustumCulled = false; scene.add(specks);
  }

  // ---------- stones (editable) ----------
  const editables = new Map();      // id -> {root, mesh, kind, radius, label, sink}
  let stoneMaps;
  const stoneMatCache = new Map();
  const FLOOR_CLIP = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.0008);
  renderer.localClippingEnabled = true;
  function stoneMaterial(id, colorId) {
    const key = id + ':' + colorId;
    if (stoneMatCache.has(key)) return stoneMatCache.get(key);
    const r = seeded('tex-' + id);
    // the part of a stone buried below the tank floor is not drawn (it showed under the sand bed from below)
    const m = new THREE.MeshLambertMaterial({ map: stoneMaps[colorId], clippingPlanes: [FLOOR_CLIP] });
    const uOff = { value: new THREE.Vector3(r() * 9, r() * 9, r() * 9) };      // each stone shows a different part of the rock
    m.onBeforeCompile = sh => {
      sh.uniforms.uOff = uOff;
      sh.vertexShader = 'varying vec3 vObjP; varying vec3 vObjN;\n' + sh.vertexShader
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjP = position; vObjN = normal;');
      // triplanar in object space: the rock surface never stretches over the facets and stays put when a stone is moved
      sh.fragmentShader = 'uniform vec3 uOff; varying vec3 vObjP; varying vec3 vObjN;\n' + sh.fragmentShader.replace('#include <map_fragment>', `
        vec3 bw = pow(abs(normalize(vObjN)), vec3(4.)); bw /= (bw.x + bw.y + bw.z);
        vec3 P = vObjP * 7.0 + uOff;            // one tile per ~14 cm of rock
        vec4 tri = texture2D(map, P.zy) * bw.x + texture2D(map, P.xz) * bw.y + texture2D(map, P.xy) * bw.z;
        diffuseColor *= tri;`);
      addCaustics(sh, STD ? 0.4 : 0.28);
    };
    m.customProgramCacheKey = () => 'stone-triplanar-caustic';
    stoneMatCache.set(key, m);
    return m;
  }
  function seeded(id) { let h = 2166136261; for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) / 4294967296); }
  function stoneGeometry(o) {
    // the approved layout's angular boulders (layout_preview.py): a sphere cut by random facets, a little rough,
    // flattened underneath; the same seed per id keeps every stone's shape
    const geo = new THREE.IcosahedronGeometry(0.5, STD ? 6 : 5), q = geo.attributes.position, v = new THREE.Vector3(), n = new THREE.Vector3();
    let s = o.id.length * 97 + o.id.charCodeAt(6) * 13 + 7; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const cuts = [...Array(9)].map(() => [new THREE.Vector3(r() * 2 - 1, r() * 1.6 - .4, r() * 2 - 1).normalize(), .3 + r() * .14]);
    if (/flatter top/.test(o.material)) cuts.push([new THREE.Vector3(0, 1, 0), .3]);
    const bumps = [...Array(5)].map(() => [r() * 2 - 1, r() * 2 - 1, r() * 2 - 1, r() * .1]);
    for (let i = 0; i < q.count; i++) {
      v.fromBufferAttribute(q, i); n.copy(v).normalize();
      let k = 1; for (const b of bumps) k += b[3] * Math.max(0, n.dot(new THREE.Vector3(b[0], b[1], b[2]).normalize())) ** 3;
      v.multiplyScalar(k);
      for (const [cn, d] of cuts) { const e = v.dot(cn) - d; if (e > 0) v.addScaledVector(cn, -e); }
      v.multiplyScalar(1 + .025 * Math.sin(v.x * 37 + v.y * 23) * Math.cos(v.z * 29 - v.y * 17));
      if (v.y < 0) v.y *= .3;
      q.setXYZ(i, v.x, v.y, v.z);
    }
    geo.scale(o.size[0] * cm, o.size[1] * cm * 1.35, o.size[2] * cm);
    geo.computeVertexNormals();
    return geo;
  }
  function makeStone(o) {
    const mesh = new THREE.Mesh(stoneGeometry(o), stoneMaterial(o.id, o.color));
    const root = new THREE.Group(); root.add(mesh); root.userData.id = o.id; scene.add(root);
    editables.set(o.id, { root, mesh, kind: 'stone', radius: Math.max(o.size[0], o.size[2]) * cm / 2, label: '石' + o.id.split('-')[1], sink: 0.004 });
  }

  // ---------- layout state (approved layout -> aquarium-state) ----------
  const approved = L.objects.filter(o => o.kind === 'stone').map(o => ({
    id: o.id, kind: 'stone', position: [o.pos[0] * cm, 0, o.pos[2] * cm], rotation: [0, (o.rot_deg || 0) * Math.PI / 180, 0], colorId: o.color,
  }));
  const REVISION = 'layout-v' + L.version;
  const SAVE_KEY = 'ruri-yoshinobori-aquarium:aquarium:' + REVISION;
  const PALETTE = ['blueblack', 'greyblack'];
  const state = LIB.createAquariumState(approved, { palette: PALETTE, revision: REVISION });
  function clampPos(id, x, z) {
    // keep the stone's footprint behind the glass (its half-size along x and z, rotated)
    const e = editables.get(id), o = L.objects.find(o => o.id === id), ry = current(id)?.rotation[1] ?? 0;
    const hx = o.size[0] * cm / 2, hz = o.size[2] * cm / 2, c = Math.abs(Math.cos(ry)), s = Math.abs(Math.sin(ry));
    const ex = Math.min(hx * c + hz * s, e.radius) * 0.92 + 0.003, ez = Math.min(hx * s + hz * c, e.radius) * 0.92 + 0.003;
    return [Math.min(W / 2 - ex, Math.max(-W / 2 + ex, x)), Math.min(D / 2 - ez, Math.max(-D / 2 + ez, z))];
  }
  function applyState() {
    for (const o of state.snapshot().objects) {
      const e = editables.get(o.id); if (!e) continue;
      const [x, z] = clampPos(o.id, o.position[0], o.position[2]);
      e.root.position.set(x, ground(x, z) - e.sink, z); e.root.rotation.y = o.rotation[1];
      e.mesh.material = stoneMaterial(o.id, o.colorId);
      e.root.updateMatrixWorld(true);
    }
    updatePanel();
  }
  const save = () => store.set(SAVE_KEY, JSON.stringify(state.snapshot()));
  function loadSaved() {
    const raw = store.get(SAVE_KEY); if (!raw) return false;
    try { return state.load(JSON.parse(raw)); } catch { return false; }
  }

  // ---------- surfaces under the fish: the real stone triangles and the sand ----------
  const downRay = new THREE.Raycaster(), rayFrom = new THREE.Vector3(), DOWN = new THREE.Vector3(0, -1, 0);
  const stoneMeshes = () => [...editables.values()].map(e => e.mesh);
  function surfaceAt(x, z, only) {
    rayFrom.set(x, 1, z); downRay.set(rayFrom, DOWN);
    const hits = downRay.intersectObjects(only ? [editables.get(only).mesh] : stoneMeshes(), false);
    const g = ground(x, z);
    return hits.length ? Math.max(hits[0].point.y, g) : g;
  }

  // ---------- fish ----------
  // One shader for every part; the swimming values are uniforms. s: 0 at the snout, 1 at the tail tip (head at -x).
  const SWIM_VERT = `
    uniform float uSwimPhase, uSwimAmp, uX0, uLen, uBendStart, uWaves;
    uniform float uFlapAngle, uFlapZ0, uFlapSide, uIsPec;
    uniform float uFlutter, uFlutterPhase;
`;
  const SWIM_BEGIN = `#include <begin_vertex>
    if (uIsPec > 0.5) {             // pectoral fan: fold back toward the body / spread, plus a soft flutter at its edge
      float d = max(abs(transformed.z) - uFlapZ0, 0.);
      transformed.z = uFlapSide * (uFlapZ0 + d * cos(uFlapAngle));
      transformed.x += d * sin(uFlapAngle) * 0.8;
      float fs = (transformed.x - uX0) / uLen;
      transformed.y += uFlutter * d * sin(uFlutterPhase - d * 140. - fs * 9.);
    }
    float s = clamp((transformed.x - uX0) / uLen, 0., 1.);
    float bend = uSwimAmp * pow(smoothstep(uBendStart, 1., s), 1.35);
    transformed.z += bend * sin(uSwimPhase - s * uWaves);`;
  function fishMaterial(kind, map, u) {
    const fin = kind === 'fin';
    const m = new THREE.MeshLambertMaterial({ map, transparent: fin, side: THREE.DoubleSide, depthWrite: !fin });
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = SWIM_VERT + sh.vertexShader.replace('#include <begin_vertex>', SWIM_BEGIN);
      if (fin) sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        // translucent membrane: the pale blue membrane between the drawn rays lets the water show through, the red rays stay denser
        float lum = dot(diffuseColor.rgb, vec3(.299, .587, .114));
        float red = clamp((diffuseColor.r - diffuseColor.b) * 2.5, 0., 1.);
        diffuseColor.a *= clamp(mix(0.42, 0.9, clamp((0.78 - lum) * 2.2, 0., 1.)) + 0.25 * red, 0., 0.95);`);
    };
    m.customProgramCacheKey = () => 'fish-' + kind;
    return m;
  }
  async function loadModel(key) {
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
      g.computeBoundingBox(); box.union(g.boundingBox);
      parts.push({ name: m.name, g });
    }
    return { parts, map, box };
  }

  // the thin rayed fins are translucent; the fused pelvic disc (sucker) and the eyes are not
  const THIN_FIN = /^(dorsal|caudal|anal|pectoral)/;
  let goby = null;
  async function addGoby(f) {
    const { parts, map, box } = await loadModel(f.model);
    const len = box.max.x - box.min.x, k = f.length_cm * cm / len;
    const u = {
      uSwimPhase: { value: 0 }, uSwimAmp: { value: 0 }, uX0: { value: box.min.x }, uLen: { value: len },
      uBendStart: { value: 0.3 }, uWaves: { value: 5.2 },
      uFlapAngle: { value: 0 }, uFlapZ0: { value: 0 }, uFlapSide: { value: 1 }, uIsPec: { value: 0 },
      uFlutter: { value: 0 }, uFlutterPhase: { value: 0 },
    };
    const model = new THREE.Group(), pecs = [], mats = {};
    for (const P of parts) {
      let mat;
      if (/^pectoral/.test(P.name)) {          // own uniforms: root line and side of this fin
        const bb = P.g.boundingBox, side = (bb.min.z + bb.max.z) > 0 ? 1 : -1;
        const pu = { ...u, uIsPec: { value: 1 }, uFlapSide: { value: side }, uFlapZ0: { value: side > 0 ? bb.min.z : -bb.max.z }, uFlapAngle: { value: 0 }, uFlutter: { value: 0 }, uFlutterPhase: { value: side } };
        mat = fishMaterial('fin', map, pu); pecs.push(pu);
      } else if (THIN_FIN.test(P.name)) mat = mats.fin ??= fishMaterial('fin', map, u);
      else mat = mats.body ??= fishMaterial('body', map, u);
      const mesh = new THREE.Mesh(P.g, mat);
      mesh.name = P.name; mesh.frustumCulled = false;  // vertex animation moves fins beyond the static bounds
      if (mat.transparent) mesh.renderOrder = 2;
      model.add(mesh);
    }
    model.scale.setScalar(k);
    // support points (model space, scaled): the lowest points under the head, middle and tail; the pelvic disc and
    // the lower edges of the pectoral fans carry the fish when it rests
    const sup = [];
    for (const P of parts) {
      if (!/^(body|pelvic_disc|pectoral)/.test(P.name)) continue;
      const p = P.g.attributes.position;
      for (let i = 0; i < p.count; i += 3) sup.push([p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k]);
    }
    const bins = [-0.45, -0.25, -0.05, 0.15, 0.35].map(c => {     // five stations along the body (fraction of length from the middle)
      const cx = (box.min.x + box.max.x) / 2 * k + c * len * k;
      let best = null;
      for (const q of sup) if (Math.abs(q[0] - cx) < len * k * 0.08 && (!best || q[1] < best[1])) best = q;
      return best;
    }).filter(Boolean);
    const root = new THREE.Group(), tilt = new THREE.Group();
    tilt.add(model); root.add(tilt); scene.add(root);
    goby = { f, root, tilt, u, pecs, len: len * k, sup: bins, rnd: seeded('goby-moves'),
      stop: 0, from: null, to: null, ctrl: null, flick: 0, flickSide: 0, phase: 'rest', tPhase: 0, restFor: 3, yaw: (f.heading_deg || 0) * Math.PI / 180, yawGoal: 0, amp: 0 };
    goby.yawGoal = goby.yaw;
    placeAtStop(0);
  }

  // stops: a stone stop follows its stone when the stone is moved or turned in the editor
  const STOPS = L.fish[0].path.stops.map(([x, z, on]) => {
    const o = L.objects.find(o => o.id === on);
    if (!o) return { on: null, x: x * cm, z: z * cm };
    const a = -(o.rot_deg || 0) * Math.PI / 180, dx = (x - o.pos[0]) * cm, dz = (z - o.pos[2]) * cm;   // offset in the stone's frame
    return { on, lx: dx * Math.cos(a) + dz * Math.sin(a), lz: -dx * Math.sin(a) + dz * Math.cos(a) };
  });
  function stopXZ(i) {
    const S = STOPS[i];
    if (!S.on) return [S.x, S.z];
    const e = editables.get(S.on), a = e.root.rotation.y;
    return [e.root.position.x + S.lx * Math.cos(a) + S.lz * Math.sin(a), e.root.position.z - S.lx * Math.sin(a) + S.lz * Math.cos(a)];
  }
  // rest height and body tilt from the surfaces under the support points (pose applied to the points first)
  const tmpV = new THREE.Vector3(), tmpE = new THREE.Euler(), tmpQ = new THREE.Quaternion();
  function restPose(x, z, yaw) {
    let pitch = 0, roll = 0, y = 0;
    for (let it = 0; it < 2; it++) {
      tmpQ.setFromEuler(tmpE.set(roll, yaw, pitch, 'YXZ'));
      const pts = goby.sup.map(q => tmpV.set(...q).applyQuaternion(tmpQ).clone());
      const hs = pts.map(p => surfaceAt(x + p.x, z + p.z, null));
      y = Math.max(...pts.map((p, i) => hs[i] - p.y)) + 0.0002;
      // tilt along the body: the slope between the head-side and tail-side surfaces (kept gentle)
      const n = pts.length, hHead = hs[0], hTail = hs[n - 1], dx = pts[n - 1].distanceTo(pts[0]);
      pitch = THREE.MathUtils.clamp(Math.atan2(hTail - hHead, dx), -0.35, 0.35) * 0.8;   // +z turns the tail up
    }
    return { y, pitch, roll };
  }
  function placeAtStop(i) {
    const [x, z] = stopXZ(i), P = restPose(x, z, goby.yaw);
    goby.root.position.set(x, P.y, z); goby.root.rotation.set(0, goby.yaw, 0); goby.tilt.rotation.set(P.roll, 0, P.pitch);
    goby.stop = i; goby.rest = P;
  }
  const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
  // a dash's speed over its duration (0..1): a strong first kick, a glide, a smaller second kick, then it slows to land.
  // Integrated once into a table: progress(s) is the distance covered (0..1) and kick(s) how hard the tail beats.
  const KICK = s => Math.exp(-(((s - 0.1) / 0.09) ** 2)) + 0.55 * Math.exp(-(((s - 0.52) / 0.08) ** 2));
  const DASH_V = s => 0.08 + KICK(s) + 0.35 * Math.exp(-(((s - 0.3) / 0.2) ** 2)) * (1 - s);
  const DASH_TABLE = (() => { const n = 200, c = [0]; for (let i = 1; i <= n; i++) c.push(c[i - 1] + DASH_V((i - 0.5) / n)); return c.map(v => v / c[n]); })();
  const progress = s => { const f = Math.min(Math.max(s, 0), 1) * 200, i = Math.min(Math.floor(f), 199); return DASH_TABLE[i] + (DASH_TABLE[i + 1] - DASH_TABLE[i]) * (f - i); };
  function dashPoint(G, p) {           // a quadratic curve that bows to one side, so the dash is not a straight line
    const a = 1 - p, F = G.from, C = G.ctrl, T = G.to;
    return [a * a * F.x + 2 * a * p * C.x + p * p * T.x, a * a * F.z + 2 * a * p * C.z + p * p * T.z];
  }
  function updateGoby(t, dt) {
    const G = goby, u = G.u;
    G.tPhase += dt;
    let beat = 0;                                  // tail-beat strength 0..1
    if (G.phase === 'rest') {
      // still on the stone or the sand: the tail stops, the head turns into the current, and the pectoral fans keep
      // moving: a slow breathing open/close, a ripple along the edge, now and then a quick flick of one fin
      G.amp += (0 - G.amp) * Math.min(1, dt * 4);
      G.yaw += angDiff(G.yawGoal, G.yaw) * Math.min(1, dt * 2.5);
      const [x, z] = stopXZ(G.stop);
      const P = restPose(x, z, G.yaw);
      G.root.position.set(x, P.y, z); G.root.rotation.y = G.yaw;
      G.tilt.rotation.z += (P.pitch - G.tilt.rotation.z) * Math.min(1, dt * 6);
      if (G.flick <= 0 && G.rnd() < dt * 0.35) G.flick = 0.35, G.flickSide = G.rnd() < 0.5 ? 0 : 1;
      G.flick = Math.max(0, (G.flick || 0) - dt);
      G.pecs.forEach((pu, k) => {
        const breathe = 0.14 + 0.12 * Math.sin(t * 1.6 + k * 0.9);
        const flick = k === G.flickSide && G.flick > 0 ? 0.35 * Math.sin(Math.PI * G.flick / 0.35) : 0;
        pu.uFlapAngle.value += (breathe + flick - pu.uFlapAngle.value) * Math.min(1, dt * 6);
        pu.uFlutter.value += (0.12 - pu.uFlutter.value) * Math.min(1, dt * 3);
      });
      beat = 0.04 + 0.04 * Math.max(0, Math.sin(t * 0.7));     // a faint tail flick now and then
      if (G.tPhase > G.restFor) {
        // pick the next stop (usually the next one along the loop, sometimes one further)
        const n = STOPS.length, skip = G.rnd() < 0.25 ? 2 : 1;
        const next = (G.stop + skip) % n;
        const [x0, z0] = stopXZ(G.stop), [x1, z1] = stopXZ(next);
        const dist = Math.hypot(x1 - x0, z1 - z0);
        const bow = (G.rnd() < 0.5 ? -1 : 1) * (0.12 + 0.22 * G.rnd()) * dist;      // which side the path bows to, and how much
        G.from = { x: x0, z: z0, y: G.root.position.y }; G.to = { i: next, x: x1, z: z1 };
        G.ctrl = { x: (x0 + x1) / 2 - (z1 - z0) / dist * bow, z: (z0 + z1) / 2 + (x1 - x0) / dist * bow };
        G.dur = THREE.MathUtils.clamp(dist / 0.2, 0.8, 2.0) * (0.85 + 0.3 * G.rnd());
        G.hop = 0.01 + 0.014 * G.rnd();
        G.phase = 'dash'; G.tPhase = 0;
      }
    } else {
      const s = Math.min(G.tPhase / G.dur, 1), p = progress(s);
      const [x, z] = dashPoint(G, p), [xa, za] = dashPoint(G, Math.min(p + 0.02, 1)), [xb, zb] = dashPoint(G, Math.max(p - 0.02, 0));
      const end = restPose(G.to.x, G.to.z, G.yaw).y;
      // lifts off with the first kick, sinks during the glide, rises a little with the second, settles to land
      const lift = G.hop * (Math.sin(Math.PI * p) * 0.85 + 0.15 * Math.sin(Math.PI * Math.min(1, s * 2.2)));
      let y = G.from.y + (end - G.from.y) * p + lift;
      // never through a stone on the way: stay above the surface under the whole body
      const low = Math.min(...G.sup.map(q => q[1]));
      y = Math.max(y, surfaceAt(x, z, null) - low + 0.003 * Math.sin(Math.PI * s));
      const travel = Math.atan2(za - zb, -(xa - xb));
      G.yaw += angDiff(travel, G.yaw) * Math.min(1, dt * (s < 0.15 ? 16 : 7));
      G.root.position.set(x, y, z); G.root.rotation.y = G.yaw;
      const pitchGoal = s < 0.3 ? -0.14 : s < 0.75 ? 0.0 : 0.07;              // nose up at the start, level in the glide, down to land
      G.tilt.rotation.z += (pitchGoal - G.tilt.rotation.z) * Math.min(1, dt * 5);
      G.tilt.rotation.x = 0.25 * angDiff(travel, G.yaw);                     // bank a little into the curve
      beat = Math.min(1, KICK(s) * 1.1);
      // pectorals: laid back against the body during the kicks, half open in the glide, spread wide as brakes to land
      const fan = s > 0.82 ? -0.12 : 0.15 + 0.5 * Math.min(1, KICK(s));
      for (const pu of G.pecs) { pu.uFlapAngle.value += (fan - pu.uFlapAngle.value) * Math.min(1, dt * 10); pu.uFlutter.value += (0.05 - pu.uFlutter.value) * Math.min(1, dt * 4); }
      G.amp += (0.0026 * (0.25 + 0.75 * beat) - G.amp) * Math.min(1, dt * 12);
      if (s >= 1) {
        G.phase = 'rest'; G.tPhase = 0; G.stop = G.to.i; G.tilt.rotation.x = 0;
        G.restFor = 2.5 + 6 * G.rnd() ** 1.5;
        G.yawGoal = (G.rnd() - 0.5) * 0.7;          // face into the current (from the left), give or take 20 degrees
      }
    }
    if (G.phase === 'rest') G.tilt.rotation.x *= Math.max(0, 1 - dt * 4);
    // tail beats: the phase is integrated, so changing speed never makes the tail jump
    u.uSwimPhase.value = (u.uSwimPhase.value + dt * (2 + 26 * beat)) % (Math.PI * 200);
    u.uSwimAmp.value = G.phase === 'rest' ? Math.max(G.amp, 0.0007 * beat / 0.08) : G.amp;
    for (const pu of G.pecs) { pu.uSwimPhase.value = u.uSwimPhase.value; pu.uSwimAmp.value = u.uSwimAmp.value; pu.uFlutterPhase.value += dt * (G.phase === 'rest' ? 4 : 7); }
  }

  // ---------- water surface (bright riffle: sky reflection, gentle chop, the bed seen through it) ----------
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
        uTint: { value: new THREE.Color(0x9fd3d6) }, uSky: { value: new THREE.Color(0xeaf6f7) }, uHalf: { value: new THREE.Vector2(W / 2, D / 2) },
      },
      vertexShader: `
        uniform float uTime; uniform mat4 uReflVP; varying vec3 vW; varying vec4 vReflClip; varying vec3 vN;
        float wave(vec2 p, float t){ return 0.0011*sin(p.x*41.+t*2.4) + 0.0008*sin(p.y*57.-t*2.1+p.x*9.) + 0.0004*sin((p.x+p.y)*93.+t*3.3); }
        void main(){
          vec3 p = position; vec4 w = modelMatrix * vec4(p,1.);
          float e = 0.0005;
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
          vec2 off = vN.xz * 0.05;
          vec3 refr = uUseRT > .5 ? texture2D(uRefr, clamp(sUV + off, 0.001, .999)).rgb : uTint;
          vec3 col;
          if (above) {
            float fres = 0.03 + 0.55 * pow(1. - cosT, 5.);
            col = mix(refr * mix(vec3(1.), uTint, .15), uSky, fres);
          } else {
            vec2 rUV = vReflClip.xy / vReflClip.w * .5 + .5;
            vec3 refl = uUseRT > .5 ? texture2D(uRefl, clamp(rUV + off, 0.001, .999)).rgb : uTint;
            float tir = 1. - smoothstep(0.6, 0.72, cosT);          // total internal reflection past ~48.6 deg
            col = mix(mix(refr, uSky, .55), refl * .9, max(tir, 0.2));
          }
          vec3 Ld = normalize(vec3(-0.2, 1., 0.3));                 // the sun
          float spec = pow(max(dot(reflect(-Ld, vN), V), 0.), 160.);
          col += spec * 0.5;
          vec2 edge = uHalf - abs(vW.xz);                           // meniscus: a fine bright line along the glass
          col += 0.12 * (1. - smoothstep(0.0, 0.003, min(edge.x, edge.y)));
          gl_FragColor = vec4(col, uUseRT > .5 ? 1. : 0.3 + 0.45 * (1. - cosT));
          #include <colorspace_fragment>
        }`,
    });
    surface = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.0006, D - 0.0006, STD ? 120 : 60, STD ? 60 : 30), mat);
    surface.rotation.x = -Math.PI / 2; surface.position.y = WL; surface.renderOrder = 3; scene.add(surface);
    return res;
  }
  let surfRes;

  // ---------- camera & views ----------
  const controls = new THREE.OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.minDistance = 0.05; controls.maxDistance = 2.2;
  controls.maxPolarAngle = Math.PI * 0.62; controls.target.set(0, 0.12, 0);
  function fitDistance(margin = 1.06) {
    const vFov = THREE.MathUtils.degToRad(camera.fov), hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    return Math.max((W / 2 * margin) / Math.tan(hFov / 2) + D / 2, (H / 2 * margin) / Math.tan(vFov / 2) + D / 2);
  }
  const VIEWS = {
    front: () => [[0, H * 0.5, fitDistance()], [0, H * 0.45, 0]],
    oblique: () => { const d = fitDistance(1.12); return [[d * 0.48, H * 0.45 + d * 0.28, d * 0.8], [0, H * 0.3, -0.01]]; },
    top: () => [[0, fitDistance(1.15) + WL * 0.4, 0.001], [0, 0, 0]],
  };
  function setView(n) { stopWatching(); const [p, t] = VIEWS[n](); camera.position.set(...p); controls.target.set(...t); controls.update(); }

  // ---------- observe the goby: the camera follows it (you can still orbit and zoom around it) ----------
  const INFO = ['ルリヨシノボリ', 'Rhinogobius mizunoi',
    '頬に散る瑠璃色の斑が名の由来。2017年に新種として記載された。川の中流から上流の流れの速い瀬にすみ、腹鰭が変わった吸盤で石に張り付き、止まっては短く泳ぐ。全長8 cm（実物は7〜10 cm）。'];
  let watch = null;
  const watchTmp = new THREE.Vector3();
  function startWatching() {
    if (!goby) return;
    const portrait = Math.max(1, 0.8 / camera.aspect), dist = Math.max(0.12, goby.len * 2.0 * portrait);
    goby.root.getWorldPosition(watchTmp);
    const dir = new THREE.Vector3(0.3, 0.32, 1).normalize();
    camera.position.copy(watchTmp).addScaledVector(dir, dist); controls.target.copy(watchTmp); controls.update();
    watch = true;
    $('info-name').textContent = INFO[0]; $('info-sci').textContent = INFO[1]; $('info-text').textContent = INFO[2];
    $('info').hidden = false; $('info').classList.remove('open'); $('watch').setAttribute('aria-pressed', 'true');
  }
  function stopWatching() { watch = null; $('info').hidden = true; $('watch').setAttribute('aria-pressed', 'false'); }
  function followWatched() {
    if (!watch) return;
    goby.root.getWorldPosition(watchTmp);
    watchTmp.sub(controls.target);                    // move camera and target together: keeps the user's orbit
    camera.position.add(watchTmp); controls.target.add(watchTmp);
  }
  $('watch').addEventListener('click', () => { if (watch) setView('front'); else { if (mode === 'edit') setMode('view'); startWatching(); } });
  $('info-close').addEventListener('click', () => setView('front'));
  $('info-text').addEventListener('click', () => $('info').classList.toggle('open'));   // narrow screens: tap to read the rest
  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));

  function resize() {
    const r = stage.getBoundingClientRect();
    const size = LIB.aquariumDrawingSize(quality, r.width, r.height, devicePixelRatio);
    renderer.setPixelRatio(size.pixelRatio); renderer.setSize(size.cssWidth, size.cssHeight, false);
    camera.aspect = size.cssWidth / size.cssHeight; camera.fov = camera.aspect < 1 ? 50 : 34; camera.updateProjectionMatrix();
    const dw = size.drawingWidth, dh = size.drawingHeight;
    if (rtRefr) { rtRefr.setSize(dw >> 1, dh >> 1); rtRefl.setSize(dw >> 1, dh >> 1); }
    surfRes?.set(dw, dh);
    if (specks) specks.material.uniforms.uScale.value = dh * 0.0012;
  }

  // ---------- editing ----------
  let mode = 'view', selected = null, drag = null;
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
  const ring = new THREE.Mesh(new THREE.RingGeometry(1, 1.06, 64), new THREE.MeshBasicMaterial({ color: 0x1f6f9a, transparent: true, opacity: .85, depthTest: false, fog: false }));
  ring.rotation.x = -Math.PI / 2; ring.renderOrder = 5; ring.visible = false; scene.add(ring);
  function setMode(m) {
    mode = m; document.body.dataset.mode = m;
    $('mode-view').setAttribute('aria-pressed', m === 'view'); $('mode-edit').setAttribute('aria-pressed', m === 'edit');
    $('edit-panel').hidden = m !== 'edit';
    if (m === 'view') select(null); else { stopWatching(); if (!selected) select(approved[0].id); }
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
    const e = editables.get(selected), o = current(selected);
    $('obj-controls').hidden = false;
    $('pos-x').value = (o.position[0] / cm).toFixed(1); $('pos-z').value = (o.position[2] / cm).toFixed(1);
    $('rot-y').value = Math.round(THREE.MathUtils.radToDeg(o.rotation[1]) % 360);
    document.querySelectorAll('[data-color]').forEach(b => b.setAttribute('aria-pressed', b.dataset.color === o.colorId));
    ring.scale.setScalar(e.radius + 0.008); ring.position.set(e.root.position.x, e.root.position.y + e.sink + 0.002, e.root.position.z);
  }
  function setTransform(id, x, z, ry) {
    state.setTransform(id, { rotation: [0, ry, 0] });
    const [cx, cz] = clampPos(id, x, z);
    state.setTransform(id, { position: [cx, 0, cz] }); applyState(); save();
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
  const BGM_VOL = 'ruri-yoshinobori-aquarium:bgm-volume';
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
  function step(dt) { t += dt; uTime.value = t; if (goby) updateGoby(t, dt); }
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
    setView, get goby() { return goby; }, surfaceAt, stopXZ,
    pause(on) { paused = on; },
    cam(p, tgt) { camera.position.set(...p); controls.target.set(...tgt); controls.update(); },
    watch: startWatching,
    advance(sec) { for (let k = 0; k < Math.round(sec * 30); k++) step(1 / 30); followWatched(); controls.update(); if (STD && surface) renderWaterPasses(); renderer.render(scene, camera); },
  };

  // ---------- start ----------
  (async () => {
    try {
      say('水槽を準備しています…');
      const [bb, gb] = await Promise.all([tex(A.textures['stone-blueblack'], { repeat: [1, 1] }), tex(A.textures['stone-greyblack'], { repeat: [1, 1] })]);
      stoneMaps = { blueblack: bb, greyblack: gb };
      await buildTank();
      for (const o of L.objects) if (o.kind === 'stone') makeStone(o);
      const sel = $('obj-select');
      for (const o of approved) sel.append(new Option(editables.get(o.id).label, o.id));
      if (loadSaved()) flash('前回の配置を読み込みました');
      applyState();
      surfRes = buildWater();
      resize(); setView('front');
      addEventListener('resize', resize);
      say('ルリヨシノボリを呼んでいます…');
      await addGoby(L.fish[0]);
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
