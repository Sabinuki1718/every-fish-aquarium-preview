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
    renderer = new THREE.WebGLRenderer({ canvas, antialias: quality.antialias, powerPreference: 'high-performance' });
  } catch (e) {
    say('この端末・ブラウザでは3D表示（WebGL）を開始できませんでした。別のブラウザで開くか、ほかのアプリを閉じてから再読み込みしてください。', true);
    return;
  }
  canvas.addEventListener('webglcontextlost', e => {
    e.preventDefault(); say('画面の描画が中断されました（メモリー不足など）。再読み込みしてください。軽量表示にすると安定することがあります。', true);
  });
  const ROOM = 0x11161b, WATER = 0x1d3a47;
  renderer.setClearColor(ROOM, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  if (STD) { renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; }
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 10);
  scene.add(new THREE.HemisphereLight(0xd8ecff, 0x3a3328, 1.15));
  const sun = new THREE.DirectionalLight(0xfffbf2, 2.4);       // aquarium LED above the water
  sun.position.set(0.05, 0.9, 0.12); sun.target.position.set(0, 0, 0); scene.add(sun, sun.target);
  if (STD) {
    sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); sun.shadow.radius = 5; sun.shadow.bias = -0.0008;
    Object.assign(sun.shadow.camera, { left: -0.34, right: 0.34, top: 0.2, bottom: -0.2, near: 0.3, far: 1.2 });
  }

  // ---------- tank ----------
  const L = A.layout, cm = 0.01;
  const W = L.tank.w * cm, D = L.tank.d * cm, H = L.tank.h * cm, WL = L.tank.water * cm;
  const ground = (x, z) => { const t = (D / 2 - z) / D; return 0.03 + 0.03 * t * t; };

  const uniformsCommon = { uTime: { value: 0 }, uCaustic: { value: STD ? 0.55 : 0.35 } };
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
      float c = 0.;
      c += sin(p.x*61. + t*0.9 + sin(p.y*47. - t*0.7)*1.7);
      c += sin(p.y*69. - t*0.8 + sin(p.x*53. + t*0.6)*1.5);
      c += 0.6*sin((p.x+p.y)*83. + t*1.1);
      c = 1. - abs(c*0.42);
      return pow(clamp(c,0.,1.), 7.);
    }
