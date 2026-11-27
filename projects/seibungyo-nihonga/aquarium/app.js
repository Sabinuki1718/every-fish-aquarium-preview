/* 絵巻の青文魚 — aquarium runtime (classic script; needs window.THREE, window.createNihonga, window.AquariumLib).
   Everything is drawn by the user's nihonga shader (aquarium/lib/nihonga-shader.js): sumi outlines from the 3D
   silhouettes, mineral-pigment colour, washi paper. Units: metres in the scene, layout.json in centimetres
   (origin = centre of the tank floor, x right, y up, z toward the viewer). */
(async () => {
const A = window.AQUARIUM_ASSETS, L = A.layout, CM = .01, Lib = window.AquariumLib, T = THREE;
const $ = id => document.getElementById(id);
const canvas = $('view'), statusEl = $('status');
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
function fail(msg) { statusEl.hidden = false; statusEl.querySelector('p').textContent = msg; const b = statusEl.querySelector('button'); b.hidden = false; b.onclick = () => location.reload(); }

// ---------- quality ----------
const QKEY = 'seibungyo-nihonga:quality';
const requested = new URLSearchParams(location.search).get('quality') || store.get(QKEY) || 'auto';
const quality = Lib.chooseAquariumQuality({ userAgent: navigator.userAgent, userAgentMobile: navigator.userAgentData?.mobile,
  maxTouchPoints: navigator.maxTouchPoints, coarsePointer: matchMedia('(pointer:coarse)').matches, requestedQuality: requested });
$('quality').value = ['standard', 'light'].includes(requested) ? requested : 'auto';
$('quality').addEventListener('change', e => { store.set(QKEY, e.target.value); const u = new URL(location.href); u.searchParams.delete('quality'); location.replace(u); });

let renderer;
try { renderer = new T.WebGLRenderer({ canvas, antialias: quality.antialias }); if (!renderer.capabilities.isWebGL2) throw new Error('WebGL2'); }
catch (e) { fail('この端末では3D表示（WebGL2）を開始できませんでした。別のブラウザか、画質「軽量」でお試しください。'); return; }
canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); fail('表示の処理が途切れました。再読み込みしてください。'); });
renderer.setClearColor(0x000000, 0);                 // the shader finds the paper by alpha 0
const fitSize = () => { const s = Lib.aquariumDrawingSize(quality, canvas.clientWidth, canvas.clientHeight, devicePixelRatio);
  renderer.setPixelRatio(s.pixelRatio); renderer.setSize(s.cssWidth, s.cssHeight, false); };
fitSize();
const scene = new T.Scene(), camera = new T.PerspectiveCamera(30, 1, .01, 10);
const nihonga = createNihonga(T, renderer, { lineWidth: 11, occlusionEps: .002, maxStrokeVertices: 400000 });   // bold sumi lines (user's reference)
const controls = new T.OrbitControls(camera, canvas);
controls.enableDamping = true; controls.minDistance = .18; controls.maxDistance = 2.6; controls.maxPolarAngle = Math.PI * .62;
const TANK = L.tank, TW = TANK.width * CM, TD = TANK.depth * CM;

// ---------- views ----------
const VIEWS = { front: { dir: [0, .12, 1], target: [0, .18, 0] }, oblique: { dir: [-.48, .36, .8], target: [0, .17, 0] }, top: { dir: [0, 1, .001], target: [0, .05, 0] } };
function fitDistance(dirName) {
  const vf = camera.fov * Math.PI / 180, hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect);
  const w = .66, h = dirName === "top" ? .36 : .44;
  return Math.max((w / 2) / Math.tan(hf / 2), (h / 2) / Math.tan(vf / 2)) * (camera.aspect < 1 ? 1.04 : 1.32);
}
function setView(name) {
  const v = VIEWS[name], d = new T.Vector3(...v.dir).normalize().multiplyScalar(fitDistance(name));
  controls.target.set(...v.target); camera.position.copy(controls.target).add(d); controls.update();
}
function resize() { fitSize(); camera.aspect = canvas.clientWidth / canvas.clientHeight; camera.fov = camera.aspect < 1 ? 44 : 30; camera.updateProjectionMatrix(); nihonga.setSize(); }
addEventListener('resize', resize); resize();

// ---------- helpers ----------
const seeded = s => () => (s = (s * 16807) % 2147483647) / 2147483647;
const loadImage = src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error(src)); i.src = src; });
const canvasTex = c => { const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4; return t; };
function weld(geo) {                                   // index a non-indexed geometry by position (the shader needs an index)
  if (geo.index) return geo;
  const P = geo.attributes.position, map = new Map(), pos = [], idx = [];
  for (let i = 0; i < P.count; i++) { const k = P.getX(i).toFixed(7) + ',' + P.getY(i).toFixed(7) + ',' + P.getZ(i).toFixed(7);
    let j = map.get(k); if (j === undefined) { j = pos.length / 3; map.set(k, j); pos.push(P.getX(i), P.getY(i), P.getZ(i)); } idx.push(j); }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx); return g;
}
function solid(geo, mat) { geo = weld(geo); geo.computeVertexNormals(); return new T.Mesh(geo, mat); }

