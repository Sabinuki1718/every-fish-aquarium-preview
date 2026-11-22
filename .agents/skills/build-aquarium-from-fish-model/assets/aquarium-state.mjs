// Pure state only. Positions use the scene's units; rotations are radians.
const copy = value => JSON.parse(JSON.stringify(value));
const vector = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);

export function createAquariumState(initialObjects, { palette, revision = '1' } = {}) {
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
