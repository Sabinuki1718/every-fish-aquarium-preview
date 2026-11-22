"""水泡眼 (Carassius auratus, bubble-eye, self-red) — assemble a GLB from the approved watercolor views.

No dorsal fin. v3: the head, cheeks and eyes come from no-sac reference views (same individual,
sacs removed); the eye sacs are separate translucent ellipsoids baked from the approved views.
Adapted from the Seibungyo build.

Working units are side-view pixels (X right = tail, Y up, Z toward the side-view camera);
the model is scaled to 0.12 m total length at the end. Landmarks: landmarks.json.
"""
from pathlib import Path
import json, math, sys
import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
SKILL = HERE.parents[5] / '.agents/skills/build-fish-3d-from-views'
sys.path.insert(0, str(SKILL / 'scripts'))
from fish_mesh import (Mesh, loft, fin, export_glb, write_preview, render, scale_to_length,
                       sample_bilinear, inpaint_region, dilate_mask, check_atlas_islands, orient_closed)

VERSION = sys.argv[1] if len(sys.argv) > 1 else 'v1'
OUT = HERE.parent / VERSION
L = json.load(open(HERE / 'landmarks.json'))
S, T, B, FR = L['side'], L['top'], L['bottom'], L['front']
img = {k: np.asarray(Image.open(HERE / v['image']).convert('RGB')).astype(float) for k, v in [('side', S), ('top', T), ('bottom', B)]}       # with sacs
nos = {k: np.asarray(Image.open(HERE / v['nosac_image']).convert('RGB')).astype(float) for k, v in [('side', S), ('top', T), ('bottom', B)]}  # sacs removed


def interp(poly, x):
    p = np.asarray(poly, float)
    return np.interp(x, p[:, 0], p[:, 1])


def poly_mask(shape, poly, grow=0):
    m = Image.new('L', (shape[1], shape[0]), 0)
    ImageDraw.Draw(m).polygon([tuple(p) for p in poly], fill=255)
    m = np.asarray(m) > 0
    return dilate_mask(m, grow) if grow else m


# ---------- view registration: snout and peduncle end in each view ----------
X0, X1 = 258.0, 905.0                     # side view snout / peduncle (tail root)
VIEW_X = {'top': (270.0, 900.0), 'bottom': (268.0, 900.0)}
K = {v: (X1 - X0) / (b - a) for v, (a, b) in VIEW_X.items()}   # view px -> side px


def to_view_x(view, x):
    a, _ = VIEW_X[view]
    return a + (x - X0) / K[view]


def half_width(x):
    """Body half-width (side px) from the top view, symmetrised."""
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
NS = 96
u = np.linspace(0, 1, NS)
xs = X0 + 1.0 + (X1 - X0 - 1.0) * (1 - np.cos(u * math.pi)) / 2   # denser at snout and peduncle
ytop = interp(S['body_top'], xs); ybot = interp(S['body_bottom'], xs)
cy = -(ytop + ybot) / 2; hh = np.maximum((ybot - ytop) / 2, 1.5)
hw = np.maximum(half_width(xs), 1.5)
# rounded snout: blend radii to the tip
tip = np.clip((xs - X0) / 14.0, 0, 1) ** 0.5
hh = np.maximum(hh * np.maximum(tip, .12), 1.2); hw = np.maximum(hw * np.maximum(tip, .12), 1.2)
sections = np.column_stack([xs, cy, np.zeros(NS), hh, hh, hw, hw])

ATLAS_W, ATLAS_H = 2048, 2048
BODY = (0, 0, 2048, 1024)
SIDE_AT = (0, 1024)                       # full side view copied here (fins, eyes)
TOPCROP = (300, 120, 620, 480)            # top-view pectoral fin + eyes source rect
SAC = (0, 1792, 1024, 2048)               # baked eye-sac island
TOP_AT = (1424, 1040)


def body_uv(s, t):
    return ((s * (BODY[2] - 1) + .5) / ATLAS_W, ((t / (2 * math.pi)) * (BODY[3] - 1) + .5) / ATLAS_H)


