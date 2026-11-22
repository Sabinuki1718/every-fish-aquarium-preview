# PNGの分割・梱包ヘルパー

`scripts/package_views.py` は生成を行わない。指定された原本を等倍で切り出し/PNG保存し、画像一覧、研究/プロンプト記録、実寸/ハッシュ一覧とZIPを作る。Pillowが必要。実行前に各原本と切り出し範囲を目視する。

```text
python scripts/package_views.py export-manifest.json --out-dir outputs/fish-views
```

## 入力例：一枚の三面図から分割

下記の座標は形式の説明用。実際の画像寸法と白い隙間に合わせて指定する。特定サイズ・三等分を全種へ使い回さない。

```json
{
  "title": "魚のアニメ三面図",
  "created": "YYYY-MM-DD",
  "species": [
    {
      "id": "species-slug",
      "common_name": "魚種名",
      "scientific_name": "Genus species",
      "synonyms": ["旧学名"],
      "specimen": "通常体色の成魚",
      "view_convention": "通常姿勢で側方・真上・真下、頭は左",
      "diagnostic_features": ["採用した体型や模様"],
      "comparison_notes": ["類似種との違い・外観だけでは断定できない点"],
      "omitted_details": ["省いた微細構造"],
      "uncertainties": [],
      "sources": [{"title": "出典の題名", "url": "https://example.org/species"}],
      "generation": {"method": "built-in image_gen", "prompt": "実際の指示", "edits": []},
      "sheet": {"source": "work/species-sheet.png"},
      "views": {
        "side": {"source": "work/species-sheet.png", "crop": [0, 0, 1200, 650]},
        "dorsal": {"source": "work/species-sheet.png", "crop": [0, 650, 1200, 1150]},
        "ventral": {"source": "work/species-sheet.png", "crop": [0, 1150, 1200, 1800]}
      }
    }
  ]
}
```

`source`は入力JSON所在ディレクトリからの相対パス、または絶対パス。`crop`は元画像のピクセル座標`[left, top, right, bottom]`。各種の`side`・`dorsal`・`ventral`が必須で、`sheet`は任意。

## 方向別に生成した場合

`crop`を省略し、それぞれの原本を指定する。全方向の縦横寸法が異なっていても、強制変形や解像度の水増しはしない。`sheet`を作っていなければ項目ごと省略する。

```json
"views": {
  "side": {"source": "work/fish-side.png"},
  "dorsal": {"source": "work/fish-top.png"},
  "ventral": {"source": "work/fish-bottom.png"}
}
```

## 出力とチェック

- `images/<id>_side.png`、`_dorsal.png`、`_ventral.png`。任意の原本は`<id>_sheet.png`。
- `index.html`、`README_ja.md`、`research_and_prompts.json`、`manifest.json`、`fish_3d_views.zip`。
- ID重複・パストラバーサル・不正な範囲・画像不足は書き込み前に拒否する。
- 空でない出力先には既定で書き込まない。自分が作った出力の更新を許可された場合に限り`--overwrite`を使う。元画像と保存先の衝突は上書き指定があっても拒否する。
- 切り出し前後のピクセル、ファイル実寸、ハッシュ、ZIPの整合を確認する。透明度や切り出し境界の非白色ピクセルは`manifest.json`に確認事項として残す。境界警告があれば、先に画像や座標を見直す。
- スクリプトは解剖・同定・三方向の一致を判定しない。生成した画像の目視QAは別途行う。境界が白いだけで絵全体が正しいとはみなさない。

研究/プロンプト欄に未確定点や元画像の実寸も残し、存在しない8K出力や実測復元を記録しない。食用・深海・特殊体型でも同じスキーマを使える。
