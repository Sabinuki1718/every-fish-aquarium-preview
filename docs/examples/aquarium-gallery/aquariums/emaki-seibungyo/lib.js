/* From .agents/skills/build-aquarium-from-fish-model/assets (aquarium-state, mobile-quality, fish-watch). */
(() => {
// Pure state only. Positions use the scene's units; rotations are radians.
const copy = value => JSON.parse(JSON.stringify(value));
const vector = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);

function createAquariumState(initialObjects, { palette, revision = '1' } = {}) {
  if (!Array.isArray(initialObjects) || !Array.isArray(palette) ||
      !palette.every(id => typeof id === 'string' && id.length) ||
      new Set(palette).size !== palette.length || typeof revision !== 'string' || !revision) {
    throw new Error('Supply objects, unique color IDs and a layout revision.');
  }
  const ids = new Set();
  for (const item of initialObjects) {
    if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id) ||
        !['stone', 'wood', 'plant'].includes(item.kind) ||
        !vector(item.position) || !vector(item.rotation) ||
        (item.kind === 'stone' && !palette.includes(item.colorId))) {
      throw new Error('Invalid initial layout object.');
    }
    ids.add(item.id);
  }
  const defaults = copy(initialObjects);
  let objects = copy(defaults);
  function item(id) {
    const object = objects.find(object => object.id === id);
    if (!object) throw new Error('Unknown layout object: ' + id);
    return object;
  }
  function color(id) {
    if (!palette.includes(id)) throw new Error('Unknown color: ' + id);
  }
  return {
    snapshot() { return { version: 1, revision, objects: copy(objects) }; },
    setTransform(id, { position, rotation } = {}) {
      const object = item(id);
      if ((position !== undefined && !vector(position)) || (rotation !== undefined && !vector(rotation))) {
        throw new Error('Transform must contain three finite numbers.');
      }
      if (position !== undefined) object.position = [...position];
      if (rotation !== undefined) object.rotation = [...rotation];
    },
    setStoneColor(id, colorId) {
      const object = item(id);color(colorId);
      if (object.kind !== 'stone') throw new Error('Only stones have a selectable color.');
      object.colorId = colorId;
    },
    setAllStoneColors(colorId) {
      color(colorId);
      objects.forEach(object => { if (object.kind === 'stone') object.colorId = colorId; });
    },
    restoreDefault() { objects = copy(defaults); },
    load(saved) {
      if (saved?.version !== 1 || saved.revision !== revision || !Array.isArray(saved.objects) ||
          saved.objects.length !== defaults.length) return false;
      const byId = new Map();
      for (const object of saved.objects) {
        if (!object || typeof object.id !== 'string' || byId.has(object.id)) return false;
        byId.set(object.id, object);
      }
      const next = [];
      for (const base of defaults) {
        const object = byId.get(base.id);
        if (!object || object.kind !== base.kind || !vector(object.position) || !vector(object.rotation) ||
            (base.kind === 'stone' && !palette.includes(object.colorId))) return false;
        const restored = { ...copy(base), position: [...object.position], rotation: [...object.rotation] };
        if (base.kind === 'stone') restored.colorId = object.colorId;
        next.push(restored);
      }
      objects = next;return true;
    },
  };
}

// Policy helpers only: the caller connects these values to its renderer and assets.
function chooseAquariumQuality({userAgent='',userAgentMobile=false,maxTouchPoints=0,coarsePointer=false,requestedQuality='auto'}={}) {
  const mobile=Boolean(userAgentMobile)||/Android|iPhone|iPad|iPod/i.test(userAgent)||(maxTouchPoints>1&&coarsePointer);
  const light=requestedQuality==='light'||(requestedQuality!=='standard'&&mobile);
  return Object.freeze({
    name:light?'light':'standard', fps:light?30:60,
    antialias:!light, shadows:!light, waterPasses:light?1:3,
    pixelRatioCap:light?1:1.7, maxCanvasSide:light?960:Infinity,
    modelTextureSize:light?1024:2048,
  });
}

