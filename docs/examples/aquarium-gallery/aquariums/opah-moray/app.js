/* アカマンボウとウツボの水槽 — three.js r170 (window.THREE) + AquariumLib (aquarium-state / mobile-quality).
   Assets come from window.AQUARIUM_ASSETS: relative URLs (published page) or data: URIs (offline file).
   Units: metres. Tank centre on the floor at the origin, front glass +z, left -x. Approved layout: layout v1. */
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
  const QUALITY_KEY = 'opah-moray-aquarium:quality';
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
  const CLEAR = 0x07253b;
  renderer.setClearColor(CLEAR, 1);
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x2a86bd, 0.055);           // clear sunlit water: a light blue haze only far away
  const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 40);
  // daylight through the surface: bright sky-blue ambient plus one warm sun from above (approved layout v1)
  scene.add(new THREE.HemisphereLight(0xcbe8ff, 0x35607a, 0.8));
  const sun = new THREE.DirectionalLight(0xfff1d6, 1.15); sun.position.set(-0.8, 3, 1.4); scene.add(sun);
  const fill = new THREE.DirectionalLight(0x9fd0ee, 0.35); fill.position.set(1, 0.6, 1); scene.add(fill);

  // ---------- tank ----------
  const L = A.layout, cm = 0.01;
  const W = L.tank.w * cm, D = L.tank.d * cm, H = L.tank.h * cm, WL = L.tank.water * cm;
  // gently rippled sand, a little higher at the back
  const ground = (x, z) => (0.034 - 0.02 * (z / D + 0.5)) + 0.007 * Math.sin(x * 3.1 + z * 2.3) + 0.004 * Math.cos(x * 7.0 - z * 5.0);

  const uTime = { value: 0 };
  const loader = new THREE.TextureLoader();
  const tex = (url, { repeat, srgb = true, mirror = false } = {}) => new Promise((ok, fail) => loader.load(url, t => {
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) { t.wrapS = t.wrapT = mirror ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping; t.repeat.set(...repeat); }
    t.anisotropy = STD ? 4 : 1; ok(t);
  }, undefined, () => fail(new Error('画像を読み込めませんでした: ' + url))));

  // light patterns that wander over the sand and the rocks (the sun through the ripples), injected into Lambert materials
  const CAUSTIC = `
    uniform float uCT; uniform float uCaus; varying vec3 vWP;
    float caustic(vec2 p){
      vec2 q = p * 2.6; float t = uCT;
      float a = sin(q.x*1.3 + t*0.55 + sin(q.y*1.7 - t*0.4));
      float b = sin(q.y*1.5 - t*0.5 + sin(q.x*1.1 + t*0.35));
      float c = sin((q.x+q.y)*1.9 + t*0.7);
      float v = 1.0 - abs(a*0.5 + b*0.5 + c*0.35);
      return pow(clamp(v, 0., 1.), 5.0);
    }
`;
  function addCaustics(sh, strength, vertexExtra = '') {
    sh.uniforms.uCT = uTime; sh.uniforms.uCaus = { value: strength };
    sh.vertexShader = 'varying vec3 vWP;\n' + sh.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;' + vertexExtra);
    return CAUSTIC;
  }

  let plankton, shafts = [];
  async function buildTank() {
    const sandT = await tex(A.textures.sand, { repeat: [L.tank.w / 60, L.tank.d / 60] });
    // back wall: the open-water picture, unlit and without fog (the picture already carries the surface light and the beams)
    const bgT = await tex(A.textures.background);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.02, H), new THREE.MeshBasicMaterial({ map: bgT, fog: false, side: THREE.FrontSide }));
    back.position.set(0, H / 2, -D / 2 - 0.004); scene.add(back);
    // sand
    const g = new THREE.PlaneGeometry(W, D, 120, 45); g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, ground(p.getX(i), p.getZ(i)));
    g.computeVertexNormals();
    const sandM = new THREE.MeshLambertMaterial({ map: sandT });
    sandM.onBeforeCompile = sh => {
      const glsl = addCaustics(sh, 0.55);
      sh.fragmentShader = glsl + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        diffuseColor.rgb *= 1.0 + uCaus * caustic(vWP.xz);`);
    };
    sandM.customProgramCacheKey = () => 'sand-caustic';
    scene.add(new THREE.Mesh(g, sandM));
    // the bed is a closed block: skirts down from the sand edge to a bottom plane, so it is solid from the sides and from below
    const DEPTH = 0.45, skirt = (pts, dirU, vScale) => {          // pts: [[x, z], ...] along one edge
      const pos = [], uv = [], idx = [];
      pts.forEach(([x, z], k) => {
        const h = ground(x, z), u = k / (pts.length - 1) * dirU;
        pos.push(x, h, z, x, -DEPTH, z); uv.push(u, 0, u, (h + DEPTH) / vScale);
        if (k) { const a = (k - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      });
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); sg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); sg.setIndex(idx);
      sg.computeVertexNormals(); return sg;
    };
    const skirtMat = new THREE.MeshLambertMaterial({ map: sandT, side: THREE.DoubleSide, color: 0xd8d0c0 });
    const nE = 120, ex = k => -W / 2 + W * k / nE, ez = k => -D / 2 + D * k / 45;
    const edges4 = [
      [[...Array(nE + 1)].map((_, k) => [ex(k), D / 2]), L.tank.w / 60, 1.5],
      [[...Array(nE + 1)].map((_, k) => [ex(k), -D / 2]), L.tank.w / 60, 1.5],
      [[...Array(46)].map((_, k) => [-W / 2, ez(k)]), L.tank.d / 60, 1.5],
      [[...Array(46)].map((_, k) => [W / 2, ez(k)]), L.tank.d / 60, 1.5],
    ];
    for (const [pts, du, vs] of edges4) { const m = new THREE.Mesh(skirt(pts, du / (L.tank.w / 60), vs), skirtMat); scene.add(m); }
    const bottom = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshLambertMaterial({ color: 0x9e9078, side: THREE.DoubleSide }));
    bottom.rotation.x = Math.PI / 2; bottom.position.y = -DEPTH; scene.add(bottom);
    // glass: faint panes and edges
    const glassMat = new THREE.MeshBasicMaterial({ color: 0xbfe2f5, transparent: true, opacity: 0.03, depthWrite: false, side: THREE.DoubleSide, fog: false });
    for (const [w, h, x, y, z, ry] of [[W, H, 0, H / 2, D / 2, 0], [D, H, -W / 2, H / 2, 0, Math.PI / 2], [D, H, W / 2, H / 2, 0, Math.PI / 2]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glassMat); m.position.set(x, y, z); m.rotation.y = ry; scene.add(m);
    }
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(W, H, D)), new THREE.LineBasicMaterial({ color: 0x9cc7de, transparent: true, opacity: 0.55, fog: false }));
    edges.position.y = H / 2; scene.add(edges);
    // sunbeams: slanted, soft, additive strips that sway slowly
    const rs = seeded('sunbeams');
    for (let i = 0; i < (STD ? 7 : 4); i++) {
      const w = 0.35 + rs() * 0.5, x = (rs() - 0.5) * W * 0.9, z = -D / 2 + 0.08 + rs() * 0.25;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, WL * 1.05), new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide,
        uniforms: { uTime, uPh: { value: rs() * 6.28 }, uA: { value: 0.02 + rs() * 0.03 } },
        vertexShader: 'varying vec2 u;void main(){u=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
        fragmentShader: `varying vec2 u; uniform float uTime, uPh, uA;
          void main(){ float e = smoothstep(0., .5, u.x) * smoothstep(1., .5, u.x);
            float f = smoothstep(0., .55, u.y) * (0.45 + 0.55*u.y);          // strongest near the surface
            float s = 0.75 + 0.25*sin(uTime*0.35 + uPh + u.y*3.);
            gl_FragColor = vec4(vec3(.62,.86,1.) * e * f * s * uA * 2.2, 1.); }`,
      }));
      m.position.set(x, WL / 2, z); m.rotation.z = -0.22 + (rs() - 0.5) * 0.12; m.renderOrder = 1; scene.add(m); shafts.push(m);
    }
    // drifting plankton specks
    const n = STD ? 520 : 240, pos = new Float32Array(n * 3), seed = new Float32Array(n);
    const r = seeded('plankton');
    for (let i = 0; i < n; i++) { pos[i * 3] = (r() - .5) * W; pos[i * 3 + 1] = r() * WL; pos[i * 3 + 2] = (r() - .5) * D; seed[i] = r(); }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); sg.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    plankton = new THREE.Points(sg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTime, uWL: { value: WL }, uScale: { value: 1 } },
      vertexShader: `uniform float uTime, uWL, uScale; attribute float aSeed; varying float vA;
        void main(){
          vec3 p = position;
          p.y = mod(p.y + uTime * (0.003 + 0.004 * aSeed), uWL);
          p.x += 0.02 * sin(uTime * 0.25 + aSeed * 40.);
          vec4 mv = modelViewMatrix * vec4(p, 1.);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uScale * (1.0 + 1.6 * aSeed) / -mv.z;
          vA = (0.22 + 0.3 * aSeed) * smoothstep(9., 2., -mv.z);
        }`,
      fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - .5); gl_FragColor = vec4(vec3(.86,.95,1.), vA * smoothstep(.5, .1, d)); }`,
    }));
    plankton.frustumCulled = false; scene.add(plankton);
  }

  // ---------- rocks (editable) ----------
  const editables = new Map();      // id -> {root, mesh, kind, radius, label, sink}
  let stoneMats;
  function stoneMaterial(map) {
    const m = new THREE.MeshLambertMaterial({ map, vertexColors: true });
    m.onBeforeCompile = sh => {
      const glsl = addCaustics(sh, 0.32, '\nvObjP = position; vObjN = normal;');
      sh.vertexShader = 'varying vec3 vObjP; varying vec3 vObjN;\n' + sh.vertexShader;
      // triplanar in object space: the texture never stretches on the rock tops and stays put when a rock is moved
      sh.fragmentShader = 'varying vec3 vObjP; varying vec3 vObjN;\n' + glsl + sh.fragmentShader.replace('#include <map_fragment>', `
        vec3 bw = pow(abs(normalize(vObjN)), vec3(4.)); bw /= (bw.x + bw.y + bw.z);
        vec3 P = vObjP * 0.9;                  // one picture per ~1.1 m of rock (mirrored at the edges, so no seams)
        vec4 tri = texture2D(map, P.zy) * bw.x + texture2D(map, P.xz) * bw.y + texture2D(map, P.xy) * bw.z;
        diffuseColor *= tri;
        diffuseColor.rgb *= 1.0 + uCaus * caustic(vWP.xz) * clamp(1.4 - vWP.y * 0.6, 0., 1.);`);
    };
    m.customProgramCacheKey = () => 'rock-triplanar-caustic';
    return m;
  }
  function seeded(id) { let h = 2166136261; for (const c of String(id)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) / 4294967296); }
  // A boxy, lumpy rock sunk into the sand: ridges, pits, and (for the big ones) a cave pressed into the front with a brow
  // that overhangs it. Vertex colours darken the pits and the inside of the cave.
  function rockGeometry(o) {
    const [w, h, d] = o.size.map(v => v * cm);
    const geo = new THREE.SphereGeometry(0.5, STD ? 120 : 80, STD ? 84 : 56), q = geo.attributes.position, nv = q.count;
    const rnd = seeded('rock' + o.seed), colors = new Float32Array(nv * 3).fill(1);
    const bumps = [...Array(10)].map(() => {
      const dir = new THREE.Vector3(rnd() * 2 - 1, rnd() * 1.4 - 0.3, rnd() * 2 - 1).normalize();
      return { dir, a: 0.05 + rnd() * 0.16, k: 2 + rnd() * 3 };
    });
    const pits = [...Array(46)].map(() => {
      const dir = new THREE.Vector3(rnd() * 2 - 1, rnd() * 1.6 - 0.2, rnd() * 2 - 1).normalize();
      return { dir, rad: 0.05 + rnd() * 0.07, dep: 0.03 + rnd() * 0.05 };
    });
    const ph = [rnd() * 6, rnd() * 6, rnd() * 6], v = new THREE.Vector3();
    const cave = o.cave ? { x: o.cave.x * cm, y: o.cave.y * cm, rw: o.cave.w * cm / 2, rh: o.cave.h * cm / 2, depth: o.cave.depth * cm } : null;
    const bx = (a, p) => Math.sign(a) * Math.pow(Math.abs(a), p);
    const raw = new Float32Array(nv * 3);
    let mx = 0, my = 0, mz = 0;
    for (let i = 0; i < nv; i++) {
      v.fromBufferAttribute(q, i).normalize();
      let r = 1, shade = 1;
      for (const b of bumps) r += b.a * Math.max(0, v.dot(b.dir)) ** b.k;
      const ridge = 1 - Math.abs(Math.sin(v.x * 6 + 2 * Math.sin(v.y * 5 + ph[0]) + ph[1]));
      r += 0.05 * ridge * ridge + 0.025 * Math.sin(v.z * 13 + v.x * 5 + ph[2]);
      for (const p of pits) { const a = Math.acos(Math.min(1, v.dot(p.dir))) / p.rad; if (a < 1) { const k = 1 - a * a; r -= p.dep * k; shade = Math.min(shade, 1 - 0.45 * k); } }
      // boxier outline: pull the direction toward the cube
      const bxv = bx(v.x, 0.78), byv = v.y > 0 ? Math.pow(v.y, 0.78) : v.y, bzv = bx(v.z, 0.78);
      const X = bxv * r, Y = (byv > 0 ? byv : byv * 0.3) * r, Z = bzv * r;
      raw[i * 3] = X; raw[i * 3 + 1] = Y; raw[i * 3 + 2] = Z;
      mx = Math.max(mx, Math.abs(X)); my = Math.max(my, Y); mz = Math.max(mz, Math.abs(Z));
      colors[i * 3] = shade;
    }
    // scale to exactly the size in the layout (width, height above the sand, depth), whatever the lumps did
    const kx = (w / 2) / mx, ky = h / my, kz = (d / 2) / mz;
    for (let i = 0; i < nv; i++) {
      let X = raw[i * 3] * kx, Y = raw[i * 3 + 1] * ky, Z = raw[i * 3 + 2] * kz, shade = colors[i * 3];
      if (cave && Z > -0.05) {
        const u = (X - cave.x) / cave.rw, t = (Y - cave.y) / cave.rh, qq = u * u + t * t;
        if (qq < 1) {                                   // the hollow
          const k = Math.sqrt(1 - qq), wob = 1 + 0.12 * Math.sin(X * 23 + Y * 17);
          Z = Math.max(Z - cave.depth * k * wob, Z * 0.2);
          const kk = Math.min(1, k / 0.45); shade = Math.min(shade, 1 - 0.9 * kk * kk * (3 - 2 * kk));
        }
        // the brow: the surface just above the opening bulges outward and hangs over it
        const bu = Math.max(0, 1 - Math.abs(u) / 1.25), bt = (t - 0.6) / 1.2;
        if (bt > 0 && bt < 1.4 && bu > 0) Z += 0.2 * bu * Math.sin(Math.min(1, bt) * Math.PI * 0.5) * (1 - 0.5 * Math.max(0, bt - 1) / 0.4);
      }
      q.setXYZ(i, X, Y, Z);
      colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = shade;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    return geo;
  }
  function makeRock(o) {
    const mesh = new THREE.Mesh(rockGeometry(o), stoneMats[o.color]);
    const root = new THREE.Group(); root.add(mesh); root.userData.id = o.id; scene.add(root);
    let ledge = null;
    if (o.cave) {                                    // a flat, rounded ledge on the floor of the cave
      ledge = new THREE.Mesh(new THREE.SphereGeometry(0.5, 40, 16), stoneMats[o.color]);
      const c = o.cave; ledge.scale.set(c.w * cm * 0.8, 0.07, c.depth * cm * 0.95);
      ledge.geometry = ledge.geometry.clone(); const col = new Float32Array(ledge.geometry.attributes.position.count * 3).fill(0.9);
      ledge.geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
      root.add(ledge); mesh.userData.ledge = ledge;
      // seat it on the floor of the cave: find the back wall at the cave's centre (rock's own frame; the rock is still at the origin)
      root.updateMatrixWorld(true);
      const rc = new THREE.Raycaster(new THREE.Vector3(c.x * cm, c.y * cm, 1.5), new THREE.Vector3(0, 0, -1));
      const h = rc.intersectObject(mesh, false)[0];
      const zWall = h ? h.point.z : 0.1, top = c.y * cm - c.h * cm * 0.5 * (c.floor ?? 0.72) + 0.035;
      const span = Math.min(c.depth * cm, o.size[2] * cm / 2 - zWall) * 0.92;           // stays inside the mouth
      ledge.scale.set(c.w * cm * (c.floor_w ?? 0.8), 0.07, span);
      ledge.position.set(c.x * cm, top - 0.035, zWall + span / 2 + 0.005);
      ledge.userData = { zWall, top };
    }
    editables.set(o.id, { root, mesh, ledge, kind: 'stone', radius: Math.max(o.size[0], o.size[2]) * cm / 2, label: '岩' + o.id.split('-')[1], sink: 0.02, o });
  }
  const rockMeshes = () => [...editables.values()].filter(e => e.kind === 'stone').flatMap(e => e.ledge ? [e.mesh, e.ledge] : [e.mesh]);
  const downRay = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0), 0, 6);
  const hitV = new THREE.Vector3();
  // surface height at (x, z): the sand or the top of a rock, whichever is higher
  function heightAt(x, z, top = 3) {      // top: where the ray starts (a low value ignores overhangs above a creature on the floor)
    let y = ground(x, z);
    downRay.set(hitV.set(x, top, z), new THREE.Vector3(0, -1, 0));
    const hits = downRay.intersectObjects(rockMeshes(), false);
    if (hits.length) y = Math.max(y, hits[0].point.y);
    return y;
  }

  // ---------- seaweed (editable): cut-outs from the approved layout picture, two crossed sheets that sway ----------
  let kelpMap;
  function makePlant(o) {
    const K = A.kelp.plants[o.plant], [W0, H0] = A.kelp.atlas, [rx, ry, rw, rh] = K.rect;
    const u0 = rx / W0, u1 = (rx + rw) / W0, v1 = 1 - ry / H0, v0 = 1 - (ry + rh) / H0;
    const group = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ map: kelpMap, alphaTest: 0.5, side: THREE.DoubleSide });
    mat.onBeforeCompile = sh => {
      sh.uniforms.uSway = uTime;
      sh.vertexShader = 'uniform float uSway; attribute float aSway;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        float ph = modelMatrix[3].x * 3.1 + modelMatrix[3].z * 2.3;
        transformed.x += aSway * (0.035 * sin(uSway * 0.9 + ph) + 0.012 * sin(uSway * 1.7 + ph * 1.7));
        transformed.z += aSway * 0.015 * sin(uSway * 0.7 + ph + 1.3);`);
    };
    mat.customProgramCacheKey = () => 'kelp-sway';
    const h = K.height_m, w = K.width_m;
    for (const ry_ of [0, Math.PI / 2]) {
      const g = new THREE.PlaneGeometry(w, h, 1, 10);
      g.translate((0.5 - K.base_u) * w, h / 2, 0);
      const uv = g.attributes.uv, pos = g.attributes.position, sway = new Float32Array(pos.count);
      for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
        sway[i] = Math.pow(pos.getY(i) / h, 2);
      }
      g.setAttribute('aSway', new THREE.BufferAttribute(sway, 1));
      const m = new THREE.Mesh(g, mat); m.rotation.y = ry_; m.frustumCulled = false; group.add(m);
    }
    group.userData.id = o.id; scene.add(group);
    editables.set(o.id, { root: group, mesh: group, kind: 'plant', radius: Math.max(0.12, w * 0.32), label: '海藻' + o.id.split('-')[1], sink: 0.04, o });
  }

  // ---------- layout state (approved layout -> aquarium-state) ----------
  const approved = L.objects.map(o => ({
    id: o.id, kind: o.kind, position: [o.pos[0] * cm, 0, o.pos[2] * cm], rotation: [0, (o.rot_deg || 0) * Math.PI / 180, 0],
    ...(o.kind === 'stone' ? { colorId: o.color } : {}),
  }));
  const REVISION = 'layout-v' + L.version;
  const SAVE_KEY = 'opah-moray-aquarium:aquarium:' + REVISION;
  const state = LIB.createAquariumState(approved, { palette: ['blue', 'red'], revision: REVISION });
  function clampPos(id, x, z) {
    const e = editables.get(id), r = e.radius + 0.01;
    return [Math.min(W / 2 - r, Math.max(-W / 2 + r, x)), Math.min(D / 2 - r, Math.max(-D / 2 + r, z))];
  }
  function applyState() {
    const snap = state.snapshot().objects;
    for (const o of snap) {                                // rocks first: the seaweed stands on whatever is under it
      const e = editables.get(o.id); if (!e || e.kind !== 'stone') continue;
      const [x, z] = clampPos(o.id, o.position[0], o.position[2]);
      e.root.position.set(x, ground(x, z) - e.sink, z); e.root.rotation.y = o.rotation[1];
      e.mesh.material = stoneMats[o.colorId]; if (e.ledge) e.ledge.material = stoneMats[o.colorId];
      e.root.updateMatrixWorld(true);
    }
    for (const o of snap) {
      const e = editables.get(o.id); if (!e || e.kind !== 'plant') continue;
      const [x, z] = clampPos(o.id, o.position[0], o.position[2]);
      e.root.position.set(x, heightAt(x, z) - e.sink, z); e.root.rotation.y = o.rotation[1];
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
    uniform float uJaw; uniform vec2 uHinge, uPivot;
    uniform float uPath; uniform float uPX[12]; uniform float uPZ[12]; uniform float uPY[12]; uniform float uTh[12];
    float cr(float p0, float p1, float p2, float p3, float t){ return 0.5 * ((2. * p1) + (-p0 + p2) * t + (2. * p0 - 5. * p1 + 4. * p2 - p3) * t * t + (-p0 + 3. * p1 - 3. * p2 + p3) * t * t * t); }
    attribute float aFinH;
`;
  const SWIM_BEGIN = `#include <begin_vertex>
    if (uJaw != 0.) {               // lower jaw (and its teeth): swing about the corner of the mouth, front end down for uJaw > 0
      vec2 dj = transformed.xy - uHinge; float cj = cos(uJaw), sj = sin(uJaw);
      transformed.xy = uHinge + vec2(dj.x * cj - dj.y * sj, dj.x * sj + dj.y * cj);
    }
    if (uIsPec > 1.5) {             // pectoral fin hanging along the flank: swings up and down about its root in the side plane
      vec2 dp = transformed.xy - uPivot; float dist = length(dp);
      float ang = uFlapAngle + uFlutter * dist * 4.0 * sin(uFlutterPhase - dist * uFlutterK);     // the tip lags behind the root
      float cp = cos(ang), sp = sin(ang);
      transformed.xy = uPivot + vec2(dp.x * cp - dp.y * sp, dp.x * sp + dp.y * cp);
      transformed.z += uFlapSide * 0.25 * uFlutter * dist * sin(uFlutterPhase * 0.8 - dist * uFlutterK * 0.7 + 1.1);
    } else if (uIsPec > 0.5) {      // pectoral fin: beat up and down about its root line, outward from the body
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
    float lat = transformed.z + bend * sin(uSwimPhase - s * uWaves) + uRipple * aFinH * sin(uRipplePhase - s * uRippleWaves);
    if (uPath > 0.5) {
      // the body is laid along a curved path (12 stations, smooth between them): each cross-section is moved to its station
      // AND turned to face along the path, so the body stays round through the bends instead of being sheared flat
      float fi = clamp(s * 11., 0., 10.9999); int k = int(fi); float fr = fi - float(k);
      int k0 = max(k - 1, 0), k3 = min(k + 2, 11);
      float px = cr(uPX[k0], uPX[k], uPX[k + 1], uPX[k3], fr);
      float pz = cr(uPZ[k0], uPZ[k], uPZ[k + 1], uPZ[k3], fr);
      float py = cr(uPY[k0], uPY[k], uPY[k + 1], uPY[k3], fr);
      float th = cr(uTh[k0], uTh[k], uTh[k + 1], uTh[k3], fr);
      transformed = vec3(px, transformed.y + py, pz) + vec3(-sin(th), 0., cos(th)) * lat;
    } else transformed.z = lat;`;
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
        // translucent membrane: paler areas between the drawn rays let the water show through, rays stay denser
        float lum = dot(diffuseColor.rgb, vec3(.299, .587, .114));
        diffuseColor.a *= mix(0.55, 0.92, clamp((0.75 - lum) * 2.6, 0., 1.));`);
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
    opah: { amp: 0.009, bendStart: 0.55, waves: 3.2, ripple: 0, rippleWaves: 0, finKind: 'fin' },
    moray: { amp: 0.04, bendStart: 0.0, waves: 9.5, ripple: 0.002, rippleWaves: 40, finKind: 'solid' },
  };
  const FIN = /^(dorsal|caudal|pectoral|pelvic|anal|adipose)/;
  // cross-sections of a lofted body (rings of 49 vertices, two cap points at the end): x, centre y, half height, half width
  function bodyRings(g) {
    const p = g.attributes.position, NT = 49, nr = Math.floor((p.count - 2) / NT), R = [];
    for (let j = 0; j < nr; j++) {
      let x = 0, y0 = Infinity, y1 = -Infinity, z = 0;
      for (let k = 0; k < NT; k++) { const i = j * NT + k; x += p.getX(i); y0 = Math.min(y0, p.getY(i)); y1 = Math.max(y1, p.getY(i)); z = Math.max(z, Math.abs(p.getZ(i))); }
      R.push([x / NT, (y0 + y1) / 2, Math.max((y1 - y0) / 2, 1e-4), z]);
    }
    R.sort((a, b) => a[0] - b[0]);
    return R;
  }
  function surfaceZ(R, x, y) {                 // half thickness of the body at (x, y): superellipse cross-section (power 2.3)
    let lo = 0, hi = R.length - 1;
    if (x <= R[0][0]) hi = 0; else if (x >= R[hi][0]) lo = hi;
    else { while (hi - lo > 1) { const m = (lo + hi) >> 1; if (R[m][0] <= x) lo = m; else hi = m; } }
    const a = R[lo], b = R[hi], t = hi === lo ? 0 : (x - a[0]) / (b[0] - a[0]);
    const cy = a[1] + (b[1] - a[1]) * t, hh = a[2] + (b[2] - a[2]) * t, hw = a[3] + (b[3] - a[3]) * t;
    const q = Math.min(Math.abs(y - cy) / hh, 1);
    return hw * Math.pow(1 - Math.pow(q, 2.3), 1 / 2.3);
  }
  // opah pectoral: it flaps like a wing. The approved raised pose (blade pointing up and back, flat on the upper flank) is
  // rotated about a fore-and-aft axis through its root by phi: 0 = raised, pi/2 = held straight out sideways, pi = lowered,
  // flat on the lower flank (the raised pose flipped upside down, as seen from the side). Every point is kept just off the
  // curved skin; the root is sunk into the body. The tip lags a little behind the root.
  const OPAH_UP_DEG = 55;
  function raisedPose(F) {
    const { fins, piv } = F.hang, a = (OPAH_UP_DEG - piv.rest_deg) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    for (const fin of fins) {
      const r0 = fin.rest, n = r0.length / 3, up = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        const dx = r0[i * 3] - piv.x, dy = r0[i * 3 + 1] - piv.y;
        up[i * 2] = dx * c - dy * s; up[i * 2 + 1] = dx * s + dy * c;
      }
      fin.up = up;
    }
  }
  function flapPectorals(F, phi, lag) {
    const { fins, piv, rings } = F.hang;
    for (const fin of fins) {
      const P = fin.g.attributes.position, a = P.array, up = fin.up, n = P.count, half = n >> 1;
      for (let i = 0; i < n; i++) {
        const dx = up[i * 2], dy = up[i * 2 + 1], r = Math.hypot(dx, dy);
        const ph = Math.min(Math.PI, Math.max(0, phi + lag * r));
        const cp = Math.cos(ph), sp = Math.sin(ph);
        const x = piv.x + dx, y = piv.y + dy * cp;
        const out = Math.max(dy * sp, 0);                                   // how far the blade stands out from the flank
        const z = surfaceZ(rings, x, y) + piv.gap_m + 0.03 * r + out - piv.sink_m * Math.max(0, 1 - r / piv.root_zone_m);
        const t = (i < half ? -1 : 1) * piv.half_thick_m;                   // the two faces, along the blade's normal
        a[i * 3] = x; a[i * 3 + 1] = y - t * sp; a[i * 3 + 2] = fin.side * (z + t * cp);
      }
      P.needsUpdate = true; fin.g.computeVertexNormals();
    }
  }
  const fishes = [];
  async function addFish(f, i) {
    const sp = f.species, S = SPECIES[sp], { parts, map, box } = await loadModel(f.model);
    const len = box.max.x - box.min.x;
    const u = {
      uSwimPhase: { value: i * 2.1 }, uSwimAmp: { value: S.amp }, uX0: { value: box.min.x }, uLen: { value: len },
      uBendStart: { value: S.bendStart }, uWaves: { value: S.waves },
      uRipple: { value: S.ripple }, uRipplePhase: { value: i * 1.3 }, uRippleWaves: { value: S.rippleWaves },
      uFlapAngle: { value: 0 }, uFlapZ0: { value: 0 }, uFlapSide: { value: 1 }, uIsPec: { value: 0 },
      uFlutter: { value: 0 }, uFlutterPhase: { value: i * 0.9 }, uFlutterK: { value: 12 },
      uJaw: { value: 0 }, uHinge: { value: new THREE.Vector2(0, 0) }, uPivot: { value: new THREE.Vector2(0, 0) },
      uPath: { value: 0 }, uPX: { value: new Array(12).fill(0) }, uPZ: { value: new Array(12).fill(0) }, uPY: { value: new Array(12).fill(0) }, uTh: { value: new Array(12).fill(0) },
    };
    const hinge = A.models[f.model].hinge;
    const ju = { ...u }; if (hinge) ju.uHinge = { value: new THREE.Vector2(hinge.x, hinge.y) };      // own jaw angle, same everything else
    const jawU = { ...ju, uJaw: { value: 0 } };
    const model = new THREE.Group(), pecs = [], mats = {};
    let hangFins = null;
    for (const P of parts) {
      let mat;
      const isFin = FIN.test(P.name);
      const opts = { opacity: P.opacity, frontOnly: P.frontOnly, depthWrite: P.depthWrite };
      if (hinge && /^(lower_jaw|tooth_lo)/.test(P.name)) mat = mats.jaw ??= fishMaterial('body', map, jawU, opts);
      else if (/^pectoral/.test(P.name) && A.models[f.model].pectoral_pivot) {
        // the blade along the flank (opah): moved on the CPU every frame so that it swings about its root and keeps following
        // the curve of the body (see flapPectorals). Own copy of the geometry; plain fin material.
        P.g = P.g.clone(); P.g.attributes.position.setUsage(THREE.DynamicDrawUsage);
        mat = mats.fin ??= fishMaterial('fin', map, u, opts);
        const bb = P.g.boundingBox;
        (hangFins ??= []).push({ g: P.g, rest: P.g.attributes.position.array.slice(), side: (bb.min.z + bb.max.z) > 0 ? 1 : -1 });
      } else if (/^pectoral/.test(P.name)) {          // own uniforms: root line and side of this fin
        const bb = P.g.boundingBox, side = (bb.min.z + bb.max.z) > 0 ? 1 : -1;
        const piv = A.models[f.model].pectoral_pivot;                            // set for the hanging fin: it swings about this point
        const pu = { ...u, uIsPec: { value: piv ? 2 : 1 }, uFlapSide: { value: side }, uFlapZ0: { value: side > 0 ? bb.min.z : -bb.max.z }, uFlapAngle: { value: 0 }, uPivot: { value: new THREE.Vector2(piv?.x ?? 0, piv?.y ?? 0) } };
        mat = fishMaterial(S.finKind === 'fin' ? 'fin' : 'body', map, pu, opts); pecs.push(pu);
      } else if (isFin && S.finKind === 'fin') mat = mats.fin ??= fishMaterial('fin', map, u, opts);
      else mat = mats.body ??= fishMaterial('body', map, u, opts);
      const mesh = new THREE.Mesh(P.g, mat);
      mesh.name = P.name; mesh.frustumCulled = false;  // vertex animation moves fins beyond the static bounds
      if (mat.transparent) mesh.renderOrder = mat.depthWrite ? 1 : 2;
      model.add(mesh);
    }
    model.scale.setScalar(f.length_cm * cm / len);
    const inner = new THREE.Group(); inner.add(model);
    const root = new THREE.Group(); root.add(inner);
    const bodyPart = parts.find(P => P.name === 'body');
    const hang = hangFins && { fins: hangFins, piv: A.models[f.model].pectoral_pivot, rings: bodyRings(bodyPart.g) };
    const F = { sp, f, root, inner, model, u, jawU, pecs, i, len, hang, pivRest: A.models[f.model].pectoral_pivot?.rest_deg, scale: f.length_cm * cm / len, half: (box.max.y - box.min.y) / 2 * f.length_cm * cm / len };
    if (f.rock) {                                // lives in a hollow of a rock: moves with it
      const R = editables.get(f.rock); R.root.add(root); F.parentRock = R;
      u.uPath.value = 1;
      if (f.den) F.den = denPath(R); else placeInHollow(F);
    } else scene.add(root);
    fishes.push(F);
  }
  // seat the first moray on the ledge inside the cave of its rock (all in the rock's own frame, so it moves with the rock)
  function placeInHollow(F) {
    const R = F.parentRock, c = R.o.cave, f = F.f;
    R.root.updateMatrixWorld(true);
    const xl = (c.x + f.local_cm[0]) * cm, yl = c.y * cm;
    const { zWall, top: yFloor } = R.ledge.userData;                                    // back wall of the cave, top of the ledge
    const zl = zWall + 0.17;
    F.root.position.set(xl, yFloor + F.half * 0.9, zl);
    F.root.rotation.y = Math.PI - 0.28 + (f.heading_deg || 0) * Math.PI / 180;      // head to the right, turned a little toward the glass
  }

  // ---------- eels: the body laid along a path (model space = rock's frame / scale) ----------
  const NST = 12, ST = [...Array(NST)].map((_, k) => k / (NST - 1));
  function setStations(F, pts) {                  // pts: NST points [x, y, z] in model space, head first
    const u = F.u; let prev = null;
    for (let k = 0; k < NST; k++) {
      const a = pts[Math.max(k - 1, 0)], b = pts[Math.min(k + 1, NST - 1)];
      let th = Math.atan2(b[2] - a[2], b[0] - a[0]);              // direction toward the tail
      if (prev != null) th = prev + Math.atan2(Math.sin(th - prev), Math.cos(th - prev));   // unwrapped
      u.uPX.value[k] = pts[k][0]; u.uPY.value[k] = pts[k][1]; u.uPZ.value[k] = pts[k][2]; u.uTh.value[k] = th; prev = th;
    }
  }
  // the den in the right rock: a hook-shaped run inside the cave (along the side wall, then along the back wall, then out
  // through the mouth) continuing straight out onto the sand in front of it. Rock's own frame, metres.
  function denPath(R) {
    const c = R.o.cave, { zWall } = R.ledge.userData, xc = c.x * cm, hw = c.w * cm / 2;
    const zIn = zWall + 0.06, xL = xc - hw * 0.8, xR = xc + 0.03, r1 = 0.08, r2 = 0.11;
    const P = [];
    const line = (x0, z0, x1, z1) => { const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.01)); for (let i = 0; i < n; i++) P.push([x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n]); };
    const arc = (cx, cz, r, a0, a1) => { const n = Math.ceil(Math.abs(a1 - a0) * r / 0.01); for (let i = 0; i < n; i++) { const a = a0 + (a1 - a0) * i / n; P.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]); } };
    line(xL, zIn + r1 + 0.12, xL, zIn + r1);                       // tail end: along the left wall, toward the back
    arc(xL + r1, zIn + r1, r1, Math.PI, 1.5 * Math.PI);             // round the back-left corner
    line(xL + r1, zIn, xR, zIn);                                   // along the back wall
    arc(xR, zIn + r2, r2, -0.5 * Math.PI, 0);                      // turn toward the mouth
    line(xR + r2, zIn + r2, xR + r2, 0.95);                        // out through the mouth and onto the sand
    P.push([xR + r2, 0.95]);
    const L = [0]; for (let i = 1; i < P.length; i++) L.push(L[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    // the mouth: where the straight run leaves the cave (the rock's front surface at that x)
    const rc = new THREE.Raycaster(new THREE.Vector3(xR + r2, c.y * cm - c.h * cm * 0.3, 1.5), new THREE.Vector3(0, 0, -1));
    const h = rc.intersectObject(R.mesh, false)[0];
    let zMouth = 0.35; if (h) zMouth = R.root.worldToLocal(h.point.clone()).z;
    const aMouth = L[P.findIndex(p => p[1] >= zMouth && p[0] >= xR + r2 - 1e-6)] ?? L[L.length - 1] * 0.7;
    return { P, L, aMouth };
  }
  function denAt(D, a) {                            // point and unit tangent (toward increasing a) at arc length a
    const { P, L } = D; a = Math.min(Math.max(a, 0), L[L.length - 1] - 1e-6);
    let lo = 0, hi = L.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L[m] <= a) lo = m; else hi = m; }
    const t = (a - L[lo]) / Math.max(L[hi] - L[lo], 1e-9), x = P[lo][0] + (P[hi][0] - P[lo][0]) * t, z = P[lo][1] + (P[hi][1] - P[lo][1]) * t;
    return [x, z];
  }
  const smooth01 = v => { v = Math.min(1, Math.max(0, v)); return v * v * (3 - 2 * v); };
  // head position along the den path over a 40 s cycle: rests with the head at the mouth, slides out onto the sand,
  // looks about there, and slides back in
  function denHead(D, t, Lw) {
    const c = ((t + 6) % 40 + 40) % 40, inA = Math.max(D.aMouth + 0.04, Lw + 0.01), outA = D.aMouth + 0.3;
    let k = 0;
    if (c < 10) k = 0; else if (c < 19) k = smooth01((c - 10) / 9); else if (c < 28) k = 1; else if (c < 37) k = 1 - smooth01((c - 28) / 9);
    return inA + (outA - inA) * k + 0.015 * Math.sin(t * 0.7) * (0.3 + k);
  }

  function opahAt(P, t) {
    const a = P.speed_cm_s * cm / (P.rx_cm * cm) * t;       // angular speed so that the pace along the path is about speed_cm_s
    return [P.center[0] * cm + P.rx_cm * cm * Math.cos(a), P.center[1] * cm + P.bob_cm * cm * Math.sin(0.37 * t + 1.1), P.center[2] * cm + P.rz_cm * cm * Math.sin(a)];
  }
  // a rounded-rectangle track (two straights joined by half circles) on the floor; a = distance along it (m), returns x, z and the unit tangent
  function trackAt(P, a) {
    const s = P.half_straight_cm * cm, R = P.radius_cm * cm, per = 4 * s + 2 * Math.PI * R, cx = P.center[0] * cm, cz = P.center[1] * cm;
    a = ((a % per) + per) % per;
    if (a < 2 * s) return [cx - s + a, cz + R, 1, 0];
    if ((a -= 2 * s) < Math.PI * R) { const g = a / R; return [cx + s + R * Math.sin(g), cz + R * Math.cos(g), Math.cos(g), -Math.sin(g)]; }
    if ((a -= Math.PI * R) < 2 * s) return [cx + s - a, cz - R, -1, 0];
    a -= 2 * s; const g = a / R; return [cx - s - R * Math.sin(g), cz - R * Math.cos(g), -Math.cos(g), Math.sin(g)];
  }
  function updateFish(F, t, dt) {
    const u = F.u;
    if (F.sp === 'opah') {
      // cruises slowly round a wide loop in the open water, beating its long pectoral fins up and down like wings
      const P = F.f.path, p = opahAt(P, t), q = opahAt(P, t + 0.1);
      const vx = (q[0] - p[0]) / 0.1, vy = (q[1] - p[1]) / 0.1, vz = (q[2] - p[2]) / 0.1, hs = Math.hypot(vx, vz);
      const yaw = Math.atan2(vz, -vx);
      let dyaw = yaw - (F.yaw ?? yaw); dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
      F.yaw = yaw; F.turn = (F.turn ?? 0) * 0.94 + (dt > 0 ? dyaw / dt : 0) * 0.06;
      F.beat = (F.beat ?? 0) + dt * 4.6;                                   // about 0.73 beats per second, steady
      const lift = Math.sin(F.beat - 0.9);                                  // the body rises a little just after the downstroke
      F.root.position.set(p[0], p[1] + 0.022 * lift, p[2]);
      F.root.rotation.set(-0.5 * F.turn, yaw, 0.05 * Math.sin(F.beat));      // banks into the turn, rocks slightly with the beat
      F.inner.rotation.z = -Math.atan2(vy, hs) * 0.6 + 0.02 * Math.cos(F.beat);
      u.uSwimPhase.value += dt * 2.2; u.uRipplePhase.value += dt * 3;
      u.uSwimAmp.value = SPECIES.opah.amp * (1 + 1.2 * Math.min(Math.abs(F.turn), 0.5));
      // fin angle: raised high, swept down low (up = positive); the tip lags behind the root, the fin flexes through the stroke
      // the approved reference pictures: raised, the fin points up and back about 55° above horizontal; lowered, about 71° below it.
      // The angle of the fin from its root swings between them (the fin keeps its shape; a little lag at the tip).
      const UP = 55, DOWN = -71, restDeg = F.pivRest ?? -32.6;
      const dir = (UP + DOWN) / 2 + (UP - DOWN) / 2 * Math.sin(F.beat);
      const a = (dir - restDeg) * Math.PI / 180;
      if (F.hang) {
        if (!F.hang.fins[0].up) raisedPose(F);
        const phi = Math.PI / 2 * (1 - Math.sin(F.beat));                  // 0 raised … pi lowered (the downstroke follows the upstroke)
        flapPectorals(F, phi, 0.9 * Math.cos(F.beat));
      }
      else for (const pu of F.pecs) { pu.uFlapAngle.value = a; pu.uFlutter.value = 0.05; pu.uFlutterPhase.value = F.beat; }
    } else if (F.den) {
      // the right rock's eel: lives in the cave, slides out over the lip onto the sand in front and back in again.
      // The body follows the den path (12 stations), each part resting on whatever is under it (ledge, cave floor, sand).
      const R = F.parentRock, D = F.den, sc = F.scale, Lw = F.len * sc;
      const a0 = denHead(D, t, Lw), v = (denHead(D, t + 0.2, Lw) - a0) / 0.2;
      R.root.updateMatrixWorld(true);
      const lim = R.ledge.userData.top + 0.09;                    // look for the floor below this height (not the cave roof)
      const pts = ST.map(s_ => {
        const [x, z] = denAt(D, a0 - s_ * Lw), w = R.root.localToWorld(new THREE.Vector3(x, 0, z));
        const yw = heightAt(w.x, w.z, R.root.position.y + lim);
        return [x / sc, (yw - R.root.position.y + F.half * 0.9) / sc, z / sc];
      });
      const dd = 0.7 * Lw / (NST - 1) / sc;                       // the body can't fold over an edge: at most ~35° between stations
      for (let pass = 0; pass < 2; pass++) for (let k = 1; k < NST; k++) { pts[k][1] = Math.max(pts[k][1], pts[k - 1][1] - dd); pts[NST - 1 - k][1] = Math.max(pts[NST - 1 - k][1], pts[NST - k][1] - dd); }
      if (F.prevPts) for (let k = 0; k < NST; k++) pts[k][1] = F.prevPts[k][1] + (pts[k][1] - F.prevPts[k][1]) * Math.min(1, dt * 6);
      F.prevPts = pts; F.dbg = { local: pts.map(p => [p[0] * sc, p[1] * sc, p[2] * sc]) };
      setStations(F, pts);
      u.uSwimPhase.value += dt * (1.8 + 40 * Math.abs(v)); u.uSwimAmp.value = 0.014 + 0.25 * Math.min(Math.abs(v), 0.05);
      const open = 0.5 + 0.5 * Math.sin(t * 1.6 + 2.0);                     // breathing: the mouth opens about every 4 s
      F.jawU.uJaw.value = -0.1 + 0.4 * open * open;
    } else if (F.f.rock) {
      // in the hollow: the body ripples slowly, the head sways, the mouth opens and closes
      const open = 0.5 + 0.5 * Math.sin(t * 1.9 + 0.6);                     // opens and closes every ~3.3 s
      F.jawU.uJaw.value = -0.12 + 0.46 * open * open;
      F.inner.rotation.y = 0.12 * Math.sin(t * 0.37) + 0.05 * Math.sin(t * 1.3);
      u.uSwimPhase.value += dt * 1.6; u.uSwimAmp.value = 0.016 + 0.006 * Math.sin(t * 0.5);
      const x0 = u.uX0.value, L0 = u.uLen.value;                            // straight body, the head end bending side to side
      setStations(F, ST.map(s_ => [x0 + s_ * L0, 0, (1 - s_) * (1 - s_) * 0.03 * Math.sin(t * 0.55 + 1.2)]));
    }
    for (const pu of F.pecs) { pu.uSwimPhase.value = u.uSwimPhase.value; pu.uSwimAmp.value = u.uSwimAmp.value; pu.uRipplePhase.value = u.uRipplePhase.value; }
    F.jawU.uSwimPhase.value = u.uSwimPhase.value; F.jawU.uSwimAmp.value = u.uSwimAmp.value;
  }

  // ---------- water surface (sunlit: sky reflection and a glint) ----------
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
        uTint: { value: new THREE.Color(0x2b8ec4) }, uSky: { value: new THREE.Color(0xa9d4ee) }, uHalf: { value: new THREE.Vector2(W / 2, D / 2) },
      },
      vertexShader: `
        uniform float uTime; uniform mat4 uReflVP; varying vec3 vW; varying vec4 vReflClip; varying vec3 vN;
        float wave(vec2 p, float t){ return 0.0030*sin(p.x*7.+t*0.9) + 0.0018*sin(p.y*11.-t*0.8+p.x*3.) + 0.0008*sin((p.x+p.y)*23.+t*1.5); }
        void main(){
          vec3 p = position; vec4 w = modelMatrix * vec4(p,1.);
          float e = 0.002;
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
            float fres = 0.04 + 0.6 * pow(1. - cosT, 5.);
            col = mix(refr * mix(vec3(1.), uTint * 2., .15), uSky, fres);
          } else {
            vec2 rUV = vReflClip.xy / vReflClip.w * .5 + .5;
            vec3 refl = uUseRT > .5 ? texture2D(uRefl, clamp(rUV + off, 0.001, .999)).rgb : uTint * .8;
            float tir = 1. - smoothstep(0.6, 0.72, cosT);          // total internal reflection past ~48.6 deg
            col = mix(mix(refr, uSky, .35), refl, max(tir, 0.25)) * 0.9;
          }
          vec3 Ld = normalize(vec3(-0.25, 1., 0.45));                // the sun
          float spec = pow(max(dot(reflect(-Ld, vN), V), 0.), 90.);
          col += spec * 0.35;
          vec2 edge = uHalf - abs(vW.xz);                           // meniscus: a fine bright line along the glass
          col += 0.10 * (1. - smoothstep(0.0, 0.007, min(edge.x, edge.y)));
          gl_FragColor = vec4(col, uUseRT > .5 ? 1. : 0.45 + 0.4 * (1. - cosT));
          #include <colorspace_fragment>
        }`,
    });
    surface = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.0006, D - 0.0006, STD ? 160 : 80, STD ? 60 : 30), mat);
    surface.rotation.x = -Math.PI / 2; surface.position.y = WL; surface.renderOrder = 3; scene.add(surface);
    return res;
  }
  let surfRes;

  // ---------- camera & views ----------
  const controls = new THREE.OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.minDistance = 0.15; controls.maxDistance = 12;
  controls.maxPolarAngle = Math.PI * 0.62; controls.target.set(0, 0.95, 0);
  function fitDistance(margin = 1.06) {
    const vFov = THREE.MathUtils.degToRad(camera.fov), hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    return Math.max((W / 2 * margin) / Math.tan(hFov / 2) + D / 2, (H / 2 * margin) / Math.tan(vFov / 2) + D / 2);
  }
  const VIEWS = {
    front: () => [[0, 1.0, fitDistance()], [0, 0.97, 0]],
    oblique: () => { const d = fitDistance(1.12); return [[d * 0.5, 0.9 + d * 0.22, d * 0.82], [0, 0.9, -0.05]]; },
    top: () => [[0, fitDistance(1.15) + WL * 0.4, 0.001], [0, 0, 0]],
  };
  function setView(n) { stopWatching(); const [p, t] = VIEWS[n](); camera.position.set(...p); controls.target.set(...t); controls.update(); }

  // ---------- observe one species: the camera follows it (you can still orbit and zoom around it) ----------
  const INFO = {
    opah: ['アカマンボウ', 'Lampris megalopsis', '全長1 m（実物はさらに大きくなる）。円い体に赤いヒレと白い斑点。長い胸びれを翼のように羽ばたかせて泳ぐ。外洋の中層（水深およそ50〜500 m）にすむ。この水槽では、岩礁のウツボと同居する仮想の展示。'],
    moray: ['ウツボ', 'Gymnothorax kidako', '全長80 cm。日本の沿岸の岩礁にすみ、岩の穴や隙間にひそむ。口を開け閉めして呼吸する。胸びれ・腹びれはなく、背びれと臀びれが尾まで続く。夜に活動する。'],
  };
  let watch = null;                         // {F, dist}
  const watchTmp = new THREE.Vector3();
  function startWatching(sp, which = 0) {
    const list = fishes.filter(F => F.sp === sp); if (!list.length) return;
    const F = list[which % list.length];
    const size = F.f.length_cm * cm, portrait = Math.max(1, 0.8 / camera.aspect);   // a narrow screen needs more distance for the same fish
    const dist = Math.max(0.5, size * 1.7 * portrait);
    F.root.getWorldPosition(watchTmp);
    const dir = new THREE.Vector3(0.25, 0.14, 1).normalize();
    camera.position.copy(watchTmp).addScaledVector(dir, dist); controls.target.copy(watchTmp); controls.update();
    watch = { F, sp, which };
    const [name, sci, text] = INFO[sp];
    $('info-name').textContent = name; $('info-sci').textContent = sci; $('info-text').textContent = text;
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
  $('info-text').addEventListener('click', () => $('info').classList.toggle('open'));   // narrow screens: tap to read the rest
  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));

  function resize() {
    const r = stage.getBoundingClientRect();
    document.documentElement.style.setProperty('--bar-h', $('bar').offsetHeight + 'px');     // the sheet and the info card sit above the (wrapping) button bar
    const size = LIB.aquariumDrawingSize(quality, r.width, r.height, devicePixelRatio);
    renderer.setPixelRatio(size.pixelRatio); renderer.setSize(size.cssWidth, size.cssHeight, false);
    camera.aspect = size.cssWidth / size.cssHeight; camera.fov = camera.aspect < 1 ? 50 : 34; camera.updateProjectionMatrix();
    const dw = size.drawingWidth, dh = size.drawingHeight;
    if (rtRefr) { rtRefr.setSize(dw >> 1, dh >> 1); rtRefl.setSize(dw >> 1, dh >> 1); }
    surfRes?.set(dw, dh);
    if (plankton) plankton.material.uniforms.uScale.value = dh * 0.0012;
  }

  // ---------- editing ----------
  let mode = 'view', selected = null, drag = null;
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
  const ring = new THREE.Mesh(new THREE.RingGeometry(1, 1.06, 64), new THREE.MeshBasicMaterial({ color: 0x8fd0f2, transparent: true, opacity: .9, depthTest: false, fog: false }));
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
    $('stone-color').hidden = e.kind !== 'stone';
    $('pos-x').value = (o.position[0] / cm).toFixed(0); $('pos-z').value = (o.position[2] / cm).toFixed(0);
    $('rot-y').value = Math.round(THREE.MathUtils.radToDeg(o.rotation[1]) % 360);
    document.querySelectorAll('[data-color]').forEach(b => b.setAttribute('aria-pressed', b.dataset.color === o.colorId));
    ring.scale.setScalar(e.radius + 0.02); ring.position.set(e.root.position.x, ground(e.root.position.x, e.root.position.z) + 0.008, e.root.position.z);
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
  const endDrag = ev => { if (!drag) return; if (ev.pointerId === drag.pointerId || ev.pointerId === drag.pointer) { drag = null; controls.enabled = true; save(); } };
  canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);

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
  // keeps the viewpoint away from the glass (and the sand): too near the glass the fish is cut by the near plane and looks see-through
  const CAM_MARGIN = 0.2;
  function keepCameraOffGlass() {
    const p = camera.position, tg = controls.target, gx = W / 2 + 4.0, gz = D / 2 + 4.0;     // outside the tank the view is free
    const inside = Math.abs(p.x) < gx && Math.abs(p.z) < gz && p.y < H + 3;
    if (!inside) return;
    const lim = (v, h) => Math.max(-h + CAM_MARGIN, Math.min(h - CAM_MARGIN, v));
    if (Math.abs(p.x) < W / 2 && Math.abs(p.z) < D / 2) {          // inside the water volume: stay 20 cm from every glass pane
      const x = lim(p.x, W / 2), z = lim(p.z, D / 2);
      if (x !== p.x || z !== p.z) { tg.x += x - p.x; tg.z += z - p.z; p.x = x; p.z = z; }
    }
  }
  function frame(dt) {
    step(dt);
    followWatched();
    controls.update();
    keepCameraOffGlass();
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
    setView, fishes, editables, heightAt, cameraZ: () => camera.position.z, raycaster: () => new THREE.Raycaster(),
    pause(on) { paused = on; },
    cam(p, tgt) { camera.position.set(...p); controls.target.set(...tgt); controls.update(); },
    watch: startWatching,
    advance(sec) { for (let k = 0; k < Math.round(sec * 30); k++) step(1 / 30); followWatched(); controls.update(); keepCameraOffGlass(); if (STD && surface) renderWaterPasses(); renderer.render(scene, camera); },
  };

  // ---------- start ----------
  (async () => {
    try {
      say('水槽を準備しています…');
      const [blueT, redT, kelpT] = await Promise.all([tex(A.textures['rock-blue'], { repeat: [1, 1], mirror: true }), tex(A.textures['rock-red'], { repeat: [1, 1], mirror: true }), tex(A.textures.kelp)]);
      stoneMats = { blue: stoneMaterial(blueT), red: stoneMaterial(redT) };
      kelpMap = kelpT;
      await buildTank();
      for (const o of L.objects) if (o.kind === 'stone') makeRock(o);
      for (const o of L.objects) if (o.kind === 'plant') makePlant(o);
      const sel = $('obj-select');
      for (const o of approved) sel.append(new Option(editables.get(o.id).label, o.id));
      if (loadSaved()) flash('前回の配置を読み込みました');
      applyState();
      surfRes = buildWater();
      resize(); setView('front');
      addEventListener('resize', resize);
      say('魚たちを呼んでいます…');
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
