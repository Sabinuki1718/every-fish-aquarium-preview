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
    # Small membrane scraps next to a paired fin that the thickness test missed would stay behind as floating white
    # fragments: adopt them into the fin (weights copied from the neighbouring fin vertex).
    _P = np.array(m['p']).reshape(-1, 3); _si = np.array(R['skinIndex']).reshape(-1, 4); _sw = np.array(R['skinWeight']).reshape(-1, 4)
    _key = np.unique(np.round(_P, 6), axis=0, return_inverse=True)[1].ravel()
    for bi, b in enumerate(R['bones']):
        if not b['name'].endswith('_base'): continue
        piv = np.array(b['pos']); kk = 3 if b['name'].startswith('pectoral') else 4
        w = sum(np.where(np.isin(_si[:, j], [bi, bi + 1]), _sw[:, j], 0) for j in range(4))
        wk = np.zeros(_key.max() + 1); np.maximum.at(wk, _key, w)
        cen = _P[I].mean(1)
        still = (wk[_key[I]].max(1) < 0.05) & (np.linalg.norm(cen - piv, axis=1) < 1.3 * b['len']) & (np.sign(cen[:, 2]) == np.sign(piv[2]))
        T = np.nonzero(still)[0]; par = {}
        def fd(x):
            par.setdefault(x, x)
            while par[x] != x: par[x] = par[par[x]]; x = par[x]
            return x
        for ti in T:
            a_, b_, c_ = _key[I[ti]]; r_ = fd(a_); par[fd(b_)] = r_; par[fd(c_)] = r_
        comps = {}
        for ti in T: comps.setdefault(fd(_key[I[ti, 0]]), []).append(ti)
        for tris in comps.values():
            if len(tris) > 30: continue                               # the body itself
            vs = np.unique(I[tris].ravel())
            src = np.nonzero(w > 0.5)[0]
            gap = min(np.linalg.norm(_P[src] - _P[v], axis=1).min() for v in vs)
            if gap > 0.0025: continue                                  # not next to the fin
            for v in vs:
                n_ = src[np.argmin(np.linalg.norm(_P[src] - _P[v], axis=1))]
                _si[v] = _si[n_]; _sw[v] = _sw[n_]; fin[v] = 1.0; kind[v] = kk
            print('adopted scrap', b['name'], len(tris), 'triangles')
    R['skinIndex'] = _si.ravel().tolist(); R['skinWeight'] = _sw.ravel().tolist()
    # Tripo fused the paired fins to the body along their rear edge. Those joining triangles would stretch like threads
    # when the fin moves, but some of them are real membrane, so they are kept: their body-side corners away from the
    # fin root are duplicated, and the copies move with the fin (the body keeps the originals, so its surface stays whole).
    Pm = np.array(m['p']).reshape(-1, 3); Nm = np.array(m['n']).reshape(-1, 3); UVm = np.array(m['uv']).reshape(-1, 2)
    si_ = np.array(R['skinIndex']).reshape(-1, 4); sw_ = np.array(R['skinWeight']).reshape(-1, 4)
    fin = fin.copy(); root = root.copy(); kind = kind.copy()
    add = {'p': [], 'n': [], 'uv': [], 'f': [], 'r': [], 'k': [], 'si': [], 'sw': []}
    for bi, b in enumerate(R['bones']):
        if not b['name'].endswith('_base'): continue
        piv = np.array(b['pos']); Lf = b['len']; kk = 3 if b['name'].startswith('pectoral') else 4
        w = sum(np.where(np.isin(si_[:, j], [bi, bi + 1]), sw_[:, j], 0) for j in range(4))
        w = np.concatenate([w, np.zeros(len(add['f']))])                 # copies made for other fins: not this bone
        Pall = np.concatenate([Pm, np.array(add['p']).reshape(-1, 3)])
        tw = w[I]; mixed = (tw.max(1) > 0.5) & (tw.min(1) < 0.2)
        far = np.linalg.norm(Pall[I].mean(1) - piv, axis=1) > 0.005
        copies = {}
        for ti in np.nonzero(mixed & far)[0]:
            for c in range(3):
                v = I[ti, c]
                if w[v] >= 0.5: continue
                if v not in copies:
                    copies[v] = len(Pm) + len(add['f'])
                    d = np.linalg.norm(Pm[v] - piv); wt = min(1, max(0, (d - 0.2 * Lf) / (0.8 * Lf))) ** 1.2
                    add['p'].append(Pm[v]); add['n'].append(Nm[v]); add['uv'].append(UVm[v]); add['f'].append(1.0); add['r'].append(d); add['k'].append(kk)
                    add['si'].append([0, bi, bi + 1, 0]); add['sw'].append([0, 1 - wt, wt, 0])
                I[ti, c] = copies[v]
        print('detached', b['name'], int((mixed & far).sum()), 'triangles,', len(copies), 'vertices copied')
    if add['p']:
        m['p'] = np.concatenate([Pm, np.array(add['p'])]).round(6).ravel().tolist(); m['n'] = np.concatenate([Nm, np.array(add['n'])]).round(4).ravel().tolist()
        m['uv'] = np.concatenate([UVm, np.array(add['uv'])]).round(6).ravel().tolist()
        fin = np.concatenate([fin, add['f']]); root = np.concatenate([root, add['r']]); kind = np.concatenate([kind, add['k']])
        R['skinIndex'] = np.concatenate([si_, np.array(add['si'])]).ravel().tolist(); R['skinWeight'] = np.concatenate([sw_, np.array(add['sw'])]).round(4).ravel().tolist()
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
    assets = {'layout': L, 'geometry': 'models/oranda.json', 'stones': 'models/stones.json', 'models': models, 'textures': textures, 'audio': {'bgm': 'audio/bgm.mp3'}}
    online = page.replace('__SCRIPTS__', '<script>window.AQUARIUM_ASSETS=' + json.dumps(assets, ensure_ascii=False) + ';</script>\n'
                          + online_three_loader(['lib.js', 'app.js']))
    (AQ / 'index.html').write_text(online, encoding='utf8')
    off = {'layout': L, 'audio': {'bgm': data_uri(AQ / 'audio/bgm.mp3', 'audio/mpeg')}, 'geometry': data_uri(md / 'oranda.json', 'application/json'), 'stones': data_uri(md / 'stones.json', 'application/json'),
           'textures': {k: data_uri(AQ / v) for k, v in textures.items()},
           'models': {k: {'standard': data_uri(AQ / v['standard'])} for k, v in models.items()}}
    for v in off['models'].values(): v['light'] = v['standard']
    (AQ / 'aquarium-offline.html').write_text(offline_document(page, 'AQUARIUM_ASSETS', off, [AQ / 'lib.js', AQ / 'app.js']), encoding='utf8')
    for p in ['index.html', 'aquarium-offline.html']:
        print(p, f"{(AQ / p).stat().st_size / 1e6:.2f} MB")


if __name__ == '__main__':
    main()
