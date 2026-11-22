"""Assemble the 3D aquarium (step 5) from the approved layout, fish model and textures.

Uses .agents/skills/publish-aquarium-web/scripts/web_bundle.py for the web formats.
Outputs in aquarium/:
  index.html            page for the Artifact viewer / a web server (three.js from jsDelivr, files next to it)
  aquarium-offline.html one self-contained file (three.js, scripts, model, textures inlined)
  app.js, lib.js, models/<name>.json + -2048.jpg / -1024.jpg
usage: python build_aquarium.py
"""
import json, re, shutil, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]                       # projects/ruri-yoshinobori-aquarium
AQ = ROOT / 'aquarium'
SK = ROOT.parents[1] / '.agents/skills'
sys.path.insert(0, str(SK / 'publish-aquarium-web/scripts'))
from web_bundle import write_fish_assets, online_three_loader, offline_document, data_uri

TEXTURES = ['sand', 'background', 'stone-blueblack', 'stone-greyblack']


def lib_js():
    """aquarium-state.mjs + mobile-quality.mjs (skill assets) as one classic script: window.AquariumLib."""
    parts = []
    for f in ['build-aquarium-from-fish-model/assets/aquarium-state.mjs', 'build-aquarium-from-fish-model/assets/mobile-quality.mjs']:
        parts.append(re.sub(r'^export ', '', (SK / f).read_text(encoding='utf8'), flags=re.M))
    return ('/* From .agents/skills/build-aquarium-from-fish-model/assets (aquarium-state.mjs, mobile-quality.mjs). */\n'
            '(() => {\n' + '\n'.join(parts) +
            '\nwindow.AquariumLib = { createAquariumState, chooseAquariumQuality, aquariumDrawingSize };\n})();\n')


def main():
    P = json.load(open(ROOT / 'project.json'))
    L = json.load(open(ROOT / 'layout' / f"v{P['layout']['version']}" / 'layout.json'))
    model_key = 'species/rhinogobius-mizunoi/model/v%d/ruri-yoshinobori.glb' % P['species'][0]['stages']['model']['version']
    for f in L['fish']:
        f['model'] = model_key                                     # the approved model version
    (AQ / 'models').mkdir(exist_ok=True)
    for old in (AQ / 'models').glob('*'):
        old.unlink()
    u = write_fish_assets(ROOT / model_key, AQ / 'models', 'ruri-yoshinobori')
    models = {model_key: {'geometry': 'models/' + u['geometry'], 'standard': 'models/' + u['2048'], 'light': 'models/' + u['1024']}}
    textures = {n: f'textures/{n}.jpg' for n in TEXTURES}
    (AQ / 'lib.js').write_text(lib_js(), encoding='utf8')
    shutil.copy(AQ / 'src' / 'app.js', AQ / 'app.js')
    page = (AQ / 'src' / 'page.html').read_text(encoding='utf8')

    assets = {'layout': L, 'models': models, 'textures': textures}
    online = page.replace('__SCRIPTS__', '<script>window.AQUARIUM_ASSETS=' + json.dumps(assets, ensure_ascii=False) + ';</script>\n'
                          + online_three_loader(['lib.js', 'app.js']))
    (AQ / 'index.html').write_text(online, encoding='utf8')

    off = {'layout': L, 'textures': {k: data_uri(AQ / v) for k, v in textures.items()},
           'models': {k: {'geometry': data_uri(AQ / v['geometry'], 'application/json'), 'standard': data_uri(AQ / v['light'])}
                      for k, v in models.items()}}
    for v in off['models'].values(): v['light'] = v['standard']            # one 1024 copy keeps the file small
    (AQ / 'aquarium-offline.html').write_text(offline_document(page, 'AQUARIUM_ASSETS', off, [AQ / 'lib.js', AQ / 'app.js']), encoding='utf8')
    for p in ['index.html', 'aquarium-offline.html']:
        print(p, f"{(AQ / p).stat().st_size / 1e6:.2f} MB")


if __name__ == '__main__':
    main()