// ---------- fish (added to the shader first so its strokes always fit) ----------
const fishes = [];
async function loadFish(f, i) {
  const m = A.models[f.id], data = await (await fetch(m.geometry)).json();
  const map = await new T.TextureLoader().loadAsync(quality.name === 'light' ? m.light : m.standard);
  map.flipY = false; map.colorSpace = T.SRGBColorSpace;
  const root = new T.Group(), body = new T.Group(); root.add(body); root.userData.fishId = f.id;
  const animated = [];
  for (const part of data.meshes) {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(part.p, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(part.n, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(part.uv, 2)); g.setIndex(part.i); g.computeBoundingSphere(); g.boundingSphere.radius *= 1.4;
    const mesh = new T.Mesh(g, new T.MeshBasicMaterial({ map, side: T.DoubleSide })); mesh.name = part.name; mesh.userData.fishId = f.id;
    if (part.noweld) { const k = new Uint8Array(part.p.length / 3); for (const v of part.noweld) k[v] = 1; mesh.userData.nihongaNoWeld = k; }
    if (part.contour) { const k = new Uint8Array(part.i.length / 3); for (const c of part.contour) k[c] = 1; mesh.userData.nihongaContourFaces = k; }
    mesh.userData.nihongaDynamic = true;                // every part bends with the body
    animated.push({ mesh, base: Float32Array.from(part.p), d: part.targets ? part.targets.map(t => Float32Array.from(t.d)) : [], dv: part.driver });
    body.add(mesh);
  }
  const s = (f.total_length_cm * CM) / .15; root.scale.setScalar(s);              // model is 15 cm long
  scene.add(root); nihonga.add(root);
  const rnd = seeded(97 + i * 31);
  fishes.push({ id: f.id, info: f, root, body, animated, t: rnd() * 40, finT: rnd() * 5, stopped: false,
    path: { ...(f.path || { cx: 0, cy: 19, cz: 3, ax: 19, ay: 4.5, az: 4 }), w: [2 * Math.PI / 41, 2 * Math.PI / 23, 2 * Math.PI / 29].map(w => w * (.9 + .2 * rnd())), ph: [rnd() * 6, rnd() * 6, rnd() * 6] },
    yaw: 0, pitch: 0, roll: 0, swim: rnd() * 6, seed: rnd() * 10, prev: new T.Vector3() });
}
function driverWeights(dv, t) {
  const ph = 2 * Math.PI * dv.cycles * t / dv.duration + dv.phase;
  if (dv.kind === 'paku') { let p = ((dv.cycles * t / dv.duration + dv.phase / (2 * Math.PI)) % 1 + 1) % 1, q;
    if (p < .16) { q = p / .16; return [1 - (1 - q) * (1 - q)]; } if (p < .30) return [1]; if (p < .42) { q = (p - .30) / .12; return [1 - q * q]; } return [0]; }
  if (dv.kind === 'wave') { const m = 1 + dv.whim * Math.sin(2 * Math.PI * t / dv.duration + dv.whim_phase); return [Math.sin(ph) * m, Math.cos(ph) * m]; }
  return [.5 - .5 * Math.cos(ph)];
}
function pathAt(f, t) { const p = f.path;
  return new T.Vector3((p.cx + p.ax * Math.sin(p.w[0] * t + p.ph[0])) * CM, (p.cy + p.ay * Math.sin(p.w[1] * t + p.ph[1])) * CM, (p.cz + p.az * Math.sin(p.w[2] * t + p.ph[2])) * CM); }
// Goldfish swimming: slow, unhurried glides with soft pushes, short hovers where only the fins work,
// a gentle bob, rolling into turns, and a travelling body wave that grows toward the tail.
function paceAt(f, t) {          // 0.12 (hover) .. 1 (push): smooth pseudo-random pace
  const s = f.seed;
  return Math.max(.12, Math.min(1, .55 + .3 * Math.sin(.21 * t + s) + .2 * Math.sin(.53 * t + 2 * s) - .18 * Math.max(0, Math.sin(.09 * t + 3 * s)) * 2));
}
function updateFish(f, dt) {
  const pace = f.stopped ? 0 : paceAt(f, f.clock = (f.clock || 0) + dt);
  f.t += dt * pace * .75;
  const pos = pathAt(f, f.t), ahead = pathAt(f, f.t + .6), v = ahead.clone().sub(pos), speed = pace;
  pos.y += .0035 * Math.sin(.9 * f.clock + f.seed) + .0015 * Math.sin(2.3 * f.clock);          // drifting bob
  const yaw = Math.atan2(v.z, -v.x), pitch = -Math.asin(Math.max(-.5, Math.min(.5, v.y / (v.length() || 1)))) * .5;
  let dy = yaw - f.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  const turn = dy * Math.min(1, dt * 1.6); f.yaw += turn; f.pitch += (pitch - f.pitch) * Math.min(1, dt * 1.5);
  f.roll += (Math.max(-.25, Math.min(.25, -turn / Math.max(dt, 1e-3) * .35)) - f.roll) * Math.min(1, dt * 2);
  // fins: quicker when pushing or turning, a lazy flutter when hovering
  f.finT += dt * (.55 + .7 * speed + Math.min(.5, Math.abs(turn / Math.max(dt, 1e-3)) * .8));
  // body wave: tail-beat ~0.7 Hz when hovering to ~1.6 Hz when pushing; amplitude grows with pace
  f.swim += dt * 2 * Math.PI * (.7 + .9 * speed);
  const amp = .045 + .07 * speed;
  f.base = pos; f.root.position.copy(pos).add(f.avoid || (f.avoid = new T.Vector3()));
  f.root.rotation.set(0, f.yaw, 0, 'YZX'); f.body.rotation.set(f.roll, 0, f.pitch, 'YZX');
  for (const a of f.animated) {
    const p = a.mesh.geometry.attributes.position, arr = p.array;
    arr.set(a.base);
    if (a.d.length) { const w = driverWeights(a.dv, f.finT % a.dv.duration);
      for (let k = 0; k < a.d.length; k++) { const wk = w[k], dk = a.d[k]; for (let i = 0; i < arr.length; i++) arr[i] += wk * dk[i]; } }
    // lateral bend (model: head at -x, length .15 m): z += A(x) sin(phase - k x), A grows ~quadratically to the tail
    for (let i = 0; i < arr.length; i += 3) {
      const u = Math.min(1, Math.max(0, (arr[i] + .075) / .15)), w = u * u * .15;
      arr[i + 2] += amp * w * Math.sin(f.swim - 5.2 * u) - .012 * Math.sin(f.swim) * (1 - u) * .15;
    }
    p.needsUpdate = true;
  }
}

// keep the fish apart: each fish carries a smooth avoidance offset that grows when another fish comes within
// about one body length and relaxes back to its own path when clear; offsets stay inside the water.
function separateFish(dt) {
  const tgt = fishes.map(() => new T.Vector3());
  for (let i = 0; i < fishes.length; i++) for (let j = i + 1; j < fishes.length; j++) {
    const a = fishes[i], b = fishes[j];
    const pa = a.base.clone().add(a.avoid), pb = b.base.clone().add(b.avoid), d = pa.clone().sub(pb);
    const D = .5 * (a.info.total_length_cm + b.info.total_length_cm) * CM + .025, L = d.length();
    if (L < D) { if (L < 1e-4) d.set(0, 1, 0); else d.divideScalar(L);
      const push = d.multiplyScalar((D - L) * .9); tgt[i].add(push); tgt[j].sub(push); }
  }
  fishes.forEach((f, i) => {
    const goal = f.avoid.clone().add(tgt[i]).multiplyScalar(tgt[i].lengthSq() ? 1 : Math.max(0, 1 - dt * .35));
    f.avoid.lerp(goal, Math.min(1, dt * 2.5));
    const p = f.base.clone().add(f.avoid), hx = TW / 2 - .07, hz = TD / 2 - .05;
    p.x = Math.max(-hx, Math.min(hx, p.x)); p.y = Math.max(.07, Math.min(TANK.water_level * CM - .05, p.y)); p.z = Math.max(-hz, Math.min(hz, p.z));
    f.avoid.copy(p).sub(f.base); f.root.position.copy(p);
  });
}

// ---------- materials ----------
async function stoneTexture(colorId) {
  const src = A.textures['stone-' + colorId];
  if (src) { const t = new T.TextureLoader(); const tex = await t.loadAsync(src); tex.colorSpace = T.SRGBColorSpace; tex.wrapS = tex.wrapT = T.RepeatWrapping; return tex; }
  const c = document.createElement('canvas'); c.width = c.height = 512; const x = c.getContext('2d'), base = L.stone_colors[colorId].hex, r = seeded(colorId === 'ai' ? 5 : 9);
  x.fillStyle = base; x.fillRect(0, 0, 512, 512);
  for (let k = 0; k < 900; k++) { x.globalAlpha = .08 + .12 * r(); x.fillStyle = r() < .5 ? '#2c3138' : '#a7a49a'; const s = 2 + 26 * r() * r(); x.beginPath(); x.ellipse(512 * r(), 512 * r(), s, s * .6, r() * 3, 0, 7); x.fill(); }
  x.globalAlpha = .5; x.strokeStyle = '#2a2e34'; x.lineWidth = 1.5;
  for (let k = 0; k < 14; k++) { x.beginPath(); let px = 512 * r(), py = 512 * r(); x.moveTo(px, py); for (let j = 0; j < 6; j++) { px += (r() - .5) * 80; py += 20 + r() * 40; x.lineTo(px, py); } x.stroke(); }
  const tex = canvasTex(c); tex.wrapS = tex.wrapT = T.RepeatWrapping; return tex;
}
const stoneTex = { ai: await stoneTexture('ai'), midori: await stoneTexture('midori') };
const sandImg = A.textures.sand ? await loadImage(A.textures.sand).catch(() => null) : null;
if (A.textures.washi) { const w = await new T.TextureLoader().loadAsync(A.textures.washi).catch(() => null); if (w) nihonga.setPaper(w, 640); }   // the user's washi as the ground behind everything

// ---------- raked sand: base texture + ripples drawn around the stones' current positions ----------
const sandCanvas = document.createElement('canvas'); sandCanvas.width = 2048; sandCanvas.height = 1024;
const sandTex = canvasTex(sandCanvas);
const sand = new T.Mesh(new T.BoxGeometry(TW, .014, TD), new T.MeshBasicMaterial({ map: sandTex }));
sand.position.y = -.007;
sand.userData.nihongaContourFaces = new Uint8Array(sand.geometry.index.count / 3);   // the slab needs no ink (its box normals put a false line across the top)
function drawSand() {
  const g = sandCanvas.getContext('2d'), W = 2048, H = 1024, px = x => (x / TANK.width + .5) * W, pz = z => (z / TANK.depth + .5) * H, sc = W / TANK.width;
  if (sandImg) { const pat = g.createPattern(sandImg, 'repeat'); g.save(); g.scale(.5, .5); g.fillStyle = pat; g.fillRect(0, 0, W * 2, H * 2); g.restore(); }
  else { g.fillStyle = L.substrate.color; g.fillRect(0, 0, W, H); const r = seeded(3);
    for (let k = 0; k < 9000; k++) { g.globalAlpha = .25; g.fillStyle = r() < .6 ? '#b9b2a2' : '#f6f3ea'; g.fillRect(W * r(), H * r(), 2, 2); } g.globalAlpha = 1; }
  const rings = stones.map(s => ({ x: s.root.position.x / CM, z: s.root.position.z / CM, r: Math.max(s.def.size[0], s.def.size[2]) / 2 + 1.6 }));
  g.strokeStyle = 'rgba(112,104,90,.55)'; g.lineWidth = 3;
  const inside = (x, z) => rings.some(o => Math.hypot(x - o.x, z - o.z) < o.r + 5);
  for (let z = -TANK.depth / 2 + .7; z < TANK.depth / 2; z += 1.1) { g.beginPath(); let on = false;
    for (let x = -TANK.width / 2; x <= TANK.width / 2; x += .2) {
      if (inside(x, z)) { if (on) { g.stroke(); g.beginPath(); on = false; } continue; }
      if (!on) { g.moveTo(px(x), pz(z)); on = true; } else g.lineTo(px(x), pz(z)); }
    if (on) g.stroke(); }
  for (const o of rings) for (let r = o.r; r < o.r + 5.1; r += 1.1) {
    g.beginPath(); for (let a = 0; a <= 64; a++) { const t = a / 64 * Math.PI * 2, x = o.x + Math.cos(t) * r, z = o.z + Math.sin(t) * r;
      const own = rings.every(q => q === o || Math.hypot(x - q.x, z - q.z) > Math.hypot(x - o.x, z - o.z));   // overlapping ripples: nearest stone wins
      if (own) (a === 0 ? g.moveTo(px(x), pz(z)) : g.lineTo(px(x), pz(z))); else g.moveTo(px(x), pz(z)); } g.stroke(); }
  sandTex.needsUpdate = true;
}

// ---------- stones ----------
const stones = [];
function stoneGeometry(def, i) {
  const r = seeded(11 + i * 7), geo = new T.IcosahedronGeometry(1, 4), p = geo.attributes.position, k = [r(), r(), r(), r()].map(v => v * 6);
  for (let j = 0; j < p.count; j++) { const x = p.getX(j), y = p.getY(j), z = p.getZ(j);
    const n = 1 + .11 * Math.sin(3.1 * x + k[0]) * Math.cos(2.7 * z + k[1]) + .07 * Math.sin(5.3 * y + k[2]) + .035 * Math.sin(9 * x + 7 * z + k[3]);
    // the part under the sand is cut flat inside the sand slab (never below it), so nothing pokes out of the floor
    p.setXYZ(j, x * n * def.size[0] / 2 * CM, Math.max(-.003, (y > 0 ? y * n * def.size[1] : y * .35 * n * def.size[1]) * CM), z * n * def.size[2] / 2 * CM); }
  const g = weld(geo);
  const uv = new Float32Array(g.attributes.position.count * 2), P = g.attributes.position;
  for (let j = 0; j < P.count; j++) { const x = P.getX(j), y = P.getY(j), z = P.getZ(j);
    uv[2 * j] = (Math.atan2(z, x) / (2 * Math.PI) + .5) * 2; uv[2 * j + 1] = y / (def.size[1] * CM) * 1.3 + .1; }
  g.setAttribute('uv', new T.BufferAttribute(uv, 2)); g.computeVertexNormals(); return g;
}
L.stones.forEach((def, i) => {
  const root = new T.Group(); root.userData.layoutId = def.id;
  const mesh = new T.Mesh(stoneGeometry(def, i), new T.MeshBasicMaterial({ map: stoneTex[def.color], side: T.FrontSide }));
  mesh.position.y = -.004; mesh.userData.layoutId = def.id; root.add(mesh);
  stones.push({ id: def.id, def, root, mesh });
});

// ---------- cabomba (clumps lean their own way; leaves are thin forked fans inked along the fringe) ----------
function fanTexture(a, b) { const c = document.createElement('canvas'); c.width = 64; c.height = 4; const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 64, 0); g.addColorStop(0, a); g.addColorStop(1, b); x.fillStyle = g; x.fillRect(0, 0, 64, 4); return canvasTex(c); }
const leafMat = [fanTexture('#3f5f30', '#8fae62'), fanTexture('#4a6b36', '#a3bd74')].map(map => new T.MeshBasicMaterial({ map, side: T.DoubleSide }));
const stemMat = new T.MeshBasicMaterial({ color: '#4d6638' });
function fanInto(P, N, U, I, C, origin, dir, up, r) {
  const side = new T.Vector3(-dir.z, 0, dir.x).multiplyScalar(.18), yv = new T.Vector3(0, 1, 0);
  const nrm = new T.Vector3().crossVectors(dir.clone().add(side), yv.clone().add(side)).normalize(), th = .00035;
  const pt = (ph, rr) => dir.clone().multiplyScalar(Math.cos(ph) * rr).add(yv.clone().multiplyScalar(Math.sin(ph) * rr)).add(side.clone().multiplyScalar(Math.sin(ph) * rr)).add(origin);
  const M = quality.name === 'light' ? 5 : 7, span = Math.PI / 2 - up - .06;
  for (let j = 0; j < M; j++) {
    const ph = up + span * (j + .5) / M, w = span / M * .32, d = span / M * .3, rm = r * (.5 + .08 * Math.sin(j * 2.3)), rt = r * (.92 + .08 * Math.cos(j * 1.7));
    const ring = [origin.clone(), pt(ph - w, rm), pt(ph - d, rt), pt(ph, rm * 1.08), pt(ph + d, rt), pt(ph + w, rm)], us = [.2, .5, .9, .55, .9, .5], base = P.length / 3;
    for (const s of [1, -1]) ring.forEach((v, k) => { P.push(v.x + nrm.x * th * s, v.y + nrm.y * th * s, v.z + nrm.z * th * s); N.push(nrm.x * s, nrm.y * s, nrm.z * s); U.push(us[k], .5); });
    for (const [a, b, c] of [[0, 1, 5], [1, 2, 3], [3, 4, 5], [1, 3, 5]]) { I.push(base + a, base + b, base + c, base + 6 + c, base + 6 + b, base + 6 + a); C.push(0, 0); }
    for (let k = 0; k < 6; k++) { const a = base + k, b = base + (k + 1) % 6, ink = k >= 1 && k <= 4 ? 1 : 0; I.push(a, a + 6, b, b, a + 6, b + 6); C.push(ink, ink); }
  }
}
const plants = [];
L.plants.forEach((def, pi) => {
  const rnd = seeded(41 + pi * 13), root = new T.Group(); root.userData.layoutId = def.id; const parts = [];
  const clumps = [];
  // clumps near a side wall lean inward (away from the glass and the back), each at its own angle (~6-22 deg)
  // and within +-55 deg of straight inward, so the bed fans out naturally instead of standing upright
  const nearWall = Math.abs(def.pos[0]) > TANK.width / 2 - 12, inX = -Math.sign(def.pos[0]), inZ = def.pos[2] < 0 ? .6 : -.6;
  for (let k = 0; k < Math.ceil(def.stems / 3); k++) {
    const az = nearWall ? Math.atan2(inZ, inX) + (rnd() - .5) * 1.9 : rnd() * Math.PI * 2, tilt = .1 + .3 * rnd();
    clumps.push({ x: (rnd() - .5) * def.spread[0], z: (rnd() - .5) * def.spread[1], lx: Math.cos(az) * tilt, lz: Math.sin(az) * tilt * .7 }); }
  for (let i = 0; i < def.stems; i++) {
    const k = clumps[i % clumps.length], h = (def.height[0] + (def.height[1] - def.height[0]) * Math.pow(rnd(), .8)) * CM;
    const x0 = (k.x + (rnd() - .5) * 1.6) * CM, z0 = (k.z + (rnd() - .5) * 1.4) * CM;
    const lx = k.lx + (rnd() - .5) * .2, lz = k.lz + (rnd() - .5) * .16, bend = (rnd() - .5) * .3, phase = rnd() * Math.PI;
    let LX = lx, LZ = lz, BD = bend, X0s = x0, Z0s = z0;
    const at = y => new T.Vector3(X0s + LX * y + BD * y * y / h, y * (1 - .5 * (LX * LX + LZ * LZ)), Z0s + LZ * y + .3 * BD * y * y / h);
    // keep the whole stem and its leaf fans (radius up to ~4.6 cm near the base) inside the glass: lean less, then shift
    const fits = () => { for (let f = 0; f <= 1; f += .1) { const q = at(f * h), r = .046 * (1 - .4 * f) + .004;
      if (Math.abs(def.pos[0] * CM + q.x) > TW / 2 - r || Math.abs(def.pos[2] * CM + q.z) > TD / 2 - r) return false; } return true; };
    for (let it = 0; it < 12 && !fits(); it++) { LX *= .75; LZ *= .75; BD *= .75;
      if (it > 4) { X0s -= Math.sign(def.pos[0] * CM + X0s) * .004; Z0s -= Math.sign(def.pos[2] * CM + Z0s + 1e-6) * .003; } }
    const stem = solid(new T.TubeGeometry(new T.CatmullRomCurve3([0, .33, .66, 1].map(f => at(f * h))), 16, .0012, 5, false), stemMat);
    stem.userData.nihongaLineScale = .25; stem.userData.layoutId = def.id; root.add(stem); parts.push(stem);
    const P = [], N = [], U = [], I = [], C = []; let y = .012, n = 0;
    while (y < h) { const f = y / h, r = .046 * (1 - .4 * f) * (.9 + .2 * rnd()), a = phase + n * Math.PI / 2 + (rnd() - .5) * .3;
      for (const s of [0, Math.PI]) fanInto(P, N, U, I, C, at(y), new T.Vector3(Math.cos(a + s), 0, Math.sin(a + s)), .12 + .2 * f, r);
      y += .024 * (1 - .6 * f * f); n++; }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(N, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(U, 2)); g.setIndex(I);
    const leaves = new T.Mesh(g, leafMat[rnd() < .5 ? 0 : 1]); leaves.userData.nihongaContourFaces = Uint8Array.from(C); leaves.userData.nihongaLineScale = .22; leaves.userData.layoutId = def.id;
    root.add(leaves); parts.push(leaves);
  }
  plants.push({ id: def.id, def, root, parts });
});

