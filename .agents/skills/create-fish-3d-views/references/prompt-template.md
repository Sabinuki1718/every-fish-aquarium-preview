# 生成と修正プロンプト

以下の空欄を調査結果で具体化する。最初の側面は[図面選びとプロンプトの使い分け](model-view-selection.md)を参照し、必要な追加方向は承認済み側面を添付して別の呼び出しで生成する。種に不適切な定型解剖は削除する。英語で生成指示を書く場合も魚名・学名・原資料の対応は記録する。

既定の側面図では初回から[ネオンテトラのアニメ調見本](../assets/neon-tetra-anime.webp)を画像入力に含め、参考写真と役割を分けて記載する。入力した画像の番号を `Style reference` と `Species references` に入れる。写真がない場合は、対象種の調査資料を `Species references` に記載する。

ユーザーがリアル調を明示した場合は、`Asset` を `Realistic orthographic fish view` に置き換え、`Style` から `Species references` の直前までのセル塗り指示を `Style: Naturalistic coloration, realistic skin and fin detail, even neutral lighting.` に差し替える。画風参照には[ネオンテトラのリアル調見本](../assets/neon-tetra-realistic.webp)を添付し、ユーザー指定の画風資料があればそちらを優先する。識別形質、投影、模様、背景の条件は引き継ぐ。

「その他」では `Asset` を `Orthographic fish view` にし、同じセル塗りの指示範囲をユーザー指定の画風に差し替える。画風見本のイラストがあれば画像入力に含め、その画風を記述する。識別形質、投影、模様、背景の条件は引き継ぐ。

```text
Use case: scientific-educational.
Asset: clean 2D orthographic fish illustration for image-to-3D generation.
Subject: [scientific name; common/trade name; adult/sex/morph/life stage].
Style: simple Japanese anime cel shading at the same level of simplification as the attached style sample.
Style reference: [image number, neon tetra cel-shaded sample]. Match its clean outlines, broad flat color shapes and sparse shading.
Use a simple iris and pupil with minimal highlights. Draw fin rays as clean lines and keep diagnostic fin markings.
Omit photographic grain, scale-by-scale texture, detailed iris texture, glossy rendering and continuous shading gradients.
Use the neon tetra sample only for rendering style. Preserve the target species' diagnostic outlines, proportions and pigment boundaries.
Species references: [image numbers and anatomical or pigmentation roles; research sources as needed]. Use photos for shape, color and markings.

Species-defining features:
- Body and head: [outline, cross-section, snout, eyes, mouth].
- Fins/appendages: [present/absent, attachment, shape and orientation].
- Pigment: [base color, exact stripe/blotch range and endpoints, dorsal/ventral differences].
- Confusion to avoid: [related species differences; no overclaim of visual diagnosis].
- Diagnostic traits to keep explicit: [selected identifying traits].
- Closely related/look-alike species and visible differences: [comparison species and exact shape/count/location/pattern differences].
- Non-diagnostic details to omit: [species-specific optional microtexture, segmentation, branching or decorative shading].
Default style priority: make look-alike discrimination traits especially clear, preserve all selected
identifying traits, then simplify other detail. Small size alone is not a reason to omit a trait.
Do not simplify away diagnostic ray counts, pattern positions, fin shapes or connections.
Make the differences legible at natural proportions; do not exaggerate, relocate or invent them.

Photo interpretation: [actual camera angle, perspective, posture, occlusion, damage or out-of-frame parts].
Reconstruct ALL unseen parts, not only fins, from researched anatomy and pigment of this species,
sex, life stage and morph: [parts, inferred shape/color and supporting references].
Do not mistake occlusion or damage for species-level absence. Preserve observed individual traits.
Do not copy foreshortening into the orthographic views or mirror naturally asymmetric anatomy.

View: [one strict orthographic view only; lateral first, then true top or true bottom in a separate call if needed].
Coordinate/posture convention: [head left and tail right unless species requires another natural posture].
Additional view only: [attach the approved lateral image; same individual, length, fin state and pigment landmarks].
Projection-specific geometry: [body width, fin planes and surface markings visible in THIS view].
Underside only: [mouth, gills, pale region, absent/visible fins; no duplicated back].
Layout: one fish, one view, complete silhouette.
White background. No text, labels, dimensions, borders, shadows, scenery or watermark.
No decorative effects or invented anatomy.
Pigment markings are organic: vary spot size, contour, gaps and density, and mesh cell size,
shape, junctions and breaks. No uniform dot grid, stamps or regular hexagonal tessellation.
Preserve the species' real broad rows/bands instead of randomizing everything.
```

## 模様だけを直す場合

```text
Edit ONLY [specific pigment area]. Keep species identity, outline, body proportions,
fin placements/state, view geometry, white background and anime style unchanged.
Problem: [eye-band vs blotch; red stripe extent; uniform dots; tiled mesh].
Required correction: [localized concrete change].
Preserve: [diagnostic stripe, clear dorsal fin, dark base/light spots, etc.].
Apply the corresponding surface change consistently to all affected projections.
Do not add texture or change the silhouette. Do not paint markings onto the clean belly.
```

細部が規則的すぎるときは、単に「ランダム」とするより、大小・輪郭・疎密・途切れのどれを直すか指定する。修正で斑点が過大な花形や星形になった場合は、それも自然な小さな斑点へ戻す。微妙な違いで判定する種を過剰な模様変更で別物にしない。

## 隠れた部位の参照画像（付属物を除いた版）

水泡眼の水泡、体側を覆う大きな胸鰭など、承認済みの三面図で胴体・頭・眼を広く隠す部位がある場合に、**3D化の資料として**作る。完成した魚の絵ではなく、隠れた部分を見るための参照であることをプロンプトに明記する。隠れた部位はその種の調査資料から推論して補い、根拠をresearch.mdへ残す。この生成画像を実証資料として扱わない。承認済みの各方向の画像を1枚ずつ添付し、方向ごとに1枚作る。

```text
Reference image for 3D modeling only. Redraw the attached [view] of the SAME individual with ONLY the
[part, e.g. two fluid-filled eye sacs] removed, to show the anatomy hidden behind it:
[what must become visible, e.g. the cheeks, gill covers and the underside of the head, and the inferred eye positions].
Reconstruct the occluded anatomy from [researched species traits and reference evidence]; do not invent anatomy.
Keep EXACTLY the same view, scale, position on the image, outline of everything else, fins, colors, pattern and the approved rendering style.
Do not move, resize or redesign the eyes, mouth, fins or body. Fill the uncovered area with the natural body color and pattern
continuing from the surroundings. White background. No text, shadows or scenery.
```

日本語で通りやすい生成サービスもあるため、同じ内容の日本語版も併記する。除いた部位そのものの形・色は、承認済みの三面図から取る。
