// ブラウザ簡易版の魚ビューア（Python が無い環境で③を進めるための代替手段）。
// fish-spec.js が定義する window.FISH_SPECS（fish-spec の配列）を読み、魚を組み立てて表示する。
// ファイルをダブルクリックで開くだけで動く（通信・インストール不要）。three.js もこのファイルに同梱する。
//
// できること: 回転・拡大、側面/背面/腹面/正面/斜め、泳ぎの確認、同定形質のチェック、
//             三面図の側面図をドロップして模様に使う・重ねて輪郭を比べる、GLB と PNG の保存。
// 保存する GLB は build-aquarium-from-fish-model に渡せるよう、メートル単位・+Y が上・頭が -X にそろえる。

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildFish, textureBounds } from './fishgen/fish-builder.js';
import { paintSideTexture } from './fishgen/fish-texture.js';
import { createSwimRig } from './fishgen/swim.js';

const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (v != null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
};
const toast = (msg) => { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600); };
const save = (name, data, type) => {
  const a = el('a', { href: URL.createObjectURL(new Blob([data], { type })), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};

function fail(message) {
  $('loading').textContent = message;
  $('loading').hidden = false;
}

const specs = Array.isArray(window.FISH_SPECS) ? window.FISH_SPECS : window.FISH_SPECS ? [window.FISH_SPECS] : [];
if (!specs.length) {
  fail('fish-spec.js が読み込めていません。このファイルと同じフォルダに fish-spec.js を置いてください。');
  throw new Error('no FISH_SPECS');
}

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: true, preserveDrawingBuffer: true });
} catch (e) {
  fail('このブラウザでは 3D 表示（WebGL）を使えません。Chrome・Edge・Safari などの最新版で開いてください。');
  throw e;
}
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#2c3640');
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.4;
scene.add(new THREE.HemisphereLight('#ffffff', '#3a4a58', 1.1));
const key = new THREE.DirectionalLight('#ffffff', 2.2);
scene.add(key);
const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 2000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.screenSpacePanning = true;
const resize = () => {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
};
addEventListener('resize', resize);
resize();

let index = 0, fish = null, rig = null, overlay = null, sideImage = null, swim = true, wire = false, grid = null;

function current() { return specs[index]; }

async function show(i) {
  index = i;
  const spec = current();
  if (fish) { scene.remove(fish); fish.traverse((o) => o.geometry?.dispose?.()); }
  if (overlay) { scene.remove(overlay); overlay = null; }
  if (grid) scene.remove(grid);
  const L = spec.length_cm;
  let side;
  if (sideImage) side = sideImage;
  else side = paintSideTexture(spec);
  fish = buildFish(spec, { side });
  scene.add(fish);
  rig = createSwimRig(fish, spec.swim);
  if (wire) fish.traverse((o) => { if (o.isMesh) o.material.wireframe = true; });
  grid = new THREE.GridHelper(L * 3, 30, '#5d6d7a', '#46535e');
  grid.position.y = -L * 0.3;
  scene.add(grid);
  key.position.set(L, L * 2, L * 1.5);
  if (sideImage) addOverlay();
  setView('oblique');
  document.title = `${spec.name_ja} 3Dモデル`;
  renderPanel();
}

function addOverlay() {
  const spec = current(), L = spec.length_cm, b = textureBounds(spec);
  overlay = new THREE.Mesh(
    new THREE.PlaneGeometry((b.x1 - b.x0) * L, (b.y1 - b.y0) * L),
    new THREE.MeshBasicMaterial({ map: sideImage, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide }),
  );
  // 左体側（-Z 側）から見ると頭が左になるので、側面図をそのまま魚の向こう側に置く
  overlay.rotation.y = Math.PI;
  overlay.position.set((0.5 - (b.x0 + b.x1) / 2) * L, ((b.y0 + b.y1) / 2) * L, L * 0.3);
  overlay.visible = false;
  scene.add(overlay);
}

const VIEWS = {
  side: [0, 0, -1.6], top: [0, 1.6, 0.001], below: [0, -1.6, 0.001], front: [1.6, 0, 0], oblique: [0.9, 0.55, 1.2],
};
function setView(v) {
  // 縦長の画面（スマホ）でも全長が収まるよう、画面の縦横比に応じて離す
  const L = current().length_cm * Math.max(1, 1.15 / camera.aspect);
  camera.position.set(...VIEWS[v].map((k) => k * L));
  controls.target.set(0, 0, 0);
  controls.update();
}

