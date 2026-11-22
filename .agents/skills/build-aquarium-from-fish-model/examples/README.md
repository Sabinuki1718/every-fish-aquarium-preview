# 水槽ページの実装例（コードのみ）

作例の水槽で実際に使ったコード。⑤を実装するときの手本として読む。素材（写真・生成画像・テクスチャ・モデル）は含まないので、このままでは動かない。新しい水槽では `projects/<水槽名>/` に同じ構成で書き、魚種・レイアウト・素材に合わせて作り直す。

| フォルダ | 水槽 | 見どころ |
|---|---|---|
| `ruri-yoshinobori/` | ルリヨシノボリ（リアル調・上流の瀬） | 着底して止まり、蹴って短く泳ぐ動き。角石の配置編集。川底の光の模様。スマホ用の軽量表示 |
| `watercolor-goldfish/` | 水彩の金魚（イラスト調） | 紙の質感の背景、水彩テクスチャの貼り方、水草（カボンバ）と浮草、水泡眼の水泡の半透明 |

各フォルダの中身：

- `app.js`：水槽の本体（three.js r170）。作例では `aquarium/src/app.js`
- `page.html`：ページの骨組みと操作欄。作例では `aquarium/src/page.html`。`__SCRIPTS__` に素材の一覧とスクリプトが入る
- `build_aquarium.py`：公開版 `index.html` と通信不要版 `aquarium-offline.html` を書き出す。作例では `tools/build_aquarium.py`（[publish-aquarium-web](../../publish-aquarium-web/SKILL.md) の `web_bundle.py` を使う）
- `layout.json`：承認されたレイアウト（ルリヨシノボリは v4、水彩の金魚は v2）。`layout-plan.md` はその説明
