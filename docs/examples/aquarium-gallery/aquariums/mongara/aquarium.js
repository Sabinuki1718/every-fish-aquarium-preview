/* Aquarium: approved mongara-v5 model and approved layout v2. */
(async function(){
'use strict';
const T=window.THREE,$=id=>document.getElementById(id),canvas=$('canvas'),stage=$('stage');
const params=new URLSearchParams(location.search),requested=params.get('quality')||'auto';
const quality=chooseAquariumQuality({userAgent:navigator.userAgent,userAgentMobile:navigator.userAgentData?.mobile,maxTouchPoints:navigator.maxTouchPoints,coarsePointer:matchMedia('(pointer:coarse)').matches,requestedQuality:requested});
$('quality').value=requested;
const AS=window.AQUARIUM_ASSETS||{},url=name=>AS[name]||'assets/'+name;
let renderer,scene,camera,controls,fish,water,clockTime=0,follow=false,editing=false,selected='stone-left',dragging=false,ready=false;
let errorShown=false,activeView='angle';
const report={version:'aquarium-1',quality:quality.name,model:quality.name==='light'?'fish-light.glb':'fish.glb',fishCount:1,rockCount:5,waterPasses:quality.waterPasses,errors:[],frameCount:0};
const toast=text=>{$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,2200)};
function fail(error){report.errors.push(String(error?.message||error));console.error(error);if(errorShown)return;errorShown=true;$('loading').hidden=false;$('loading').classList.add('error');$('loadingText').textContent='水槽を表示できませんでした。\n軽量モードで開き直してください。';$('retry').hidden=false;}
$('retry').onclick=()=>{const u=new URL(location.href);u.searchParams.set('quality','light');location.href=u.href};
canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();ready=false;fail(new Error('WebGL context lost'))});
window.addEventListener('error',e=>{if(!ready)fail(e.error||e.message);else report.errors.push(e.message)});
try{
renderer=new T.WebGLRenderer({canvas,antialias:quality.antialias,alpha:false,powerPreference:quality.name==='light'?'low-power':'high-performance',preserveDrawingBuffer:true});
renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.04;renderer.shadowMap.enabled=quality.shadows;renderer.shadowMap.type=T.PCFSoftShadowMap;renderer.info.autoReset=false;
scene=new T.Scene();scene.background=new T.Color('#dfe8e9');scene.fog=null;
camera=new T.PerspectiveCamera(35,1,.015,12);camera.position.set(.82,.91,2.36);
controls=new T.OrbitControls(camera,canvas);controls.target.set(0,.34,0);controls.enableDamping=true;controls.dampingFactor=.075;controls.minDistance=.42;controls.maxDistance=9;controls.maxPolarAngle=Math.PI*.92;controls.enablePan=true;controls.screenSpacePanning=true;
const ambient=new T.HemisphereLight('#d6f6ff','#af9c7e',2.0);scene.add(ambient);
const key=new T.DirectionalLight('#fff7e8',3.2);key.position.set(-.65,2,1.5);key.castShadow=quality.shadows;key.shadow.mapSize.set(1024,1024);key.shadow.camera.left=-1.1;key.shadow.camera.right=1.1;key.shadow.camera.top=1;key.shadow.camera.bottom=-1;key.shadow.camera.near=.1;key.shadow.camera.far=5;key.shadow.bias=-.00015;key.shadow.normalBias=.003;scene.add(key);
const fill=new T.DirectionalLight('#bbebff',1.5);fill.position.set(1.2,1,-1.3);scene.add(fill);
const uniforms={time:{value:0}};
function shadeMaterial(material,{wave=false,finType='',side=1,base=new T.Vector2()}={}){
 material.onBeforeCompile=shader=>{
  shader.uniforms.aqTime=uniforms.time;shader.uniforms.aqFinSide={value:side};shader.uniforms.aqFinBase={value:base};
  shader.vertexShader='uniform float aqTime; uniform float aqFinSide; varying vec3 aqWorld; varying vec3 aqLocal;\n'+shader.vertexShader;
  let deform='';
  if(wave)deform+='float aqTail=smoothstep(.025,.148,position.x); transformed.z+=sin(aqTime*3.2-position.x*26.)*.0035*aqTail*aqTail;\n';
  if(finType==='dorsal')deform+='transformed.z+=sin(aqTime*8.1-position.x*92.)*.0027*aqWeight;\n';
  if(finType==='anal')deform+='transformed.z+=sin(aqTime*8.1-position.x*92.+1.2)*.0024*aqWeight;\n';
  if(finType==='pectoral')deform+='transformed.z+=aqFinSide*(.0014+.0012*sin(aqTime*7.4+aqFinSide*.5))*aqWeight; transformed.y+=sin(aqTime*7.4+aqFinSide*.5)*.0009*aqWeight;\n';
  if(finType)shader.vertexShader='attribute float aqWeight;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\naqLocal=position;\n'+deform);
  shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\naqWorld=(modelMatrix*vec4(transformed,1.)).xyz;');
  shader.fragmentShader='uniform float aqTime; uniform vec2 aqFinBase; varying vec3 aqWorld; varying vec3 aqLocal;\n'+shader.fragmentShader;
  let fragment=`float aqA=sin(aqWorld.x*36.+sin(aqWorld.z*23.+aqTime*.35)*1.7+aqTime*.36); float aqB=sin(aqWorld.z*32.+sin(aqWorld.x*28.-aqTime*.24)*1.7-aqTime*.3); float aqCaustic=pow(max(0.,1.-abs(aqA+aqB)*.63),12.); diffuseColor.rgb*=.98+.095*aqCaustic;`;
  if(finType){
   fragment+=`float aqLum=dot(diffuseColor.rgb,vec3(.299,.587,.114)); float aqChroma=max(diffuseColor.r,max(diffuseColor.g,diffuseColor.b))-min(diffuseColor.r,min(diffuseColor.g,diffuseColor.b)); float aqMem=smoothstep(.15,.5,aqLum)*(1.-smoothstep(.2,.55,aqChroma)); diffuseColor.a*=mix(1.,.60,aqMem);`;
   if(finType==='pectoral')fragment+=`vec2 aqQ=aqLocal.xy-aqFinBase; float aqAngle=atan(aqQ.y,aqQ.x); float aqR=1.-smoothstep(.08,max(.14,fwidth(aqAngle)*22.),abs(sin(aqAngle*20.))); diffuseColor.rgb*=.90+.14*aqR; diffuseColor.a=mix(diffuseColor.a,min(1.,diffuseColor.a+.22),aqR);`;
  }
  shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\n'+fragment);
 };
 material.customProgramCacheKey=()=>`aquarium-caustic-2-${wave}-${finType}`;
 return material;
}
const manager=new T.LoadingManager();manager.onError=u=>report.errors.push('asset: '+u);
const tl=new T.TextureLoader(manager);
function texture(name){return new Promise((res,rej)=>tl.load(url(name),t=>{t.colorSpace=T.SRGBColorSpace;t.wrapS=t.wrapT=T.RepeatWrapping;t.anisotropy=Math.min(quality.name==='light'?2:6,renderer.capabilities.getMaxAnisotropy());res(t)},undefined,rej))}
const [plan,sandTex,blueTex,warmTex]=await Promise.all([
 AS.layout?Promise.resolve(AS.layout):fetch(url('approved-layout.json')).then(r=>{if(!r.ok)throw new Error('layout '+r.status);return r.json()}),texture('sand.jpg'),texture('stone-blue.jpg'),texture('stone-warm.jpg')]);
