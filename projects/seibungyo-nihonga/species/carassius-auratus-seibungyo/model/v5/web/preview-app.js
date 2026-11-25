(async () => {
const canvas = document.getElementById('view'), status = document.getElementById('status');
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); if (!renderer.capabilities.isWebGL2) throw new Error('WebGL2'); }
catch (e) { status.textContent = 'この端末では3D表示（WebGL2）を開始できませんでした。'; return; }
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);          // the shader finds the background by alpha 0 in its info pass
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(30, 1, .005, 5);
const controls = new THREE.OrbitControls(camera, canvas); controls.enableDamping = true; controls.autoRotateSpeed = 1.0;
const D = .36, V = { side: [0, 0, D], front: [-D, 0, 1e-4], top: [0, D, 1e-4], bottom: [0, -D, 1e-4], oblique: [-.2, .1, .27] };
const setView = n => { camera.position.set(...V[n]); controls.target.set(0, 0, 0); controls.update(); };
document.querySelectorAll('[data-v]').forEach(b => b.addEventListener('click', () => setView(b.dataset.v)));
const toggle = (id, on) => { const b = document.getElementById(id); b.addEventListener('click', () => { const v = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', v); on(v); }); };
toggle('spin', v => controls.autoRotate = v);
let moving = true; toggle('move', v => moving = v);
const nihonga = createNihonga(THREE, renderer, { lineWidth: 7, occlusionEps: .0008 });
toggle('ink', v => nihonga.params.ink = v);
document.getElementById('lw').addEventListener('input', e => nihonga.params.lineWidth = +e.target.value);
function resize() { const w = canvas.clientWidth, h = canvas.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.fov = w < h ? 46 : 30; camera.updateProjectionMatrix(); nihonga.setSize(); }
addEventListener('resize', resize); resize(); setView(new URLSearchParams(location.search).get('view') || 'oblique');

// morph drivers: the same formulas as the GLB clip 'idle'
function weights(dv, t) {
  const ph = 2 * Math.PI * dv.cycles * t / dv.duration + dv.phase;
  if (dv.kind === 'wave') { const m = 1 + dv.whim * Math.sin(2 * Math.PI * t / dv.duration + dv.whim_phase); return [Math.sin(ph) * m, Math.cos(ph) * m]; }
  return [0.5 - 0.5 * Math.cos(ph)];
}
const animated = [];
try {
  const res = await fetch(FISH.geometry); if (!res.ok) throw new Error(FISH.geometry);
  const data = await res.json();
  const map = await new THREE.TextureLoader().loadAsync(FISH.texture);
  map.flipY = false; map.colorSpace = THREE.SRGBColorSpace;
  const fish = new THREE.Group();
  for (const m of data.meshes) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(m.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(m.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(m.uv, 2));
    g.setIndex(m.i);
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map, side: THREE.DoubleSide }));
    mesh.name = m.name;
    if (m.contour) { const k = new Uint8Array(m.i.length / 3); for (const f of m.contour) k[f] = 1; mesh.userData.nihongaContourFaces = k; }
    if (m.targets) { mesh.userData.nihongaDynamic = true; animated.push({ mesh, base: Float32Array.from(m.p), d: m.targets.map(t => Float32Array.from(t.d)), dv: m.driver }); }
    fish.add(mesh);
  }
  scene.add(fish); nihonga.add(fish); status.hidden = true;
} catch (e) { console.error(e); status.textContent = 'モデルを読み込めませんでした。再読み込みしてください。'; }
const q = new URLSearchParams(location.search), fixedT = q.has('t') ? +q.get('t') : null;
let t = 0, last = performance.now();
function pose(time) {
  for (const a of animated) {
    const w = q.get('state') === 'open' ? (a.dv.kind === 'pulse' ? [1] : [0, 0]) : weights(a.dv, time % a.dv.duration);
    const p = a.mesh.geometry.attributes.position, arr = p.array;
    arr.set(a.base);
    for (let k = 0; k < a.d.length; k++) { const wk = w[k], dk = a.d[k]; if (!wk) continue; for (let i = 0; i < arr.length; i++) arr[i] += wk * dk[i]; }
    p.needsUpdate = true;
  }
}
renderer.setAnimationLoop(now => {
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  if (moving) t += dt;
  pose(fixedT ?? t);
  controls.update(); nihonga.render(scene, camera);
});
window.__ready = true;
})();
