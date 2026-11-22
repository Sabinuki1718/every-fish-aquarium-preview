/* Load a fish written by web_bundle.py (geometry JSON + atlas JPG) as a THREE.Group.
   Each part is a Mesh named as in the GLB; parts with opacity < 1 get a transparent material
   (double_sided: false -> front faces only; depth_write: true -> drawn first and hides what is behind it).
   Pages usually replace the materials afterwards (swimming shaders, translucent fins).
   usage: const fish = await loadFishJSON(THREE, 'models/name.json', 'models/name-1024.jpg'); */
window.loadFishJSON = async function loadFishJSON(THREE, geometryUrl, textureUrl) {
  const res = await fetch(geometryUrl);
  if (!res.ok) throw new Error('モデルを読み込めませんでした: ' + geometryUrl);
  const data = await res.json();
  const map = await new THREE.TextureLoader().loadAsync(textureUrl);
  map.flipY = false;                        // glTF UVs: v = 0 at the top of the atlas
  map.colorSpace = THREE.SRGBColorSpace;
  const group = new THREE.Group();
  for (const m of data.meshes) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(m.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(m.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(m.uv, 2));
    g.setIndex(m.i);
    const glass = m.opacity < 1;
    const depthWrite = m.depth_write ?? !glass;   // a translucent body may write depth so fins behind it stay hidden
    const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({
      map, side: m.double_sided === false ? THREE.FrontSide : THREE.DoubleSide,
      transparent: glass, opacity: m.opacity, depthWrite }));
    if (glass) mesh.renderOrder = depthWrite ? 1 : 2;
    mesh.name = m.name; group.add(mesh);
  }
  return group;
};
