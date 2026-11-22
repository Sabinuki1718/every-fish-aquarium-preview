"""Inspect GLB/glTF metadata without modifying files or loading external resources."""
import argparse
import json
import struct
import sys
from pathlib import Path


def read_document(path):
    data = path.read_bytes()
    if data[:4] == b'glTF':
        if len(data) < 20:
            raise ValueError('Truncated GLB header')
        _, version, size = struct.unpack_from('<4sII', data)
        if version != 2 or size != len(data):
            raise ValueError('Expected a complete GLB version 2 file')
        length, kind = struct.unpack_from('<II', data, 12)
        if kind != 0x4E4F534A or 20 + length > len(data):
            raise ValueError('Invalid JSON chunk')
        document = json.loads(data[20:20 + length].decode('utf-8').rstrip('\x00 \t\r\n'))
    else:
        document = json.loads(data.decode('utf-8-sig'))
    if not isinstance(document, dict) or str(document.get('asset', {}).get('version', '')) != '2.0':
        raise ValueError('Expected a glTF 2.0 document')
    return document


def summarize(document):
    accessors = document.get('accessors', [])
    meshes = []
    for index, mesh in enumerate(document.get('meshes', [])):
        primitives = []
        for primitive in mesh.get('primitives', []):
            position = accessors[primitive['attributes']['POSITION']]
            primitives.append({
                'vertices': position['count'], 'mode': primitive.get('mode', 4),
                'local_bounds': {'min': position.get('min'), 'max': position.get('max')},
                'attributes': list(primitive['attributes']), 'material': primitive.get('material'),
                'morph_targets': len(primitive.get('targets', [])),
                'extensions': list(primitive.get('extensions', {})),
            })
        meshes.append({'index': index, 'name': mesh.get('name'), 'primitives': primitives})
    nodes = []
    for index, node in enumerate(document.get('nodes', [])):
        nodes.append({'index': index, **{key: node[key] for key in (
            'name', 'mesh', 'skin', 'children', 'matrix', 'translation', 'rotation', 'scale'
        ) if key in node}})
    images = []
    for image in document.get('images', []):
        uri = image.get('uri')
        images.append({'name': image.get('name'), 'mime_type': image.get('mimeType'),
                       'embedded': 'bufferView' in image or bool(uri and uri.startswith('data:')),
                       'external_uri': uri if uri and not uri.startswith('data:') else None})
    return {
        'asset': document['asset'], 'scene': document.get('scene'), 'scenes': document.get('scenes', []),
        'nodes': nodes, 'meshes': meshes, 'images': images,
        'materials': [{
            'name': m.get('name'), 'alpha_mode': m.get('alphaMode', 'OPAQUE'),
            'alpha_cutoff': m.get('alphaCutoff'), 'double_sided': m.get('doubleSided', False),
            'pbr': m.get('pbrMetallicRoughness'), 'normal_texture': m.get('normalTexture'),
            'extensions': list(m.get('extensions', {})),
        } for m in document.get('materials', [])],
        'skins': len(document.get('skins', [])),
        'animations': [{'name': a.get('name'), 'channels': a.get('channels', [])}
                       for a in document.get('animations', [])],
        'extensions_required': document.get('extensionsRequired', []),
        'extensions_used': document.get('extensionsUsed', []),
        'bounds_note': 'Accessor bounds are local: apply scene/node transforms before deciding scale or orientation.',
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('model', type=Path)
    args = parser.parse_args()
    try:
        result = summarize(read_document(args.model))
    except (OSError, ValueError, KeyError, IndexError, TypeError, struct.error) as error:
        print(json.dumps({'error': str(error)}, ensure_ascii=False), file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
