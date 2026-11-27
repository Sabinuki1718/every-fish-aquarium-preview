"""Assemble the aquarium (step 5) from the approved layout (layout/v1, revision v1c), the approved fish model (v5)
and the user's nihonga shader.

Outputs in aquarium/:
  index.html             Artifact / web page (three.js r170 from jsDelivr, files next to it)
  aquarium-offline.html  one self-contained file (three.js, scripts, model and textures inlined)
  app.js, lib.js, nihonga-shader.js, models/seibungyo.json + -2048.jpg / -1024.jpg, textures/*.jpg (when present)
usage: python build_aquarium.py
"""
import json, re, shutil, sys
from pathlib import Path
from PIL import Image

AQ = Path(__file__).resolve().parent
ROOT = AQ.parent                                                   # projects/seibungyo-nihonga
SK = ROOT.parents[1] / '.agents/skills'
sys.path.insert(0, str(SK / 'publish-aquarium-web/scripts'))
from web_bundle import online_three_loader, offline_document, data_uri

INFO = {
    'seibungyo': {'name': '青文魚（せいぶんぎょ）', 'scientific': 'Carassius auratus（キンギョの改良品種）',
                  'text': '青灰色の体と頭のこぶ（肉瘤）が特徴の中国生まれの品種。背鰭と長い四つ尾をもちます。'},
    'horyu': {'name': '穂竜（ほりゅう）', 'scientific': 'Carassius auratus（キンギョの改良品種）',
              'text': '赤穂生まれの日本の品種。出目、頭の肉瘤、真珠のようなパール鱗、丸い体が特徴です。'},
    'gin-suihogan': {'name': '銀水泡眼（ぎんすいほうがん）', 'scientific': 'Carassius auratus（キンギョの改良品種・水泡眼）',
                     'text': '眼の下に液体の入った水泡をもつ水泡眼の青系。背鰭がなく、眼は上を向きます。'}}


def lib_js():
    """aquarium-state / mobile-quality / fish-watch (skill assets) as one classic script: window.AquariumLib."""
    parts = []
    for f in ['aquarium-state.mjs', 'mobile-quality.mjs', 'fish-watch.mjs']:
        parts.append(re.sub(r'^export ', '', (SK / 'build-aquarium-from-fish-model/assets' / f).read_text(encoding='utf8'), flags=re.M))
    return ('/* From .agents/skills/build-aquarium-from-fish-model/assets (aquarium-state, mobile-quality, fish-watch). */\n(() => {\n'
            + '\n'.join(parts) + '\nwindow.AquariumLib = { createAquariumState, chooseAquariumQuality, aquariumDrawingSize, '
            'isTap, watchStart, followDelta, clampWatchCamera, nextWatchId };\n})();\n')


def main():
    pj = json.load(open(ROOT / 'project.json'))
    assert pj['layout']['status'] == 'approved' and all(x['stages']['model']['status'] == 'approved' for x in pj['species'])
    L = json.load(open(ROOT / f"layout/v{pj['layout']['version']}/layout.json"))
    (AQ / 'models').mkdir(exist_ok=True)
    models = {}
    for f in L['fish']:
        k = f['species_key']; src = ROOT / Path(f['model']).parent / 'web/models'
        shutil.copy(src / f'{k}.json', AQ / f'models/{k}.json')
        big = Image.open(src / f'{k}-2048.jpg').convert('RGB')
        big.save(AQ / f'models/{k}-2048.jpg', quality=88)
        big.resize((1024, 1024), Image.LANCZOS).save(AQ / f'models/{k}-1024.jpg', quality=84)
        models[f['id']] = {'geometry': f'models/{k}.json', 'standard': f'models/{k}-2048.jpg', 'light': f'models/{k}-1024.jpg'}
    textures = {n: f'textures/{n}.jpg' for n in ['stone-ai', 'stone-midori', 'sand', 'washi'] if (AQ / f'textures/{n}.jpg').exists()}

    (AQ / 'lib.js').write_text(lib_js(), encoding='utf8')
    (AQ / 'nihonga-shader.js').write_text((AQ / 'lib/nihonga-shader.js').read_text(encoding='utf8')
                                          .replace('export function createNihonga', 'window.createNihonga = function createNihonga', 1), encoding='utf8')
    shutil.copy(AQ / 'src/app.js', AQ / 'app.js')
    page = (AQ / 'src/page.html').read_text(encoding='utf8')
    scripts = ['lib.js', 'nihonga-shader.js', 'app.js']
    assets = {'layout': L, 'models': models, 'textures': textures, 'info': INFO}
    online = page.replace('__SCRIPTS__', '<script>window.AQUARIUM_ASSETS=' + json.dumps(assets, ensure_ascii=False) + ';</script>\n'
                          + online_three_loader(scripts))
    (AQ / 'index.html').write_text(online, encoding='utf8')
    off = {'layout': L, 'info': INFO, 'textures': {k: data_uri(AQ / v) for k, v in textures.items()},
           'models': {k: {'geometry': data_uri(AQ / v['geometry'], 'application/json'), 'standard': data_uri(AQ / v['light'])} for k, v in models.items()}}
    for v in off['models'].values():
        v['light'] = v['standard']                                     # one copy per fish in the offline file
    (AQ / 'aquarium-offline.html').write_text(offline_document(page, 'AQUARIUM_ASSETS', off, [AQ / s for s in scripts]), encoding='utf8')
    for p in ['index.html', 'aquarium-offline.html']:
        print(p, f"{(AQ / p).stat().st_size / 1e6:.2f} MB", 'textures:', sorted(textures))


if __name__ == '__main__':
    main()