async function exportGlb() {
  const spec = current();
  // 泳ぎの変形を止めた形で書き出す
  const clone = buildFish(spec, { side: sideImage ?? paintSideTexture(spec) });
  const root = new THREE.Group();
  root.name = spec.id;
  root.add(clone);
  clone.rotation.y = Math.PI;      // 頭を -X へ
  clone.scale.setScalar(0.01);     // cm → m
  root.userData = { units: 'meters', up: '+Y', forward: '-X', length_m: spec.length_cm / 100, source: 'fish-to-3d-aquarium browser fallback', species: spec.scientific_name };
  const glb = await new GLTFExporter().parseAsync(root, { binary: true });
  save(`${spec.id}.glb`, glb, 'model/gltf-binary');
  toast(`${spec.id}.glb を保存しました（ダウンロードフォルダ）`);
}

function screenshot() {
  renderer.render(scene, camera);
  renderer.domElement.toBlob((b) => { save(`${current().id}.png`, b, 'image/png'); toast('画像を保存しました'); });
}

function loadSideImage(file) {
  if (!file || !file.type.startsWith('image/')) return toast('画像ファイル（PNG・JPEG）をドロップしてください');
  const url = URL.createObjectURL(file);
  new THREE.TextureLoader().load(url, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    sideImage = tex;
    show(index);
    toast('側面図を模様に使いました。範囲がずれる場合は fish-spec の texture_bounds を直してください');
  }, undefined, () => toast('画像を読み込めませんでした'));
}
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => { e.preventDefault(); loadSideImage(e.dataTransfer.files[0]); });

function renderPanel() {
  const spec = current();
  const bar = $('bar');
  const btn = (label, fn, on) => el('button', { onclick: fn, class: on ? 'on' : '' }, label);
  bar.replaceChildren(...[
    specs.length > 1 ? el('select', { 'aria-label': '表示する魚', onchange: (e) => { sideImage = null; show(Number(e.target.value)); } },
      specs.map((s, i) => el('option', { value: i, selected: i === index }, s.name_ja))) : null,
    btn('側面', () => setView('side')), btn('背面', () => setView('top')), btn('腹面', () => setView('below')),
    btn('正面', () => setView('front')), btn('斜め', () => setView('oblique')),
    btn('泳ぎ', (e) => { swim = !swim; e.target.classList.toggle('on', swim); }, swim),
    btn('ワイヤー', (e) => { wire = !wire; fish.traverse((o) => { if (o.isMesh) o.material.wireframe = wire; }); e.target.classList.toggle('on', wire); }, wire),
    overlay ? btn('側面図を重ねる', (e) => { overlay.visible = !overlay.visible; e.target.classList.toggle('on', overlay.visible); if (overlay.visible) setView('side'); }) : null,
    btn('GLBを保存', exportGlb), btn('画像を保存', screenshot),
    btn('情報', () => { $('panel').hidden = !$('panel').hidden; }),
  ].filter(Boolean));
  $('panel').replaceChildren(
    el('h1', {}, spec.name_ja, ' ', el('i', {}, spec.scientific_name)),
    el('p', { class: 'muted' }, [spec.variant, `全長 ${spec.length_cm} cm`, 'ブラウザ簡易版'].filter(Boolean).join(' / ')),
    el('h2', {}, '同定形質のチェック'),
    el('div', { class: 'traits' }, (spec.traits ?? ['（fish-spec の traits に形質を書くと、ここに並びます）']).map((t) => el('label', {}, el('input', { type: 'checkbox' }), el('span', {}, t)))),
    el('p', { class: 'muted' }, '三面図の側面図（頭が左）をこの画面にドロップすると、模様に使い、輪郭と重ねて比べられます。'),
    spec.notes ? el('p', { class: 'muted' }, spec.notes) : null,
  );
}

if (innerWidth < 640) $('panel').hidden = true; // スマホでは「情報」ボタンで開く
$('help').textContent = 'ドラッグ: 回転 / ホイール・ピンチ: 拡大縮小 / 右ドラッグ: 移動';
show(0).then(() => {
  $('loading').hidden = true;
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const t = clock.getElapsedTime();
    if (swim) rig.update(t, 0.8, Math.sin(t * 0.4) * 0.15);
    controls.update();
    renderer.render(scene, camera);
  });
  window.__ready = true;
}).catch((e) => fail(`表示できませんでした: ${e.message}`));
