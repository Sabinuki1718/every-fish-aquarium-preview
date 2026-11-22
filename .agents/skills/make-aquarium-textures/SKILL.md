---
name: make-aquarium-textures
description: 3D水槽の素材（背景・底床・石・流木・水草・浮草など）のテクスチャ画像を、ユーザーが自分の画像生成サービスで作り、受け取った画像を継ぎ目なし化・切り抜きして3Dへ適用するときに使う。画像生成を内蔵していないAI（Claude Code）で、build-aquarium-from-fish-model の「3. 素材」を進める手順。プロンプトは英語と日本語の両方をチャットに直接示す。魚の三面図には使わない（create-fish-3d-views と fish-to-3d-aquarium の画像生成の手順に従う）。
---

# 水槽の素材テクスチャを、ユーザーの画像生成で作る

build-aquarium-from-fish-model の [素材とテクスチャ](../build-aquarium-from-fish-model/references/materials.md) の「終点」（画像をファイル化し、実際の3Dの材質に適用する）は同じ。違うのは、**画像を作るのがユーザー**であること。有料APIを無断で使わない。

④レイアウト案が承認されてから始める。承認済みの素材の種類・初期配色を変えない（変える必要が出たら画像で再確認）。

## 1. 必要な素材を一覧にして、プロンプトを渡す

承認済みのレイアウトから、必要な画像を表にしてチャットに示す：名前・用途・形（横長／正方形・継ぎ目なし／縦長・切り抜き用）。

| 種類 | 形 | 3Dでの使い方 |
|---|---|---|
| 背景 | 横長 16:9、端まで塗る | 奥の板に光の影響なしで貼る |
| 底床（砂利・砂・泥） | 正方形・真上から・継ぎ目なし | 床に繰り返して敷く |
| 石・岩肌 | 正方形・**表面だけ**・継ぎ目なし | 石の形に三方向投影 |
| 石の色違い | 上の石の画像を添付して色だけ変える | 色ごとに別の材質 |
| 流木・木肌 | 縦長・木目が長手方向・継ぎ目なし | 幹・枝のUVに沿わせる |
| 水草 | 縦長・**1本だけ**・白背景 | 切り抜いて板に貼り、本数を並べて植える |
| 浮草・落ち葉 | 正方形・数枚を離して・白背景 | 切り抜いて水面・底に置く |

プロンプトは [references/prompts.md](references/prompts.md) の型を、魚種・生息環境・画風で具体化する。**英語と日本語の両方を、そのまま貼れる形でチャットに示す**（ファイルに保存するだけにしない）。生成サービスによっては日本語のほうが通りやすい。

- 添付してもらう画像と役割（魚のイラスト・写真は「画風の参考のみ、魚は描かない」）。
- ユーザーがイラストを提供している場合は、[keep-illustration-style](../keep-illustration-style/SKILL.md) の画風句を入れる。写真の場合は、素材らしい質感の写真調・均一光が基本。
- 保存名（`aquarium/textures/source/<名前>.jpg`）。受け取った原本はそのまま残す。

## 2. 受け取った画像を確かめる

- 継ぎ目なし用：物の全体（石1個の絵など）になっていないか。強い一方向の影・遠近がないか。→ 石の絵が円く描かれていたら、円の内側を切り出してから継ぎ目なし化する。
- 切り抜き用：背景が無地か、要素どうしが離れているか、画像端で切れていないか。
- 画風・色が承認済みの案と合っているか。合わなければ、直す点を限定した修正プロンプト（英日）を渡す。

## 3. 加工する

```text
python scripts/prepare_textures.py seamless  source/gravel.jpg      textures/gravel.jpg
python scripts/prepare_textures.py seamless  source/stone-blue.jpg  textures/stone-blue.jpg --crop 190 190 834 834 --size 768
python scripts/prepare_textures.py cutout    source/cabomba.jpg     textures/cabomba.png --height 1024   # base_u を記録
python scripts/prepare_textures.py cutout    source/frogbit.jpg     textures/frogbit.png --no-trim
python scripts/prepare_textures.py background source/background.jpg textures/background.jpg
python scripts/prepare_textures.py sheet     check.png textures/gravel.jpg textures/stone-blue.jpg textures/cabomba.png
```

`sheet` は継ぎ目なし画像を2×2に並べ、切り抜きを赤地に置く確認画像。**必ず目で見て**、継ぎ目・白い縁・欠けを確かめる。`cutout` の `base_u` は茎が下端を出る位置で、水草の板の回転軸に使う。

## 4. 3Dに適用する

[references/apply.md](references/apply.md) に three.js での貼り方をまとめた（背景、床の繰り返し、石の三方向投影と色替え、水草の植え方、浮草）。要点：

- 背景は光の影響を受けない材質で、絵の色をそのまま出す。
- 石は物体座標の三方向投影にし、動かしても模様が泳がないようにする。色替えは石ごとに材質を差し替える。
- 水草は1本の切り抜きを十字の板にし、**茎ごとに散らして砂利へ埋める**。束の中心だけでなく、茎ごとに足元の床の高さを取る。
- 浮草は切り抜きを水面に少し浮かべ、ゆっくり上下させる。

最後に、正面・斜め・上から実際の3Dで見て、白い縁・継ぎ目・単色の仮素材に戻っていないことを確かめる。
