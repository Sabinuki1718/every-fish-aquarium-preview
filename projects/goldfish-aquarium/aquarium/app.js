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
      tex(A.textures.background), tex(A.textures['gravel-oiso'], { repeat: [3.2, 1.6] }), tex(A.textures['gravel-oiso-n'], { repeat: [3.2, 1.6], srgb: false })]);
    const [gravelH, sideT] = await Promise.all([tex(A.textures['gravel-oiso-h'], { repeat: [3.2, 1.6], srgb: false }), tex(A.textures['gravel-side'], { repeat: [2, 1] })]);
    // back screen: one-sided, facing the front (seen through the back glass from behind: hidden)
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: bgT, side: THREE.FrontSide, toneMapped: false }));
    bg.position.set(0, H / 2, -D / 2 - 0.003); scene.add(bg);
    // gravel bed: top surface + sides + bottom (closed, opaque)
    const gm = new THREE.MeshStandardMaterial({ map: gravelT, normalMap: gravelN, normalScale: new THREE.Vector2(1.4, 1.4), roughness: 0.8 });
    // parallax (pebbles stand out when seen at a slant) + large-scale colour drift so the tile repeat does not show
    gm.onBeforeCompile = sh => {
      injectCaustics(sh);
      sh.fragmentShader = sh.fragmentShader.replace('diffuseColor.rgb *= 1. + uCaustic *', 'diffuseColor.rgb *= 1. + 0.6 * uCaustic *');
      sh.uniforms.uHeight = { value: gravelH };
      const PUV = `vec2 pUv = vMapUv;
        {
          vec3 Vw = normalize(cameraPosition - vWorldC);
          vec2 dir = vec2(Vw.x, -Vw.z) / max(Vw.y, 0.25);
          for (int i = 0; i < ${STD ? 4 : 2}; i++) { float hh = texture2D(uHeight, pUv).r; pUv = vMapUv + dir * (hh - 0.55) * 0.006; }
        }`;
      sh.fragmentShader = 'uniform sampler2D uHeight;\n' + sh.fragmentShader
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + PUV)
        .replace('#include <map_fragment>', THREE.ShaderChunk.map_fragment.replace(/vMapUv/g, 'pUv') + `
          float drift = 0.5 + 0.5 * sin(vWorldC.x * 13. + 1.7) * sin(vWorldC.z * 17. + 0.4) * sin((vWorldC.x - vWorldC.z) * 7.);
          diffuseColor.rgb *= 0.86 + 0.28 * drift;`)
        .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replace(/vNormalMapUv/g, 'pUv'));
      // caustics already applied above; injectCaustics added its own after map_fragment, which we replaced
    };
    gm.customProgramCacheKey = () => 'gravel-pom';
    const g = new THREE.PlaneGeometry(W - 0.001, D - 0.001, 120, 60); g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      p.setY(i, ground(x, z) + 0.0012 * Math.sin(x * 83 + 1.3) * Math.cos(z * 97) + 0.0008 * Math.sin(x * 211 + z * 173));
    }
    g.computeVertexNormals();
    const floor = new THREE.Mesh(g, gm); floor.receiveShadow = STD; scene.add(floor);
    const sideMat = { map: sideT };     // photo of the gravel layer seen through the front glass
    const skirt = (x0, z0, x1, z1) => {               // vertical strip from the floor of the tank up to the bed surface
      const n = 60, pos = [], uv = [], idx = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
        pos.push(x, 0, z, x, ground(x, z), z); uv.push(t * (Math.abs(x1 - x0) + Math.abs(z1 - z0)) / W, 0, t * (Math.abs(x1 - x0) + Math.abs(z1 - z0)) / W, ground(x, z) / 0.06);
        if (i < n) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      }
      const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      sg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); sg.setIndex(idx); sg.computeVertexNormals();
      scene.add(new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ map: sideMat.map, roughness: 0.9, side: THREE.DoubleSide })));
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
    if (STD) scatterPebbles(gravelT);
  }

  // ---------- loose 3D pebbles on the bed (standard quality): colours picked from the gravel photo ----------
  function scatterPebbles(gravelT) {
    const img = gravelT.image, c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0, 64, 64); const px = g.getImageData(0, 0, 64, 64).data;
    const geo = new THREE.IcosahedronGeometry(1, 2);
    const p = geo.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); v.y *= 0.62; v.multiplyScalar(1 + 0.06 * Math.sin(v.x * 5 + v.z * 3)); p.setXYZ(i, v.x, v.y, v.z); }
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0 });
    mat.onBeforeCompile = sh => { injectCaustics(sh, '#include <color_fragment>'); sh.fragmentShader = sh.fragmentShader.replace('diffuseColor.rgb *= 1. + uCaustic *', 'diffuseColor.rgb *= 1. + 0.45 * uCaustic *'); };
    mat.customProgramCacheKey = () => 'pebble';
    const N = 5200, mesh = new THREE.InstancedMesh(geo, mat, N), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
    const rnd = seeded('pebbles');
    for (let i = 0; i < N; i++) {
      const front = i < 2600;                    // half of them along the front glass, where you look closest
      const x = (rnd() - 0.5) * (W - 0.006), z = front ? D / 2 - 0.003 - rnd() * 0.07 : (rnd() - 0.5) * (D - 0.006);
      const r = 0.0011 + rnd() * rnd() * 0.0014;
      q.setFromEuler(new THREE.Euler(rnd() * 0.5, rnd() * 6.3, rnd() * 0.5));
      m4.compose(new THREE.Vector3(x, ground(x, z) + r * 0.15, z), q, new THREE.Vector3(r * (0.8 + rnd() * 0.5), r, r * (0.8 + rnd() * 0.5)));
      mesh.setMatrixAt(i, m4);
      const k = ((rnd() * 64) | 0) * 4 + ((rnd() * 64) | 0) * 256;
      col.setRGB(px[k] / 255, px[k + 1] / 255, px[k + 2] / 255, THREE.SRGBColorSpace).multiplyScalar(0.8); mesh.setColorAt(i, col);
    }
    mesh.receiveShadow = true; scene.add(mesh);
  }

  // ---------- in-water atmosphere: haze, suspended specks, light shafts ----------
  scene.fog = new THREE.FogExp2(0x6fa3b2, 0.2);          // slight blue-green haze: the back of the tank recedes
  let specks, shafts = []; const shaftSide = { value: 1 }, _camDir = new THREE.Vector3();   // shafts fade out when seen from above
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
      uniforms: { uTime: uniformsCommon.uTime, uSeed: { value: seed }, uI: { value: STD ? 0.085 : 0.06 }, uSide: shaftSide },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
      fragmentShader: `uniform float uTime; uniform float uSeed; uniform float uI; uniform float uSide; varying vec2 vUv;
        void main(){
          float x = vUv.x;
          float band = 0.5 + 0.5 * sin(x * 9. + uTime * 0.23 + uSeed) * sin(x * 23. - uTime * 0.17 + uSeed * 2.);
          float edge = smoothstep(0., .35, x) * smoothstep(1., .65, x);
          float flick = 0.65 + 0.35 * sin(uTime * 0.4 + uSeed * 3.1);
          float a = uI * uSide * band * edge * flick * pow(vUv.y, 1.6);
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
  // Stones: four shapes the user made with Tripo in one generation (tall / crouch / mound / slab), cut apart and
  // simplified offline (tools/make_stones.py). Each layout stone uses one shape, scaled uniformly to its approved size.
  const STONE_SHAPE = { 'stone-1': 'tall', 'stone-2': 'crouch', 'stone-3': 'mound', 'stone-4': 'crouch', 'stone-5': 'mound', 'stone-6': 'slab', 'stone-7': 'slab' };
  let stoneShapes = {};
  async function loadStoneShapes() {
    const res = await fetch(A.stones); if (!res.ok) throw new Error('石のモデルを読み込めませんでした');
    const d = await res.json();
    for (const [k, v] of Object.entries(d.shapes)) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(v.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(v.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(v.uv, 2)); g.setIndex(v.i); g.computeBoundingSphere();
      stoneShapes[k] = { geo: g, size: v.size };
    }
  }
  function tripoStoneMaterial(map, normalMap, rmMap, warm) {
    const m = new THREE.MeshStandardMaterial({ map, normalMap, roughnessMap: rmMap, roughness: 1, metalness: 0 });
    m.onBeforeCompile = sh => {
      injectCaustics(sh);
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        { float l = dot(diffuseColor.rgb, vec3(.3,.59,.11));
          diffuseColor.rgb = ${warm ? 'mix(vec3(l), diffuseColor.rgb, 0.12) * (0.32 + 0.35 * l)' : 'mix(vec3(l), diffuseColor.rgb, 0.42) * vec3(0.95, 0.98, 1.0)'}; }`);
    };
    m.customProgramCacheKey = () => 'stone-tripo-' + (warm ? 'black' : 'blue');
    return m;
  }
  function makeStone(o) {
    const shape = stoneShapes[STONE_SHAPE[o.id] || 'crouch'];
    const mesh = new THREE.Mesh(shape.geo, stoneMats[o.color === 'black' ? 'black' : 'blue']);
    const want = o.size.map(v => v * cm), sc = Math.cbrt(want[0] / shape.size[0] * want[1] / shape.size[1] * want[2] / shape.size[2]);
    mesh.scale.setScalar(sc);
    mesh.rotation.y = THREE.MathUtils.degToRad(o.tilt?.[1] || 0);
    mesh.position.y = -0.004;                   // bedded a few millimetres into the gravel
    mesh.castShadow = mesh.receiveShadow = STD;
    const root = new THREE.Group(); root.add(mesh); root.userData.id = o.id; scene.add(root);
    const r = Math.max(shape.size[0], shape.size[2]) * sc / 2;
    editables.set(o.id, { root, mesh, kind: 'stone', radius: r, label: '石' + o.id.split('-')[1] + '（' + (o.role || '石') + '）', sink: 0 });
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
  // Vallisneria: a rosette plant. Each plant is a crown at the gravel from which ribbon leaves rise (young leaves in the
  // centre, shorter and upright; older ones outside, longer and leaning out); plants stand in short rows along runners.
  function vallisneria(o) {
    const rnd = seeded(o.id), pos = [], col = [], sway = [], idx = [], leaf = [], c = new THREE.Color();
    const nPlants = Math.max(3, Math.round(o.count / 4.5)), plants = [];
    let rx = (rnd() - 0.5) * 0.02, rz = (rnd() - 0.5) * 0.02, ra = rnd() * Math.PI * 2;
    for (let k = 0; k < nPlants; k++) {                  // walk along a wandering runner, 1.5-3 cm per daughter plant
      plants.push([rx, rz, 0.65 + 0.4 * rnd() * (k === 0 ? 0 : 1) + (k === 0 ? 0.4 : 0)]);
      ra += (rnd() - 0.5) * 1.6; const step = 0.015 + rnd() * 0.015;
      rx = THREE.MathUtils.clamp(rx + Math.cos(ra) * step, -0.03, 0.03); rz = THREE.MathUtils.clamp(rz + Math.sin(ra) * step, -0.025, 0.025);
    }
    const strip = (pts, w, color, t0) => {               // flat ribbon through pts (used for runners)
      const base = pos.length / 3;
      pts.forEach((q, i) => { for (const sd of [-0.5, 0.5]) { pos.push(q[0], q[1], q[2] + sd * w); col.push(color.r, color.g, color.b); sway.push(t0); leaf.push(sd + 0.5, 0); } if (i) { const a2 = base + (i - 1) * 2; idx.push(a2, a2 + 2, a2 + 1, a2 + 1, a2 + 2, a2 + 3); } });
    };
    const runC = new THREE.Color().setHSL(0.2, 0.35, 0.42);
    for (let k = 1; k < plants.length; k++) strip([[plants[k - 1][0], -0.001, plants[k - 1][1]], [plants[k][0], -0.0005, plants[k][1]]], 0.0012, runC, 0);
    for (const [px, pz, vigor] of plants) {
      const nLeaves = 4 + Math.floor(rnd() * 4 + vigor * 2), spin = rnd() * Math.PI * 2;
      for (let lf = 0; lf < nLeaves; lf++) {
        const age = (lf + 0.5) / nLeaves;               // 0 = youngest (centre) .. 1 = oldest (outside)
        const h = Math.min(o.height * cm * vigor * (0.45 + 0.6 * age) * (0.85 + 0.25 * rnd()), o.maxH ?? 1);
        const w = (0.0055 + 0.004 * age) * (0.9 + 0.2 * rnd());
        const dirA = spin + lf * 2.4;                    // leaves spiral out of the crown (golden angle)
        const lean = 0.04 + 0.16 * age * (0.6 + 0.6 * rnd());
        const droop = age > 0.7 ? (rnd() * 0.25) * (age - 0.7) / 0.3 : 0;
        const twist = rnd() * 2, segs = STD ? 36 : 24;
        c.setHSL(0.24 + rnd() * 0.05, 0.55 + rnd() * 0.15, 0.2 + 0.08 * (1 - age) + rnd() * 0.05);
        let dx = Math.cos(dirA), dz = Math.sin(dirA);
        if (o.wall) {                                    // near the glass: lean back into the tank, not through it
          const wx = o.wall[0], wz = o.wall[1];          // unit vector pointing at the nearest walls (0 if far)
          const into = dx * wx + dz * wz;
          if (into > 0) { dx -= 1.6 * into * wx; dz -= 1.6 * into * wz; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l; }
        }
        let leanK = o.wall && (o.wall[0] || o.wall[1]) ? 0.55 : 1;   // by the glass the leaves stand more upright
        for (const st of o.stones || []) {               // and they never grow into a stone of the approved layout
          for (const tt of [0.25, 0.5, 0.8, 1]) {
            const ox = px + dx * lean * leanK * h * Math.pow(tt, 1.6), oz = pz + dz * lean * leanK * h * Math.pow(tt, 1.6);
            const wx2 = o.at[0] + ox - st[0], wz2 = o.at[1] + oz - st[1];
            if (Math.hypot(wx2, wz2) < st[2] + 0.008 && tt * h < st[3] + 0.01) {
              const l = Math.hypot(wx2, wz2) || 1; dx = wx2 / l; dz = wz2 / l; leanK *= 0.4; break;
            }
          }
        }
        const base = pos.length / 3;
        for (let si = 0; si <= segs; si++) {
          const t = si / segs, y = t * h - 0.006;
          const out = lean * leanK * h * Math.pow(t, 1.6) + droop * h * Math.pow(t, 3);
          const yy = y - droop * h * 0.6 * Math.pow(t, 3);
          const tipW = t < 0.94 ? 1 : Math.sqrt(Math.max(0, (1 - t) / 0.06)) * 0.85 + 0.15;
          const ww = w * tipW * (t < 0.06 ? 0.55 + 7.5 * t : 1) * (si % 2 && t > 0.85 ? 1.06 : 1);
          const tw = Math.sin(t * 3 + twist) * 1.2 + dirA + Math.PI / 2;
          for (const sd of [-0.5, 0.5]) {
            pos.push(px + dx * out + Math.cos(tw) * sd * ww, yy, pz + dz * out + Math.sin(tw) * sd * ww);
            const sh = 0.7 + 0.42 * t; col.push(c.r * sh, c.g * sh, c.b * sh); sway.push(t * Math.min(1, h / 0.15)); leaf.push(sd + 0.5, t);
          }
          if (si < segs) { const a2 = base + si * 2; idx.push(a2, a2 + 2, a2 + 1, a2 + 1, a2 + 2, a2 + 3); }
        }
      }
      // pale crown at the gravel
      const crown = new THREE.Color().setHSL(0.17, 0.3, 0.55);
      strip([[px - 0.003, 0.0005, pz], [px + 0.003, 0.0005, pz]], 0.004, crown, 0);
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
    // leaves stop 1 cm under the water surface wherever the clump stands (the bed is higher at the back)
    const px = o.pos[0] * cm, pz = o.pos[2] * cm, near = 0.09;
    const wall = [px < -W / 2 + near ? -1 : px > W / 2 - near ? 1 : 0, pz < -D / 2 + near ? -1 : pz > D / 2 - near ? 1 : 0];
    const stones = L.objects.filter(s2 => s2.kind === 'stone').map(s2 => [s2.pos[0] * cm, s2.pos[2] * cm, Math.max(s2.size[0], s2.size[2]) * cm * 0.55, s2.size[1] * cm]);
    const geo = isVal ? vallisneria({ ...o, maxH: WL - ground(px, pz) - 0.012, wall, stones, at: [px, pz] }) : cabomba(o);
    geo.computeBoundingBox();
    const bb = geo.boundingBox, reach = Math.max(-bb.min.x, bb.max.x, -bb.min.z, bb.max.z);   // real horizontal spread
    const ext = [-bb.min.x, bb.max.x, -bb.min.z, bb.max.z];                                  // spread toward -x, +x, -z, +z
    const mat = isVal ? (makePlant.val ??= plantMaterial('val', true)) : (makePlant.cab ??= plantMaterial('cab', false));
    const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = STD; mesh.frustumCulled = false;
    const root = new THREE.Group(); root.add(mesh); root.userData.id = o.id; scene.add(root);
    editables.set(o.id, { root, mesh, kind: 'plant', radius: reach, ext, label: (isVal ? 'バリスネリア' : 'カボンバ') + '（' + (o.role || o.id.replace('plant-', '')) + '）', sink: 0 });
  }

  // ---------- layout state (approved layout -> aquarium-state) ----------
  const approved = L.objects.filter(o => o.kind === 'stone' || o.kind === 'plant').map(o => ({
    id: o.id, kind: o.kind, position: [o.pos[0] * cm, 0, o.pos[2] * cm], rotation: [0, 0, 0],
    ...(o.kind === 'stone' ? { colorId: o.color === 'black' ? 'black' : 'blue' } : {}),
  }));
  const REVISION = 'layout-v' + L.version;
  const SAVE_KEY = 'karesansui-goldfish:aquarium:' + REVISION;
  const state = LIB.createAquariumState(approved, { palette: ['blue', 'black'], revision: REVISION });
  function clampPos(id, x, z) {
    const e = editables.get(id), m = 0.004;
    const rot = state.snapshot().objects.find(o => o.id === id)?.rotation[1] || 0;
    // plants keep inside the glass by their spread in each direction (when not turned); others by their radius
    const [ax, bx, az, bz] = e.ext && Math.abs(Math.sin(rot)) < 1e-3 && Math.cos(rot) > 0 ? e.ext : [e.radius, e.radius, e.radius, e.radius];
    return [Math.min(W / 2 - bx - m, Math.max(-W / 2 + ax + m, x)), Math.min(D / 2 - bz - m, Math.max(-D / 2 + az + m, z))];
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
    let minX = Infinity; for (let i = 0; i < d.p.length; i += 3) minX = Math.min(minX, d.p[i]);
    const m = [0, 0, 0]; let n = 0;
    for (let i = 0; i < d.p.length; i += 3) if (d.p[i] < minX + 0.004 && Math.abs(d.p[i + 2]) < 0.006) { m[0] += d.p[i]; m[1] += d.p[i + 1]; m[2] += d.p[i + 2]; n++; }
    fishGeo.mouth = new THREE.Vector3(m[0] / n, m[1] / n - 0.002, 0);      // lips, a little below the snout tip
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
  const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
  const ease = x => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);

  // ---- foraging: now and then a fish leaves its loop, glides down, tips nose-down and pecks the gravel, then returns ----
  // (Goldfish forage in many short bouts on the bottom, picking up grains and spitting them out: Smith & Gray 2011.)
  const PECK_PITCH = 0.95;                       // ~55 deg nose-down
  function mouthWorldOffset(F, yaw, pitch) {     // where the lips are relative to the fish origin for a given pose
    _e.set(0, yaw, pitch); return _v.copy(fishGeo.mouth).multiplyScalar(F.scale).applyEuler(_e).clone();
  }
  function pickForageSpot(F, from) {
    const stones = [...editables.values()].filter(e => e.kind === 'stone'), plants = [...editables.values()].filter(e => e.kind === 'plant');
    for (let k = 0; k < 40; k++) {
      const x = THREE.MathUtils.clamp(from[0] + (Math.random() - 0.5) * 0.16, -W / 2 + 0.07, W / 2 - 0.07);
      const z = 0.025 + Math.random() * (D / 2 - 0.055);
      const ok = stones.every(e => Math.hypot(e.root.position.x - x, e.root.position.z - z) > e.radius + 0.075)
              && plants.every(e => Math.hypot(e.root.position.x - x, e.root.position.z - z) > e.radius + 0.03)
              && fishes.every(o => o === F || o.mode === 'cruise' || Math.hypot(o.forage.spot[0] - x, o.forage.spot[2] - z) > 0.12);
      if (ok) return [x, ground(x, z) + 0.002, z];
    }
    return null;
  }
  // ---- surface gulping: rise, tilt nose-up and open/close the mouth at the waterline (ripples + a few bubbles) ----
  const GULP_PITCH = -0.55;                      // ~30 deg nose-up
  function startSurface(F, start) {
    const plants = [...editables.values()].filter(e => e.kind === 'plant');
    for (let k = 0; k < 30; k++) {
      const x = THREE.MathUtils.clamp(start[0] + (Math.random() - 0.5) * 0.14, -W / 2 + 0.08, W / 2 - 0.08);
      const z = THREE.MathUtils.clamp(start[2] + (Math.random() - 0.5) * 0.08, -D / 2 + 0.06, D / 2 - 0.05);
      if (!plants.every(e => Math.hypot(e.root.position.x - x, e.root.position.z - z) > e.radius + 0.035)) continue;
      if (!fishes.every(o => o === F || !['rise', 'gulp'].includes(o.mode) || Math.hypot(o.forage.spot[0] - x, o.forage.spot[2] - z) > 0.12)) continue;
      const yaw = Math.abs(x - start[0]) + Math.abs(z - start[2]) > 0.02 ? Math.atan2(z - start[2], -(x - start[0])) : F.yawS;
      F.mode = 'rise'; F.forage = { spot: [x, WL - 0.0008, z], start, yaw, t: 0, gulps: 4 + Math.floor(Math.random() * 5), dur: 4.2 };
      return;
    }
    F.nextForage = F.clock + 8;
  }
  function surfacePose(F, dt) {
    const G = F.forage; G.t += dt;
    const perch = (pitch, below) => { const m = mouthWorldOffset(F, G.yaw, pitch); return [G.spot[0] - m.x, G.spot[1] - below - m.y, G.spot[2] - m.z]; };
    if (F.mode === 'rise') {
      const s = ease(G.t / G.dur), sv = ease((G.t / G.dur - 0.1) / 0.9), end = perch(GULP_PITCH, 0.006);
      const p = [G.start[0] + (end[0] - G.start[0]) * s, G.start[1] + (end[1] - G.start[1]) * sv, G.start[2] + (end[2] - G.start[2]) * s];
      if (G.t >= G.dur) { F.mode = 'gulp'; G.t = 0; }
      return { p, yaw: G.yaw, pitch: GULP_PITCH * ease((G.t / G.dur - 0.35) / 0.65), speed: 0.02 * (1 - s), hover: s, brake: s > 0.85 ? 1 : 0, pump: 0 };
    }
    if (F.mode === 'gulp') {
      const CYC = 0.75, c = G.t / CYC, ph = c - Math.floor(c);
      const up = ph < 0.35 ? ease(ph / 0.35) : 1 - ease((ph - 0.35) / 0.65);     // lips break the surface on each gulp
      const p = perch(GULP_PITCH - 0.06 * up, 0.004 - 0.0045 * up);
      if (ph > 0.3 && !G.rippled) { G.rippled = true; addRipple(G.spot[0], G.spot[2], 1); if (Math.random() < 0.6) addBubbles(F, G, 3); }
      if (ph < 0.2) G.rippled = false;
      if (c >= G.gulps) { F.mode = 'sink'; G.t = 0; G.from = p; }
      return { p, yaw: G.yaw + 0.05 * Math.sin(G.t * 0.9), pitch: GULP_PITCH - 0.06 * up, speed: 0, hover: 1, brake: 0, pump: 0, gulp: Math.sin(ph * Math.PI * 2 - 1.2) };
    }
    const s = ease(G.t / G.dur), back = pathAt(F.path, F.t).p, sh = ease((G.t / G.dur - 0.1) / 0.9);
    const p = [G.from[0] + (back[0] - G.from[0]) * sh, G.from[1] + (back[1] - G.from[1]) * s, G.from[2] + (back[2] - G.from[2]) * sh];
    if (G.t >= G.dur) { F.mode = 'cruise'; F.nextForage = F.clock + 30 + Math.random() * 40; }
    const v = pathAt(F.path, F.t).v;
    return { p, yaw: s < 0.5 ? G.yaw : Math.atan2(v[2], -v[0]), pitch: GULP_PITCH * (1 - ease(G.t / (G.dur * 0.6))) + 0.2 * Math.sin(s * Math.PI), speed: 0.015 * s, hover: 1 - s, brake: 0, pump: 0 };
  }
  // ripples on the water surface: up to 6 expanding rings (x, z, start time, strength)
  const ripples = Array.from({ length: 6 }, () => new THREE.Vector4(0, 0, -100, 0)); let ripNext = 0;
  function addRipple(x, z, k) { ripples[ripNext].set(x, z, uniformsCommon.uTime.value, k); ripNext = (ripNext + 1) % ripples.length; }
  let bubbles;
  function addBubbles(F, G, n) {
    if (!bubbles) {
      const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d');
      const gr = g.createRadialGradient(16, 16, 9, 16, 16, 15); gr.addColorStop(0, 'rgba(255,255,255,0.15)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
      const N = 60, geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3).fill(-9), 3));
      bubbles = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.0028, map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
      bubbles.userData = { life: new Float32Array(N), seed: new Float32Array(N).map(() => Math.random() * 9), next: 0 }; bubbles.frustumCulled = false; scene.add(bubbles);
    }
    const P = bubbles.geometry.attributes.position, U = bubbles.userData;
    const m = mouthWorldOffset(F, G.yaw, GULP_PITCH).add(F.root.position);
    for (let k = 0; k < n; k++) { const i = U.next = (U.next + 1) % U.life.length; P.setXYZ(i, m.x + (Math.random() - .5) * 0.004, m.y - 0.006 - Math.random() * 0.004, m.z + (Math.random() - .5) * 0.004); U.life[i] = 3; }
  }
  function updateBubbles(dt, t) {
    if (!bubbles) return;
    const P = bubbles.geometry.attributes.position, U = bubbles.userData;
    for (let i = 0; i < U.life.length; i++) {
      if (U.life[i] <= 0) continue;
      U.life[i] -= dt; let y = P.getY(i) + 0.035 * dt;
      P.setX(i, P.getX(i) + 0.004 * dt * Math.sin(t * 6 + U.seed[i]));
      if (y >= WL - 0.001) { U.life[i] = 0; addRipple(P.getX(i), P.getZ(i), 0.25); }
      if (U.life[i] <= 0) P.setXYZ(i, -9, -9, -9); else P.setY(i, y);
    }
    P.needsUpdate = true;
  }

  function startForage(F, start) {
    const spot = pickForageSpot(F, start); if (!spot) { F.nextForage = F.clock + 8; return; }
    const yaw = Math.atan2(spot[2] - start[2], -(spot[0] - start[0]));
    F.mode = 'descend'; F.forage = { spot, start, yaw0: F.yawS, yaw, t: 0, pecks: 3 + Math.floor(Math.random() * 4), k: 0, dur: 4.5 };
  }
  function foragePose(F, dt) {                   // returns { p, yaw, pitch, speed, hover, pump, brake }
    if (F.mode === 'rise' || F.mode === 'gulp' || F.mode === 'sink') return surfacePose(F, dt);
    const G = F.forage; G.t += dt;
    const perch = (pitch, reach) => {          // fish origin that puts the lips `reach` metres above the spot
      const m = mouthWorldOffset(F, G.yaw, pitch);
      return [G.spot[0] - m.x, G.spot[1] + reach - m.y, G.spot[2] - m.z];
    };
    if (F.mode === 'descend') {
      const s = ease(G.t / G.dur), sv = ease((G.t / G.dur - 0.15) / 0.85);
      const end = perch(PECK_PITCH * 0.7, 0.012);
      const p = [G.start[0] + (end[0] - G.start[0]) * s, G.start[1] + (end[1] - G.start[1]) * sv, G.start[2] + (end[2] - G.start[2]) * s];
      if (G.t >= G.dur) { F.mode = 'peck'; G.t = 0; }
      return { p, yaw: G.yaw, pitch: PECK_PITCH * 0.7 * ease((G.t / G.dur - 0.3) / 0.7), speed: 0.02 * (1 - s), hover: s, brake: s > 0.8 ? 1 : 0, pump: 0 };
    }
    if (F.mode === 'peck') {
      const CYC = 1.15, c = G.t / CYC, ph = c - Math.floor(c);
      // one peck: lean in and touch (0-0.3), suck with the mouth working (0.3-0.6), pull back and spit (0.6-1)
      const touch = ph < 0.3 ? ease(ph / 0.3) : ph < 0.6 ? 1 : 1 - ease((ph - 0.6) / 0.4);
      const pitch = PECK_PITCH * (0.82 + 0.18 * touch);
      const p = perch(pitch, 0.012 * (1 - touch) + 0.0005);
      if (ph > 0.6 && !G.spat && Math.random() < 0.8) { G.spat = true; spitGravel(F, G); }
      if (ph < 0.3) G.spat = false;
      if (c >= G.pecks) { F.mode = 'ascend'; G.t = 0; G.from = p; G.pitchFrom = pitch; }
      return { p, yaw: G.yaw + 0.08 * Math.sin(Math.floor(c) * 2.3), pitch, speed: 0, hover: 1, brake: 0, pump: ph > 0.25 && ph < 0.65 ? 1 : 0.2 };
    }
    // ascend: back up to the loop (the loop's time was held while foraging)
    const s = ease(G.t / G.dur), back = pathAt(F.path, F.t).p;
    const p = [G.from[0] + (back[0] - G.from[0]) * ease((G.t / G.dur - 0.1) / 0.9), G.from[1] + (back[1] - G.from[1]) * s, G.from[2] + (back[2] - G.from[2]) * ease((G.t / G.dur - 0.1) / 0.9)];
    if (G.t >= G.dur) { F.mode = 'cruise'; F.nextForage = F.clock + 30 + Math.random() * 40; }
    const v = pathAt(F.path, F.t).v;
    return { p, yaw: s < 0.5 ? G.yaw : Math.atan2(v[2], -v[0]), pitch: G.pitchFrom * (1 - ease(G.t / (G.dur * 0.6))) - 0.25 * Math.sin(s * Math.PI), speed: 0.015 * s, hover: 1 - s, brake: 0, pump: 0 };
  }
  // a little puff of grit spat back out after a peck
  let grit;
  function buildGrit() {
    const n = 120, g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3).fill(-9), 3));
    grit = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.0022, color: 0x5d5448, transparent: true, opacity: 0.9, depthWrite: false }));
    grit.userData = { v: new Float32Array(n * 3), life: new Float32Array(n), next: 0 }; grit.frustumCulled = false; scene.add(grit);
  }
  function spitGravel(F, G) {
    if (!grit) buildGrit();
    const P = grit.geometry.attributes.position, U = grit.userData;
    const m = mouthWorldOffset(F, G.yaw, PECK_PITCH * 0.82).add(F.root.position);
    for (let k = 0; k < 6; k++) {
      const i = U.next = (U.next + 1) % U.life.length;
      P.setXYZ(i, m.x + (Math.random() - .5) * 0.003, m.y, m.z + (Math.random() - .5) * 0.003);
      U.v[i * 3] = (Math.random() - .5) * 0.04; U.v[i * 3 + 1] = 0.02 + Math.random() * 0.03; U.v[i * 3 + 2] = (Math.random() - .5) * 0.04; U.life[i] = 1.6;
    }
  }
  function updateGrit(dt) {
    if (!grit) return;
    const P = grit.geometry.attributes.position, U = grit.userData;
    for (let i = 0; i < U.life.length; i++) {
      if (U.life[i] <= 0) continue;
      U.life[i] -= dt; U.v[i * 3 + 1] -= 0.09 * dt; for (const a of [0, 1, 2]) U.v[i * 3 + a] *= 1 - 2.2 * dt;
      const x = P.getX(i) + U.v[i * 3] * dt, z = P.getZ(i) + U.v[i * 3 + 2] * dt; let y = P.getY(i) + U.v[i * 3 + 1] * dt;
      if (y < ground(x, z) + 0.001) { y = ground(x, z) + 0.001; U.v[i * 3] = U.v[i * 3 + 1] = U.v[i * 3 + 2] = 0; }
      P.setXYZ(i, x, y, z); if (U.life[i] <= 0) P.setXYZ(i, -9, -9, -9);
    }
    P.needsUpdate = true;
  }

  function updateFish(F, dt) {
    F.clock = (F.clock ?? 0) + (F.paused ? 0 : dt);
    let pose;
    if (F.mode === 'cruise') {
      if (!F.paused) F.t += dt;
      const { p, v } = pathAt(F.path, F.t), hs = Math.hypot(v[0], v[2]), sp = Math.hypot(...v);
      pose = { p, yaw: Math.atan2(v[2], -v[0]), pitch: -Math.atan2(v[1], hs) * 0.6, speed: F.paused ? 0 : sp, hover: F.paused ? 1 : 1 - ease((sp - 0.017) / 0.012), brake: 0, pump: 0 };
      if (!F.paused && F.clock > F.nextForage) { if (Math.random() < 0.4) startSurface(F, p); else startForage(F, p); }
    } else pose = F.paused ? { ...F.lastPose, speed: 0, hover: 1, brake: 0 } : foragePose(F, dt);
    F.lastPose = pose;
    F.root.position.set(...pose.p);
    // heading eases toward the wanted direction (rate-limited, no snapping); the body stays level and arcs into turns
    if (F.yawS === undefined) F.yawS = pose.yaw;
    const prev = F.yawS; F.yawS += THREE.MathUtils.clamp(angDiff(pose.yaw, F.yawS) * Math.min(1, dt * 2.2), -0.9 * dt, 0.9 * dt);
    const rate = dt > 0 && !F.paused ? angDiff(F.yawS, prev) / dt : 0;
    F.turn = (F.turn ?? 0) + (rate - (F.turn ?? 0)) * Math.min(1, dt * 3);
    F.pitch = (F.pitch ?? 0) + (pose.pitch - (F.pitch ?? 0)) * Math.min(1, dt * (F.mode === 'peck' ? 8 : 1.8));
    F.root.rotation.set(0, F.yawS, F.pitch);
    F.u.uCurve.value = THREE.MathUtils.clamp(F.turn * 0.05, -0.03, 0.03);
    const speed = pose.speed, hover = THREE.MathUtils.clamp(pose.hover, 0, 1);
    F.u.uSwimPhase.value += dt * (5.5 * (1 - 0.6 * hover) + 55 * speed + 4 * Math.abs(F.turn));
    F.u.uSwimAmp.value = 0.0012 + 0.0025 * (1 - hover) + 0.011 * Math.min(Math.abs(F.turn), 0.4) + 0.03 * speed;
    F.u.uFinPhase.value += dt * (3.2 + 30 * speed);
    F.u.uFinAmp.value = 0.12 + 1.2 * speed;
    F.brake = Math.max((F.brake ?? 0) - dt * 1.5, pose.brake);
    // breathing; while pecking the mouth works fast (sucking up grit)
    F.breathPh = (F.breathPh ?? F.path.ph) + dt * (4.2 + 10 * pose.pump);
    F.u.uBreath.value = pose.gulp !== undefined ? 2.6 * pose.gulp : Math.sin(F.breathPh) * (1 + 0.6 * pose.pump);
    // ---- pectoral fins (bones), re-measured from the user's reference video (8 fps, 3 s):
    // the fin rests folded back along the belly; in bursts of a few strokes it drops quickly down-and-back to ~50 deg and
    // eases back (one stroke ~0.7 s), never swinging forward; left and right alternate. Between bursts it rests, barely moving.
    F.pecPh = (F.pecPh ?? Math.random()) + dt / 0.72;
    F.burstPh = (F.burstPh ?? Math.random() * 6) + dt;
    const inner = Math.sign(F.turn), turnAmt = Math.min(Math.abs(F.turn) / 0.5, 1);
    const burst = THREE.MathUtils.smoothstep(Math.sin(F.burstPh * 0.75), -0.2, 0.35);      // ~4 s on, ~4 s off
    const drive = Math.min(1, hover * (0.35 + 0.65 * burst) + 0.8 * F.brake);
    for (const B of F.finBones) {
      if (B.pec) {
        const u = ((F.pecPh + (B.side > 0 ? 0 : 0.5)) % 1 + 1) % 1;
        const stroke = u < 0.28 ? ease(u / 0.28) : 1 - ease((u - 0.28) / 0.72);           // quick drop, slow return
        const flutter = 0.06 * Math.sin(F.pecPh * 6.283 * 1.7 + B.side);                   // resting fins still tremble
        let s = 0.12 + drive * 0.75 * stroke + (1 - drive) * flutter;
        if (B.side === inner) s += 0.35 * turnAmt;                                         // inside fin spreads in a turn
        s = THREE.MathUtils.clamp(s, 0, 1);
        B.hangQ ??= new THREE.Quaternion().setFromUnitVectors(B.out, new THREE.Vector3(0.55, -1, 0.32 * B.side).normalize());
        _q1.identity().slerp(B.hangQ, s);
        B.base.quaternion.copy(_q1).multiply(_q2.setFromAxisAngle(B.out, 0.15 * drive * Math.sin(u * 6.283) * B.side)).multiply(B.base.userData.q0);
        B.base.scale.set(0.9 + 0.2 * s, 1, 1);                                             // rays spread as the fin drops
        B.tip.quaternion.setFromAxisAngle(_zAxis, B.sBack * 0.18 * drive * (u < 0.28 ? 1 : -0.5) * Math.sin(u * Math.PI));
      } else {                // pelvic: held pointing down, only a small trim
        const p = F.u.uFinPhase.value * 0.55 + (B.side > 0 ? 0 : 0.6) + 1.1;
        _q1.setFromAxisAngle(B.sweep, 0.1 * Math.sin(p)); _q2.setFromAxisAngle(B.hinge, 0.06 * B.side * Math.sin(p + 1.2));
        B.base.quaternion.copy(B.rest).multiply(_q1).multiply(_q2).multiply(B.base.userData.q0);
        B.tip.quaternion.setFromAxisAngle(_zAxis, 0.05 * Math.sin(p - 0.7));
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
        uRip: { value: ripples }, uTime: uniformsCommon.uTime, uRefr: { value: STD ? rtRefr.texture : null }, uRefl: { value: STD ? rtRefl.texture : null },
        uReflVP: { value: new THREE.Matrix4() }, uRes: { value: res }, uUseRT: { value: STD ? 1 : 0 },
        uTint: { value: new THREE.Color(0x9cc9d3) }, uSky: { value: new THREE.Color(0x46525d) }, uHalf: { value: new THREE.Vector2(W / 2, D / 2) },
      },
      vertexShader: `
        uniform float uTime; uniform mat4 uReflVP; varying vec3 vW; varying vec4 vReflClip; varying vec3 vN;
        float wave(vec2 p, float t){ return 0.0006*sin(p.x*31.+t*1.1) + 0.0004*sin(p.y*43.-t*0.9+p.x*9.) + 0.0002*sin((p.x+p.y)*71.+t*1.8) + 0.0001*sin(p.x*131.-p.y*97.+t*2.3); }
        void main(){
          vec4 w = modelMatrix * vec4(position,1.);
          float e = 0.0006;
          float h = wave(w.xz,uTime), hx = wave(w.xz+vec2(e,0.),uTime), hz = wave(w.xz+vec2(0.,e),uTime);
          w.y += h; vN = normalize(vec3(-(hx-h)/e, 1., -(hz-h)/e));
          vW = w.xyz; vReflClip = uReflVP * w;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: `
        uniform vec4 uRip[6]; uniform float uTime;
        float ripple(vec2 p, float t){
          float h = 0.;
          for (int i = 0; i < 6; i++) {
            float age = t - uRip[i].z; if (age < 0. || age > 3.) continue;
            float r = length(p - uRip[i].xy), front = age * 0.09;
            float env = exp(-pow((r - front) / 0.012, 2.)) * exp(-age * 1.3) * uRip[i].w;
            h += 0.00011 * env * cos((r - front) * 420.);
          }
          return h;
        }
        uniform sampler2D uRefr; uniform sampler2D uRefl; uniform vec2 uRes; uniform float uUseRT;
        uniform vec3 uTint; uniform vec3 uSky; uniform vec2 uHalf;
        varying vec3 vW; varying vec4 vReflClip; varying vec3 vN;
        void main(){
          vec3 nW = vN;
          { float e = 0.0005, r0 = ripple(vW.xz, uTime);                       // expanding rings from gulps and bubbles, per pixel
            nW = normalize(nW + vec3(-(ripple(vW.xz + vec2(e, 0.), uTime) - r0) / e, 0., -(ripple(vW.xz + vec2(0., e), uTime) - r0) / e)); }
          vec3 V = normalize(cameraPosition - vW);
          bool above = cameraPosition.y > vW.y;
          vec3 N = above ? nW : -nW;
          float cosT = clamp(abs(dot(V, N)), 0., 1.);
          vec2 sUV = gl_FragCoord.xy / uRes;
          vec2 off = nW.xz * 0.12;
          vec3 refr = uUseRT > .5 ? texture2D(uRefr, clamp(sUV + off, 0.001, .999)).rgb : uTint;
          vec3 col;
          if (above) {
            float fres = 0.03 + 0.55 * pow(1. - cosT, 5.);
            col = mix(refr * mix(vec3(1.), uTint, .12), uSky, fres * mix(1., 0.4, smoothstep(0.55, 0.95, abs(V.y))));
          } else {
            vec2 rUV = vReflClip.xy / vReflClip.w * .5 + .5;
            vec3 refl = uUseRT > .5 ? texture2D(uRefl, clamp(rUV + off, 0.001, .999)).rgb : uTint * .7;
            float tir = 1. - smoothstep(0.6, 0.72, cosT);          // total internal reflection past ~48.6 deg
            col = mix(refr * 0.85 + uTint * 0.15, max(refl, uTint * 0.8), max(tir, 0.3) * 0.8);
          }
          vec3 L = normalize(vec3(0.05, 1., 0.12));
          // glare: full at grazing angles, faint when looking straight down so the fish stay visible from above
          float topView = smoothstep(0.55, 0.95, abs(V.y));
          float spec = pow(max(dot(reflect(-L, nW), V), 0.), 120.);
          col += (spec * 0.6 + pow(max(dot(reflect(-L, nW), V), 0.), 900.) * 1.4) * mix(1., 0.15, topView);
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
    updateGrit(dt); updateBubbles(dt, t);
    updateWaterLife(t);
    followWatched();
  }
  function draw() { controls.update(); camera.getWorldDirection(_camDir); shaftSide.value = 1 - THREE.MathUtils.smoothstep(-_camDir.y, 0.45, 0.85); if (STD && surface) renderWaterPasses(); renderer.render(scene, camera); }
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
      const [sT, sN, sR] = await Promise.all([tex(A.textures['stone-tripo']), tex(A.textures['stone-tripo-n'], { srgb: false }), tex(A.textures['stone-tripo-rm'], { srgb: false })]);
      for (const t of [sT, sN, sR]) t.flipY = false;       // glTF UVs
      stoneMats = { blue: tripoStoneMaterial(sT, sN, sR, false), black: tripoStoneMaterial(sT, sN, sR, true) };
      await loadStoneShapes();
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
        watch: startWatching, view: setView, mode: setMode, state, fishes, select, camera, controls, scene,
      };
    } catch (e) {
      console.error(e);
      say('読み込みに失敗しました。通信状態を確かめて再読み込みしてください。（' + (e.message || e) + '）', true);
    }
  })();
  setMode('view');
})();
