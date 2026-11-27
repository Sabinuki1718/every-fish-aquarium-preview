(async () => {
const canvas = document.getElementById('view'), status = document.getElementById('status');
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); }
catch (e) { status.textContent = 'この端末では3D表示（WebGL）を開始できませんでした。'; return; }
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(32, 1, .005, 5);
scene.add(new THREE.HemisphereLight(0xffffff, 0xd8dde0, 2.5));
const sun = new THREE.DirectionalLight(0xffffff, 1); sun.position.set(-.3, .8, .6); scene.add(sun);
const controls = new THREE.OrbitControls(camera, canvas); controls.enableDamping = true; controls.autoRotateSpeed = 1.2;
const D = .3, V = { side: [0, 0, D], front: [-D, 0, 1e-4], top: [0, D, 1e-4], bottom: [0, -D, 1e-4], oblique: [-.17, .1, .22] };
const setView = n => { camera.position.set(...V[n]); controls.target.set(0, 0, 0); controls.update(); };
document.querySelectorAll('[data-v]').forEach(b => b.addEventListener('click', () => setView(b.dataset.v)));
const spin = document.getElementById('spin');
spin.addEventListener('click', () => { controls.autoRotate = !controls.autoRotate; spin.setAttribute('aria-pressed', controls.autoRotate); });
function resize() { const w = canvas.clientWidth, h = canvas.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.fov = w < h ? 48 : 32; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize(); setView('oblique');
const cache = {}; let current = null;
async function show(key) {
  const f = FISHES[key];
  document.querySelectorAll('[data-fish]').forEach(b => b.setAttribute('aria-pressed', b.dataset.fish === key));
  document.getElementById('name').textContent = f.name; document.getElementById('note').textContent = f.note;
  try {
    if (!cache[key]) {
      status.hidden = false; status.textContent = '読み込み中…';
      const fish = await loadFishJSON(THREE, f.geometry, f.texture);
      const box = new THREE.Box3().setFromObject(fish), size = box.getSize(new THREE.Vector3()).length();
      fish.scale.setScalar(.13 / size); fish.position.sub(box.getCenter(new THREE.Vector3()).multiplyScalar(.13 / size));
      cache[key] = fish;
    }
    if (current) scene.remove(current); current = cache[key]; scene.add(current); status.hidden = true;
  } catch (e) { console.error(e); status.textContent = 'モデルを読み込めませんでした。再読み込みしてください。'; }
}
document.querySelectorAll('[data-fish]').forEach(b => b.addEventListener('click', () => show(b.dataset.fish)));
show('azumanishiki');
(function loop() { requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); })();
})();
