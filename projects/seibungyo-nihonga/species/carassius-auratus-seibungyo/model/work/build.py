"""青文魚 (Carassius auratus, Seibungyo, blue oranda) — nihonga-style GLB from the approved views.

Views: side-color-v1 (ink-free colour, texture + outline), side-v1 (inked; only the painted eye is used),
top-v1 (body width, pectoral fins, tail spread), bottom-v1 (belly colour).
The user's nihonga shader draws the sumi ink outlines from the 3D silhouette at run time, so the
textures carry no baked ink contours.

Working units are side-view pixels (X right = tail, Y up, Z toward the side-view camera); the model
is scaled to 0.15 m total length at the end (provisional scale). Head-to-tail lies on the X axis
(the shader's brush strokes run along model X).

Animation (stored in the GLB as morph targets + one looping clip 'idle', 4.8 s):
  fins: two morph targets per fin ('wave_s', 'wave_c') driven by sin/cos -> a travelling wave
  mouth: lower jaw rotates down about the mouth corner (real split along the lips, dark cavity inside)
  gills: separate opercular flaps hinge outward over a dark gill band
The same drivers are written to the node extras so a page can drive the targets itself.
"""
from pathlib import Path
import io, json, math, struct, sys
import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
SKILL = HERE.parents[5] / '.agents/skills/build-fish-3d-from-views'
sys.path.insert(0, str(SKILL / 'scripts'))
from fish_mesh import (Mesh, triangulate, render, sample_bilinear, inpaint_region, dilate_mask,
                       check_atlas_islands, orient_closed, uv_collapse_report)

VERSION = sys.argv[1] if len(sys.argv) > 1 else 'v1'
OUT = HERE.parent / VERSION
L = json.load(open(HERE / 'landmarks.json'))
S, T, B = L['side'], L['top'], L['bottom']
load = lambda p: np.asarray(Image.open(HERE / p).convert('RGB')).astype(float)
side_img, ink_img, top_img, bot_img = load(S['image']), load(S['ink_image']), load(T['image']), load(B['image'])
TOTAL_LENGTH = 0.15


def interp(poly, x):
    p = np.asarray(poly, float)
    return np.interp(x, p[:, 0], p[:, 1])


def interp_y(poly, y):
    """x of a roughly vertical polyline at height y."""
    p = np.asarray(poly, float); o = np.argsort(p[:, 1])
    return np.interp(y, p[o, 1], p[o, 0])


def poly_mask(shape, poly, grow=0):
    m = Image.new('L', (shape[1], shape[0]), 0)
    ImageDraw.Draw(m).polygon([tuple(p) for p in poly], fill=255)
    m = np.asarray(m) > 0
    return dilate_mask(m, grow) if grow else m


# ---------- tone: the ink-free colour views came out darker than the approved inked side ----------
def body_lum(a, top, bot):
    m = np.zeros(a.shape[:2], bool)
    for x in range(260, 820, 4):
        m[int(interp(top, x)) + 6:int(interp(bot, x)) - 6, x] = True
    return (a[m] @ [.299, .587, .114]).mean()
lum_ink, lum_col = body_lum(ink_img, S['body_top'], S['body_bottom']), body_lum(side_img, S['body_top'], S['body_bottom'])
GAMMA = float(np.clip(math.log(lum_ink / 255) / math.log(lum_col / 255), .7, 1.0))
tone = lambda a: 255 * (np.clip(a, 0, 255) / 255) ** GAMMA
side_img, top_img, bot_img = tone(side_img), tone(top_img), tone(bot_img)

# ---------- view registration ----------
X0, X1 = float(S['snout_x']), float(S['peduncle_x'])
VIEW_X = {'top': (T['snout_x'], T['peduncle_x']), 'bottom': (B['snout_x'], B['peduncle_x'])}
K = {v: (X1 - X0) / (b - a) for v, (a, b) in VIEW_X.items()}   # view px -> side px
to_view_x = lambda view, x: VIEW_X[view][0] + (x - X0) / K[view]
from_view_x = lambda view, xv: X0 + (xv - VIEW_X[view][0]) * K[view]
TC = T['center_y']


def half_width(x):
    xt = to_view_x('top', x)
    return 0.5 * (interp(T['body_right'], xt) - interp(T['body_left'], xt)) * K['top']


def top_center(x):
    xt = to_view_x('top', x)
    return 0.5 * (interp(T['body_right'], xt) + interp(T['body_left'], xt))


def bottom_geom(x):
    xb = to_view_x('bottom', x)
    up, dn = interp(B['body_up'], xb), interp(B['body_down'], xb)
    return xb, 0.5 * (up + dn), 0.5 * (dn - up)


# ---------- body sections ----------
NS, SEG, POW = 72, 64, 2.15
u = np.linspace(0, 1, NS)
xs = X0 + 1.0 + (X1 - X0 - 1.0) * (1 - np.cos(u * math.pi)) / 2      # denser at snout and peduncle
ytop, ybot = interp(S['body_top'], xs), interp(S['body_bottom'], xs)
cy = -(ytop + ybot) / 2; hh = np.maximum((ybot - ytop) / 2, 1.5)
hw = np.maximum(half_width(xs), 1.5)
tip = np.clip((xs - X0) / 14.0, 0, 1) ** 0.5
hh = np.maximum(hh * np.maximum(tip, .12), 1.2); hw = np.maximum(hw * np.maximum(tip, .12), 1.2)


def body_z(xp, Yp):
    c, ry, rz = np.interp(xp, xs, cy), np.interp(xp, xs, hh), np.interp(xp, xs, hw)
    q = np.clip(np.abs(Yp - c) / ry, 0, 1)
    return rz * (1 - q ** POW) ** (1 / POW)


ATLAS_W, ATLAS_H = 2048, 2048
BODY = (0, 0, 2048, 1024)
SIDE_AT = (0, 1024)                               # whole colour side view (fins, gill flaps)
EYE_SRC = (S['eye'][0] - 40, S['eye'][1] - 40, S['eye'][0] + 40, S['eye'][1] + 40)   # inked eye
EYE_AT = (1424, 1040)
PEC_SRC = (430, 120, 545, 265)                    # top-view pectoral fin
PEC_AT = (1424, 1140)
DARK_AT = (1600, 1040, 1640, 1080)                # mouth cavity swatch
DARK = np.array([62, 50, 64.])
GILL_DARK = np.array([96, 62, 76.])


def body_uv(s, t):
    return ((s * (BODY[2] - 1) + .5) / ATLAS_W, ((t / (2 * math.pi)) * (BODY[3] - 1) + .5) / ATLAS_H)


