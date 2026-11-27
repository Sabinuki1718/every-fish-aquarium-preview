/* アピストグラマ・トリファスキアータのブリードタンク — three.js r170 (window.THREE) + AquariumLib
   (aquarium-state / mobile-quality / fish-watch). Assets come from window.AQUARIUM_ASSETS: relative URLs (published
   page) or data: URIs (offline file). Units: metres. Tank centre on the floor at the origin, front glass +z, left -x.
   Approved layout: layout v1. Fish: the approved v4 models (male, female) with their own GLB clip 'fins_breath'
   (fins, mouth, gills); the aquarium adds only the body wave and the swimming, so no fin channel is driven twice. */
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
  const QUALITY_KEY = 'apisto-trifasciata-aquarium:quality';
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
  const CLEAR = 0x1a1d1c;
  renderer.setClearColor(CLEAR, 1);
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x4a3e2b, 0.75);              // light blackwater: a tea-coloured haze toward the back
  const camera = new THREE.PerspectiveCamera(34, 1, 0.005, 10);
  // moderate light from above (a little dimmer than a planted tank), as in the approved layout render
  scene.add(new THREE.HemisphereLight(0xfff3df, 0x4a3f30, 1.7));
  const sun = new THREE.DirectionalLight(0xfff0d8, 1.9); sun.position.set(-0.1, 1.2, 0.35); scene.add(sun);

  // ---------- tank ----------
  const L = A.layout, cm = 0.01;
  const W = L.tank.w * cm, D = L.tank.d * cm, H = L.tank.h * cm, WL = L.tank.water * cm;
  // the soil bed of the approved layout: 4 cm at the front, 5 cm at the back, flat with a faint unevenness
  const ground = (x, z) => (0.04 + 0.01 * (0.5 - z / D)) + 0.0012 * Math.sin(x * 40.0) + 0.001 * Math.cos(z * 55.0 + x * 10.0);

  const uTime = { value: 0 };
  const loader = new THREE.TextureLoader();
  const tex = (url, { repeat, srgb = true } = {}) => new Promise((ok, fail) => loader.load(url, t => {
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
    t.anisotropy = STD ? 4 : 1; ok(t);
  }, undefined, () => fail(new Error('画像を読み込めませんでした: ' + url))));
  function seeded(id) { let h = 2166136261; for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) / 4294967296); }
  const canvasTex = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };

  // Caustics: the soft moving net of light from the rippling surface, on up-facing surfaces (world space).
  const CAUSTIC_VERT_HEAD = 'varying vec3 vCWorld; varying vec3 vCNormal;\n';
  const CAUSTIC_VERT = `#include <project_vertex>
    vCWorld = (modelMatrix * vec4(transformed, 1.)).xyz; vCNormal = normalize(mat3(modelMatrix) * objectNormal);`;
  const CAUSTIC_FRAG_HEAD = `uniform float uTime; uniform float uCaustic; varying vec3 vCWorld; varying vec3 vCNormal;
    float cnet(vec2 p, float t){
      float a = sin(p.x + t * 0.8 + sin(p.y * 0.7 + t * 0.45) * 1.7) * sin(p.y * 1.13 - t * 0.7 + sin(p.x * 0.8 - t * 0.4) * 1.7);
      return pow(1. - abs(a), 6.);
    }
    float caustic(vec3 w, float t){ vec2 p = w.xz * 52.; return 0.6 * cnet(p, t) + 0.4 * cnet(p * 1.7 + 3.1, t * 1.3); }\n`;
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
    const soilT = await tex(A.textures.soil, { repeat: [L.tank.w / 9, L.tank.d / 9] });
    // back screen: black film, one-sided (from behind the tank you look in through the back glass)
    const backT = canvasTex(64, 256, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#191b1b'); gr.addColorStop(1, '#0b0c0c'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.02, H * 1.02), new THREE.MeshBasicMaterial({ map: backT, fog: false, side: THREE.FrontSide }));
    back.position.set(0, H / 2, -D / 2 - 0.004); scene.add(back);
    // soil bed
    const g = new THREE.PlaneGeometry(W, D, 120, 72); g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, ground(p.getX(i), p.getZ(i)));
    g.computeVertexNormals();
    const soilMat = new THREE.MeshLambertMaterial({ map: soilT, side: THREE.DoubleSide });
    soilMat.onBeforeCompile = sh => addCaustics(sh, STD ? 0.32 : 0.22);
    soilMat.customProgramCacheKey = () => 'soil-caustic';
    scene.add(new THREE.Mesh(g, soilMat));
    // the bed is a solid layer: four cut faces down to the tank floor and an underside, so side and bottom views show soil
    const cutT = soilT.clone(); cutT.repeat.set(1, 1); cutT.needsUpdate = true;
    const cutMat = new THREE.MeshLambertMaterial({ map: cutT, color: 0xbdb4a6, side: THREE.DoubleSide });
    const TILE = 0.09, N = 120;
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
    const baseT = soilT.clone(); baseT.repeat.set(W / TILE, D / TILE); baseT.needsUpdate = true;
    const base = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshLambertMaterial({ map: baseT, color: 0x9d968b, side: THREE.DoubleSide }));
    base.rotation.x = -Math.PI / 2; base.position.y = 0.0003; scene.add(base);
    // glass: faint panes and thin edges
    const glassMat = new THREE.MeshBasicMaterial({ color: 0xd8ecec, transparent: true, opacity: 0.04, depthWrite: false, side: THREE.DoubleSide, fog: false });
    for (const [w, h, x, y, z, ry] of [[W, H, 0, H / 2, D / 2, 0], [D, H, -W / 2, H / 2, 0, Math.PI / 2], [D, H, W / 2, H / 2, 0, Math.PI / 2]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glassMat); m.position.set(x, y, z); m.rotation.y = ry; scene.add(m);
    }
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(W, H, D)), new THREE.LineBasicMaterial({ color: 0x5f6e6c, fog: false }));
    edges.position.y = H / 2; scene.add(edges);
    // fine brown specks of leaf litter drifting very slowly in the still water, one draw call
    const n = STD ? 420 : 220, pos = new Float32Array(n * 3), seed = new Float32Array(n);
    const r = seeded('specks');
    for (let i = 0; i < n; i++) { pos[i * 3] = (r() - .5) * W; pos[i * 3 + 1] = 0.045 + r() * (WL - 0.05); pos[i * 3 + 2] = (r() - .5) * D; seed[i] = r(); }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); sg.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    specks = new THREE.Points(sg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTime, uW: { value: W }, uScale: { value: 1 } },
      vertexShader: `uniform float uTime, uW, uScale; attribute float aSeed; varying float vA;
        void main(){
          vec3 p = position;
          p.x = mod(p.x + uW * .5 + uTime * (0.0015 + 0.003 * aSeed), uW) - uW * .5;
          p.y += 0.004 * sin(uTime * 0.35 + aSeed * 40.);
          vec4 mv = modelViewMatrix * vec4(p, 1.);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uScale * (0.45 + 0.8 * aSeed) / -mv.z;
          vA = 0.2 + 0.3 * aSeed;
        }`,
      fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - .5); gl_FragColor = vec4(vec3(.82,.72,.56), vA * smoothstep(.5, .1, d)); }`,
    }));
    specks.frustumCulled = false; scene.add(specks);
  }

  // ---------- layout objects (editable): coconut shelter with Microsorum, catappa leaves, sponge filter ----------
  const editables = new Map();      // id -> {root, kind, radius, label, picks}
  const shelter = { local: null };  // entrance and inside points in the shelter's frame
  const swayMats = [];
  let maps = {};
  function coconutShelter(o) {
    const r = o.radius * cm, root = new THREE.Group(), dome = new THREE.Group(), e = o.entrance;
    // dome cut side down, flattened a little; the entrance is a gap in the lower band, facing dir_deg from the front
    const phiC = THREE.MathUtils.degToRad(90 - e.dir_deg), half = THREE.MathUtils.degToRad(e.width_deg / 2), thD = Math.acos(e.height_cm / o.radius);
    const outT = maps.coconut.clone(); outT.wrapS = outT.wrapT = THREE.RepeatWrapping; outT.repeat.set(3, 1.2); outT.needsUpdate = true;
    const outM = new THREE.MeshLambertMaterial({ map: outT, side: THREE.FrontSide });
    outM.onBeforeCompile = sh => addCaustics(sh, STD ? 0.28 : 0.2); outM.customProgramCacheKey = () => 'coconut-caustic';
    // the shell has a wall: an outer and an inner surface ~5 mm apart, joined by cut faces at the door and the rim
    const inM = new THREE.MeshLambertMaterial({ color: 0x3a2414, side: THREE.BackSide });
    const cutM = new THREE.MeshLambertMaterial({ color: 0x8a6440, side: THREE.DoubleSide });
    const segs = STD ? 72 : 48, wall = (o.wall_cm || 0.5) * cm, ri = r - wall;
    const gapA = phiC + half, gapL = Math.PI * 2 - 2 * half;
    for (const [rad, mat] of [[r, outM], [ri, inM]]) {
      dome.add(new THREE.Mesh(new THREE.SphereGeometry(rad, segs, 20, 0, Math.PI * 2, 0, thD), mat));
      dome.add(new THREE.Mesh(new THREE.SphereGeometry(rad, segs, 8, gapA, gapL, thD, Math.PI / 2 - thD), mat));
    }
    const sph = (rad, ph, th) => [-rad * Math.cos(ph) * Math.sin(th), rad * Math.cos(th), rad * Math.sin(ph) * Math.sin(th)];
    const cutStrip = path => {               // a band between the outer and the inner surface along (phi, theta)
      const P = [], I = [];
      path.forEach(([ph, th], i) => { P.push(...sph(r, ph, th), ...sph(ri, ph, th)); if (i) { const a = (i - 1) * 2; I.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } });
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(I); g.computeVertexNormals();
      dome.add(new THREE.Mesh(g, cutM));
    };
    const lin = (a, b, k) => a + (b - a) * k, steps = (n, f) => [...Array(n + 1)].map((_, i) => f(i / n));
    cutStrip(steps(48, k => [lin(gapA, gapA + gapL, k), Math.PI / 2]));      // the rim standing on the soil
    cutStrip(steps(8, k => [gapA, lin(thD, Math.PI / 2, k)]));                // both sides of the door
    cutStrip(steps(8, k => [gapA + gapL, lin(thD, Math.PI / 2, k)]));
    cutStrip(steps(12, k => [lin(gapA - 2 * half, gapA, k), thD]));            // the lintel over the door
    dome.scale.y = 0.82; root.add(dome);
    const top = r * 0.82;
    // Microsorum (Java fern): rhizome tied on the top of the shell, lanceolate leaves arching up and out
    const M = L.objects.find(m => m.kind === 'microsorum' && m.attached_to === o.id);
    if (M) {
      const rh = new THREE.Mesh(new THREE.CylinderGeometry(0.0032, 0.0038, 0.055, 10).rotateZ(Math.PI / 2).rotateY(0.5), new THREE.MeshLambertMaterial({ color: 0x4a3a24 }));
      rh.position.set(0, top - 0.0025, 0); root.add(rh);
      const leafM = new THREE.MeshLambertMaterial({ map: maps.microsorum, alphaTest: 0.55, side: THREE.DoubleSide });
      const uSway = { value: 0 };
      leafM.onBeforeCompile = sh => {
        sh.uniforms.uTime = uTime; sh.uniforms.uSway = uSway;
        sh.vertexShader = 'uniform float uTime; uniform float uSway; attribute float aT; attribute float aPh;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
          float sw = aT * aT * (0.0025 + uSway);
          transformed.x += sw * sin(uTime * 0.9 + aPh); transformed.z += sw * 0.7 * cos(uTime * 0.7 + aPh * 1.3);`);
      };
      leafM.customProgramCacheKey = () => 'microsorum-sway';
      swayMats.push(leafM);
      const rnd = seeded('microsorum-' + o.id);
      for (let i = 0; i < M.leaves; i++) {
        const az = i / M.leaves * Math.PI * 2 + rnd() * 0.5;
        const off = new THREE.Vector3((rnd() - 0.5) * 0.03, top - 0.003, (rnd() - 0.5) * 0.015);
        root.add(leafStrip(off, az, (8 + rnd() * 6) * cm, (2.0 + rnd() * 0.8) * cm, 0.55 + rnd() * 0.5, 0.13 + rnd() * 0.08, rnd() * 6, leafM));
      }
    }
    // entrance / inside points (the female uses them); local frame of the root
    const ea = THREE.MathUtils.degToRad(e.dir_deg);
    shelter.local = { out: new THREE.Vector3(-Math.sin(ea) * (r + 0.022), 0, Math.cos(ea) * (r + 0.022)),
      door: new THREE.Vector3(-Math.sin(ea) * r * 0.95, 0, Math.cos(ea) * r * 0.95), inside: new THREE.Vector3(Math.sin(ea) * r * 0.15, 0, -Math.cos(ea) * r * 0.15),
      r, top, doorH: e.height_cm * cm };
    return { root, radius: r, picks: [dome] };
  }
  function leafStrip(base, az, len, wid, pitch, droop, ph, mat) {
    // one Microsorum leaf: the leaf picture on a bent, slightly twisted strip (stalk at the base)
    const N = 18, pos = [], uv = [], at = [], aph = [], idx = [];
    const p = base.clone(), dir = new THREE.Vector3(Math.cos(az) * Math.cos(pitch), Math.sin(pitch), Math.sin(az) * Math.cos(pitch));
    const side = new THREE.Vector3(-Math.sin(az), 0, Math.cos(az));
    for (let i = 0; i <= N; i++) {
      const t = i / N, tw = side.clone().multiplyScalar(wid / 2).applyAxisAngle(dir, 0.3 * t);
      pos.push(...p.clone().add(tw).toArray(), ...p.clone().sub(tw).toArray()); uv.push(0, t, 1, t); at.push(t, t); aph.push(ph, ph);
      if (i < N) idx.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
      dir.y -= droop * len / N; dir.normalize(); p.addScaledVector(dir, len / N);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('aT', new THREE.Float32BufferAttribute(at, 1)); g.setAttribute('aPh', new THREE.Float32BufferAttribute(aph, 1));
    g.setIndex(idx); g.computeVertexNormals();
    return new THREE.Mesh(g, mat);
  }
  // the catappa picture holds five leaves (centre and the four corners); each leaf object takes one of them
  const CATAPPA = { tl: [0.035, 0.035, 0.355, 0.385], tr: [0.635, 0.04, 0.955, 0.385], c: [0.365, 0.275, 0.635, 0.72], bl: [0.05, 0.615, 0.38, 0.95], br: [0.625, 0.615, 0.955, 0.95] };
  const LEAF_PICK = { 'leaf-1': 'tl', 'leaf-2': 'br', 'leaf-3': 'bl' };
  function catappaLeaf(o) {
    const [u0, v0, u1, v1] = CATAPPA[LEAF_PICK[o.id] || 'c'];
    const len = o.length_cm * cm, wid = len * (u1 - u0) / (v1 - v0);
    const g = new THREE.PlaneGeometry(wid, len, 6, 10), uv = g.attributes.uv, p = g.attributes.position;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), 1 - (v0 + (1 - uv.getY(i)) * (v1 - v0)));
      const x = p.getX(i) / (wid / 2), y = p.getY(i) / (len / 2);
      p.setZ(i, 0.0035 * (x * x) + 0.0015 * Math.sin(y * 2.2));               // edges curl up a little, a slight wave along the leaf
    }
    g.rotateX(-Math.PI / 2); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: maps.catappa, alphaTest: 0.6, side: THREE.DoubleSide }));
    m.material.onBeforeCompile = sh => addCaustics(sh, STD ? 0.3 : 0.2); m.material.customProgramCacheKey = () => 'catappa-caustic';
    const root = new THREE.Group(); root.add(m);
    return { root, radius: Math.max(len, wid) / 2, picks: [m], sink: -0.0012 };
  }
  const bubbleCols = [];
  function bubbleColumn(base, len, n, spread, speed, seedName) {
    // bubbles rising from `base` over `len` metres (local to the parent), one draw call
    const bp = new Float32Array(n * 3), bs = new Float32Array(n); const r = seeded(seedName);
    for (let i = 0; i < n; i++) { bp[i * 3] = base.x + (r() - .5) * spread; bp[i * 3 + 1] = base.y; bp[i * 3 + 2] = base.z + (r() - .5) * spread; bs[i] = r(); }
    const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.BufferAttribute(bp, 3)); bg.setAttribute('aSeed', new THREE.BufferAttribute(bs, 1));
    const pts = new THREE.Points(bg, new THREE.ShaderMaterial({ transparent: true, depthWrite: false,
      uniforms: { uTime, uLen: { value: len }, uSpeed: { value: speed }, uScale: { value: 1 } },
      vertexShader: `uniform float uTime, uLen, uSpeed, uScale; attribute float aSeed;
        void main(){ vec3 p = position; float k = mod(aSeed * uLen + uTime * uSpeed * (0.8 + 0.4 * aSeed), uLen);
          p.y += k; p.x += 0.0015 * sin(uTime * 3. + aSeed * 30.) * k / uLen;
          vec4 mv = modelViewMatrix * vec4(p, 1.); gl_Position = projectionMatrix * mv; gl_PointSize = uScale * (0.8 + aSeed) / -mv.z; }`,
      fragmentShader: `void main(){ float d = length(gl_PointCoord - .5); float ring = smoothstep(.5, .38, d) - 0.6 * smoothstep(.36, .2, d); gl_FragColor = vec4(vec3(.92,.96,.97), .75 * ring); }`,
    }));
    pts.frustumCulled = false; bubbleCols.push(pts); return pts;
  }
  let airTube = null, filterNozzle = null;
  function spongeFilter(o) {
    // Billy-style: a green lift pipe stands in the corner; at its foot an L-elbow turns sideways into the end of a
    // horizontal foam cylinder lying on the soil. At the top the pipe bends to a sideways outlet just under the surface,
    // and an air tube runs from its nozzle over the back glass to the outside. Local frame: sponge along +x, pipe at -x.
    const foam = canvasTex(256, 256, (g, w, h) => { const r = seeded('foam'); g.fillStyle = '#2e3335'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 3000; i++) { g.fillStyle = r() < 0.55 ? '#1a1e20' : '#4a5155'; const s = 1 + r() * 2.2; g.fillRect(r() * w, r() * h, s, s); } });
    foam.wrapS = foam.wrapT = THREE.RepeatWrapping; foam.repeat.set(3, 1.2);
    const R = o.radius * cm, Ls = o.length_cm * cm, root = new THREE.Group();
    const g0 = ground(o.pos[0] * cm, o.pos[2] * cm) - 0.002;                       // the root sits at this height
    const yc = R - 0.003, pr = 0.0065, bend = 0.012, joint = 0.008;
    const xr = -Ls / 2 - joint - bend;                                            // the riser's axis, beyond the sponge's left end
    const sponge = new THREE.Mesh(new THREE.CylinderGeometry(R, R, Ls, 36).rotateZ(Math.PI / 2), new THREE.MeshLambertMaterial({ map: foam }));
    sponge.position.y = yc; root.add(sponge);
    const capM = new THREE.MeshLambertMaterial({ color: 0x2a3033 });
    for (const sx of [-1, 1]) {                                                    // the two end caps of the strainer
      const c = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.02, R * 1.02, 0.004, 32).rotateZ(Math.PI / 2), capM);
      c.position.set(sx * (Ls / 2 + 0.002), yc, 0); root.add(c);
    }
    const green = new THREE.MeshPhysicalMaterial({ color: 0x3f9a55, transparent: true, opacity: 0.82, roughness: 0.2, depthWrite: true, side: THREE.DoubleSide });
    const yElbow = WL - g0 - 0.022, out = 0.035, V = (x, y) => new THREE.Vector3(x, y, 0);
    const path = new THREE.CurvePath();
    path.add(new THREE.LineCurve3(V(-Ls / 2 - 0.002, yc), V(xr + bend, yc)));                       // out of the sponge's end
    path.add(new THREE.QuadraticBezierCurve3(V(xr + bend, yc), V(xr, yc), V(xr, yc + bend)));       // the L at the foot
    path.add(new THREE.LineCurve3(V(xr, yc + bend), V(xr, yElbow - bend)));                         // up the riser
    path.add(new THREE.QuadraticBezierCurve3(V(xr, yElbow - bend), V(xr, yElbow), V(xr + bend, yElbow)));
    path.add(new THREE.LineCurve3(V(xr + bend, yElbow), V(xr + out, yElbow)));                      // sideways outlet
    const pipe = new THREE.Mesh(new THREE.TubeGeometry(path, 120, pr, 18, false), green); root.add(pipe);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(pr * 1.45, pr * 1.45, 0.007, 18).rotateZ(Math.PI / 2), capM);
    ring.position.set(-Ls / 2 - 0.004, yc, 0); root.add(ring);                                       // the coupler on the end cap
    // air inlet: a short grey nipple on the back of the L-elbow at the foot of the riser, so the air enters at the
    // bottom of the lift pipe. The air tube runs from it up the back of the green pipe and out over the back glass.
    const yIn = yc + bend * 0.6, zt = -pr - 0.0075, nipM = new THREE.MeshLambertMaterial({ color: 0x9aa4a6 });
    const nip = new THREE.Mesh(new THREE.CylinderGeometry(0.0018, 0.0018, 0.008, 12).rotateX(Math.PI / 2), nipM);
    nip.position.set(xr, yIn, -pr - 0.003); root.add(nip);
    const top = WL - g0 + 0.016;
    filterNozzle = { root, local: [new THREE.Vector3(xr, yIn, -pr - 0.006), new THREE.Vector3(xr, yIn + 0.004, zt), new THREE.Vector3(xr, yIn + 0.016, zt),
      new THREE.Vector3(xr, (yIn + top) / 2, zt), new THREE.Vector3(xr, top - 0.012, zt), new THREE.Vector3(xr, top, zt)] };
    // air lift: bubbles up the riser, then out of the outlet and up to the surface
    root.add(bubbleColumn(V(xr, yc + bend), yElbow - yc - bend, 36, 0.006, 0.09, 'bubbles-riser'));
    root.add(bubbleColumn(V(xr + out + 0.004, yElbow), WL - g0 - yElbow - 0.003, 24, 0.008, 0.07, 'bubbles-out'));
    // footprint in the root frame (for keeping it inside the glass), and the fish keep clear of it
    const box = { x0: xr - pr - 0.002, x1: Ls / 2 + 0.006, z0: -R - 0.002, z1: R + 0.002 };
    return { root, radius: (box.x1 - box.x0) / 2, box, picks: [sponge, pipe], after: updateAirTube };
  }
  function updateAirTube() {
    // the silicone air tube: from the inlet at the pipe's foot up along the pipe, over the back glass, then down outside
    if (!filterNozzle) return;
    filterNozzle.root.updateMatrixWorld(true);
    const lp = filterNozzle.local.map(p => p.clone().applyMatrix4(filterNozzle.root.matrixWorld)), a = lp[lp.length - 1], bz = -D / 2;
    const pts = [...lp, new THREE.Vector3(a.x, H + 0.006, (a.z + bz) / 2),
      new THREE.Vector3(a.x, H + 0.01, bz + 0.002), new THREE.Vector3(a.x, H + 0.006, bz - 0.01), new THREE.Vector3(a.x, H - 0.03, bz - 0.014), new THREE.Vector3(a.x, H - 0.13, bz - 0.014)];
    const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.3), 80, 0.0022, 10, false);
    if (!airTube) {
      airTube = new THREE.Mesh(g, new THREE.MeshPhysicalMaterial({ color: 0xe6eeee, transparent: true, opacity: 0.6, roughness: 0.25, depthWrite: false }));
      airTube.renderOrder = 2; scene.add(airTube);
    } else { airTube.geometry.dispose(); airTube.geometry = g; }
  }
  const BUILD = { coconut_shelter: coconutShelter, catappa_leaf: catappaLeaf, sponge_filter: spongeFilter };
  const LABEL = { coconut_shelter: 'ココナッツシェルター', sponge_filter: 'スポンジフィルター' };
  const STATE_KIND = { coconut_shelter: 'wood', catappa_leaf: 'plant', sponge_filter: 'wood' };
  function makeObject(o) {
    const b = BUILD[o.kind](o);
    b.root.userData.id = o.id; scene.add(b.root);
    const n = o.kind === 'catappa_leaf' ? 'マジックリーフ' + o.id.split('-')[1] : LABEL[o.kind];
    editables.set(o.id, { ...b, kind: o.kind, label: n, sink: b.sink || 0.002 });
  }

  // ---------- layout state (approved layout -> aquarium-state) ----------
  const approved = L.objects.filter(o => BUILD[o.kind]).map(o => ({
    id: o.id, kind: STATE_KIND[o.kind], position: [o.pos[0] * cm, 0, o.pos[2] * cm], rotation: [0, (o.rot_deg || 0) * Math.PI / 180, 0],
  }));
  const REVISION = 'layout-v' + L.version;
  const SAVE_KEY = 'apisto-trifasciata-aquarium:aquarium:' + REVISION;
  const state = LIB.createAquariumState(approved, { palette: ['none'], revision: REVISION });
  const current = id => state.snapshot().objects.find(o => o.id === id);
  function clampPos(id, x, z) {
    // keep the object's footprint inside the glass: a box in its own frame (rotated), or a circle
    const e = editables.get(id);
    if (!e.box) { const m = e.radius + 0.004; return [Math.min(W / 2 - m, Math.max(-W / 2 + m, x)), Math.min(D / 2 - m, Math.max(-D / 2 + m, z))]; }
    const ry = current(id)?.rotation[1] ?? 0, c = Math.cos(ry), s = Math.sin(ry), b = e.box, m = 0.003;
    const xs = [], zs = [];
    for (const [lx, lz] of [[b.x0, b.z0], [b.x1, b.z0], [b.x0, b.z1], [b.x1, b.z1]]) { xs.push(lx * c + lz * s); zs.push(-lx * s + lz * c); }
    const nx = Math.min(W / 2 - m - Math.max(...xs), Math.max(-W / 2 + m - Math.min(...xs), x));
    const nz = Math.min(D / 2 - m - Math.max(...zs), Math.max(-D / 2 + m - Math.min(...zs), z));
    return [nx, nz];
  }
  function applyState() {
    for (const o of state.snapshot().objects) {
      const e = editables.get(o.id); if (!e) continue;
      const [x, z] = clampPos(o.id, o.position[0], o.position[2]);
      e.root.position.set(x, ground(x, z) - e.sink, z); e.root.rotation.y = o.rotation[1];
      e.root.updateMatrixWorld(true);
      e.after?.();
    }
    updatePanel();
  }
  const save = () => store.set(SAVE_KEY, JSON.stringify(state.snapshot()));
  function loadSaved() {
    const raw = store.get(SAVE_KEY); if (!raw) return false;
    try { return state.load(JSON.parse(raw)); } catch { return false; }
  }
  const shelterRoot = () => editables.get(L.objects.find(o => o.kind === 'coconut_shelter').id).root;
  const filterRoot = () => editables.get(L.objects.find(o => o.kind === 'sponge_filter').id);
  const toWorld = (v, root) => v.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), root.rotation.y).add(new THREE.Vector3(root.position.x, 0, root.position.z));

  // ---------- fish ----------
  // Body wave added in the vertex shader (one set of uniforms per fish); s: 0 at the snout, 1 at the tail tip (head at -x).
  // The GLB morph targets (fins, mouth, gills) are applied by three.js after this offset, driven by the fish's own mixer.
  const SWIM_VERT = 'uniform float uSwimPhase, uSwimAmp, uX0, uLen;\n';
  const SWIM_BEGIN = `#include <begin_vertex>
    float s = clamp((transformed.x - uX0) / uLen, 0., 1.);
    float bend = uSwimAmp * pow(smoothstep(0.32, 1., s), 1.3);
    transformed.z += bend * sin(uSwimPhase - s * 5.0);`;
  function fishMaterial(fin, map, u) {
    const m = new THREE.MeshLambertMaterial({ map, transparent: fin, side: THREE.DoubleSide, depthWrite: !fin });
    m.onBeforeCompile = sh => { Object.assign(sh.uniforms, u); sh.vertexShader = SWIM_VERT + sh.vertexShader.replace('#include <begin_vertex>', SWIM_BEGIN); };
    m.customProgramCacheKey = () => 'apisto-' + (fin ? 'fin' : 'body');
    return m;
  }
  async function loadFish(key) {
    const res = await fetch(A.models[key].json);
    if (!res.ok) throw new Error('モデルを読み込めませんでした: ' + key);
    const data = await res.json();
    const map = await tex(A.models[key].texture); map.flipY = false;
    const u = { uSwimPhase: { value: 0 }, uSwimAmp: { value: 0 }, uX0: { value: 0 }, uLen: { value: 1 } };
    const model = new THREE.Group(), box = new THREE.Box3(), body = fishMaterial(false, map, u), fin = fishMaterial(true, map, u);
    for (const m of data.meshes) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(m.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(m.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(m.uv, 2));
      g.setIndex(m.i);
      if (m.d) { g.morphAttributes.position = m.d.map(d => new THREE.Float32BufferAttribute(d, 3)); g.morphTargetsRelative = true; }
      g.computeBoundingBox(); box.union(g.boundingBox);
      const mesh = new THREE.Mesh(g, m.fin ? fin : body);
      mesh.name = m.name; mesh.frustumCulled = false; if (m.fin) mesh.renderOrder = 2;
      if (m.targets) { mesh.morphTargetDictionary = Object.fromEntries(m.targets.map((t, i) => [t, i])); mesh.morphTargetInfluences = m.targets.map(() => 0); }
      model.add(mesh);
    }
    u.uX0.value = box.min.x; u.uLen.value = box.max.x - box.min.x;
    const tracks = [];
    for (const t of data.clip.tracks) {
      const mesh = data.meshes.find(m => m.name === t.mesh), n = mesh.targets.length;
      for (let k = 0; k < n; k++) tracks.push(new THREE.NumberKeyframeTrack(`${t.mesh}.morphTargetInfluences[${k}]`, t.times, t.times.map((_, j) => t.values[j * n + k])));
    }
    const clip = new THREE.AnimationClip(data.clip.name, -1, tracks);
    return { model, u, clip, box };
  }
  const INFO = {
    'male-1': ['アピストグラマ・トリファスキアータ（オス）', 'Apistogramma trifasciata',
      'パラグアイ川水系などの流れの緩い水域にすむ小型のシクリッド。胸鰭の付け根から臀鰭の起点へ斜めに走る細い黒帯が、ほかのアピストグラマと見分ける目印。オスは背鰭の前の鰭膜が旗のように伸び、腹鰭は糸状に長い。全長約6 cm。'],
    'female-1': ['アピストグラマ・トリファスキアータ（メス）', 'Apistogramma trifasciata',
      'メスはオスより小柄で、黄色い体に縦帯・斜帯・頬の帯がはっきり出る。洞窟や物陰の天井に卵を産み、卵と稚魚を守る。子育ての時期は全身がいっそう鮮やかな黄色になる。全長約4.5 cm。'],
  };
  const fishes = [];
  async function addFish(f) {
    const key = /female/.test(f.id) ? 'female' : 'male';
    const { model, u, clip, box } = await loadFish(key);
    const root = new THREE.Group(), tilt = new THREE.Group();
    tilt.add(model); root.add(tilt); root.userData.fish = f.id; scene.add(root);
    const mixer = new THREE.AnimationMixer(model), action = mixer.clipAction(clip); action.play();
    const rnd = seeded('fish-' + f.id);
    mixer.setTime(rnd() * 2.4);                                   // each fish starts at a different point of the loop
    const F = { id: f.id, f, key, root, tilt, model, u, mixer, rnd, len: box.max.x - box.min.x, half: (box.max.y - box.min.y) / 2,
      pos: new THREE.Vector3(f.pos[0] * cm, f.pos[1] * cm, f.pos[2] * cm), yaw: -THREE.MathUtils.degToRad(f.heading_deg), pitch: 0, bank: 0,
      speed: 0, target: null, mode: key === 'female' ? 'hover' : 'patrol', tMode: 0, modeFor: 4, amp: 0, display: 0, held: false,
      meshes: Object.fromEntries(model.children.map(c => [c.name, c])), bobPh: rnd() * 6.28 };
    F.pos.y = Math.max(F.pos.y, ground(F.pos.x, F.pos.z) + 0.012);
    fishes.push(F);
  }
  // steering: keep inside the water, above the soil, out of the shell (unless going in) and the filter
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
  function avoid(F, want) {
    const p = F.pos, m = 0.022;
    if (p.x < -W / 2 + m) want.x += (-W / 2 + m - p.x) * 30; if (p.x > W / 2 - m) want.x -= (p.x - W / 2 + m) * 30;
    if (p.z < -D / 2 + m) want.z += (-D / 2 + m - p.z) * 30; if (p.z > D / 2 - m) want.z -= (p.z - D / 2 + m) * 30;
    const gy = ground(p.x, p.z) + 0.009; if (p.y < gy) want.y += (gy - p.y) * 40;
    if (p.y > WL - 0.02) want.y -= (p.y - WL + 0.02) * 40;
    const sr = shelterRoot(), S = shelter.local;
    if (F.mode !== 'enter' && F.mode !== 'inside' && F.mode !== 'leave') {
      const dx = p.x - sr.position.x, dz = p.z - sr.position.z, d = Math.hypot(dx, dz), lim = S.r + 0.018;
      if (d < lim && p.y < sr.position.y + S.top + 0.02) { want.x += dx / (d || 1) * (lim - d) * 25; want.z += dz / (d || 1) * (lim - d) * 25; want.y += 0.3 * (lim - d) * 25; }
    }
    const fr = filterRoot(), fx = p.x - fr.root.position.x, fz = p.z - fr.root.position.z, fd = Math.hypot(fx, fz), fl = fr.radius + 0.02;
    if (fd < fl) { want.x += fx / (fd || 1) * (fl - fd) * 25; want.z += fz / (fd || 1) * (fl - fd) * 25; }
    return want;
  }
  const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
  function pickPatrol(F) {
    // a point in the middle layer, away from the shell top and the filter
    for (let k = 0; k < 20; k++) {
      const x = (F.rnd() - 0.5) * (W - 0.07), z = (F.rnd() - 0.5) * (D - 0.07), y = ground(x, z) + 0.05 + F.rnd() * 0.09;
      const sr = shelterRoot(); if (Math.hypot(x - sr.position.x, z - sr.position.z) < shelter.local.r + 0.03 && y < sr.position.y + shelter.local.top + 0.03) continue;
      return new THREE.Vector3(x, y, z);
    }
    return new THREE.Vector3(0, 0.12, 0.05);
  }
  function shelterPoint(which, lift = 0.012) {
    const sr = shelterRoot(), v = toWorld(shelter.local[which], sr); v.y = sr.position.y + lift; return v;
  }
  function femaleOf() { return fishes.find(f => f.key === 'female'); }
  function updateFish(F, t, dt) {
    F.tMode += dt;
    let cruise = 0.012, hoverEnd = false, faceTo = null;
    if (F.held) {                                   // "止める": stays where it is, fins keep moving slowly
      F.speed += (0 - F.speed) * Math.min(1, dt * 3);
    } else if (F.key === 'female') {
      // the female keeps to the shelter: hovers in front of the entrance, now and then goes in and out
      if (F.mode === 'hover') {
        if (!F.target || F.pos.distanceTo(F.target) < 0.006 || F.tMode > F.modeFor) {
          const o = shelterPoint('out', 0.014 + F.rnd() * 0.02); o.x += (F.rnd() - 0.5) * 0.04; o.z += (F.rnd() - 0.2) * 0.03; F.target = o;
          if (F.tMode > F.modeFor) { F.tMode = 0; F.modeFor = 5 + F.rnd() * 7; if (F.rnd() < 0.45) F.mode = 'enter'; }
        }
        cruise = 0.008; faceTo = shelterPoint('door', 0.012);
      } else if (F.mode === 'enter') {
        F.target = F.pos.distanceTo(shelterPoint('door', 0.012)) > 0.012 && !F.passedDoor ? shelterPoint('door', 0.012) : shelterPoint('inside', 0.012);
        if (F.target.distanceTo(shelterPoint('inside', 0.012)) < 1e-6) F.passedDoor = true;
        cruise = 0.01;
        if (F.passedDoor && F.pos.distanceTo(F.target) < 0.006) { F.mode = 'inside'; F.tMode = 0; F.modeFor = 4 + F.rnd() * 5; }
      } else if (F.mode === 'inside') {
        F.target = shelterPoint('inside', 0.011); cruise = 0.003; faceTo = shelterPoint('door', 0.012);
        if (F.tMode > F.modeFor) { F.mode = 'leave'; F.tMode = 0; }
      } else {                                     // leave: out through the door, back to hovering
        F.target = F.pos.distanceTo(shelterPoint('door', 0.012)) > 0.01 && F.passedDoor ? shelterPoint('door', 0.012) : shelterPoint('out', 0.018);
        if (F.target.distanceTo(shelterPoint('out', 0.018)) < 1e-6) F.passedDoor = false;
        cruise = 0.012;
        if (!F.passedDoor && F.pos.distanceTo(F.target) < 0.008) { F.mode = 'hover'; F.tMode = 0; F.modeFor = 5 + F.rnd() * 6; }
      }
    } else {
      // the male patrols the middle layer and now and then comes to the shelter to display to the female, fins spread
      const fem = femaleOf();
      if (F.mode === 'patrol') {
        if (!F.target || F.pos.distanceTo(F.target) < 0.015) F.target = pickPatrol(F);
        cruise = 0.035;
        if (F.tMode > F.modeFor && fem && fem.mode !== 'inside') { F.mode = 'display'; F.tMode = 0; F.modeFor = 4 + F.rnd() * 3; }
      } else {
        const fp = fem.pos.clone(), sr = shelterRoot(), side = Math.sign(fp.x - sr.position.x) || 1;
        F.target = fp.clone().add(new THREE.Vector3(side * 0.045, 0.012, 0.035)); F.target.y = Math.max(F.target.y, ground(F.target.x, F.target.z) + 0.02);
        cruise = 0.02; faceTo = fp;
        hoverEnd = F.pos.distanceTo(F.target) < 0.012;
        if (F.tMode > F.modeFor + 6 || (hoverEnd && F.tMode > F.modeFor)) { F.mode = 'patrol'; F.tMode = 0; F.modeFor = 8 + F.rnd() * 10; F.target = pickPatrol(F); }
      }
    }
    // move toward the target with a smooth heading; slow down near it
    const want = F.target && !F.held ? tmpA.copy(F.target).sub(F.pos) : tmpA.set(0, 0, 0);
    const dist = want.length();
    const goalSpeed = F.held ? 0 : Math.min(cruise, dist * 1.6);
    if (dist > 1e-5) want.multiplyScalar(goalSpeed / dist);
    avoid(F, want);
    F.speed += (want.length() - F.speed) * Math.min(1, dt * 2.2);
    const vx = want.x, vz = want.z, vy = want.y;
    let goalYaw = F.yaw;
    if (Math.hypot(vx, vz) > 0.003) goalYaw = Math.atan2(vz, -vx);
    else if (faceTo) goalYaw = Math.atan2(faceTo.z - F.pos.z, -(faceTo.x - F.pos.x));
    const turn = angDiff(goalYaw, F.yaw);
    F.yaw += THREE.MathUtils.clamp(turn, -dt * 2.6, dt * 2.6);
    const fwd = tmpB.set(-Math.cos(F.yaw), 0, Math.sin(F.yaw));
    const hs = Math.min(F.speed, Math.hypot(vx, vz) + 0.002);
    F.pos.addScaledVector(fwd, hs * dt * Math.max(0, Math.cos(turn) * 0.8 + 0.2));
    F.pos.y += THREE.MathUtils.clamp(vy, -0.02, 0.02) * dt;
    F.pos.y = Math.max(F.pos.y, ground(F.pos.x, F.pos.z) + 0.006 + F.half * 0.3);
    // a gentle hover bob, pitch toward vertical motion, bank into turns
    const bob = 0.0012 * Math.sin(t * 1.3 + F.bobPh);
    F.root.position.set(F.pos.x, F.pos.y + bob, F.pos.z); F.root.rotation.y = F.yaw;
    F.pitch += (THREE.MathUtils.clamp(-vy * 12, -0.3, 0.3) - F.pitch) * Math.min(1, dt * 3);
    F.bank += (THREE.MathUtils.clamp(turn * 0.35, -0.3, 0.3) - F.bank) * Math.min(1, dt * 3);
    F.tilt.rotation.set(F.bank, 0, F.pitch);
    // body wave: phase integrated over time, amplitude from speed and turning
    const beat = Math.min(1, F.speed / 0.03 + Math.abs(turn) * 0.4);
    F.amp += (F.len * (0.012 + 0.05 * beat) - F.amp) * Math.min(1, dt * 4);
    F.u.uSwimPhase.value = (F.u.uSwimPhase.value + dt * (3 + 14 * beat)) % (Math.PI * 200);
    F.u.uSwimAmp.value = F.amp;
    // the GLB clip (fins, mouth, gills) runs a little faster when swimming; the display spreads the fins wider on top of it
    F.mixer.timeScale = F.held ? 0.5 : 0.8 + 0.9 * beat;
    F.mixer.update(dt);
    F.display += ((F.mode === 'display' && hoverEnd ? 1 : 0) - F.display) * Math.min(1, dt * 2);
    if (F.display > 0.01) {
      for (const n of ['pectoral_L', 'pectoral_R', 'pelvic_L', 'pelvic_R']) { const m = F.meshes[n]; if (m) m.morphTargetInfluences[0] = Math.min(1.3, m.morphTargetInfluences[0] + 0.6 * F.display); }
      F.tilt.rotation.x += 0.18 * F.display * Math.sin(t * 0.8);   // shows its flank, body slightly curved toward the female
      F.u.uSwimAmp.value += F.len * 0.03 * F.display;
    }
  }

  // ---------- water surface (calm: faint ripples, reflection, the tank seen through it) ----------
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
        uTint: { value: new THREE.Color(0x8a7a5c) }, uSky: { value: new THREE.Color(0xd9d6cc) }, uHalf: { value: new THREE.Vector2(W / 2, D / 2) },
      },
      vertexShader: `
        uniform float uTime; uniform mat4 uReflVP; varying vec3 vW; varying vec4 vReflClip; varying vec3 vN;
        float wave(vec2 p, float t){ return 0.0005*sin(p.x*41.+t*1.6) + 0.0004*sin(p.y*57.-t*1.4+p.x*9.) + 0.0002*sin((p.x+p.y)*93.+t*2.2); }
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
          vec2 off = vN.xz * 0.04;
          vec3 refr = uUseRT > .5 ? texture2D(uRefr, clamp(sUV + off, 0.001, .999)).rgb : uTint;
          vec3 col;
          if (above) {
            float fres = 0.03 + 0.5 * pow(1. - cosT, 5.);
            col = mix(refr * mix(vec3(1.), uTint, .2), uSky, fres);
          } else {
            vec2 rUV = vReflClip.xy / vReflClip.w * .5 + .5;
            vec3 refl = uUseRT > .5 ? texture2D(uRefl, clamp(rUV + off, 0.001, .999)).rgb : uTint;
            float tir = 1. - smoothstep(0.6, 0.72, cosT);
            col = mix(mix(refr, uSky, .35), refl * .9, max(tir, 0.2));
          }
          vec3 Ld = normalize(vec3(-0.1, 1., 0.3));
          float spec = pow(max(dot(reflect(-Ld, vN), V), 0.), 160.);
          col += spec * (above ? 0.12 : 0.35);
          vec2 edge = uHalf - abs(vW.xz);
          col += 0.1 * (1. - smoothstep(0.0, 0.003, min(edge.x, edge.y)));
          gl_FragColor = vec4(col, uUseRT > .5 ? 1. : 0.25 + 0.45 * (1. - cosT));
          #include <colorspace_fragment>
        }`,
    });
    surface = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.0006, D - 0.0006, STD ? 110 : 56, STD ? 66 : 34), mat);
    surface.rotation.x = -Math.PI / 2; surface.position.y = WL; surface.renderOrder = 3; scene.add(surface);
    return res;
  }
  let surfRes;

  // ---------- camera & views ----------
  const controls = new THREE.OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.minDistance = 0.05; controls.maxDistance = 1.8;
  controls.maxPolarAngle = Math.PI * 0.62; controls.target.set(0, 0.11, 0);
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

  // ---------- watch one fish (fish-watch.mjs): tap a fish or choose it; the camera follows, orbit and zoom stay free ----------
  let watched = null; const lastPos = new THREE.Vector3();
  const plantFade = on => swayMats.forEach(m => { m.transparent = on; m.opacity = on ? 0.25 : 1; m.depthWrite = !on; m.needsUpdate = true; });
  function startWatching(id) {
    const F = fishes.find(f => f.id === id); if (!F) return;
    if (mode === 'edit') setMode('view');
    watched = F; F.held = false; $('hold').setAttribute('aria-pressed', 'false'); $('hold').textContent = '止める';
    const s = LIB.watchStart(F.pos.toArray(), F.yaw, { aspect: camera.aspect, distance: camera.aspect < 1 ? 0.15 : 0.11 });
    camera.position.set(...LIB.clampWatchCamera(s.camera, { w: W, d: D }, { floorY: ground(F.pos.x, F.pos.z) + 0.01 })); controls.target.set(...s.target); controls.update();
    lastPos.copy(F.pos); controls.minDistance = 0.03;
    renderer.setClearColor(0x2c261b, 1); plantFade(true);
    const [n, sci, text] = INFO[id];
    $('info-name').textContent = n; $('info-sci').textContent = sci; $('info-text').textContent = text;
    $('info').hidden = false; $('info').classList.remove('open'); $('watch-bar').hidden = false;
    $('watch-select').value = id;
  }
  function stopWatching() {
    if (watched) watched.held = false;
    watched = null; $('info').hidden = true; $('watch-bar').hidden = true; $('watch-select').value = '';
    controls.minDistance = 0.05; renderer.setClearColor(CLEAR, 1); plantFade(false);
  }
  function followWatched() {
    if (!watched) return;
    const d = LIB.followDelta(lastPos.toArray(), watched.pos.toArray()); lastPos.copy(watched.pos);
    camera.position.x += d[0]; camera.position.y += d[1]; camera.position.z += d[2];
    controls.target.x += d[0]; controls.target.y += d[1]; controls.target.z += d[2];
    camera.position.set(...LIB.clampWatchCamera(camera.position.toArray(), { w: W, d: D }, { floorY: ground(camera.position.x, camera.position.z) + 0.008 }));
  }
  $('watch-select').addEventListener('change', e => e.target.value ? startWatching(e.target.value) : setView('front'));
  $('hold').addEventListener('click', () => { if (!watched) return; watched.held = !watched.held; $('hold').setAttribute('aria-pressed', String(watched.held)); $('hold').textContent = watched.held ? '動かす' : '止める'; });
  $('next').addEventListener('click', () => startWatching(LIB.nextWatchId(fishes.map(f => f.id), watched?.id)));
  $('all').addEventListener('click', () => setView('front'));
  $('info-close').addEventListener('click', () => $('info').hidden = true);
  $('info-text').addEventListener('click', () => $('info').classList.toggle('open'));
  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));

  function resize() {
    document.body.style.setProperty('--bar-h', document.querySelector('.bar').offsetHeight + 'px');   // panels sit above the (wrapping) bottom bar
    const r = stage.getBoundingClientRect();
    const size = LIB.aquariumDrawingSize(quality, r.width, r.height, devicePixelRatio);
    renderer.setPixelRatio(size.pixelRatio); renderer.setSize(size.cssWidth, size.cssHeight, false);
    camera.aspect = size.cssWidth / size.cssHeight; camera.fov = camera.aspect < 1 ? 50 : 34; camera.updateProjectionMatrix();
    const dw = size.drawingWidth, dh = size.drawingHeight;
    if (rtRefr) { rtRefr.setSize(dw >> 1, dh >> 1); rtRefl.setSize(dw >> 1, dh >> 1); }
    surfRes?.set(dw, dh);
    if (specks) specks.material.uniforms.uScale.value = dh * 0.0011;
    for (const b of bubbleCols) b.material.uniforms.uScale.value = dh * 0.0016;
  }

  // ---------- editing ----------
  let mode = 'view', selected = null, drag = null, down = null;
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
  const ring = new THREE.Mesh(new THREE.RingGeometry(1, 1.06, 64), new THREE.MeshBasicMaterial({ color: 0xe0b45c, transparent: true, opacity: .9, depthTest: false, fog: false }));
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
    if (!selected || !editables.get(selected)) { $('obj-controls').hidden = true; return; }
    const e = editables.get(selected), o = current(selected);
    $('obj-controls').hidden = false;
    $('pos-x').value = (o.position[0] / cm).toFixed(1); $('pos-z').value = (o.position[2] / cm).toFixed(1);
    $('rot-y').value = Math.round(((THREE.MathUtils.radToDeg(o.rotation[1]) + 540) % 360) - 180);
    ring.scale.setScalar(e.radius + 0.008); ring.position.set(e.root.position.x, e.root.position.y + e.sink + 0.002, e.root.position.z);
  }
  function setTransform(id, x, z, ry) {
    state.setTransform(id, { rotation: [0, ry, 0] });
    const [cx, cz] = clampPos(id, x, z);
    state.setTransform(id, { position: [cx, 0, cz] }); applyState(); save();
  }
  $('obj-select').addEventListener('change', e => select(e.target.value || null));
  for (const [inp, f] of [['pos-x', (o, v) => [v * cm, o.position[2], o.rotation[1]]], ['pos-z', (o, v) => [o.position[0], v * cm, o.rotation[1]]],
    ['rot-y', (o, v) => [o.position[0], o.position[2], THREE.MathUtils.degToRad(v)]]]) {
    $(inp).addEventListener('input', e => { if (!selected) return; const o = current(selected); setTransform(selected, ...f(o, Number(e.target.value))); });
  }
  $('reset').addEventListener('click', () => { state.restoreDefault(); applyState(); save(); flash('承認した配置に戻しました'); });
  function flash(text) { const n = $('toast'); n.textContent = text; n.hidden = false; clearTimeout(flash.t); flash.t = setTimeout(() => n.hidden = true, 2200); }

  function setRay(ev) { const r = canvas.getBoundingClientRect(); ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); }
  function pickObject(ev) {
    setRay(ev);
    const hits = ray.intersectObjects([...editables.values()].flatMap(e => e.picks), true);
    for (const h of hits) { let o = h.object; while (o && !o.userData.id) o = o.parent; if (o) return { id: o.userData.id, point: h.point }; }
    return null;
  }
  function pickFish(ev) {
    // the nearest visible fish: stop at the shell or the soil when they are in front of it
    setRay(ev);
    const blockers = [...editables.values()].flatMap(e => e.picks);
    const hits = ray.intersectObjects([...fishes.map(f => f.root), ...blockers], true);
    for (const h of hits) { let o = h.object; while (o && !o.userData.fish && !o.userData.id) o = o.parent; if (!o) continue; return o.userData.fish || null; }
    return null;
  }
  canvas.addEventListener('pointerdown', ev => {
    down = { x: ev.clientX, y: ev.clientY };
    if (mode !== 'edit') return;
    const p = pickObject(ev);
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
    if (drag && ev.pointerId === drag.pointer) { drag = null; controls.enabled = true; save(); return; }
    if (mode === 'view' && ev.type === 'pointerup' && LIB.isTap(down, { x: ev.clientX, y: ev.clientY })) { const id = pickFish(ev); if (id) startWatching(id); }
  };
  canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);

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
  let paused = false;                        // test hook: stop the loop so a slow (software) GPU can be screenshotted
  function step(dt) { t += dt; uTime.value = t; for (const F of fishes) updateFish(F, t, dt); }
  function frame(dt) {
    step(dt); followWatched(); controls.update();
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
    setView, fishes, pause(on) { paused = on; }, watch: startWatching,
    cam(p, tgt) { camera.position.set(...p); controls.target.set(...tgt); controls.update(); },
    advance(sec) { for (let k = 0; k < Math.round(sec * 30); k++) step(1 / 30); followWatched(); controls.update(); if (STD && surface) renderWaterPasses(); renderer.render(scene, camera); },
  };

  // ---------- start ----------
  (async () => {
    try {
      say('水槽を準備しています…');
      const [co, mi, ca] = await Promise.all([tex(A.textures.coconut), tex(A.textures.microsorum), tex(A.textures.catappa)]);
      maps = { coconut: co, microsorum: mi, catappa: ca };
      await buildTank();
      for (const o of L.objects) if (BUILD[o.kind]) makeObject(o);
      const sel = $('obj-select');
      for (const o of approved) sel.append(new Option(editables.get(o.id).label, o.id));
      if (loadSaved()) flash('前回の配置を読み込みました');
      applyState();
      surfRes = buildWater();
      resize(); setView('front');
      addEventListener('resize', resize);
      say('トリファスキアータを呼んでいます…');
      for (const f of L.fish) await addFish(f);
      const ws = $('watch-select');
      for (const F of fishes) ws.append(new Option(F.key === 'male' ? '観察：オス' : '観察：メス', F.id));
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
