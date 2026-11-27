// 防波堤の下の海：承認済みの魚モデルと承認版レイアウト（v3）から作る3D水槽。
// 単位はメートル。x=左右（右が+）、y=上、z=前後（手前が+）、原点は水槽の底面中央。魚モデルは頭が -X。
import { createAquariumState } from './lib/aquarium-state.js';
import { chooseAquariumQuality, aquariumDrawingSize } from './lib/mobile-quality.js';

const THREE = window.THREE;
const LAYOUT_REVISION = 'bohatei-no-shita-v3';
const SAVE_KEY = 'breakwater-aquarium:' + LAYOUT_REVISION;
// 埋め込み版（file:// で開く1ファイル版）では window.EMBED にデータURLが入る
const url = p => (window.EMBED && window.EMBED[p]) || p;

const overlay = document.getElementById('overlay');
const overlayText = document.getElementById('overlay-text');
function fail(message, retry = true) {
  overlay.style.display = 'flex';
  overlayText.innerHTML = message + (retry ? '<br><button onclick="location.reload()">もう一度読み込む</button>' : '');
}

const params = new URLSearchParams(location.search);
const quality = chooseAquariumQuality({
  userAgent: navigator.userAgent, userAgentMobile: navigator.userAgentData?.mobile,
  maxTouchPoints: navigator.maxTouchPoints, coarsePointer: matchMedia('(pointer:coarse)').matches,
  requestedQuality: params.get('quality') ?? 'auto',
});
const LIGHT = quality.name === 'light';

// ------------------------------------------------------------------ 描画の準備
const stage = document.getElementById('stage');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: quality.antialias, powerPreference: 'high-performance' });
} catch (e) {
  fail('3D表示（WebGL）を始められませんでした。ほかのタブを閉じるか、別のブラウザーでお試しください。');
  throw e;
}
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = quality.shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.appendChild(renderer.domElement);
renderer.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); fail('表示が中断されました（GPUのメモリー不足など）。'); });

const scene = new THREE.Scene();
scene.background = new THREE.Color('#0b1d22');
const camera = new THREE.PerspectiveCamera(36, 1, 0.01, 20);
const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 0.25;
controls.maxDistance = 6; // 縦長のスマホ画面でも水槽全体が入るまで引けるように
controls.maxPolarAngle = Math.PI * 0.98;

const VIEWS = {
  front: { pos: [0, 0.24, 1.32], target: [0, 0.2, 0] },
  top: { pos: [0, 1.45, 0.02], target: [0, 0.1, 0] },
  oblique: { pos: [0.78, 0.6, 0.95], target: [0, 0.16, 0] },
};
function setView(name) {
  const v = VIEWS[name];
  // 画面が縦長のときは水槽全体が入るまで引く
  const fit = Math.max(1, 1.2 / Math.max(camera.aspect, 0.4));
  const target = new THREE.Vector3(...v.target);
  const pos = new THREE.Vector3(...v.pos).sub(target).multiplyScalar(fit).add(target);
  camera.position.copy(pos); controls.target.copy(target); controls.update();
}

function resize() {
  const size = aquariumDrawingSize(quality, stage.clientWidth, stage.clientHeight, devicePixelRatio);
  renderer.setPixelRatio(size.pixelRatio);
  renderer.setSize(size.cssWidth, size.cssHeight, false);
  camera.aspect = size.cssWidth / size.cssHeight;
  camera.updateProjectionMatrix();
  if (refractRT) refractRT.setSize(Math.max(1, size.drawingWidth >> 1), Math.max(1, size.drawingHeight >> 1));
}