// ---------- layout state (approved version is the default; edits are saved per browser) ----------
const objects = [...stones.map(s => ({ id: s.id, kind: 'stone', position: s.def.pos.map(v => v * CM), rotation: [0, s.def.rot_y * Math.PI / 180, 0], colorId: s.def.color })),
                 ...plants.map(p => ({ id: p.id, kind: 'plant', position: p.def.pos.map(v => v * CM), rotation: [0, 0, 0] }))];
const state = Lib.createAquariumState(objects, { palette: ['ai', 'midori'], revision: 'layout-' + L.version + (L.revision ? '-' + L.revision.slice(0, 3) : '') });
const SKEY = 'seibungyo-nihonga:layout:' + L.version + ':ai-midori';
try { const saved = store.get(SKEY); if (saved) state.load(JSON.parse(saved)); } catch {}
const byId = id => stones.find(s => s.id === id) || plants.find(p => p.id === id);
function applyState() {
  for (const o of state.snapshot().objects) { const it = byId(o.id); it.root.position.set(...o.position); it.root.rotation.set(...o.rotation);
    if (o.kind === 'stone') { it.colorId = o.colorId; it.mesh.material.map = stoneTex[o.colorId]; const nm = it.mesh.userData.nihonga; if (nm) nm.paint.uniforms.map.value = Object.assign(stoneTex[o.colorId].clone(), { colorSpace: T.NoColorSpace, needsUpdate: true }); } }
  scene.updateMatrixWorld(true);
  for (const p of plants) {                                 // a moved / turned clump stays inside the glass
    const bb = new T.Box3().setFromObject(p.root), m = .003; let dx = 0, dz = 0;
    if (bb.min.x < -TW / 2 + m) dx = -TW / 2 + m - bb.min.x; if (bb.max.x > TW / 2 - m) dx = TW / 2 - m - bb.max.x;
    if (bb.min.z < -TD / 2 + m) dz = -TD / 2 + m - bb.min.z; if (bb.max.z > TD / 2 - m) dz = TD / 2 - m - bb.max.z;
    if (dx || dz) { p.root.position.x += dx; p.root.position.z += dz; p.root.updateMatrixWorld(true);
      state.setTransform(p.id, { position: p.root.position.toArray() }); }
  }
  drawSand();
}
const save = () => store.set(SKEY, JSON.stringify(state.snapshot()));

