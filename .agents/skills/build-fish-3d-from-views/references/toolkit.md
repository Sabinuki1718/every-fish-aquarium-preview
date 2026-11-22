# ローカル実装部品

## 環境と使い方

Python、NumPy、Pillowが必要。SciPyがあれば領域補間を高速化する。まず実行環境の既存パッケージを確認し、利用可能なローカルランタイムを使う。外部ツール禁止の場合、未導入のライブラリをネットワークから勝手に取得しない。

魚ごとの組立スクリプトから、スキルの `scripts` をPythonの検索パスに追加して読み込む。

```python
from pathlib import Path
import sys
skill_dir = Path(SKILL_DIRECTORY)  # 今回読み込んだスキルの実際の場所
sys.path.insert(0, str(skill_dir / 'scripts'))
from fish_mesh import Mesh, loft, sweep, fin, closed_lips
from fish_mesh import export_glb, write_preview, render
```

`SKILL_DIRECTORY` は作業用スクリプトで実際のパスに置き換える。ユーザー名、日付、今回の添付画像の一時パスをスキル本体へ固定しない。

## 共通規約

- `Mesh(name, positions, uv, faces, normals=None)`。位置はN×3、UVはN×2、三角形はM×3。UVはアトラス内の0〜1、V=0が画像上端。法線は省略時に計算し、UV継ぎ目の重複位置では法線だけ平均する。
- 座標は最終的にメートル、Y上。`scale_to_length(meshes, length_m, axis=0)` は全パーツを一括で中心へ移し、全長を合わせる。画像パネルの長さをそれぞれ独立にスケールしない。
- `mesh.check()` は数値・法線・インデックス・縮退を検証。`check_closed()` は位置をまとめた辺で閉じた形状か確認。開いた意図的な面には後者を強制しない。
- 材質は単一アトラス、非金属、粗さ0.72、両面。`export_glb(..., alpha_mode='MASK')` は意図した切り抜きだけに使う。透過の描画順や複数の特殊材質が必要なら出力器を拡張する。

## 形状API

`loft(name, sections, uv_fn, segments=64, power=2, cap_uv=None)`

`sections` は `[x, center_y, center_z, up_radius, down_radius, left_radius, right_radius]` の列。xは単調増加、4半径は正。図の輪郭を補間して十分な断面を渡す。power=2は楕円、より大きな値は角張った断面。形状が一致しないときは別の面パッチを選ぶ。UV関数は `uv_fn(normalized_length, angle)`。角度0は上、π/2は+Z、πは下。キャップは `cap_uv` の単色点か長軸端のUVを使うので、鼻先を側面の放射状投影で作りたい場合にそのまま使わない。

`sweep(name, centers, radius_a, radius_b, uv_fn, segments=48, up_hint=(0,1,0), cap_uv=None)`

任意の中心線に沿う断面。反転を抑える局所フレームを使う。急折れや自己接触は自動で直さないので、中心線を滑らかにし、曲がった魚の腹・尾を確認する。断面半径はスカラーまたは中心線と同数の配列。

`fin(name, outline, point_fn, uv_fn, subdivisions=2)`

outlineは重複・自己交差のない2D輪郭。`point_fn(u,v,layer)` はlayer=-1/+1で裏表の3D座標を返す。付け根、開き角、反り、厚みを魚ごとに定義する。`uv_fn(u,v)` は元画像の値ではなく、加工して配置したアトラスの座標を返す。凹形の輪郭を三角形に分け、縁も閉じる。元画像から機械的に得た短すぎる辺や一直線の連続頂点は整理する。

`closed_lips(...)`

center、forward、right、up、half_width、upper_height、lower_height、front_depth、back_depth、corner_back、seam_thickness、upper_uv、lower_uv、line_uvを渡す。方向3つは直交した単位方向として解釈する。上下の唇と細い中央線の3形状を返す。横幅は2×half_width、口の合わせ目の太さはseam_thickness。前後の曲線と後半の深さを、図と吻部に合わせる。口の内部は作らない。汎用的な唇の一例なので、鯨のような別種の構造や、上向き・下向き・筒状の口は資料に応じて独自のMeshを使う。

## 画像処理API

`check_atlas_islands(width,height,islands)` は、名前とパディング込みのピクセル矩形を検査する。矩形は `(x0,y0,x1,y1)`、右端・下端は含まない。範囲外・空領域・重複名・矩形同士の重なりを拒否する。配置を自動決定する機能ではない。意図的に共有する島は一度だけ登録する。

