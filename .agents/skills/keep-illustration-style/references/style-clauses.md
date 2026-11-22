# 画風句（プロンプトに入れる文）

既定の `Style: Japanese anime style, cel shading, clean line art.` の代わりに入れる。英語と日本語の両方を用意し、チャットに直接示す。

## 型
```
Style: match the attached illustration exactly — [medium], [line], [fill/texture], [highlights], [paper/ground].
No cel shading, no anime style, no photorealism, no 3D look.
```
```
画風は添付のイラストと同じに：[画材]、[線]、[塗り・質感]、[ハイライトの残し方]、[紙・地]。セル塗り・アニメ調・写真のような質感・3DCGの見た目にはしないでください。
```

## 例

**透明水彩**（水彩の金魚水槽で使用）
```
Style: match the attached illustration exactly — soft transparent watercolor on white paper, wet-edge blooms,
paper-white highlights, thin grey pencil outline. No cel shading, no anime style.
```
```
画風は添付のイラストと同じに：白い紙ににじむ透明水彩、紙の白を残したハイライト、細い灰色の鉛筆線。セル塗り・アニメ調にはしないでください。
```

**色鉛筆**
```
Style: match the attached illustration exactly — colored pencil on cream paper, visible hatching strokes, layered soft colors,
light paper grain showing through, no hard black outlines.
```
```
画風は添付のイラストと同じに：クリーム色の紙に色鉛筆、見える斜線の重ね塗り、やわらかく重ねた色、紙の目が少し見える、黒い強い輪郭線なし。
```

**油彩・アクリル**
```
Style: match the attached illustration exactly — oil painting with visible brush strokes, rich blended colors, soft edges, canvas texture.
```
```
画風は添付のイラストと同じに：筆跡の見える油彩、深く混ざった色、やわらかな輪郭、キャンバスの質感。
```

**木版画・浮世絵風**
```
Style: match the attached illustration exactly — Japanese woodblock print, flat color areas with subtle wood grain, bold even outlines, limited palette.
```
```
画風は添付のイラストと同じに：木版画、木目がかすかに出る平らな色面、均一な太めの輪郭線、限られた色数。
```

## 三面図で必ず添える文
```
Same individual as the attached illustration: keep the exact body proportions, fin shapes and pigment pattern.
Strict orthographic projection, not perspective, not tilted. Plain white background with no wash or paper tint.
```
```
添付のイラストと同じ個体：体の比率・ひれの形・模様はそのまま。遠近のない厳密な正投影で、傾けない。背景はにじみや紙の色のない無地の白。
```

## 絵の表現を模様にしないための文
```
White areas that are paper highlights in the illustration stay highlights; do not turn them into white patches.
```
```
イラストで紙の白を残したハイライトは、ハイライトのままにし、白い斑にしないでください。
```
