"""Assemble the 3D aquarium (step 5) from the approved layout (project.json -> layout version), fish models and textures.
Outputs in aquarium/:
  index.html             page for the Artifact viewer / a web server (three.js r170 from jsDelivr, files next to it)
  aquarium-offline.html  one self-contained file (three.js, scripts, models, textures inlined)
  app.js, lib.js, models/oranda.json (shared shape + fin attributes), models/<fish>-2048.jpg / -1024.jpg
usage: python tools/build_aquarium.py"""
import json, re, shutil, subprocess, sys, tempfile
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
AQ = ROOT / 'aquarium'
SK = ROOT.parents[1] / '.agents/skills'
sys.path.insert(0, str(SK / 'publish-aquarium-web/scripts'))
from web_bundle import write_fish_assets, online_three_loader, offline_document, data_uri


def lib_js():
    parts = []
    for f in ['build-aquarium-from-fish-model/assets/aquarium-state.mjs', 'build-aquarium-from-fish-model/assets/mobile-quality.mjs',
              'build-aquarium-from-fish-model/assets/fish-watch.mjs']:
        parts.append(re.sub(r'^export ', '', (SK / f).read_text(encoding='utf8'), flags=re.M))
    return ('/* From .agents/skills/build-aquarium-from-fish-model/assets (aquarium-state, mobile-quality, fish-watch). */\n(() => {\n'
            + '\n'.join(parts) + '\nwindow.AquariumLib = { createAquariumState, chooseAquariumQuality, aquariumDrawingSize, isTap, watchStart, followDelta, clampWatchCamera, nextWatchId };\n})();\n')


def main():
    L = json.load(open(ROOT / 'layout' / f"v{json.load(open(ROOT / 'project.json'))['layout']['version']}" / 'layout.json'))
    md = AQ / 'models'; md.mkdir(parents=True, exist_ok=True)
    for old in md.glob('*'):
        if old.name != 'stones.json': old.unlink()
    models, geo = {}, None
    for f in L['fish']:
        name = f['id'].removeprefix('fish-')
        # current model version: technical revision (texture fill fix) if present, else the layout's model
        sp = f['model'].split('/')[1]
        proj = next(s for s in json.load(open(ROOT / 'project.json'))['species'] if s['id'] == sp)
        model = proj['stages']['model'].get('technical_revision', {}).get('file', f['model'])
        u = write_fish_assets(ROOT / model, md, name)
        g = json.load(open(md / u['geometry'])); (md / u['geometry']).unlink()
        if geo is None: geo = g
        elif g['meshes'][0]['p'] != geo['meshes'][0]['p']: raise SystemExit('fish shapes differ: ' + name)
        models[f['id']] = {'standard': 'models/' + u['2048'], 'light': 'models/' + u['1024']}
    # fin attributes
    with tempfile.TemporaryDirectory() as td:
        (Path(td) / 'g.json').write_text(json.dumps(geo)); subprocess.run([sys.executable, '-I', str(ROOT / 'tools/fin_mask.py'), str(Path(td) / 'g.json'), str(Path(td) / 'f.npz')], check=True)
        fm = np.load(Path(td) / 'f.npz'); fin, root, kind, ed = fm['fin'], fm['root'], fm['kind'], fm['ed']
    sys.path.insert(0, str(ROOT / 'tools')); from fin_rig import rig
    R = rig(np.array(geo['meshes'][0]['p']).reshape(-1, 3), fin, root, kind, ed)
    for b in R['bones'][1:]: print('bone', b['name'], np.round(b['pos'], 4), 'axis', np.round(b['axis'], 2), 'len', round(b.get('len', 0), 4))
    m = geo['meshes'][0]; I = np.array(m['i']).reshape(-1, 3)
    # Tripo fused the paired fins to the body along their rear edge: those webbing triangles would stretch like threads
    # when the fin moves. Drop triangles that join a moving fin vertex to a fixed body vertex away from the fin's root.
    si_ = np.array(R['skinIndex']).reshape(-1, 4); sw_ = np.array(R['skinWeight']).reshape(-1, 4); Pm = np.array(m['p']).reshape(-1, 3)
    keep = np.ones(len(I), bool)
    for bi, b in enumerate(R['bones']):
        if not b['name'].endswith('_base'): continue
        w = sum(np.where(np.isin(si_[:, j], [bi, bi + 1]), sw_[:, j], 0) for j in range(4))
        tw = w[I]; mixed = (tw.max(1) > 0.5) & (tw.min(1) < 0.2)
        far = np.linalg.norm(Pm[I].mean(1) - np.array(b['pos']), axis=1) > 0.006
        keep &= ~(mixed & far); print('drop webbing', b['name'], int((mixed & far).sum()))
    I = I[keep]
    tf = (fin[I].max(1) >= 0.25) | (np.isin(I, np.nonzero((kind == 3) | (kind == 4))[0]).any(1))   # any triangle touching a fin is drawn as fin (two-sided)
    out = {'units': 'm', 'forward': '-x', 'up': '+y', 'p': m['p'], 'n': m['n'], 'uv': m['uv'],
           'f': [round(float(v), 3) for v in fin], 'r': [round(float(v), 5) for v in root], 'k': [int(v) for v in kind],
           'iBody': I[~tf].ravel().tolist(), 'iFin': I[tf].ravel().tolist(),
           'bones': R['bones'], 'skinIndex': R['skinIndex'], 'skinWeight': R['skinWeight']}
    (md / 'oranda.json').write_text(json.dumps(out, separators=(',', ':')), encoding='utf8')
    textures = {n: f'textures/{n}.jpg' for n in ['background', 'gravel-oiso', 'gravel-oiso-n', 'gravel-oiso-h', 'gravel-side', 'stone-tripo', 'stone-tripo-n', 'stone-tripo-rm']}
    (AQ / 'lib.js').write_text(lib_js(), encoding='utf8')
    shutil.copy(AQ / 'src' / 'app.js', AQ / 'app.js')
    page = (AQ / 'src' / 'page.html').read_text(encoding='utf8')
    assets = {'layout': L, 'geometry': 'models/oranda.json', 'stones': 'models/stones.json', 'models': models, 'textures': textures}
    online = page.replace('__SCRIPTS__', '<script>window.AQUARIUM_ASSETS=' + json.dumps(assets, ensure_ascii=False) + ';</script>\n'
                          + online_three_loader(['lib.js', 'app.js']))
    (AQ / 'index.html').write_text(online, encoding='utf8')
    off = {'layout': L, 'geometry': data_uri(md / 'oranda.json', 'application/json'), 'stones': data_uri(md / 'stones.json', 'application/json'),
           'textures': {k: data_uri(AQ / v) for k, v in textures.items()},
           'models': {k: {'standard': data_uri(AQ / v['standard'])} for k, v in models.items()}}
    for v in off['models'].values(): v['light'] = v['standard']
    (AQ / 'aquarium-offline.html').write_text(offline_document(page, 'AQUARIUM_ASSETS', off, [AQ / 'lib.js', AQ / 'app.js']), encoding='utf8')
    for p in ['index.html', 'aquarium-offline.html']:
        print(p, f"{(AQ / p).stat().st_size / 1e6:.2f} MB")


if __name__ == '__main__':
    main()
