"""ルリヨシノボリ (Rhinogobius mizunoi) — assemble a GLB from the user's three-view sheet (views/source/sheet-v1.png).

Working units are sheet pixels (X right = tail, Y up = -image y, Z toward the side-view camera);
the model is scaled to 0.08 m total length (snout to caudal tip) at the end. Inputs: landmarks.json.
The side view leads (v3-v4): the front view (front-v1.png) only nudges the head cross-sections toward its outline
(shape_blend), and its drawing is not used on the surface (texture_weight 0).
The top and bottom views are drawn at different widths, so the body half-width is their average and each
view is sampled at its own per-column width. The pectoral fins are separate fans: their drawing is replaced
on the body side by the trunk pattern next to it. The fused pelvic disc is a shallow dome under the belly,
textured from the bottom view. The eyes are low domes textured from the side view.
"""
from pathlib import Path
import json, math, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent
SKILL = HERE.parents[5] / '.agents/skills/build-fish-3d-from-views'
sys.path.insert(0, str(SKILL / 'scripts'))
from fish_mesh import (Mesh, _rings, fin, export_glb, write_preview, scale_to_length, inpaint_region,
                       sample_bilinear, dilate_mask, bleed_edges, check_atlas_islands, orient_closed)

VERSION = sys.argv[1] if len(sys.argv) > 1 else 'v1'
OUT = HERE.parent / VERSION
L = json.load(open(HERE / 'landmarks.json'))
sheet = np.asarray(Image.open(HERE / L['source']).convert('RGB')).astype(float)
H_IMG, W_IMG = sheet.shape[:2]
NONWHITE = sheet.min(2) < 238
SIDE_Y0, SIDE_Y1 = 12, 376
BOT_Y0, BOT_Y1 = 662, 968
TOP_ROWS, BOT_ROWS = (385, 655), (660, 968)


def pinterp(pts, x):
    p = np.asarray(pts, float)
    return np.interp(x, p[:, 0], p[:, 1])


def poly_mask(poly, grow=0):
    m = Image.new('L', (W_IMG, H_IMG), 0)
    ImageDraw.Draw(m).polygon([tuple(map(float, p)) for p in poly], fill=255)
    m = np.asarray(m) > 0
    return dilate_mask(m, grow) if grow else m


side_top = lambda x: pinterp(L['side_top'], x)
side_bottom = lambda x: pinterp(L['side_bottom'], x)
half_width = lambda x: pinterp(L['half_width'], x)


def view_profile(rows, fin_span):
    """Per-column centre and half-width of a top/bottom view, bridged across the spans covered by the pectorals."""
    y0, y1 = rows
    cols = np.arange(52, 1229)
    c, h = [], []
    for x in cols:
        ys = np.where(NONWHITE[y0:y1, x])[0] + y0
        c.append((ys.min() + ys.max()) / 2); h.append((ys.max() - ys.min()) / 2)
    c, h = np.array(c), np.array(h)
    ok = (cols < fin_span[0]) | (cols > fin_span[1])
    c = np.interp(cols, cols[ok], c[ok]); h = np.interp(cols, cols[ok], h[ok])
    return (lambda x: np.interp(x, cols, c)), (lambda x: np.maximum(np.interp(x, cols, h), 1.0))


top_c, top_hw = view_profile(TOP_ROWS, L['top_view_fin_span'])
bot_c, bot_hw = view_profile(BOT_ROWS, L['bottom_view_fin_span'])