```python
from fish_mesh import check_atlas_islands
check_atlas_islands(atlas_width, atlas_height, [
    ('body_with_padding', body_rect),
    ('dorsal_with_padding', dorsal_rect),
    ('anal_with_padding', anal_rect),
])
```

アトラスへ書き込む前に、元画像の保管領域や色見本を含めた全配置を検査する。幅広領域へ分岐する際も別の棚の行高・カーソルは変更しない。

`sample_bilinear(image,x,y)` はピクセル座標で画像を補間する。色場を作るときは、図から求めた世界座標→パネル座標の変換を先に行う。

`inpaint_region(image,mask)` は明示的に選んだ内側の領域を周囲から補間する。鰭とその影を消す用途。画像端に触れるマスクは拒否する。大きな柄や輪郭の再構成はこれだけで済ませない。SciPyがなければ局所的な反復補間へ切り替わる。

`dilate_mask(mask,pixels)` は境界の混色まで含めるための小さな拡張。単一の明色閾値で魚の特徴を全消去しない。色除去の判断は今回の画像・領域で決める。

`bleed_edges(image,valid,pixels=8)` はマスク内の色を外のパディングへ延長する。`valid` は魚・鰭の意味的なマスク。白背景を閾値で推測する機能ではない。アルファを加工する必要があるなら、意図した島の内外を別途マスクにする。

UVベイクは魚ごとに組む。一般形は、長軸u・断面角vで表面座標を求め、清掃した複数投影をサンプルし、背腹の重みを滑らかに切り替える色関数をアトラスに出力する方法。非対称魚では左右別の色関数を持つ。ライブラリは画像をそのまま3面投影する機能をあえて固定していない。

## 出力と確認

```python
export_glb(meshes, atlas, 'outputs/fish.glb', metadata={
    'units': 'meters', 'up': '+Y', 'forward': '-X',
    'scale_assumption': 'ユーザー指定の全長へ換算',
})
write_preview(meshes, atlas, 'outputs/preview.html',
              title='今回の魚名', glb_filename='fish.glb')
render(meshes, atlas, 'outputs/oblique.png', yaw=.6, pitch=.15)
```

HTMLは表示データと画像を内蔵し、外部通信しない。全体の回転、正面等の方向切り替え、パーツ単位の注目、拡大に対応する。GLBのダウンロード先はHTMLからの相対ファイル名を渡す。簡易照明なので、標準PBRと完全に同じ色・光沢になるとは説明しない。

構造と描画はCLIでも確認できる。

```text
python <skill>/scripts/fish_mesh.py validate outputs/fish.glb
python <skill>/scripts/fish_mesh.py check-uv outputs/fish.glb
python <skill>/scripts/fish_mesh.py render outputs/fish.glb --out outputs/front.png --yaw 1.570796327 --pitch 0
python <skill>/scripts/fish_mesh.py render outputs/fish.glb --out outputs/detail.png --target X Y Z --radius R
```

targetとradiusはモデルのメートル座標。radiusは画面に入れる領域の半径。`--unlit` を足すと照明の陰影を除いたテクスチャ色を確認できる。ソフトウェア描画はUV・形状確認用で、透過合成や複雑なPBRの代替ではない。

`check-uv` は単一アトラスの埋め込みPNG形式を対象に、線に近いUVと点のUVを別々に報告する。各報告にはメッシュ名、面数、モデル座標での範囲、面番号の例（0始まり）が入る。テクスチャの縦横比を含めて判定し、単色のために意図してUVを固定した面も検出する。別形式は対応するビューアや編集ツールでUVとテクスチャを調べる。[検品と修正](quality.md#uvのつぶれと渦の確認)を参照する。

## 開発用の自己確認

`python <skill>/scripts/test_toolkit.py --out <作業フォルダ>` は紡錘形・長い曲線形・薄い幅広形・左右非対称形の数値例で、出力、読み戻し、閉口、鰭、画像補間を確認する。これらは合成入力による部品テストで、任意の三面図が自動認識できる証明ではない。実際の図では必ず外観確認する。

同じテストで、正しいアトラス配置の受理と、鰭の画像が重なる配置・範囲外・空矩形等の拒否も確認する。
