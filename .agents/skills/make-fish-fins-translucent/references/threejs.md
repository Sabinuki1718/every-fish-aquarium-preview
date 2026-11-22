# Three.jsでの鰭膜・鰭条

## 半透明膜

独立した`MeshStandardMaterial`を作る。今回の目安は`transparent: true`、`opacity: 0.32`、`depthWrite: false`、`side: THREE.DoubleSide`、`roughness: 0.48`、淡い灰緑色`0xb5cfc5`。数値は照明・膜色・背景に合わせる。胴体は不透明材質のまま。`DoubleSide`は単層膜を想定した例。表裏と縁が閉じた厚み付き鰭では、[形状に応じた面の表示](fin-outline-and-patterns.md)を確認し、外向き法線と`FrontSide`も検討する。

`depthTest`は有効にする。遠い側の胸びれが胴体を透過して手前に出るような深度無効化や`renderOrder`で解決しない。膜の二重面による濃さ、ガラスや水面を含む半透明同士の描画順も確認する。影が不透明な塊になる場合は膜の`castShadow`を無効にするか、影側にも透明度を実装する。

`onBeforeCompile`で既存の頂点変形を失わないようにする。鰭条は基部からの角度で色とアルファを少し変える。`fwidth`で遠景のちらつきを抑える。Three.jsのバージョンが変わったらシェーダーチャンクと実機描画を検証する。付属ヘルパーはr170をもとにしている。

## 付属ヘルパー

`assets/fin-material.mjs`はプロジェクトのThree.jsを引数で受け取る。XY平面に近い鰭用で、別の向きなら鰭平面へ座標を変換するかシェーダーを変更する。

```js
import { findFinBase, createFinMaterial } from './fin-material.mjs';
// 必要ならジオメトリを複製し、ピボット移動後の局所座標にする。
// 基部が本当にx最小側にある扇形か確認してから使う。
const base = findFinBase(mesh.geometry, { axis: 'x', end: 'min' });
mesh.material = createFinMaterial(THREE, { base, opacity: 0.32 });
mesh.castShadow = false;
```

既存のスキン／モーフ変形には、基部と膜座標をどう追従させるか確認する。静的メッシュをノードごと回す実装と、ボーンで変形する鰭を混同しない。

## 今回受け入れられたチョウセンブナの例

全長約0.08 m、+Yが上、-Xが頭、左右が±Zの**特定GLB用**。別モデルの既定値にしない。

- 胴体：`Body_continuous_skin`。胸びれ：`Pectoral_port`、`Pectoral_starboard`。
- `side=+1/-1`。回転ピボット：`(-0.022, 0.0015, side * 0.0061)`。
- ジオメトリを複製し、元XYからピボットXYを引く。膜の局所Zは`(元Z - side * 0.0055) * 0.12`へ圧縮。メッシュ位置をピボットに設定する。
- 鰭条の基部：リベース後のX最小値から0.0001 m以内の頂点群のXY平均。元位置では約`(-0.02188, -0.00144)`。**回転ピボットのY=0.0015とは異なる**。ピボットを鰭条の始点にすると扇状にならなかった。
- 開閉：`rotation.y = -side * (0.08 + 0.56 * (0.5 + 0.5 * sin(t * 7.5 + phase)))`、`rotation.z = 0.06 * sin(t * 7.5 + phase + 0.8)`、`rotation.x=0`。以前の逆符号では膜が胴体内部へ回転していた。
- 1周期721ポーズの鰭頂点を、周辺胴体のZ幅と胴体シェーダー変形の最大振幅から得た保守的な包絡と比較した。両側とも約0.425 mmの余裕があった。モデル座標の値で、表示の25倍スケール前。

## 胴体模様の補完例

元アトラスには胸びれ下にぼかしが焼き込まれていた。原画から完全復元したのではなく、同じアトラスの隣接する橙・青緑の縞を使って補完した。

このモデルの胴体だけに、以下の局所マスクを使った。`p`は変形前のメッシュ座標、`n`は同座標系の法線、`vMapUv`は元アトラスUV。

```glsl
vec2 q = (p.xy - vec2(-.0165, -.0015)) / vec2(.0092, .0058);
float mask = 1. - smoothstep(.70, 1.02, length(q));
mask *= smoothstep(.35, .75, abs(normalize(n).z));
vec3 patch = texture2D(map, vec2(vMapUv.x - .2734375, vMapUv.y)).rgb;
diffuseColor.rgb = mix(diffuseColor.rgb, patch * diffuse, mask);
```

UVずらし量・マスクはこのアトラス専用。他のモデルでは画像境界やUV島跨ぎ、顔・腹部への誤投影を確認する。正常な模様を塗り替えず、顔の描き直しや全身の模様生成を小さな補完の代わりに行わない。
