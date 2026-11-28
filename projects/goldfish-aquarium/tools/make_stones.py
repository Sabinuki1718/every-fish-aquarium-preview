"""Cut the user's Tripo rock set (stones/source/rock_set.glb: four separate rocks in a row) into four shapes,
simplify each by vertex clustering (positions clustered per grid cell, UVs per cell AND texture chart so the map
stays correct; seams share positions so no cracks), and write aquarium/models/stones.json + textures.
usage: python tools/make_stones.py [cell_size]"""
import sys, json, io, numpy as np
from pathlib import Path
from PIL import Image
sys.path.insert(0, str(Path(__file__).parent)); from glbio import read
ROOT = Path(__file__).resolve().parents[1]; OUT = ROOT / 'aquarium'
NAMES = ['tall', 'crouch', 'mound', 'slab']        # left to right in the Tripo prompt

def components(key, I, n):
    par = np.arange(n)
    def f(i):
        while par[i] != i: par[i] = par[par[i]]; i = par[i]
        return i
    for a, b, c in I:
        ra = f(a); par[f(b)] = ra; par[f(c)] = ra
    return np.array([f(i) for i in range(n)])

def simplify(P, N, UV, I, cell):
    pk = np.unique(np.round(P, 6), axis=0, return_inverse=True)[1].ravel()          # welded position id
    chart = components(np.arange(len(P)), I, len(P))                                 # texture chart (uv-split mesh)
    g = np.floor((P - P.min(0)) / cell).astype(np.int64)
    gid = np.unique(g, axis=0, return_inverse=True)[1].ravel()
    # position cluster = grid cell; output vertex = (cell, chart)
    ok = np.unique(np.stack([gid, chart], 1), axis=0, return_inverse=True)[1].ravel()
    nO = ok.max() + 1
    cnt_c = np.bincount(gid); posC = np.stack([np.bincount(gid, P[:, k]) / cnt_c for k in range(3)], 1)
    nrmC = np.stack([np.bincount(gid, N[:, k]) for k in range(3)], 1); nrmC /= np.linalg.norm(nrmC, axis=1, keepdims=True) + 1e-12
    cnt_o = np.bincount(ok); uvO = np.stack([np.bincount(ok, UV[:, k]) / cnt_o for k in range(2)], 1)
    cellOf = np.zeros(nO, np.int64); cellOf[ok] = gid
    T = ok[I]; keep = (T[:, 0] != T[:, 1]) & (T[:, 1] != T[:, 2]) & (T[:, 0] != T[:, 2])
    T = T[keep]
    # drop duplicate faces
    T = np.unique(np.sort(T, 1), axis=0, return_index=True)[1]; T = ok[I][keep][np.sort(T)]
    used = np.unique(T); remap = -np.ones(nO, np.int64); remap[used] = np.arange(len(used))
    return posC[cellOf[used]], nrmC[cellOf[used]], uvO[used], remap[T]

def main():
    cell = float(sys.argv[1]) if len(sys.argv) > 1 else 0.0045
    g = read(ROOT / 'stones/source/rock_set.glb'); P, N, UV, I = g['P'], g['N'], g['UV'], g['I']
    key = np.unique(np.round(P, 5), axis=0, return_inverse=True)[1].ravel()
    comp = components(key, key[I], key.max() + 1)[key]
    parts = sorted(np.unique(comp), key=lambda c: P[comp == c, 0].mean())
    shapes = {}
    for name, c in zip(NAMES, parts):
        tri = I[(comp[I[:, 0]] == c)]
        vs = np.unique(tri); m = -np.ones(len(P), np.int64); m[vs] = np.arange(len(vs))
        p, n, uv, t = P[vs], N[vs], UV[vs], m[tri]
        ctr = np.array([(p[:, 0].max() + p[:, 0].min()) / 2, p[:, 1].min(), (p[:, 2].max() + p[:, 2].min()) / 2])
        p = p - ctr                                                                     # base centre at the origin
        sp, sn, suv, st = simplify(p, n, uv, t, cell)
        size = (sp.max(0) - sp.min(0))
        print(name, 'tris', len(t), '->', len(st), 'size', size.round(3))
        shapes[name] = {'size': size.round(5).tolist(), 'p': np.round(sp, 5).ravel().tolist(), 'n': np.round(sn, 3).ravel().tolist(),
                        'uv': np.round(suv, 5).ravel().tolist(), 'i': st.ravel().tolist()}
    (OUT / 'models').mkdir(parents=True, exist_ok=True)
    (OUT / 'models/stones.json').write_text(json.dumps({'units': 'Tripo units; scaled per stone in the page', 'shapes': shapes}, separators=(',', ':')))
    ims = list(g['images'].values()); names = list(g['images'].keys())
    for nm, data in zip(names, ims):
        im = Image.open(io.BytesIO(data)); print(nm, im.size, im.mode)
        if 'basecolor' in nm: im.convert('RGB').resize((2048, 2048), Image.LANCZOS).save(OUT / 'textures/stone-tripo.jpg', quality=88)
        if 'normal' in nm: im.convert('RGB').resize((2048, 2048), Image.LANCZOS).save(OUT / 'textures/stone-tripo-n.jpg', quality=90)
        if '_rm' in nm: im.convert('RGB').resize((1024, 1024), Image.LANCZOS).save(OUT / 'textures/stone-tripo-rm.jpg', quality=88)
    print('json MB', round((OUT / 'models/stones.json').stat().st_size / 1e6, 2))

if __name__ == '__main__':
    main()
