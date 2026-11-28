"""Photo-based Oiso gravel textures from the user's generated images (aquarium/textures/source/):
gravel-oiso.jpg (seamless colour), gravel-oiso-n.jpg (normal), gravel-oiso-h.jpg (height, for parallax),
gravel-side.jpg (front-glass cross-section, tileable horizontally).
usage: python tools/make_gravel.py"""
import numpy as np
from PIL import Image, ImageFilter
from pathlib import Path
T = Path(__file__).resolve().parents[1] / 'aquarium' / 'textures'
rng = np.random.default_rng(5)

def blur(a, r):
    """Separable gaussian blur with wrap-around (keeps tiles seamless)."""
    k = np.exp(-0.5 * (np.arange(-int(3 * r), int(3 * r) + 1) / r) ** 2); k /= k.sum()
    out = a.astype(np.float64)
    for ax in (0, 1):
        acc = np.zeros_like(out)
        for i, kv in enumerate(k): acc += kv * np.roll(out, i - len(k) // 2, ax)
        out = acc
    return out

def seamless(img, band=0.22):
    """Blend with a half-shifted copy; a noisy feathered cross mask hides the copy's seams under the original."""
    a = np.asarray(img).astype(np.float32); h, w = a.shape[:2]
    b = np.roll(a, (h // 2, w // 2), (0, 1))                       # seams of b are now in the middle cross
    y, x = np.mgrid[0:h, 0:w]
    dx = np.abs(x - w / 2) / (w / 2); dy = np.abs(y - h / 2) / (h / 2)
    noise = blur(rng.standard_normal((h, w)), 10); noise = noise / noise.std() * 0.05
    # weight of the ORIGINAL: 1 near its centre cross... original seams are at the borders -> use b near borders
    d = np.minimum(1 - dx, 1 - dy)                                  # 0 at the border, 1 at the centre lines
    L = a.mean(2) / 255; Lb = b.mean(2) / 255
    gaps = blur(np.minimum(L, Lb), 1.0)                              # prefer cutting through the dark gaps between pebbles
    wa = (d + noise * 1.6 + (gaps - 0.25) * 0.12 > band * 0.5).astype(np.float64)
    wa = blur(wa, 1.2)
    # pebble-aware: snap the mask to pebble boundaries (dark gaps) by sharpening with local luminance
    return (a * wa[..., None] + b * (1 - wa[..., None])).astype(np.uint8)

def height_from(rgb):
    L = rgb.astype(np.float32).mean(2) / 255
    hp = L - blur(L, 10)                       # local relief: pebble tops bright, gaps dark
    gap = blur(np.clip(blur(L, 1.2) - blur(L, 6) , -1, 0), 1)
    h = blur(hp, 1.5) * 2.2 + gap * 1.5
    h = (h - h.min()) / (h.max() - h.min())
    return h

def normal_from(h, s):
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * s; gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * s
    n = np.stack([-gx, gy, np.ones_like(h)], -1); n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return Image.fromarray(((n * 0.5 + 0.5) * 255).astype(np.uint8))

top = Image.open(T / 'source/gravel-top-generated.jpg').convert('RGB')
top = top.resize((1024, 1024), Image.LANCZOS)
st = seamless(top)
Image.fromarray(st).save(T / 'gravel-oiso.jpg', quality=92)
h = height_from(st)
Image.fromarray((h * 255).astype(np.uint8)).save(T / 'gravel-oiso-h.jpg', quality=92)
normal_from(h, 6.0).save(T / 'gravel-oiso-n.jpg', quality=92)
# side: crop the gravel band, make it tile left-right
side = Image.open(T / 'source/gravel-side-generated.jpg').convert('RGB')
W, H = side.size
band = side.crop((int(W * 0.03), int(H * 0.52), int(W * 0.97), int(H * 0.95)))
b = np.asarray(band.resize((1024, 320), Image.LANCZOS)).astype(np.float32)
o = 96; mix = np.linspace(0, 1, o)[None, :, None]
b2 = b.copy(); b2[:, :o] = b[:, :o] * mix + b[:, -o:] * (1 - mix)
Image.fromarray(b2[:, :-o].astype(np.uint8)).save(T / 'gravel-side.jpg', quality=90)
print('done')
