"""Skeleton for the paired fins of the shared oranda mesh: a root bone (body) and, for each pectoral / pelvic fin
(left, right), a base bone at the fin's real attachment and a tip bone halfway out.
The Tripo fins lie pressed against the body, so "distance to the body" is ~0 along the whole inner edge; weights are
therefore taken from the straight distance to the attachment point (the front end of the fin, nearest the body axis),
so the whole membrane, inner edge included, follows the bones.
rig(P, fin, root, kind, ed) -> dict(bones=[{name,parent,pos,axis,out,len}], skinIndex, skinWeight)"""
import numpy as np

def _ss(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)

def rig(P, fin, root, kind, ed=None):
    n = len(P)
    si = np.zeros((n, 4), int); sw = np.zeros((n, 4)); sw[:, 0] = 1
    bones = [{'name': 'root', 'parent': -1, 'pos': [0, 0, 0], 'axis': [0, 0, 1]}]
    for k, label in [(3, 'pectoral'), (4, 'pelvic')]:
        for side, sname in [(1, 'L'), (-1, 'R')]:
            sel = (kind == k) & (np.sign(P[:, 2]) == side) & (fin > 0.2)
            if sel.sum() < 8: continue
            Q = P[sel]
            # attachment: the front end of the fin among its most body-hugging vertices
            inner = Q[(ed[sel] if ed is not None else root[sel]) <= np.percentile(ed[sel] if ed is not None else root[sel], 35)]
            front = inner[inner[:, 0] <= inner[:, 0].min() + 0.003]
            pivot = front.mean(0)
            dist = np.linalg.norm(Q - pivot, axis=1); L = dist.max()
            tipc = Q[dist > 0.65 * L].mean(0)
            out = tipc - pivot; out /= np.linalg.norm(out)
            c = Q - Q.mean(0); _, _, vt = np.linalg.svd(c, full_matrices=False); nrm = vt[2]       # fin plane normal
            nrm -= out * nrm.dot(out); nrm /= np.linalg.norm(nrm)
            hinge = np.cross(nrm, out); hinge /= np.linalg.norm(hinge)
            if hinge[0] < 0: hinge = -hinge
            mid = pivot + out * 0.5 * L
            b_base = len(bones); bones.append({'name': f'{label}_{sname}_base', 'parent': 0, 'pos': pivot.tolist(), 'axis': hinge.tolist(), 'out': out.tolist(), 'len': float(L)})
            b_tip = len(bones); bones.append({'name': f'{label}_{sname}_tip', 'parent': b_base, 'pos': (mid - pivot).tolist(), 'axis': hinge.tolist()})
            # weights over all vertices near this fin (its piece plus the body skin right around the attachment)
            idx = np.nonzero(sel)[0]
            d_all = np.linalg.norm(P[idx] - pivot, axis=1)
            w_on = _ss(0.0006, 0.0035, d_all)          # every vertex of the fin piece follows fully past the root
            w_tip = np.clip((d_all - 0.2 * L) / (0.8 * L), 0, 1) ** 1.2 * w_on
            si[idx] = np.stack([np.zeros(len(idx), int), np.full(len(idx), b_base), np.full(len(idx), b_tip), np.zeros(len(idx), int)], 1)
            sw[idx] = np.stack([1 - w_on, w_on - w_tip, w_tip, np.zeros(len(idx))], 1)
    return {'bones': bones, 'skinIndex': si.ravel().tolist(), 'skinWeight': [round(float(v), 4) for v in sw.ravel()]}
