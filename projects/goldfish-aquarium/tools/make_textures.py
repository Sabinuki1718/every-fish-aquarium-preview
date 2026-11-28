"""Procedural, tileable textures for the aquarium (user chose program-made stones first; Tripo later if needed).
gravel-oiso.jpg / gravel-oiso-n.jpg : 大磯砂 (rounded mixed pebbles) colour + normal map, one tile = 10 cm
stone-blue.jpg / stone-red.jpg / stone-n.jpg : weathered stone skin (blue-grey / rusty), normal map
background.jpg : back screen
usage: python tools/make_textures.py"""
import numpy as np
from PIL import Image
from pathlib import Path
OUT = Path(__file__).resolve().parents[1] / 'aquarium' / 'textures'
rng = np.random.default_rng(1718)

def fbm(n, beta, seed):
    r = np.random.default_rng(seed); w = r.standard_normal((n, n))
    f = np.fft.fftfreq(n); fx, fy = np.meshgrid(f, f); k = np.sqrt(fx**2 + fy**2); k[0, 0] = 1
    out = np.real(np.fft.ifft2(np.fft.fft2(w) / k**beta)); out -= out.mean(); return out / out.std()

def normal_map(h, strength):
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * strength; gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * strength
    n = np.stack([-gx, gy, np.ones_like(h)], -1); n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return Image.fromarray(((n * 0.5 + 0.5) * 255).astype(np.uint8))

def gravel(n=1024, cells=22):
    cs = n / cells
    jit = rng.random((cells, cells, 2)) * 0.6 + 0.2
    rad = (rng.random((cells, cells)) * 0.25 + 0.5) * cs; asp = rng.random((cells, cells)) * 0.35 + 0.7; ang = rng.random((cells, cells)) * np.pi
    pal = np.array([[38, 36, 34], [58, 55, 51], [86, 82, 76], [112, 104, 94], [70, 58, 46], [128, 112, 92], [150, 146, 138], [190, 184, 172], [96, 74, 60], [48, 52, 56]], float)
    prob = np.array([.18, .17, .14, .1, .1, .07, .07, .04, .06, .07]); prob /= prob.sum()
    col = pal[rng.choice(len(pal), (cells, cells), p=prob)] * (0.85 + 0.3 * rng.random((cells, cells, 1)))
    yy, xx = np.mgrid[0:n, 0:n] + 0.5
    ci, cj = (yy // cs).astype(int), (xx // cs).astype(int)
    H = np.zeros((n, n)); C = np.zeros((n, n, 3)); NX = np.zeros((n, n)); NY = np.zeros((n, n))
    for di in (-1, 0, 1):
        for dj in (-1, 0, 1):
            i = (ci + di) % cells; j = (cj + dj) % cells
            py = (ci + di + jit[i, j, 0]) * cs; px = (cj + dj + jit[i, j, 1]) * cs
            dy, dx = yy - py, xx - px; a = ang[i, j]
            u = (dx * np.cos(a) + dy * np.sin(a)) / rad[i, j]; v = (-dx * np.sin(a) + dy * np.cos(a)) / (rad[i, j] * asp[i, j])
            d2 = u * u + v * v; h = np.sqrt(np.clip(1 - d2, 0, 1)) * (0.8 + 0.4 * (rad[i, j] / cs))
            upd = h > H
            H = np.where(upd, h, H); C = np.where(upd[..., None], col[i, j], C)
    grain = fbm(n, 0.6, 3); fine = fbm(n, 0.15, 4)
    gx = np.roll(H, -1, 1) - np.roll(H, 1, 1); gy = np.roll(H, -1, 0) - np.roll(H, 1, 0)
    shade = np.clip(0.75 - (gx * 0.7 + gy * 0.7) * 6, 0.35, 1.25)       # light from the upper left
    gap = np.array([40, 37, 33.]) * (0.8 + 0.25 * fine[..., None])        # fine grit between pebbles
    peb = C * shade[..., None] * (1 + 0.05 * grain[..., None])
    m = np.clip(H * 6, 0, 1)[..., None]
    c = peb * m + gap * (1 - m)
    Image.fromarray(np.clip(c, 0, 255).astype(np.uint8)).save(OUT / 'gravel-oiso.jpg', quality=90)
    normal_map(H * 5 + fine * 0.1, 1.0).save(OUT / 'gravel-oiso-n.jpg', quality=90)

def stone(n=1024):
    h = fbm(n, 1.15, 11) * 0.7 + fbm(n, 0.8, 12) * 0.3
    vein = np.abs(np.sin(np.linspace(0, 12 * np.pi, n)[None, :] + fbm(n, 1.3, 13) * 2.2))
    vein = np.clip(1 - vein * 7, 0, 1)
    speck = (fbm(n, 0.2, 14) > 2.3).astype(float)
    pits = np.clip(-fbm(n, 0.7, 15) - 1.6, 0, 1)
    for name, base, accent in [('stone-blue', (104, 114, 122), (78, 88, 98)), ('stone-red', (126, 98, 82), (96, 64, 52))]:
        base = np.array(base, float); accent = np.array(accent, float)
        t = np.clip(h * 0.5 + 0.5, 0, 1)[..., None]
        c = base * (1 - t) + accent * t
        c = c * (1 + 0.12 * fbm(n, 0.5, 16)[..., None]) + vein[..., None] * 55 + speck[..., None] * 35 - pits[..., None] * 40
        Image.fromarray(np.clip(c, 0, 255).astype(np.uint8)).save(OUT / f'{name}.jpg', quality=90)
    normal_map(h * 2.0 + fbm(n, 0.5, 17) * 0.3 - pits * 1.5, 2.0).save(OUT / 'stone-n.jpg', quality=90)

def background(w=1024, hgt=512):
    y = np.linspace(0, 1, hgt)[:, None, None]
    top = np.array([150, 196, 208.]); mid = np.array([92, 146, 162.]); bot = np.array([48, 86, 102.])
    c = np.where(y < 0.6, top * (1 - y / 0.6) + mid * (y / 0.6), mid * (1 - (y - 0.6) / 0.4) + bot * ((y - 0.6) / 0.4))
    c = np.broadcast_to(c, (hgt, w, 3)).copy()
    c *= (1 + 0.05 * fbm(1024, 1.4, 21)[:hgt, :w, None])
    Image.fromarray(np.clip(c, 0, 255).astype(np.uint8)).save(OUT / 'background.jpg', quality=90)

if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True); gravel(); stone(); background(); print(sorted(p.name for p in OUT.iterdir()))