// ------------------------------------------------------------------ 共有の時間と光の模様（集光模様）
const shared = { uTime: { value: 0 } };
const CAUSTIC_GLSL = `
uniform float uTime;
float causticAt(vec3 p) {
  vec2 q = p.xz * 22.0;
  float c = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    q += vec2(sin(q.y * 0.83 + uTime * 0.9 + fi * 1.3), cos(q.x * 0.91 - uTime * 0.7 + fi * 2.1)) * 0.55;
    c += abs(sin(q.x) + sin(q.y));
  }
  c = 1.0 - c / 4.2;
  return pow(clamp(c, 0.0, 1.0), 5.0) * 2.2;
}`;
// 静物の材質に、水中の揺れる光と（必要なら）三方向投影を足す
function decorate(material, { caustics = 0.35, triplanar = null, sway = null } = {}) {
  material.userData.extra = { caustics, triplanar, sway };
  material.onBeforeCompile = sh => {
    sh.uniforms.uTime = shared.uTime;
    sh.uniforms.uCaustic = { value: caustics };
    if (triplanar) { sh.uniforms.triTile = { value: triplanar.tile }; sh.uniforms.triScale = triplanar.scale; }
    if (sway) { sh.uniforms.uSway = sway; }
    let v = sh.vertexShader, f = sh.fragmentShader;
    v = 'varying vec3 vCWorld; varying vec3 vCNrm;\n' + (triplanar ? 'varying vec3 vTriPos; varying vec3 vTriNrm; uniform vec3 triScale;\n' : '') +
      (sway ? 'uniform float uTime; uniform vec4 uSway;\n' : '') + v;
    let begin = '#include <begin_vertex>\n';
    if (triplanar) begin += 'vTriPos = position * triScale; vTriNrm = normal / triScale;\n';
    if (sway) begin += `float hh = clamp(position.y / uSway.x, 0.0, 1.0);
      float sw = sin(uTime * uSway.y + uSway.z + position.x * 9.0) + 0.4 * sin(uTime * uSway.y * 2.3 + uSway.z * 1.7 + position.z * 13.0);
      transformed.x += sw * uSway.w * hh * hh;
      transformed.z += 0.5 * cos(uTime * uSway.y * 0.8 + uSway.z) * uSway.w * hh * hh;\n`;
    v = v.replace('#include <begin_vertex>', begin);
    v = v.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vCWorld = (modelMatrix * vec4(transformed, 1.0)).xyz; vCNrm = normalize(mat3(modelMatrix) * objectNormal);');
    f = 'varying vec3 vCWorld; varying vec3 vCNrm; uniform float uCaustic;\n' + CAUSTIC_GLSL + '\n' +
      (triplanar ? '\nvarying vec3 vTriPos; varying vec3 vTriNrm; uniform float triTile;\n' : '') + f;
    if (triplanar) f = f.replace('#include <map_fragment>', `
      vec3 bw = pow(abs(normalize(vTriNrm)), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
      vec3 tq = vTriPos / triTile;
      vec4 tc = texture2D(map, tq.zy) * bw.x + texture2D(map, tq.xz + 0.37) * bw.y + texture2D(map, tq.xy + 0.71) * bw.z;
      diffuseColor *= tc;`);
    f = f.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      float depthFade = clamp((0.43 - vCWorld.y) / 0.43, 0.0, 1.0);
      totalEmissiveRadiance += diffuseColor.rgb * causticAt(vCWorld) * uCaustic * max(vCNrm.y, 0.0) * (0.55 + 0.45 * (1.0 - depthFade));`);
    sh.vertexShader = v; sh.fragmentShader = f;
  };
  material.customProgramCacheKey = () => 'env' + (triplanar ? 't' : '') + (sway ? 's' : '');
  return material;
}

// ------------------------------------------------------------------ 決まった乱数
function rng(seedText) {
  let h = 2166136261;
  for (const ch of seedText) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  let s = (h >>> 0) % 2147483646 + 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}
const hash3 = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), f = t => t * t * (3 - 2 * t);
  const u = f(x - xi), v = f(y - yi), w = f(z - zi);
  let r = 0;
  for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++)
    r += hash3(xi + a, yi + b, zi + c) * (a ? u : 1 - u) * (b ? v : 1 - v) * (c ? w : 1 - w);
  return r;
}
const fbm = (x, y, z) => vnoise(x, y, z) * .55 + vnoise(x * 2.1, y * 2.1, z * 2.1) * .3 + vnoise(x * 4.3, y * 4.3, z * 4.3) * .15;

// ------------------------------------------------------------------ 読み込み
const texLoader = new THREE.TextureLoader();
function loadTexture(name, repeat) {
  const path = (LIGHT ? 'textures/light/' : 'textures/') + name + '.jpg';
  return new Promise((resolve, reject) => texLoader.load(url(path), t => {
    t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = LIGHT ? 2 : 8; if (repeat) t.repeat.set(...repeat);
    resolve(t);
  }, undefined, () => reject(new Error('素材画像を読み込めませんでした: ' + path))));
}
const gltfLoader = new THREE.GLTFLoader();
// .glb を配れない公開先では、同じ内容の JSON 形式（.gltf.json）を読む（window.MODEL_EXT で指定）。
// 公開先は data: URL の読み込みを禁じているので、埋め込まれたバッファをここで復号し、メモリー上で GLB に組み直して渡す
function jsonToGlb(doc) {
  const b64 = doc.buffers[0].uri.split(',')[1], bin = atob(b64);
  const binary = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) binary[i] = bin.charCodeAt(i);
  doc.buffers = [{ byteLength: binary.length }];
  let json = new TextEncoder().encode(JSON.stringify(doc));
  const pad = (n) => (4 - n % 4) % 4;
  const jsonLen = json.length + pad(json.length), binLen = binary.length + pad(binary.length);
  const out = new Uint8Array(12 + 8 + jsonLen + 8 + binLen), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, out.length, true);
  dv.setUint32(12, jsonLen, true); dv.setUint32(16, 0x4E4F534A, true);
  out.set(json, 20); out.fill(0x20, 20 + json.length, 20 + jsonLen);
  dv.setUint32(20 + jsonLen, binLen, true); dv.setUint32(24 + jsonLen, 0x004E4942, true);
  out.set(binary, 28 + jsonLen);
  return out.buffer;
}
async function loadModel(sp) {
  const path = (LIGHT ? 'models/light/' : 'models/') + sp + (window.MODEL_EXT || '.glb');
  if (!path.endsWith('.gltf.json')) return gltfLoader.loadAsync(url(path));
  // 形は標準・軽量で共通（models/<種>.gltf.json）。模様の画像だけ画質で切り替える
  const shape = 'models/' + sp + '.gltf.json';
  const res = await fetch(url(shape));
  if (!res.ok) throw new Error('魚のモデルを読み込めませんでした: ' + shape);
  const gltf = await gltfLoader.parseAsync(jsonToGlb(await res.json()), '');
  // 形だけのモデルには、別ファイルのアトラス画像を貼る（glTF の画像と同じ向き・色空間）
  const atlasPath = path.replace('.gltf.json', '.atlas.jpg');
  const tex = await new Promise((resolve, reject) => texLoader.load(url(atlasPath), resolve, undefined, () => reject(new Error('魚の模様の画像を読み込めませんでした: ' + atlasPath))));
  tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = LIGHT ? 2 : 8;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  gltf.scene.traverse(o => { if (o.isMesh && !o.material.map) { o.material.map = tex; o.material.needsUpdate = true; } });
  return gltf;
}

// ------------------------------------------------------------------ 水槽・背景・底
let TANK, layout, refractRT = null;
const selectable = new Map(); // id -> root Object3D
const stoneMats = new Map();  // id -> {colorId: material}
let stoneTex;

function buildTank(tex) {
  const T = layout.tank, hw = T.width_m / 2, hd = T.depth_m / 2, wl = T.water_level_m;
  TANK = { hw, hd, h: T.height_m, wl };

  scene.add(new THREE.HemisphereLight('#cdeef0', '#5a4c38', 1.15));
  const sun = new THREE.DirectionalLight('#fff3da', 2.5);
  sun.position.set(-0.3, 1.4, 0.45);
  sun.castShadow = quality.shadows;
  if (quality.shadows) {
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -.55, right: .55, top: .4, bottom: -.4, near: .3, far: 2.6 });
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.002;
  }
  scene.add(sun, sun.target);
  scene.fog = new THREE.Fog('#2d6b73', 0.35, 2.7);

  // 砂：ゆるい起伏。奥ほど少し高い
  const sg = new THREE.PlaneGeometry(T.width_m, T.depth_m, LIGHT ? 90 : 180, LIGHT ? 45 : 90);
  sg.rotateX(-Math.PI / 2);
  const sp = sg.attributes.position;
  for (let i = 0; i < sp.count; i++) {
    const x = sp.getX(i), z = sp.getZ(i);
    sp.setY(i, sandHeight(x, z));
  }
  sg.computeVertexNormals();
  const sand = new THREE.Mesh(sg, decorate(new THREE.MeshStandardMaterial({ map: tex.sand, roughness: 1 }), { caustics: 0.9 }));
  sand.receiveShadow = true; scene.add(sand);

  // 奥の壁：防波堤（ケーソン）。水面より上まで続く
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(T.width_m, T.height_m + 0.03, 1, 1),
    decorate(new THREE.MeshStandardMaterial({ map: tex.wall, roughness: .95 }), { caustics: 0.12 }));
  wall.position.set(0, (T.height_m + 0.03) / 2 - 0.015, -hd + 0.001); wall.receiveShadow = true; scene.add(wall);

  // ガラスと枠
  const glassMat = new THREE.MeshStandardMaterial({ color: '#d8f0f2', transparent: true, opacity: 0.05, roughness: 0.05, depthWrite: false });
  const panes = [[T.width_m, T.height_m, [0, T.height_m / 2, hd], [0, 0, 0]],
    [T.depth_m, T.height_m, [-hw, T.height_m / 2, 0], [0, Math.PI / 2, 0]], [T.depth_m, T.height_m, [hw, T.height_m / 2, 0], [0, Math.PI / 2, 0]]];
  for (const [w, h, p, r] of panes) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glassMat); m.position.set(...p); m.rotation.set(...r); m.renderOrder = 3; scene.add(m);
  }
  const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(T.width_m, T.height_m, T.depth_m)),
    new THREE.LineBasicMaterial({ color: '#cfe6e9', transparent: true, opacity: 0.5 }));
  frame.position.y = T.height_m / 2; scene.add(frame);
  // 台
  const base = new THREE.Mesh(new THREE.BoxGeometry(T.width_m + 0.04, 0.05, T.depth_m + 0.04), new THREE.MeshStandardMaterial({ color: '#1d2a2d', roughness: 0.8 }));
  base.position.y = -0.026; base.receiveShadow = true; scene.add(base);
}
const sandHeight = (x, z) => 0.012 + (fbm(x * 9, 0, z * 9) - .5) * 0.010 + Math.max(0, -z - 0.05) * 0.06;

// ------------------------------------------------------------------ 水面
let water;
function buildWater() {
  const { hw, hd, wl } = TANK;
  const seg = LIGHT ? 64 : 160;
  const g = new THREE.PlaneGeometry(hw * 2, hd * 2, seg, Math.round(seg / 2));
  g.rotateX(-Math.PI / 2);
  const uniforms = {
    uTime: shared.uTime, uRefract: { value: null }, uUseRefract: { value: !LIGHT ? 1 : 0 },
    uRes: { value: new THREE.Vector2(1, 1) }, uSun: { value: new THREE.Vector3(-0.3, 1.4, 0.45).normalize() },
    uWater: { value: new THREE.Color('#2c6a72') }, uSky: { value: new THREE.Color('#bfe3ea') },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, side: THREE.DoubleSide, depthWrite: false,
    vertexShader: `
      uniform float uTime;
      varying vec3 vW; varying vec3 vN; varying vec4 vClip;
      // 穏やかな複数の波（形と法線を同じ式から）
      vec3 waves(vec2 p, out vec3 n) {
        float h = 0.0; vec2 d = vec2(0.0);
        vec4 W[4];
        W[0] = vec4(0.8, 0.6, 38.0, 0.0011); W[1] = vec4(-0.5, 0.86, 57.0, 0.0007);
        W[2] = vec4(0.2, -1.0, 91.0, 0.00035); W[3] = vec4(-0.9, -0.3, 133.0, 0.0002);
        for (int i = 0; i < 4; i++) {
          vec2 dir = normalize(W[i].xy); float k = W[i].z; float a = W[i].w;
          float ph = dot(dir, p) * k + uTime * sqrt(9.8 * k) * 0.35;
          h += a * sin(ph); d += dir * a * k * cos(ph);
        }
        n = normalize(vec3(-d.x, 1.0, -d.y));
        return vec3(p.x, h, p.y);
      }
      void main() {
        vec3 n; vec3 w = waves(position.xz, n);
        vec4 wp = modelMatrix * vec4(w.x, position.y + w.y, w.z, 1.0);
        vW = wp.xyz; vN = n;
        vClip = projectionMatrix * viewMatrix * wp;
        gl_Position = vClip;
      }`,
    fragmentShader: `
      uniform sampler2D uRefract; uniform float uUseRefract; uniform vec3 uSun; uniform vec3 uWater; uniform vec3 uSky; uniform float uTime;
      varying vec3 vW; varying vec3 vN; varying vec4 vClip;
      void main() {
        vec3 V = normalize(cameraPosition - vW);
        bool above = cameraPosition.y > vW.y;
        vec3 N = above ? vN : -vN;
        float cosT = clamp(dot(N, V), 0.0, 1.0);
        vec2 suv = vClip.xy / vClip.w * 0.5 + 0.5;
        vec3 col; float alpha;
        if (above) {
          // 上から：角度で強まる反射（フレネル）と、波で揺れる屈折
          float F = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
          vec3 refr = uWater * 0.9;
          if (uUseRefract > 0.5) refr = texture2D(uRefract, clamp(suv + vN.xz * 0.06, 0.001, 0.999)).rgb;
          vec3 R = reflect(-V, N);
          vec3 refl = mix(uSky * 0.55, uSky, clamp(R.y, 0.0, 1.0));
          float spec = pow(max(dot(R, uSun), 0.0), 900.0) * 1.4;
          col = mix(refr, refl, F) + spec;
          alpha = uUseRefract > 0.5 ? 1.0 : mix(0.35, 0.9, F);
        } else {
          // 水中から：臨界角（約48.6°）より浅い所は全反射で水の色、内側は明るい空
          float window = smoothstep(0.62, 0.70, cosT);
          vec3 refl = uWater * 0.75;
          if (uUseRefract > 0.5) refl = mix(refl, texture2D(uRefract, clamp(vec2(suv.x, 1.0 - suv.y) + vN.xz * 0.05, 0.001, 0.999)).rgb * 0.8, 0.5);
          vec3 sky = uSky * 1.25;
          float spark = pow(max(dot(reflect(-V, N), -uSun), 0.0), 60.0);
          col = mix(refl, sky, window) + spark * 0.6 + vec3(0.04, 0.07, 0.07) * clamp(vN.x * 8.0 + vN.z * 6.0, -1.0, 1.0);
          alpha = mix(0.55, 0.8, window);
        }
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  water = new THREE.Mesh(g, mat);
  water.position.y = wl; water.renderOrder = 2; scene.add(water);
  // 水際：ガラスに沿った細い明るい線（メニスカス）
  const menMat = new THREE.MeshBasicMaterial({ color: '#e6fbff', transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
  for (const [w, p, ry] of [[hw * 2, [0, wl + 0.0015, hd - 0.0008], 0], [hw * 2, [0, wl + 0.0015, -hd + 0.002], 0], [hd * 2, [-hw + 0.0008, wl + 0.0015, 0], Math.PI / 2], [hd * 2, [hw - 0.0008, wl + 0.0015, 0], Math.PI / 2]]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.004), menMat); m.position.set(...p); m.rotation.y = ry; scene.add(m);
  }
  if (!LIGHT) {
    refractRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, colorSpace: THREE.LinearSRGBColorSpace });
    uniforms.uRefract.value = refractRT.texture;
  }
}