`;
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
  const plantMats = [];
  function plantMaterial(color, key) {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide, color });
    m.onBeforeCompile = sh => {
      injectCaustics(sh, '#include <color_fragment>');
      sh.vertexShader = 'attribute float aSway; uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 wp0 = modelMatrix * vec4(position, 1.);
        float k = aSway * aSway;
        transformed.x += k * 0.010 * sin(uTime * 0.75 + wp0.x * 23. + wp0.z * 17.);
        transformed.z += k * 0.006 * sin(uTime * 0.55 + wp0.x * 11. + 1.3);`);
    };
    m.customProgramCacheKey = () => 'plant-' + key;
    plantMats.push(m); return m;
  }
  function geometryFrom(pos, col, sway, idx) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(sway, 1));
    g.setIndex(idx); g.computeVertexNormals(); return g;
  }
  function vallisneria(o) {
    const rnd = seeded(o.id), pos = [], col = [], sway = [], idx = [], c = new THREE.Color();
    for (let b = 0; b < o.count; b++) {
      const h = o.height * cm * (0.6 + rnd() * 0.42), w = 0.0075 + rnd() * 0.003;
      const bx = (rnd() - 0.5) * 0.07, bz = (rnd() - 0.5) * 0.05, rot = rnd() * Math.PI * 2;
      const bend = (rnd() - 0.35) * 0.07, twist = rnd() * 2, segs = 22;
      c.setHSL(0.25 + rnd() * 0.05, 0.5 + rnd() * 0.15, 0.24 + rnd() * 0.1);
      const cr = Math.cos(rot), sr = Math.sin(rot), base = pos.length / 3;
      for (let s = 0; s <= segs; s++) {
        const t = s / segs, y = t * h - 0.012;
        const ww = w * (t < 0.92 ? 1 : (1 - t) / 0.08 * 0.9 + 0.1) * (0.85 + 0.15 * Math.sin(t * 9));
        const off = bend * t * t, tw = Math.sin(t * 3 + twist) * 1.1;
        for (const side of [-0.5, 0.5]) {
          const lx = side * ww * Math.cos(tw) + off, lz = side * ww * Math.sin(tw) + 0.012 * Math.sin(t * 2.5 + twist);
          pos.push(bx + lx * cr - lz * sr, y, bz + lx * sr + lz * cr);
          const sh = 0.75 + 0.35 * t; col.push(c.r * sh, c.g * sh, c.b * sh); sway.push(t);
        }
        if (s < segs) { const a = base + s * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      }
    }
    return geometryFrom(pos, col, sway, idx);
  }
  // Cabomba: upright stems with opposite pairs of fan-shaped, finely divided leaves at each node.
  function cabomba(o) {
    const rnd = seeded(o.id), pos = [], col = [], sway = [], idx = [], c = new THREE.Color();
    const quad = (a, b, w, nrm, t0, t1, color) => {   // thin strip from a to b, width w, facing roughly nrm
      const d = new THREE.Vector3().subVectors(b, a), side = new THREE.Vector3().crossVectors(d, nrm).normalize().multiplyScalar(w / 2);
      const i = pos.length / 3;
      for (const [p, t] of [[a.clone().sub(side), t0], [a.clone().add(side), t0], [b.clone().sub(side), t1], [b.clone().add(side), t1]]) { pos.push(p.x, p.y, p.z); col.push(color.r, color.g, color.b); sway.push(t); }
      idx.push(i, i + 2, i + 1, i + 1, i + 2, i + 3);
    };
    const up = new THREE.Vector3(0, 1, 0);
    for (let s = 0; s < o.count; s++) {
      const h = o.height * cm * (0.7 + rnd() * 0.35), x0 = (rnd() - 0.5) * 0.055, z0 = (rnd() - 0.5) * 0.035;
      const lean = new THREE.Vector3((rnd() - 0.5) * 0.12, 1, (rnd() - 0.5) * 0.12).normalize();
      const stemC = new THREE.Color().setHSL(0.27, 0.45, 0.28);
      const nodeGap = 0.0095 + rnd() * 0.002, nodes = Math.floor(h / nodeGap);
      let rot = rnd() * Math.PI;
      for (let n = 0; n < nodes; n++) {
        const y0 = n * nodeGap, a = new THREE.Vector3(x0, -0.01, z0).addScaledVector(lean, y0 + 0.01), b = new THREE.Vector3(x0, -0.01, z0).addScaledVector(lean, y0 + 0.01 + nodeGap);
        const ta = (y0 + 0.01) / (h + 0.01), tb = (y0 + 0.01 + nodeGap) / (h + 0.01);
        quad(a, b, 0.0013, new THREE.Vector3(0, 0, 1), ta, tb, stemC);
        if (y0 < 0.012) continue;                     // lower stem bare (old leaves lost)
        const tip = (h - y0) / h, size = 0.011 + 0.008 * Math.sin(Math.min(1, (y0 / h) * 1.3) * Math.PI) * (tip < 0.12 ? tip / 0.12 : 1);
        c.setHSL(0.24 + rnd() * 0.04, 0.55, 0.32 + 0.1 * (y0 / h));
        rot += Math.PI / 2;
        for (const sgn of [1, -1]) {                  // opposite leaves
          const ang = rot + (sgn > 0 ? 0 : Math.PI);
          const dir = new THREE.Vector3(Math.cos(ang), 0.35 + 0.25 * (y0 / h), Math.sin(ang)).normalize();
          const nrm = new THREE.Vector3().crossVectors(dir, up).normalize().cross(dir);
          const petiole = a.clone().addScaledVector(dir, size * 0.22);
          quad(a, petiole, 0.0008, nrm, ta, ta + 0.01, c);
          for (let f = -3; f <= 3; f++) {               // fan of forked segments
            const fa = ang + f * 0.22, fd = new THREE.Vector3(Math.cos(fa), dir.y + 0.04 * Math.abs(f), Math.sin(fa)).normalize();
            const mid = petiole.clone().addScaledVector(fd, size * 0.42 * (1 - 0.07 * Math.abs(f)));
            quad(petiole, mid, 0.0007, nrm, ta + 0.01, ta + 0.02, c);
            for (const fk of [-0.16, 0.16]) {
              const fd2 = new THREE.Vector3(Math.cos(fa + fk), fd.y + 0.05, Math.sin(fa + fk)).normalize();
              quad(mid, mid.clone().addScaledVector(fd2, size * 0.38), 0.0006, nrm, ta + 0.02, ta + 0.03, c);
            }
          }
        }
      }
    }
    return geometryFrom(pos, col, sway, idx);
  }
  function makePlant(o) {
    const isVal = o.species.startsWith('バリス');
    const geo = isVal ? vallisneria(o) : cabomba(o);
    const mat = isVal ? (makePlant.val ??= plantMaterial(0xffffff, 'val')) : (makePlant.cab ??= plantMaterial(0xffffff, 'cab'));
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
    'fish-azumanishiki': ['東錦（あずまにしき）', 'Carassius auratus（金魚の改良品種）',
      'キャリコ柄（浅葱・黒・赤・白とモザイク透明鱗）のオランダ獅子頭。頭の肉瘤、背鰭、長い四つ尾をもつ。この個体は赤みが少なく、青地に大小の黒斑が散り、鰭には鰭条に沿う黒い筋が入る。全長12 cm（仮の大きさ）。'],
    'fish-seibun': ['青文魚（せいぶんぎょ）', 'Carassius auratus（金魚の改良品種）',
      '青灰色のオランダ獅子頭。体も肉瘤も鉄色がかった青で、腹はやや淡い。背鰭と長い四つ尾をもつ。全長12 cm（仮の大きさ）。'],
    'fish-kigashira': ['黄頭の青白オランダ', 'Carassius auratus（金魚の改良品種）',
      '山吹色の肉瘤に、背が青灰・腹が白い体のオランダ獅子頭。この配色を指す決まった品種名は確認できなかったため、色柄で呼んでいる。鰭は白く透ける。全長12 cm（仮の大きさ）。'],
  };
  const fishes = [];
  const FISH_VERT = `
    attribute float aFin; attribute float aRoot; attribute float aKind;
    uniform float uSwimPhase; uniform float uSwimAmp; uniform float uFinPhase; uniform float uFinAmp; uniform float uBreath; uniform float uPecOpen;
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
    } else if (aKind > 2.5 && aKind < 3.5) {                        // pectoral: open and close, paddling
      float a = uPecOpen * sin(uFinPhase * 0.85 + side);
      transformed.z += side * fw * aRoot * a;
      transformed.y += fw * aRoot * 0.4 * a;
    } else if (aKind > 3.5) {                                       // pelvic: gentle open/close
      transformed.z += side * fw * aRoot * 0.18 * sin(uFinPhase * 0.6 + 0.8);
    }
    // breathing: gill covers flare and the mouth pumps
    float gill = smoothstep(-0.05, -0.043, transformed.x) * (1. - smoothstep(-0.034, -0.026, transformed.x)) * smoothstep(0.008, 0.016, abs(transformed.z)) * (1. - aFin);
    transformed.z += side * gill * 0.0011 * (0.5 + 0.5 * uBreath);
    float mouth = smoothstep(-0.052, -0.059, transformed.x);
    transformed.yz *= 1. + mouth * 0.07 * uBreath;
    // body undulation, stronger toward the tail
    float bend = uSwimAmp * pow(smoothstep(0.25, 1., s), 1.4);
    transformed.z += bend * sin(uSwimPhase - s * 4.6);`;
  function fishMaterial(kind, map, u) {
    const m = kind === 'fin'
      ? new THREE.MeshStandardMaterial({ map, transparent: true, depthWrite: false, side: THREE.DoubleSide, roughness: 0.45 })
      : (STD ? new THREE.MeshPhysicalMaterial({ map, roughness: 0.38, clearcoat: 0.35, clearcoatRoughness: 0.35, side: THREE.FrontSide })
             : new THREE.MeshStandardMaterial({ map, roughness: 0.42, side: THREE.FrontSide }));
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = FISH_VERT + sh.vertexShader.replace('#include <begin_vertex>', FISH_BEGIN);
      sh.fragmentShader = 'varying float vFin; varying float vRoot;\n' + sh.fragmentShader;
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
    const mk = index => { const g = new THREE.BufferGeometry(); for (const [k, v] of Object.entries(attrs)) g.setAttribute(k, v); g.setIndex(index); g.computeBoundingSphere(); return g; };
    fishGeo = { body: mk(d.iBody), fin: mk(d.iFin) };
  }
  // Calm loops in front of the stones at each fish's swimming height; speed breathes so the fish drift and pause.
  const PATHS = {                     // separate depth bands (8 cm apart) so the three never meet
    'fish-azumanishiki': { c: [-0.02, 0.18, 0.045], a: [0.165, 0.012, 0.035], w: 0.2, ph: 0.4 },
    'fish-seibun': { c: [0.03, 0.105, 0.055], a: [0.15, 0.01, 0.03], w: -0.17, ph: 2.6 },
    'fish-kigashira': { c: [0.0, 0.258, 0.03], a: [0.17, 0.012, 0.036], w: 0.15, ph: 4.4 },
  };
  const pathAt = (P, t) => {
    const u = P.w * t + P.ph + 0.5 * Math.sin(0.11 * t + P.ph);
    const du = P.w + 0.5 * 0.11 * Math.cos(0.11 * t + P.ph);
    return {
      p: [P.c[0] + P.a[0] * Math.sin(u), P.c[1] + P.a[1] * Math.sin(0.5 * u + 1.1), P.c[2] + P.a[2] * Math.cos(u)],
      v: [P.a[0] * Math.cos(u) * du, P.a[1] * 0.5 * Math.cos(0.5 * u + 1.1) * du, -P.a[2] * Math.sin(u) * du],
    };
  };
  async function loadFish(f, i) {
    const M = A.models[f.id];
    const map = await tex(M[quality.name === 'light' ? 'light' : 'standard']);
    map.flipY = false;                         // glTF-style UVs (v = 0 at the top of the atlas)
    const u = { uSwimPhase: { value: i * 2.1 }, uSwimAmp: { value: 0.005 }, uFinPhase: { value: i * 1.3 }, uFinAmp: { value: 0.35 }, uBreath: { value: 0 }, uPecOpen: { value: 0.3 } };
    const body = new THREE.Mesh(fishGeo.body, fishMaterial('body', map, u));
    const fin = new THREE.Mesh(fishGeo.fin, fishMaterial('fin', map, u)); fin.renderOrder = 2;
    for (const m of [body, fin]) { m.frustumCulled = false; m.castShadow = STD; m.userData.fishId = f.id; }
    const root = new THREE.Group(); root.add(body, fin); root.scale.setScalar(f.length_cm / 12); root.rotation.order = 'YZX';
    root.userData.fishId = f.id; scene.add(root);
    fishes.push({ id: f.id, root, u, path: PATHS[f.id] || { c: [0, 0.18, 0.04], a: [0.14, 0.01, 0.03], w: 0.18, ph: i }, t: i * 7.3, paused: false });
  }
  function updateFish(F, dt) {
    if (!F.paused) F.t += dt;
    const { p, v } = pathAt(F.path, F.t), hs = Math.hypot(v[0], v[2]);
    F.root.position.set(...p);
    const yaw = Math.atan2(v[2], -v[0]);
    let dyaw = yaw - (F.yaw ?? yaw); dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    F.yaw = yaw; F.turn = (F.turn ?? 0) * 0.92 + (dt > 0 && !F.paused ? dyaw / dt : 0) * 0.08;
    F.root.rotation.set(-0.35 * F.turn * 0.25, yaw, -Math.atan2(v[1], hs) * 0.8);
    const speed = F.paused ? 0 : Math.hypot(...v);
    F.u.uSwimPhase.value += dt * (F.paused ? 1.2 : 5.5 + 55 * speed + 4 * Math.abs(F.turn));
    F.u.uSwimAmp.value = F.paused ? 0.0012 : 0.0035 + 0.011 * Math.min(Math.abs(F.turn), 0.4) + 0.03 * speed;
    F.u.uFinPhase.value += dt * (F.paused ? 1.6 : 3.2 + 30 * speed);
    F.u.uFinAmp.value = F.paused ? 0.1 : 0.16 + 1.2 * speed;
    F.u.uPecOpen.value = F.paused ? 0.32 : 0.2 + 0.3 * Math.min(Math.abs(F.turn), 0.5);
    F.u.uBreath.value = Math.sin(performance.now() * 0.0042 + F.path.ph);
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
        uTint: { value: new THREE.Color(0x7fa9b4) }, uSky: { value: new THREE.Color(0x2a3138) }, uHalf: { value: new THREE.Vector2(W / 2, D / 2) },
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
            col = mix(refr * 0.85 + uTint * 0.15, max(refl, uTint * 0.55), max(tir, 0.3) * 0.8);
          }
          vec3 L = normalize(vec3(0.05, 1., 0.12));
          float spec = pow(max(dot(reflect(-L, vN), V), 0.), 120.);
          col += spec * 0.6;
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
    const s = LIB.watchStart([watchNow.x, watchNow.y, watchNow.z], F.yaw ?? 0, { aspect: camera.aspect, distance: watchDistance() });
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
