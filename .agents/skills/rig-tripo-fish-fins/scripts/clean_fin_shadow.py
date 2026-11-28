"""Repaint the body skin that lay under the paired fins in the texture (Tripo/photo bakes painted the fin onto the body
where the fin was pressed against it, so a moving fin left a 'drawn' fin behind).
For every body texel close to a pectoral/pelvic fin, copy the colour of the body skin a little higher up on the same
flank (clone stamp along the body), with a soft edge.
usage: python tools/clean_fin_shadow.py <in.glb> <aquarium/models/oranda.json> <out.glb> [debug.png]"""
import sys, io, json, struct, numpy as np
from pathlib import Path
from PIL import Image, ImageFilter
sys.path.insert(0, str(Path(__file__).parent)); from glbio import read

def raster(P2, F, W, H):
    tid = np.full((H, W), -1, np.int32); bc = np.zeros((H, W, 3), np.float32)
    for t, (a, b, c) in enumerate(F):
        pa, pb, pc = P2[a], P2[b], P2[c]
        x0 = int(max(0, np.floor(min(pa[0], pb[0], pc[0])))); x1 = int(min(W - 1, np.ceil(max(pa[0], pb[0], pc[0]))))
        y0 = int(max(0, np.floor(min(pa[1], pb[1], pc[1])))); y1 = int(min(H - 1, np.ceil(max(pa[1], pb[1], pc[1]))))
        if x1 < x0 or y1 < y0: continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        d = (pb[1] - pc[1]) * (pa[0] - pc[0]) + (pc[0] - pb[0]) * (pa[1] - pc[1])
        if abs(d) < 1e-12: continue
        l0 = ((pb[1] - pc[1]) * (xs - pc[0]) + (pc[0] - pb[0]) * (ys - pc[1])) / d
        l1 = ((pc[1] - pa[1]) * (xs - pc[0]) + (pa[0] - pc[0]) * (ys - pc[1])) / d
        l2 = 1 - l0 - l1; ins = (l0 >= -1e-3) & (l1 >= -1e-3) & (l2 >= -1e-3)
        sy, sx = np.nonzero(ins); tid[sy + y0, sx + x0] = t; bc[sy + y0, sx + x0] = np.stack([l0[ins], l1[ins], l2[ins]], 1)
    return tid, bc

def main(glb, js, out, dbg=None):
    g = read(glb); P, UV, I = g['P'], g['UV'], g['I']
    d = json.load(open(js)); n0 = len(P); kind = np.array(d['k'])[:n0]
    tex = Image.open(io.BytesIO(next(iter(g['images'].values())))).convert('RGB'); T = tex.size[0]
    img = np.asarray(tex).astype(np.float32)
    tid, bc = raster(UV * T, I, T, T)
    m = tid >= 0; t = tid[m]; pos = np.einsum('nk,nkd->nd', bc[m], P[I[t]])
    finTri = np.isin(I, np.nonzero((kind == 3) | (kind == 4))[0]).any(1) | (np.array(d['f'])[:n0][I].max(1) > 0.5)
    body = ~finTri[t]
    region = np.zeros(len(pos), bool); src = np.zeros((len(pos), 3))
    for k, shift in [(3, np.array([0.002, 0.012, 0.0])), (4, np.array([0.0, 0.009, 0.0]))]:
        for side in (1, -1):
            sel = (kind == k) & (np.sign(P[:, 2]) == side)
            ft = I[np.isin(I, np.nonzero(sel)[0]).all(1)]                       # fin triangles: sample their surface densely
            ww = np.random.default_rng(0).dirichlet([1, 1, 1], 12)
            fv = np.concatenate([P[sel], np.einsum('sk,tkd->tsd', ww, P[ft]).reshape(-1, 3)])
            if len(fv) < 5: continue
            near = np.full(len(pos), 9.0)
            cand = np.nonzero(body & (np.sign(pos[:, 2]) == side) & (np.abs(pos - fv.mean(0)).max(1) < 0.03))[0]
            for s0 in range(0, len(cand), 4000):
                c = cand[s0:s0 + 4000]; near[c] = np.sqrt(((pos[c, None] - fv[None]) ** 2).sum(-1)).min(1)
            r = near < 0.0042; region |= r; src[r] = pos[r] + shift * np.array([1, 1, side if shift[2] else 1])
    print('region texels', int(region.sum()))
    # nearest non-region body texel to each source point (grid hash)
    pool = np.nonzero(body & ~region)[0]; cell = 0.0008
    key = lambda q: np.floor(q / cell).astype(np.int64)
    kp = key(pos[pool]); h = {}
    for i, kk in zip(pool, map(tuple, kp)): h.setdefault(kk, []).append(i)
    cols = img[m]; newc = cols.copy()
    for i in np.nonzero(region)[0]:
        q = src[i]; kq = key(q); best = None; bd = 9
        for dx in (-2, -1, 0, 1, 2):
            for dy in (-2, -1, 0, 1, 2):
                for dz in (-2, -1, 0, 1, 2):
                    for j in h.get((kq[0] + dx, kq[1] + dy, kq[2] + dz), ()):
                        dd = ((pos[j] - q) ** 2).sum()
                        if dd < bd: bd, best = dd, j
        if best is not None: newc[i] = cols[best]
    # soft edge: weight by distance into the region (blur the mask in texture space)
    mask = np.zeros((T, T), np.float32); mask[m] = region
    soft = np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(2.5))).astype(np.float32) / 255
    soft = np.maximum(soft, mask * 0.85)[m][:, None]
    out_img = img.copy(); out_img[m] = cols * (1 - soft) + newc * soft
    res = Image.fromarray(np.clip(out_img, 0, 255).astype(np.uint8))
    if dbg:
        dd = img.copy(); dd[m] = np.where(region[:, None], [255, 0, 0], cols); Image.fromarray(dd.astype(np.uint8)).save(dbg)
    # write the glb with the new texture (same geometry)
    buf = io.BytesIO(); res.save(buf, 'JPEG', quality=92)
    from glbwrite import to_glb
    UVc = UV[I].copy(); UVc[..., 1] = 1 - UVc[..., 1]
    to_glb(P, I, UVc, g['N'][I], buf.getvalue(), out)
    res.save(Path(out).with_name('texture.jpg'), quality=92)

if __name__ == '__main__':
    main(*sys.argv[1:])
