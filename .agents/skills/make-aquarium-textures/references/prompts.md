# 素材テクスチャのプロンプトの型（英語・日本語）

`[ ]` を、承認済みのレイアウト・生息環境・画風で埋める。種に合わない素材の文は消す。
**画風句**：写真提供なら `[STYLE]` = `photographic material texture, natural colors` / 「写真のような自然な質感」。イラスト提供なら [keep-illustration-style](../../keep-illustration-style/references/style-clauses.md) の句（例：透明水彩）。

共通の添付：魚のイラスト（または写真）1枚 ＝ 画風の参考のみ。魚は描かせない。

## 背景（横長 16:9）
```
[STYLE] painting for a 3D aquarium background, wide 16:9. Style reference only: match the attached image. Do NOT draw any fish.
A calm underwater scene of [habitat: e.g. a quiet pond / a clear river pool]: [main colors], lighter toward the top as if light comes from above,
deeper toward the bottom, with a few very faint, blurred silhouettes of [distant plants / rocks] near the bottom edge.
No objects in focus, no frame, no tank edges, no text. Fill the whole image edge to edge.
```
```
3D水槽の背景に使う[画風]の絵（横長16:9）。添付画像は画風の参考のみ。魚は描かないでください。
[生息環境]の穏やかな水中：[主な色]。上から光が差すように上ほど明るく、下ほど深い色に。下の端に、遠くの[水草／岩]の影をごく淡くぼかして少しだけ。
ピントの合った物・枠・水槽の縁・文字は入れず、画面の端まで全体を塗ってください。
```

## 底床（正方形・継ぎ目なし）
```
Seamless tileable texture for a 3D aquarium floor, square, viewed straight down. Style reference only: match the attached image. Do NOT draw any fish.
[substrate: e.g. light beige small rounded pebbles / fine white sand / dark mud with leaf litter], densely packed, evenly lit from above, [STYLE].
No large objects, no shadows from a single direction, no perspective, no text. Edges must wrap seamlessly when tiled.
```
```
3D水槽の底に敷く、継ぎ目なしで並べられる正方形のテクスチャ。真上から見た図。添付画像は画風の参考のみ。魚は描かないでください。
[底床：例 明るいベージュの小さく丸い砂利]がすき間なく並ぶ。上から均一な光。[画風]。
大きな物・一方向の影・遠近・文字は入れないでください。左右・上下の端が、並べたときにつながるように。
```

## 石・岩肌（正方形・表面だけ・継ぎ目なし）
```
Seamless tileable surface texture of [stone type], square, filling the whole image (NOT a whole stone, no outline of a stone).
Style reference only: match the attached image. Do NOT draw any fish. [colors, veins, speckles, weathering], [STYLE].
Even, diffuse light; no highlights, no cast shadows, no background, no perspective, no text. Edges must wrap seamlessly when tiled.
```
```
[石の種類]の表面を画面いっぱいに描いた、継ぎ目なしの正方形テクスチャ（石1個の絵や石の輪郭は描かない）。添付画像は画風の参考のみ。魚は描かないでください。
[色・筋・斑点・風化]。[画風]。均一でやわらかな光。強い光沢・落ち影・背景・遠近・文字は入れないでください。並べたときに端がつながるように。
```
生成サービスが石1個を円く描いてしまうことが多い。その場合は円の内側を切り出して使う（`seamless --crop`）。

## 石の色違い（上の石の画像を添付）
```
Same stone surface as the attached texture: keep the exact grain, veins, speckles, style and seamless edges,
but change the base color to [new color]. Do NOT draw any fish. Even, diffuse light; no highlights, no shadows, no background, no text.
```
```
添付の石のテクスチャと同じ石肌で、粒・筋・斑点・画風・継ぎ目なしの端はそのままに、地の色だけを[新しい色]に変えてください。魚は描かないでください。均一な光で、光沢・影・背景・文字は入れないでください。
```

## 流木・木肌（縦長・継ぎ目なし）
```
Seamless tileable bark/wood texture of waterlogged [driftwood type], vertical, the grain running top to bottom along the whole image.
Style reference only: match the attached image. Do NOT draw any fish. [colors, cracks], [STYLE]. Even light, no shadows, no background, no text.
Top/bottom and left/right edges must wrap seamlessly.
```
```
水に浸かった[流木の種類]の木肌の、継ぎ目なしテクスチャ（縦長）。木目は画像の上から下へ通す。添付画像は画風の参考のみ。魚は描かないでください。
[色・割れ]。[画風]。均一な光で、影・背景・文字は入れないでください。上下・左右の端がつながるように。
```

## 水草（縦長・1本・白背景）
```
[STYLE] botanical illustration of ONE stem of [plant: e.g. Cabomba], vertical 9:16, the stem rising from the bottom edge to near the top.
Style reference only: match the attached image. Do NOT draw any fish. [leaf shape and arrangement, colors].
Plain pure white background (it will be cut out), no other plants, no gravel, no shadows, no text.
```
```
水草[種名]の茎1本を描いた[画風]の植物画（縦長9:16）。茎は下の端から上の近くまで伸びる。添付画像は画風の参考のみ。魚は描かないでください。
[葉の形・付き方・色]。背景は無地の真っ白（あとで切り抜きます）。ほかの植物・砂利・影・文字は入れないでください。
```
茎が下端まで届いていること（植えたときに根元が浮かない）を確かめる。

## 浮草・落ち葉（正方形・数枚を離して・白背景）
```
[STYLE] illustration of five small [floating plant / fallen leaves] seen from directly above, square, spaced apart so they do not touch.
Style reference only: match the attached image. Do NOT draw any fish. [shape, colors]. Plain pure white background (it will be cut out), no water, no shadows, no text.
```
```
真上から見た[浮草／落ち葉]を5枚、互いに離して描いた[画風]の絵（正方形）。添付画像は画風の参考のみ。魚は描かないでください。
[形・色]。背景は無地の真っ白（あとで切り抜きます）。水・影・文字は入れないでください。
```
5枚を中央と四隅に置いてもらうと、UVで1枚ずつ切り出しやすい。
