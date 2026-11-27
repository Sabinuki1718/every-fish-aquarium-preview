// claude.ai の Artifact で公開するときの起動部。three.js r170 の公式モジュールを CDN（importmap）から読み、
// オフライン版（lib/three-offline.js）と同じ形の window.THREE を用意してから水槽を始める。
import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

window.THREE = { ...T, OrbitControls, GLTFLoader, BufferGeometryUtils };
await import('./app.js');