// ------------------------------------------------------------------ 配置物（石・テトラポッド・海藻・アマモ）
const NAMES = { stone: '捨て石', block: 'テトラポッド', seaweed: 'ホンダワラ', seagrass: 'アマモ' };
function stoneGeometry(it) {
  const r = rng(it.id);
  // 頂点を共有させてから変形し、なめらかな法線にする
  let g = new THREE.IcosahedronGeometry(1, LIGHT ? 4 : 5);
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  g = THREE.BufferGeometryUtils.mergeVertices(g);
  const p = g.attributes.position, o = r() * 50;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 1 + (fbm(v.x * 1.6 + o, v.y * 1.6, v.z * 1.6) - .5) * .55 + (vnoise(v.x * 6 + o, v.y * 6, v.z * 6) - .5) * .08;
    v.multiplyScalar(k);
    if (v.y < -.35) v.y = -.35 + (v.y + .35) * .25; // 底は平らに座らせる
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.scale(it.size[0] / 2, it.size[1] / 2, it.size[2] / 2);
  g.computeVertexNormals();
  return g;
}
function stoneMaterial(id, colorId, size) {
  const byColor = stoneMats.get(id) || {};
  if (!byColor[colorId]) {
    byColor[colorId] = decorate(new THREE.MeshStandardMaterial({ map: stoneTex[colorId], roughness: .9 }), {
      caustics: 0.4, triplanar: { tile: 0.09, scale: { value: new THREE.Vector3(1, 1, 1) } } });
    stoneMats.set(id, byColor);
  }
  return byColor[colorId];
}
function tetrapodGeometry(s) {
  const parts = [];
  const dirs = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]].map(d => new THREE.Vector3(...d).normalize());
  const up = new THREE.Vector3(0, 1, 0), seg = LIGHT ? 18 : 32;
  for (const d of dirs) {
    const leg = new THREE.CylinderGeometry(s * .11, s * .2, s * .5, seg, 4);
    leg.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, d));
    leg.translate(...d.clone().multiplyScalar(s * .25).toArray());
    const tip = new THREE.SphereGeometry(s * .11, seg, Math.round(seg / 2));
    tip.translate(...d.clone().multiplyScalar(s * .5).toArray());
    parts.push(leg.toNonIndexed(), tip.toNonIndexed());
  }
  parts.push(new THREE.SphereGeometry(s * .21, seg, Math.round(seg / 2)).toNonIndexed());
  parts.forEach(p => { p.deleteAttribute('uv'); });
  return THREE.BufferGeometryUtils.mergeGeometries(parts); // 法線は各部品のなめらかな法線をそのまま使う
}
function seaweedObject(it) {
  // ホンダワラ類：細い茎に小さな葉と気胞。株ごとに1つの形にまとめ、葉先ほど揺らす
  const r = rng(it.id), stems = [], leaves = [], bladders = [];
  for (let k = 0; k < 9; k++) {
    const pts = [], lean = (r() - .5) * .5, ph = r() * 6;
    for (let j = 0; j <= 10; j++) {
      const t = j / 10;
      pts.push(new THREE.Vector3(Math.sin(t * 2 + ph) * .012 + lean * t * it.height * .4, t * it.height, Math.cos(t * 2.3 + ph) * .01));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    stems.push(new THREE.TubeGeometry(curve, 20, .0016, 5).toNonIndexed());
    for (let j = 0; j < (LIGHT ? 22 : 34); j++) {
      const q = curve.getPoint(.15 + r() * .85), isLeaf = j % 4 !== 0;
      // 葉は細長いへら形、気胞は小さな球
      const g = new THREE.SphereGeometry(.006, LIGHT ? 8 : 12, LIGHT ? 5 : 8);
      g.scale(isLeaf ? 1.9 : .5, isLeaf ? .16 : .5, isLeaf ? .55 : .5);
      g.rotateX(r() * 3); g.rotateY(r() * 3); g.rotateZ(r() * 3); g.translate(q.x, q.y, q.z);
      (isLeaf ? leaves : bladders).push(g.toNonIndexed());
    }
  }
  // 部品ごとに色を少しずつ変える（同じ色の塊に見せない）
  const tint = (gs, base, spread) => gs.forEach(g => {
    const c = new THREE.Color(base).offsetHSL((r() - .5) * .03, (r() - .5) * .15, (r() - .5) * spread);
    const n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  });
  const strip = gs => { gs.forEach(g => g.deleteAttribute('uv')); return THREE.BufferGeometryUtils.mergeGeometries(gs); };
  const sway = { value: new THREE.Vector4(it.height, 1.3, r() * 6, 0.012) };
  const grp = new THREE.Group();
  const mk = geo => {
    const m = new THREE.Mesh(geo, decorate(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .7, side: THREE.DoubleSide }), { caustics: 0.25, sway }));
    m.castShadow = true; grp.add(m);
  };
  tint(stems, '#5c4a1e', .06); tint(leaves, '#7d6626', .12); tint(bladders, '#6a5420', .08);
  mk(strip([...stems, ...leaves, ...bladders]));
  return grp;
}
function seagrassObject(it) {
  // アマモ：砂から立つ株ごとに3〜5枚の細長い葉
  const r = rng(it.id), blades = [];
  const shoots = LIGHT ? Math.ceil(it.shoots * 0.7) : it.shoots;
  const cols = ['#3f6f2a', '#4d7f31', '#5b8a36', '#6c8f3c'].map(c => new THREE.Color(c));
  for (let k = 0; k < shoots; k++) {
    const a = r() * Math.PI * 2, rad = Math.sqrt(r()) * it.radius;
    const bx = Math.cos(a) * rad, bz = Math.sin(a) * rad * .8;
    const nb = 3 + Math.floor(r() * 3), hk = .55 + r() * .45;
    for (let b = 0; b < nb; b++) {
      const h = it.height * hk * (.6 + r() * .4), w = .004 + r() * .0015, seg = 14;
      const g = new THREE.PlaneGeometry(w, h, 1, seg); g.translate(0, h / 2, 0);
      const p = g.attributes.position, bend = .25 + r() * .35, tw = (r() - .5) * .8, rot = (r() - .5) * .9;
      for (let i = 0; i < p.count; i++) {
        const t = p.getY(i) / h, x = p.getX(i);
        p.setXYZ(i, x * Math.cos(t * tw) + t * t * h * bend, p.getY(i) * (1 - .25 * t * bend), x * Math.sin(t * tw) + t * t * h * bend * .35);
      }
      g.rotateY(rot); g.translate(bx, 0, bz);
      const c = cols[Math.floor(r() * cols.length)], ng = g.toNonIndexed();
      ng.deleteAttribute('uv');
      const colors = new Float32Array(ng.attributes.position.count * 3);
      for (let i = 0; i < colors.length; i += 3) { const lift = ng.attributes.position.getY(i / 3) / it.height * 0.25; colors[i] = c.r + lift; colors[i + 1] = c.g + lift; colors[i + 2] = c.b + lift * .5; }
      ng.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      blades.push(ng);
    }
  }
  const geo = THREE.BufferGeometryUtils.mergeGeometries(blades);
  geo.computeVertexNormals();
  const sway = { value: new THREE.Vector4(it.height, 0.9, r() * 6, 0.03) };
  const m = new THREE.Mesh(geo, decorate(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .6, side: THREE.DoubleSide }), { caustics: 0.25, sway }));
  m.castShadow = true;
  const grp = new THREE.Group(); grp.add(m);
  return grp;
}

