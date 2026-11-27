// XY-plane fin membranes. Inject the project's THREE namespace (r170 tested).
export function findFinBase(geometry, { axis = 'x', end = 'min', band } = {}) {
  const p = geometry.getAttribute('position');
  if (!p?.count) throw new Error('Fin geometry has no vertices.');
  if (!['x', 'y'].includes(axis) || !['min', 'max'].includes(end)) {
    throw new Error('Choose an XY axis and min/max anatomical attachment edge.');
  }
  const value = i => axis === 'x' ? p.getX(i) : p.getY(i);
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < p.count; i++) {
    const v = value(i);
    if (![p.getX(i), p.getY(i), p.getZ(i)].every(Number.isFinite)) {
      throw new Error('Fin geometry has nonfinite coordinates.');
    }
    min = Math.min(min, v); max = Math.max(max, v);
  }
  const width = band ?? (max - min) * .008;
  if (!Number.isFinite(width) || width < 0) throw new Error('Invalid base band.');
  let x = 0, y = 0, count = 0;
  for (let i = 0; i < p.count; i++) {
    if (end === 'min' ? value(i) <= min + width : value(i) >= max - width) {
      x += p.getX(i); y += p.getY(i); count++;
    }
  }
  return [x / count, y / count];
}

export function createFinMaterial(THREE, {
  base, opacity = .32, color = 0xb5cfc5, rayFrequency = 35,
} = {}) {
  if (!Array.isArray(base) || base.length !== 2 || !base.every(Number.isFinite)) {
    throw new Error('Supply the anatomical fin base as local [x, y].');
  }
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1 ||
      !Number.isFinite(rayFrequency) || rayFrequency <= 0) {
    throw new Error('Invalid opacity or ray frequency.');
  }
  const material = new THREE.MeshStandardMaterial({
    color, transparent: true, opacity, depthWrite: false,
    side: THREE.DoubleSide, roughness: .48, metalness: 0,
  });
  material.onBeforeCompile = shader => {
    shader.uniforms.finBase = { value: new THREE.Vector2(...base) };
    shader.uniforms.finRayFrequency = { value: rayFrequency };
    shader.vertexShader = 'uniform vec2 finBase; varying vec2 vFinPosition;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\nvFinPosition=position.xy-finBase;');
    shader.fragmentShader = 'uniform float finRayFrequency; varying vec2 vFinPosition;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      float rayAngle=atan(vFinPosition.y,vFinPosition.x);
      float rayWidth=max(fwidth(rayAngle)*finRayFrequency,.10);
      float finRay=1.-smoothstep(.10,.10+rayWidth,abs(sin(rayAngle*finRayFrequency)));
      diffuseColor.rgb*=.78+.34*finRay;
      diffuseColor.a*=.50+.50*finRay;
    `);
  };
  material.customProgramCacheKey = () => 'radial-translucent-fin-v1';
  return material;
}

