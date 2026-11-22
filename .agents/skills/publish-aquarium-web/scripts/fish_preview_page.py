"""Phone-friendly, shareable 3D preview of one fish GLB.

python fish_preview_page.py <model.glb> <out_dir> --title "青文魚 3Dモデル v1" [--desc "..."] [--name seibungyo]

Writes into <out_dir>:
  preview.html          page for the Claude Artifact viewer (fragment: no doctype) / any web server.
                        three.js r170 from jsDelivr; loads fish-json-loader.js and models/ next to it.
  fish-json-loader.js, models/<name>.json, models/<name>-1024.jpg
  preview-offline.html  one self-contained file for double-click (three.js and the model inlined)
Prints the supporting files to publish with preview.html.
"""
import argparse, json, shutil, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from web_bundle import write_fish_assets, online_three_loader, offline_document, data_uri, FISH_LOADER

PAGE = r'''<title>__TITLE__</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
/* One full-screen stage; title top-left, view buttons along the bottom edge. */
:root{--paper:#f3f2ec;--paper-2:#e7e6de;--ink:#22303d;--ink-soft:#5d6b78;--accent:#4f7f99;--line:#cfd3d2;
  --body:"Hiragino Sans","Yu Gothic",system-ui,sans-serif}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--paper:#171c22;--paper-2:#222a32;--ink:#e6e8e4;--ink-soft:#a3adb6;--accent:#8ea6bd;--line:#38424c;color-scheme:dark}}
:root[data-theme="dark"]{--paper:#171c22;--paper-2:#222a32;--ink:#e6e8e4;--ink-soft:#a3adb6;--accent:#8ea6bd;--line:#38424c;color-scheme:dark}
[hidden]{display:none!important}
html,body{height:100%}
body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--body);overflow:hidden}
.stage{position:relative;height:100%;background:radial-gradient(120% 90% at 50% 40%,var(--paper) 55%,var(--paper-2))}
canvas{display:block;width:100%;height:100%;touch-action:none}
header{position:absolute;top:calc(12px + env(safe-area-inset-top,0px));left:0;right:0;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));pointer-events:none;display:grid;gap:4px}
h1{font-weight:600;font-size:clamp(20px,5vw,26px);margin:0;text-wrap:balance}
.sub{margin:0;color:var(--ink-soft);font-size:13px;line-height:1.6;max-width:36em}
nav{position:absolute;left:0;right:0;bottom:0;padding:10px max(16px,env(safe-area-inset-right,0px)) calc(12px + env(safe-area-inset-bottom,0px)) max(16px,env(safe-area-inset-left,0px));display:flex;flex-wrap:wrap;gap:6px;justify-content:center}
button{font:500 14px var(--body);color:var(--ink);background:color-mix(in srgb,var(--paper) 82%,transparent);border:1px solid var(--line);border-radius:999px;padding:9px 14px;min-height:40px;cursor:pointer}
button[aria-pressed="true"]{border-color:var(--accent);color:var(--accent)}
button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
#status{position:absolute;inset:0;display:grid;place-items:center;color:var(--ink-soft);font-size:14px;pointer-events:none;padding-inline:16px;text-align:center}
</style>
<div class="stage">
  <canvas id="view" aria-label="__TITLE__"></canvas>
  <header><h1>__TITLE__</h1><p class="sub">__DESC__</p><p class="sub">1本指で回転・2本指で拡大と移動</p></header>
  <div id="status">読み込み中…</div>
  <nav>
    <button type="button" data-v="side">側面</button><button type="button" data-v="front">正面</button>
    <button type="button" data-v="top">上面</button><button type="button" data-v="bottom">下面</button>
    <button type="button" data-v="oblique">斜め</button><button type="button" id="spin" aria-pressed="false">自動回転</button>
  </nav>
</div>
<script>window.FISH=__FISH__;</script>
__SCRIPTS__
'''

APP = r'''(async () => {
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
try {
  const fish = await loadFishJSON(THREE, FISH.geometry, FISH.texture);
  const box = new THREE.Box3().setFromObject(fish), size = box.getSize(new THREE.Vector3()).length();
  fish.scale.setScalar(.13 / size); fish.position.sub(box.getCenter(new THREE.Vector3()).multiplyScalar(.13 / size));
  scene.add(fish); status.hidden = true;
} catch (e) { console.error(e); status.textContent = 'モデルを読み込めませんでした。再読み込みしてください。'; }
(function loop() { requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); })();
})();
'''


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('glb'); ap.add_argument('out_dir'); ap.add_argument('--title', required=True)
    ap.add_argument('--desc', default=''); ap.add_argument('--name')
    ap.add_argument('--texture-size', type=int, default=1024,
                    help='square JPEG size; 2048 for long, thin fish whose atlas is much wider than tall')
    a = ap.parse_args()
    out = Path(a.out_dir); out.mkdir(parents=True, exist_ok=True)
    name = a.name or Path(a.glb).stem
    urls = write_fish_assets(a.glb, out / 'models', name, sizes=(a.texture_size,))
    shutil.copy(FISH_LOADER, out / 'fish-json-loader.js')
    (out / 'preview-app.js').write_text(APP, encoding='utf8')
    page = PAGE.replace('__TITLE__', a.title).replace('__DESC__', a.desc)
    fish = {'geometry': 'models/' + urls['geometry'], 'texture': 'models/' + urls[str(a.texture_size)]}
    online = page.replace('__FISH__', json.dumps(fish)).replace('__SCRIPTS__', online_three_loader(['fish-json-loader.js', 'preview-app.js']))
    (out / 'preview.html').write_text(online, encoding='utf8')
    off_fish = {'geometry': data_uri(out / fish['geometry'], 'application/json'), 'texture': data_uri(out / fish['texture'])}
    offline = offline_document(page.replace('<script>window.FISH=__FISH__;</script>\n', ''), 'FISH', off_fish,
                               [out / 'fish-json-loader.js', out / 'preview-app.js'])
    (out / 'preview-offline.html').write_text(offline, encoding='utf8')
    files = ['fish-json-loader.js', 'preview-app.js', fish['geometry'], fish['texture']]
    print(json.dumps({'page': str(out / 'preview.html'), 'files': {f: str(out / f) for f in files},
                      'offline': str(out / 'preview-offline.html')}, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