// ---------- build the scene ----------
try {
  for (const [i, f] of L.fish.entries()) await loadFish(f, i);
} catch (e) { console.error(e); fail('魚のモデルを読み込めませんでした。再読み込みしてください。'); return; }
scene.add(sand); nihonga.add(sand);
// rakkan (seal) "青色金魚" on the front glass, lower left: vermilion with paper-coloured carved characters (hakubun)
await document.fonts?.load?.('600 120px "Shippori Mincho"').catch(() => {});
{
  const c = document.createElement('canvas'); c.width = c.height = 512; const x = c.getContext('2d'), r = seeded(23);
  x.fillStyle = '#b2382c'; x.fillRect(0, 0, 512, 512);
  for (let k = 0; k < 2500; k++) { x.globalAlpha = .08 * r(); x.fillStyle = r() < .5 ? '#7d2019' : '#d4614f'; x.fillRect(512 * r(), 512 * r(), 3, 3); }
  x.globalAlpha = 1; x.fillStyle = '#efe3c8'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = '600 200px "Shippori Mincho","Hiragino Mincho ProN","Yu Mincho","Noto Serif JP",serif';
  [['青', 372, 140], ['色', 372, 372], ['金', 140, 140], ['魚', 140, 372]].forEach(([ch, cx, cy]) => x.fillText(ch, cx, cy));   // right column first
  x.fillStyle = '#e9dcc0';                                         // worn spots (the shader draws colour only, no alpha)
  for (let k = 0; k < 60; k++) { x.beginPath(); x.arc(512 * r(), 512 * r(), 1.5 + 4 * r(), 0, 7); x.fill(); }
  const tex = canvasTex(c);
  const sh = new T.Shape(), n = 28, half = .018;
  for (let k = 0; k < n * 4; k++) {                               // slightly irregular square outline
    const side = Math.floor(k / n), t = (k % n) / n, j = (r() - .5) * .0012;
    const [px, py] = [[-half + 2 * half * t, -half], [half, -half + 2 * half * t], [half - 2 * half * t, half], [-half, half - 2 * half * t]][side];
    side % 2 ? sh.lineTo(px + j, py) : (k ? sh.lineTo(px, py + j) : sh.moveTo(px, py));
  }
  const g = new T.ShapeGeometry(sh); const uv = g.attributes.uv; const P = g.attributes.position;
  for (let i = 0; i < P.count; i++) uv.setXY(i, (P.getX(i) + half) / (2 * half), (P.getY(i) + half) / (2 * half));
  const seal = new T.Mesh(g, new T.MeshBasicMaterial({ map: tex, side: T.FrontSide }));
  seal.position.set(-TW / 2 + .035, .045, TD / 2 + .0045);
  seal.userData.nihongaContourFaces = new Uint8Array(g.index.count / 3);
  scene.add(seal); nihonga.add(seal);
}
// tank frame: lacquered rails along the twelve edges (thicker at the base and the rim) and a fine water line.
// The glass itself stays unpainted (the nihonga shader draws opaque colour only), so the frame says "tank".
{
  const frameMat = new T.MeshBasicMaterial({ color: '#2b2a2e' }), waterMat = new T.MeshBasicMaterial({ color: '#8fa3b0' });
  const H = TANK.height * CM, WL = TANK.water_level * CM, t = .006, base = .016, rim = .01;
  const rail = (w, h, d, x, y, z, mat = frameMat, scale = .5) => { const m = solid(new T.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.userData.nihongaLineScale = scale; scene.add(m); nihonga.add(m); };
  const X = TW / 2 + t / 2, Z = TD / 2 + t / 2;
  for (const z of [-Z, Z]) { rail(TW + 2 * t, base, t, 0, -.014 + base / 2 + .001, z); rail(TW + 2 * t, rim, t, 0, H - rim / 2, z); }
  for (const x of [-X, X]) { rail(t, base, TD, x, -.014 + base / 2 + .001, 0); rail(t, rim, TD, x, H - rim / 2, 0); }
  for (const x of [-X, X]) for (const z of [-Z, Z]) rail(t, H + .018, t, x, (H - .018) / 2, z);
  // water line just inside the glass
  const w = .0012;
  for (const z of [-TD / 2 + w, TD / 2 - w]) rail(TW - .002, w, w, 0, WL, z, waterMat, .35);
  for (const x of [-TW / 2 + w, TW / 2 - w]) rail(w, w, TD - .002, x, WL, 0, waterMat, .35);
}
for (const s of stones) { scene.add(s.root); nihonga.add(s.root); }
for (const p of plants) { scene.add(p.root); nihonga.add(p.root); }
applyState();
setView('front');
statusEl.hidden = true;

// keep the editor / notes sheets just above the control bar (it wraps to several rows on phones)
const bar = document.querySelector('.bar'), stage = $('stage');
const barH = () => stage.style.setProperty('--bar-h', bar.offsetHeight + 'px');
new ResizeObserver(barH).observe(bar); barH();

// ---------- modes, views, watch ----------
let mode = 'view', watching = null, selected = null;
document.body.dataset.mode = 'view';
const press = (el, on) => el.setAttribute('aria-pressed', String(on));
function setMode(m) { mode = m; document.body.dataset.mode = m; press($('mode-view'), m === 'view'); press($('mode-edit'), m === 'edit');
  $('edit-panel').hidden = m !== 'edit'; if (m === 'edit') stopWatch(); else select(null); }
$('mode-view').onclick = () => setMode('view'); $('mode-edit').onclick = () => setMode('edit');
document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { stopWatch(); setView(b.dataset.view); });
const toast = msg => { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => t.hidden = true, 1800); };