# ---------------- body ----------------
# Cross-sections: width as a function of height, W(x, yn) for yn in [-1, 1] (up = +1). The head follows the
# front view's outline (narrow dome above, widest below the middle); the trunk is a superellipse.
X0, X1 = L['body_x']
NS = 220
u = np.linspace(0, 1, NS)
xs = X0 + 0.5 + (X1 - X0 - 0.5) * (1 - np.cos(u * math.pi)) / 2
yt, yb = side_top(xs), side_bottom(xs)
cy = -(yt + yb) / 2
FR = L['front']
b0, b1 = FR['blend_x']
wf = np.clip((b1 - xs) / (b1 - b0), 0, 1); wf = wf * wf * (3 - 2 * wf)
wf = wf * FR['shape_blend']                                    # side view first: the front outline only corrects the head
_tt = np.clip((xs - X0) / FR['tip_len'], 0, 1)
tip = np.maximum(np.sqrt(_tt * (2 - _tt)), FR['tip_min'])      # round nose (quarter circle), not a flat end cap       
hh = np.maximum((yb - yt) / 2 * tip, 1.0)
hw = np.maximum(half_width(xs) * (1 + FR['head_widen'] * wf) * tip, 1.0)
POWER = 2.3
_fh = np.asarray(FR['half_width'], float)
_fyn = (FR['top'] + FR['bottom']) / 2
_fhh = (FR['bottom'] - FR['top']) / 2
_fmax = _fh[:, 1].max()
_yn_tab = ((_fyn - _fh[:, 0]) / _fhh)[::-1]
_w_tab = (_fh[:, 1] / _fmax)[::-1]


def width_frac(xp, yn):
    """W(x, yn): half-width at normalised height yn as a fraction of the section's half-width."""
    yn = np.clip(yn, -1, 1)
    sup = (1 - np.abs(yn) ** POWER) ** (1 / POWER)
    fr = np.interp(yn, _yn_tab, _w_tab)
    k = np.interp(xp, xs, wf)
    return k * fr + (1 - k) * sup


NT = 721
TT = np.linspace(0, 2 * math.pi, NT)
YN = np.cos(TT)
GP = np.zeros((NS, NT, 3))
for i in range(NS):
    GP[i, :, 0] = xs[i]
    GP[i, :, 1] = cy[i] + hh[i] * YN
    GP[i, :, 2] = np.sign(np.sin(TT)) * hw[i] * width_frac(np.full(NT, xs[i]), YN)
_di = np.gradient(GP, axis=0); _dk = np.gradient(GP, axis=1)
GN = np.cross(_dk, _di)
_rad = GP - np.stack([GP[..., 0], np.repeat(cy[:, None], NT, 1), np.zeros((NS, NT))], -1)
GN *= np.where((GN * _rad).sum(-1, keepdims=True) < 0, -1, 1)
GN /= np.maximum(np.linalg.norm(GN, axis=-1, keepdims=True), 1e-9)


def grid_sample(G, fi, fk):
    i0 = np.clip(np.floor(fi).astype(int), 0, NS - 2); k0 = np.clip(np.floor(fk).astype(int), 0, NT - 2)
    a = (fi - i0)[..., None]; b = (fk - k0)[..., None]
    return (G[i0, k0] * (1 - a) * (1 - b) + G[i0 + 1, k0] * a * (1 - b) + G[i0, k0 + 1] * (1 - a) * b + G[i0 + 1, k0 + 1] * a * b)


ATLAS_W, ATLAS_H = 2048, 2048
BODY = (0, 0, 2048, 1024)
SIDE_AT = (0, 1024)                      # sheet rows SIDE_Y0..SIDE_Y1 (fins, eyes)
BOT_AT = (0, 1024 + (SIDE_Y1 - SIDE_Y0) + 8)  # sheet rows BOT_Y0..BOT_Y1 (pelvic disc)


def body_uv(s, t):
    return ((s * (BODY[2] - 1) + .5) / ATLAS_W, ((t / (2 * math.pi)) * (BODY[3] - 1) + .5) / ATLAS_H)


def side_uv(x, y):
    return ((SIDE_AT[0] + x) / ATLAS_W, (SIDE_AT[1] + y - SIDE_Y0) / ATLAS_H)


def bot_uv(x, y):
    return ((BOT_AT[0] + x) / ATLAS_W, (BOT_AT[1] + y - BOT_Y0) / ATLAS_H)