side_uv = lambda px, py: ((SIDE_AT[0] + px) / ATLAS_W, (SIDE_AT[1] + py) / ATLAS_H)
eye_uv = lambda px, py: ((EYE_AT[0] + px - EYE_SRC[0]) / ATLAS_W, (EYE_AT[1] + py - EYE_SRC[1]) / ATLAS_H)
pec_uv = lambda px, py: ((PEC_AT[0] + px - PEC_SRC[0]) / ATLAS_W, (PEC_AT[1] + py - PEC_SRC[1]) / ATLAS_H)
dark_uv = ((DARK_AT[0] + DARK_AT[2]) / 2 / ATLAS_W, (DARK_AT[1] + DARK_AT[3]) / 2 / ATLAS_H)

# ---------- body mesh with a real lip split ----------
NT = SEG + 1
KM, KF = 20, SEG - 20                             # mouth line: t = 112.5 deg (near, +Z) / 247.5 deg (far)
MCX, MCY = S['mouth']['corner']
JC = int(np.argmax(xs >= MCX))                    # hinge ring at the mouth corner (not split)
tt = np.linspace(0, 2 * math.pi, NT)
cc, ss_ = np.cos(tt), np.sin(tt)
ey_ = np.sign(cc) * np.abs(cc) ** (2 / POW); ez_ = np.sign(ss_) * np.abs(ss_) ** (2 / POW)
P = []; UV = []
for j in range(NS):
    for k in range(NT):
        P.append((xs[j], cy[j] + ey_[k] * hh[j], ez_[k] * hw[j])); UV.append(body_uv(j / (NS - 1), tt[k]))