const KIND = { stone: 'stone', block: 'block', seaweed: 'plant', seagrass: 'plant' };
function buildItems(tex) {
  stoneTex = { 'blue-gray': tex.stoneBlue, 'red-brown': tex.stoneRed };
  const tetraGeo = new Map();
  let n = { stone: 0, block: 0, seaweed: 0, seagrass: 0 };
  for (const it of layout.items) {
    let root;
    if (it.type === 'stone') {
      root = new THREE.Group();
      const mesh = new THREE.Mesh(stoneGeometry(it), stoneMaterial(it.id, it.color, it.size));
      mesh.castShadow = mesh.receiveShadow = true; root.add(mesh);
      root.userData.mesh = mesh;
    } else if (it.type === 'block') {
      if (!tetraGeo.has(it.size)) tetraGeo.set(it.size, tetrapodGeometry(it.size));
      root = new THREE.Group();
      const mesh = new THREE.Mesh(tetraGeo.get(it.size), decorate(new THREE.MeshStandardMaterial({ map: tex.tetra, roughness: .95 }), {
        caustics: 0.4, triplanar: { tile: 0.12, scale: { value: new THREE.Vector3(1, 1, 1) } } }));
      mesh.castShadow = mesh.receiveShadow = true; root.add(mesh);
    } else if (it.type === 'seaweed') root = seaweedObject(it);
    else if (it.type === 'seagrass') root = seagrassObject(it);
    else continue;
    n[it.type]++;
    root.userData.layoutId = it.id;
    root.userData.label = `${NAMES[it.type]} ${n[it.type]}`;
    root.userData.kind = KIND[it.type];
    // はみ出し判定の半径（外形の半分ほど。承認版の配置がガラス際まで置いているので、それが収まる値）
    root.userData.radius = 0.5 * (it.type === 'stone' ? Math.max(it.size[0], it.size[2]) / 2 : it.type === 'block' ? it.size * 0.6 : it.type === 'seagrass' ? it.radius : 0.03);
    root.position.set(...it.position);
    const rd = (it.rotation_deg || [0, 0, 0]).map(THREE.MathUtils.degToRad);
    root.rotation.set(...rd);
    scene.add(root);
    selectable.set(it.id, root);
  }
}