body = loft('body', sections, body_uv, segments=96, power=2.15)

# ---------- cleaned projections ----------
def circle(cx_, cy_, r_):
    return [(cx_ + r_ * math.cos(a_), cy_ + r_ * math.sin(a_)) for a_ in np.linspace(0, 2 * math.pi, 40, endpoint=False)]
def clean(a_, polys):
    for poly in polys:
        a_ = inpaint_region(a_, poly_mask(a_.shape[:2], poly, 3))
    return a_
ex_, ey_, er_ = S['nosac_eye']
side_clean = clean(nos['side'].copy(), [S['pectoral'], circle(ex_, ey_, er_ + 6)])                    # body: no-sac side
top_clean = clean(nos['top'].copy(), [circle(e[0], e[1], e[2] + 6) for e in T['nosac_eyes']])           # body: no-sac top
bottom_clean = clean(nos['bottom'].copy(), B['inpaint'])                                                # body: no-sac bottom
sx_, sy_, sr_ = S['eye']
sac_side = clean(img['side'].copy(), [S['far_sac_blob'], circle(sx_, sy_, sr_ + 6)])                  # sacs: approved views
sac_top = clean(img['top'].copy(), [circle(e[0], e[1], e[2] + 6) for e in T['eyes']])
front_clean = clean(np.asarray(Image.open(HERE / FR['image']).convert('RGB')).astype(float), [circle(e[0], e[1], e[2] + 8) for e in FR['eyes']])


def front_xy(Yw, Zw):
    """World (side-px units) -> front-view pixel; the front view sees +Z on the right."""
    return FR['center_x'] + Zw / FR['scale'], FR['y0'] + (-Yw - FR['side_y0']) / FR['scale']
for n_, a_ in [('side', side_clean), ('top', top_clean), ('bottom', bottom_clean)]:
    Image.fromarray(a_.astype(np.uint8)).save(HERE / f'{n_}-clean.png')

bw, bh = BODY[2], BODY[3]
ii, jj = np.meshgrid((np.arange(bw) + .5) / bw, (np.arange(bh) + .5) / bh)
s = ii; t = jj * 2 * math.pi
x = np.interp(s * (NS - 1), np.arange(NS), xs)
c_y = np.interp(x, xs, cy); r_y = np.interp(x, xs, hh); r_z = np.interp(x, xs, hw)
Y = c_y + np.cos(t) * r_y; Z = np.sin(t) * r_z
ny, nz = np.cos(t) / r_y, np.sin(t) / r_z
nn = np.hypot(ny, nz); ny /= nn; nz /= nn
side_col = sample_bilinear(side_clean, x, -Y)
xt = to_view_x('top', x)
top_col = sample_bilinear(top_clean, xt, top_center(x) + (Z / K['top']))
xb, bc, bhw = bottom_geom(x)
bot_col = sample_bilinear(bottom_clean, xb, bc - (Z / r_z) * bhw)
# forward-facing share of the normal from how fast the cross-section grows along the body
dhh, dhw = np.interp(x, xs, np.gradient(hh, xs)), np.interp(x, xs, np.gradient(hw, xs))
rho = np.sqrt((r_y * np.cos(t)) ** 2 + (r_z * np.sin(t)) ** 2)
slope = ((r_y * np.cos(t)) ** 2 * dhh / r_y + (r_z * np.sin(t)) ** 2 * dhw / r_z) / rho
f_fwd = np.clip(slope / np.sqrt(1 + slope ** 2), 0, 1); lat = 1 / np.sqrt(1 + slope ** 2)
w_side = (np.abs(nz) * lat) ** 2.2
snout = np.clip((x - X0) / 12.0, 0, 1) ** 1.5      # no top/bottom projection at the very tip
w_top = (np.clip(ny, 0, None) * lat) ** 2.2 * snout
w_bot = (np.clip(-ny, 0, None) * lat) ** 2.2 * snout
w_front = f_fwd ** 2.2 * 1.5
front_col = sample_bilinear(front_clean, *front_xy(Y, Z))
w = w_side + w_top + w_bot + w_front + 1e-6
bake = (side_col * w_side[..., None] + top_col * w_top[..., None] + bot_col * w_bot[..., None] + front_col * w_front[..., None]) / w[..., None]

