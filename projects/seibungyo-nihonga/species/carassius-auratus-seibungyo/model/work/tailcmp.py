"""Compare the caudal spread of a built GLB with the top view: per x, outer |z| (side px)."""
import json, struct, sys, numpy as np
from PIL import Image
V = sys.argv[1]
rep = json.load(open(f'../{V}/build-report.json')); sc, cen = rep['scale'], np.array(rep['center_px'])
raw = open(f'../{V}/seibungyo.glb', 'rb').read(); jl = struct.unpack_from('<I', raw, 12)[0]; doc = json.loads(raw[20:20 + jl]); b = raw[28 + jl:]
m = [x for x in doc['meshes'] if x['name'] == 'caudal_near'][0]['primitives'][0]
a = doc['accessors'][m['attributes']['POSITION']]; v = doc['bufferViews'][a['bufferView']]
P = np.frombuffer(b, '<f4', a['count'] * 3, v['byteOffset']).reshape(-1, 3) / sc + cen
L = json.load(open('landmarks.json')); T = L['top']
K = (850 - 238) / (T['peduncle_x'] - T['snout_x'])
img = np.asarray(Image.open(T['image'].replace('../../', '../../')).convert('RGB')).astype(int)
mask = np.abs(img - 255).max(2) > 18
for xs in range(880, 1260, 40):
    sel = np.abs(P[:, 0] - xs) < 12
    xt = int(T['snout_x'] + (xs - 238) / K)
    col = np.nonzero(mask[:, xt])[0]
    top_half = (393 - col.min()) * K if len(col) else 0
    print(xs, 'model', round(float(np.abs(P[sel, 2]).max()) if sel.any() else 0, 1), 'top', round(top_half, 1))
