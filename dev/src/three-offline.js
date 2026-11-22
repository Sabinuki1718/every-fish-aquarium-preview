// three.js と、水槽づくりでよく使う追加機能を window.THREE にまとめる（通信・インストール不要で使うため）。
//   <script src="three-offline.js"></script> のあと、通常の <script> から THREE.OrbitControls などを使える。
import * as THREE_NS from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

window.THREE = Object.assign({}, THREE_NS, {
  OrbitControls, TransformControls, GLTFLoader, GLTFExporter, RoomEnvironment, BufferGeometryUtils, SkeletonUtils,
});
