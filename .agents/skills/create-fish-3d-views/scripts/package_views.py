#!/usr/bin/env python3
"""Package researched fish views; only explicit pixel crops, never redraw/rescale."""
import argparse
import hashlib
import html
import json
from pathlib import Path
import re
import sys
import zipfile

try:
    from PIL import Image
except ImportError:
    raise SystemExit('Pillow is required. Use an available Python runtime with Pillow.')

VIEWS = (('side', '側面'), ('dorsal', '上面（真上）'), ('ventral', '下面（真下）'))
ID_RE = re.compile(r'[a-z0-9][a-z0-9_-]{0,63}\Z')


def fail(message):
    raise ValueError(message)


def load_image(path):
    with Image.open(path) as im:
        if getattr(im, 'n_frames', 1) != 1:
            fail(f'Animated input is not supported: {path.name}')
        # image_gen originals are normally RGB/RGBA. No silent flattening or color conversion.
        if im.mode not in ('RGB', 'RGBA', 'L', 'LA'):
            fail(f'Use a lossless RGB/RGBA/L/LA source image: {path.name} ({im.mode})')
        return im.copy()


def image_warnings(im, cropped):
    warnings = []
    if 'A' in im.getbands() and im.getchannel('A').getextrema()[0] < 255:
        warnings.append('Nonopaque pixels: verify the requested white background.')
    if cropped:
        # Advisory only: anti-aliased fine fin edges still need visual inspection.
        rgb = im.convert('RGB')
        edges = {
            'top': (0, 0, im.width, 1),
            'bottom': (0, im.height - 1, im.width, im.height),
            'left': (0, 0, 1, im.height),
            'right': (im.width - 1, 0, im.width, im.height),
        }
        dark = [name for name, box in edges.items()
                if min(lo for lo, hi in rgb.crop(box).getextrema()) < 235]
        if dark:
            warnings.append('Nonwhite crop edge(s), check for clipped anatomy: ' + ', '.join(dark))
    return warnings