atlas = np.full((ATLAS_H, ATLAS_W, 3), 240.0)
atlas[:bh, :bw] = bake
atlas[SIDE_AT[1]:SIDE_AT[1] + 768, SIDE_AT[0]:SIDE_AT[0] + 1408] = nos['side']
tc = nos['top'][TOPCROP[1]:TOPCROP[3], TOPCROP[0]:TOPCROP[2]]
atlas[TOP_AT[1]:TOP_AT[1] + tc.shape[0], TOP_AT[0]:TOP_AT[0] + tc.shape[1]] = tc
# eye sacs: each view's own sac ellipse is mapped onto the 3D sac (the three drawings place it slightly differently)
SC = S['sac']; SIDE_SAC = ((440, 420), (128, 108))                     # where the side view draws the sac
TILT = math.radians(SC['tilt_deg'])


def sac_world(lx, ly, lz, sign):
    """Unit-sphere point of the sac -> world, tilting the top inward (toward the head)."""
    y, z = ly * SC['ry'], lz * SC['rz']
    y2, z2 = y * math.cos(TILT) + z * math.sin(TILT), z * math.cos(TILT) - y * math.sin(TILT)
    return (SC['center'][0] + lx * SC['rx'], -SC['center'][1] + y2, sign * (SC['z'] + z2))
TOP_SAC = {1: ((365, 500), (95, 80)), -1: ((370, 255), (95, 80))}       # +Z = lower in the top view
BOT_SAC = {1: ((365, 245), (105, 105)), -1: ((365, 520), (105, 105))}   # +Z = upper in the bottom view
sw, sh = SAC[2] - SAC[0], SAC[3] - SAC[1]
ui, vj = np.meshgrid((np.arange(sw) + .5) / sw, (np.arange(sh) + .5) / sh)
phi = ui * 2 * math.pi; th = vj * math.pi
lx, ly, lz = np.sin(th) * np.cos(phi), np.cos(th), np.sin(th) * np.sin(phi)   # unit sphere, lz>0 = outward
nx_, ny_, nz_ = lx / SC['rx'], ly / SC['ry'], lz / SC['rz']
nn_ = np.sqrt(nx_ ** 2 + ny_ ** 2 + nz_ ** 2); ny_ /= nn_; nz_ /= nn_
ny_, nz_ = ny_ * math.cos(TILT) + nz_ * math.sin(TILT), nz_ * math.cos(TILT) - ny_ * math.sin(TILT)   # world normals
(scx, scy), (srx, sry) = SIDE_SAC
c_side = sample_bilinear(sac_side, scx + lx * srx, scy - ly * sry)
(tcx, tcy), (trx, trz) = TOP_SAC[1]
c_top = sample_bilinear(sac_top, tcx + lx * trx, tcy + lz * trz)
(bcx, bcy), (brx, brz) = BOT_SAC[1]
c_bot = sample_bilinear(img['bottom'], bcx + lx * brx, bcy - lz * brz)
(fcx, fcy), (frz, fry) = FR['sac']['1']
c_front = sample_bilinear(front_clean, fcx + lz * frz, fcy - ly * fry)
nxs = (lx / SC['rx']) / nn_
ws, wt, wb = np.clip(nz_, 0, None) ** 2 + .02, np.clip(ny_, 0, None) ** 2, np.clip(-ny_, 0, None) ** 2
wf = np.clip(-nxs, 0, None) ** 2 * 1.3
sac_bake = (c_side * ws[..., None] + c_top * wt[..., None] + c_bot * wb[..., None] + c_front * wf[..., None]) / (ws + wt + wb + wf)[..., None]
atlas[SAC[1]:SAC[3], SAC[0]:SAC[2]] = sac_bake
check_atlas_islands(ATLAS_W, ATLAS_H, [('body', BODY), ('side_source', (0, 1024, 1408, 1792)), ('sac', SAC),
                                       ('top_pectoral_source', (TOP_AT[0], TOP_AT[1], TOP_AT[0] + tc.shape[1], TOP_AT[1] + tc.shape[0]))])