SEG = 96
_ks = np.round(np.linspace(0, NT - 1, SEG + 1)).astype(int)
body = _rings('body', GP[:, _ks], body_uv, None)

# ---------------- cleaned views ----------------
_yy, _xx = np.mgrid[:H_IMG, :W_IMG]


def refill(img, mask, box, pixels=60):
    """Replace masked pixels by spreading the surrounding fish colours inward (never the white background)."""
    x0, y0, x1, y1 = box
    sub = img[y0:y1, x0:x1]; m = mask[y0:y1, x0:x1]
    valid = NONWHITE[y0:y1, x0:x1] & ~m
    img[y0:y1, x0:x1] = bleed_edges(sub.astype(np.uint8), valid, pixels=pixels)
    return img


# side: the pectoral fan lies over the trunk. Inside the body outline it is replaced by the trunk pattern
# 240 px further back (same rows), feathered at the edge.
side_clean = sheet.copy()
P = L['pectoral']
in_body = (_yy > side_top(_xx) + 2) & (_yy < side_bottom(_xx) - 1)
pm = poly_mask(P['outline'], 3) & in_body
SHIFT = 240
# donor rows map the body's height span onto the donor's (top 4 px down, clear of the second dorsal fin's root line) instead of
# clamping, which smeared one row into vertical streaks (v1-v2)
dx_ = np.clip(_xx + SHIFT, 0, W_IMG - 1)
_t0, _t1 = side_top(_xx), side_bottom(_xx)
_d0, _d1 = side_top(dx_) + 4, side_bottom(dx_) - 2
dy_ = np.clip(np.round(_d0 + (_yy - _t0) * (_d1 - _d0) / np.maximum(_t1 - _t0, 1)), 0, H_IMG - 1).astype(int)
donor = sheet[dy_, dx_]
alpha = np.asarray(Image.fromarray((pm * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(4))).astype(float)[..., None] / 255
alpha = np.where(in_body[..., None], alpha, 0)
side_clean = side_clean * (1 - alpha) + donor * alpha
E = L['eye']
ex_, ey_ = E['center']
side_clean = refill(side_clean, (_xx - ex_) ** 2 + (_yy - ey_) ** 2 <= (E['radius'] + 4) ** 2, (120, SIDE_Y0, 320, SIDE_Y1))

top_clean, bot_clean = sheet.copy(), sheet.copy()
m = np.zeros(NONWHITE.shape, bool)
for cx_, cy_, rx, ry in E['top_view_eyes']:
    m |= ((_xx - cx_) / rx) ** 2 + ((_yy - cy_) / ry) ** 2 <= 1
refill(top_clean, m, (120, 400, 300, 640))
VB = L['v_band']


def soft_fill(img, mask, sigma, box):
    """Fill the masked pixels from the surrounding fish colours, then blur only the filled part (no streaks)."""
    tmp = refill(img.copy(), mask, box)
    bl = np.stack([np.asarray(Image.fromarray(np.clip(tmp[..., c], 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(sigma))).astype(float) for c in range(3)], -1)
    out = img.copy()
    out[mask] = bl[mask]
    return out


def near_polyline(pts, r):
    m = np.zeros(NONWHITE.shape, bool)
    for (xa, ya), (xb, yb) in zip(pts, pts[1:]):
        dxl, dyl = xb - xa, yb - ya
        tl = np.clip(((_xx - xa) * dxl + (_yy - ya) * dyl) / (dxl * dxl + dyl * dyl), 0, 1)
        m |= np.hypot(_xx - xa - tl * dxl, _yy - ya - tl * dyl) <= r
    return m


_red = (sheet[..., 0] - sheet[..., 1] > 60) & (sheet[..., 0] > 170)
_vm = np.zeros(NONWHITE.shape, bool)
for arm in VB['top_view_arms']:
    _vm |= near_polyline(arm, VB['arm_halfwidth'])
_pink = (sheet[..., 0] - sheet[..., 1] > 22) & (np.hypot(_xx - VB['apex'][0], _yy - VB['apex'][1]) <= VB['apex_radius'])
# the top view's upper-lip edge (a thin dark arc round the snout) shows as a notch at the V's apex
_ta = VB['lip_arc_box']
_arc = (sheet.mean(2) < 140) & (sheet[..., 0] - sheet[..., 1] < 50) & (_xx >= _ta[0]) & (_xx < _ta[2]) & (_yy >= _ta[1]) & (_yy < _ta[3])
# fill by diffusion from the surrounding skin (v5's lip-coloured fill and v6's row/column spreading both left streaks)
_tm = dilate_mask((_vm & _red) | _pink | _arc, 2) & NONWHITE & ~dilate_mask(~NONWHITE, 3)
_bx = (40, 440, 260, 620)
top_clean[_bx[1]:_bx[3], _bx[0]:_bx[2]] = inpaint_region(top_clean[_bx[1]:_bx[3], _bx[0]:_bx[2]], _tm[_bx[1]:_bx[3], _bx[0]:_bx[2]])

# the lower V: deepen the side view's snout-to-eye stripe
_sm = near_polyline(VB['side_stripe'], VB['stripe_halfwidth']) & _red
_sa = np.asarray(Image.fromarray((_sm * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))).astype(float)[..., None] / 255
_deep = side_clean * np.array([0.92, 0.62, 0.55])
side_clean = side_clean * (1 - _sa * VB['stripe_strength'] * 2) + _deep * (_sa * VB['stripe_strength'] * 2)

# the head's silhouette ink (the drawing's outline) would be laid along the back and snout as dark lines where the
# side view still counts (v6): fill it from just inside
_hb = L['head_outline_box']
_ink = dilate_mask(~NONWHITE, 5) & NONWHITE & (side_clean.mean(2) < 170) & (side_clean[..., 0] - side_clean[..., 1] < 50)
_ink[:, :_hb[0]] = False; _ink[:, _hb[2]:] = False; _ink[:_hb[1]] = False; _ink[_hb[3]:] = False
_ink = dilate_mask(_ink, 1) & NONWHITE & ~dilate_mask(~NONWHITE, 1)
side_clean[_hb[1] - 4:_hb[3] + 4, _hb[0] - 4:_hb[2] + 4] = inpaint_region(side_clean[_hb[1] - 4:_hb[3] + 4, _hb[0] - 4:_hb[2] + 4], _ink[_hb[1] - 4:_hb[3] + 4, _hb[0] - 4:_hb[2] + 4])

# forward-facing snout: the side drawing without its thin outlines (except the lip seam)
SF = L['snout_front']
_lum = side_clean.mean(2)
bx0, by0, bx1, by1 = SF['box']
_lines = (_lum < 150) & (side_clean[..., 0] - side_clean[..., 1] < 50) & (_xx >= bx0) & (_xx < bx1) & (_yy >= by0) & (_yy < by1) & ~near_polyline(SF['seam'], 3) & ~dilate_mask(~NONWHITE, 5)   # keep the silhouette's own ink (v6)
side_soft = soft_fill(side_clean, dilate_mask(_lines, 1) & NONWHITE, 2.5, (bx0 - 10, by0 - 10, bx1 + 10, by1 + 10))

for img_, key, box in [(top_clean, 'top', (460, 490, 1160, 570)), (bot_clean, 'bottom', (760, 780, 1160, 860))]:
    fm = np.zeros(NONWHITE.shape, bool)
    for poly in L['edge_on_fins'][key]:
        fm |= poly_mask(poly, 2)
    img_[:] = soft_fill(img_, fm, 4, box)
top_clean[m & ~NONWHITE] = 255

# front view: the eyes are separate domes, so remove them from the face drawing
front = np.asarray(Image.open(HERE / FR['source']).convert('RGB')).astype(float)
_fy, _fx = np.mgrid[:front.shape[0], :front.shape[1]]
_fm = np.zeros(front.shape[:2], bool)
for cx_, cy_, rx, ry in FR['eyes']:
    _fm |= ((_fx - cx_) / rx) ** 2 + ((_fy - cy_) / ry) ** 2 <= 1
_fnw = front.min(2) < 238
_v = _fnw & ~_fm
front_clean = bleed_edges(front.astype(np.uint8), _v, pixels=90).astype(float)

# extend the fish colours a little past each outline so edge samples never pick up the white paper
for img_ in (side_clean, side_soft, top_clean, bot_clean):
    img_[:] = bleed_edges(np.clip(img_, 0, 255).astype(np.uint8), NONWHITE, pixels=14)
Image.fromarray(np.clip(side_clean[SIDE_Y0:SIDE_Y1], 0, 255).astype(np.uint8)).save(HERE / 'side-clean.png')

bw, bh = BODY[2], BODY[3]
ii, jj = np.meshgrid((np.arange(bw) + .5) / bw, (np.arange(bh) + .5) / bh)
fi, fk = ii * (NS - 1), jj * (NT - 1)
PP, NN = grid_sample(GP, fi, fk), grid_sample(GN, fi, fk)
NN /= np.maximum(np.linalg.norm(NN, axis=-1, keepdims=True), 1e-9)
x, Y, Z = PP[..., 0], PP[..., 1], PP[..., 2]
nx_, ny_, nz_ = NN[..., 0], NN[..., 1], NN[..., 2]
x_s = np.clip(x, X0 + 7, X1 - 2)          # sample inside the drawn snout outline, so its ink does not converge at the tip
r_z = np.interp(x, xs, hw)
zf = Z / r_z
side_col = sample_bilinear(side_clean, x_s, -Y)
_soft = (np.clip((-NN[..., 0] - .35) / .35, 0, 1) * np.clip((SF['x_end'] - x) / 40, 0, 1))[..., None]
side_col = side_col * (1 - _soft) + sample_bilinear(side_soft, x_s, -Y) * _soft
# the very tip: every ring meets at one point, so fade to the lip colour there instead of letting the seam curl
_lip = side_soft[SF['tip_colour'][1] - 4:SF['tip_colour'][1] + 4, SF['tip_colour'][0] - 4:SF['tip_colour'][0] + 4].reshape(-1, 3).mean(0)
_tipw = np.clip((X0 + SF['tip_fade'] - x) / SF['tip_fade'], 0, 1)[..., None] ** .7
side_col = side_col * (1 - _tipw) + _lip * _tipw
# the top view draws the upper lip back to x~80 on the midline, the side view only to x~66 (where the V meets):
# the top view's snout is remapped so its lip edge lands on the side view's
_lw = np.asarray(L['top_view_lip_remap'], float)
x_t = np.interp(x_s, _lw[:, 0], _lw[:, 1])
top_col = sample_bilinear(top_clean, x_t, top_c(x_t) + zf * top_hw(x_t) * .97)
bot_col = sample_bilinear(bot_clean, x_s, bot_c(x_s) - zf * bot_hw(x_s) * .97)
# front view: rows placed by the face landmarks (warp), columns scaled so the drawn lips span the snout
_wp = np.asarray(FR['warp'], float)
Fy = np.interp(-Y, _wp[:, 1], _wp[:, 0])
sF = np.clip(FR['lip_half_width'] / (0.95 * r_z), _fmax / hw.max(), 6.0)
_fw = np.interp(Fy, _fh[:, 0], _fh[:, 1]) * .96
Fx = FR['center_x'] + np.clip(Z * sF, -_fw, _fw)
front_col = sample_bilinear(front_clean, Fx, Fy)
w_side = nz_ ** 2 * (1 + VB['snout_side_boost'] * np.clip((150 - x) / 60, 0, 1))   # the snout stripe (lower V) reads from the side view
fwd = np.clip(-nx_, 0, None)
w_top = np.clip(ny_, 0, None) ** 2.6 * (1 - FR['texture_weight'] / 3 * .7 * fwd)
w_bot = np.clip(-ny_, 0, None) ** 2.6 * (1 - FR['texture_weight'] / 3 * .7 * fwd)
w_front = FR['texture_weight'] * np.clip(fwd - .15, 0, None) ** 1.5
# the chin: the side drawing wraps round both sides and meets cleanly on the midline, while the bottom view
# has only its lip outlines and centre line there
_snout_k = (SF['top_bottom_keep'] + (1 - SF['top_bottom_keep']) * np.clip((x - X0 - SF['side_only_len']) / 20, 0, 1))
w_bot = w_bot * _snout_k
w = w_side + w_top + w_bot + w_front + 1e-6
bake = (side_col * w_side[..., None] + top_col * w_top[..., None] + bot_col * w_bot[..., None]
        + front_col * w_front[..., None]) / w[..., None]
# the V's two arms (the side view's snout-to-eye stripe) are carried on along the surface to meet on the
# midline just in front of the upper lip
_stripe_col = side_clean[_sm].mean(0)
_ax = VB['apex_x']
_vx = np.array([p[0] for p in VB['apex_path']], float); _vy = np.array([p[1] for p in VB['apex_path']], float)
_sel = x < _vx.max() + 12
_pts = PP[_sel]
_dmin = np.full(len(_pts), np.inf)
for sgn in (1, -1):
    px_ = np.concatenate([[_ax], _vx]); py_ = np.concatenate([[float(side_top(_ax)) + 1], _vy])
    pt_ = np.arccos(np.clip((-py_ - np.interp(px_, xs, cy)) / np.interp(px_, xs, hh), -1, 1))
    pt_[0] = 0.0                                    # the apex sits exactly on the dorsal midline
    if sgn < 0:
        pt_ = 2 * math.pi - pt_
    _arc_u = np.concatenate([[0], np.cumsum(np.hypot(np.diff(px_), np.diff(pt_) * 30))])
    _u = np.linspace(0, _arc_u[-1], 120)
    xx_, tt_ = np.interp(_u, _arc_u, px_), np.interp(_u, _arc_u, pt_)
    q = grid_sample(GP, np.interp(xx_, xs, np.arange(NS)), tt_ / (2 * math.pi) * (NT - 1))
    for qq in q:
        _dmin = np.minimum(_dmin, np.linalg.norm(_pts - qq, axis=1))
_va = np.zeros(x.shape); _va[_sel] = np.clip((VB['apex_halfwidth'] - _dmin) / 1.5, 0, 1)
bake = bake * (1 - _va[..., None]) + _stripe_col * _va[..., None]
bake = bake * (1 - _tipw) + _lip * _tipw

atlas = np.full((ATLAS_H, ATLAS_W, 3), 240.0)
atlas[:bh, :bw] = bake


def source_strip(y0, y1):
    src = np.full((y1 - y0 + 8, W_IMG, 3), 255, np.uint8)
    src[:y1 - y0] = sheet[y0:y1]
    valid = np.zeros(src.shape[:2], bool); valid[:y1 - y0] = NONWHITE[y0:y1]
    valid &= ~dilate_mask(~valid, 1)
    return bleed_edges(src, valid, pixels=10).astype(float)


side_src, bot_src = source_strip(SIDE_Y0, SIDE_Y1), source_strip(BOT_Y0, BOT_Y1)
atlas[SIDE_AT[1]:SIDE_AT[1] + side_src.shape[0], :W_IMG] = side_src
atlas[BOT_AT[1]:BOT_AT[1] + bot_src.shape[0], :W_IMG] = bot_src
check_atlas_islands(ATLAS_W, ATLAS_H, [('body', BODY),
                                       ('side_source', (0, SIDE_AT[1], W_IMG, SIDE_AT[1] + side_src.shape[0])),
                                       ('bottom_source', (0, BOT_AT[1], W_IMG, BOT_AT[1] + bot_src.shape[0]))])


def body_z(xp, Yp):
    c, ry, rz = np.interp(xp, xs, cy), np.interp(xp, xs, hh), np.interp(xp, xs, hw)
    return rz * width_frac(xp, (Yp - c) / ry)


meshes = [body]
TH = 0.9


def on_body(free, top):
    """Close a median fin's free outline along the body, a few px inside the outline so the root is buried."""
    xa, xb = free[-1][0], free[0][0]
    base = [(xx, float(side_top(xx) + 5) if top else float(side_bottom(xx) - 5)) for xx in np.linspace(xa, xb, 8)[1:-1]]
    return [tuple(p) for p in free] + base


def inset_uv(outline, uv_fn, px=5.0):
    """Sample a few px inside the drawn outline so the fin's thin rim does not show the black ink line edge-on."""
    c = np.mean(np.asarray(outline, float), axis=0)
    def f(a, b):
        d = np.array([a, b]) - c; n = np.hypot(*d)
        a_, b_ = (np.array([a, b]) - d / n * min(px, n * .5)) if n > 1e-6 else (a, b)
        return uv_fn(a_, b_)
    return f


def median_fin(name, outline, th=TH, root=None):
    def pt(a, b, l):
        g = 1.0
        if root is not None:                       # caudal: thick at the peduncle, thin membrane further out
            g = 1 + 6 * max(0.0, 1 - (a - root) / 40) ** 1.5
        return (a, -b, l * th * g)
    return fin(name, outline, pt, inset_uv(outline, side_uv), subdivisions=2)


meshes.append(median_fin('dorsal1', on_body(L['dorsal1'], True)))
meshes.append(median_fin('dorsal2', on_body(L['dorsal2'], True)))
meshes.append(median_fin('anal', on_body(L['anal'], False)))
cau = [tuple(p) for p in L['caudal']]
meshes.append(median_fin('caudal', cau + [(1204, 302), (1198, 245), (1204, 193)], root=1214))

# pectoral fans: the side outline gives x/y; they splay outward from the root (x≈402) and droop slightly
bx, by = P['base']
lo_y, hi_y = side_top(bx) + 6, side_bottom(bx) - 6


def pectoral(sign):
    """One flat fan: the side outline is swung out about the vertical root line (x = bx) by a fixed angle."""
    ca, sa = math.cos(math.radians(P['angle_deg'])), math.sin(math.radians(P['angle_deg']))
    z0 = float(body_z(bx, -by)) - P['root_inset']

    def pt(a, b, l):
        d = a - bx
        return (bx + d * ca, -b, sign * (z0 + d * sa + l * TH))
    poly = P['outline'] if sign > 0 else P['outline'][::-1]
    return fin('pectoral_' + ('near' if sign > 0 else 'far'), poly, pt, inset_uv(poly, side_uv), subdivisions=2)


meshes += [pectoral(1), pectoral(-1)]

# fused pelvic disc (bottom view ellipse): a shallow dome hanging under the belly, rim buried in the body
D = L['pelvic_disc']
dcx, dcz = D['center']
ring = [(dcx + D['rx'] * math.cos(a), dcz + D['rz'] * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 48, endpoint=False)]


def disc_pt(a, b, l):
    r2 = ((a - dcx) / D['rx']) ** 2 + ((b - dcz) / D['rz']) ** 2
    zs = (dcz - b) * float(half_width(a) / bot_hw(a))
    yb_ = float(side_bottom(a))
    return (a, -(yb_ - 6 + D['drop'] * math.sqrt(max(1 - r2, 0)) ** .6) + l * 1.2, zs)


meshes.append(fin('pelvic_disc', ring, disc_pt, inset_uv(ring, bot_uv), subdivisions=3))

# eyes: low domes built as a height field over the drawn eye disc, the rim on the head surface
ex, ey = E['center']; er = E['radius']; bulge = E['bulge']; up_bias = E['up_bias']
tex_x, tex_y = E.get('texture_center', E['center'])          # the dome may sit lower than the drawn eye (front view)
lean, gaze = E.get('lean', 0.0), E.get('gaze', 0.0)
for sign, name in [(1, 'eye_near'), (-1, 'eye_far')]:
    nr, nv = 14, 40
    Pp = []; UV = []
    for i in range(nr + 1):
        rr = er * i / nr
        for j in range(nv if i else 1):
            ph = 2 * math.pi * j / nv
            dx, dy = rr * math.cos(ph), rr * math.sin(ph)
            q = rr / er
            h = bulge * math.sqrt(max(1 - q * q, 0)) * (1 + up_bias * (-dy / er))
            zs = float(body_z(ex + dx, -(ey + dy)))
            # the dome leans forward and the drawn pupil is moved toward its front, so the eyes look
            # forward-outward as in the front view (the rim keeps the drawn position)
            g = math.sqrt(max(1 - q * q, 0))
            Pp.append((ex + dx - lean * max(h, 0), -(ey + dy), sign * (zs - 0.3 + max(h, 0))))
            UV.append(side_uv(tex_x + dx + gaze * er * g, tex_y + dy))
    rg = lambda i, j: 0 if i == 0 else 1 + (i - 1) * nv + (j % nv)
    F = [[0, rg(1, j), rg(1, j + 1)] for j in range(nv)]
    for i in range(1, nr):
        for j in range(nv):
            F += [[rg(i, j), rg(i + 1, j), rg(i, j + 1)], [rg(i, j + 1), rg(i + 1, j), rg(i + 1, j + 1)]]
    nb = len(Pp)
    for j in range(nv):
        x_, y_, z_ = Pp[rg(nr, j)]; Pp.append((x_, y_, z_ - sign * 2.5)); UV.append(UV[rg(nr, j)])
    cb = len(Pp); Pp.append((ex, -ey, sign * (float(body_z(ex, -ey)) - 3))); UV.append(side_uv(tex_x + gaze * er, tex_y))
    for j in range(nv):
        F += [[rg(nr, j), nb + j, rg(nr, j + 1)], [rg(nr, j + 1), nb + j, nb + (j + 1) % nv], [nb + j, cb, nb + (j + 1) % nv]]
    Pp = np.asarray(Pp)
    meshes.append(Mesh(name, Pp, UV, orient_closed(Pp, F)))

for m_ in meshes:
    m_.check()
atlas_u8 = np.clip(atlas, 0, 255).astype(np.uint8)
meshes = scale_to_length(meshes, L['length_m'])
OUT.mkdir(parents=True, exist_ok=True)
Image.fromarray(atlas_u8).save(OUT / 'atlas.png')
meta = {'units': 'meters', 'up': '+Y', 'forward': '-X', 'species': 'Rhinogobius mizunoi (ルリヨシノボリ)',
        'scale_assumption': '全長0.08 m（吻端〜尾鰭端）', 'source_views': ['sheet-v1 (side/top/bottom rows)']}
export_glb(meshes, atlas_u8, OUT / 'ruri-yoshinobori.glb', metadata=meta)
write_preview(meshes, atlas_u8, OUT / 'preview.html', title='ルリヨシノボリ 3Dモデル ' + VERSION,
              glb_filename='ruri-yoshinobori.glb', description='ユーザー提供の三面図から作成。全長8 cm（仮スケール）。')
json.dump({m.name: len(m.faces) for m in meshes}, open(OUT / 'parts.json', 'w'), ensure_ascii=False, indent=1)
print('ok', sum(len(m.faces) for m in meshes), 'triangles')
