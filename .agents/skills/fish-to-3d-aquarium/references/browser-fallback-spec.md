# fish-spec の書式（ブラウザ簡易版）

ブラウザ簡易版では、魚の形を「数値の設計図」として `fish-spec.js` に書き、ビューアが開くたびにメッシュを組み立てる。
数値なので、AI が直すのも差分を見るのも簡単。項目の一覧は [fish-spec.schema.json](fish-spec.schema.json)。

## 座標

- 単位は **全長 TL = 1**。`x = 0` が吻端、`x = 1` が尾鰭の後端。
- `y` は上が正。`y = 0` は吻端の高さ。
- すべて **左側面図（頭が左）** で考える。三面図の側面図と同じ向き。
- 3D では cm 単位、頭が +X、背が +Y、魚体の中心が原点になる（`length_cm` 倍される）。

## 体（body）

| 項目 | 意味 |
|------|------|
| `end_x` | 胴（尾柄）の後端。ここから後ろは尾鰭 |
| `top` | 側面図の背側輪郭 `[[x, y], …]`（鰭を除く） |
| `bottom` | 側面図の腹側輪郭（鰭を除く） |
| `half_width` | 背面図の半幅 `[[x, w], …]`（胸鰭を除く） |
| `section_exponent` | 断面の超楕円の指数。2 = 楕円。大きいほど角ばる（ハコフグ 4〜6）、1.5 前後で菱形寄り。数値か `[[x, n], …]` |

体は x ごとの断面（高さは top〜bottom、幅は ±half_width の超楕円）をつないで作る。輪郭は単調3次補間なので、点は10〜40個で十分。

## 鰭（fins）

- 背鰭・臀鰭・尾鰭・脂鰭（`dorsal`, `dorsal1`, `dorsal2`, `anal`, `caudal`, `adipose`, `finlets` …）は、側面図上の輪郭 `outline` を板として置く。付け根は体に少しめり込ませる。
- 胸鰭・腹鰭（`pectoral`, `pelvic`）は、体側にたたんだときの側面図上の輪郭 `outline` と、付け根の線 `base`（2点）を書く。`spread_deg` だけ体から開き、泳ぐときに `flap` の強さで動く。
- 色: `color`, `opacity`, `edge_color`（鰭の縁）, `rays`（鰭条を描く本数）, `markings`（鰭の上の模様）。

## 目・ひげ

- `eye`: `x`, `y`, `r`（半径）, `iris`, `pupil`, `pupil_ratio`, `inset`（体表への埋まり具合）, `bulge`（ふくらみ）
- `barbels`: ひげ。`x`, `y`, `length`, `angle_deg`（前0°・下90°）, `spread_deg`（外への開き）。左右対で作る。

## 見た目（appearance）

テクスチャは側面図の座標にそのまま平行投影する。2通りある。

1. **手続き的に描く**（既定）: `base_colors`（`dorsal` 背 / `flank` 体側 / `ventral` 腹）、`ventral_start`、`markings`。
2. **三面図の側面図を使う**: ビューアに側面図の画像をドロップする。`texture_bounds`（画像が覆う範囲。頭が左で、x0〜x1・y0〜y1 を全長=1 の座標で）を書いておくと位置が合う。書かなければ体と鰭が収まる範囲を自動で使う。

`markings` の種類（`r` は相対高さ：腹縁 0 〜 背縁 1）:

| type | 使いどころ | 主な項目 |
|------|-----------|----------|
| `band` | 横帯（縦じま） | `x`, `width`, `r0`, `r1`, `tilt_deg` |
| `stripe` | 縦帯（体軸に沿う線） | `x0`, `x1`, `r` または `y`, `width` |
| `lateral_line` | 側線 | `stripe` と同じ |
| `spots` | 小斑点をばらまく | `x0`, `x1`, `r0`, `r1`, `count`, `radius`, `radius_jitter`, `aspect`, `seed` |
| `blotch` | 斑紋（楕円） | `x`, `y` または `r`, `rx`, `ry`, `angle_deg` |
| `ocellus` | 眼状斑 | `blotch` ＋ `ring_color` |
| `patch` | 任意の多角形 | `polygon`, `outline_color`, `outline_width` |
| `reticulate` | 鱗の網目 | `x0`, `x1`, `scale_size` |

共通: `color`, `opacity`, `blur`。質感: `roughness`, `metalness`, `clearcoat`, `iridescence`（銀色の魚は 0.3〜0.5）。

## 泳ぎ（swim）

| 項目 | 値 |
|------|----|
| `style` | `anguilliform`（ウナギ・ドジョウ）/ `subcarangiform`（コイ科・サケ科）/ `carangiform`（アジ）/ `thunniform`（マグロ）/ `ostraciiform`（ハコフグ）/ `labriform`（ベラ・スズメダイ）/ `balistiform`（カワハギ）/ `benthic`（ハゼ・カジカ）/ `hovering` / `drifting` |

プレビューで泳ぎ方（体のうねり方）を確かめるためのもの。水槽での泳ぎ方・遊泳層は⑤で build-aquarium-from-fish-model が決める。
