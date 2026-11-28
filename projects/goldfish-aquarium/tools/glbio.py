"""Minimal GLB reader for single-mesh Tripo exports: positions, normals, uvs, indices, embedded images."""
import json, struct, numpy as np
CT = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}
def read(path):
    d = open(path, 'rb').read()
    jl = struct.unpack_from('<I', d, 12)[0]; doc = json.loads(d[20:20 + jl])
    bl = struct.unpack_from('<I', d, 20 + jl)[0]; bin_ = d[28 + jl:28 + jl + bl]
    def acc(i):
        a = doc['accessors'][i]; bv = doc['bufferViews'][a['bufferView']]
        off = bv.get('byteOffset', 0) + a.get('byteOffset', 0); n = a['count'] * NC[a['type']]
        arr = np.frombuffer(bin_, CT[a['componentType']], n, off)
        return arr.reshape(a['count'], NC[a['type']]) if NC[a['type']] > 1 else arr
    pr = doc['meshes'][0]['primitives'][0]; at = pr['attributes']
    out = {'P': acc(at['POSITION']).astype(np.float64), 'N': acc(at['NORMAL']).astype(np.float64) if 'NORMAL' in at else None,
           'UV': acc(at['TEXCOORD_0']).astype(np.float64), 'I': acc(pr['indices']).astype(np.int64).reshape(-1, 3), 'images': {}, 'doc': doc}
    for im in doc.get('images', []):
        bv = doc['bufferViews'][im['bufferView']]; o = bv.get('byteOffset', 0)
        out['images'][im.get('name', str(len(out['images'])))] = bin_[o:o + bv['byteLength']]
    mat = doc['materials'][pr.get('material', 0)]; out['material'] = mat
    return out
