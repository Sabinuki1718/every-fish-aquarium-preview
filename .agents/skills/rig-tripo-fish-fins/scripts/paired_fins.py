"""Post-process a rigged single-mesh fish (Tripo export) so the paired fins move cleanly:
  1. adopt_scraps: small membrane pieces next to a pectoral/pelvic fin that the thickness test missed are given the
     fin's bone weights (otherwise they stay behind as floating white fragments).
  2. detach_webbing: triangles that join a moving fin vertex to a fixed body vertex away from the fin root are kept
     (some are real membrane) but their body-side corners are duplicated and the copies follow the fin bones.
Deleting those triangles instead leaves the fin in tatters - do not.
usage (in a build script):
    m, I, fin, root, kind, R = finalize_paired_fins(m, I, fin, root, kind, R)
    m: {'p','n','uv'} flat lists; I: (T,3) indices; fin/root/kind: per-vertex arrays from fin_mask.py; R: rig() output."""
import numpy as np

def finalize_paired_fins(m, I, fin, root, kind, R):
    I = I.copy(); fin = np.array(fin, float).copy(); root = np.array(root, float).copy(); kind = np.array(kind).copy()
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
    return m, I, fin, root, kind, R