const palette=['slate-blue-gray','warm-beige-gray'],state=createAquariumState(plan.objects,{palette,revision:'mongara-layout-v2-coralline-5'}),saveKey='mongara-aquarium-layout-v2-coralline-5';
const labels={'stone-left':'左奥の大きな石','stone-right':'右奥の石','stone-left-small':'左奥の小さな石','stone-right-small':'右奥の小さな石','stone-right-front':'右手前の平たい石'};
function limitPosition(obj,p){const dx=obj.dimensions_m[0]/2,dz=obj.dimensions_m[2]/2;return [T.MathUtils.clamp(p[0],-.79+dx,.79-dx),obj.position[1],T.MathUtils.clamp(p[2],-.315+dz,.315-dz)]}
try{const saved=JSON.parse(localStorage.getItem(saveKey)||'null');if(saved&&state.load(saved)){state.snapshot().objects.forEach(o=>state.setTransform(o.id,{position:limitPosition(o,o.position)}));$('saveStatus').textContent='前回の配置を読み込みました'}}catch{}
function persist(){try{localStorage.setItem(saveKey,JSON.stringify(state.snapshot()));$('saveStatus').textContent='このブラウザに保存しました'}catch{$('saveStatus').textContent='この環境では保存できません'}}
// Fine white sand, bottom glass and a quiet dark base.
sandTex.repeat.set(6,3);const sandMat=shadeMaterial(new T.MeshStandardMaterial({map:sandTex,color:'#faf6ea',roughness:.93,metalness:0}));
const sand=new T.Mesh(new T.BoxGeometry(1.6,.03,.65,80,1,30),sandMat);sand.position.y=.015;sand.receiveShadow=true;scene.add(sand);
const base=new T.Mesh(new T.BoxGeometry(1.65,.043,.70),new T.MeshStandardMaterial({color:'#26373b',roughness:.55,metalness:.25}));base.position.y=-.025;scene.add(base);
const ground=new T.Mesh(new T.PlaneGeometry(30,30),new T.ShadowMaterial({color:'#3a555b',opacity:.11}));ground.rotation.x=-Math.PI/2;ground.position.y=-.048;ground.receiveShadow=true;scene.add(ground);
// Rear panel gradient, kept opaque to frame the fish clearly.
const back=new T.Mesh(new T.PlaneGeometry(1.6,.75),new T.ShaderMaterial({uniforms:{},vertexShader:'varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec2 vUv; void main(){vec3 col=mix(vec3(.018,.17,.255),vec3(.025,.42,.56),smoothstep(0.,1.,vUv.y)); float glow=exp(-pow((vUv.x-.45)*1.9,2.))* .025; gl_FragColor=vec4(col+glow,1.);}',side:T.DoubleSide}));back.position.set(0,.375,-.326);scene.add(back);
const glass=new T.Group();scene.add(glass);const gm=new T.MeshPhongMaterial({color:'#a4d9e0',transparent:true,opacity:.045,shininess:110,specular:'#ffffff',side:T.DoubleSide,depthWrite:false});
function pane(w,h,x,y,z,ry){const p=new T.Mesh(new T.PlaneGeometry(w,h),gm);p.position.set(x,y,z);p.rotation.y=ry;p.renderOrder=5;glass.add(p)}
pane(.65,.75,-.803,.375,0,Math.PI/2);pane(.65,.75,.803,.375,0,Math.PI/2);pane(1.6,.75,0,.375,.328,0);
const edgePoints=[];const corners=[[-.802,0,-.326],[.802,0,-.326],[.802,0,.326],[-.802,0,.326]];
for(let i=0;i<4;i++){const a=corners[i],b=corners[(i+1)%4];edgePoints.push(...a,...b,a[0],.75,a[2],b[0],.75,b[2],...a,a[0],.75,a[2])}
const edgegeo=new T.BufferGeometry();edgegeo.setAttribute('position',new T.Float32BufferAttribute(edgePoints,3));const edges=new T.LineSegments(edgegeo,new T.LineBasicMaterial({color:'#a3d0d7',transparent:true,opacity:.62}));scene.add(edges);
// Five individually shaped stones. Texture colors are separate reusable materials.
function stoneMat(map){const m=new T.MeshStandardMaterial({map,roughness:.89,metalness:0});shadeMaterial(m);const caustic=m.onBeforeCompile;m.onBeforeCompile=s=>{caustic(s);s.vertexShader='varying vec3 aqStoneP; varying vec3 aqStoneN;\n'+s.vertexShader;s.vertexShader=s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\naqStoneP=position;aqStoneN=normal;');s.fragmentShader='varying vec3 aqStoneP; varying vec3 aqStoneN;\n'+s.fragmentShader;s.fragmentShader=s.fragmentShader.replace('#include <map_fragment>',`#ifdef USE_MAP
 vec3 w=pow(abs(normalize(aqStoneN)),vec3(5.));w/=max(.001,w.x+w.y+w.z);vec3 p=aqStoneP*6.0;vec4 texel=texture2D(map,p.yz)*w.x+texture2D(map,p.xz)*w.y+texture2D(map,p.xy)*w.z;diffuseColor*=texel;
 #endif`)};m.customProgramCacheKey=()=> 'aquarium-stone-triplanar-3';return m}
const stoneMaterials={'slate-blue-gray':stoneMat(blueTex),'warm-beige-gray':stoneMat(warmTex)},rocks=new Map();
function stoneGeometry(dim,seed){const g=new T.SphereGeometry(1,quality.name==='light'?24:40,quality.name==='light'?16:28),p=g.attributes.position;
for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i),r=1+.055*Math.sin(x*4.7+seed)*Math.sin(y*3.1+z*2.8+seed*.3)+.04*Math.sin(z*7.1+seed)*Math.cos(x*4.2-y*3.8);p.setXYZ(i,x*r,y*r,z*r)}
g.computeBoundingBox();const box=g.boundingBox,size=new T.Vector3();box.getSize(size);const center=new T.Vector3();box.getCenter(center);g.translate(-center.x,-center.y,-center.z);g.scale(dim[0]/size.x,dim[1]/size.y,dim[2]/size.z);g.computeVertexNormals();g.computeBoundingSphere();return g}
plan.objects.forEach((o,i)=>{const r=new T.Mesh(stoneGeometry(o.dimensions_m,i*2.7+1),stoneMaterials[o.colorId]);r.userData.id=o.id;r.castShadow=quality.shadows;r.receiveShadow=true;rocks.set(o.id,r);scene.add(r);const opt=document.createElement('option');opt.value=o.id;opt.textContent=labels[o.id];$('stoneSelect').append(opt)});
const selection=new T.BoxHelper(rocks.get(selected),'#70b4b9');selection.visible=false;selection.material.depthTest=false;selection.material.transparent=true;selection.material.opacity=.8;selection.renderOrder=9;scene.add(selection);
function applyState(){state.snapshot().objects.forEach(o=>{const r=rocks.get(o.id);r.position.fromArray(o.position);r.rotation.fromArray(o.rotation);r.material=stoneMaterials[o.colorId]});selection.setFromObject(rocks.get(selected));syncFields()}
function syncFields(){const o=state.snapshot().objects.find(o=>o.id===selected);$('stoneSelect').value=selected;$('xRange').min=-.79+o.dimensions_m[0]/2;$('xRange').max=.79-o.dimensions_m[0]/2;$('zRange').min=-.315+o.dimensions_m[2]/2;$('zRange').max=.315-o.dimensions_m[2]/2;$('xRange').value=o.position[0];$('zRange').value=o.position[2];$('rotationRange').value=Math.round(T.MathUtils.radToDeg(o.rotation[1]));$('xValue').value=Math.round(o.position[0]*100)+' cm';$('zValue').value=Math.round(o.position[2]*100)+' cm';$('rotationValue').value=Math.round(T.MathUtils.radToDeg(o.rotation[1]))+'°';$('stoneColor').value=o.colorId}
function select(id){selected=id;selection.setFromObject(rocks.get(id));selection.visible=editing;syncFields()}
$('stoneSelect').onchange=e=>select(e.target.value);
for(const id of ['xRange','zRange','rotationRange'])$(id).oninput=()=>{const o=state.snapshot().objects.find(o=>o.id===selected),p=[+$('xRange').value,o.position[1],+$('zRange').value];state.setTransform(selected,{position:limitPosition(o,p),rotation:[0,T.MathUtils.degToRad(+$('rotationRange').value),0]});applyState();persist()};
$('stoneColor').onchange=e=>{state.setStoneColor(selected,e.target.value);applyState();persist()};$('allColor').onchange=e=>{if(!e.target.value)return;state.setAllStoneColors(e.target.value);applyState();persist();e.target.value='';toast('すべての石の色を変更しました')};
$('restore').onclick=()=>{state.restoreDefault();applyState();persist();toast('承認済みの初期配置と色に戻しました')};
applyState();
function setMode(edit){editing=edit;$('editor').hidden=!edit;$('watchMode').classList.toggle('active',!edit);$('editMode').classList.toggle('active',edit);$('watchMode').setAttribute('aria-pressed',String(!edit));$('editMode').setAttribute('aria-pressed',String(edit));selection.visible=edit;$('hint').textContent=edit?'石を選んで移動 · 変更はブラウザに保存':'ドラッグで回転 · スクロールで拡大';if(edit)setFollow(false)}
$('watchMode').onclick=()=>setMode(false);$('editMode').onclick=()=>setMode(true);
// Object dragging preserves the grabbed offset; view rotation resumes on release/cancel.
const ray=new T.Raycaster(),pointer=new T.Vector2(),dragPlane=new T.Plane(new T.Vector3(0,1,0),0),hitpoint=new T.Vector3(),dragOffset=new T.Vector3();let dragId=null;
function aim(e){const b=canvas.getBoundingClientRect();pointer.set((e.clientX-b.left)/b.width*2-1,-(e.clientY-b.top)/b.height*2+1);ray.setFromCamera(pointer,camera)}
canvas.addEventListener('pointerdown',e=>{if(!editing)return;aim(e);const hits=ray.intersectObjects([...rocks.values()],false);if(!hits.length)return;const r=hits[0].object;select(r.userData.id);dragId=r.userData.id;dragPlane.constant=-r.position.y;if(ray.ray.intersectPlane(dragPlane,hitpoint))dragOffset.copy(hitpoint).sub(r.position);dragging=true;controls.enabled=false;canvas.setPointerCapture(e.pointerId);e.stopImmediatePropagation();e.preventDefault()},true);
canvas.addEventListener('pointermove',e=>{if(!dragging)return;aim(e);if(ray.ray.intersectPlane(dragPlane,hitpoint)){const o=state.snapshot().objects.find(o=>o.id===dragId);const p=hitpoint.clone().sub(dragOffset);state.setTransform(dragId,{position:limitPosition(o,p.toArray())});applyState()}e.stopImmediatePropagation()},true);
function release(){if(!dragging)return;dragging=false;dragId=null;controls.enabled=true;persist()}
canvas.addEventListener('pointerup',release,true);canvas.addEventListener('pointercancel',release,true);canvas.addEventListener('lostpointercapture',release,true);
// Load the exact approved model. The mobile variant changes the atlas resolution only.
$('loadingText').textContent='モンガラカワハギを読み込んでいます…';
const loader=new T.GLTFLoader(manager),modelName=report.model;
const gltf=await new Promise((res,rej)=>{const source=url(modelName);if(source.startsWith('data:')){const raw=atob(source.split(',')[1]),data=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)data[i]=raw.charCodeAt(i);loader.parse(data.buffer,'',res,rej)}else loader.load(source,res,undefined,rej)});
fish=new T.Group();scene.add(fish);fish.add(gltf.scene);
const landmarks=AS.landmarks||await fetch(url('model-profile.json')).then(r=>r.json());
function profile(x,column){const a=landmarks;let i=0;while(i<a.length-2&&a[i+1][0]<x)i++;const f=T.MathUtils.clamp((x-a[i][0])/(a[i+1][0]-a[i][0]),0,1);return T.MathUtils.lerp(a[i][column],a[i+1][column],f)}
gltf.scene.traverse(m=>{if(!m.isMesh)return;m.geometry=m.geometry.clone();m.geometry.translate(-.15,0,0);const mat=m.material.clone();mat.roughness=.68;mat.metalness=0;mat.side=T.FrontSide;const name=m.name;
let type='';if(name==='second_dorsal')type='dorsal';if(name==='anal')type='anal';if(name.startsWith('pectoral'))type='pectoral';
if(type){mat.transparent=true;mat.opacity=1;mat.depthWrite=false;mat.roughness=.55;m.castShadow=false;
const p=m.geometry.attributes.position,w=new Float32Array(p.count);for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),u=(x+.15)/(.3/1095)+27;if(type==='dorsal')w[i]=T.MathUtils.clamp((y-(300-profile(u,1))*(.3/1095))/.04,0,1);if(type==='anal')w[i]=T.MathUtils.clamp(((300-profile(u,2))*(.3/1095)-y)/.04,0,1);if(type==='pectoral')w[i]=T.MathUtils.clamp((u-307)/38,0,1)}m.geometry.setAttribute('aqWeight',new T.BufferAttribute(w,1));
}else m.castShadow=quality.shadows;
shadeMaterial(mat,{wave:true,finType:type,side:name.includes('right')?-1:1,base:new T.Vector2((298-27)*(.3/1095)-.15,(300-282)*(.3/1095))});m.material=mat;m.receiveShadow=true;});
gltf.scene.traverse(o=>{if(o.isMesh&&o.name==='body_and_tail_continuous'){report.textureDimensions={width:o.material.map.image.width,height:o.material.map.image.height};}});document.body.dataset.model=modelName;document.body.dataset.modelTexture=report.textureDimensions.width+'x'+report.textureDimensions.height;
// Surface: analytical waves, refraction and planar reflection in standard mode.
const waterGeo=new T.PlaneGeometry(1.6,.65,quality.name==='light'?36:100,quality.name==='light'?16:44);waterGeo.rotateX(-Math.PI/2);
let refraction=null,reflection=null;const mirror=new T.PerspectiveCamera(),mirrorTarget=new T.Vector3(),reflectMatrix=new T.Matrix4(),biasMatrix=new T.Matrix4().set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1);
if(quality.name==='standard'){refraction=new T.WebGLRenderTarget(800,500,{depthBuffer:true});reflection=new T.WebGLRenderTarget(512,320,{depthBuffer:true});refraction.texture.colorSpace=T.LinearSRGBColorSpace;reflection.texture.colorSpace=T.LinearSRGBColorSpace;}
const waterUniforms={aqTime:uniforms.time,tRefract:{value:refraction?.texture||sandTex},tReflect:{value:reflection?.texture||sandTex},simple:{value:quality.name==='light'?1:0},eye:{value:camera.position},reflectMatrix:{value:reflectMatrix}};
water=new T.Mesh(waterGeo,new T.ShaderMaterial({uniforms:waterUniforms,transparent:true,depthWrite:false,side:T.DoubleSide,
vertexShader:`uniform float aqTime;uniform mat4 reflectMatrix;varying vec3 wPos;varying vec3 wNormal;varying vec4 reflected;varying vec4 clipPos;
void main(){vec3 p=position;float a=p.x*39.+p.z*27.+aqTime*.56;float b=p.x*61.-p.z*34.-aqTime*.43;float c=p.x*17.+p.z*53.+aqTime*.31;p.y+=sin(a)*.00065+sin(b)*.00038+sin(c)*.00042;float dx=cos(a)*.02535+cos(b)*.02318+cos(c)*.00714;float dz=cos(a)*.01755-cos(b)*.01292+cos(c)*.02226;wNormal=normalize(vec3(-dx,1.,-dz));vec4 world=modelMatrix*vec4(p,1.);wPos=world.xyz;reflected=reflectMatrix*world;clipPos=projectionMatrix*viewMatrix*world;gl_Position=clipPos;}`,
fragmentShader:`uniform sampler2D tRefract;uniform sampler2D tReflect;uniform float simple;uniform vec3 eye;varying vec3 wPos;varying vec3 wNormal;varying vec4 reflected;varying vec4 clipPos;
void main(){vec3 n=normalize(wNormal);vec3 v=normalize(eye-wPos);float f=pow(1.-abs(dot(v,n)),5.);float spec=pow(max(0.,dot(reflect(normalize(vec3(.3,-1.,-.4)),n),v)),130.);if(simple>.5){gl_FragColor=vec4(mix(vec3(.20,.66,.72),vec3(.8,.94,.95),f*.65)+spec*.25,.10+f*.38);return;}vec2 uv=clipPos.xy/clipPos.w*.5+.5;vec2 shift=n.xz*.016;vec3 under=texture2D(tRefract,clamp(uv+shift,.002,.998)).rgb*vec3(.975,.994,1.);vec2 ruv=reflected.xy/reflected.w;vec3 above=texture2D(tReflect,clamp(ruv+shift,.002,.998)).rgb;vec3 col=mix(under,above,.025+f*.62)+spec*.22;gl_FragColor=vec4(col,1.);}`
}));water.position.y=.70;water.renderOrder=3;scene.add(water);
const waterline=new T.LineLoop(new T.BufferGeometry().setFromPoints([new T.Vector3(-.8,.7,-.325),new T.Vector3(.8,.7,-.325),new T.Vector3(.8,.7,.325),new T.Vector3(-.8,.7,.325)]),new T.LineBasicMaterial({color:'#d5f5f7',transparent:true,opacity:.52}));scene.add(waterline);
const clipPlane=new T.Plane(new T.Vector3(0,1,0),-.698);
function resize(){const sz=aquariumDrawingSize(quality,stage.clientWidth,stage.clientHeight,devicePixelRatio);renderer.setPixelRatio(sz.pixelRatio);renderer.setSize(sz.cssWidth,sz.cssHeight,false);camera.aspect=sz.cssWidth/sz.cssHeight;camera.updateProjectionMatrix();if(refraction){const ratio=Math.min(1,1000/Math.max(sz.drawingWidth,sz.drawingHeight));refraction.setSize(Math.round(sz.drawingWidth*ratio),Math.round(sz.drawingHeight*ratio));reflection.setSize(Math.round(sz.drawingWidth*ratio*.65),Math.round(sz.drawingHeight*ratio*.65))}report.drawingSize=[sz.drawingWidth,sz.drawingHeight];if(ready){if(follow)setFollow(true);else setView(activeView)}}
addEventListener('resize',resize);resize();
const viewPositions={front:new T.Vector3(0,.42,2.55),angle:new T.Vector3(.82,.91,2.36),top:new T.Vector3(.001,2.72,.055)};let transition=null;
function setView(name){activeView=name;setFollow(false);const p=viewPositions[name].clone();const center=new T.Vector3(0,.34,0);p.sub(center).multiplyScalar(Math.max(1,1.28/camera.aspect)).add(center);transition={from:camera.position.clone(),to:p,start:performance.now(),fromTarget:controls.target.clone(),target:new T.Vector3(0,.34,0)};['front','angle','top'].forEach(n=>$(n+'View').classList.toggle('active',n===name))}
function setFollow(value){follow=value;$('followView').classList.toggle('active',value);$('followView').setAttribute('aria-pressed',String(value));if(value&&fish){transition=null;camera.position.copy(fish.position).add(new T.Vector3(.21,.13,.52).multiplyScalar(Math.max(1,1.05/camera.aspect)));controls.target.copy(fish.position);controls.minDistance=.22}else controls.minDistance=.42}
$('frontView').onclick=()=>setView('front');$('angleView').onclick=()=>setView('angle');$('topView').onclick=()=>setView('top');$('homeView').onclick=()=>setView('angle');$('followView').onclick=()=>{if(editing)setMode(false);setFollow(!follow)};
$('quality').onchange=e=>{const u=new URL(location.href);u.searchParams.set('quality',e.target.value);location.href=u.href};
// A short wandering route in the central clear area. Obstacles affect position in edit mode too.
const previousFish=new T.Vector3(),direction=new T.Vector3(),worldForward=new T.Vector3(-1,0,0),desiredRotation=new T.Quaternion();
function fishPosition(t){const a=t*.13;return new T.Vector3(.49*Math.sin(a),.365+.045*Math.sin(a*.8)+.009*Math.sin(t*.55),.055+.115*Math.cos(a))}
function avoid(position){for(const o of state.snapshot().objects){const r=rocks.get(o.id),dx=position.x-r.position.x,dz=position.z-r.position.z;const rr=Math.max(o.dimensions_m[0],o.dimensions_m[2])*.5+.11;const horizontal=Math.hypot(dx,dz);const top=r.position.y+o.dimensions_m[1]/2;if(horizontal<rr&&position.y-.065<top+.025)position.y=Math.max(position.y,top+.10)}position.y=T.MathUtils.clamp(position.y,.22,.56);return position}
const p0=avoid(fishPosition(0));fish.position.copy(p0);previousFish.copy(p0);
function updateFish(dt,t){const next=avoid(fishPosition(t)),ahead=avoid(fishPosition(t+.12));direction.subVectors(ahead,next);direction.y*=.35;direction.normalize();desiredRotation.setFromEuler(new T.Euler(0,Math.atan2(direction.z,-direction.x),-Math.asin(direction.y),'YXZ'));fish.quaternion.slerp(desiredRotation,1-Math.exp(-dt*2.1));fish.position.lerp(next,1-Math.exp(-dt*5));if(follow){const delta=fish.position.clone().sub(previousFish);camera.position.add(delta);controls.target.lerp(fish.position,.15)}previousFish.copy(fish.position)}
let last=performance.now(),lastRender=0;ready=true;$('loading').hidden=true;report.ready=true;document.body.dataset.aquariumReady='true';document.body.dataset.quality=quality.name;
if(camera.aspect<.85)setView('angle');
function frame(now){requestAnimationFrame(frame);if(document.hidden||!ready){last=now;return;}if(now-lastRender<1000/quality.fps-1)return;const dt=Math.min(.05,(now-last)/1000);last=now;lastRender=now;clockTime+=dt;uniforms.time.value=clockTime;updateFish(dt,clockTime);
if(transition){const a=T.MathUtils.clamp((now-transition.start)/800,0,1),v=a*a*(3-2*a);camera.position.lerpVectors(transition.from,transition.to,v);controls.target.lerpVectors(transition.fromTarget,transition.target,v);if(a===1)transition=null}controls.update();if(editing)selection.update();renderer.info.reset();
if(refraction){const visible=selection.visible;selection.visible=false;water.visible=false;renderer.setRenderTarget(refraction);renderer.render(scene,camera);renderer.shadowMap.autoUpdate=false;mirror.copy(camera,false);mirror.position.set(camera.position.x,1.4-camera.position.y,camera.position.z);mirror.up.set(0,-1,0);mirrorTarget.copy(controls.target);mirrorTarget.y=1.4-mirrorTarget.y;mirror.lookAt(mirrorTarget);mirror.updateMatrixWorld();reflectMatrix.copy(biasMatrix).multiply(mirror.projectionMatrix).multiply(mirror.matrixWorldInverse);renderer.clippingPlanes=[clipPlane];renderer.setRenderTarget(reflection);renderer.render(scene,mirror);renderer.clippingPlanes=[];renderer.setRenderTarget(null);water.visible=true;selection.visible=visible}
renderer.render(scene,camera);renderer.shadowMap.autoUpdate=true;report.frameCount++;if(report.frameCount%45===0){canvas.dataset.drawCalls=String(renderer.info.render.calls);canvas.dataset.waterPasses=String(quality.waterPasses);report.drawCalls=renderer.info.render.calls;report.programs=renderer.info.programs?.length;report.fishPosition=fish.position.toArray();report.stones=state.snapshot().objects;}
}
requestAnimationFrame(frame);
window.__aquarium={report,getState:()=>state.snapshot(),restore:()=>{$('restore').click()},select,fish,scene,camera,controls,renderer,quality,setView,setMode,setFollow,capture:()=>canvas.toDataURL('image/png')};
}catch(error){fail(error)}
})();
