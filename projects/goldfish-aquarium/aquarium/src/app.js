/* 枯山水の金魚水槽 — three.js r170 (window.THREE) + AquariumLib (aquarium-state / mobile-quality / fish-watch).
   Assets come from window.AQUARIUM_ASSETS: relative URLs (published page) or data: URIs (offline file).
   Units: metres. Tank centre on the floor at the origin, front glass +z, left -x.
   Fish: one shared Tripo-made oranda shape (head -x, dorsal +y, 0.12 m) with per-variety photo textures.
   The shape carries per-vertex fin data (aFin 0..1, aRoot = distance from the body, aKind 1 caudal 2 dorsal 3 pectoral 4 pelvic 5 anal). */
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
  const QUALITY_KEY = 'karesansui-goldfish:quality';
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
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch (e) {
    say('この端末・ブラウザでは3D表示（WebGL）を開始できませんでした。別のブラウザで開くか、ほかのアプリを閉じてから再読み込みしてください。', true);
    return;
  }
  canvas.addEventListener('webglcontextlost', e => {
    e.preventDefault(); say('画面の描画が中断されました（メモリー不足など）。再読み込みしてください。軽量表示にすると安定することがあります。', true);
  });
  const ROOM = 0x1b2229, WATER = 0x2f6070;
  renderer.setClearColor(ROOM, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.18;
  if (STD) { renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; }
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 10);
  scene.add(new THREE.HemisphereLight(0xeaf6ff, 0x6a5c48, 1.75));
  const fill = new THREE.DirectionalLight(0xcfe6ff, 0.75); fill.position.set(0, 0.3, 1); scene.add(fill);   // room light through the front glass
  const sun = new THREE.DirectionalLight(0xfffbf2, 3.4);       // aquarium LED above the water
  sun.position.set(0.05, 0.9, 0.12); sun.target.position.set(0, 0, 0); scene.add(sun, sun.target);
  if (STD) {
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.radius = 5; sun.shadow.bias = -0.0008;
    Object.assign(sun.shadow.camera, { left: -0.34, right: 0.34, top: 0.2, bottom: -0.2, near: 0.3, far: 1.2 });
  }

  // ---------- tank ----------
  const L = A.layout, cm = 0.01;
  const W = L.tank.w * cm, D = L.tank.d * cm, H = L.tank.h * cm, WL = L.tank.water * cm;
  const ground = (x, z) => { const t = (D / 2 - z) / D; return 0.03 + 0.03 * t * t; };

  const uniformsCommon = { uTime: { value: 0 }, uCaustic: { value: STD ? 0.9 : 0.6 } };
  const loader = new THREE.TextureLoader();
  const tex = (url, { repeat, srgb = true } = {}) => new Promise((ok, fail) => loader.load(url, t => {
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
    t.anisotropy = STD ? 8 : 2; ok(t);
  }, undefined, () => fail(new Error('画像を読み込めませんでした: ' + url))));

  // Caustics: bright wandering network from the rippled surface, fading with depth.
  const CAUSTIC = `
    uniform float uTime; uniform float uCaustic; varying vec3 vWorldC;
    float causticAt(vec2 p, float t){
      vec2 q = p * 150.; vec2 i = q; float c = 1.; const float inten = .005;
      for (int n = 0; n < 4; n++) {
        float tt = t * 0.32 * (1. - (3.5 / float(n + 1)));
        i = q + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
        c += 1. / length(vec2(q.x / (sin(i.x + tt) / inten), q.y / (cos(i.y + tt) / inten)));
      }
      c /= 4.; c = 1.17 - pow(c, 1.4);
      return clamp(pow(abs(c), 8.), 0., 1.6);
    }
`
  function injectCaustics(sh, mapChunk = '#include <map_fragment>') {
    Object.assign(sh.uniforms, uniformsCommon);
    sh.vertexShader = 'varying vec3 vWorldC;\n' + sh.vertexShader.replace('#include <worldpos_vertex>',
      '#include <worldpos_vertex>\nvWorldC = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = CAUSTIC + sh.fragmentShader.replace(mapChunk, `${mapChunk}
      float cDepth = clamp((${WL.toFixed(4)} - vWorldC.y) / ${WL.toFixed(4)}, 0., 1.);
      diffuseColor.rgb *= 1. + uCaustic * causticAt(vWorldC.xz, uTime) * (1. - 0.45*cDepth);`);
  }
  const withCaustics = (material, key) => { material.onBeforeCompile = sh => injectCaustics(sh); material.customProgramCacheKey = () => key; return material; };

  async function buildTank() {
    const [bgT, gravelT, gravelN] = await Promise.all([
      tex(A.textures.background), tex(A.textures['gravel-oiso'], { repeat: [6, 3] }), tex(A.textures['gravel-oiso-n'], { repeat: [6, 3], srgb: false })]);
    // back screen: one-sided, facing the front (seen through the back glass from behind: hidden)
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: bgT, side: THREE.FrontSide, toneMapped: false }));
    bg.position.set(0, H / 2, -D / 2 - 0.003); scene.add(bg);
    // gravel bed: top surface + sides + bottom (closed, opaque)
    const gm = withCaustics(new THREE.MeshStandardMaterial({ map: gravelT, normalMap: gravelN, normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.92 }), 'gravel');
    const g = new THREE.PlaneGeometry(W - 0.001, D - 0.001, 120, 60); g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      p.setY(i, ground(x, z) + 0.0012 * Math.sin(x * 83 + 1.3) * Math.cos(z * 97) + 0.0008 * Math.sin(x * 211 + z * 173));
    }
    g.computeVertexNormals();
    const floor = new THREE.Mesh(g, gm); floor.receiveShadow = STD; scene.add(floor);
    const sideMat = new THREE.MeshStandardMaterial({ map: gravelT.clone(), roughness: 0.95, color: 0xb9b2a8 });
    sideMat.map.repeat.set(6, 0.6); sideMat.map.needsUpdate = true;
    const skirt = (x0, z0, x1, z1) => {               // vertical strip from the floor of the tank up to the bed surface
      const n = 60, pos = [], uv = [], idx = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
        pos.push(x, 0, z, x, ground(x, z), z); uv.push(t, 0, t, ground(x, z) / 0.06);
        if (i < n) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      }
      const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      sg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); sg.setIndex(idx); sg.computeVertexNormals();
      scene.add(new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ map: sideMat.map, roughness: 0.95, side: THREE.DoubleSide })));
    };
    const hx = W / 2 - 0.0005, hz = D / 2 - 0.0005;
    skirt(-hx, hz, hx, hz); skirt(hx, -hz, -hx, -hz); skirt(-hx, -hz, -hx, hz); skirt(hx, hz, hx, -hz);
    const bottom = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ color: 0x1c1b19, roughness: 1 }));
    bottom.rotation.x = Math.PI / 2; bottom.position.y = 0.0002; scene.add(bottom);
    // glass panes, black trim at top and bottom (frame), cabinet below
    const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xdff2f2, transparent: true, opacity: 0.07, roughness: 0.05, depthWrite: false, side: THREE.DoubleSide });
    for (const [w, h, x, y, z, ry] of [[W, H, 0, H / 2, D / 2, 0], [D, H, -W / 2, H / 2, 0, Math.PI / 2], [D, H, W / 2, H / 2, 0, Math.PI / 2]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glassMat); m.position.set(x, y, z); m.rotation.y = ry; m.renderOrder = 4; scene.add(m);
    }
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(W, H, D)), new THREE.LineBasicMaterial({ color: 0x6f8c93, transparent: true, opacity: 0.7 }));
    edges.position.y = H / 2; scene.add(edges);
    const trim = new THREE.MeshStandardMaterial({ color: 0x0d0f11, roughness: 0.5 });
    for (const y of [0.006, H - 0.004]) {
      for (const [w, d, x, z] of [[W + 0.004, 0.004, 0, D / 2], [W + 0.004, 0.004, 0, -D / 2], [0.004, D, -W / 2, 0], [0.004, D, W / 2, 0]]) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(w, y < 0.01 ? 0.012 : 0.008, d), trim); b.position.set(x, y, z); scene.add(b);
      }
    }
    const cab = new THREE.Mesh(new THREE.BoxGeometry(W + 0.06, 0.05, D + 0.06), new THREE.MeshStandardMaterial({ color: 0x24201c, roughness: 0.7 }));
    cab.position.y = -0.025; scene.add(cab);
    for (const o of [edges, cab]) o.material.fog = false;
    trim.fog = false; glassMat.fog = false;
    buildWaterLife();
  }

  // ---------- in-water atmosphere: haze, suspended specks, light shafts ----------
  scene.fog = new THREE.FogExp2(0x6fa3b2, 0.2);          // slight blue-green haze: the back of the tank recedes
  let specks, shafts = [];
  function buildWaterLife() {
    const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d');
    const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
    const n = STD ? 600 : 260, pos = new Float32Array(n * 3), seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (Math.random() - .5) * (W - 0.02), z = (Math.random() - .5) * (D - 0.02);
      pos.set([x, ground(x, z) + 0.01 + Math.random() * (WL - ground(x, z) - 0.02), z], i * 3); seed[i] = Math.random() * 100;
    }
    const g2 = new THREE.BufferGeometry(); g2.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    specks = new THREE.Points(g2, new THREE.PointsMaterial({ size: 0.0016, map: new THREE.CanvasTexture(c), transparent: true, opacity: 0.55, depthWrite: false, color: 0xe6f4f2, fog: false }));
    specks.userData.seed = seed; specks.frustumCulled = false; scene.add(specks);
    // god rays: additive soft planes hanging from the surface, slowly drifting and flickering
    const rayMat = seed => new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uTime: uniformsCommon.uTime, uSeed: { value: seed }, uI: { value: STD ? 0.085 : 0.06 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
      fragmentShader: `uniform float uTime; uniform float uSeed; uniform float uI; varying vec2 vUv;
        void main(){
          float x = vUv.x;
          float band = 0.5 + 0.5 * sin(x * 9. + uTime * 0.23 + uSeed) * sin(x * 23. - uTime * 0.17 + uSeed * 2.);
          float edge = smoothstep(0., .35, x) * smoothstep(1., .65, x);
          float flick = 0.65 + 0.35 * sin(uTime * 0.4 + uSeed * 3.1);
          float a = uI * band * edge * flick * pow(vUv.y, 1.6);
          gl_FragColor = vec4(vec3(0.85, 0.95, 1.0) * a, 1.);
        }`,
    });
    for (let k = 0; k < 9; k++) {
      const w = 0.05 + Math.random() * 0.06, h = WL - 0.03;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), rayMat(k * 1.7));
      m.position.set(-0.26 + k * 0.065 + (Math.random() - .5) * 0.02, WL - h / 2, (Math.random() - .5) * 0.16);
      m.rotation.set(0, (Math.random() - .5) * 0.8, 0.12 + (Math.random() - .5) * 0.1); m.renderOrder = 6; m.frustumCulled = false;
      scene.add(m); shafts.push(m);
    }
  }
  function updateWaterLife(t) {
    if (!specks) return;
    const p = specks.geometry.attributes.position, s = specks.userData.seed;
    for (let i = 0; i < p.count; i++) {
      const k = s[i];
      p.setX(i, p.getX(i) + 0.00003 * Math.sin(t * 0.3 + k));
      p.setY(i, p.getY(i) + 0.00002 * Math.sin(t * 0.21 + k * 1.3) - 0.000004);
      p.setZ(i, p.getZ(i) + 0.00002 * Math.cos(t * 0.27 + k));
      if (p.getY(i) < ground(p.getX(i), p.getZ(i)) + 0.004) p.setY(i, WL - 0.01);
    }
    p.needsUpdate = true;
  }

  // ---------- stones & plants (editable) ----------
  const editables = new Map();      // id -> {root, kind, radius, label, sink}
  let stoneMats;
  function seeded(id) { let h = 2166136261; for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) / 4294967296); }
  function stoneMaterial(map) {
    const m = new THREE.MeshStandardMaterial({ map, roughness: 0.82, color: 0xffffff });
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, uniformsCommon);
      sh.vertexShader = 'varying vec3 vObjP; varying vec3 vObjN; varying vec3 vWorldC;\n' + sh.vertexShader
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjP = position; vObjN = normal;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldC = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      // triplanar in object space: the stone skin stays put when the stone is moved or recoloured
      sh.fragmentShader = 'varying vec3 vObjP; varying vec3 vObjN;\n' + CAUSTIC + sh.fragmentShader.replace('#include <map_fragment>', `
        vec3 bw = pow(abs(normalize(vObjN)), vec3(4.)); bw /= (bw.x + bw.y + bw.z);
        vec3 P = vObjP * 0.75;
        vec4 tri = texture2D(map, P.zy) * bw.x + texture2D(map, P.xz) * bw.y + texture2D(map, P.xy) * bw.z;
        diffuseColor *= tri;
        diffuseColor.rgb *= 0.86 + 0.28 * smoothstep(-0.6, 0.9, normalize(vObjN).y);      // weathered tops lighter
        diffuseColor.rgb *= 1. + uCaustic * causticAt(vWorldC.xz, uTime) * smoothstep(-0.2, 0.6, normalize(vObjN).y);`);
    };
    m.customProgramCacheKey = () => 'stone-triplanar';
    return m;
  }
  // Angular mountain stone (same recipe as the approved layout image): a sphere cut by random planes, softened edges.
  function stoneGeometry(o) {
    const rnd = seeded(o.id), geo = new THREE.IcosahedronGeometry(1, STD ? 6 : 4), p = geo.attributes.position, v = new THREE.Vector3();
    const planes = [];
    for (let i = 0; i < 9; i++) planes.push([new THREE.Vector3(rnd() - 0.5, (rnd() - 0.5) * 0.6, rnd() - 0.5).normalize(), 0.72 + rnd() * 0.2]);
    const k = [rnd() * 9, rnd() * 9, rnd() * 9];
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      for (const [n, d] of planes) { const t = v.dot(n); if (t > d) v.addScaledVector(n, -(t - d) * 0.85); }
      v.multiplyScalar(1 + 0.03 * Math.sin(v.x * 7 + k[0]) * Math.sin(v.y * 6 + k[1]) * Math.sin(v.z * 8 + k[2]) + 0.012 * Math.sin(v.x * 23 + v.z * 19 + k[0]));
      if (v.y < -0.55) v.y = -0.55 + (v.y + 0.55) * 0.2;
      p.setXYZ(i, v.x, v.y, v.z);
    }
    geo.deleteAttribute('uv');
    const merged = mergeByPosition(geo); merged.computeVertexNormals();
    return merged;
  }
  function mergeByPosition(geo) {               // weld the icosahedron's duplicated vertices so the normals are smooth
    const p = geo.attributes.position, map = new Map(), pos = [], idx = [];
    for (let i = 0; i < p.count; i++) {
      const key = `${p.getX(i).toFixed(5)},${p.getY(i).toFixed(5)},${p.getZ(i).toFixed(5)}`;
      let j = map.get(key); if (j === undefined) { j = pos.length / 3; map.set(key, j); pos.push(p.getX(i), p.getY(i), p.getZ(i)); }
      idx.push(j);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); return g;
  }
  function makeStone(o) {
    const mesh = new THREE.Mesh(stoneGeometry(o), stoneMats[o.color === 'red' ? 'red' : 'blue']);
    mesh.scale.set(o.size[0] / 2 * cm, o.size[1] / 2 * cm, o.size[2] / 2 * cm);
    mesh.rotation.set(THREE.MathUtils.degToRad(o.tilt?.[0] || 0), THREE.MathUtils.degToRad(o.tilt?.[1] || 0), THREE.MathUtils.degToRad(o.tilt?.[2] || 0));
    mesh.position.y = o.size[1] * 0.25 * cm; mesh.castShadow = mesh.receiveShadow = STD;
    const root = new THREE.Group(); root.add(mesh); root.userData.id = o.id; scene.add(root);
    editables.set(o.id, { root, mesh, kind: 'stone', radius: Math.max(o.size[0], o.size[2]) * cm / 2, label: '石' + o.id.split('-')[1] + '（' + (o.role || '石') + '）', sink: 0 });
  }

  // Plants: procedural geometry, merged per clump; aSway (0 at the base .. 1 at the tip) drives a slow sway in the vertex shader.
  // aLeaf = (across the blade 0..1, along the blade 0..1) for the vein pattern of Vallisneria.
  const plantMats = [];
  function plantMaterial(key, veins) {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
    m.onBeforeCompile = sh => {
      injectCaustics(sh, '#include <color_fragment>');
      sh.fragmentShader = sh.fragmentShader.replace('diffuseColor.rgb *= 1. + uCaustic *', 'diffuseColor.rgb *= 1. + 0.3 * uCaustic *');
      sh.vertexShader = 'attribute float aSway; attribute vec2 aLeaf; varying vec2 vLeaf; uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vLeaf = aLeaf;
        vec4 wp0 = modelMatrix * vec4(position, 1.);
        float k = aSway * aSway;
        transformed.x += k * 0.010 * sin(uTime * 0.75 + wp0.x * 23. + wp0.z * 17.);
        transformed.z += k * 0.006 * sin(uTime * 0.55 + wp0.x * 11. + 1.3);`);
      sh.fragmentShader = 'varying vec2 vLeaf;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * 0.1;          // thin leaves glow when the light passes through`);
      if (veins) sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        {
          float u = vLeaf.x, v = vLeaf.y;
          float mid = 1. - smoothstep(0.0, 0.03, abs(u - 0.5));                       // midrib
          float lat = 0.;                                                              // parallel side veins
          for (int i = 0; i < 4; i++) { float c = (i < 2) ? 0.14 + 0.16 * float(i) : 0.7 + 0.16 * float(i - 2); lat = max(lat, 1. - smoothstep(0.0, 0.018, abs(u - c))); }
          float xv = 1. - smoothstep(0.0, 0.12, abs(fract(v * 160. + u * 0.6) - 0.5) * 2.);  // fine cross veins
          float edge = smoothstep(0.4, 0.5, abs(u - 0.5));
          float cell = 0.5 + 0.5 * sin(v * 2100.) * sin(u * 70.);
          diffuseColor.rgb *= 0.92 + 0.08 * cell;
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.45 + vec3(0.03, 0.05, 0.0), mid * 0.75 + lat * 0.45);
          diffuseColor.rgb *= 1. - 0.12 * xv * (1. - mid) - 0.2 * edge;
        }`);
    };
    m.customProgramCacheKey = () => 'plant-' + key;
    plantMats.push(m); return m;
  }
  function geometryFrom(pos, col, sway, idx, leaf) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(sway, 1));
    g.setAttribute('aLeaf', new THREE.Float32BufferAttribute(leaf, 2));
    g.setIndex(idx); g.computeVertexNormals(); return g;
  }
  // Vallisneria: long ribbon leaves with a blunt, finely toothed tip; veins are drawn in the shader.
  function vallisneria(o) {
    const rnd = seeded(o.id), pos = [], col = [], sway = [], idx = [], leaf = [], c = new THREE.Color();
    for (let b = 0; b < o.count; b++) {
      const h = o.height * cm * (0.6 + rnd() * 0.42), w = 0.008 + rnd() * 0.003;
      const bx = (rnd() - 0.5) * 0.07, bz = (rnd() - 0.5) * 0.05, rot = rnd() * Math.PI * 2;
      const bend = (rnd() - 0.35) * 0.07, twist = rnd() * 2, segs = STD ? 40 : 26;
      c.setHSL(0.25 + rnd() * 0.05, 0.55 + rnd() * 0.15, 0.2 + rnd() * 0.08);
      const cr = Math.cos(rot), sr = Math.sin(rot), base = pos.length / 3;
      for (let s = 0; s <= segs; s++) {
        const t = s / segs, y = t * h - 0.012;
        const tipW = t < 0.94 ? 1 : Math.sqrt(Math.max(0, (1 - t) / 0.06)) * 0.85 + 0.15;
        const teeth = t > 0.85 ? 1 + 0.08 * (s % 2 ? 1 : -1) : 1;
        const ww = w * tipW * teeth * (0.9 + 0.1 * Math.sin(t * 9 + b));
        const off = bend * t * t, tw = Math.sin(t * 3 + twist) * 1.1;
        for (const side of [-0.5, 0.5]) {
          const lx = side * ww * Math.cos(tw) + off, lz = side * ww * Math.sin(tw) + 0.012 * Math.sin(t * 2.5 + twist);
          pos.push(bx + lx * cr - lz * sr, y, bz + lx * sr + lz * cr);
          const sh = 0.72 + 0.4 * t; col.push(c.r * sh, c.g * sh, c.b * sh); sway.push(t); leaf.push(side + 0.5, t);
        }
        if (s < segs) { const a = base + s * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      }
    }
    return geometryFrom(pos, col, sway, idx, leaf);
  }
  // Cabomba: opposite pairs of fan-shaped leaves, each split into forked threads; nodes crowd and leaves shrink toward
  // the tip, which ends in a small closed apical bud.
  function cabomba(o) {
    const rnd = seeded(o.id), pos = [], col = [], sway = [], idx = [], leaf = [], c = new THREE.Color();
    const quad = (a, b, w, nrm, t0, t1, color) => {   // thin strip from a to b, width w, facing roughly nrm
      const d = new THREE.Vector3().subVectors(b, a), side = new THREE.Vector3().crossVectors(d, nrm).normalize().multiplyScalar(w / 2);
      const i = pos.length / 3;
      for (const [p, t] of [[a.clone().sub(side), t0], [a.clone().add(side), t0], [b.clone().sub(side), t1], [b.clone().add(side), t1]]) { pos.push(p.x, p.y, p.z); col.push(color.r, color.g, color.b); sway.push(t); leaf.push(0.5, t); }
      idx.push(i, i + 2, i + 1, i + 1, i + 2, i + 3);
    };
    const up = new THREE.Vector3(0, 1, 0), PRI = STD ? 6 : 3, LEVELS = STD ? 3 : 2;
    const fork = (from, ang, dy, len, level, nrm, t, color) => {   // recursive dichotomous fork, threads curve slightly
      const d = new THREE.Vector3(Math.cos(ang), dy, Math.sin(ang)).normalize();
      const to = from.clone().addScaledVector(d, len);
      quad(from, to, 0.0009 - level * 0.0001, nrm, t, t + 0.004, color);
      if (level + 1 < LEVELS) for (const k of [-1, 1]) fork(to, ang + k * (0.24 - level * 0.07) + (rnd() - 0.5) * 0.08, dy + 0.1 + (rnd() - 0.5) * 0.12, len * (0.85 + rnd() * 0.15), level + 1, nrm, t + 0.004, color);
    };
    for (let s = 0; s < o.count; s++) {
      const h = o.height * cm * (0.7 + rnd() * 0.35), x0 = (rnd() - 0.5) * 0.055, z0 = (rnd() - 0.5) * 0.035;
      const lean = new THREE.Vector3((rnd() - 0.5) * 0.12, 1, (rnd() - 0.5) * 0.12).normalize();
      const stemC = new THREE.Color().setHSL(0.27, 0.45, 0.24);
      const at = y => new THREE.Vector3(x0, -0.01, z0).addScaledVector(lean, y + 0.01);
      let y0 = 0, rot = rnd() * Math.PI;
      while (y0 < h) {
        const r = y0 / h;
        const gap = 0.0125 * (1 - 0.62 * THREE.MathUtils.smoothstep(r, 0.45, 1)) + 0.0006;   // nodes crowd toward the tip
        const a = at(y0), b = at(Math.min(h, y0 + gap)), ta = (y0 + 0.01) / (h + 0.01), tb = Math.min(1, (y0 + gap + 0.01) / (h + 0.01));
        quad(a, b, 0.0014, new THREE.Vector3(0, 0, 1), ta, tb, stemC);
        quad(a, b, 0.0014, new THREE.Vector3(1, 0, 0), ta, tb, stemC);
        if (r > 0.05) {                                // lowest stem bare (old leaves lost)
          const size = 0.026 * (1 - 0.32 * THREE.MathUtils.smoothstep(r, 0.45, 1)) * (0.9 + 0.2 * rnd());   // big fans below, smaller up top
          const lift = -0.1 + 0.14 * rnd() + 0.95 * Math.pow(THREE.MathUtils.smoothstep(r, 0.35, 1), 1.1);   // lower fans open flat; upper ones tilt up into a cup
          c.setHSL(0.24 + rnd() * 0.025, 0.7, 0.26 + 0.1 * r);
          rot += Math.PI / 2 + (rnd() - 0.5) * 0.2;
          for (const half of [0, Math.PI]) {           // opposite leaves
            const ang = rot + half;
            const dir = new THREE.Vector3(Math.cos(ang), lift, Math.sin(ang)).normalize();
            const nrm = new THREE.Vector3().crossVectors(dir, up).normalize().cross(dir);
            if (nrm.y < 0) nrm.negate();
            const pet = a.clone().addScaledVector(dir, size * 0.25);
            quad(a, pet, 0.0009, nrm, ta, ta + 0.004, c);
            const spread = 1.45 - 0.2 * THREE.MathUtils.smoothstep(r, 0.6, 1);            // two half-disc fans close the circle; narrower when young
            for (let f = -PRI; f <= PRI; f++) fork(pet, ang + f * (spread / PRI) + (rnd() - 0.5) * 0.1, lift + 0.06 * Math.abs(f) + (rnd() - 0.5) * 0.2, size * 0.34 * (1 - 0.04 * Math.abs(f)), 0, nrm, ta + 0.004, c);
          }
        }
        y0 += gap;
      }
      // apical bud: tiny folded leaves packed at the tip, opening outward from the centre
      const tip = at(h);
      for (let k = 0; k < 4; k++) {
        const budC = new THREE.Color().setHSL(0.22, 0.6, 0.44 - k * 0.03);
        const ang = rot + k * Math.PI / 2 + 0.4;
        const dir = new THREE.Vector3(Math.cos(ang), 2.4 - k * 0.35, Math.sin(ang)).normalize();
        const nrm = new THREE.Vector3().crossVectors(dir, up).normalize().cross(dir); if (nrm.y < 0) nrm.negate();
        const base = tip.clone().addScaledVector(lean, -0.0012 * k);
        for (let f = -2; f <= 2; f++) fork(base, ang + f * 0.32, 2.2 - k * 0.3, 0.0016 + 0.0009 * k, 1, nrm, 1, budC);
      }
    }
    return geometryFrom(pos, col, sway, idx, leaf);
  }
  function makePlant(o) {
    const isVal = o.species.startsWith('バリス');
    const geo = isVal ? vallisneria(o) : cabomba(o);
    const mat = isVal ? (makePlant.val ??= plantMaterial('val', true)) : (makePlant.cab ??= plantMaterial('cab', false));
    const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = STD; mesh.frustumCulled = false;
    const root = new THREE.Group(); root.add(mesh); root.userData.id = o.id; scene.add(root);
    editables.set(o.id, { root, mesh, kind: 'plant', radius: isVal ? 0.045 : 0.035, label: (isVal ? 'バリスネリア' : 'カボンバ') + '（' + (o.role || o.id.replace('plant-', '')) + '）', sink: 0 });
  }

  // ---------- layout state (approved layout -> aquarium-state) ----------
  const approved = L.objects.filter(o => o.kind === 'stone' || o.kind === 'plant').map(o => ({
    id: o.id, kind: o.kind, position: [o.pos[0] * cm, 0, o.pos[2] * cm], rotation: [0, 0, 0],
    ...(o.kind === 'stone' ? { colorId: o.color === 'red' ? 'red' : 'blue' } : {}),
  }));
  const REVISION = 'layout-v' + L.version;
  const SAVE_KEY = 'karesansui-goldfish:aquarium:' + REVISION;
  const state = LIB.createAquariumState(approved, { palette: ['blue', 'red'], revision: REVISION });
  function clampPos(id, x, z) {
    const e = editables.get(id), r = e.radius + 0.004;
    return [Math.min(W / 2 - r, Math.max(-W / 2 + r, x)), Math.min(D / 2 - r, Math.max(-D / 2 + r, z))];
  }
  function applyState() {
    for (const o of state.snapshot().objects) {
      const e = editables.get(o.id); if (!e) continue;
      const [x, z] = clampPos(o.id, o.position[0], o.position[2]);
      e.root.position.set(x, ground(x, z) - e.sink, z); e.root.rotation.y = o.rotation[1];
      if (e.kind === 'stone') e.mesh.material = stoneMats[o.colorId];
    }
    updatePanel();
  }
  const save = () => store.set(SAVE_KEY, JSON.stringify(state.snapshot()));
  function loadSaved() {
    const raw = store.get(SAVE_KEY); if (!raw) return false;
    try { return state.load(JSON.parse(raw)); } catch { return false; }
  }

  // ---------- fish ----------
  const INFO = {
    'fish-azumanishiki': ['白黒東錦（しろくろあずまにしき）', 'Carassius auratus（金魚の改良品種）',
      '東錦（キャリコ柄のオランダ獅子頭）のうち、赤が抜けたタイプ。浅葱色の地に大小の黒斑が散り、モザイク透明鱗が真珠のように光る。肉瘤、背鰭、長い四つ尾をもち、鰭には鰭条に沿って黒い筋が入る。全長12 cm（仮の大きさ）。'],
    'fish-seibun': ['青文（せいぶん）', 'Carassius auratus（金魚の改良品種）',
      '青灰色のオランダ獅子頭。体も肉瘤も鉄色がかった青で、腹はやや淡い。背鰭と長い四つ尾をもつ。全長12 cm（仮の大きさ）。'],
    'fish-kigashira': ['天青（てんせい）', 'Carassius auratus（金魚の改良品種）',
      '山吹色の肉瘤に、背が青灰・腹が白い体のオランダ獅子頭型の金魚。鰭は白く透ける。全長12 cm（仮の大きさ）。'],
  };
  const fishes = [];
  const FISH_VERT = `
    attribute float aFin; attribute float aRoot; attribute float aKind;
    uniform float uSwimPhase; uniform float uSwimAmp; uniform float uFinPhase; uniform float uFinAmp; uniform float uBreath; uniform float uPecOpen; uniform float uCurve;
    varying float vFin; varying float vRoot;
