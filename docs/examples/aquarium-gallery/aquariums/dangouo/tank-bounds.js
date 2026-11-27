import * as THREE from './vendor/three.module.js';

// Include the complete mesh and its maximum shader displacement before rotation.
export function fitTankPosition(bounds,position,rotation,sway=new THREE.Vector3()){
  const box=bounds.clone().expandByVector(sway);
  box.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rotation)));
  return [
    THREE.MathUtils.clamp(position[0],-5.92-box.min.x,5.92-box.max.x),
    THREE.MathUtils.clamp(position[1],.10,Math.max(.10,Math.min(5.9,7.1-box.max.y))),
    THREE.MathUtils.clamp(position[2],-3.92-box.min.z,3.92-box.max.z),
  ];
}
