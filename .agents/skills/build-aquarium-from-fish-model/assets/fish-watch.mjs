// Watch one fish: camera placement, follow and tank bounds for the "観察" mode, plus the back-screen rule.
// Policy helpers only (no three.js): points are [x, y, z] in scene units, the tank centre is on the floor at the
// origin, the front glass faces +z. The caller moves its camera / OrbitControls target with the returned values.

// A tap picks a fish; a drag rotates the view. Compare pointerdown and pointerup positions (CSS px).
export function isTap(down, up, maxMove = 6) {
  return Boolean(down && up) && Math.hypot(up.x - down.x, up.y - down.y) <= maxMove;
}

// Where the camera starts when a fish is chosen: beside the fish, on the side that faces the front glass,
// a little below it so the fish sits above the bottom controls. Phones (aspect < 1) step further back.
export function watchStart(fishPos, fishYaw, { aspect = 1.5, distance, lift, minFront = 0.6 } = {}) {
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
export function followDelta(previous, current) {
  return [current[0] - previous[0], current[1] - previous[1], current[2] - previous[2]];
}

// Keep a close-up camera between the side glasses, in front of the back glass and above the substrate,
// so the view always looks into the water. tank: {w, d} in scene units; floorY: lowest camera height.
export function clampWatchCamera(pos, { w, d }, { margin = 0.008, backMargin = 0.01, floorY = 0.05 } = {}) {
  return [
    Math.max(-w / 2 + margin, Math.min(w / 2 - margin, pos[0])),
    Math.max(floorY, pos[1]),
    Math.max(-d / 2 + backMargin, pos[2]),
  ];
}

// Next fish for the "次の魚" button (wraps around; starts at the first when nothing is watched).
export function nextWatchId(ids, current) {
  if (!ids.length) return null;
  const i = ids.indexOf(current);
  return ids[(i + 1) % ids.length];
}

// Back screen: a one-sided picture facing the front (+z). From in front of it the picture shows;
// once the camera is behind the back glass the picture is culled, so the tank is seen through the back.
// Use this to decide what is visible (e.g. for tests or a custom renderer); with three.js the same rule is
// simply side: THREE.FrontSide on the back-screen plane.
export function backScreenVisible(cameraZ, backScreenZ) {
  return cameraZ > backScreenZ;
}