`;
  const FISH_BEGIN = `#include <begin_vertex>
    vFin = aFin; vRoot = aRoot;
    float s = clamp((transformed.x + 0.06) / 0.12, 0., 1.);        // 0 snout .. 1 tail tip
    float side = transformed.z >= 0. ? 1. : -1.;
    float fw = aFin * min(aRoot / 0.004, 1.);                       // fins move from their root outward
    // uFinAmp is a swing angle (rad): displacement = distance from the fin root x angle, so roots stay attached
    if (aKind > 0.5 && aKind < 1.5) {                               // caudal: travelling ripple, lobes fan
      transformed.z += fw * aRoot * uFinAmp * sin(uFinPhase - aRoot * 90.);
      transformed.y += fw * aRoot * uFinAmp * 0.3 * sin(uFinPhase * 0.7 - aRoot * 60. + 1.2);
    } else if (aKind > 1.5 && aKind < 2.5 || aKind > 4.5) {        // dorsal / anal: sideways ripple along the fin
      transformed.z += fw * aRoot * uFinAmp * 0.8 * sin(uFinPhase * 1.1 - aRoot * 110. - transformed.x * 50.);
    }                                                               // pectoral & pelvic: moved by bones (skinning)
    // breathing: gill covers flare and the mouth pumps
    float gill = smoothstep(-0.05, -0.043, transformed.x) * (1. - smoothstep(-0.034, -0.026, transformed.x)) * smoothstep(0.008, 0.016, abs(transformed.z)) * (1. - aFin);
    transformed.z += side * gill * 0.0011 * (0.5 + 0.5 * uBreath);
    float mouth = smoothstep(-0.052, -0.059, transformed.x);
    transformed.yz *= 1. + mouth * 0.07 * uBreath;
    // body undulation, stronger toward the tail
    transformed.z += uCurve * (s - 0.42) * (s - 0.42);              // whole body arcs toward the inside of a turn
    float bend = uSwimAmp * pow(smoothstep(0.25, 1., s), 1.4);
    transformed.z += bend * sin(uSwimPhase - s * 4.6);`;
  function fishMaterial(kind, map, u) {
    const m = kind === 'fin'
      ? new THREE.MeshStandardMaterial({ map, transparent: true, depthWrite: false, depthFunc: THREE.LessEqualDepth, side: THREE.DoubleSide, roughness: 0.45 })
      : kind === 'finDepth'
      ? new THREE.MeshStandardMaterial({ colorWrite: false, depthWrite: true, side: THREE.DoubleSide })
      : (STD ? new THREE.MeshPhysicalMaterial({ map, roughness: 0.38, clearcoat: 0.35, clearcoatRoughness: 0.35, side: THREE.FrontSide })
             : new THREE.MeshStandardMaterial({ map, roughness: 0.42, side: THREE.FrontSide }));
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = FISH_VERT + sh.vertexShader.replace('#include <begin_vertex>', FISH_BEGIN);
      Object.assign(sh.uniforms, uniformsCommon);
      sh.vertexShader = 'varying vec3 vWorldC; varying float vUp;\n' + sh.vertexShader.replace('#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvWorldC = (modelMatrix * vec4(transformed, 1.0)).xyz; vUp = normalize(mat3(modelMatrix) * objectNormal).y;');
      sh.fragmentShader = 'varying float vFin; varying float vRoot; varying float vUp;\n' + CAUSTIC + sh.fragmentShader.replace('#include <color_fragment>',
        '#include <color_fragment>\n diffuseColor.rgb *= 1. + uCaustic * 0.55 * causticAt(vWorldC.xz, uTime) * smoothstep(0.0, 0.8, vUp);');
      if (kind === 'fin') sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        // translucent membrane: pale membrane lets the water through, dark rays/streaks stay dense; opaque at the root
        float lum = dot(diffuseColor.rgb, vec3(.299, .587, .114));
        float dens = mix(0.34, 0.93, clamp((0.8 - lum) * 1.6, 0., 1.));
        diffuseColor.a = mix(0.97, dens, smoothstep(0.0008, 0.007, vRoot) * vFin);`);
    };
    m.customProgramCacheKey = () => 'fish-' + kind + (STD ? '-std' : '-light');
    return m;
  }
  let fishGeo;
  async function loadFishGeometry() {
    const res = await fetch(A.geometry);
    if (!res.ok) throw new Error('モデルを読み込めませんでした: ' + A.geometry);
    const d = await res.json();
    const attrs = {
      position: new THREE.Float32BufferAttribute(d.p, 3), normal: new THREE.Float32BufferAttribute(d.n, 3), uv: new THREE.Float32BufferAttribute(d.uv, 2),
      aFin: new THREE.Float32BufferAttribute(d.f, 1), aRoot: new THREE.Float32BufferAttribute(d.r, 1), aKind: new THREE.Float32BufferAttribute(d.k, 1),
    };
    attrs.skinIndex = new THREE.Uint16BufferAttribute(d.skinIndex, 4);
    attrs.skinWeight = new THREE.Float32BufferAttribute(d.skinWeight, 4);
    const mk = index => { const g = new THREE.BufferGeometry(); for (const [k, v] of Object.entries(attrs)) g.setAttribute(k, v); g.setIndex(index); g.computeBoundingSphere(); return g; };
    fishGeo = { body: mk(d.iBody), fin: mk(d.iFin), bones: d.bones };
  }
  // Rounded loops (a "stadium": two straights joined by half circles of radius R, about half a body length or more) in front
  // of the stones, each fish in its own depth band so they never meet. Speed breathes so the fish drift and pause.
  const PATHS = {
    'fish-azumanishiki': { c: [-0.02, 0.18, 0.045], hl: 0.11, R: 0.058, dy: 0.012, sp: 0.026, dir: 1, ph: 0.1 },
    'fish-seibun': { c: [0.03, 0.115, 0.06], hl: 0.1, R: 0.055, dy: 0.01, sp: 0.022, dir: -1, ph: 0.45 },
    'fish-kigashira': { c: [0.0, 0.258, 0.04], hl: 0.12, R: 0.06, dy: 0.012, sp: 0.024, dir: 1, ph: 0.75 },
  };
  const pathAt = (P, t) => {
    const Lp = 4 * P.hl + 2 * Math.PI * P.R;
    const speed = P.sp * (1 + 0.35 * Math.sin(0.13 * t + P.ph * 9));
    const dist = P.ph * Lp + P.sp * t - (P.sp * 0.35 / 0.13) * Math.cos(0.13 * t + P.ph * 9);   // integral of speed
    let u = ((dist % Lp) + Lp) % Lp; if (P.dir < 0) u = Lp - u;
    const [cx, cy, cz] = P.c, half = Math.PI * P.R, side = 2 * P.hl;
    let x, z, tx, tz;
    if (u < side) { x = cx - P.hl + u; z = cz + P.R; tx = 1; tz = 0; }                                      // front straight, +x
    else if (u < side + half) { const a = Math.PI / 2 - (u - side) / P.R; x = cx + P.hl + P.R * Math.cos(a); z = cz + P.R * Math.sin(a); tx = Math.sin(a); tz = -Math.cos(a); }
    else if (u < 2 * side + half) { x = cx + P.hl - (u - side - half); z = cz - P.R; tx = -1; tz = 0; }      // back straight, -x
    else { const a = -Math.PI / 2 - (u - 2 * side - half) / P.R; x = cx - P.hl + P.R * Math.cos(a); z = cz + P.R * Math.sin(a); tx = Math.sin(a); tz = -Math.cos(a); }
    if (P.dir < 0) { tx = -tx; tz = -tz; }
    const yb = cy + P.dy * Math.sin(0.21 * t + P.ph * 5), vy = P.dy * 0.21 * Math.cos(0.21 * t + P.ph * 5);
    return { p: [x, yb, z], v: [tx * speed, vy, tz * speed] };
  };
  async function loadFish(f, i) {
    const M = A.models[f.id];
    const map = await tex(M[quality.name === 'light' ? 'light' : 'standard']);
    map.flipY = false;                         // glTF-style UVs (v = 0 at the top of the atlas)
    const u = { uSwimPhase: { value: i * 2.1 }, uSwimAmp: { value: 0.005 }, uFinPhase: { value: i * 1.3 }, uFinAmp: { value: 0.35 }, uBreath: { value: 0 }, uPecOpen: { value: 0.3 }, uCurve: { value: 0 } };
    const body = new THREE.SkinnedMesh(fishGeo.body, fishMaterial('body', map, u));
    // fins: first write their depth only, then draw the colour over that depth. Only the nearest fin layer is blended,
    // so lobes crossing each other or the body never pop in front/behind as the view turns.
    const finDepth = new THREE.SkinnedMesh(fishGeo.fin, fishMaterial('finDepth', map, u)); finDepth.renderOrder = 1;
    const fin = new THREE.SkinnedMesh(fishGeo.fin, fishMaterial('fin', map, u)); fin.renderOrder = 2;
    for (const m of [body, finDepth, fin]) { m.frustumCulled = false; m.userData.fishId = f.id; }
    body.castShadow = STD; finDepth.castShadow = STD;
    // skeleton: root bone + base/tip bone per pectoral and pelvic fin (built from the fin attachments)
    const bones = fishGeo.bones.map(b => { const bone = new THREE.Bone(); bone.name = b.name; bone.position.fromArray(b.pos); return bone; });
    fishGeo.bones.forEach((b, k) => { if (b.parent >= 0) bones[b.parent].add(bones[k]); });
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
      const rest = new THREE.Quaternion().setFromAxisAngle(hinge, best * 0.7);
      finBones.push({ base: bones[k], tip, hinge, sweep, rest, pec: b.name.startsWith('pectoral'), side: b.name.includes('_L_') ? 1 : -1 });
    });
    const root = new THREE.Group(); root.add(rig); root.scale.setScalar(f.length_cm / 12); root.rotation.order = 'YZX';
    root.userData.fishId = f.id; scene.add(root);
    fishes.push({ id: f.id, root, u, finBones, path: PATHS[f.id] || { c: [0, 0.18, 0.04], a: [0.14, 0.01, 0.03], w: 0.18, ph: i }, t: i * 7.3, paused: false });
  }
  const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
  function updateFish(F, dt) {
    if (!F.paused) F.t += dt;
    const { p, v } = pathAt(F.path, F.t), hs = Math.hypot(v[0], v[2]);
    F.root.position.set(...p);
    // heading eases toward the path direction (no snapping); the body stays level (no banking) and curves into the turn
    const yaw = Math.atan2(v[2], -v[0]);
    if (F.yawS === undefined) F.yawS = yaw;
    let dy = Math.atan2(Math.sin(yaw - F.yawS), Math.cos(yaw - F.yawS));
    const prev = F.yawS; F.yawS += dy * Math.min(1, dt * 2.2);
    const rate = dt > 0 && !F.paused ? Math.atan2(Math.sin(F.yawS - prev), Math.cos(F.yawS - prev)) / dt : 0;
    F.turn = (F.turn ?? 0) + (rate - (F.turn ?? 0)) * Math.min(1, dt * 3);
    F.pitch = (F.pitch ?? 0) + (-Math.atan2(v[1], hs) * 0.6 - (F.pitch ?? 0)) * Math.min(1, dt * 1.5);
    F.root.rotation.set(0, F.yawS, F.pitch);
    F.u.uCurve.value = THREE.MathUtils.clamp(F.turn * 0.05, -0.03, 0.03);
    const speed = F.paused ? 0 : Math.hypot(...v);
    F.u.uSwimPhase.value += dt * (F.paused ? 1.2 : 5.5 + 55 * speed + 4 * Math.abs(F.turn));
    F.u.uSwimAmp.value = F.paused ? 0.0012 : 0.0035 + 0.011 * Math.min(Math.abs(F.turn), 0.4) + 0.03 * speed;
    F.u.uFinPhase.value += dt * (F.paused ? 1.6 : 3.2 + 30 * speed);
    F.u.uFinAmp.value = F.paused ? 0.1 : 0.16 + 1.2 * speed;
    F.u.uPecOpen.value = F.paused ? 0.75 : 0.55 + 0.5 * Math.min(Math.abs(F.turn), 0.6);
    F.u.uBreath.value = Math.sin(performance.now() * 0.0042 + F.path.ph);
    // paired fins: the base bone rows (sweep) and opens/closes (about the attachment line); the tip bone lags behind
    const ph = F.u.uFinPhase.value, open = F.u.uPecOpen.value;
    for (const B of F.finBones) {
      const p = ph * (B.pec ? 0.9 : 0.55) + (B.side > 0 ? 0 : 0.6) + (B.pec ? 0 : 1.1);
      if (B.pec) {            // pectoral: big rowing strokes, opening wide on the forward stroke
        const row = (0.55 + 0.6 * open) * Math.sin(p);
        const abd = (0.35 + 0.6 * open) * (0.5 + 0.5 * Math.sin(p + 1.57));
        _q1.setFromAxisAngle(B.sweep, row); _q2.setFromAxisAngle(B.hinge, abd * B.side);
        B.base.quaternion.multiplyQuaternions(_q1, _q2);
        B.tip.quaternion.setFromAxisAngle(B.sweep, 0.3 * (0.4 + open) * Math.sin(p - 0.9));
      } else {                // pelvic: held pointing down, only a small trim
        _q1.setFromAxisAngle(B.sweep, 0.1 * Math.sin(p)); _q2.setFromAxisAngle(B.hinge, 0.06 * B.side * Math.sin(p + 1.2));
        B.base.quaternion.copy(B.rest).multiply(_q1).multiply(_q2);
        B.tip.quaternion.setFromAxisAngle(B.sweep, 0.05 * Math.sin(p - 0.7));
      }
    }
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
        uTint: { value: new THREE.Color(0x9cc9d3) }, uSky: { value: new THREE.Color(0x46525d) }, uHalf: { value: new THREE.Vector2(W / 2, D / 2) },
      },
      vertexShader: `
        uniform float uTime; uniform mat4 uReflVP; varying vec3 vW; varying vec4 vReflClip; varying vec3 vN;
        float wave(vec2 p, float t){ return 0.0010*sin(p.x*31.+t*1.3) + 0.0007*sin(p.y*43.-t*1.1+p.x*9.) + 0.0004*sin((p.x+p.y)*71.+t*2.1) + 0.00025*sin(p.x*131.-p.y*97.+t*2.7); }
        void main(){
          vec4 w = modelMatrix * vec4(position,1.);
          float e = 0.0006;
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
          vec2 off = vN.xz * 0.25;
          vec3 refr = uUseRT > .5 ? texture2D(uRefr, clamp(sUV + off, 0.001, .999)).rgb : uTint;
          vec3 col;
          if (above) {
            float fres = 0.03 + 0.55 * pow(1. - cosT, 5.);
            col = mix(refr * mix(vec3(1.), uTint, .2), uSky, fres);
          } else {
            vec2 rUV = vReflClip.xy / vReflClip.w * .5 + .5;
            vec3 refl = uUseRT > .5 ? texture2D(uRefl, clamp(rUV + off, 0.001, .999)).rgb : uTint * .7;
            float tir = 1. - smoothstep(0.6, 0.72, cosT);          // total internal reflection past ~48.6 deg
            col = mix(refr * 0.85 + uTint * 0.15, max(refl, uTint * 0.8), max(tir, 0.3) * 0.8);
          }
          vec3 L = normalize(vec3(0.05, 1., 0.12));
          float spec = pow(max(dot(reflect(-L, vN), V), 0.), 120.);
          col += spec * 0.9 + pow(max(dot(reflect(-L, vN), V), 0.), 900.) * 2.5;   // broad sheen + sharp glints
          vec2 edge = uHalf - abs(vW.xz);                          // meniscus along the glass
          col += 0.14 * (1. - smoothstep(0.0, 0.004, min(edge.x, edge.y)));
          gl_FragColor = vec4(col, uUseRT > .5 ? 1. : 0.25 + 0.4 * (1. - cosT));
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
  controls.enableDamping = true; controls.minDistance = 0.2; controls.maxDistance = 2.2;
  controls.maxPolarAngle = Math.PI * 0.62; controls.target.set(0, 0.16, 0);
  function fitDistance(margin = 1.08) {
    const vFov = THREE.MathUtils.degToRad(camera.fov), hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    return Math.max((W / 2 * margin) / Math.tan(hFov / 2) + D / 2, (H / 2 * margin) / Math.tan(vFov / 2) + D / 2);
  }
  const VIEWS = {
    front: () => [[0, 0.18, fitDistance()], [0, 0.165, 0]],
    oblique: () => { const d = fitDistance(1.02); return [[-d * 0.5, 0.18 + d * 0.3, d * 0.8], [0, 0.13, 0]]; },
    top: () => [[0, fitDistance(1.15) + WL, 0.001], [0, 0, 0]],
  };
  function setView(n) { stopWatching(); const [p, t] = VIEWS[n](); camera.position.set(...p); controls.target.set(...t); controls.update(); }
  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));

  // ---------- watch one fish ----------
  let watchId = null; const watchPrev = new THREE.Vector3(), watchNow = new THREE.Vector3();
  function watchDistance() {           // fit the whole fish (about 0.16 m with the tail) across the narrower side
    const vFov = THREE.MathUtils.degToRad(camera.fov), hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    return Math.max(0.16, 0.085 / Math.tan(Math.min(hFov, vFov) / 2));
  }
  function startWatching(id) {
    const F = fishes.find(f => f.id === id); if (!F) return;
    if (mode === 'edit') setMode('view');
    for (const f of fishes) f.paused = false;
    watchId = id;
    F.root.getWorldPosition(watchNow);
    const s = LIB.watchStart([watchNow.x, watchNow.y, watchNow.z], F.yawS ?? 0, { aspect: camera.aspect, distance: watchDistance() });
    camera.position.set(...LIB.clampWatchCamera(s.camera, { w: W, d: D }, { floorY: 0.07 })); controls.target.set(...s.target);
    controls.minDistance = 0.06; controls.update(); watchPrev.copy(watchNow);
    const [name, sci, text] = INFO[id];
    $('info-name').textContent = name; $('info-sci').textContent = sci; $('info-text').textContent = text;
    $('info').hidden = false; $('info').classList.remove('open');
    $('watch-select').value = id; $('watch-bar').hidden = false; $('views').hidden = true;
    $('watch-pause').setAttribute('aria-pressed', 'false'); $('watch-pause').textContent = '止める';
    for (const m of plantMats) { m.transparent = true; m.opacity = 0.22; m.depthWrite = false; m.needsUpdate = true; }
    renderer.setClearColor(WATER, 1); resize();
  }
  function stopWatching() {
    if (!watchId) return;
    for (const f of fishes) f.paused = false;
    watchId = null; $('info').hidden = true; $('watch-select').value = ''; $('watch-bar').hidden = true; $('views').hidden = false;
    controls.minDistance = 0.2;
    for (const m of plantMats) { m.transparent = false; m.opacity = 1; m.depthWrite = true; m.needsUpdate = true; }
    renderer.setClearColor(ROOM, 1); resize();
  }
  function followWatched() {
    if (!watchId) return;
    const F = fishes.find(f => f.id === watchId);
    F.root.getWorldPosition(watchNow);
    const d = LIB.followDelta([watchPrev.x, watchPrev.y, watchPrev.z], [watchNow.x, watchNow.y, watchNow.z]);
    camera.position.x += d[0]; camera.position.y += d[1]; camera.position.z += d[2];
    controls.target.x += d[0]; controls.target.y += d[1]; controls.target.z += d[2];
    camera.position.set(...LIB.clampWatchCamera([camera.position.x, camera.position.y, camera.position.z], { w: W, d: D }, { floorY: 0.07 }));
    watchPrev.copy(watchNow);
  }
  $('watch-select').addEventListener('change', e => { if (e.target.value) startWatching(e.target.value); else setView('front'); });
  $('watch-next').addEventListener('click', () => startWatching(LIB.nextWatchId(fishes.map(f => f.id), watchId)));
  $('watch-end').addEventListener('click', () => setView('front'));
  $('watch-pause').addEventListener('click', () => {
    const F = fishes.find(f => f.id === watchId); if (!F) return;
    F.paused = !F.paused; $('watch-pause').setAttribute('aria-pressed', F.paused); $('watch-pause').textContent = F.paused ? '泳がせる' : '止める';
  });
  $('info-text').addEventListener('click', () => $('info').classList.toggle('open'));

  function resize() {
    const r = stage.getBoundingClientRect();
    const size = LIB.aquariumDrawingSize(quality, r.width, r.height, devicePixelRatio);
    renderer.setPixelRatio(size.pixelRatio); renderer.setSize(size.cssWidth, size.cssHeight, false);
    camera.aspect = size.cssWidth / size.cssHeight; camera.fov = camera.aspect < 1 ? 48 : 34; camera.updateProjectionMatrix();
    const dw = size.drawingWidth, dh = size.drawingHeight;
    if (rtRefr) { rtRefr.setSize(dw >> 1, dh >> 1); rtRefl.setSize(dw >> 1, dh >> 1); }
    surfRes?.set(dw, dh);
    // panels sit just above the control bar, which wraps to several rows on narrow screens
    const bh = document.querySelector('.bar').offsetHeight;
    $('edit-panel').style.bottom = bh + 6 + 'px';
    $('info').style.bottom = r.width <= 600 ? bh + 8 + 'px' : '';
  }

  // ---------- editing ----------
  let mode = 'view', selected = null, drag = null;
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
  const ring = new THREE.Mesh(new THREE.RingGeometry(1, 1.08, 64), new THREE.MeshBasicMaterial({ color: 0xd9a441, transparent: true, opacity: .85, depthTest: false }));
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
  function select(id) { selected = id; ring.visible = !!id; $('obj-select').value = id || ''; updatePanel(); }
  function updatePanel() {
    if (!selected) { $('obj-controls').hidden = true; return; }
    const e = editables.get(selected), o = state.snapshot().objects.find(o => o.id === selected);
    $('obj-controls').hidden = false;
    $('pos-x').value = (o.position[0] / cm).toFixed(1); $('pos-z').value = (o.position[2] / cm).toFixed(1);
    $('rot-y').value = Math.round(THREE.MathUtils.radToDeg(o.rotation[1]) % 360);
    $('stone-color').hidden = e.kind !== 'stone';
    if (e.kind === 'stone') document.querySelectorAll('[data-color]').forEach(b => b.setAttribute('aria-pressed', b.dataset.color === o.colorId));
    ring.scale.setScalar(e.radius + 0.008); ring.position.set(e.root.position.x, e.root.position.y + 0.002, e.root.position.z);
  }
  function setTransform(id, x, z, ry) { const [cx, cz] = clampPos(id, x, z); state.setTransform(id, { position: [cx, 0, cz], rotation: [0, ry, 0] }); applyState(); save(); }
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
  document.querySelectorAll('[data-all-color]').forEach(b => b.addEventListener('click', () => { state.setAllStoneColors(b.dataset.allColor); applyState(); save(); }));
  $('reset').addEventListener('click', () => { state.restoreDefault(); applyState(); save(); flash('承認した配置と色に戻しました'); });
  function flash(text) { const n = $('toast'); n.textContent = text; n.hidden = false; clearTimeout(flash.t); flash.t = setTimeout(() => n.hidden = true, 2200); }

  function setRay(ev) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
  }
  function pickEditable(ev) {
    setRay(ev);
    const hits = ray.intersectObjects([...editables.values()].map(e => e.root), true);
    for (const h of hits) { let o = h.object; while (o && !o.userData.id) o = o.parent; if (o) return { id: o.userData.id, point: h.point }; }
    return null;
  }
  function pickFish(ev) {               // the first thing hit must be a fish (not a stone in front of it)
    setRay(ev);
    const targets = [...fishes.map(f => f.root), ...[...editables.values()].filter(e => e.kind === 'stone').map(e => e.root)];
    const h = ray.intersectObjects(targets, true)[0];
    return h?.object.userData.fishId || null;
  }
  let down = null;
  canvas.addEventListener('pointerdown', ev => {
    down = { x: ev.clientX, y: ev.clientY };
    if (mode !== 'edit') return;
    const p = pickEditable(ev);
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
    setRay(ev);
    if (!ray.ray.intersectPlane(plane, hit)) return;
    const o = current(drag.id);
    const [cx, cz] = clampPos(drag.id, hit.x + drag.dx, hit.z + drag.dz);
    state.setTransform(drag.id, { position: [cx, 0, cz], rotation: o.rotation }); applyState();
  });
  const endDrag = ev => {
    if (mode === 'view' && down && LIB.isTap(down, { x: ev.clientX, y: ev.clientY })) { const id = pickFish(ev); if (id) startWatching(id); }
    down = null;
    if (!drag) return; if (ev.pointerId === drag.pointer) { drag = null; controls.enabled = true; save(); }
  };
  canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', () => { down = null; if (drag) { drag = null; controls.enabled = true; save(); } });

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
  function step(dt) {
    t += dt; uniformsCommon.uTime.value = t;
    for (const F of fishes) updateFish(F, dt);
    updateWaterLife(t);
    followWatched();
  }
  function draw() { controls.update(); if (STD && surface) renderWaterPasses(); renderer.render(scene, camera); }
  function loop() {
    requestAnimationFrame(loop);
    if (document.hidden) { clock.getDelta(); return; }
    const d = Math.min(clock.getDelta(), 0.1); acc += d;
    if (acc < frameMin * 0.95) return;
    const dt = Math.min(acc, 0.1); acc = 0;
    step(dt); draw();
  }

  // ---------- start ----------
  (async () => {
    try {
      say('水槽を準備しています…');
      const [blueT, redT] = await Promise.all([tex(A.textures['stone-blue'], { repeat: [1, 1] }), tex(A.textures['stone-red'], { repeat: [1, 1] })]);
      stoneMats = { blue: stoneMaterial(blueT), red: stoneMaterial(redT) };
      await buildTank();
      for (const o of L.objects) { if (o.kind === 'stone') makeStone(o); if (o.kind === 'plant') makePlant(o); }
      const sel = $('obj-select');
      for (const o of approved) sel.append(new Option(editables.get(o.id).label, o.id));
      if (loadSaved()) flash('前回の配置を読み込みました');
      applyState();
      surfRes = buildWater();
      resize(); setView('front');
      addEventListener('resize', resize);
      say('金魚を呼んでいます…');
      await loadFishGeometry();
      for (const [i, f] of L.fish.entries()) await loadFish(f, i);   // one at a time: lower peak memory on phones
      for (const f of L.fish) $('watch-select').append(new Option('観察：' + INFO[f.id][0], f.id));
      status.hidden = true;
      step(0.016); loop();
      window.__aquarium = {                    // for automated checks
        advance(sec) { for (let k = 0; k < Math.round(sec * 30); k++) step(1 / 30); draw(); },
        watch: startWatching, view: setView, mode: setMode, state, fishes, select, camera, controls,
      };
    } catch (e) {
      console.error(e);
      say('読み込みに失敗しました。通信状態を確かめて再読み込みしてください。（' + (e.message || e) + '）', true);
    }
  })();
  setMode('view');
})();