C0 = len(P); P.append(tuple(np.mean(P[0:NT - 1], axis=0))); UV.append(body_uv(0, 0))
C1 = len(P); P.append(tuple(np.mean(P[(NS - 1) * NT:NS * NT - 1], axis=0))); UV.append(body_uv(1, 0))
# the lip split follows the painted mouth line (tip -> corner) in the approved side view: on each ring in front of
# the corner, the near split vertex is the one whose side-view height is closest to the painted line (far side mirrored)
MTX, MTY = S['mouth']['tip']
def _line_y(x_): return MTY + (MCY - MTY) * float(np.clip((x_ - MTX) / max(MCX - MTX, 1), 0, 1))
KMJ = []
for j in range(JC):
    e_t = np.clip((-_line_y(xs[j]) - cy[j]) / hh[j], -.97, .97)
    KMJ.append(int(np.argmin(np.abs(ey_[:SEG // 2 + 1] - e_t))))
KMJ = np.maximum(KMJ, 2); KFJ = SEG - KMJ
def _lower_quad(j, k):
    if j >= JC: return False
    km = max(KMJ[j], KMJ[min(j + 1, JC - 1)]) if j + 1 < JC else KMJ[j]
    return km <= k < SEG - km
F = []; side = []
for j in range(NS - 1):
    for k in range(SEG):
        a = j * NT + k; b = a + NT; lw = _lower_quad(j, k)
        for f_ in ([a, a + 1, b], [a + 1, b + 1, b]): F.append(f_); side.append(lw)
for k in range(SEG):
    F.append([C0, k, k + 1][::-1]); side.append(bool(KMJ[0] <= k < KFJ[0]))
    F.append([C1, (NS - 1) * NT + k, (NS - 1) * NT + k + 1]); side.append(False)
used_lo = {v for f_, sd in zip(F, side) if sd for v in f_}; used_up = {v for f_, sd in zip(F, side) if not sd for v in f_}
dup = {}
for v in sorted(used_lo & used_up):
    dup[v] = len(P); P.append(P[v]); UV.append(UV[v])
F = [[dup.get(v, v) for v in f_] if sd else f_ for f_, sd in zip(F, side)]
C0L = dup.get(C0, C0)
body = Mesh('body', P, UV, orient_closed(np.asarray(P), F))
jaw_ids = sorted((used_lo - used_up) | set(dup.values()))
jaw_ids = [v for v in jaw_ids if v < len(P) and (v >= NS * NT or v // NT < JC or v in dup.values())]

# ---------- cleaned projections and the body bake ----------
circle = lambda x, y, r: [(x + r * math.cos(a), y + r * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 40, endpoint=False)]
side_clean = inpaint_region(side_img, poly_mask(side_img.shape[:2], S['pectoral_on_body'], 4)).astype(float)
side_clean = inpaint_region(side_clean, poly_mask(side_img.shape[:2], circle(*S['eye'][:2], S['eye'][2] + 8))).astype(float)
top_clean = top_img.copy()
for poly in T['inpaint'] + [circle(x, y, r + 5) for x, y, r in T['eyes']]:
    top_clean = inpaint_region(top_clean, poly_mask(top_img.shape[:2], poly, 3)).astype(float)
bot_clean = bot_img.copy()
for poly in B['inpaint']:
    bot_clean = inpaint_region(bot_clean, poly_mask(bot_img.shape[:2], poly, 3)).astype(float)
for n_, a_ in [('side', side_clean), ('top', top_clean), ('bottom', bot_clean)]:
    Image.fromarray(a_.astype(np.uint8)).save(HERE / f'{n_}-clean.png')

bw, bh = BODY[2], BODY[3]
ii, jj = np.meshgrid((np.arange(bw) + .5) / bw, (np.arange(bh) + .5) / bh)
s = ii; t = jj * 2 * math.pi
x = np.interp(s * (NS - 1), np.arange(NS), xs)
c_y, r_y, r_z = np.interp(x, xs, cy), np.interp(x, xs, hh), np.interp(x, xs, hw)
cs, sn = np.cos(t), np.sin(t)
Y = c_y + np.sign(cs) * np.abs(cs) ** (2 / POW) * r_y; Z = np.sign(sn) * np.abs(sn) ** (2 / POW) * r_z
ny, nz = cs / r_y, sn / r_z
nn = np.hypot(ny, nz); ny /= nn; nz /= nn
side_col = sample_bilinear(side_clean, x, -Y)
top_col = sample_bilinear(top_clean, to_view_x('top', x), top_center(x) + Z / K['top'])
xb, bc, bhw = bottom_geom(x)
bot_col = sample_bilinear(bot_clean, xb, bc - (Z / r_z) * bhw)
w_side = np.abs(nz) ** 2.2
snout = np.clip((x - X0) / 34.0, 0, 1) ** 1.5      # side projection only at the snout tip (no radial seam)
w_top = np.clip(ny, 0, None) ** 2.2 * snout
w_bot = np.clip(-ny, 0, None) ** 2.2 * snout
bake = (side_col * w_side[..., None] + top_col * w_top[..., None] + bot_col * w_bot[..., None]) / (w_side + w_top + w_bot + 1e-6)[..., None]
# dark gill band under the opercular flaps (only seen when they open)
yy = -Y
edge_x = interp_y(S['gill_edge'], yy)
g_in = np.clip((edge_x - 3 - x) / 6, 0, 1) * np.clip((x - (edge_x - 26)) / 8, 0, 1)
g_y = np.clip((yy - 330) / 12, 0, 1) * np.clip((496 - yy) / 12, 0, 1) * (np.abs(nz) > .25)
gband = (g_in * g_y)[..., None]
bake = bake * (1 - .9 * gband) + GILL_DARK * .9 * gband

atlas = np.full((ATLAS_H, ATLAS_W, 3), 240.0)
atlas[:bh, :bw] = bake
atlas[SIDE_AT[1]:SIDE_AT[1] + 768, SIDE_AT[0]:SIDE_AT[0] + 1376] = side_img
atlas[EYE_AT[1]:EYE_AT[1] + 80, EYE_AT[0]:EYE_AT[0] + 80] = ink_img[EYE_SRC[1]:EYE_SRC[3], EYE_SRC[0]:EYE_SRC[2]]
pc = top_img[PEC_SRC[1]:PEC_SRC[3], PEC_SRC[0]:PEC_SRC[2]]
atlas[PEC_AT[1]:PEC_AT[1] + pc.shape[0], PEC_AT[0]:PEC_AT[0] + pc.shape[1]] = pc
atlas[DARK_AT[1]:DARK_AT[3], DARK_AT[0]:DARK_AT[2]] = DARK
check_atlas_islands(ATLAS_W, ATLAS_H, [('body', BODY), ('side_source', (0, 1024, 1376, 1792)),
                                       ('eye_source', (EYE_AT[0], EYE_AT[1], EYE_AT[0] + 80, EYE_AT[1] + 80)),
                                       ('pectoral_source', (PEC_AT[0], PEC_AT[1], PEC_AT[0] + pc.shape[1], PEC_AT[1] + pc.shape[0])),
                                       ('dark_swatch', DARK_AT)])


# ---------- parts ----------
RIM_START = {}


def fin2(name, outline, point_fn, uv_fn, subdivisions=2):
    """fish_mesh.fin, also returning each vertex's outline coords and layer (for morph targets)."""
    pts = [tuple(v) for v in outline]; faces = triangulate(pts)
    for _ in range(subdivisions):
        cache = {}; out = []
        def mid(a, b):
            key = tuple(sorted((a, b)))
            if key not in cache:
                cache[key] = len(pts); pts.append(tuple((np.array(pts[a]) + pts[b]) / 2))
            return cache[key]
        for a, b, c in faces:
            ab, bc_, ca = mid(a, b), mid(b, c), mid(c, a)
            out.extend([[a, ab, ca], [ab, b, bc_], [ca, bc_, c], [ab, bc_, ca]])
        faces = out
    p = []; uv = []; prm = []; n = len(pts)
    for layer in [-1, 1]:
        for a, b in pts:
            p.append(point_fn(a, b, layer)); uv.append(uv_fn(a, b)); prm.append((a, b, layer))
    out = [list(f) for f in faces] + [[i + n for i in f[::-1]] for f in faces]
    edges = {}
    for f in faces:
        for a, b in zip(f, f[1:] + f[:1]):
            key = tuple(sorted((a, b)))
            edges[key] = None if key in edges else (a, b)
    for e in edges.values():
        if e is not None:
            a, b = e; out.extend([[b, a, a + n], [b, a + n, b + n]])
    RIM_START[name] = 2 * len(faces)                 # faces after this index are the rim band
    # explicit membrane normals: +N on one layer, -N on the other (rim vertices included). The ink contour then
    # always falls inside the rim band, so the fin outline does not break up or change weight while it waves.
    P_ = np.asarray(p, float); fu = np.asarray(faces)
    fn = np.cross(P_[n:][fu[:, 1]] - P_[n:][fu[:, 0]], P_[n:][fu[:, 2]] - P_[n:][fu[:, 0]])
    vn = np.zeros((n, 3))
    for k in range(3): np.add.at(vn, fu[:, k], fn)
    vn /= np.maximum(np.linalg.norm(vn, axis=1, keepdims=True), 1e-12)
    if (vn * (P_[n:] - P_[:n])).sum() < 0: vn = -vn            # +N points from the -1 layer to the +1 layer
    NV = np.concatenate([-vn, vn])
    return Mesh(name, p, uv, orient_closed(p, out), NV), np.asarray(prm, float)


meshes = [body]
targets = {}            # mesh name -> [(target name, delta array in side px)]
drivers = {}            # mesh name -> how the page / clip drives the targets
TH = 1.4                # half thickness of fin membranes (side px)


def wave_targets(prm, amp_dir, q, k):
    """Travelling wave: d(t) = amp * dir * sin(phi - k*q) = sin(phi)*S + cos(phi)*C."""
    S_ = amp_dir * np.cos(k * q)[:, None]; C_ = -amp_dir * np.sin(k * q)[:, None]
    return [('wave_s', S_), ('wave_c', C_)]


def wave(name, n, phase, whim=.25, whim_phase=0.):
    drivers[name] = {'kind': 'wave', 'targets': ['wave_s', 'wave_c'], 'cycles': n, 'phase': phase, 'whim': whim, 'whim_phase': whim_phase}


# ---------- fin outlines traced from the painted fins (the hand-placed polygons only bound the search) ----------
_paint = np.abs(np.asarray(Image.open(HERE / S['image']).convert('RGB')).astype(float) - 255).max(axis=2) > 10
_yy, _xx = np.mgrid[0:_paint.shape[0], 0:_paint.shape[1]]
_inside = (_xx >= X0) & (_xx <= X1) & (_yy > interp(S['body_top'], _xx)) & (_yy < interp(S['body_bottom'], _xx))


def _trace(mask):
    """Moore-neighbour boundary of the largest blob (clockwise in image coords)."""
    from collections import deque
    lab = np.zeros(mask.shape, int); best = None; cur = 0
    for sy, sx in zip(*np.nonzero(mask)):
        if lab[sy, sx]: continue
        cur += 1; q = deque([(sy, sx)]); lab[sy, sx] = cur; n = 0; start = (sy, sx)
        while q:
            y, x = q.popleft(); n += 1
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                Y_, X_ = y + dy, x + dx
                if 0 <= Y_ < mask.shape[0] and 0 <= X_ < mask.shape[1] and mask[Y_, X_] and not lab[Y_, X_]:
                    lab[Y_, X_] = cur; q.append((Y_, X_))
        if best is None or n > best[0]: best = (n, cur, start)
    m = lab == best[1]
    ys, xs_ = np.nonzero(m); i0 = np.lexsort((xs_, ys))[0]; s0 = (ys[i0], xs_[i0])
    nb = [(-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1)]
    pts = [s0]; p_ = s0; d_ = 6
    for _ in range(200000):
        for k in range(8):
            dd = (d_ + k) % 8; y, x = p_[0] + nb[dd][0], p_[1] + nb[dd][1]
            if 0 <= y < m.shape[0] and 0 <= x < m.shape[1] and m[y, x]:
                p_ = (y, x); d_ = (dd + 6) % 8; break
        if p_ == s0: break
        pts.append(p_)
    return np.array([(x, y) for y, x in pts], float)


def _rdp(pts, eps):
    if len(pts) < 3: return pts
    a, b = pts[0], pts[-1]; ab = b - a; L = np.hypot(*ab) or 1
    d = np.abs(ab[0] * (pts[:, 1] - a[1]) - ab[1] * (pts[:, 0] - a[0])) / L
    i = int(np.argmax(d))
    if d[i] > eps: return np.vstack([_rdp(pts[:i + 1], eps)[:-1], _rdp(pts[i:], eps)])
    return np.array([a, b])


def traced(poly, grow=18, minus=(), eps=2.2):
    """Painted fin silhouette near `poly`; the part inside the body keeps the hand polygon (embedded base)."""
    pm = poly_mask(_paint.shape, poly)
    m = (_paint & poly_mask(_paint.shape, poly, grow) & ~_inside) | (pm & _inside)
    for q in minus: m &= ~poly_mask(_paint.shape, q, 2)
    # close pinholes so the boundary is one loop
    m = dilate_mask(m, 2); m = ~dilate_mask(~m, 2)
    c = _trace(m)
    c = (c + np.roll(c, 1, 0) + np.roll(c, -1, 0)) / 3
    k = len(c) // 2
    out = np.vstack([_rdp(c[:k + 1], eps)[:-1], _rdp(np.vstack([c[k:], c[:1]]), eps)[:-1]])
    # v3: soften the feathered brush edge (Chaikin x2) so the ink pass does not find a corner at every tooth;
    # corners sharper than ~70 deg (lobe tips, notches) are kept as they are
    for _ in range(2):
        prv, nxt = np.roll(out, 1, 0), np.roll(out, -1, 0)
        a1, a2 = prv - out, nxt - out
        cosang = (a1 * a2).sum(1) / np.maximum(np.linalg.norm(a1, axis=1) * np.linalg.norm(a2, axis=1), 1e-9)
        sharp = cosang > -0.35
        q = .75 * out + .25 * nxt; r = .25 * out + .75 * nxt
        pts = []
        for i in range(len(out)):
            if sharp[i]: pts.append(out[i])
            else: pts.append(.5 * out[i] + .25 * prv[i] + .25 * nxt[i])
            pts += [q[i], r[i]] if not (sharp[i] or sharp[(i + 1) % len(out)]) else [ (out[i] + nxt[i]) / 2 ]
        out = np.asarray(pts)
    k = len(out) // 2
    out = np.vstack([_rdp(out[:k + 1], 1.2)[:-1], _rdp(np.vstack([out[k:], out[:1]]), 1.2)[:-1]])
    try:
        triangulate([tuple(p) for p in out]); return out.tolist()
    except ValueError:
        print('trace fallback', len(out)); return poly


DORSAL = traced(S['dorsal'])
CAUDAL = traced(S['caudal'])          # v3: the anal fin is no longer cut out of the lower lobe
PELVIC = traced(S['pelvic'])
print('traced points', len(DORSAL), len(CAUDAL), len(PELVIC))

# dorsal: upright on the midline, lateral sway growing toward the free edge
m, prm = fin2('dorsal', DORSAL, lambda a, b, l: (a, -b, l * TH), side_uv, subdivisions=1)
meshes.append(m)
h = np.clip((interp(S['body_top'], prm[:, 0]) - prm[:, 1]) / 200, 0, 1) ** 1.3
d = np.zeros((len(prm), 3)); d[:, 2] = 16 * h
targets['dorsal'] = wave_targets(prm, d, (prm[:, 0] - 528) / 314, 2.0); wave('dorsal', 2, 0.6, whim_phase=1.0)

# caudal: four-lobed tail as two halves; upper (long) lobes near the midline, lower lobes spread out (top view)
_cy = np.asarray(S['caudal'], float)[:, 1]
TAIL_Y0, TAIL_Y1 = _cy.min(), _cy.max()
env = np.asarray(T['tail_env_left'], float)
env_x = from_view_x('top', env[:, 0]); env_z = np.abs(env[:, 1] - TC) * K['top']
o = np.argsort(env_x)
zmax = lambda xp: np.interp(xp, env_x[o], np.maximum.accumulate(env_z[o]))
# v4: spread taken from the top view's tail silhouette. Outer envelope = half-width of the painted tail in the
# top view (held at its maximum behind the outer-lobe tips, where the side's lower lobe still continues);
# inner envelope = the long inner lobes near the midline (~110 px). Upper side lobes follow the inner
# envelope, lower lobes the outer one, blended by height in the side view.
_tm = np.abs(top_img - 255).max(axis=2) > 18
_ex = np.arange(840, 1261, 4.0); _eo = []
for _x in _ex:
    _c = np.nonzero(_tm[:, int(round(to_view_x('top', _x)))])[0]
    _eo.append((TC - _c.min()) * K['top'] if len(_c) else 0.0)
_eo = np.maximum.accumulate(np.asarray(_eo))
OUTER = lambda xp: np.interp(xp, _ex, _eo)
INNER = lambda xp: np.interp(xp, [840, 900, 1000, 1100, 1160, 1200, 1260], [8, 70, 125, 118, 88, 45, 35])
# v5: the two upper (inner) lobes are not joined along the dorsal edge: the top view shows them touching near
# the root and parting toward the tips (half-gap ~17 px at x 1117 -> ~46 px at x 1203)
GAP = lambda xp: np.interp(xp, [840, 1090, 1117, 1146, 1174, 1203, 1260], [1.5, 3, 17, 23, 34, 46, 58])
for sign, name in [(1, 'caudal_near'), (-1, 'caudal_far')]:
    def pt(a, b, l, sign=sign):
        tq = np.clip((b - TAIL_Y0) / (TAIL_Y1 - TAIL_Y0), 0, 1)
        root = np.clip((a - X1 + 15) / 40.0, 0, 1) ** 0.8
        g = np.clip((tq - .3) / .55, 0, 1); g = g * g * (3 - 2 * g)
        h = np.clip(tq / .42, 0, 1); h = h * (2 - h)          # inner lobes open from the dorsal midline toward the notch
        zz = 1.0 + GAP(a) + root * (INNER(a) * h + (OUTER(a) - INNER(a) - GAP(a)) * g)
        return (a, -b, sign * (zz + l * TH))
    m, prm = fin2(name, CAUDAL, pt, side_uv, subdivisions=1)
    meshes.append(m)
    r = np.clip((prm[:, 0] - 840) / 415, 0, 1)
    d = np.zeros((len(prm), 3)); d[:, 2] = 34 * r ** 1.5
    targets[name] = wave_targets(prm, d, r, 2.4); wave(name, 2, 0.0, whim_phase=2.0)

# pectoral pair: the approved side view draws a long fin lying back along the flank; the top view
# shows it spreading ~120 px beyond the body. Outline + texture from the side, swept back and outward.
PEC = np.asarray(S['pectoral_on_body'], float)
PEC_X0 = PEC[:, 0].min()
PEC_UP = PEC[:4]                                   # upper edge of the side outline (base -> tip)
for sign, name, ph in [(1, 'pectoral_near', 0.0), (-1, 'pectoral_far', 0.5)]:
    def pt(a, b, l, sign=sign):
        # tilted ~25 deg from horizontal: the side keeps its outline exactly, the top sees a broad fan
        zs = body_z(PEC_X0 + 4, -505.0) - 6
        wdt = max(b - interp(PEC_UP, a), 0)
        out = (a - PEC_X0) * math.tan(math.radians(22)) + wdt / math.tan(math.radians(25))
        return (a, -b + l * TH, sign * (zs + out))
    m, prm = fin2(name, PEC.tolist(), pt, side_uv)
    meshes.append(m)
    r = np.clip((prm[:, 0] - PEC_X0) / 175, 0, 1)
    d = np.zeros((len(prm), 3)); d[:, 1] = 16 * r ** 1.3; d[:, 2] = sign * 8 * r ** 1.3
    targets[name] = wave_targets(prm, d, r, 1.2); wave(name, 3, ph, whim=.3, whim_phase=.5)

# pelvic pair: v5 hangs mostly downward (~16 deg outward, user request); opens and closes
for sign, name in [(1, 'pelvic_near'), (-1, 'pelvic_far')]:
    def pt(a, b, l, sign=sign):
        drop = max(b - interp(S['body_bottom'], a), 0)
        return (a, -b, sign * (30 + drop * math.tan(math.radians(16)) + l * TH))
    m, prm = fin2(name, PELVIC, pt, side_uv, subdivisions=1)
    meshes.append(m)
    r = np.clip((prm[:, 1] - interp(S['body_bottom'], prm[:, 0])) / 160, 0, 1)
    d = np.zeros((len(prm), 3)); d[:, 2] = sign * 12 * r ** 1.2
    targets[name] = wave_targets(prm, d, r, 1.0); wave(name, 2, 1.3, whim_phase=3.0)

# anal pair: small, close to the midline, sway together
for sign, name in [(1, 'anal_near'), (-1, 'anal_far')]:
    def pt(a, b, l, sign=sign):
        drop = max(b - interp(S['body_bottom'], a), 0)
        return (a, -b, sign * (7 + drop * math.tan(math.radians(18)) + l * TH))
    m, prm = fin2(name, S['anal'], pt, side_uv)
    meshes.append(m)
    r = np.clip((prm[:, 1] - interp(S['body_bottom'], prm[:, 0])) / 120, 0, 1)
    d = np.zeros((len(prm), 3)); d[:, 2] = 9 * r
    targets[name] = wave_targets(prm, d, r, 1.0); wave(name, 2, 2.0, whim_phase=4.0)

# opercular flaps: thin shells hinged at the preopercle, diving into the body at the hinge
gh, ge = np.asarray(S['gill_hinge'], float), np.asarray(S['gill_edge'], float)
hinge_x = lambda yv: interp_y(gh, yv); gedge_x = lambda yv: interp_y(ge, yv)
gill_outline = gh.tolist() + ge[::-1].tolist()
GILL_ANGLE = math.radians(18)
for sign, name in [(1, 'gill_near'), (-1, 'gill_far')]:
    def pt(a, b, l, sign=sign):
        f = np.clip((a - hinge_x(b)) / max(gedge_x(b) - hinge_x(b), 1), 0, 1)
        off = -4 + 6.2 * f ** 0.7
        return (a, -b, sign * (body_z(a, -b) + off + l * 0.8))
    m, prm = fin2(name, gill_outline, pt, side_uv)
    meshes.append(m)
    dd = np.maximum(prm[:, 0] - hinge_x(prm[:, 1]), 0)
    d = np.zeros((len(prm), 3)); d[:, 2] = sign * dd * math.sin(GILL_ANGLE); d[:, 0] = -dd * (1 - math.cos(GILL_ANGLE))
    targets[name] = [('open', d)]
    drivers[name] = {'kind': 'pulse', 'targets': ['open'], 'cycles': 4, 'phase': -1.0}

# lower jaw: rotates down about the mouth corner; the dark cavity behind the lips shows through
alpha, beta = math.radians(36), 0.0                   # lower jaw 48 deg down (lifting the upper lip tore the snout)
pb = body.positions.astype(float)
d = np.zeros_like(pb)
jaw_set = set(jaw_ids)
upper_ids = []
# +alpha: the part in front of the hinge swings DOWN (world y is up)
for v, ang in [(v, alpha) for v in jaw_ids] + [(v, beta) for v in upper_ids if v not in jaw_set]:
    px, py = pb[v, 0] - MCX, pb[v, 1] + MCY               # hinge at the painted mouth corner
    w = float(np.clip((MCX - pb[v, 0]) / 10, 0, 1))
    a = ang * w
    # rotate about the mouth corner (a<0: down for the jaw, a>0: up for the upper lip), then protrude forward
    d[v, 0] = px * math.cos(a) - py * math.sin(a) - px - 1.5 * w
    d[v, 1] = px * math.sin(a) + py * math.cos(a) - py
targets['body'] = [('mouth_open', d)]
# gape lining: a thin dark strip along the lip line from the near mouth corner round the snout to the far corner.
# Its upper edge rides with the upper lip, its lower edge with the lower jaw, so the open mouth always shows a dark
# inside (the body's own inner faces would show skin). Closed, it is a 1.6 px sliver tucked 1.2 px under the skin.
_path = [(j * NT + KMJ[j], dup[j * NT + KMJ[j]]) for j in range(JC - 1, -1, -1) if j * NT + KMJ[j] in dup] + [(j * NT + KFJ[j], dup[j * NT + KFJ[j]]) for j in range(JC) if j * NT + KFJ[j] in dup]
_lp, _ld, _lf = [], [], []
for (vu, vl) in _path:
    for v_, sgn in ((vu, 1), (vl, -1)):
        q_ = pb[v_].copy(); ax = np.array([q_[0], np.interp(q_[0], xs, cy), 0.0]); r_ = q_ - ax; nr = np.linalg.norm(r_) or 1
        q_ = q_ - r_ / nr * 2.5 + [0, .6 * sgn, 0]
        _lp.append(q_); _ld.append(d[v_])
n_ = len(_path)
for i in range(n_ - 1):
    a_, b_, c_, e_ = 2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 3
    _lf += [[a_, b_, c_], [c_, b_, e_]]
lining = Mesh('mouth_lining', np.asarray(_lp), [dark_uv] * len(_lp), np.asarray(_lf))
meshes.append(lining)
targets['mouth_lining'] = [('mouth_open', np.asarray(_ld))]

drivers['body'] = {'kind': 'paku', 'targets': ['mouth_open'], 'cycles': 4, 'phase': 0.0}   # quick open, short hold, snap shut, rest


def ellipsoid(name, center, radii, uv_fn, nu=12, nv=24):
    c = np.asarray(center, float); r = np.asarray(radii, float)
    P = [c + [0, r[1], 0]]; UV = [uv_fn(0, 0)]
    for i in range(1, nu):
        th = math.pi * i / nu
        for j in range(nv):
            ph = 2 * math.pi * j / nv
            P.append(c + r * [math.sin(th) * math.cos(ph), math.cos(th), math.sin(th) * math.sin(ph)]); UV.append(uv_fn(i / nu, j / nv))
    P.append(c - [0, r[1], 0]); UV.append(uv_fn(1, 0))
    row = lambda i, j: 1 + (i - 1) * nv + j % nv
    F = [[0, row(1, j + 1), row(1, j)] for j in range(nv)]
    for i in range(1, nu - 1):
        for j in range(nv):
            F += [[row(i, j), row(i, j + 1), row(i + 1, j)], [row(i, j + 1), row(i + 1, j + 1), row(i + 1, j)]]
    last = len(P) - 1
    F += [[last, row(nu - 1, j), row(nu - 1, j + 1)] for j in range(nv)]
    return Mesh(name, [tuple(p) for p in P], UV, orient_closed(np.asarray(P), F))


_xc = X0 + 13; _hh, _hw, _cy = (float(np.interp(_xc, xs, a_)) for a_ in (hh, hw, cy))
_ly = -_line_y(_xc)                                                     # painted lip line height at _xc
meshes.append(ellipsoid('mouth_cavity', (_xc + 3, _ly + .18 * _hh, 0), (9, .32 * _hh, .66 * _hw), lambda a, b: dark_uv))   # v4: on the lip line, just inside the skin
# the cavity opens with the jaw: its lower half follows the lower lip down (same driver as the mouth)
_cav = meshes[-1]; _cp = _cav.positions.astype(float); _cc = _ly + .18 * _hh
_dc = np.zeros_like(_cp)
_low = np.clip((_cc - _cp[:, 1]) / (.32 * _hh), 0, 1)
_dc[:, 1] = -_low * np.clip((MCX - _cp[:, 0]), 0, None) * math.sin(alpha) * .9
_dc[:, 0] = -7.0 * np.clip((_cp[:, 0] - (_xc - 6)) / 18, .4, 1)                     # whole cavity slides forward into the gape
targets['mouth_cavity'] = [('mouth_open', _dc)]
drivers['mouth_cavity'] = dict(drivers['body'])
drivers['mouth_lining'] = dict(drivers['body'])

# wen (hood): a separate bumpy shell over the head, from the snout top back to the neck and down to the
# approved side's lower edge of the bumps (above the eye, behind it down to the gill cover).
# Its outer face sits 0.6 px proud of the body, so the head outline keeps the approved silhouette apart from
# the bumps; the inner face dives 6 px into the head. UVs reuse the body bake under each point.
WL = np.asarray(S['wen_lower'], float)
WX0, WX1 = WL[0, 0], WL[-1, 0]


def body_point(xp, tp):
    c_, r1, r2 = np.interp(xp, xs, cy), np.interp(xp, xs, hh), np.interp(xp, xs, hw)
    cc_, sn_ = np.cos(tp), np.sin(tp)
    return np.stack([np.broadcast_to(xp, np.shape(tp)), c_ + np.sign(cc_) * np.abs(cc_) ** (2 / POW) * r1,
                     np.sign(sn_) * np.abs(sn_) ** (2 / POW) * r2], -1)


def wen_t(xp):
    """Angle from the top (t=0) down to the wen's lower edge at side-px x (near side, +Z)."""
    c_, r1 = np.interp(xp, xs, cy), np.interp(xp, xs, hh)
    val = np.clip((-np.interp(xp, WL[:, 0], WL[:, 1]) - c_) / r1, -.95, .999)
    return np.arccos(np.sign(val) * np.abs(val) ** (POW / 2))


NU_W, NV_W = 46, 40
uu = np.linspace(0, 1, NU_W); vv = np.linspace(0, 1, NV_W)
wx = WX0 + (WX1 - WX0) * (1 - np.cos(uu * math.pi)) / 2
TU, TV = np.meshgrid(wx, vv, indexing='ij')
tb = wen_t(TU)
tw = tb * (1 - 2 * TV)                                       # +tb near side .. 0 top .. -tb far side
base = body_point(TU, tw)
eps = .5
nrm = np.cross(body_point(TU + eps, tw) - body_point(TU - eps, tw), body_point(TU, tw + .01) - body_point(TU, tw - .01))
nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
cen = np.stack([TU, np.interp(TU, xs, cy), np.zeros_like(TU)], -1)
nrm *= np.sign(((base - cen) * nrm).sum(-1, keepdims=True))   # outward
# lumpy bumps (fixed seed): clusters of small knobs like the painting, fading out at the wen edge
rng = np.random.default_rng(7)
arc_u = TU; arc_v = tw * np.interp(TU, xs, hh)                # rough surface coords in side px
bump = np.zeros_like(TU)
for _ in range(80):
    bu = rng.uniform(WX0 + 4, WX1 - 6); bv = rng.uniform(-1, 1) * wen_t(bu) * np.interp(bu, xs, hh); rr = rng.uniform(9, 16)
    bump = np.maximum(bump, np.clip(1 - ((arc_u - bu) ** 2 + (arc_v - bv) ** 2) / rr ** 2, 0, 1) ** 1.5 * rng.uniform(.6, 1))
edge = np.clip(np.minimum.reduce([TV, 1 - TV, uu[:, None] + 0 * TV, (1 - uu[:, None]) + 0 * TV]) / .12, 0, 1)
outer = base + nrm * (0.6 + 9.5 * bump * edge ** .7)[..., None]
inner = base - nrm * 6.0
s_body = np.interp(TU, xs, np.linspace(0, 1, NS))
uvw = np.stack(body_uv(s_body, np.abs(tw)), -1)            # mirror: no UV seam on the crown
idx = lambda i, j, layer: layer * NU_W * NV_W + i * NV_W + j
PW = np.concatenate([outer.reshape(-1, 3), inner.reshape(-1, 3)])
UW = np.concatenate([uvw.reshape(-1, 2), uvw.reshape(-1, 2)])
FW = []
for i in range(NU_W - 1):
    for j in range(NV_W - 1):
        for L_, flip in ((0, False), (1, True)):
            q = [[idx(i, j, L_), idx(i + 1, j, L_), idx(i, j + 1, L_)], [idx(i + 1, j, L_), idx(i + 1, j + 1, L_), idx(i, j + 1, L_)]]
            FW += [f[::-1] for f in q] if flip else q
ring = [(i, 0) for i in range(NU_W)] + [(NU_W - 1, j) for j in range(1, NV_W)] + [(i, NV_W - 1) for i in range(NU_W - 2, -1, -1)] + [(0, j) for j in range(NV_W - 2, 0, -1)]
for k in range(len(ring)):
    a, b = ring[k], ring[(k + 1) % len(ring)]
    FW += [[idx(*a, 0), idx(*a, 1), idx(*b, 0)], [idx(*b, 0), idx(*a, 1), idx(*b, 1)]]
NW = np.concatenate([nrm.reshape(-1, 3), -nrm.reshape(-1, 3)])   # smooth (pre-bump) normals: no tiny ink loops on each knob
meshes.append(Mesh('wen', PW, UW, orient_closed(PW, FW), NW))

# eyes: low domes in the wen-framed sockets, the inked painted eye projected on them
ex, ey, er = S['eye']
for sign, name in [(1, 'eye_near'), (-1, 'eye_far')]:
    nu, nv = 12, 32
    zc = body_z(ex, -ey) - 6
    PP = [(ex, -ey, sign * (zc + 16))]; UU = [eye_uv(ex, ey)]
    for i in range(1, nu + 1):
        th = (math.pi / 2) * i / nu
        for j in range(nv):
            ph = 2 * math.pi * j / nv; rr = er * 1.08 * math.sin(th)
            px, py = ex + rr * math.cos(ph), ey + rr * math.sin(ph)
            PP.append((px, -py, sign * (zc + 16 * math.cos(th)))); UU.append(eye_uv(px, py))
    PP.append((ex, -ey, sign * (zc - 2))); UU.append(eye_uv(ex, ey))
    FF = [[0, 1 + j, 1 + (j + 1) % nv] for j in range(nv)]
    for i in range(nu - 1):
        for j in range(nv):
            a_ = 1 + i * nv + j; b_ = 1 + i * nv + (j + 1) % nv
            FF += [[a_, a_ + nv, b_], [b_, a_ + nv, b_ + nv]]
    rim = 1 + (nu - 1) * nv; cen = len(PP) - 1
    FF += [[rim + j, cen, rim + (j + 1) % nv] for j in range(nv)]
    meshes.append(Mesh(name, PP, UU, orient_closed(np.asarray(PP), FF)))

# ---------- ink: which faces the shader may take contours from ----------
# Thin parts give strokes only from their rim band (a waving membrane seen near edge-on otherwise pops short
# strokes on and off = flicker). Tail root and the front of the gill flaps dive into the body: no stroke there.
contour = {}
NO_INK = {'mouth_lining', 'mouth_cavity', 'mouth_disc'}
for m_ in meshes:
    if m_.name not in RIM_START: continue
    P_ = m_.positions.astype(float); Fc = P_[m_.faces].mean(axis=1)
    keep = np.arange(len(m_.faces)) >= RIM_START[m_.name]
    if m_.name.startswith('caudal'):
        keep &= Fc[:, 0] >= 862
    if m_.name.startswith('gill'):
        fy = -Fc[:, 1]; fr = (Fc[:, 0] - hinge_x(fy)) / np.maximum(gedge_x(fy) - hinge_x(fy), 1)
        keep &= fr >= 0.55
    contour[m_.name] = np.nonzero(keep)[0].tolist()
for n_ in NO_INK: contour[n_] = [-1]                     # an index that matches no face: no ink at all

# ---------- scale to metres ----------
allp = np.concatenate([m_.positions for m_ in meshes]).astype(float)
center = (allp.min(axis=0) + allp.max(axis=0)) / 2
SCALE = TOTAL_LENGTH / np.ptp(allp[:, 0])
meshes = [Mesh(m_.name, (m_.positions - center) * SCALE, m_.uv, m_.faces, m_.normals) for m_ in meshes]
targets = {k: [(n, (dl * SCALE).astype('<f4')) for n, dl in v] for k, v in targets.items()}

# ink rules for nihonga-shader's contourFilter (model metres): no stroke where the part dives into the body
mx = lambda px_: float((px_ - center[0]) * SCALE); my = lambda py_: float((-py_ - center[1]) * SCALE)
ink = {n: {'skip_x_below': mx(862)} for n in ('caudal_near', 'caudal_far')}
_ys = np.linspace(318, 524, 24)
for n in ('gill_near', 'gill_far'):
    ink[n] = {'gill': [[my(v), mx(hinge_x(v)), mx(gedge_x(v))] for v in _ys], 'keep_from': 0.55}

# ---------- drivers -> weights (shared by the GLB clip and the page) ----------
DURATION = 4.8


def paku(p):
    """Goldfish gulp: open fast (ease-out), hold, snap shut (ease-in), rest closed. p in [0,1)."""
    p %= 1.0
    if p < .16: q = p / .16; return 1 - (1 - q) ** 2
    if p < .30: return 1.0
    if p < .42: q = (p - .30) / .12; return 1 - q * q
    return 0.0


def weights_at(dv, t_):
    ph = 2 * math.pi * dv['cycles'] * t_ / DURATION + dv['phase']
    if dv['kind'] == 'paku':
        return [paku(dv['cycles'] * t_ / DURATION + dv['phase'] / (2 * math.pi))]
    if dv['kind'] == 'wave':
        mod = 1 + dv['whim'] * math.sin(2 * math.pi * t_ / DURATION + dv['whim_phase'])
        return [math.sin(ph) * mod, math.cos(ph) * mod]
    return [0.5 - 0.5 * math.cos(ph)]


def posed(meshes_, wfun):
    out = []
    for m_ in meshes_:
        p = m_.positions.astype(float).copy()
        if m_.name in targets:
            for (n, dl), w in zip(targets[m_.name], wfun(m_.name)):
                p += w * dl
        out.append(Mesh(m_.name, p, m_.uv, m_.faces))
    return out


# ---------- GLB with morph targets and the 'idle' clip ----------
def export_glb_morph(meshes_, texture, path, metadata):
    blob = bytearray(); views = []; access = []; gm = []
    def view(raw, target=None):
        blob.extend(b'\0' * ((-len(blob)) % 4)); off = len(blob); blob.extend(raw)
        v = {'buffer': 0, 'byteOffset': off, 'byteLength': len(raw)}
        if target is not None: v['target'] = target
        views.append(v); return len(views) - 1
    def acc(a, kind, comp, target, minmax=False):
        a = np.ascontiguousarray(a); v = view(a.tobytes(), target)
        dd = {'bufferView': v, 'componentType': comp, 'count': len(a), 'type': kind}
        if kind == 'VEC3' or minmax:
            dd.update(min=np.atleast_1d(a.min(axis=0)).tolist(), max=np.atleast_1d(a.max(axis=0)).tolist())
        access.append(dd); return len(access) - 1
    for m_ in meshes_:
        m_.check()
        attrs = {k: acc(a, kind, 5126, 34962) for k, a, kind in [('POSITION', m_.positions, 'VEC3'), ('NORMAL', m_.normals, 'VEC3'), ('TEXCOORD_0', m_.uv, 'VEC2')]}
        prim = {'attributes': attrs, 'indices': acc(m_.faces.ravel(), 'SCALAR', 5125, 34963), 'material': 0}
        mesh = {'name': m_.name, 'primitives': [prim]}
        if m_.name in targets:
            prim['targets'] = [{'POSITION': acc(dl.astype('<f4'), 'VEC3', 5126, 34962)} for n, dl in targets[m_.name]]
            mesh['weights'] = [0.0] * len(targets[m_.name]); mesh['extras'] = {'targetNames': [n for n, _ in targets[m_.name]]}
        gm.append(mesh)
    png = io.BytesIO(); Image.fromarray(texture).convert('RGBA').save(png, format='PNG'); iv = view(png.getvalue())
    times = np.round(np.arange(0, DURATION + 1e-9, 0.05), 4).astype('<f4')
    t_acc = acc(times, 'SCALAR', 5126, None, minmax=True)
    samplers = []; channels = []
    for i, m_ in enumerate(meshes_):
        if m_.name not in drivers: continue
        out = np.array([weights_at(drivers[m_.name], float(t_)) for t_ in times], dtype='<f4').ravel()
        samplers.append({'input': t_acc, 'output': acc(out, 'SCALAR', 5126, None), 'interpolation': 'LINEAR'})
        channels.append({'sampler': len(samplers) - 1, 'target': {'node': i + 1, 'path': 'weights'}})
    for m_ in meshes_:
        if m_.name in drivers: drivers[m_.name]['duration'] = DURATION
    material = {'name': 'Baked_atlas_nihonga', 'pbrMetallicRoughness': {'baseColorTexture': {'index': 0}, 'metallicFactor': 0, 'roughnessFactor': .8}, 'doubleSided': True, 'alphaMode': 'OPAQUE'}
    doc = {'asset': {'version': '2.0', 'generator': 'Local fish mesh toolkit + morph export (seibungyo-nihonga)'}, 'scene': 0, 'scenes': [{'nodes': [0]}],
           'nodes': [{'name': 'Fish_root', 'children': list(range(1, len(meshes_) + 1)), 'extras': metadata}] +
                    [{'name': m_.name, 'mesh': i, **({'extras': {k: v for k, v in (('nihongaDriver', drivers.get(m_.name)), ('nihongaContour', contour.get(m_.name))) if v}} if (m_.name in drivers or m_.name in contour) else {})} for i, m_ in enumerate(meshes_)],
           'meshes': gm, 'materials': [material], 'textures': [{'source': 0, 'sampler': 0}],
           'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 33071, 'wrapT': 33071}],
           'images': [{'bufferView': iv, 'mimeType': 'image/png'}], 'animations': [{'name': 'idle', 'samplers': samplers, 'channels': channels}],
           'buffers': [{'byteLength': len(blob)}], 'bufferViews': views, 'accessors': access}
    js = json.dumps(doc, separators=(',', ':')).encode(); js += b' ' * ((-len(js)) % 4); blob += b'\0' * ((-len(blob)) % 4)
    raw = struct.pack('<III', 0x46546c67, 2, 28 + len(js) + len(blob)) + struct.pack('<II', len(js), 0x4e4f534a) + js + struct.pack('<II', len(blob), 0x004e4942) + blob
    Path(path).parent.mkdir(parents=True, exist_ok=True); Path(path).write_bytes(raw)


atlas_u8 = np.clip(atlas, 0, 255).astype(np.uint8)
OUT.mkdir(parents=True, exist_ok=True)
Image.fromarray(atlas_u8).save(OUT / 'atlas.png')
meta = {'units': 'meters', 'up': '+Y', 'forward': '-X', 'species': 'Carassius auratus (青文魚 Seibungyo, blue oranda)',
        'scale_assumption': f'全長{TOTAL_LENGTH * 100:.0f} cm（尾鰭含む）の仮スケール',
        'source_views': ['side-v1 (user illustration, eye)', 'side-color-v1', 'top-v1', 'bottom-v1'],
        'style': 'nihonga: ink-free mineral-pigment colours; sumi outlines are drawn by nihonga-shader.js at run time',
        'animation': {'clip': 'idle', 'duration': DURATION, 'note': 'morph targets per mesh; drivers in node extras (nihongaDriver)'}}
export_glb_morph(meshes, atlas_u8, OUT / 'seibungyo.glb', meta)

# ---------- verification renders (software, texture check) ----------
views = {'side': (0, 0), 'side_far': (math.pi, 0), 'top': (0, math.pi / 2 - 1e-3), 'bottom': (0, -math.pi / 2 + 1e-3),
         'front': (math.pi / 2, 0), 'oblique': (.6, .3), 'rear_oblique': (2.4, .25)}
for n, (yaw, pitch) in views.items():
    render(meshes, atlas_u8, OUT / f'render-{n}.png', yaw=yaw, pitch=pitch)
opened = posed(meshes, lambda name: [1.0] * len(targets[name]) if drivers[name]['kind'] in ('pulse', 'paku') else [0.0, 0.0])
head = np.array([X0 + 60 - center[0], -430 - center[1], 0]) * SCALE
for n, (yaw, pitch) in {'mouth_gill_open': (.75, .1), 'mouth_gill_open_front': (1.35, .05)}.items():
    render(opened, atlas_u8, OUT / f'detail-{n}.png', yaw=yaw, pitch=pitch, target=head, radius=.035)
    render(meshes, atlas_u8, OUT / f'detail-{n.replace("open", "closed")}.png', yaw=yaw, pitch=pitch, target=head, radius=.035)
spec = {'tone_gamma': GAMMA, 'lum_ink': lum_ink, 'lum_colour': lum_col, 'scale': SCALE, 'center_px': center.tolist(),
        'meshes': {m_.name: {'vertices': len(m_.positions), 'triangles': len(m_.faces), 'targets': [n for n, _ in targets.get(m_.name, [])]} for m_ in meshes},
        'drivers': drivers, 'uv_collapse': uv_collapse_report(meshes, (ATLAS_W, ATLAS_H))}
(OUT / 'build-report.json').write_text(json.dumps(spec, ensure_ascii=False, indent=1), encoding='utf8')
print('ok', sum(len(m_.positions) for m_ in meshes), 'vertices', sum(len(m_.faces) for m_ in meshes), 'triangles, gamma', round(GAMMA, 3))