// ------------------------------------------------------------------ 魚
// 体のうねり：魚の座標で、頭から尾へ大きくなる横振れ。個体ごとの値は uniform（同じ描画プログラムを共有）
function fishMaterial(base, fish, fin) {
  const m = base.clone();
  m.side = THREE.DoubleSide;
  if (fin) { m.transparent = true; m.opacity = 0.82; m.depthWrite = false; }
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, fish.uniforms);
    sh.vertexShader = `uniform float uTime, uPhase, uAmp, uFreq, uHeadX, uLen;
      uniform mat4 uFishMat, uFishInv;\n` + sh.vertexShader.replace('#include <project_vertex>', `
      vec4 wpos = modelMatrix * vec4(transformed, 1.0);
      vec4 fpos = uFishInv * wpos;
      float sx = clamp((fpos.x - uHeadX) / uLen, 0.0, 1.0);
      float bend = smoothstep(0.18, 1.0, sx);
      fpos.z += uAmp * uLen * bend * bend * sin(6.2831 * sx * 0.9 - uTime * uFreq + uPhase);
      fpos.z += uAmp * uLen * 0.12 * (1.0 - sx) * sin(-uTime * uFreq + uPhase + 0.8);
      wpos = uFishMat * fpos;
      vec4 mvPosition = viewMatrix * wpos;
      gl_Position = projectionMatrix * mvPosition;`);
    sh.fragmentShader = 'uniform float uTime;\n' + CAUSTIC_GLSL.replace('uniform float uTime;', '') + '\nvarying vec3 vFW;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * causticAt(vFW) * 0.12;');
    sh.vertexShader = 'varying vec3 vFW;\n' + sh.vertexShader.replace('gl_Position = projectionMatrix * mvPosition;', 'gl_Position = projectionMatrix * mvPosition; vFW = wpos.xyz;');
  };
  m.customProgramCacheKey = () => fin ? 'fish-fin' : 'fish-body';
  return m;
}

// 対鰭：鰭の付け根（胴に最も近い頂点群）を軸にして、外側へ開閉する
function finPivot(mesh, side, amp) {
  const g = mesh.geometry, p = g.attributes.position;
  let minZ = Infinity;
  for (let i = 0; i < p.count; i++) minZ = Math.min(minZ, Math.abs(p.getZ(i)));
  const base = [];
  for (let i = 0; i < p.count; i++) if (Math.abs(p.getZ(i)) < minZ + 0.0015) base.push(new THREE.Vector3().fromBufferAttribute(p, i));
  const c = base.reduce((a, b) => a.add(b), new THREE.Vector3()).multiplyScalar(1 / base.length);
  // 付け根の線の向き（主成分）を回転軸に
  let axis = new THREE.Vector3(0, 1, 0);
  if (base.length > 2) {
    let best = 0;
    for (const a of base) for (const b of base) { const d = a.distanceToSquared(b); if (d > best) { best = d; axis = b.clone().sub(a).normalize(); } }
  }
  // 正の角度で鰭の重心が胴から離れる向きに
  const box = new THREE.Box3().setFromBufferAttribute(p), cen = box.getCenter(new THREE.Vector3());
  const test = cen.clone().sub(c).applyAxisAngle(axis, 0.2).add(c);
  if (Math.abs(test.z) < Math.abs(cen.z)) axis.negate();
  const pivot = new THREE.Group();
  pivot.position.copy(c);
  mesh.parent.add(pivot);
  mesh.position.sub(c); pivot.add(mesh);
  return { pivot, axis, amp, side };
}

const FISH_STYLE = {
  'trachurus-japonicus': { amp: 0.07, freq: 10, speed: 0.1 },
  'sillago-japonica': { amp: 0.08, freq: 9, speed: 0.08 },
  'acanthopagrus-schlegelii': { amp: 0.06, freq: 6, speed: 0.065 },
  'thamnaconus-modestus': { amp: 0.035, freq: 5, speed: 0.04 },
  'epinephelus-akaara': { amp: 0.03, freq: 3, speed: 0 },
};
const fishes = [];
async function buildFish() {
  const species = [...new Set(layout.fish.map(f => f.species))];
  const models = {};
  for (const sp of species) {
    overlayText.textContent = `魚を読み込んでいます…（${Object.keys(models).length + 1}/${species.length}）`;
    models[sp] = await loadModel(sp);
  }
  layout.fish.forEach((f, idx) => {
    const gltf = models[f.species], src = gltf.scene.getObjectByName('Fish_root') || gltf.scene;
    const model = src.clone(true);
    const box = new THREE.Box3().setFromObject(src), L = box.max.x - box.min.x;
    const root = new THREE.Group();
    const center = box.getCenter(new THREE.Vector3());
    model.position.set(-center.x, -center.y, -center.z);
    root.add(model);
    const s = f.display_length_m / L;
    root.scale.setScalar(s);
    const r = rng(f.id);
    const style = FISH_STYLE[f.species];
    const fish = {
      def: f, root, model, L, style, r, phase: r() * 6.28,
      uniforms: {
        uTime: shared.uTime, uPhase: { value: r() * 6.28 }, uAmp: { value: style.amp }, uFreq: { value: style.freq },
        uHeadX: { value: box.min.x }, uLen: { value: L }, uFishMat: { value: new THREE.Matrix4() }, uFishInv: { value: new THREE.Matrix4() },
      },
      fins: [], jaw: null,
    };
    let baseMat;
    model.traverse(o => { if (o.isMesh && !baseMat) baseMat = o.material; });
    const bodyMat = fishMaterial(baseMat, fish, false), finMat = fishMaterial(baseMat, fish, true);
    const meshes = [];
    model.traverse(o => { if (o.isMesh) meshes.push(o); });
    for (const o of meshes) {
      const isFin = /Dorsal|Anal|Caudal|Pectoral|Pelvic/.test(o.name) && !/spine/.test(o.name);
      o.material = isFin ? finMat : bodyMat;
      o.castShadow = quality.shadows; o.receiveShadow = false;
      o.frustumCulled = false;
      if (/^Pectoral_/.test(o.name)) fish.fins.push(finPivot(o, o.name.endsWith('R') ? 1 : -1, 0.32));
      if (/^Pelvic_/.test(o.name) && !/spine/.test(o.name)) fish.fins.push(finPivot(o, o.name.endsWith('R') ? 1 : -1, 0.12));
    }
    // キジハタの下顎：GLB のメタデータの蝶番で回す
    const jawMeta = src.userData?.jaw;
    if (jawMeta) {
      const jm = model.getObjectByName(jawMeta.node);
      if (jm) {
        const pv = new THREE.Group(); pv.position.fromArray(jawMeta.hinge);
        jm.parent.add(pv); jm.position.sub(pv.position); pv.add(jm);
        fish.jaw = { pivot: pv, axis: new THREE.Vector3(...jawMeta.axis), max: THREE.MathUtils.degToRad(jawMeta.max_open_deg) };
      }
    }
    fish.motion = makeMotion(f, fish, idx);
    scene.add(root);
    fishes.push(fish);
  });
}

