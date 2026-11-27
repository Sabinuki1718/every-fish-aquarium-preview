import {createAquariumRenderer,LIGHT_MODE,prepareTextures} from './runtime.js';
import * as THREE from './vendor/three.module.js';
import {OrbitControls} from './vendor/OrbitControls.js';
import {GLTFLoader} from './vendor/GLTFLoader.js';
import {createAquariumWater} from './water.js';
import {createLayoutEditor} from './layout-editor.js';
import {findFinBase,createFinMaterial} from './fin-material.js';
import {sampleSwimArc,SWIM_CEILING} from './swim-path.js';
import {createFishRoute} from './fish-route.js';
import {createFishBehavior,advanceFishBehavior} from './fish-behavior.js';

const scene=new THREE.Scene();scene.background=new THREE.Color(0x0b141a);
const renderer=createAquariumRenderer(THREE,false);
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.18;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
document.getElementById('canvas').appendChild(renderer.domElement);
const camera=new THREE.PerspectiveCamera(38,1,.05,100);const controls=new OrbitControls(camera,renderer.domElement);
controls.enableDamping=true;controls.dampingFactor=.07;controls.minDistance=3;controls.maxDistance=30;controls.maxPolarAngle=Math.PI*.92;controls.target.set(0,3,0);
function view(name){camera.position.set(...({front:[0,4.1,18.5],angle:[10,8.4,16.8],top:[0,18,.01]}[name]||[10,8.4,16.8]));controls.target.set(0,3,0);controls.update();document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===name));}
view('angle');document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>view(b.dataset.view));document.getElementById('reset').onclick=()=>view('angle');
document.getElementById('fullscreen').onclick=()=>{if(document.fullscreenElement)document.exitFullscreen();else document.getElementById('viewer').requestFullscreen?.();};
new ResizeObserver(()=>{const e=document.getElementById('canvas');renderer.setSize(e.clientWidth,e.clientHeight,false);camera.aspect=e.clientWidth/e.clientHeight;camera.zoom=Math.min(1,Math.max(.35,camera.aspect*.95));camera.updateProjectionMatrix();}).observe(document.getElementById('canvas'));
scene.add(new THREE.HemisphereLight(0xd9f1ff,0x50504a,2));
const sun=new THREE.DirectionalLight(0xfff5df,3.4);sun.position.set(-3,11,5);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-8,right:8,top:8,bottom:-8,near:.1,far:25});sun.shadow.bias=-.0003;sun.shadow.normalBias=.025;sun.shadow.radius=3;scene.add(sun);
const fill=new THREE.DirectionalLight(0xa7d6ea,1.0);fill.position.set(5,5,-1);scene.add(fill);
function box(w,h,d,mat,x,y,z){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);scene.add(m);return m;}
const frameMat=new THREE.MeshStandardMaterial({color:0x10191d,roughness:.38,metalness:.4});box(12.4,.23,6.4,frameMat,0,-.17,0);
const back=new THREE.MeshStandardMaterial({color:0x07131c,roughness:.85});box(12.06,7.2,.06,back,0,3.6,-3.07);
const glass=new THREE.MeshPhysicalMaterial({color:0xb3e8ec,transparent:true,opacity:.065,roughness:.06,metalness:.05,depthWrite:false,side:THREE.DoubleSide});
for(const x of [-6.06,6.06])box(.035,7.2,6.12,glass,x,3.6,0);
box(12.12,7.2,.025,glass,0,3.6,3.06);
const edgeMat=new THREE.LineBasicMaterial({color:0x9ccbd0,transparent:true,opacity:.36});const edges=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(12.12,7.2,6.12)),edgeMat);edges.position.y=3.6;scene.add(edges);
const loader=new THREE.TextureLoader();
async function texture(path,repeat=1){const t=await loader.loadAsync(path);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(repeat,repeat);t.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());return t;}
const [blue,red,sandTex]=await Promise.all([texture('assets/rock-blue.png'),texture('assets/rock-red.png'),texture('assets/sand.png',5)]);
const sandMat=new THREE.MeshStandardMaterial({map:sandTex,bumpMap:sandTex,bumpScale:.025,roughness:.88,color:0xd4cebb});const sand=box(11.98,.3,5.98,sandMat,0,.1,0);sand.receiveShadow=true;
const stoneMaterials=[blue,red].map(t=>new THREE.MeshStandardMaterial({map:t,bumpMap:t,bumpScale:.045,roughness:.66,color:0xaaa99d}));
// Local triplanar projection keeps the generated surface grain continuous across the rounded mesh.
for(const mat of stoneMaterials){mat.onBeforeCompile=s=>{s.vertexShader='varying vec3 rockPosition;varying vec3 rockNormal;\n'+s.vertexShader;s.vertexShader=s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nrockPosition=position;rockNormal=normal;');s.fragmentShader='varying vec3 rockPosition;varying vec3 rockNormal;\n'+s.fragmentShader;s.fragmentShader=s.fragmentShader.replace('#include <map_fragment>',`vec3 blend=pow(abs(normalize(rockNormal)),vec3(5.));blend/=dot(blend,vec3(1.));vec4 grain=texture2D(map,rockPosition.yz*.48)*blend.x+texture2D(map,rockPosition.xz*.48)*blend.y+texture2D(map,rockPosition.xy*.48)*blend.z;diffuseColor*=grain;`);};mat.customProgramCacheKey=()=> 'coastal-triplanar-v1';}
const rocks=[];
function stone(pos,size,color,seed,angle=0){const g=new THREE.SphereGeometry(1,64,40),p=g.attributes.position;for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i);const n=1+.065*Math.sin(x*4+seed)*Math.cos(z*4-y*2)+.035*Math.sin(y*7+z*5+seed);p.setXYZ(i,x*n*size[0],Math.max(-.88,y*n)*size[1],z*n*size[2]);}g.computeVertexNormals();const m=new THREE.Mesh(g,stoneMaterials[color]);m.position.set(...pos);m.rotation.y=angle;m.castShadow=m.receiveShadow=true;m.userData.color=color;scene.add(m);rocks.push(m);return m;}
stone([-4.25,1.25,-1.35],[.96,1.25,1.15],0,2,.15);
stone([-1.65,1.18,-1.5],[.72,1.18,.95],0,4,-.2);
stone([-3,2.84,-1.45],[2.1,.65,1.3],0,6,-.08);
stone([-4.1,.78,.85],[1.55,.62,1.04],0,8,.1);
stone([3.9,1.45,-1.35],[1.5,1.35,1.17],1,10,-.2);
stone([4.15,.72,.8],[1.2,.55,1.05],1,12,.25);
stone([2.4,.73,-.5],[.8,.64,.85],1,14,-.2);
stone([-.8,.37,1.55],[.44,.23,.37],0,16);
// Small shell grit has actual relief; the sand albedo supplies the finer grains.
let rng=72819;function random(){rng=(rng*1664525+1013904223)>>>0;return rng/4294967296;}
const grit=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,1),new THREE.MeshStandardMaterial({color:0xa6a598,roughness:.83}),300),dummy=new THREE.Object3D();for(let i=0;i<300;i++){const s=.014+random()*.04;dummy.position.set((random()-.5)*11.7,.265,(random()-.5)*5.7);dummy.rotation.set(random()*3,random()*3,random()*3);dummy.scale.set(s,s*.5,s*.7);dummy.updateMatrix();grit.setMatrixAt(i,dummy.matrix);}grit.receiveShadow=true;scene.add(grit);
const plants=[];
function algae(x,z,brown,seed){const root=new THREE.Group();root.position.set(x,.25,z);const material=new THREE.MeshStandardMaterial({color:brown?0x77623a:0x648b37,roughness:.55,side:THREE.DoubleSide,transparent:true,opacity:.92});for(let k=0;k<(brown?12:8);k++){const len=(brown?3.6:3.9)*(.55+random()*.5),width=brown?.12:.36;const g=new THREE.PlaneGeometry(1,1,8,24),p=g.attributes.position;for(let i=0;i<p.count;i++){let u=p.getX(i)*2,v=p.getY(i)+.5;const w=width*Math.sin(Math.PI*(v*.86+.06))*(1+.22*Math.sin(v*35+seed));p.setXYZ(i,u*w+Math.sin(v*4+k)*v*.17,v*len,Math.sin(v*17+u*5+k)*v*.13);}g.computeVertexNormals();const leaf=new THREE.Mesh(g,material);leaf.rotation.y=k*2.399+seed;leaf.rotation.z=(random()-.5)*.6;leaf.position.set((random()-.5)*.5,0,(random()-.5)*.4);leaf.castShadow=true;root.add(leaf);}scene.add(root);plants.push(root);return root;}
algae(-4.8,-2.2,false,1);algae(-1.3,-2.25,false,4);algae(4.75,-2.15,true,8);
prepareTextures(scene);
const waterFx=createAquariumWater({scene,renderer,camera,level:6.7});
const editor=createLayoutEditor({scene,camera,renderer,controls,rocks,plants,view,setStoneColors:colors=>rocks.forEach((r,i)=>{r.material=stoneMaterials[colors[i]];r.userData.color=colors[i];})});
const fishes=[];const down=new THREE.Raycaster();
function surfaceHeight(x,z){down.set(new THREE.Vector3(x,10,z),new THREE.Vector3(0,-1,0));const hits=down.intersectObjects(rocks);return Math.max(.25,hits[0]?.point.y??.25);}
try{const gltf=await new GLTFLoader().loadAsync('assets/isoginpo.glb');prepareTextures(gltf.scene);for(let i=0;i<3;i++){const root=gltf.scene.clone(true);root.scale.setScalar(20);const fins=[];const time={value:0},strength={value:.2};root.traverse(o=>{if(!o.isMesh)return;o.castShadow=true;o.receiveShadow=true;
if(o.name.startsWith('Pectoral_')){const side=o.name.includes('starboard')?-1:1;const g=o.geometry.clone(),p=g.attributes.position;for(let j=0;j<p.count;j++)p.setXYZ(j,p.getX(j)+.0234,p.getY(j)+.00325,(p.getZ(j)-side*.007)*.08);g.computeVertexNormals();o.geometry=g;o.position.set(-.0234,-.00325,side*.0088);o.material=createFinMaterial(THREE,{base:findFinBase(g,{band:.0003}),opacity:.38,color:0xcbb99c,rayFrequency:35});o.castShadow=false;fins.push({mesh:o,side});
}else{o.material=o.material.clone();const material=o.material;material.onBeforeCompile=s=>{s.uniforms.fishTime=time;s.uniforms.swimStrength=strength;s.vertexShader='uniform float fishTime;uniform float swimStrength;\n'+s.vertexShader;s.vertexShader=s.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>\nfloat tailWeight=smoothstep(-.008,.04,position.x);transformed.z+=sin(fishTime*9.-position.x*95.)*.0022*tailWeight*tailWeight*swimStrength;`);};material.customProgramCacheKey=()=> 'isoginpo-tail-v1';waterFx.applyTo(material);}});scene.add(root);fishes.push({root,fins,time,strength,phase:Math.random()*20,behavior:createFishBehavior(i<2?1:0),initialized:false});}
document.getElementById('loading').hidden=true;window.aquariumReady=true;
}catch(e){console.error(e);document.getElementById('loading').textContent='魚の読み込みに失敗しました。再読み込みしてください。';window.aquariumShowError?.(e);}
const clock=new THREE.Clock(),prev=new THREE.Vector3();
function updateFish(f,i,t){
  const action=advanceFishBehavior(f.behavior,t),homes=[rocks[3],rocks[5],rocks[6]];
  if(!f.restPosition){
    const h=homes[i];h.updateWorldMatrix(true,false);
    f.restPosition=i<2?h.localToWorld(new THREE.Vector3(0,0,.12)):new THREE.Vector3(.3,.59,1.15);
    f.restPosition.y=surfaceHeight(f.restPosition.x,f.restPosition.z)+.34;
    f.root.rotation.y=[Math.PI*.92,.18,Math.PI*.78][i];
  }
  let pitch=0,moving=action.moving;
  if(moving){
    if(f.routeSerial!==action.serial){
      const perches=homes.map(h=>{h.updateWorldMatrix(true,false);return h.localToWorld(new THREE.Vector3(0,0,.12));});
      f.path=createFishRoute(f.restPosition,f.root.rotation.y,action.kind,perches,surfaceHeight);
      f.routeSerial=action.serial;
    }
    const sample=sampleSwimArc(f.path,action.progress);
    f.root.position.set(sample.x,sample.y,sample.z);
    pitch=THREE.MathUtils.clamp(sample.pitch,-.6,.6);
    const yaw=Math.atan2(f.path.end.z-f.path.start.z,-(f.path.end.x-f.path.start.x));
    const diff=Math.atan2(Math.sin(yaw-f.root.rotation.y),Math.cos(yaw-f.root.rotation.y));
    f.root.rotation.y+=diff*.065;
  }else{
    if(f.wasMoving&&f.path)f.restPosition.set(f.path.end.x,f.path.end.y,f.path.end.z);
    // Moving a rock in the editor must not leave a resting fish inside it.
    f.restPosition.y=Math.max(f.restPosition.y,surfaceHeight(f.restPosition.x,f.restPosition.z)+.34);
    f.root.position.copy(f.restPosition);
  }
  f.wasMoving=moving;f.root.rotation.order='YXZ';
  f.time.value=t+f.phase;f.strength.value=moving?(f.path.kind==='short'?.6:.9):.14;
  f.fins.forEach(({mesh,side})=>{mesh.rotation.y=-side*(.09+.42*(.5+.5*Math.sin(t*(moving?8:3.5)+i)));});
  f.root.rotation.z+=(pitch-f.root.rotation.z)*.08;
  // A bound around the model covers every orientation and moving fin; .05 also
  // covers the tail's shader displacement. The water can dip by about .03.
  if(f.centerCeiling===undefined){
    const origin=f.root.position.clone();f.root.position.set(0,0,0);f.root.updateMatrixWorld(true);
    const bounds=new THREE.Box3().setFromObject(f.root).getBoundingSphere(new THREE.Sphere());
    const extent=bounds.radius+bounds.center.length()+.05;
    f.centerCeiling=Math.min(SWIM_CEILING,6.7-.04-.08-extent);f.root.position.copy(origin);
  }
  f.root.position.y=Math.min(f.root.position.y,f.centerCeiling);
  f.restPosition.y=Math.min(f.restPosition.y,f.centerCeiling);
}
function frame(){requestAnimationFrame(frame);const t=clock.getElapsedTime();scene.updateMatrixWorld();fishes.forEach((f,i)=>updateFish(f,i,t));if(!editor.editing)plants.forEach((p,i)=>{p.rotation.z=.035*Math.sin(t*.65+i);});editor.update();controls.update();waterFx.update(t);renderer.render(scene,camera);}frame();