function aquariumDrawingSize(profile,width,height,devicePixelRatio=1) {
  const positive=(v,fallback=1)=>Number.isFinite(v)&&v>0?v:fallback;
  const cssWidth=positive(width),cssHeight=positive(height);
  const maxSide=positive(profile.maxCanvasSide,Infinity);
  const pixelRatio=Math.min(positive(devicePixelRatio),positive(profile.pixelRatioCap),maxSide/Math.max(cssWidth,cssHeight));
  return {cssWidth,cssHeight,pixelRatio,
    drawingWidth:Math.max(1,Math.floor(cssWidth*pixelRatio)),
    drawingHeight:Math.max(1,Math.floor(cssHeight*pixelRatio))};
}

// Watch one fish: camera placement, follow and tank bounds for the "観察" mode, plus the back-screen rule.
// Policy helpers only (no three.js): points are [x, y, z] in scene units, the tank centre is on the floor at the
// origin, the front glass faces +z. The caller moves its camera / OrbitControls target with the returned values.

// A tap picks a fish; a drag rotates the view. Compare pointerdown and pointerup positions (CSS px).
function isTap(down, up, maxMove = 6) {
  return Boolean(down && up) && Math.hypot(up.x - down.x, up.y - down.y) <= maxMove;
}

// Where the camera starts when a fish is chosen: beside the fish, on the side that faces the front glass,
// a little below it so the fish sits above the bottom controls. Phones (aspect < 1) step further back.
function watchStart(fishPos, fishYaw, { aspect = 1.5, distance, lift, minFront = 0.6 } = {}) {
  const tall = aspect < 1;
  const dist = distance ?? (tall ? 0.12 : 0.085);
  const down = lift ?? (tall ? 0.006 : 0.004);
  // the fish's side normal in the floor plane (yaw 0 = head toward -x, side toward +z)
  let sx = Math.sin(fishYaw), sz = Math.cos(fishYaw);
  if (sz < 0) { sx = -sx; sz = -sz; }               // the side that faces the viewer
  sz = Math.max(sz, minFront);                      // lean toward the front glass, never along the back
  const n = Math.hypot(sx, sz); sx /= n; sz /= n;
  const [x, y, z] = fishPos;
  return {
    camera: [x + sx * dist, y + 0.008 - down, z + sz * dist],
    target: [x, y - down, z],
  };
}

// Move the camera and target by the fish's movement since the last frame, so orbit and zoom stay free.
function followDelta(previous, current) {
  return [current[0] - previous[0], current[1] - previous[1], current[2] - previous[2]];
}

// Keep a close-up camera between the side glasses, in front of the back glass and above the substrate,
// so the view always looks into the water. tank: {w, d} in scene units; floorY: lowest camera height.
function clampWatchCamera(pos, { w, d }, { margin = 0.008, backMargin = 0.01, floorY = 0.05 } = {}) {
  return [
    Math.max(-w / 2 + margin, Math.min(w / 2 - margin, pos[0])),
    Math.max(floorY, pos[1]),
    Math.max(-d / 2 + backMargin, pos[2]),
  ];
}

// Next fish for the "次の魚" button (wraps around; starts at the first when nothing is watched).
function nextWatchId(ids, current) {
  if (!ids.length) return null;
  const i = ids.indexOf(current);
  return ids[(i + 1) % ids.length];
}

// Back screen: a one-sided picture facing the front (+z). From in front of it the picture shows;
// once the camera is behind the back glass the picture is culled, so the tank is seen through the back.
// Use this to decide what is visible (e.g. for tests or a custom renderer); with three.js the same rule is
// simply side: THREE.FrontSide on the back-screen plane.
function backScreenVisible(cameraZ, backScreenZ) {
  return cameraZ > backScreenZ;
}

window.AquariumLib = { createAquariumState, chooseAquariumQuality, aquariumDrawingSize, isTap, watchStart, followDelta, clampWatchCamera, nextWatchId };
})();