def prepare(manifest_path, out_dir):
    data = json.loads(manifest_path.read_text(encoding='utf-8-sig'))
    if not isinstance(data, dict) or not isinstance(data.get('species'), list) or not data['species']:
        fail('Manifest must contain a nonempty species list.')
    seen = set()
    plans = []
    for item in data['species']:
        if not isinstance(item, dict):
            fail('Every species entry must be an object.')
        sid = item.get('id', '')
        if not isinstance(sid, str) or not ID_RE.fullmatch(sid) or sid in seen:
            fail(f'Invalid or duplicate species id: {sid!r}')
        seen.add(sid)
        for key in ('common_name', 'scientific_name'):
            if not isinstance(item.get(key), str) or not item[key].strip():
                fail(f'{sid}: {key} is required.')
        views = item.get('views')
        if not isinstance(views, dict) or set(views) != {key for key, label in VIEWS}:
            fail(f'{sid}: exactly side, dorsal and ventral views are required.')
        entries = [(key, label, views[key]) for key, label in VIEWS]
        if 'sheet' in item:
            entries.append(('sheet', '三面図原本', item['sheet']))
        for key, label, entry in entries:
            if not isinstance(entry, dict) or not isinstance(entry.get('source'), str):
                fail(f'{sid}/{key}: source must be an image path.')
            source = Path(entry['source'])
            if not source.is_absolute():
                source = manifest_path.parent / source
            source = source.resolve(strict=True)
            im = load_image(source)
            box = entry.get('crop')
            if box is not None:
                if (not isinstance(box, list) or len(box) != 4
                        or any(type(n) is not int for n in box)):
                    fail(f'{sid}/{key}: crop must be four integer pixel coordinates.')
                left, top, right, bottom = box
                if not (0 <= left < right <= im.width and 0 <= top < bottom <= im.height):
                    fail(f'{sid}/{key}: crop outside source bounds {im.size}: {box}')
                result = im.crop(tuple(box))
            else:
                result = im
            relative = Path('images') / f'{sid}_{key}.png'
            plans.append({'id': sid, 'view': key, 'label': label, 'source': source,
                          'source_size': im.size, 'crop': box, 'relative': relative,
                          'width': result.width, 'height': result.height,
                          'warnings': image_warnings(result, box is not None)})
    sources = {p['source'] for p in plans}
    destinations = {out_dir / p['relative'] for p in plans}
    destinations.update(out_dir / name for name in (
        'index.html', 'README_ja.md', 'research_and_prompts.json', 'manifest.json',
        'fish_3d_views.zip'))
    if sources.intersection(destinations) or manifest_path in destinations:
        fail('Output would overwrite an input file; choose another output directory.')
    return data, plans


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_package(data, plans, out_dir):
    (out_dir / 'images').mkdir(parents=True, exist_ok=True)
    records = []
    for p in plans:
        target = out_dir / p['relative']
        original = load_image(p['source'])
        result = original.crop(tuple(p['crop'])) if p['crop'] is not None else original
        result.save(target, format='PNG')
        with Image.open(target) as check:
            if (check.mode, check.size, check.tobytes()) != (
                    result.mode, result.size, result.tobytes()):
                fail(f'PNG pixel verification failed: {target.name}')
        records.append({
            'species_id': p['id'], 'view': p['view'], 'view_label': p['label'],
            'file': p['relative'].as_posix(), 'width': p['width'],
            'height': p['height'], 'source_filename': p['source'].name,
            'source_size': list(p['source_size']), 'crop': p['crop'],
            'bytes': target.stat().st_size, 'sha256': sha256(target),
            'review_warnings': p['warnings'],
        })
    metadata_keys = ('id', 'common_name', 'scientific_name', 'synonyms', 'specimen',
                     'view_convention', 'diagnostic_features', 'comparison_notes',
                     'omitted_details', 'uncertainties', 'sources', 'generation')
    research = {'title': data.get('title', '魚のアニメ三面図'),
                'created': data.get('created'),
                'species': [{key: item[key] for key in metadata_keys if key in item}
                            for item in data['species']]}
    for filename, payload in (('manifest.json', records), ('research_and_prompts.json', research)):
        (out_dir / filename).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
    title = str(research['title'])
    sections = []
    markdown = [f'# {title}', '',
                '各種の側面・上面・下面を独立PNGで収録しています。',
                '実寸はmanifest.json、学名・特徴・出典・生成/修正プロンプトはresearch_and_prompts.jsonを参照してください。',
                '画像は原本または明示座標による等倍切り出しで、拡大・変形・描き直しはしていません。', '',
                '## 収録画像', '']
    for item in data['species']:
        sid = item['id']
        own = [r for r in records if r['species_id'] == sid]
        figures = []
        markdown += [f"### {item['common_name']} — {item['scientific_name']}", '']
        for rec in own:
            filename = rec['file']
            label = rec['view_label']
            dims = f"{rec['width']}×{rec['height']}px"
            figures.append(f'<figure><a href="{filename}"><img src="{filename}" '
                           f'alt="{html.escape(item["common_name"])} {label}" loading="lazy"></a>'
                           f'<figcaption>{label} · {dims}<br><a href="{filename}" download>PNGを保存</a>'
                           '</figcaption></figure>')
            markdown.append(f'- [{label}]({filename})：{dims}')
            for warning in rec['review_warnings']:
                markdown.append(f'  - 要確認：{warning}')
        markdown.append('')
        convention = html.escape(str(item.get('view_convention', '')))
        sections.append(f'<section><h2>{html.escape(item["common_name"])}</h2>'
                        f'<p><i>{html.escape(item["scientific_name"])}</i></p><p>{convention}</p>'
                        f'<div class="views">{"".join(figures)}</div></section>')
    page = ('<!doctype html><html lang="ja"><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1">'
            f'<title>{html.escape(title)}</title><style>'
            '*{box-sizing:border-box}body{margin:0;background:#f3f3f0;color:#24282b;'
            'font:15px/1.7 system-ui,sans-serif}main{max-width:1500px;margin:auto;padding:24px}'
            'h1{font-size:27px}h2{font-size:22px;margin:0}section{background:white;'
            'border:1px solid #ddd;margin:24px 0;padding:22px}.views{display:grid;'
            'grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:18px}'
            'figure{margin:12px 0}img{width:100%;height:auto;display:block}'
            'figcaption{font-size:13px;padding-top:10px}a{color:#1c6075}'
            '@media(max-width:600px){main{padding:12px}.views{grid-template-columns:1fr}}'
            f'</style><main><h1>{html.escape(title)}</h1>'
            '<p><a href="README_ja.md">収録内容・実寸</a>　'
            '<a href="research_and_prompts.json">学名・特徴・出典・プロンプト</a></p>'
            + ''.join(sections) + '</main></html>')
    (out_dir / 'index.html').write_text(page, encoding='utf-8')
    (out_dir / 'README_ja.md').write_text('\n'.join(markdown), encoding='utf-8')
    for href in re.findall(r'(?:href|src)="([^"]+)"', page):
        if not (out_dir / href).is_file():
            fail(f'Broken output link: {href}')
    # Only include the files generated by this invocation, not stale files in --overwrite directories.
    package_files = [out_dir / r['file'] for r in records]
    package_files += [out_dir / n for n in ('index.html', 'README_ja.md',
                                           'research_and_prompts.json', 'manifest.json')]
    archive = out_dir / 'fish_3d_views.zip'
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as z:
        for path in package_files:
            z.write(path, path.relative_to(out_dir).as_posix())
    with zipfile.ZipFile(archive) as z:
        if z.testzip() is not None or len(z.namelist()) != len(package_files):
            fail('ZIP integrity check failed.')
    return {'species': len(data['species']),
            'single_view_pngs': sum(r['view'] != 'sheet' for r in records),
            'sheets': sum(r['view'] == 'sheet' for r in records),
            'warnings': sum(len(r['review_warnings']) for r in records),
            'zip': str(archive), 'zip_bytes': archive.stat().st_size}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest', type=Path)
    parser.add_argument('--out-dir', required=True, type=Path)
    parser.add_argument('--overwrite', action='store_true',
                        help='Replace generated output files in an existing directory; never deletes files.')
    args = parser.parse_args()
    manifest_path = args.manifest.resolve(strict=True)
    out_dir = args.out_dir.resolve()
    if out_dir.exists() and (not out_dir.is_dir() or (any(out_dir.iterdir()) and not args.overwrite)):
        fail('Output directory must be empty; use a new directory or an authorized --overwrite.')
    data, plans = prepare(manifest_path, out_dir)
    summary = write_package(data, plans, out_dir)
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError) as error:
        print(f'ERROR: {error}', file=sys.stderr)
        sys.exit(2)
