"""Nihonga-shader preview of seibungyo.glb (public page + offline single file).

python preview.py v1
Writes into ../<version>/web/:
  preview.html            Artifact/web page (three.js r170 from jsDelivr, files next to it)
  nihonga-shader.js       classic-script build of aquarium/lib/nihonga-shader.js (window.createNihonga)
  preview-app.js, models/seibungyo.json (geometry + morph targets + drivers), models/seibungyo-2048.jpg
  preview-offline.html    one self-contained file (three-offline.js and the model inlined)
"""
from pathlib import Path
import io, json, struct, sys
import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[5]
sys.path.insert(0, str(ROOT / '.agents/skills/publish-aquarium-web/scripts'))
from web_bundle import online_three_loader, offline_document, data_uri

VERSION = sys.argv[1] if len(sys.argv) > 1 else 'v1'
SRC = HERE.parent / VERSION
OUT = SRC / 'web'
SHADER = HERE.parents[3] / 'aquarium/lib/nihonga-shader.js'
(OUT / 'models').mkdir(parents=True, exist_ok=True)

raw = (SRC / 'seibungyo.glb').read_bytes()
jl = struct.unpack_from('<I', raw, 12)[0]; doc = json.loads(raw[20:20 + jl]); binary = raw[28 + jl:]


def arr(i):
    a = doc['accessors'][i]; v = doc['bufferViews'][a['bufferView']]
    dt = {5126: '<f4', 5125: '<u4'}[a['componentType']]; n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3}[a['type']]
    return np.frombuffer(binary, dtype=dt, count=a['count'] * n, offset=v.get('byteOffset', 0) + a.get('byteOffset', 0))


meshes = []
for i, m in enumerate(doc['meshes']):
    pr = m['primitives'][0]; at = pr['attributes']; node = doc['nodes'][i + 1]
    e = {'name': m['name'], 'p': [round(float(x), 6) for x in arr(at['POSITION'])], 'n': [round(float(x), 3) for x in arr(at['NORMAL'])],
         'uv': [round(float(x), 5) for x in arr(at['TEXCOORD_0'])], 'i': arr(pr['indices']).tolist()}
    if pr.get('targets'):
        e['targets'] = [{'name': nm, 'd': [round(float(x), 6) for x in arr(t['POSITION'])]} for nm, t in zip(m['extras']['targetNames'], pr['targets'])]
        e['driver'] = node['extras']['nihongaDriver']
    if node.get('extras', {}).get('nihongaNoWeld'):
        e['noweld'] = node['extras']['nihongaNoWeld']
    if node.get('extras', {}).get('nihongaContour'):
        e['contour'] = node['extras']['nihongaContour']
    meshes.append(e)
(OUT / 'models/seibungyo.json').write_text(json.dumps({'units': 'meters', 'up': '+Y', 'forward': '-X', 'meshes': meshes}, separators=(',', ':')), encoding='utf8')
tv = doc['bufferViews'][doc['images'][0]['bufferView']]
Image.open(io.BytesIO(binary[tv['byteOffset']:tv['byteOffset'] + tv['byteLength']])).convert('RGB').save(OUT / 'models/seibungyo-2048.jpg', quality=88)
shader = SHADER.read_text(encoding='utf8').replace('export function createNihonga', 'window.createNihonga = function createNihonga', 1)
(OUT / 'nihonga-shader.js').write_text(shader, encoding='utf8')

