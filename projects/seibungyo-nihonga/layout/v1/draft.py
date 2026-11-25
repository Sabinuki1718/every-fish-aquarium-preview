"""Layout draft v1: a quick scene with the approved fish (model v5), placeholder stones / cabomba / raked sand,
drawn with the nihonga shader. For the layout proposal only (not the aquarium itself).

python draft.py  -> draft.html (offline, self-contained); render with Playwright for the proposal images.
"""
from pathlib import Path
import json, sys
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
sys.path.insert(0, str(ROOT / '.agents/skills/publish-aquarium-web/scripts'))
from web_bundle import THREE_OFFLINE, data_uri

WEB = HERE.parents[1] / 'species/carassius-auratus-seibungyo/model/v5/web'
layout = json.loads((HERE / 'layout.json').read_text(encoding='utf8'))
fish = {'geometry': data_uri(WEB / 'models/seibungyo.json', 'application/json'), 'texture': data_uri(WEB / 'models/seibungyo-2048.jpg')}

APP = r'''
(async () => {
const L = window.LAYOUT, CM = .01;
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); renderer.setPixelRatio(1); renderer.setClearColor(0, 0);
renderer.setSize(innerWidth, innerHeight, false);
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(24, innerWidth / innerHeight, .01, 10);
const q = new URLSearchParams(location.search), view = q.get('view') || 'front';
if (view === 'top') { camera.position.set(0, 1.55, .001); camera.lookAt(0, 0, 0); }
else if (view === 'oblique') { camera.position.set(-.55, .45, 1.15); camera.lookAt(0, .13, 0); }
else { camera.position.set(0, .2, 1.45); camera.lookAt(0, .16, 0); }
const nihonga = createNihonga(THREE, renderer, { lineWidth: 5, occlusionEps: .002 });
const solid = (geo, color) => { geo = THREE.BufferGeometryUtils.mergeVertices(geo.index ? geo : geo.toNonIndexed(), 1e-5); geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })); };
// raked sand: a thin closed slab, ripples painted into its texture (concentric around stone groups, straight elsewhere)
const T = L.tank, cv = document.createElement('canvas'); cv.width = 1200; cv.height = 600; const g = cv.getContext('2d');
g.fillStyle = L.substrate.color; g.fillRect(0, 0, 1200, 600);
const px = x => (x / T.width + .5) * 1200, pz = z => (z / T.depth + .5) * 600, sc = 1200 / T.width;
const groups = [{ x: -15, z: -3, r: 9 }, { x: 18.5, z: -5.5, r: 6 }];
g.strokeStyle = 'rgba(120,112,98,.55)'; g.lineWidth = 2.2;
for (let z = -T.depth / 2 + .8; z < T.depth / 2; z += 1.1) { g.beginPath(); let on = false;
  for (let x = -T.width / 2; x <= T.width / 2; x += .25) {
    const inside = groups.some(o => Math.hypot(x - o.x, z - o.z) < o.r + 5.5);
    if (inside) { if (on) { g.stroke(); g.beginPath(); on = false; } continue; }
    if (!on) { g.moveTo(px(x), pz(z)); on = true; } else g.lineTo(px(x), pz(z)); }
  if (on) g.stroke(); }
for (const o of groups) for (let r = o.r; r < o.r + 5.6; r += 1.1) { g.beginPath(); g.ellipse(px(o.x), pz(o.z), r * sc, r * sc, 0, 0, Math.PI * 2); g.stroke(); }
const sandTex = new THREE.CanvasTexture(cv); sandTex.colorSpace = THREE.SRGBColorSpace;
const sand = new THREE.Mesh(new THREE.BoxGeometry(T.width * CM, .012, T.depth * CM), new THREE.MeshBasicMaterial({ map: sandTex }));
sand.position.y = -.006; scene.add(sand); nihonga.add(sand);
// stones: noisy, flattened blobs
const rnd = (s => () => (s = (s * 16807) % 2147483647) / 2147483647)(11);
for (const s of L.stones) {
  const geo = new THREE.IcosahedronGeometry(1, 3); const p = geo.attributes.position; const k = [rnd(), rnd(), rnd()].map(v => v * 6);
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 1 + .12 * Math.sin(3.1 * x + k[0]) * Math.cos(2.7 * z + k[1]) + .07 * Math.sin(5.3 * y + k[2]);
    p.setXYZ(i, x * n, (y > 0 ? y * n : y * .35 * n), z * n); }
  const m = solid(geo, L.stone_colors[s.color].hex);
  m.scale.set(s.size[0] / 2 * CM, s.size[1] * CM, s.size[2] / 2 * CM); m.rotation.y = s.rot_y * Math.PI / 180;
  m.position.set(s.pos[0] * CM, .0, s.pos[2] * CM); scene.add(m); nihonga.add(m);
}
// cabomba: stems with whorls of fan-shaped leaves
for (const c of L.plants) for (let i = 0; i < c.stems; i++) {
  const h = (c.height[0] + (c.height[1] - c.height[0]) * rnd()) * CM, x0 = c.pos[0] * CM + (rnd() - .5) * .05, z0 = c.pos[2] * CM + (rnd() - .5) * .04;
  const lean = (rnd() - .5) * .25;
  const stem = solid(new THREE.CylinderGeometry(.0012, .0016, h, 6, 1), '#4f6b52');
  stem.position.set(x0 + lean * h / 2, h / 2, z0); stem.rotation.z = -lean; scene.add(stem); nihonga.add(stem);
  for (let y = .02; y < h; y += .014) {
    const w = .024 * (1 - .4 * y / h);
    const fan = solid(new THREE.ConeGeometry(w, .006, 14, 1), y > h * .8 ? '#7f9a72' : '#5f7d5c');
    fan.position.set(x0 + lean * y, y, z0); fan.rotation.y = rnd() * 3; scene.add(fan); nihonga.add(fan);
  }
}
// the approved fish
const data = await (await fetch(FISH.geometry)).json(); const map = await new THREE.TextureLoader().loadAsync(FISH.texture);
map.flipY = false; map.colorSpace = THREE.SRGBColorSpace;
const fish = new THREE.Group();
for (const m of data.meshes) { const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(m.p, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(m.n, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(m.uv, 2)); geo.setIndex(m.i);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map, side: THREE.DoubleSide }));
  if (m.contour) { const k = new Uint8Array(m.i.length / 3); for (const f of m.contour) k[f] = 1; mesh.userData.nihongaContourFaces = k; }
  fish.add(mesh); }
const f0 = L.fish[0]; fish.position.set(f0.start[0] * CM, f0.start[1] * CM, f0.start[2] * CM); fish.rotation.y = -.35;
scene.add(fish); nihonga.add(fish);
nihonga.render(scene, camera); window.__ready = true;
})();
'''

html = ('<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>レイアウト案 v1</title>'
        '<style>html,body{margin:0;height:100%;background:#ece4d1}canvas{display:block;width:100vw;height:100vh}</style></head><body>'
        '<canvas id="c"></canvas>'
        f'<script>window.LAYOUT={json.dumps(layout, ensure_ascii=False)};window.FISH={json.dumps(fish)};</script>'
        f'<script>{THREE_OFFLINE.read_text(encoding="utf8")}</script>'
        f'<script>{(WEB / "nihonga-shader.js").read_text(encoding="utf8")}</script>'
        f'<script>{APP}</script></body></html>')
(HERE / 'draft.html').write_text(html, encoding='utf8')
print('draft.html', len(html))
