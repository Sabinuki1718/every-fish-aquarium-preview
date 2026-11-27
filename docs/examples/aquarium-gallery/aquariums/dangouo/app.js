import * as THREE from './vendor/three.module.js';
import {OrbitControls} from './vendor/OrbitControls.js';
import {GLTFLoader} from './vendor/GLTFLoader.js';
import {mergeGeometries} from './vendor/BufferGeometryUtils.js';
import {createAquariumState} from './aquarium-state.mjs';
import {createAquariumWater} from './water.js';
import {createRockBehavior} from './rock-behavior.js';
import {setupBGM} from './bgm.js';
import {fitTankPosition} from './tank-bounds.js';
import {chooseAquariumQuality,aquariumDrawingSize} from './mobile-quality.mjs';

const $=id=>document.getElementById(id),stage=$('stage'),canvas=$('aquarium');
const S=100/3,CM=1/3,KEY='dangouo-sargassum-layout-v1';
const requestedQuality=new URLSearchParams(location.search).get('quality')||'auto';
const quality=chooseAquariumQuality({userAgent:navigator.userAgent,userAgentMobile:navigator.userAgentData?.mobile,maxTouchPoints:navigator.maxTouchPoints,coarsePointer:matchMedia('(pointer:coarse)').matches,requestedQuality});
const light=quality.name==='light',assetBase='./assets/'+(light?'mobile/':'');
document.documentElement.dataset.quality=quality.name;
$('quality-select').value=['light','standard'].includes(requestedQuality)?requestedQuality:'auto';
$('quality-select').onchange=e=>{const url=new URL(location.href);url.searchParams.set('quality',e.target.value);location.assign(url);};
const renderer=new THREE.WebGLRenderer({canvas,antialias:quality.antialias,alpha:false,powerPreference:light?'low-power':'high-performance'});
renderer.aquariumLightMode=light;
renderer.info.autoReset=false;
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.12;renderer.setClearColor(0x18313a);
renderer.shadowMap.enabled=quality.shadows;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
const scene=new THREE.Scene();scene.background=new THREE.Color(0x18313a);scene.fog=new THREE.FogExp2(0x263f44,.009);
const camera=new THREE.PerspectiveCamera(38,1,.08,130);
const controls=new OrbitControls(camera,canvas);controls.enableDamping=true;controls.dampingFactor=.07;
controls.minDistance=6;controls.maxDistance=42;controls.minPolarAngle=.12;controls.maxPolarAngle=Math.PI*.53;
controls.maxTargetRadius=5;controls.enablePan=true;
let fitFactor=1;
function home(){controls.target.set(0,2.75,0);camera.position.set(7.5,7.2,16.4);camera.position.sub(controls.target).multiplyScalar(fitFactor).add(controls.target);controls.update();}
home();$('home').onclick=home;$('top').onclick=()=>{controls.target.set(0,1.5,0);camera.position.set(0,28,.01);controls.update();};
const resize=()=>{const w=stage.clientWidth,h=stage.clientHeight,size=aquariumDrawingSize(quality,w,h,devicePixelRatio);renderer.setPixelRatio(size.pixelRatio);renderer.setSize(w,h,false);camera.aspect=w/h;const nextFit=Math.max(1,1.4/camera.aspect);camera.position.sub(controls.target).multiplyScalar(nextFit/fitFactor).add(controls.target);fitFactor=nextFit;camera.updateProjectionMatrix();};
new ResizeObserver(resize).observe(stage);resize();
scene.add(new THREE.HemisphereLight(0xc4e4eb,0x4c5543,2.2));
const sun=new THREE.DirectionalLight(0xfff0d3,3.0);sun.position.set(-5,15,9);sun.castShadow=quality.shadows;
sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-9;sun.shadow.camera.right=9;sun.shadow.camera.top=9;sun.shadow.camera.bottom=-9;
sun.shadow.camera.near=.5;sun.shadow.camera.far=35;sun.shadow.bias=-.0006;sun.shadow.normalBias=.025;scene.add(sun);
const fill=new THREE.DirectionalLight(0x81b8cd,1.8);fill.position.set(9,8,-8);scene.add(fill);
const back=new THREE.PointLight(0xa9c8bd,40,24,2);back.position.set(-3,6,-5);scene.add(back);
const clock=new THREE.Clock(),time={value:0};
const loader=new THREE.TextureLoader();
function texture(file,repeat=1,color=true){if(light&&!color)return null;const t=loader.load(assetBase+file);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(repeat,repeat);t.anisotropy=Math.min(renderer.capabilities.getMaxAnisotropy(),light?2:8);if(color)t.colorSpace=THREE.SRGBColorSpace;return t;}
const rockMaps={charcoal:texture('charcoal.jpg',1.2),blueblack:texture('blueblack.jpg',1.2)};
const rockBumps={charcoal:texture('charcoal-bump.png',1.2,false),blueblack:texture('blueblack-bump.png',1.2,false)};
const rockMaterials={};
for(const id of ['charcoal','blueblack'])rockMaterials[id]=new THREE.MeshStandardMaterial({map:rockMaps[id],bumpMap:rockBumps[id],bumpScale:.023,roughness:.43,metalness:.05});
const gravelMat=new THREE.MeshStandardMaterial({color:0x69726c,map:texture('gravel.jpg',8),bumpMap:texture('gravel-bump.png',8,false),bumpScale:.022,roughness:.85});
const gravel=new THREE.Mesh(new THREE.BoxGeometry(12,.26,8),gravelMat);gravel.position.y=.13;gravel.receiveShadow=true;scene.add(gravel);
const table=new THREE.Mesh(new THREE.PlaneGeometry(180,180),new THREE.MeshStandardMaterial({color:0x18262b,roughness:.91}));table.rotation.x=-Math.PI/2;table.position.y=-.07;scene.add(table);
const backdrop=new THREE.Mesh(new THREE.PlaneGeometry(12,8),new THREE.ShaderMaterial({vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec2 vUv;void main(){vec3 col=mix(vec3(.004,.012,.016),vec3(.020,.055,.073),vUv.y);gl_FragColor=vec4(col,1.);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}',side:THREE.DoubleSide}));
backdrop.position.set(0,4,-4.07);backdrop.castShadow=true;scene.add(backdrop);
const glassMat=new THREE.MeshPhysicalMaterial({color:0xb4e2dc,transparent:true,opacity:.055,roughness:.09,metalness:.1,clearcoat:1,side:THREE.DoubleSide,depthWrite:false});
for(const [w,h,pos,ry] of [[12,8,[0,4,4.025],0],[12,8,[0,4,-4.025],0],[8,8,[-6.025,4,0],Math.PI/2],[8,8,[6.025,4,0],Math.PI/2]]){
  const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),glassMat);m.position.set(...pos);m.rotation.y=ry;m.renderOrder=5;scene.add(m);
}
const edgeGeo=new THREE.EdgesGeometry(new THREE.BoxGeometry(12.05,8.03,8.05));
const edges=new THREE.LineSegments(edgeGeo,new THREE.LineBasicMaterial({color:0xadcac9,transparent:true,opacity:.36}));edges.position.y=4;scene.add(edges);
const bottomFrame=new THREE.Mesh(new THREE.BoxGeometry(12.1,.10,8.1),new THREE.MeshStandardMaterial({color:0x758e8d,roughness:.4,metalness:.4}));bottomFrame.position.y=-.025;scene.add(bottomFrame);

let rng=117;function rand(){rng=(Math.imul(rng,1664525)+1013904223)>>>0;return rng/4294967296;}
const objects=new Map(),plants=[],fishes=[];
let state,approved,edit=false,selected=null,drag=null,saveTimer,toastTimer;
const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2(),dragPlane=new THREE.Plane(new THREE.Vector3(0,1,0),-.27);
const hitPoint=new THREE.Vector3(),selectionBox=new THREE.BoxHelper(undefined,0xd1e9b7);selectionBox.visible=false;scene.add(selectionBox);
function curvedLeaf(len,width,bend){
  const pos=[],uv=[],idx=[];const steps=light?4:8;
  for(let j=0;j<=steps;j++){const t=j/steps;const wid=Math.pow(Math.sin(t*Math.PI),.8)*width;for(let k=0;k<3;k++){const q=k-1;pos.push(q*wid,t*len,Math.sin(t*Math.PI)*bend+(1-Math.abs(q))*.02);uv.push(k/2,t);}}
  for(let j=0;j<steps;j++)for(let k=0;k<2;k++){const a=j*3+k,b=a+1,c=a+3,d=c+1;idx.push(a,b,c,b,d,c);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();return g;
}
const leafMap=texture('sargassum.jpg',1),leafBump=texture('sargassum-bump.png',1,false);
function swayMaterial(mat,height,seed){
  const previous=mat.onBeforeCompile;
  mat.onBeforeCompile=function(shader,r){previous.call(this,shader,r);shader.uniforms.shoreTime=time;shader.uniforms.plantHeight={value:height};shader.uniforms.plantPhase={value:seed};
    shader.vertexShader='uniform float shoreTime,plantHeight,plantPhase;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
      float swayWeight=pow(clamp(position.y/plantHeight,0.,1.),1.7);
      transformed.x+=.16*sin(shoreTime*.85+position.y*.65+plantPhase)*swayWeight;
      transformed.z+=.11*cos(shoreTime*.73+position.y*.54+plantPhase)*swayWeight;
    `);
  };mat.customProgramCacheKey=()=>`sargassum-sway-v2`;return mat;
}
function makePlant(desc,index){
  const group=new THREE.Group(),leafs=[],branches=[],bladders=[];
  const H=desc.height_m*S;
  for(let stem=0;stem<8;stem++){
    const angle=stem*2.399,offset=.13+rand()*.22;const tip=new THREE.Vector3(Math.cos(angle)*(.65+rand()*.65),H*(.7+rand()*.3),Math.sin(angle)*(.6+rand()*.6));
    const curve=new THREE.CatmullRomCurve3([new THREE.Vector3(Math.cos(angle)*offset,0,Math.sin(angle)*offset),new THREE.Vector3(tip.x*.18,H*.33,tip.z*.2),new THREE.Vector3(tip.x*.6,H*.7,tip.z*.5),tip]);
    branches.push(new THREE.TubeGeometry(curve,light?12:22,.018,light?4:5,false));
    for(let b=0;b<8;b++){
      const t=.18+b*.095;const root=curve.getPoint(t);const a=angle+b*1.75;const length=.65+rand()*.65;const end=root.clone().add(new THREE.Vector3(Math.cos(a)*length,.22+rand()*.30,Math.sin(a)*length));
      const mid=root.clone().lerp(end,.5);mid.y-=.07;
      const twig=new THREE.CatmullRomCurve3([root,mid,end]);branches.push(new THREE.TubeGeometry(twig,light?4:7,.009,light?3:4,false));
      for(let n=0;n<5;n++){
        const v=(n+1)/6,p=twig.getPoint(v);const g=curvedLeaf(.32+rand()*.26,.065+rand()*.045,.035);
        const mesh=new THREE.Mesh(g);mesh.position.copy(p);mesh.rotation.set((rand()-.5)*1.2,a+n*1.9,(n%2?1:-1)*(.5+rand()*.55));mesh.updateMatrix();g.applyMatrix4(mesh.matrix);leafs.push(g);
      }
      if(b%2===0){const p=twig.getPoint(.72);p.y+=.07;const g=new THREE.SphereGeometry(.055+rand()*.012,8,6);g.translate(p.x,p.y,p.z);bladders.push(g);}
    }
  }
  const stemMat=swayMaterial(new THREE.MeshStandardMaterial({color:0x5e4d19,roughness:.65}),H,index*.7);
  const leafMat=swayMaterial(new THREE.MeshStandardMaterial({map:leafMap,bumpMap:leafBump,bumpScale:.005,color:0xd0b25d,roughness:.57,side:THREE.DoubleSide}),H,index*.7);
  const bladderMat=swayMaterial(new THREE.MeshStandardMaterial({color:0x9b7931,roughness:.40}),H,index*.7);
  for(const [list,mat] of [[branches,stemMat],[leafs,leafMat],[bladders,bladderMat]]){
    const geometry=mergeGeometries(list,false);geometry.scale(.80,1,.62);
    const mesh=new THREE.Mesh(geometry,mat);mesh.castShadow=true;mesh.receiveShadow=true;
    mesh.customDepthMaterial=swayMaterial(new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking,side:THREE.DoubleSide}),H,index*.7);
    group.add(mesh);list.forEach(g=>g.dispose());
  }
  group.userData={id:desc.id,kind:'plant',bounds:new THREE.Box3().setFromObject(group),sway:new THREE.Vector3(.16,0,.11)};objects.set(desc.id,group);plants.push(group);scene.add(group);
}
function makeStone(desc,index){
  const geo=new THREE.SphereGeometry(1,light?28:40,light?20:28);const p=geo.attributes.position;
  for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i);const f=1+.075*Math.sin(x*4.3+index)*Math.cos(z*3.6-.5*index)+.035*Math.sin(y*7+z*5+index);p.setXYZ(i,x*f,y*f,z*f);}
  geo.computeVertexNormals();const root=new THREE.Group(),mesh=new THREE.Mesh(geo,rockMaterials[desc.colorId]);
  mesh.scale.set(desc.scale[0]*S*.56,desc.scale[1]*S*.68,desc.scale[2]*S*.56);mesh.position.y=.12;mesh.castShadow=true;mesh.receiveShadow=true;root.add(mesh);
  root.userData={id:desc.id,kind:'stone',desc,bounds:new THREE.Box3().setFromObject(root)};objects.set(desc.id,root);scene.add(root);
}
const gltfLoader=new GLTFLoader();
const loadedModels=[];
async function makeFish(color,index){
  const url=assetBase+'dangouo-'+color+'.glb',gltf=await gltfLoader.loadAsync(url);const root=gltf.scene;root.scale.setScalar(S);
  const imageSizes=new Set();root.traverse(o=>{const image=o.material?.map?.image;if(image)imageSizes.add(`${image.width}x${image.height}`);});
  loadedModels.push({url,images:[...imageSizes]});canvas.dataset.modelAssets=JSON.stringify(loadedModels);
  const fins=[],phase=index*2.1,activityUniform={value:.025};root.traverse(mesh=>{
    if(!mesh.isMesh)return;mesh.castShadow=!mesh.material.transparent;mesh.receiveShadow=true;mesh.material=mesh.material.clone();
    if(mesh.name==='Body_continuous_skin'){
      const mat=mesh.material;const prev=mat.onBeforeCompile;
      mat.onBeforeCompile=function(sh,r){prev.call(this,sh,r);sh.uniforms.fishTime=time;sh.uniforms.swimActivity=activityUniform;sh.uniforms.fishPhase={value:phase};sh.vertexShader='uniform float fishTime,swimActivity,fishPhase;\n'+sh.vertexShader;sh.vertexShader=sh.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
        float tailWeight=pow(clamp((position.x-.003)/.013,0.,1.),2.);
        transformed.z+=.00026*sin(fishTime*8.0+fishPhase)*tailWeight*swimActivity;
      `);};mat.customProgramCacheKey=()=>`fish-body-v2`;
    }
    if(mesh.name.startsWith('Pectoral')){
      const side=mesh.name.endsWith('left')?-1:1;const pivot=new THREE.Vector3(-141*.03/642,-26*.03/642,side*148*.03/642);
      mesh.geometry=mesh.geometry.clone();mesh.geometry.translate(-pivot.x,-pivot.y,-pivot.z);mesh.position.copy(pivot);mesh.material.depthWrite=false;mesh.castShadow=false;fins.push({mesh,side});
    }else if(mesh.name==='Caudal'){
      const pivot=new THREE.Vector3(219*.03/642,0,0);mesh.geometry=mesh.geometry.clone();mesh.geometry.translate(-pivot.x,0,0);mesh.position.copy(pivot);fins.push({mesh,tail:true});
    }
  });
  root.userData.color=color;scene.add(root);fishes.push({root,index,phase,fins,activityUniform,activity:.025});
}
function limitPosition(desc,p){
  const data=objects.get(desc.id).userData;
  return fitTankPosition(data.bounds,p,desc.rotation,data.sway);
}
function applyState(){
  for(const item of state.snapshot().objects){const root=objects.get(item.id),position=limitPosition(item,item.position);
    if(position.some((v,i)=>v!==item.position[i]))state.setTransform(item.id,{position});
    root.position.fromArray(position);root.rotation.fromArray(item.rotation);
    if(item.kind==='stone')root.children[0].material=rockMaterials[item.colorId];
  }if(selected)selectionBox.setFromObject(objects.get(selected));
}
function toast(msg){$('toast').textContent=msg;$('toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),1800);}
function save(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>{try{localStorage.setItem(KEY,JSON.stringify(state.snapshot()));toast('配置を保存しました');}catch{toast('この環境では配置を保存できません');}},140);}
function selectedItem(){return state.snapshot().objects.find(o=>o.id===selected);}
function syncPanel(){
  const item=selectedItem();if(!item)return;$('object-select').value=selected;
  for(const [id,i] of [['x',0],['y',1],['z',2]]){$('pos-'+id).value=item.position[i]*3;$((id)+'-value').textContent=(item.position[i]*3).toFixed(1)+' cm';}
  const deg=THREE.MathUtils.radToDeg(item.rotation[1]);$('rotation').value=deg;$('rot-value').textContent=Math.round(deg)+'°';
  $('stone-controls').hidden=item.kind!=='stone';
  for(const b of $('individual-colors').querySelectorAll('button')){const value=b.dataset.color===item.colorId;b.classList.toggle('selected',value);b.setAttribute('aria-pressed',String(value));}
  selectionBox.visible=edit;selectionBox.setFromObject(objects.get(selected));
}
function select(id){selected=id;syncPanel();}
function mode(value){edit=value;$('editor').hidden=!edit;$('view-mode').classList.toggle('active',!edit);$('edit-mode').classList.toggle('active',edit);$('view-mode').setAttribute('aria-pressed',String(!edit));$('edit-mode').setAttribute('aria-pressed',String(edit));selectionBox.visible=edit;if(edit)select(selected||approved.objects[0].id);resize();}
$('view-mode').onclick=()=>mode(false);$('edit-mode').onclick=()=>mode(true);
$('object-select').onchange=e=>select(e.target.value);
for(const [id,i] of [['x',0],['y',1],['z',2]])$('pos-'+id).oninput=e=>{const item=selectedItem();const p=[...item.position];p[i]=Number(e.target.value)/3;state.setTransform(selected,{position:limitPosition(item,p)});applyState();syncPanel();save();};
$('rotation').oninput=e=>{const item=selectedItem(),r=[...item.rotation];r[1]=THREE.MathUtils.degToRad(Number(e.target.value));state.setTransform(selected,{rotation:r});applyState();syncPanel();save();};
for(const b of $('individual-colors').querySelectorAll('button'))b.onclick=()=>{state.setStoneColor(selected,b.dataset.color);applyState();syncPanel();save();};
for(const b of $('all-colors').querySelectorAll('button'))b.onclick=()=>{state.setAllStoneColors(b.dataset.color);applyState();syncPanel();save();};
$('restore').onclick=()=>{state.restoreDefault();applyState();syncPanel();save();toast('最初の配置と配色に戻しました');};
function updatePointer(e){const r=canvas.getBoundingClientRect();pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);raycaster.setFromCamera(pointer,camera);}
canvas.addEventListener('pointerdown',e=>{
  if(!edit||e.button!==0)return;updatePointer(e);const hits=raycaster.intersectObjects([...objects.values()],true);if(!hits.length)return;
  let root=hits[0].object;while(root.parent&&!root.userData.id)root=root.parent;if(!root.userData.id)return;
  select(root.userData.id);raycaster.ray.intersectPlane(dragPlane,hitPoint);drag={id:selected,offset:new THREE.Vector3().copy(root.position).sub(hitPoint),y:root.position.y,pointer:e.pointerId};
  controls.enabled=false;canvas.setPointerCapture(e.pointerId);e.stopImmediatePropagation();
},true);
canvas.addEventListener('pointermove',e=>{if(!drag)return;updatePointer(e);if(!raycaster.ray.intersectPlane(dragPlane,hitPoint))return;const item=selectedItem(),p=hitPoint.clone().add(drag.offset);p.y=drag.y;
  state.setTransform(drag.id,{position:limitPosition(item,p.toArray())});applyState();syncPanel();save();
});
function endDrag(){if(drag){drag=null;controls.enabled=true;save();}}
canvas.addEventListener('pointerup',endDrag);canvas.addEventListener('pointercancel',endDrag);window.addEventListener('blur',endDrag);

