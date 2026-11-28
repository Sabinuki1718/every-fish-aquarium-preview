"""Skeleton for the paired fins of the shared oranda mesh: one root bone (body) and, for each pectoral / pelvic fin
(left, right), a base bone at the fin's attachment and a tip bone halfway out, so the fin swings about its root like a
real fin ray fan instead of the membrane wobbling.
rig(P, fin, root, kind) -> dict(bones=[{name,parent,pos(in parent space),axis(fish space)}], skinIndex, skinWeight)"""
import numpy as np

def _ss(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)

def rig(P, fin, root, kind):
    n = len(P)
    si = np.zeros((n, 4), int); sw = np.zeros((n, 4)); sw[:, 0] = 1          # bone 0 = root (body)
    bones = [{'name': 'root', 'parent': -1, 'pos': [0, 0, 0], 'axis': [0, 0, 1]}]
    for k, label in [(3, 'pectoral'), (4, 'pelvic')]:
        for side, sname in [(1, 'L'), (-1, 'R')]:            # +z = fish's left (head -x, dorsal +y)
            sel = (kind == k) & (np.sign(P[:, 2]) == side) & (fin > 0.2)
            if sel.sum() < 8: continue
            r = root[sel]; L = r.max()
            base_pts = P[sel][r < max(0.0012, np.percentile(r, 12))]
            pivot = base_pts.mean(0)
            tipc = P[sel][r > 0.6 * L].mean(0)
            out = tipc - pivot; out /= np.linalg.norm(out)
            # hinge axis = the attachment line (principal direction of the base points), oriented consistently
            if len(base_pts) >= 3:
                c = base_pts - base_pts.mean(0); _, _, vt = np.linalg.svd(c, full_matrices=False); hinge = vt[0]
            else:
                hinge = np.array([1.0, 0, 0])
            hinge -= out * hinge.dot(out); hinge /= np.linalg.norm(hinge)
            if hinge[0] < 0: hinge = -hinge
            mid = pivot + out * 0.5 * L
            b_base = len(bones); bones.append({'name': f'{label}_{sname}_base', 'parent': 0, 'pos': pivot.tolist(), 'axis': hinge.tolist(), 'out': out.tolist(), 'len': float(L)})
            b_tip = len(bones); bones.append({'name': f'{label}_{sname}_tip', 'parent': b_base, 'pos': (mid - pivot).tolist(), 'axis': hinge.tolist()})
            idx = np.nonzero(sel)[0]
            # weights: soft hinge at the root (0..1.5 mm), the outer half bends further with the tip bone
            w_on = _ss(0.0, 0.0015, root[idx]) * np.clip(fin[idx] * 1.4, 0, 1)
            w_tip = np.clip((root[idx] - 0.15 * L) / (0.85 * L), 0, 1) ** 1.3 * w_on      # long, gradual ramp: bends, never creases
            w_base = w_on - w_tip
            si[idx] = np.stack([np.zeros(len(idx), int), np.full(len(idx), b_base), np.full(len(idx), b_tip), np.zeros(len(idx), int)], 1)
            sw[idx] = np.stack([1 - w_on, w_base, w_tip, np.zeros(len(idx))], 1)
    return {'bones': bones, 'skinIndex': si.ravel().tolist(), 'skinWeight': [round(float(v), 4) for v in sw.ravel()]}
