"""Read back gin-suihogan.glb: validate, list morph targets / the 'idle' clip, render posed states.

python check_glb.py v1  -> prints a JSON summary, writes check-*.png into the version folder
"""
from pathlib import Path
import io, json, math, struct, sys
import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[5] / '.agents/skills/build-fish-3d-from-views/scripts'))
from fish_mesh import Mesh, render

OUT = HERE.parent / (sys.argv[1] if len(sys.argv) > 1 else 'v1')
raw = (OUT / 'gin-suihogan.glb').read_bytes()
assert raw[:4] == b'glTF' and struct.unpack_from('<I', raw, 8)[0] == len(raw)
jl = struct.unpack_from('<I', raw, 12)[0]; doc = json.loads(raw[20:20 + jl]); binary = raw[28 + jl:]


def arr(i):
    a = doc['accessors'][i]; v = doc['bufferViews'][a['bufferView']]
    dt = {5126: '<f4', 5125: '<u4'}[a['componentType']]; n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3}[a['type']]
    x = np.frombuffer(binary, dtype=dt, count=a['count'] * n, offset=v.get('byteOffset', 0) + a.get('byteOffset', 0))
    assert np.isfinite(x).all() if dt == '<f4' else True
    return x.reshape(-1, n) if n > 1 else x


tex_v = doc['bufferViews'][doc['images'][0]['bufferView']]
tex = Image.open(io.BytesIO(binary[tex_v['byteOffset']:tex_v['byteOffset'] + tex_v['byteLength']])).convert('RGBA')
parts = []
for node_i, m in enumerate(doc['meshes']):
    pr = m['primitives'][0]; a = pr['attributes']
    base = Mesh(m['name'], arr(a['POSITION']), arr(a['TEXCOORD_0']), arr(pr['indices']).reshape(-1, 3), arr(a['NORMAL']))
    tg = [arr(t['POSITION']) for t in pr.get('targets', [])]
    parts.append((base, tg, m.get('extras', {}).get('targetNames', [])))
anim = doc['animations'][0]
times = arr(anim['samplers'][0]['input'])
clip = {}
for ch in anim['channels']:
    s = anim['samplers'][ch['sampler']]; name = doc['nodes'][ch['target']['node']]['name']
    n_t = len(parts[ch['target']['node'] - 1][1])
    clip[name] = arr(s['output']).reshape(len(times), n_t)


def pose(weights):
    out = []
    for base, tg, names in parts:
        p = base.positions.astype(float).copy()
        for w, d in zip(weights.get(base.name, []), tg):
            p += w * d
        out.append(Mesh(base.name, p, base.uv, base.faces))
    return out


loop_ok = all(np.allclose(w[0], w[-1], atol=1e-4) for w in clip.values())
summary = {'meshes': len(parts), 'vertices': sum(len(b.positions) for b, _, _ in parts), 'triangles': sum(len(b.faces) for b, _, _ in parts),
           'texture': tex.size, 'clip': anim['name'], 'duration': float(times[-1]), 'keys': len(times), 'channels': len(clip), 'loop_ends_match': bool(loop_ok),
           'targets': {b.name: names for b, _, names in parts if names}}
print(json.dumps(summary, ensure_ascii=False))

head_target = None
allp = np.concatenate([b.positions for b, _, _ in parts]); L_ = np.ptp(allp[:, 0])
head = np.array([allp[:, 0].min() + .18 * L_, allp[:, 1].mean() * 0 - .002, 0])
states = {'closed': {}, 'open': {n: [1.0] for n in ('body', 'gill_near', 'gill_far', 'mouth_cavity', 'mouth_lining')}}
for st, w in states.items():
    ms = pose(w)
    for vn, (yaw, pitch) in {'head_rear': (-.9, .15), 'head_front': (1.2, .05), 'head_below': (.6, -.9)}.items():
        render(ms, tex, OUT / f'check-{st}-{vn}.png', yaw=yaw, pitch=pitch, target=head, radius=.03, width=640, height=480)
# fin extremes from the clip (max |weights| frames)
for k, frac in [('t0', 0.0), ('t1', .125), ('t2', .25), ('t3', .375)]:
    i = int(frac * (len(times) - 1))
    ms = pose({n: clip[n][i] for n in clip})
    render(ms, tex, OUT / f'check-clip-{k}-oblique.png', yaw=.6, pitch=.3, width=640, height=480)
    render(ms, tex, OUT / f'check-clip-{k}-top.png', yaw=0, pitch=math.pi / 2 - 1e-3, width=640, height=480)
