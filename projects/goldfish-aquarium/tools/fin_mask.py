"""Per-vertex fin weight for the shared Tripo oranda mesh (one mesh: body + fins).
Thickness = distance along -normal to the opposite surface (ray cast). Thin (< ~3.5 mm at 12 cm) = fin.
Also: distance from the nearest body vertex (fin root distance), and fin kind (0 body,1 caudal,2 dorsal,3 pectoral,4 pelvic,5 anal).
usage: python tools/fin_mask.py <model.json> <out.npz>"""
import sys, json, numpy as np
d = json.load(open(sys.argv[1])); m = d['meshes'][0]
P = np.array(m['p']).reshape(-1, 3); N = np.array(m['n']).reshape(-1, 3); I = np.array(m['i']).reshape(-1, 3)
A, B, C = P[I[:, 0]], P[I[:, 1]], P[I[:, 2]]; E1 = B - A; E2 = C - A
def cast(O, D):
    out = np.full(len(O), np.inf)
    for s in range(0, len(O), 150):
        o = O[s:s+150, None, :]; dd = D[s:s+150, None, :]
        pv = np.cross(dd, E2[None]); det = (E1[None] * pv).sum(-1)
        ok = np.abs(det) > 1e-12; inv = np.where(ok, 1 / np.where(ok, det, 1), 0)
        tv = o - A[None]; u = (tv * pv).sum(-1) * inv
        qv = np.cross(tv, E1[None]); v = (dd * qv).sum(-1) * inv; t = (E2[None] * qv).sum(-1) * inv
        hit = ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (t > 2e-4)
        out[s:s+150] = np.where(hit, t, np.inf).min(1)
    return out
Nn = N / (np.linalg.norm(N, axis=1, keepdims=True) + 1e-9)
th = cast(P - Nn * 1e-5, -Nn)
th = np.minimum(th, 0.05)
# smooth thickness over mesh neighbours
nb = [[] for _ in range(len(P))]
for a, b, c in I:
    nb[a] += [b, c]; nb[b] += [a, c]; nb[c] += [a, b]
# vertices at the same position (UV seams) share values
key = {}
grp = np.array([key.setdefault(tuple(np.round(p, 6)), len(key)) for p in P])
def smooth(x, it):
    for _ in range(it):
        x = np.array([(x[i] + x[nb[i]].mean()) / 2 if nb[i] else x[i] for i in range(len(x))])
        g = np.bincount(grp, x) / np.bincount(grp); x = g[grp]
    return x
th = smooth(th, 3)
thin = np.clip((0.0050 - th) / 0.0022, 0, 1)
# body envelope per x slice from thick vertices (body), ellipse in (y, z)
x, y, z = P.T
Bm = (th > 0.012) & (x < 0.022)
bins = np.linspace(-0.061, 0.061, 62); env = []
for i in range(len(bins) - 1):
    sel = Bm & (x >= bins[i] - 0.002) & (x < bins[i + 1] + 0.002)
    if sel.sum() < 6: env.append(None); continue
    yy, zz = y[sel], z[sel]
    y0, y1 = np.percentile(yy, [3, 97]); z0, z1 = np.percentile(zz, [3, 97])
    env.append(((y0 + y1) / 2, (z0 + z1) / 2, max((y1 - y0) / 2, 1e-3), max((z1 - z0) / 2, 1e-3)))
ed = np.full(len(P), 9.0)
for i, e in enumerate(env):
    if e is None: continue
    sel = (x >= bins[i]) & (x < bins[i + 1])
    cy, cz, ry, rz = e
    ed[sel] = np.sqrt(((y[sel] - cy) / ry) ** 2 + ((z[sel] - cz) / rz) ** 2)
outside = np.clip((ed - 1.05) / 0.25, 0, 1)
fin = np.maximum(thin, outside); fin[x < -0.042] = 0
fin = smooth(fin, 2)
# root distance: euclidean distance to nearest body vertex (fin < 0.2)
body = P[fin < 0.2]
rd = np.zeros(len(P))
for s in range(0, len(P), 500):
    rd[s:s+500] = np.sqrt(((P[s:s+500, None] - body[None]) ** 2).sum(-1)).min(1)
# kind by position: model head -x, dorsal +y, length 0.12 (x -0.06..0.06)
def kind_at(px, py):
    if px > 0.012: return 1
    if py > 0.012: return 2
    if px <= -0.02: return 3
    return 4 if px <= 0.0 else 5
# classify whole fin pieces (connected through fin vertices) by where their base attaches, not vertex by vertex
f = fin > 0.2
par = np.arange(len(P))
def find(i):
    while par[i] != i: par[i] = par[par[i]]; i = par[i]
    return i
for a_, b_, c_ in I:
    for u_, v_ in ((a_, b_), (b_, c_), (a_, c_)):
        if f[u_] and f[v_]: par[find(u_)] = find(v_)
for gidx in np.unique(grp):                      # vertices at the same position (UV seams) are one
    m = np.nonzero(grp == gidx)[0]
    if len(m) > 1 and f[m].all():
        for j in m[1:]: par[find(j)] = find(m[0])
comp = np.array([find(i) for i in range(len(P))])
kind = np.zeros(len(P), int)
for j in np.nonzero(f)[0]: kind[j] = kind_at(P[j, 0], P[j, 1])
for cpt in np.unique(comp[f]):
    m = np.nonzero((comp == cpt) & f)[0]
    base = m[np.argsort(rd[m])[:max(3, len(m) // 8)]]
    kb = np.bincount([kind_at(P[j, 0], P[j, 1]) for j in base], minlength=6).argmax()
    # a paired fin is a separate piece attached low on one side; its tip may reach back past the pelvic/anal border
    if kb in (3, 4) and len(m) < 500 and abs(P[m, 2].mean()) > 0.004:
        print('paired fin piece', kb, len(m), 'reassigned from', np.bincount(kind[m], minlength=6))
        kind[m] = kb
np.savez(sys.argv[2], fin=fin, root=rd, kind=kind, th=th)
print('fin verts', f.sum(), 'of', len(P), 'kinds', np.bincount(kind, minlength=6), 'bbox', P.min(0).round(3), P.max(0).round(3))