const INFO = A.info;
for (const f of fishes) $('watch-select').append(new Option('観察：' + INFO[f.info.species_key].name, f.id));
function startWatch(id) {
  const f = fishes.find(x => x.id === id); if (!f) return;
  setMode('view'); watching = f; $('watch-select').value = id;
  const tall = camera.aspect < 1, s = Lib.watchStart(f.root.position.toArray(), f.yaw, { aspect: camera.aspect, distance: tall ? .7 : .5, lift: .01 });
  camera.position.set(...s.camera); controls.target.set(...s.target); controls.update();
  f.prev.copy(f.root.position);
  const info = INFO[f.info.species_key];
  $('watch-name').textContent = info.name; $('watch-sci').textContent = info.scientific; $('watch-body').textContent = info.text;
  $('watch-panel').hidden = false; press($('watch-stop'), f.stopped);
}
function stopWatch() { if (watching) { watching.stopped = false; watching = null; } $('watch-panel').hidden = true; $('watch-select').value = ''; }
$('watch-select').onchange = e => e.target.value ? startWatch(e.target.value) : (stopWatch(), setView('front'));
$('watch-stop').onclick = () => { if (!watching) return; watching.stopped = !watching.stopped; press($('watch-stop'), watching.stopped); };
$('watch-next').onclick = () => { const id = Lib.nextWatchId(fishes.map(f => f.id), watching?.id); if (watching) watching.stopped = false; startWatch(id); };
$('watch-all').onclick = () => { stopWatch(); setView('front'); };
$('watch-close').onclick = () => { $('watch-panel').hidden = true; };

