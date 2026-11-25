# nihonga-shader.js — 日本画風シェーダー

three.js（r170）用の自作シェーダーです。任意の3Dモデルを、日本画のような見た目で描画します。

- **彩色**：岩絵具のように色数を絞って彩度を落とします。筆跡はモデルの座標に固定し、影は藍色に寄せた2〜3段の段階影にします。
- **墨線**：3Dから毎フレーム輪郭線を取り出します。画面上の運筆方向に応じて、留め・跳ね・払いを付けます。
- **仕上げ**：和紙の質感（画面に固定）を重ね、輪郭の外側に色をにじませます。

## 使い方

```html
<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js"}}</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/loaders/GLTFLoader.js';
import { createNihonga } from './nihonga-shader.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.append(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.01, 100);
camera.position.set(0, 0, 3);

const nihonga = createNihonga(THREE, renderer, { lineWidth: 12 });

const gltf = await new GLTFLoader().loadAsync('model.glb');
scene.add(gltf.scene);
nihonga.add(gltf.scene);          // 日本画で描くモデルを登録

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  nihonga.setSize();             // 画面サイズが変わったら呼ぶ
});

renderer.setAnimationLoop(() => nihonga.render(scene, camera));   // renderer.render の代わり
</script>
```

## 設定（createNihonga の第3引数）

| 名前 | 既定値 | 内容 |
|---|---|---|
| `lineWidth` | 12 | 墨線のいちばん太い部分の幅（CSS px） |
| `ink` | true | 墨線を描くかどうか |
| `brush` | 1 | 筆跡の強さ（0〜1） |
| `bands` | 3 | 影の段数（2 または 3） |
| `inkColor` | 0x1a1a21 | 墨の色 |
| `occlusionEps` | 0.004 | 手前の物に隠れた線を消すときの許容差。シーンの単位が大きいときは増やす |
| `contourFilter` | なし | `(mesh, a, b, c) => boolean`。false を返した面には輪郭線を引かない（a,b,c は面の頂点座標 [x,y,z]） |

`lineWidth`、`ink`、`brush`、`bands` は、実行中も `nihonga.params` から変更できます。

```js
nihonga.params.lineWidth = 8;
nihonga.params.bands = 2;
```

## メッシュ単位の指定

- `mesh.userData.nihongaGroup = 'trunk'`：同じ値のメッシュどうしは、境目に線を引きません（例：胴と尾鰭）。
- 材質の `side` はそのまま引き継ぎます。薄い鰭などは、`THREE.DoubleSide` にしておくと裏からも見えます。
- テクスチャ（`material.map`）がない材質は、`material.color` の単色で塗ります。

## 前提と注意

- 筆跡の刷毛目は、モデルの **X軸方向** に長く伸びます。魚なら頭から尾の向きをX軸に合わせると自然に見えます。
- 墨線は、モデルが **閉じた形** であることを前提にしています。穴があると、その縁で線が途切れたり余分な線が出たりします。
- 輪郭の抽出はCPUで毎フレーム行います。頂点数が数万を超えると、スマホでは重くなります。
- 光の向きは画面基準（左上から）で固定です。シーンのライトは使いません。
- WebGL2 が必要です。
- three.js r170 で動作を確認しています。

## 追加した拡張（2026-11-25、青文魚の水槽用）

- `mesh.userData.nihongaDynamic = true` を付けたメッシュは、`geometry.attributes.position` を毎フレーム読み直して墨線を取ります。鰭・口・鰓をCPUで動かす（モーフの重みを頂点に足して position を書き換える）ときに使います。付けないメッシュは従来どおり登録時の形で線を取ります。
- 彩色の材質はモーフ・スキンを扱わないため、動きはCPUで頂点に反映してから描きます。
- 元のファイルは `nihonga-shader.original.js` に残しています。
- `mesh.userData.nihongaContourFaces`（三角形の数と同じ長さの配列。1=輪郭を取る、0=取らない）で、輪郭を探す面を限れます。薄い鰭を縁の帯だけにすると、鰭が動いたときに面の内側へ短い線が出たり消えたりする（チカチカ）のを防げます。
