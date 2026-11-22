"""Turn generated material images into aquarium textures (Pillow + NumPy). Keeps the source image unchanged.

  seamless   <in> <out> [--crop x0 y0 x1 y1] [--size N]   tileable floor/stone texture (half-offset blend)
  cutout     <in> <out> [--lo 0.05 --hi 0.22] [--height N] [--no-trim]
                                                         alpha from distance to the paper/background white;
                                                         prints base_u = where a stem leaves the bottom edge
  background <in> <out> [--trim PX] [--width N]          trim a torn/painted border, resize
  sheet      <out> <in>...                                contact sheet on red, to eyeball tiling and cut-outs
"""
from __future__ import annotations
import argparse, json
from pathlib import Path
import numpy as np
from PIL import Image


def seamless(img):
    """Blend with a half-offset copy; the original's weight falls to 0 at the edges, so the result wraps."""
    a = np.asarray(img.convert('RGB')).astype(float)
    h, w = a.shape[:2]
    b = np.roll(np.roll(a, h // 2, axis=0), w // 2, axis=1)
    m = np.minimum.outer(np.sin(np.linspace(0, np.pi, h)) ** 1.5, np.sin(np.linspace(0, np.pi, w)) ** 1.5)[..., None]
    return Image.fromarray(np.clip(a * m + b * (1 - m), 0, 255).astype(np.uint8))


def cutout(img, lo=0.05, hi=0.22):
    """RGBA whose alpha grows with distance from the background white (soft watercolour edges keep their colour)."""
    a = np.asarray(img.convert('RGB')).astype(float) / 255
    paper = np.percentile(a.reshape(-1, 3), 99, axis=0)       # the background's own white, not pure #fff
    d = np.max(np.clip(paper - a, 0, 1), axis=2)
    alpha = np.clip((d - lo) / (hi - lo), 0, 1)
    return Image.fromarray((np.dstack([a, alpha]) * 255).astype(np.uint8), 'RGBA')


def trim(rgba, pad=6):
    bbox = rgba.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
    if not bbox:
        raise ValueError('nothing left after cut-out: check --lo/--hi')
    return rgba.crop((max(bbox[0] - pad, 0), max(bbox[1] - pad, 0), min(bbox[2] + pad, rgba.width), min(bbox[3] + 2, rgba.height)))


def base_u(rgba):
    """Horizontal position (0..1) of the opaque pixels along the bottom rows: the stem's foot on a plant card."""
    al = np.asarray(rgba.getchannel('A'))
    rows = al[-max(4, al.shape[0] // 40):] > 128
    return float(np.nonzero(rows)[1].mean() / al.shape[1]) if rows.any() else 0.5


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    s = sub.add_parser('seamless'); s.add_argument('src'); s.add_argument('out')
    s.add_argument('--crop', type=int, nargs=4); s.add_argument('--size', type=int)
    c = sub.add_parser('cutout'); c.add_argument('src'); c.add_argument('out')
    c.add_argument('--lo', type=float, default=.05); c.add_argument('--hi', type=float, default=.22)
    c.add_argument('--height', type=int); c.add_argument('--no-trim', action='store_true')
    b = sub.add_parser('background'); b.add_argument('src'); b.add_argument('out')
    b.add_argument('--trim', type=int, default=8); b.add_argument('--width', type=int, default=1600)
    t = sub.add_parser('sheet'); t.add_argument('out'); t.add_argument('src', nargs='+')
    a = ap.parse_args()

    if a.cmd == 'seamless':
        im = Image.open(a.src).convert('RGB')
        if a.crop: im = im.crop(tuple(a.crop))
        if a.size: im = im.resize((a.size, a.size), Image.LANCZOS)
        seamless(im).save(a.out, quality=88)
    elif a.cmd == 'cutout':
        im = cutout(Image.open(a.src), a.lo, a.hi)
        if not a.no_trim: im = trim(im)
        if a.height: im = im.resize((round(im.width * a.height / im.height), a.height), Image.LANCZOS)
        im.save(a.out, optimize=True)
        print(json.dumps({'size': im.size, 'base_u': round(base_u(im), 4)}))
    elif a.cmd == 'background':
        im = Image.open(a.src).convert('RGB'); k = a.trim
        im = im.crop((k, k, im.width - k, im.height - k))
        im.resize((a.width, round(im.height * a.width / im.width)), Image.LANCZOS).save(a.out, quality=88)
    elif a.cmd == 'sheet':
        tiles = []
        for p in a.src:
            im = Image.open(p); im.thumbnail((256, 256))
            if im.mode != 'RGBA':                      # tile 2x2 so seams show
                t2 = Image.new('RGB', (im.width * 2, im.height * 2))
                for i in range(2):
                    for j in range(2): t2.paste(im, (i * im.width, j * im.height))
                im = t2
            tiles.append(im)
        W = sum(t.width for t in tiles) + 10 * (len(tiles) + 1); H = max(t.height for t in tiles) + 20
        sheet = Image.new('RGB', (W, H), (200, 90, 90)); x = 10
        for t in tiles:
            sheet.paste(t, (x, 10), t if t.mode == 'RGBA' else None); x += t.width + 10
        sheet.save(a.out)


if __name__ == '__main__':
    main()