PAGE = r'''<title>__TITLE__</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
/* Paper ground and sumi text to match the nihonga rendering; one full-screen stage. */
:root{--paper:#ece4d1;--paper-2:#e2d8c2;--ink:#26262d;--ink-soft:#5f5d5a;--accent:#3e5a73;--line:#c9bea6;
  --body:"Hiragino Mincho ProN","Yu Mincho","Noto Serif JP",serif}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--paper:#ece4d1;--paper-2:#e2d8c2;--ink:#26262d;--ink-soft:#5f5d5a;--accent:#3e5a73;--line:#c9bea6;color-scheme:light}}
:root[data-theme="dark"]{--paper:#ece4d1;--paper-2:#e2d8c2;--ink:#26262d;--ink-soft:#5f5d5a;--accent:#3e5a73;--line:#c9bea6}
[hidden]{display:none!important}
html,body{height:100%}
body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--body);overflow:hidden}
.stage{position:relative;height:100%;background:var(--paper)}
canvas{display:block;width:100%;height:100%;touch-action:none}
header{position:absolute;top:calc(12px + env(safe-area-inset-top,0px));left:0;right:0;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));pointer-events:none;display:grid;gap:4px}
h1{font-weight:600;font-size:clamp(20px,5vw,26px);margin:0;letter-spacing:.06em;text-wrap:balance}
.sub{margin:0;color:var(--ink-soft);font-size:13px;line-height:1.6;max-width:36em}
nav{position:absolute;left:0;right:0;bottom:0;padding:10px max(16px,env(safe-area-inset-right,0px)) calc(12px + env(safe-area-inset-bottom,0px)) max(16px,env(safe-area-inset-left,0px));display:flex;flex-wrap:wrap;gap:6px;justify-content:center;align-items:center}
button{font:500 14px var(--body);color:var(--ink);background:color-mix(in srgb,var(--paper) 80%,transparent);border:1px solid var(--line);border-radius:4px;padding:8px 13px;min-height:40px;cursor:pointer}
button[aria-pressed="true"]{border-color:var(--accent);color:var(--accent);background:color-mix(in srgb,var(--accent) 10%,var(--paper))}
button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
label{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--ink-soft);min-height:40px}
input[type=range]{width:96px;accent-color:var(--accent)}
#status{position:absolute;inset:0;display:grid;place-items:center;color:var(--ink-soft);font-size:14px;pointer-events:none;padding-inline:16px;text-align:center}
</style>
<div class="stage">
  <canvas id="view" aria-label="__TITLE__"></canvas>
  <header><h1>__TITLE__</h1><p class="sub">__DESC__</p><p class="sub">1本指で回転・2本指で拡大と移動</p></header>
  <div id="status">読み込み中…</div>
  <nav>
    <button type="button" data-v="side">側面</button><button type="button" data-v="front">正面</button>
    <button type="button" data-v="top">上面</button><button type="button" data-v="bottom">下面</button>
    <button type="button" data-v="oblique">斜め</button>
    <button type="button" id="spin" aria-pressed="false">自動回転</button>
    <button type="button" id="move" aria-pressed="true">鰭・口・鰓の動き</button>
    <button type="button" id="ink" aria-pressed="true">墨線</button>
    <label>線の太さ <input type="range" id="lw" min="2" max="14" step="1" value="7"></label>
  </nav>
</div>
<script>window.FISH=__FISH__;</script>
__SCRIPTS__
'''

APP = r'''(async () => {
const canvas = document.getElementById('view'), status = document.getElementById('status');
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); if (!renderer.capabilities.isWebGL2) throw new Error('WebGL2'); }
catch (e) { status.textContent = 'この端末では3D表示（WebGL2）を開始できませんでした。'; return; }
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);          // the shader finds the background by alpha 0 in its info pass
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(30, 1, .005, 5);
const controls = new THREE.OrbitControls(camera, canvas); controls.enableDamping = true; controls.autoRotateSpeed = 1.0;
const D = .36, V = { side: [0, 0, D], front: [-D, 0, 1e-4], top: [0, D, 1e-4], bottom: [0, -D, 1e-4], oblique: [-.2, .1, .27] };
const QZ = new URLSearchParams(location.search), Z = +(QZ.get('zoom') || 1), TX = +(QZ.get('tx') || 0), TY = +(QZ.get('ty') || 0);
const setView = n => { camera.position.set(...V[n].map((v, i) => v / Z + (i === 0 ? TX : i === 1 ? TY : 0))); controls.target.set(TX, TY, 0); controls.update(); };
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
  if (dv.kind === 'paku') { let p = ((dv.cycles * t / dv.duration + dv.phase / (2 * Math.PI)) % 1 + 1) % 1, q;
    if (p < .16) { q = p / .16; return [1 - (1 - q) * (1 - q)]; } if (p < .30) return [1]; if (p < .42) { q = (p - .30) / .12; return [1 - q * q]; } return [0]; }
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
    if (m.noweld) { const k = new Uint8Array(m.p.length / 3); for (const v of m.noweld) k[v] = 1; mesh.userData.nihongaNoWeld = k; }
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
    const w = q.get('state') === 'open' ? (a.dv.kind !== 'wave' ? [1] : [0, 0]) : weights(a.dv, time % a.dv.duration);
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
'''

TITLE = f'青文魚 3Dモデル {VERSION}（日本画）'
DESC = '承認済みの三面図から作成。墨線は日本画シェーダーが3Dの輪郭から描きます。全長15 cmの仮スケール。'
page = PAGE.replace('__TITLE__', TITLE).replace('__DESC__', DESC)
(OUT / 'preview-app.js').write_text(APP, encoding='utf8')
fish = {'geometry': 'models/seibungyo.json', 'texture': 'models/seibungyo-2048.jpg'}
(OUT / 'preview.html').write_text(page.replace('__FISH__', json.dumps(fish)).replace('__SCRIPTS__', online_three_loader(['nihonga-shader.js', 'preview-app.js'])), encoding='utf8')
off = {'geometry': data_uri(OUT / fish['geometry'], 'application/json'), 'texture': data_uri(OUT / fish['texture'])}
(OUT / 'preview-offline.html').write_text(offline_document(page.replace('<script>window.FISH=__FISH__;</script>\n', ''), 'FISH', off,
                                                           [OUT / 'nihonga-shader.js', OUT / 'preview-app.js']), encoding='utf8')
print(json.dumps({p.name: p.stat().st_size for p in sorted(OUT.rglob('*')) if p.is_file()}, ensure_ascii=False))
