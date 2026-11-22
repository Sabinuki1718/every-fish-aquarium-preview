"""Web/sharing helpers for fish models and aquariums (Python standard library + NumPy + Pillow).

- glb_to_json / write_fish_assets: a GLB from build-fish-3d-from-views -> geometry JSON + atlas JPGs.
  Readable formats: Claude Artifacts do not serve .glb, and public-share review needs plain data
  (not base64 blobs).
- online_three_loader: import map + module that loads three.js from jsDelivr and then classic scripts.
- offline_document: one self-contained HTML file (three.js, scripts and assets inlined) for file:// use.
- data_uri: file -> data: URI for the offline file.

CLI:  python web_bundle.py fish <model.glb> <out_dir> <name>   -> <name>.json, <name>-2048.jpg, <name>-1024.jpg
"""
from __future__ import annotations
import base64, io, json, mimetypes, struct, sys
from pathlib import Path
import numpy as np
from PIL import Image

THREE_VERSION = '0.170.0'
THREE_CDN = f'https://cdn.jsdelivr.net/npm/three@{THREE_VERSION}'
SKILLS = Path(__file__).resolve().parents[2]
THREE_OFFLINE = SKILLS / 'fish-to-3d-aquarium/assets/three-offline.js'      # r170 + OrbitControls etc. (window.THREE)
FISH_LOADER = Path(__file__).resolve().parents[1] / 'assets/fish-json-loader.js'


def glb_to_json(path):
    """Single-buffer GLB (our exporter) -> ({meshes:[{name, opacity, p, n, uv, i}]}, atlas PIL image).

    opacity < 1 marks alpha-blended parts (e.g. translucent eye sacs); double_sided / depth_write are passed on
    when the material sets them. Numbers are rounded to keep JSON small.
    """
    raw = Path(path).read_bytes()
    if raw[:4] != b'glTF':
        raise ValueError(f'{path}: not a GLB')
    jl = struct.unpack_from('<I', raw, 12)[0]
    doc = json.loads(raw[20:20 + jl])
    bl = struct.unpack_from('<I', raw, 20 + jl)[0]
    binary = raw[28 + jl:28 + jl + bl]
    if len(doc.get('images', [])) != 1 or doc.get('extensionsRequired'):
        raise ValueError(f'{path}: expected one embedded atlas and no required extensions')

    def arr(i):
        a = doc['accessors'][i]; v = doc['bufferViews'][a['bufferView']]
        dt = {5126: '<f4', 5125: '<u4', 5123: '<u2'}[a['componentType']]
        n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3}[a['type']]
        return np.frombuffer(binary, dtype=dt, count=a['count'] * n, offset=v.get('byteOffset', 0) + a.get('byteOffset', 0))

    meshes = []
    for m in doc['meshes']:
        for k, pr in enumerate(m['primitives']):
            mat = doc['materials'][pr.get('material', 0)]
            at = pr['attributes']
            opacity = mat['pbrMetallicRoughness'].get('baseColorFactor', [1, 1, 1, 1])[3] if mat.get('alphaMode') == 'BLEND' else 1
            # a translucent closed body can ask to be drawn front faces only and to write depth (extras.depthWrite),
            # so its own back faces and the fins behind it do not show through too strongly
            extra = {}
            if mat.get('doubleSided', True) is False:
                extra['double_sided'] = False
            if 'depthWrite' in mat.get('extras', {}):
                extra['depth_write'] = bool(mat['extras']['depthWrite'])
            meshes.append({'name': m['name'] + (f':{k}' if k else ''), 'opacity': opacity, **extra,
                           'p': [round(float(x), 5) for x in arr(at['POSITION'])],
                           'n': [round(float(x), 3) for x in arr(at['NORMAL'])],
                           'uv': [round(float(x), 5) for x in arr(at['TEXCOORD_0'])],
                           'i': arr(pr['indices']).tolist()})
    v = doc['bufferViews'][doc['images'][0]['bufferView']]
    atlas = Image.open(io.BytesIO(binary[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']])).convert('RGB')
    meta = doc['nodes'][0].get('extras', {}) if doc.get('nodes') else {}
    return {'units': meta.get('units', 'meters'), 'up': '+Y', 'forward': meta.get('forward', '-X'), 'meshes': meshes}, atlas


def write_fish_assets(glb, out_dir, name, sizes=(2048, 1024)):
    """Write <name>.json and <name>-<size>.jpg; return {'geometry': rel, '<size>': rel, ...} relative to out_dir."""
    out = Path(out_dir); out.mkdir(parents=True, exist_ok=True)
    geo, atlas = glb_to_json(glb)
    (out / f'{name}.json').write_text(json.dumps(geo, separators=(',', ':')), encoding='utf8')
    urls = {'geometry': f'{name}.json'}
    for s in sizes:
        atlas.resize((s, s), Image.LANCZOS).save(out / f'{name}-{s}.jpg', quality=86 if s >= 2048 else 82)
        urls[str(s)] = f'{name}-{s}.jpg'
    return urls


def online_three_loader(scripts, addons=('controls/OrbitControls.js:OrbitControls',)):
    """HTML that loads three.js r170 from jsDelivr into window.THREE (+ addons), then the given classic scripts in order."""
    imports = '\n'.join(f"import {{ {sym} }} from '{THREE_CDN}/examples/jsm/{p}';" for p, sym in (a.split(':') for a in addons))
    syms = ', '.join(a.split(':')[1] for a in addons)
    lst = json.dumps(list(scripts))
    return (f'<script type="importmap">{{"imports":{{"three":"{THREE_CDN}/build/three.module.js"}}}}</script>\n'
            '<script type="module">\n'
            "import * as T from 'three';\n" + imports + '\n'
            f'window.THREE = Object.assign({{}}, T, {{ {syms} }});\n'
            f'for (const src of {lst}) {{\n'
            "  await new Promise((ok, fail) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = fail; document.head.append(s); });\n"
            '}\n</script>')


def data_uri(path, mime=None):
    p = Path(path)
    mime = mime or mimetypes.guess_type(p.name)[0] or 'application/octet-stream'
    return f'data:{mime};base64,' + base64.b64encode(p.read_bytes()).decode()


def _inline(path):
    return '<script>\n' + Path(path).read_text(encoding='utf8').replace('</script', '<\\/script') + '\n</script>'


def offline_document(fragment, assets_var, assets, scripts, marker='__SCRIPTS__', lang='ja'):
    """Full HTML for file:// use. `fragment` is the Artifact-style page (<title>/<style>/markup) containing `marker`.

    `assets` (already data: URIs) is assigned to window[assets_var]; three-offline.js and `scripts` are inlined.
    """
    head, sep, body = fragment.partition('<div')                     # <title>/<style>/<link> go in <head>
    if not sep:
        raise ValueError('fragment has no <div> body')
    body = sep + body
    tail = (f'<script>window.{assets_var}=' + json.dumps(assets, ensure_ascii=False) + ';</script>\n'
            + _inline(THREE_OFFLINE) + '\n' + '\n'.join(_inline(s) for s in scripts))
    return (f'<!doctype html>\n<html lang="{lang}"><head><meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
            + head + '</head><body>\n' + body.replace(marker, tail) + '\n</body></html>\n')


if __name__ == '__main__':
    if len(sys.argv) == 5 and sys.argv[1] == 'fish':
        print(json.dumps(write_fish_assets(sys.argv[2], sys.argv[3], sys.argv[4]), ensure_ascii=False))
    else:
        sys.exit(__doc__)
