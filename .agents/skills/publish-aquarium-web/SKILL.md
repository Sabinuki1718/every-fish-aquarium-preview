---
name: publish-aquarium-web
description: 魚の3Dモデル（GLB）や3D水槽を、スマホでも開けるWebページ（Claude の Artifact など）として公開・共有できる形に書き出すときに使う。GLBを読める形式（形状JSON＋テクスチャJPG）へ変換し、three.js を公式CDNから読み、公開用ページと通信不要の1ファイル版を作る。公開の審査・配信できるファイル形式・スマホの起動負荷でつまずかないための手順。モデルや水槽そのものの制作には使わない。
---

# 3Dモデル・水槽の公開と共有

③のプレビュー、⑤の水槽を**人に見せる・共有する**段階で使う。作る中身は各スキル（build-fish-3d-from-views、build-aquarium-from-fish-model）に従い、このスキルは**書き出し方**だけを決める。

公開・共有は外部への送信になる。ユーザーが公開を求めたとき、またはこのリポジトリの手順でプレビューを渡すときだけ行う。公開先の共有設定（全員に公開するか）はユーザーが自分で操作する。

## 1. 二つの版を必ず作る

| 版 | 用途 | three.js | モデル・画像 |
|---|---|---|---|
| 公開用 `index.html`／`preview.html` | Artifact・Webサーバー。スマホのリンク共有 | jsDelivr の公式パッケージ（`three@0.170.0`） | 同じフォルダの別ファイル（JSON・JPG・PNG・MP3） |
| 通信不要 `*-offline.html` | ダブルクリックで開く・ファイルで渡す | `fish-to-3d-aquarium/assets/three-offline.js` を埋め込み | data: URI で埋め込み |

公開用に巨大な base64 を入れない（起動時のメモリーが膨らみ、共有の審査も通りにくい）。通信不要版には埋め込みが必要なので、二つを分ける。

## 2. 公開用に守ること（Claude Artifact の場合）

詳細と理由は [references/artifact-constraints.md](references/artifact-constraints.md)。要点：

- **`.glb` は配信されない**（contentType を指定しても不可）。`scripts/web_bundle.py` の `write_fish_assets` で、形状を JSON、テクスチャを JPG に変換して載せる。読み込みは `assets/fish-json-loader.js`。
- **公開共有の審査は、中身を読めるファイルを前提にする**と考える。base64 の文字列ファイル（`.b64.txt` など）や、独自名の大きな圧縮 JS を載せない。three.js は公式 CDN から読む（`web_bundle.online_three_loader`）。
  - 実例：GLB を base64 テキストで載せ、three.js を同梱した版は「This version couldn't be reviewed for public sharing」になった。JSON＋JPG と CDN に替えた版を再提出した（結果はプロジェクトの記録で確かめる）。
- 外部スクリプトは許可された CDN（cdnjs・jsDelivr・unpkg 等）から、**正確なバージョン**で読む。three.js r160 以降は UMD が無いので、import map ＋ module で `window.THREE` を作ってから従来の script を順に読む（`online_three_loader` がこれを出力する）。
- 自動再生の音は鳴らない。BGM はボタンで開始する（build-aquarium-from-fish-model の BGM の項）。
- ページはフラグメント（doctype なし、先頭に `<title>` と `<style>`）。スマホ幅・安全域（`env(safe-area-inset-*)`）・ライト／ダークの配色を満たす。

## 3. 使い方

魚1匹のプレビュー（③の提示用）：

```text
python scripts/fish_preview_page.py <model.glb> <出力フォルダ> --title "青文魚 3Dモデル v1" --desc "全長12 cmの仮スケール"
```

`preview.html` と、出力された補助ファイル（`fish-json-loader.js`、`preview-app.js`、`models/…json`、`models/…jpg`）を一緒に公開する。`preview-offline.html` は通信不要版。修正版は同じ公開先を更新し、リンクを変えない。

水槽（⑤）では、組立スクリプトから `web_bundle.py` の関数を使う：

```python
from web_bundle import write_fish_assets, online_three_loader, offline_document, data_uri
urls = write_fish_assets(glb, out / 'models', 'seibungyo')          # json + 2048/1024 jpg
html = page.replace('__SCRIPTS__', assets_script + online_three_loader(['lib.js', 'app.js']))
offline = offline_document(page, 'AQUARIUM_ASSETS', assets_as_data_uris, [out / 'lib.js', out / 'app.js'])
```

ページ側は `window.AQUARIUM_ASSETS` などの1つの変数から URL を読むように作る（公開用は相対 URL、通信不要版は data: URI）。こうすると同じ app.js が両方で動く。

## 4. 確かめる

- 公開用・通信不要版の両方を実ブラウザで開き、コンソールのエラーとシェーダーのコンパイルエラーが無いことを確かめる。スマホ幅（約390px）と、スマホの UA・タッチを模擬した軽量モードも見る。
- CDN に接続できない作業環境では、同じバージョンの three.js をローカルに用意し（例：リポジトリの `dev/` で `npm install` した `node_modules/three`）、ブラウザ自動操作で CDN の URL をそのファイルへ差し替えて確かめる。差し替えで確かめたことを報告に書く。
- 実機スマホ・公開先での表示・共有の可否は、確かめていなければ「未確認」と伝える。共有の可否はユーザーの操作でしか分からない。

## Sitesで既存の水槽を更新する場合

更新前にサイトIDと現在の閲覧範囲を確認する。一般公開版への反映はユーザーの指定に従い、閲覧範囲の変更はユーザーの指定がある場合に行う。配信URLでモデルの読み込みと個体選択・解説表示を確認する。

## 5. 伝えること

公開リンク、非公開か（共有はユーザーが共有メニューで行う）、通信不要版の場所と容量、確かめた範囲と未確認の範囲。共有でエラーが出たら、エラー文（スクリーンショット）をもらい、[artifact-constraints.md](references/artifact-constraints.md) の順に原因を外していく。