// ---------- picking and dragging ----------
const ray = new T.Raycaster(), ndc = new T.Vector2(), floor = new T.Plane(new T.Vector3(0, 1, 0), 0);
const toNdc = e => { const r = canvas.getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); ray.setFromCamera(ndc, camera); };
const editables = () => [...stones.map(s => s.mesh), ...plants.flatMap(p => p.parts)];
let down = null, drag = null;
canvas.addEventListener('pointerdown', e => {
  down = { x: e.clientX, y: e.clientY };
  if (mode !== 'edit') return;
  toNdc(e); const hit = ray.intersectObjects(editables(), false)[0];
  if (!hit) return;
  select(hit.object.userData.layoutId);
  const it = byId(selected), p = new T.Vector3(); ray.ray.intersectPlane(floor, p);
  drag = { it, off: it.root.position.clone().sub(p), id: e.pointerId }; controls.enabled = false; canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.id) return;
  toNdc(e); const p = new T.Vector3(); if (!ray.ray.intersectPlane(floor, p)) return;
  p.add(drag.off); drag.it.root.position.set(Math.max(-.27, Math.min(.27, p.x)), 0, Math.max(-.13, Math.min(.13, p.z)));
});
function endDrag() { if (!drag) return; const it = drag.it; drag = null; controls.enabled = true;
  state.setTransform(it.id, { position: it.root.position.toArray() }); save(); applyState(); syncControls(); }