// 泳ぐ道筋：種ごとの遊泳層に合わせた閉じた曲線。個体ごとに少しずつずらす
function loopCurve(points) { return new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)), true, 'centripetal'); }
const SCHOOL = loopCurve([[-0.30, 0.30, 0.04], [-0.05, 0.34, 0.12], [0.30, 0.31, 0.07], [0.34, 0.29, -0.09], [0.05, 0.33, -0.13], [-0.32, 0.32, -0.08]]);
const SCHOOL_LEN = SCHOOL.getLength();
function makeMotion(f, fish, idx) {
  const r = fish.r, sp = f.species;
  if (sp === 'trachurus-japonicus') {
    const k = idx;
    return { type: 'school', u: (k * 0.022) % 1, lat: (r() - .5) * 0.07, ver: (r() - .5) * 0.05, lag: r() * 6 };
  }
  if (sp === 'sillago-japonica') {
    const cx = 0.2 + (r() - .5) * 0.08, cz = 0.1 + (r() - .5) * 0.04;
    const pts = []; const n = 6;
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2 + r() * .5; pts.push([cx + Math.cos(a) * (0.13 + r() * 0.04), 0, cz + Math.sin(a) * (0.06 + r() * 0.02)]); }
    return { type: 'path', curve: loopCurve(pts), u: r(), bottom: 0.03, burst: true };
  }
  if (sp === 'acanthopagrus-schlegelii') {
    return { type: 'path', curve: loopCurve([[-0.32, 0.21, -0.03], [-0.12, 0.25, 0.1], [0.12, 0.27, 0.08], [0.27, 0.29, -0.04], [0.05, 0.23, -0.1], [-0.2, 0.2, -0.1]]), u: r() };
  }
  if (sp === 'thamnaconus-modestus') {
    const o = (r() - .5) * 0.04;
    return { type: 'path', curve: loopCurve([[-0.12, 0.11 + o, 0.05], [0.04, 0.10 + o, 0.08], [0.1, 0.13 + o, -0.02], [0.0, 0.15 + o, -0.06], [-0.15, 0.13 + o, -0.02]]), u: r(), hover: true };
  }
  // キジハタは石の隙間の前で、頭を手前（左前）へ出して定位させる。正面から見て左向きなのは承認版の画像と同じ
  return { type: 'station', base: new THREE.Vector3(...f.position), heading: THREE.MathUtils.degToRad(Math.abs(f.heading_deg)) };
}

const _m = new THREE.Matrix4(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
function orient(fish, pos, dir, bank = 0) {
  // 頭（-X）を進む向きへ
  _x.copy(dir).normalize().negate();
  _z.crossVectors(_x, _up).normalize();
  _y.crossVectors(_z, _x).normalize();
  if (bank) _y.applyAxisAngle(_x, bank), _z.crossVectors(_x, _y);
  _m.makeBasis(_x, _y, _z);
  const q = new THREE.Quaternion().setFromRotationMatrix(_m);
  fish.root.quaternion.slerp(q, fish.smoothTurn ?? 1);
  fish.root.position.copy(pos);
}
function clampInTank(p, margin) {
  p.x = THREE.MathUtils.clamp(p.x, -TANK.hw + margin, TANK.hw - margin);
  p.z = THREE.MathUtils.clamp(p.z, -TANK.hd + margin, TANK.hd - margin);
  p.y = THREE.MathUtils.clamp(p.y, 0.03, TANK.wl - 0.03);
  return p;
}
function updateFish(fish, t, dt) {
  const mo = fish.motion, f = fish.def, half = f.display_length_m / 2;
  let speedK = 1;
  fish.smoothTurn = Math.min(1, dt * 4);
  if (mo.type === 'school') {
    mo.u = (mo.u + fish.style.speed * dt / SCHOOL_LEN) % 1;
    const p = SCHOOL.getPointAt(mo.u), tan = SCHOOL.getTangentAt(mo.u);
    const side = new THREE.Vector3().crossVectors(tan, _up).normalize();
    p.addScaledVector(side, mo.lat + Math.sin(t * 0.5 + mo.lag) * 0.012).add(new THREE.Vector3(0, mo.ver + Math.sin(t * 0.7 + mo.lag) * 0.008, 0));
    orient(fish, clampInTank(p, half * 0.6), tan);
  } else if (mo.type === 'path') {
    const L = mo.len ?? (mo.len = mo.curve.getLength());
    if (mo.burst) speedK = 0.15 + 1.3 * Math.pow(Math.max(0, Math.sin(t * 0.9 + fish.phase)), 3);
    if (mo.hover) speedK = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * 0.35 + fish.phase));
    mo.u = (mo.u + fish.style.speed * speedK * dt / L) % 1;
    const p = mo.curve.getPointAt(mo.u), tan = mo.curve.getTangentAt(mo.u);
    if (mo.bottom !== undefined) { p.y = sandHeight(p.x, p.z) + mo.bottom + 0.004 * Math.sin(t * 1.3 + fish.phase); tan.y = 0; }
    else p.y += Math.sin(t * 0.6 + fish.phase) * 0.006;
    orient(fish, clampInTank(p, half * 0.6), tan, -0.12 * Math.sin(t * 0.3 + fish.phase));
  } else {
    // 隙間の前で定位：わずかな上下と向きの揺らぎ
    const p = mo.base.clone(); p.y += Math.sin(t * 0.8) * 0.003;
    const a = mo.heading + Math.sin(t * 0.21) * 0.12;
    // heading は配置案と同じく、+X を向いた魚を Y 軸まわりに回した角度
    const dir = new THREE.Vector3(-Math.cos(a), 0, Math.sin(a));
    fish.smoothTurn = 1;
    orient(fish, p, dir);
    speedK = 0.4;
  }
  fish.root.updateMatrixWorld(true);
  fish.uniforms.uFishMat.value.copy(fish.model.matrixWorld);
  fish.uniforms.uFishInv.value.copy(fish.model.matrixWorld).invert();
  fish.uniforms.uAmp.value = fish.style.amp * (0.45 + 0.55 * Math.min(speedK, 1.4));
  for (const fin of fish.fins) {
    const a = fin.amp * (0.5 + 0.5 * Math.sin(t * (fin.amp > 0.2 ? 3.2 : 2.1) + fish.phase + (fin.side > 0 ? 0 : 0.4)));
    fin.pivot.quaternion.setFromAxisAngle(fin.axis, a - fin.amp * 0.15);
  }
  if (fish.jaw) {
    // 呼吸に合わせた小さな開閉と、ときどき大きく開ける
    const big = Math.pow(Math.max(0, Math.sin(t * 0.45 + 1.2)), 24);
    const ang = THREE.MathUtils.degToRad(2.5 + 2 * (0.5 + 0.5 * Math.sin(t * 1.7))) + fish.jaw.max * 0.85 * big;
    fish.jaw.pivot.quaternion.setFromAxisAngle(fish.jaw.axis, ang);
  }
}

