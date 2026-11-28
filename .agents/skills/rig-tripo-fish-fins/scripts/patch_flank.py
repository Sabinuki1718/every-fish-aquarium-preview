"""Repaint the lower flank (behind the gill to before the pelvic fin) from the user's side images of the same fish drawn
without pectoral fins, so no fin is painted on the body where the real (moving) pectoral fin used to lie.
The image is fitted to the model's side silhouette (snout, body end and body height), projected orthographically on
the flank that faces it, colour-matched to the surrounding texture and blended in with a soft edge.
usage: python tools/patch_flank.py <in.glb> <oranda.json> <out.glb> <+z image> <-z image|mirror> [debug.png]"""
import sys, io, json, numpy as np
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter
sys.path.insert(0, str(Path(__file__).parent)); from glbio import read
from clean_fin_shadow import raster

def body_profile(mask):
    """columns of the body (thick part) of a side-view mask: returns (snout_x, end_x, centre_y, height) in pixels"""
    h = mask.sum(0).astype(float); xs = np.nonzero(h > 0)[0]
    big = h > 0.55 * h.max(); bx = np.nonzero(big)[0]
    col = bx[len(bx) // 2]; ys = np.nonzero(mask[:, col])[0]
    return xs, bx.min(), bx.max(), (ys.min() + ys.max()) / 2, ys.max() - ys.min()

def fit(msil, mask, S):
    """search scale and offset that best overlay the model silhouette on the image mask (IoU); returns (iou, scale, tx, ty)"""
    ys, xs = np.nonzero(mask); iw = xs.max() - xs.min(); my, mx = np.nonzero(msil); mw = mx.max() - mx.min()
    best = (0, 0, 0, 0); s0 = iw / mw * S
    small = 0.25; mk = Image.fromarray((mask * 255).astype(np.uint8)).resize((int(mask.shape[1] * small), int(mask.shape[0] * small)))
    M = np.asarray(mk) > 127
    for scale in np.linspace(s0 * 0.8, s0 * 1.15, 15):
        k = scale / S * small
        mm = Image.fromarray((msil * 255).astype(np.uint8)).resize((max(1, int(msil.shape[1] * k)), max(1, int(msil.shape[0] * k))))
        A = np.asarray(mm) > 127; ay, ax = np.nonzero(A)
        cx0 = xs.mean() * small - ax.mean(); cy0 = ys.mean() * small - ay.mean()
        for dx in range(-12, 13, 2):
            for dy in range(-10, 11, 2):
                ox_, oy_ = int(cx0 + dx), int(cy0 + dy)
                yy, xx = ay + oy_, ax + ox_; ok = (yy >= 0) & (yy < M.shape[0]) & (xx >= 0) & (xx < M.shape[1])
                inter = M[yy[ok], xx[ok]].sum(); iou = inter / (M.sum() + len(ay) - inter)
                if iou > best[0]: best = (iou, scale, ox_ / small, oy_ / small)
    return best

def smooth(e0, e1, x): t = np.clip((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)

def main(glb, js, out, img_pos, img_neg, dbg=None):
    g = read(glb); P, N, UV, I = g['P'], g['N'], g['UV'], g['I']
    d = json.load(open(js)); n0 = len(P); kind = np.array(d['k'])[:n0]; fin = np.array(d['f'])[:n0]
    tex = Image.open(io.BytesIO(next(iter(g['images'].values())))).convert('RGB'); T = tex.size[0]
    img = np.asarray(tex).astype(np.float32)
    tid, bc = raster(UV * T, I, T, T)
    m = tid >= 0; t = tid[m]; pos = np.einsum('nk,nkd->nd', bc[m], P[I[t]])
    nor = np.einsum('nk,nkd->nd', bc[m], N[I[t]]); nor /= np.linalg.norm(nor, axis=1, keepdims=True) + 1e-9
    finTri = np.isin(I, np.nonzero(kind > 0)[0]).any(1) | (fin[I].max(1) > 0.5)
    body = ~finTri[t]
    # model side silhouette (all triangles), 1500 px/m, head -x on the left, up +y
    S = 1500; ox, oy = 0.075, 0.06
    sil = Image.new('L', (int(0.15 * S), int(0.12 * S)), 0); dr = ImageDraw.Draw(sil)
    for tri in I: dr.polygon([((P[v, 0] + ox) * S, (oy - P[v, 1]) * S) for v in tri], fill=255)
    msil = (np.asarray(sil) > 0).astype(np.float32)
    cols = img[m]; newc = cols.copy(); wsum = np.zeros(len(pos))
    # flank band: behind the gill cover to before the pelvic fin, lower half of the side
    band = smooth(-0.042, -0.036, pos[:, 0]) * (1 - smooth(-0.004, 0.004, pos[:, 0])) * smooth(-0.026, -0.021, pos[:, 1]) * (1 - smooth(-0.002, 0.004, pos[:, 1]))
    for side, src in [(1, img_pos), (-1, img_neg)]:
        mirror = src == 'mirror'
        im = Image.open(img_pos if mirror else src).convert('RGB')
        if mirror: im = im.transpose(Image.FLIP_LEFT_RIGHT)
        a = np.asarray(im).astype(np.float32); mask = (255 - a.min(2)) > 18
        mask = np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.MedianFilter(5))) > 0
        if side < 0: mask_f = mask[:, ::-1]                          # seen from -z the head is on the right: flip to match
        else: mask_f = mask
        best = fit(msil, mask_f, S)
        scale, tx, ty = best[1:]                                        # image px per metre, model-mask px -> image px offsets
        sel = body & (np.sign(pos[:, 2]) == side) & (band > 0) & (nor[:, 2] * side > 0.25)
        q = pos[sel]
        mxp = (q[:, 0] + ox) * S; myp = (oy - q[:, 1]) * S                # model-mask px
        u = (mxp * scale / S) + tx; v = (myp * scale / S) + ty
        if side < 0: u = mask.shape[1] - 1 - u
        print('side', side, 'IoU', round(best[0], 3), 'scale', round(scale))
        ui = np.clip(u.astype(int), 0, a.shape[1] - 1); vi = np.clip(v.astype(int), 0, a.shape[0] - 1)
        ok = mask[vi, ui]
        samp = a[vi, ui]
        # colour match on the band's top rim, where the old texture is still right
        rim = sel.copy(); rim[sel] = (q[:, 1] > -0.006) & ok
        rimc_old = cols[rim]; rimc_new = samp[(q[:, 1] > -0.006) & ok]
        if len(rimc_old) > 50:
            samp = (samp - rimc_new.mean(0)) / (rimc_new.std(0) + 1) * rimc_old.std(0) + rimc_old.mean(0)
        wloc = band[sel] * ok * smooth(0.25, 0.5, nor[sel][:, 2] * side)
        idx = np.nonzero(sel)[0]
        newc[idx] = samp; wsum[idx] = wloc
    w = wsum[:, None]
    outi = img.copy(); outi[m] = cols * (1 - w) + newc * w
    res = Image.fromarray(np.clip(outi, 0, 255).astype(np.uint8))
    if dbg:
        dd = img.copy(); dd[m] = cols * (1 - w) + np.array([255, 0, 0]) * w; Image.fromarray(dd.astype(np.uint8)).save(dbg)
    buf = io.BytesIO(); res.save(buf, 'JPEG', quality=92)
    from glbwrite import to_glb
    UVc = UV[I].copy(); UVc[..., 1] = 1 - UVc[..., 1]
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    to_glb(P, I, UVc, N[I], buf.getvalue(), out)
    res.save(Path(out).with_name('texture.jpg'), quality=92)

if __name__ == '__main__':
    main(*sys.argv[1:])