canvas.addEventListener('pointerup', e => {
  if (drag) { endDrag(); return; }
  if (mode === 'view' && down && Lib.isTap(down, { x: e.clientX, y: e.clientY })) {
    toNdc(e); const hit = ray.intersectObjects([...fishes.map(f => f.root), sand, ...stones.map(s => s.mesh)], true)[0];
    if (hit && hit.object.userData.fishId) startWatch(hit.object.userData.fishId);
  }
});
canvas.addEventListener('pointercancel', endDrag);

// ---------- editor panel ----------
const sel = $('obj-select');
for (const s of stones) sel.append(new Option('石：' + s.def.role, s.id));
for (const p of plants) sel.append(new Option('カボンバの株：' + (p.def.pos[0] < 0 ? '左' : '右'), p.id));
function select(id) { selected = id || null; sel.value = selected || ''; $('obj-controls').hidden = !selected; syncControls(); }
function syncControls() { if (!selected) return; const it = byId(selected);
  $('pos-x').value = (it.root.position.x / CM).toFixed(1); $('pos-z').value = (it.root.position.z / CM).toFixed(1);
  $('rot-y').value = Math.round(it.root.rotation.y * 180 / Math.PI); $('stone-color').hidden = !stones.includes(it);
  document.querySelectorAll('[data-color]').forEach(b => press(b, it.colorId === b.dataset.color)); }