// ------------------------------------------------------------------ 配置の状態（承認版を初期状態に）
let state;
const defaultQuat = new Map(); // id -> 承認版の向き（向きスライダーはこれを鉛直軸まわりに回す）
const eulerToQuat = r => new THREE.Quaternion().setFromEuler(new THREE.Euler(...r));
function yawOf(id, rot) {
  const q = eulerToQuat(rot).multiply(defaultQuat.get(id).clone().invert());
  return new THREE.Euler().setFromQuaternion(q, 'YXZ').y;
}
function withYaw(id, yaw) {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw).multiply(defaultQuat.get(id));
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  return [e.x, e.y, e.z];
}
function initialObjects() {
  for (const it of layout.items) if (selectable.has(it.id)) defaultQuat.set(it.id, eulerToQuat((it.rotation_deg || [0, 0, 0]).map(THREE.MathUtils.degToRad)));
  return layout.items.filter(it => selectable.has(it.id)).map(it => ({
    id: it.id, kind: KIND[it.type], position: [...it.position],
    rotation: (it.rotation_deg || [0, 0, 0]).map(THREE.MathUtils.degToRad),
    ...(it.type === 'stone' ? { colorId: it.color } : {}),
  }));
}
function applyState() {
  for (const o of state.snapshot().objects) {
    const root = selectable.get(o.id);
    root.position.fromArray(o.position);
    root.rotation.set(...o.rotation);
    if (o.kind === 'stone') root.userData.mesh.material = stoneMaterial(o.id, o.colorId);
  }
  refreshEditor();
}
function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state.snapshot())); }
  catch { document.getElementById('save-note').textContent = 'このブラウザーでは保存できません（変更は再読み込みで消えます）。'; }
}
function restoreSaved() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw && state.load(JSON.parse(raw))) {
      // 水槽からはみ出した値は戻す
      for (const o of state.snapshot().objects) {
        const p = o.position, r = selectable.get(o.id).userData.radius;
        const q = [THREE.MathUtils.clamp(p[0], -TANK.hw + r, TANK.hw - r), THREE.MathUtils.clamp(p[1], 0, TANK.wl), THREE.MathUtils.clamp(p[2], -TANK.hd + r, TANK.hd - r)];
        if (q.some((v, i) => v !== p[i])) state.setTransform(o.id, { position: q });
      }
    }
  } catch { /* 保存データが読めなければ承認版のまま */ }
}

// ------------------------------------------------------------------ 画面の操作
const editor = document.getElementById('editor');
const targetSel = document.getElementById('target');
let mode = 'view', selectedId = null, selBox = null;
const COLORS = { 'blue-gray': ['青灰', '#6f7b84'], 'red-brown': ['赤茶', '#8a5f4c'] };
function setMode(m) {
  mode = m;
  document.getElementById('mode-view').setAttribute('aria-pressed', m === 'view');
  document.getElementById('mode-edit').setAttribute('aria-pressed', m === 'edit');
  editor.classList.toggle('open', m === 'edit');
  if (m === 'edit' && !selectedId) select(layout.items[0].id);
  if (selBox) selBox.visible = m === 'edit';
}
function select(id) {
  selectedId = id;
  targetSel.value = id;
  if (!selBox) { selBox = new THREE.BoxHelper(selectable.get(id), '#ffd27a'); scene.add(selBox); }
  selBox.setFromObject(selectable.get(id)); selBox.visible = mode === 'edit';
  refreshEditor();
}
const sliders = { px: ['x', 0], pz: ['z', 2], py: ['y', 1] };
function refreshEditor() {
  if (!selectedId || !state) return;
  const o = state.snapshot().objects.find(o => o.id === selectedId), root = selectable.get(selectedId), r = root.userData.radius;
  const set = (id, min, max, v, text) => { const el = document.getElementById(id); el.min = min; el.max = max; el.value = v; document.getElementById(id + '-v').textContent = text; };
  set('px', -TANK.hw + r, TANK.hw - r, o.position[0], (o.position[0] * 100).toFixed(1) + 'cm');
  set('pz', -TANK.hd + r, TANK.hd - r, o.position[2], (o.position[2] * 100).toFixed(1) + 'cm');
  set('py', 0, 0.3, o.position[1], (o.position[1] * 100).toFixed(1) + 'cm');
  const deg = THREE.MathUtils.radToDeg(yawOf(o.id, o.rotation));
  set('ry', -180, 180, deg, Math.round(deg) + '°');
  document.getElementById('stone-colors').style.display = o.kind === 'stone' ? '' : 'none';
  document.querySelectorAll('#one-color button').forEach(b => b.setAttribute('aria-pressed', o.colorId === b.dataset.color));
  if (selBox) selBox.setFromObject(root);
}
function buildEditor() {
  for (const it of layout.items) {
    if (!selectable.has(it.id)) continue;
    const op = document.createElement('option'); op.value = it.id; op.textContent = selectable.get(it.id).userData.label; targetSel.append(op);
  }
  targetSel.onchange = () => select(targetSel.value);
  for (const [id, [axis, i]] of Object.entries(sliders)) {
    document.getElementById(id).oninput = e => {
      const o = state.snapshot().objects.find(o => o.id === selectedId), p = [...o.position];
      p[i] = +e.target.value; state.setTransform(selectedId, { position: p }); applyState(); save();
    };
  }
  document.getElementById('ry').oninput = e => {
    state.setTransform(selectedId, { rotation: withYaw(selectedId, THREE.MathUtils.degToRad(+e.target.value)) }); applyState(); save();
  };
  for (const [cid, [name, sw]] of Object.entries(COLORS)) {
    const one = document.createElement('button'); one.className = 'swatch'; one.dataset.color = cid; one.innerHTML = `<i style="background:${sw}"></i>${name}`;
    one.onclick = () => { state.setStoneColor(selectedId, cid); applyState(); save(); };
    const all = one.cloneNode(true); all.onclick = () => { state.setAllStoneColors(cid); applyState(); save(); };
    document.getElementById('one-color').append(one); document.getElementById('all-color').append(all);
  }
  document.getElementById('reset').onclick = () => { state.restoreDefault(); applyState(); save(); };
  setupBgm();
  document.getElementById('mode-view').onclick = () => setMode('view');
  document.getElementById('mode-edit').onclick = () => setMode('edit');
  document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => setView(b.dataset.view === 'reset' ? 'front' : b.dataset.view));
}

