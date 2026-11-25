# 青文魚 追加図のプロンプト（ユーザーが画像生成サービスで作成）

3枚とも、承認済みの側面図 `views/source/side-v1.png` を添付してから貼る。1回の生成で1枚。
添付画像の役割：同じ個体の形・模様・色・画風（日本画）の資料。
墨線は日本画シェーダーが3Dから描くので、3枚とも「墨の輪郭線なし・色だけ」で作る。

保存先：
- 線なし側面 → `views/source/side-color-v1.png`
- 上面 → `views/source/top-v1.png`
- 下面 → `views/source/bottom-v1.png`

## 1. 線なし彩色の側面（side-color）

```
Redraw the attached Japanese-painting (nihonga) illustration of a blue Seibungyo goldfish
(blue oranda, Carassius auratus) as a COLOR-ONLY version for texturing a 3D model.
Remove ALL black sumi ink outlines: the body contour, the fin edges, the gill line and the dark
lines along the fin margins. Keep only the soft mineral-pigment color washes.
Keep EXACTLY the same view (lateral, head left), the same position and size on the image,
the same silhouette, fins, eye, mouth, wen (hood) and color pattern.
Where an ink line was, continue the neighboring color: fin margins become the same translucent
blue-grey as the fin, the body edge becomes the body color.
Keep the scale texture and the bumpy dark navy-grey wen, but keep shading light and even
(no strong dark shadows; the renderer adds its own shading).
Paper-white highlights on the body stay pale blue-grey highlights; do not turn them into white patches.
Style: Japanese nihonga painting — soft mineral pigments (iwa-enogu), gentle washes, muted blue-grey palette.
No ink outline, no cel shading, no anime style, no photorealism, no 3D look.
Plain pure white background with no wash, paper tint or texture. No text, shadows or watermark.
```
```
添付の日本画風の青文魚を、3Dモデルの色貼り用に「墨線なし・色だけ」の版に描き直してください。
体の輪郭・鰭の縁・鰓の線など、黒い墨の線をすべて消し、淡い岩絵具の彩色だけを残します。
向き（真横・頭が左）、画像内の位置と大きさ、輪郭、鰭、眼、口、肉瘤、色と模様は完全にそのまま。
線のあった所は隣の色でつなぐ（鰭の縁は鰭と同じ半透明の青灰、体の縁は体の色）。
鱗の質感と、でこぼこした濃い灰紺の肉瘤は残し、陰影は弱く均一に（強い影は付けない）。
白く抜けたハイライトは淡い青灰のままにし、白い斑にしないでください。
背景はにじみや紙の色のない無地の白。文字・影・透かしなし。アニメ調・写真調・3DCG調にしないでください。
```

## 2. 上面（top）

```
Japanese nihonga painting of the SAME blue Seibungyo goldfish (blue oranda, Carassius auratus)
as the attached illustration, TRUE TOP VIEW looking straight down on the back, head toward the LEFT, tail right.
Strict orthographic projection, not perspective, not tilted. Same individual, same body length and scale as the attached side view.
- Body: short broad egg shape seen from above; maximum width about two-thirds of the body depth in the side view,
  tapering to a short narrow caudal peduncle.
- Head: the bumpy dark navy-grey wen (hood) covers the top of the head and bulges a little on both sides;
  the two normal (not protruding) eyes just show at the sides of the head, symmetric.
- Dorsal fin: seen edge-on as a thin line along the midline of the back (do not draw it spread flat).
- Pectoral fins and pelvic fins: paired, spread slightly to both sides, symmetric.
- Tail: long four-lobed double tail spread like a fan behind the body, translucent blue-grey with visible rays.
- Color: darker blue-grey along the spine, lighter blue-grey on the flanks, same scale texture as the side view.
COLOR-ONLY: no black sumi ink outlines on the body or fin edges; keep only soft mineral-pigment washes, light even shading.
Style: Japanese nihonga — soft mineral pigments, gentle washes, muted blue-grey palette. No cel shading, no anime, no photorealism, no 3D look.
One fish only, complete silhouette with margin, fins not cut off.
Plain pure white background with no wash or paper tint. No text, labels, shadows, scenery or watermark.
```
```
添付と同じ青文魚を、真上から見た上面図として日本画風で描いてください。頭が左、尾が右。遠近のない厳密な正投影で傾けない。同じ個体・同じ全長と縮尺。
- 胴：上から見て短く幅広い卵形。最大幅は側面図の体高の約3分の2。短く細い尾柄へすぼまる。
- 頭：でこぼこした濃い灰紺の肉瘤が頭頂を覆い、左右に少し張り出す。突出しない普通の眼が頭の両脇に左右対称にわずかに見える。
- 背鰭：背の正中に沿った細い線として見える（平たく広げない）。
- 胸鰭・腹鰭：左右一対で、少し外へ開き、左右対称。
- 尾：長い四つ尾が扇のように後ろへ開く。半透明の青灰で鰭条が見える。
- 色：背骨沿いが濃い青灰、体側は淡い青灰。鱗の質感は側面図と同じ。
墨の輪郭線なし・色だけ（体や鰭の縁に黒い線を描かない）。陰影は弱く均一に。
画風：淡い岩絵具の日本画。アニメ調・写真調・3DCG調にしない。
魚は1匹、全身が余白付きで収まり、鰭が切れないこと。背景は無地の白。文字・影・背景物・透かしなし。
```

## 3. 下面（bottom）

```
Japanese nihonga painting of the SAME blue Seibungyo goldfish (blue oranda, Carassius auratus)
as the attached illustration, TRUE BOTTOM VIEW looking straight up at the belly, head toward the LEFT, tail right.
Strict orthographic projection, not perspective, not tilted. Same individual, same body length and scale as the attached side view.
- Belly: rounded, pale silvery blue-grey to whitish; the flanks darken slightly toward the outline.
- Head: small mouth at the front tip, gill openings on both sides, the dark wen just visible at the sides of the head.
- Fins: paired pectoral fins and paired pelvic fins symmetric; paired anal fins (two small fins side by side);
  long four-lobed tail spread behind. No dorsal fin visible from below.
- Do not paint the dark back color onto the belly.
COLOR-ONLY: no black sumi ink outlines on the body or fin edges; keep only soft mineral-pigment washes, light even shading.
Style: Japanese nihonga — soft mineral pigments, gentle washes, muted blue-grey palette. No cel shading, no anime, no photorealism, no 3D look.
One fish only, complete silhouette with margin, fins not cut off.
Plain pure white background with no wash or paper tint. No text, labels, shadows, scenery or watermark.
```
```
添付と同じ青文魚を、真下から見た下面図として日本画風で描いてください。頭が左、尾が右。遠近のない厳密な正投影で傾けない。同じ個体・同じ全長と縮尺。
- 腹：丸く、淡い銀色がかった青灰〜白っぽい色。輪郭に向かって少し濃くなる。
- 頭：先端に小さな口、両側に鰓の切れ目。頭の両脇に濃い肉瘤が少し見える。
- 鰭：胸鰭・腹鰭は左右一対で対称。臀鰭は小さな2枚が並ぶ。長い四つ尾が後ろへ開く。下からは背鰭は見えない。
- 背中の濃い色を腹に塗らない。
墨の輪郭線なし・色だけ（体や鰭の縁に黒い線を描かない）。陰影は弱く均一に。
画風：淡い岩絵具の日本画。アニメ調・写真調・3DCG調にしない。
魚は1匹、全身が余白付きで収まり、鰭が切れないこと。背景は無地の白。文字・影・背景物・透かしなし。
```