sel.onchange = e => select(e.target.value);
for (const [id, axis] of [['pos-x', 0], ['pos-z', 2]]) $(id).oninput = e => { const it = byId(selected); const p = it.root.position.toArray(); p[axis] = +e.target.value * CM;
  state.setTransform(selected, { position: p }); applyState(); save(); };
$('rot-y').oninput = e => { state.setTransform(selected, { rotation: [0, +e.target.value * Math.PI / 180, 0] }); applyState(); save(); };
document.querySelectorAll('[data-color]').forEach(b => b.onclick = () => { if (!selected) return; state.setStoneColor(selected, b.dataset.color); applyState(); save(); syncControls(); });
document.querySelectorAll('[data-all-color]').forEach(b => b.onclick = () => { state.setAllStoneColors(b.dataset.allColor); applyState(); save(); syncControls(); toast('石の色をそろえました'); });
$('reset').onclick = () => { state.restoreDefault(); applyState(); save(); syncControls(); toast('承認した配置と色に戻しました'); };

// ---------- BGM (starts only from the button: browsers block autoplay with sound) ----------
if (A.bgm) {
  const audio = new Audio(A.bgm); audio.loop = true; audio.volume = .55; audio.preload = 'none';
  const b = $('bgm'); b.hidden = false;
  b.onclick = async () => {
    if (audio.paused) { try { await audio.play(); press(b, true); b.textContent = 'BGM 停止'; } catch { toast('BGMを再生できませんでした'); } }
    else { audio.pause(); press(b, false); b.textContent = 'BGM'; }
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden && !audio.paused) audio.pause(), press(b, false), b.textContent = 'BGM'; });
}

// ---------- loop ----------
let last = performance.now(), acc = 0;
renderer.setAnimationLoop(now => {
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  if (document.hidden) return;
  acc += dt; if (acc < 1 / quality.fps - .002) return; const step = acc; acc = 0;
  for (const f of fishes) updateFish(f, step);
  separateFish(step);
  if (watching) { const d = Lib.followDelta(watching.prev.toArray(), watching.root.position.toArray());
    camera.position.add(new T.Vector3(...d)); controls.target.add(new T.Vector3(...d)); watching.prev.copy(watching.root.position);
    camera.position.set(...Lib.clampWatchCamera(camera.position.toArray(), { w: TW, d: TD }, { floorY: .03 })); }
  controls.update(); nihonga.render(scene, camera);
});
window.__aquarium = { scene, camera, controls, fishes, stones, plants, state, setView, startWatch, setMode, quality };
window.__ready = true;
})().catch(e => { console.error(e); const s = document.getElementById('status'); s.hidden = false; s.querySelector('p').textContent = '水槽を開けませんでした。再読み込みしてください。'; });