// BGM：ブラウザーは操作の前に音を出せないので、ボタンで再生する。音量と、オン／オフの好みはこのブラウザーに覚える
const BGM_KEY = 'breakwater-aquarium:bgm';
function setupBgm() {
  const btn = document.getElementById('bgm'), vol = document.getElementById('bgm-vol');
  const audio = new Audio(url('audio/bgm-lofi-aqua.mp3'));
  audio.loop = true; audio.preload = 'none';
  let pref = { on: false, volume: 0.5 };
  try { pref = { ...pref, ...JSON.parse(localStorage.getItem(BGM_KEY) || '{}') }; } catch { /* 覚えられなくても再生はできる */ }
  audio.volume = vol.value = pref.volume;
  const remember = () => { try { localStorage.setItem(BGM_KEY, JSON.stringify(pref)); } catch { /* 保存できない環境 */ } };
  const show = () => { btn.setAttribute('aria-pressed', !audio.paused); btn.textContent = audio.paused ? '♪ BGM' : '♪ BGM 再生中'; };
  const play = () => audio.play().then(show, () => { btn.textContent = '♪ BGM（もう一度押す）'; });
  btn.onclick = () => {
    if (audio.paused) { pref.on = true; play(); } else { pref.on = false; audio.pause(); show(); }
    remember();
  };
  vol.oninput = () => { audio.volume = pref.volume = +vol.value; remember(); };
  audio.addEventListener('pause', show); audio.addEventListener('play', show);
  // 前回オンにしていたら、最初に画面に触れたときに再生を始める
  if (pref.on) addEventListener('pointerdown', function first(e) { if (e.target !== btn && audio.paused) play(); removeEventListener('pointerdown', first); }, { once: true });
  // タブを離れたら止め、戻ったら続きから
  document.addEventListener('visibilitychange', () => { if (document.hidden) { if (!audio.paused) { audio.pause(); audio.dataset.resume = '1'; } } else if (audio.dataset.resume) { delete audio.dataset.resume; play(); } });
}

// 水槽の中の物をタップで選び、底と平行な面の上でドラッグ
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let drag = null;
function pick(ev) {
  const rect = renderer.domElement.getBoundingClientRect();
  ndc.set((ev.clientX - rect.left) / rect.width * 2 - 1, -(ev.clientY - rect.top) / rect.height * 2 + 1);
  ray.setFromCamera(ndc, camera);
}
renderer.domElement.addEventListener('pointerdown', ev => {
  if (mode !== 'edit') return;
  pick(ev);
  const hits = ray.intersectObjects([...selectable.values()], true);
  if (!hits.length) return;
  let o = hits[0].object; while (o && !o.userData.layoutId) o = o.parent;
  if (!o) return;
  select(o.userData.layoutId);
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -o.position.y);
  const hit = ray.ray.intersectPlane(plane, new THREE.Vector3());
  if (!hit) return;
  drag = { id: o.userData.layoutId, plane, offset: o.position.clone().sub(hit), pointer: ev.pointerId };
  controls.enabled = false;
  renderer.domElement.setPointerCapture(ev.pointerId);
});
renderer.domElement.addEventListener('pointermove', ev => {
  if (!drag || ev.pointerId !== drag.pointer) return;
  pick(ev);
  const hit = ray.ray.intersectPlane(drag.plane, new THREE.Vector3());
  if (!hit) return;
  const r = selectable.get(drag.id).userData.radius, p = hit.add(drag.offset);
  const o = state.snapshot().objects.find(o => o.id === drag.id);
  state.setTransform(drag.id, { position: [THREE.MathUtils.clamp(p.x, -TANK.hw + r, TANK.hw - r), o.position[1], THREE.MathUtils.clamp(p.z, -TANK.hd + r, TANK.hd - r)] });
  applyState();
});
const endDrag = () => { if (drag) { drag = null; controls.enabled = true; save(); } };
renderer.domElement.addEventListener('pointerup', endDrag);
renderer.domElement.addEventListener('pointercancel', endDrag);

// ------------------------------------------------------------------ 開始
let last = performance.now(), acc = 0, running = true;
document.addEventListener('visibilitychange', () => { running = !document.hidden; last = performance.now(); if (running) requestAnimationFrame(loop); });
function loop(now) {
  if (!running) return;
  requestAnimationFrame(loop);
  const minDt = 1000 / quality.fps;
  if (now - last < minDt - 2) return;
  const dt = Math.min((now - last) / 1000, 0.05); last = now; acc += dt;
  shared.uTime.value = acc;
  for (const f of fishes) updateFish(f, acc, dt);
  controls.update();
  // 水の色：見る距離が変わっても水槽の中の濁り方が同じになるよう、霧の範囲をカメラ距離に合わせる
  const d = camera.position.distanceTo(controls.target);
  scene.fog.near = Math.max(0.05, d - 0.95); scene.fog.far = d + 1.4;
  if (refractRT) {
    water.visible = false;
    renderer.setRenderTarget(refractRT); renderer.render(scene, camera); renderer.setRenderTarget(null);
    water.visible = true;
  }
  renderer.render(scene, camera);
}

async function main() {
  layout = await (await fetch(url('data/layout.json'))).json();
  overlayText.textContent = '素材を読み込んでいます…';
  const [sand, wall, tetra, stoneBlue, stoneRed] = await Promise.all([
    loadTexture('sand', [3, 1.5]), loadTexture('wall-concrete'), loadTexture('tetrapod-concrete'), loadTexture('stone-bluegray'), loadTexture('stone-redbrown')]);
  const tex = { sand, wall, tetra, stoneBlue, stoneRed };
  buildTank(tex);
  buildWater();
  buildItems(tex);
  await buildFish();
  state = createAquariumState(initialObjects(), { palette: Object.keys(COLORS), revision: LAYOUT_REVISION });
  restoreSaved();
  buildEditor();
  applyState();
  resize(); setView('front');
  addEventListener('resize', resize);
  overlay.style.display = 'none';
  window.aquarium = { quality, fishes, selectable, state, renderer, scene, camera, setView, setMode, select };
  requestAnimationFrame(t => { last = t; loop(t); });
  window.aquariumReady = true;
}
main().catch(e => { console.error(e); fail('水槽を読み込めませんでした。' + (e?.message ? '<br><small>' + e.message + '</small>' : '')); });