def side_uv(px, py):
    return ((SIDE_AT[0] + px) / ATLAS_W, (SIDE_AT[1] + py) / ATLAS_H)


def top_uv(px, py):
    return ((TOP_AT[0] + px - TOPCROP[0]) / ATLAS_W, (TOP_AT[1] + py - TOPCROP[1]) / ATLAS_H)


def body_z(xp, Yp):
    """Body surface |Z| at side-px x and world Y."""
    c, ry, rz = np.interp(xp, xs, cy), np.interp(xp, xs, hh), np.interp(xp, xs, hw)
    q = np.clip(np.abs(Yp - c) / ry, 0, 1)
    return rz * (1 - q ** 2.15) ** (1 / 2.15)


def column_extent(poly, shape=(768, 1408)):
    m = poly_mask(shape, poly)
    cols = np.where(m.any(axis=0))[0]
    lo = np.full(shape[1], np.nan); hi = np.full(shape[1], np.nan)
    for c in cols:
        r = np.where(m[:, c])[0]; lo[c], hi[c] = r.min(), r.max()
    return lo, hi


def add_blend_material(path, mesh_names, opacity):
    """Give the named meshes a second, alpha-blended copy of the baked material (translucent eye sacs)."""
    import struct
    raw = Path(path).read_bytes(); jl, _ = struct.unpack_from('<II', raw, 12)
    doc = json.loads(raw[20:20 + jl]); rest = raw[20 + jl:]
    mat = json.loads(json.dumps(doc['materials'][0])); mat['name'] = 'Baked_atlas_translucent'
    mat['alphaMode'] = 'BLEND'; mat['pbrMetallicRoughness']['baseColorFactor'] = [1, 1, 1, opacity]
    mat['pbrMetallicRoughness']['roughnessFactor'] = 0.35; mat.pop('alphaCutoff', None)
    doc['materials'].append(mat)
    for m_ in doc['meshes']:
        if m_['name'] in mesh_names:
            for p_ in m_['primitives']: p_['material'] = len(doc['materials']) - 1
    js = json.dumps(doc, separators=(',', ':')).encode(); js += b' ' * ((-len(js)) % 4)
    Path(path).write_bytes(struct.pack('<III', 0x46546c67, 2, 20 + len(js) + len(rest)) + struct.pack('<II', len(js), 0x4e4f534a) + js + rest)


meshes = [body]
TH = 1.4   # half thickness of fin membranes (side px)

# eye sacs (mirror images; the inner side is textured from the same outward-facing bake)
def sac_uv(u_, v_):
    return ((SAC[0] + .5 + u_ * (sw - 1)) / ATLAS_W, (SAC[1] + .5 + v_ * (sh - 1)) / ATLAS_H)
for sign, name in [(1, 'sac_near'), (-1, 'sac_far')]:
    nu, nv = 32, 64
    P = [sac_world(0, 1, 0, sign)]; UV = [sac_uv(.5, 0)]
    for i in range(1, nu):
        th_ = math.pi * i / nu
        for j in range(nv + 1):
            ph = 2 * math.pi * j / nv
            P.append(sac_world(math.sin(th_) * math.cos(ph), math.cos(th_), math.sin(th_) * math.sin(ph), sign))
            UV.append(sac_uv(j / nv, i / nu))
    P.append(sac_world(0, -1, 0, sign)); UV.append(sac_uv(.5, 1))
    row = lambda i, j: 1 + (i - 1) * (nv + 1) + j
    F = [[0, row(1, j + 1), row(1, j)] for j in range(nv)]
    for i in range(1, nu - 1):
        for j in range(nv):
            F += [[row(i, j), row(i, j + 1), row(i + 1, j)], [row(i, j + 1), row(i + 1, j + 1), row(i + 1, j)]]
    last = len(P) - 1
    F += [[last, row(nu - 1, j), row(nu - 1, j + 1)] for j in range(nv)]
    meshes.append(Mesh(name, P, UV, orient_closed(np.asarray(P), F)))