let water,rockBehavior,frames=0,lastTime=0;
function animateFish(t){
  rockBehavior?.update(t);
  for(const f of fishes){const activity=f.activity;f.activityUniform.value=activity;
    for(const fin of f.fins){if(fin.tail){fin.mesh.rotation.y=.13*Math.sin(t*8+f.phase)*activity;fin.mesh.position.z=.00008*Math.sin(t*8+f.phase)*activity;}
      else{fin.mesh.rotation.y=-fin.side*(.08+.18*(.5+.5*Math.sin(t*7.2+f.phase)))*activity-fin.side*.08*(1-activity);fin.mesh.rotation.z=.035*Math.sin(t*7.2+f.phase+.8)*activity;}
    }
  }
}
let renderTime=0,previousStamp=null,lastFrameStamp=-Infinity,stopped=false;
document.addEventListener('visibilitychange',()=>{previousStamp=null;});
canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();stopped=true;window.dispatchEvent(new CustomEvent('aquarium-failed',{detail:'描画が中断されました。軽量画質で再読み込みしてください。'}));});
function frame(stamp=performance.now()){
  if(stopped)return;requestAnimationFrame(frame);
  if(document.hidden){previousStamp=null;return;}
  if(stamp-lastFrameStamp<1000/quality.fps-1)return;
  renderTime+=previousStamp===null?0:Math.min(.10,(stamp-previousStamp)/1000);previousStamp=stamp;lastFrameStamp=stamp;
  const t=renderTime;time.value=t;controls.update();renderer.info.reset();
  if(state){animateFish(t);if(edit&&selected)selectionBox.setFromObject(objects.get(selected));}
  if(water)water.update(t);renderer.render(scene,camera);frames++;lastTime=t;
  if(frames===1||frames%30===0){canvas.dataset.renderStats=JSON.stringify({quality:quality.name,width:canvas.width,height:canvas.height,programs:renderer.info.programs.length,calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,modelTextureSize:quality.modelTextureSize,frameLimit:quality.fps,shadows:renderer.shadowMap.enabled,waterPasses:quality.waterPasses});}
}
function fatal(error){console.error(error);stopped=true;window.dispatchEvent(new CustomEvent('aquarium-failed',{detail:'水槽を読み込めませんでした。通信を確認して再読み込みしてください。'}));}
async function init(){
  approved=await(await fetch('./assets/layout.json')).json();
  if(!approved.approved)throw Error('This layout has not been approved.');
  approved.objects=approved.objects.map(o=>({...o,position:o.position.map(v=>v*S)}));
  state=createAquariumState(approved.objects,{palette:['charcoal','blueblack'],revision:approved.revision});
  try{const saved=JSON.parse(localStorage.getItem(KEY)||'null');if(saved)state.load(saved);}catch{}
  approved.objects.forEach((desc,i)=>desc.kind==='stone'?makeStone(desc,i):makePlant(desc,i));
  for(const item of approved.objects){const op=document.createElement('option');op.value=item.id;op.textContent=item.kind==='stone'?'石 '+item.id.split('-')[1]:'ホンダワラ '+item.id.split('-')[1];$('object-select').append(op);}
  applyState();selected=approved.objects[0].id;syncPanel();selectionBox.visible=false;
  if(light){for(const [i,color] of ['green','pink','white'].entries()){
    $('loading').firstChild.textContent=`水槽を準備しています（${i+1}/3）`;
    await makeFish(color,i);await new Promise(resolve=>requestAnimationFrame(resolve));
  }}else await Promise.all(['green','pink','white'].map(makeFish));
  fishes.sort((a,b)=>a.index-b.index);
  rockBehavior=createRockBehavior({getStones:()=>[...objects.values()].filter(o=>o.userData.kind==='stone')});
  fishes.forEach(f=>rockBehavior.add(f));
  water=createAquariumWater({scene,renderer,camera,level:22/3});
  // Re-apply shader hooks to each late-loaded fish material; water preserves
  // the preceding fin/body/plant deformation callbacks.
  scene.traverse(o=>{if(o.isMesh)for(const mat of (Array.isArray(o.material)?o.material:[o.material]))water.applyTo(mat);});
  setupBGM();$('loading').hidden=true;frame();
}
init().catch(fatal);
