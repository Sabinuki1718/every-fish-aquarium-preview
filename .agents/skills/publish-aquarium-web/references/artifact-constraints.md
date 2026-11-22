# Claude Artifact で公開するときの制約と対処

2026年10月の水彩金魚水槽で実際にぶつかったこと。仕様は変わりうるので、公開ツールのエラー文・説明を優先する。

## 配信できるファイル

- 配信される拡張子：html / css / js・mjs・wasm / json・txt・md・csv・xml / svg・png・jpg・gif・webp・avif・ico / woff・woff2・ttf・otf / mp3・wav・ogg・mp4・webm / pdf。
- **`.glb` は不可**。`contentType: model/gltf-binary` を付けても拒否された。→ 形状 JSON ＋ テクスチャ JPG（`web_bundle.write_fish_assets`）。
- ページ本体は 16MB まで。補助ファイルはそれぞれ別枠（画像 15MB、テキスト 16MB）。音声（mp3）はそのまま載せられる。
- 補助ファイルは更新時に「渡したものは追加・置換、渡さないものは残る、`null` で削除」。形式を変えたら古いファイルを `null` で消す。

## 公開共有の審査

共有メニューで「全員に公開」にすると、公開版の審査が走る。審査できないと
「This version couldn't be reviewed for public sharing. Choose another version under Shared version and try again, or edit the artifact and publish a new version.」と出る。理由は表示されない。

疑わしい順に外す：

1. **中身を読めないデータ**：base64 の文字列ファイル、巨大な data: URI。→ JSON・画像など普通の形式へ。
2. **独自名の大きな圧縮 JS**（ライブラリの同梱）。→ 公式 CDN から正確なバージョンで読む。
3. 大きな音声・動画。→ 一時的に外して再提出し、切り分ける。
4. それでも通らなければ、ユーザーに見えたエラー文を添えて相談する。別の公開手段（GitHub Pages 等）は外部公開なので、ユーザーの同意を得てから。

審査の結果は作業側から見えない。ユーザーに再試行してもらい、「Shared version」で最新版を選ぶよう伝える。

## スクリプトと CDN

- 許可された CDN：cdnjs.cloudflare.com、cdn.jsdelivr.net/npm、unpkg.com など。バージョンは固定（`three@0.170.0`）。
- three.js r160 以降は UMD（`three.min.js`）が無い。import map で `"three"` を CDN の `three.module.js` に向け、`examples/jsm/controls/OrbitControls.js` などを import して `window.THREE` にまとめ、その後で従来の script を `document.createElement('script')` で順に読む。
- `fetch()` は同じ公開先の相対 URL なら使える。外部への fetch は不可。
- `alert/confirm/prompt`、ページからのダウンロード、`window.print()` は使えない。保存は localStorage（失敗しても動くよう try/catch）。

## 通信不要版

- three.js は `fish-to-3d-aquarium/assets/three-offline.js` を埋め込む（`window.THREE`、OrbitControls など同梱）。
- 画像・モデル・音声は data: URI。BGM 込みの水槽で約 18〜20MB。メールより共有フォルダで渡す。
- `file://` では fetch が使えない環境があるが、data: URI の fetch は使える（Chromium で確認）。