# caudal: four-lobed tail as two halves splayed like an inverted V seen from behind.
# Upper lobes stay near the midline (top view: inner lobes reach furthest back);
# lower lobes spread outward (top view: outer lobes). Outline from side, spread from top.
_cy = np.asarray(S['caudal'], float)[:, 1]
TAIL_Y0, TAIL_Y1 = _cy.min(), _cy.max()
env = np.asarray(T['tail_env_left'], float)
env_x = X0 + (env[:, 0] - VIEW_X['top'][0]) * K['top']
env_z = np.abs(env[:, 1] - T['center_y']) * K['top']
order = np.argsort(env_x)
zmax = lambda xp: np.interp(xp, env_x[order], np.maximum.accumulate(env_z[order]))
for sign, name in [(1, 'caudal_near'), (-1, 'caudal_far')]:
    def pt(a, b, l, sign=sign):
        # global height parameter: the separated upper / lower lobes keep their own spread
        tt = np.clip((b - TAIL_Y0) / (TAIL_Y1 - TAIL_Y0), 0, 1)
        root = np.clip((a - X1) / 60.0, 0, 1) ** 0.8
        zz = 3 + zmax(a) * root * min(1.0, 1.15 * tt ** 1.1)
        return (a, -b, sign * (zz + l * TH))
    meshes.append(fin(name, S['caudal'], pt, side_uv, subdivisions=2))

# pectoral pair: nearly horizontal, outline + texture from the top view
pec = np.asarray(T['pectoral_left'], float)
edge_top = lambda xt_: top_center(X0 + (xt_ - VIEW_X['top'][0]) * K['top']) - interp(T['body_left'], xt_)
PEC_Y = -490.0
for sign, name in [(1, 'pectoral_near'), (-1, 'pectoral_far')]:
    def pt(a, b, l, sign=sign):
        xp = X0 + (a - VIEW_X['top'][0]) * K['top']
        out = (top_center(xp) - b) * K['top'] - edge_top(a) * K['top']   # beyond the top silhouette
        zs = body_z(xp, PEC_Y) - 5
        return (xp, PEC_Y - max(out, 0) * 0.35 + l * TH, sign * (zs + out))
    outline = pec if sign == -1 else pec[::-1]
    meshes.append(fin(name, outline.tolist(), pt, top_uv, subdivisions=2))

# pelvic pair: hanging down and outward ~40 deg
for sign, name in [(1, 'pelvic_near'), (-1, 'pelvic_far')]:
    def pt(a, b, l, sign=sign):
        yb = interp(S['body_bottom'], a)
        drop = max(b - yb, 0)
        return (a, -b, sign * (30 + drop * math.tan(math.radians(40)) + l * TH))
    meshes.append(fin(name, S['pelvic'], pt, side_uv, subdivisions=2))

# anal pair: small, close to the midline
for sign, name in [(1, 'anal_near'), (-1, 'anal_far')]:
    def pt(a, b, l, sign=sign):
        yb = interp(S['body_bottom'], a)
        drop = max(b - yb, 0)
        return (a, -b, sign * (8 + drop * math.tan(math.radians(18)) + l * TH))
    meshes.append(fin(name, S['anal'], pt, side_uv, subdivisions=2))

# eyes: bulging domes on the upper sides of the head (no-sac views), looking up and outward.
# Seated on the upper end of the tilted sac: lands near the side-view eye (395, 345) and the top-view eyes. Texture: no-sac side eye.
ex, ey, er = S['nosac_eye']
EH = 18.0
EYE_DIR = np.array([-0.3, 0.84, 0.45]); EYE_DIR /= np.linalg.norm(EYE_DIR)   # on the sac's upper end
for sign, name in [(1, 'eye_near'), (-1, 'eye_far')]:
    axis = np.array([-0.4, 0.72, 0.56 * sign]); axis /= np.linalg.norm(axis)   # up, outward and a little forward (front view)
    e1 = np.array([1.0, 0, 0]) - axis * axis[0]; e1 /= np.linalg.norm(e1); e2 = np.cross(axis, e1)
    C = np.array(sac_world(*EYE_DIR, sign)) - axis * 3
    nu, nv = 12, 40
    P = [C + axis * EH]; UV = [side_uv(ex, ey)]
    for i in range(1, nu + 1):
        th_ = (math.pi / 2) * i / nu
        for j in range(nv):
            ph = 2 * math.pi * j / nv; r_ = er * 1.2 * math.sin(th_)
            P.append(C + r_ * (math.cos(ph) * e1 + math.sin(ph) * e2) + axis * EH * math.cos(th_))
            # local frame -> side-view pixels around the painted eye (e2 has +Y component: up in the picture)
            UV.append(side_uv(ex + r_ * math.cos(ph), ey - r_ * math.sin(ph) * np.sign(e2[1] if e2[1] else 1)))
    P.append(C - axis * 4); UV.append(side_uv(ex, ey))
    F = [[0, 1 + j, 1 + (j + 1) % nv] for j in range(nv)]
    for i in range(nu - 1):
        for j in range(nv):
            a_ = 1 + i * nv + j; b_ = 1 + i * nv + (j + 1) % nv
            F += [[a_, a_ + nv, b_], [b_, a_ + nv, b_ + nv]]
    rim = 1 + (nu - 1) * nv; cen = len(P) - 1
    F += [[rim + j, cen, rim + (j + 1) % nv] for j in range(nv)]
    meshes.append(Mesh(name, [tuple(p) for p in P], UV, orient_closed(np.asarray(P), F)))

# mouth: painted only, as in the illustration (an added lip solid looked stuck on; removed at the user's request)

atlas_u8 = np.clip(atlas, 0, 255).astype(np.uint8)
meshes = scale_to_length(meshes, 0.12)
OUT.mkdir(parents=True, exist_ok=True)
Image.fromarray(atlas_u8).save(OUT / 'atlas.png')
meta = {'units': 'meters', 'up': '+Y', 'forward': '-X', 'species': 'Carassius auratus (水泡眼 bubble-eye, self-red)',
        'scale_assumption': '全長12 cm（尾鰭含む）の仮スケール', 'source_views': ['side-v1', 'top-v2 (mirrored)', 'bottom-v2', 'nosac-side/top/bottom (head reference)', 'front-v1'],
        'style': 'watercolor textures projected from the approved views'}
export_glb(meshes, atlas_u8, OUT / 'suihogan.glb', metadata=meta)
add_blend_material(OUT / 'suihogan.glb', ['sac_near', 'sac_far'], SC['opacity'])
write_preview(meshes, atlas_u8, OUT / 'preview.html', title='水泡眼 3Dモデル ' + VERSION, glb_filename='suihogan.glb',
              description='承認済みの三面図（水彩）から作成。全長12 cmの仮スケール。')
views = {'side': (0, 0), 'side_far': (math.pi, 0), 'top': (0, math.pi / 2 - 1e-3), 'bottom': (0, -math.pi / 2 + 1e-3),
         'front': (math.pi / 2, 0), 'oblique': (.6, .3), 'rear_oblique': (2.4, .25)}
for n, (yaw, pitch) in views.items():
    render(meshes, atlas_u8, OUT / f'render-{n}.png', yaw=yaw, pitch=pitch)
print('ok', sum(len(m.faces) for m in meshes), 'triangles')
