import {createAquariumRenderer,LIGHT_MODE,prepareTextures} from './runtime.js';
import * as THREE from './vendor/three.module.js';
import {OrbitControls} from './vendor/OrbitControls.js';
import {GLTFLoader} from './vendor/GLTFLoader.js';
import {createLayoutEditor} from './layout-editor.js';
import {createAquariumWater} from './water.js';
const host=document.querySelector('#canvas'), status=document.querySelector('#loading');
let renderer;
try{renderer=createAquariumRenderer(THREE,true);}catch(e){status.textContent='3D表示にはWebGL対応のブラウザが必要です。';throw e;}
renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.13;host.append(renderer.domElement);
const scene=new THREE.Scene(), camera=new THREE.PerspectiveCamera(38,1,.04,120);camera.position.set(12,8.2,18.5);
const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,2.7,0);controls.enableDamping=true;controls.dampingFactor=.07;controls.minDistance=3;controls.maxDistance=39;controls.maxPolarAngle=Math.PI*.91;controls.update();
scene.add(new THREE.HemisphereLight(0xd8f5ef,0x354331,1.1));const key=new THREE.DirectionalLight(0xecffdf,2.7);key.position.set(-3,12,6);key.castShadow=true;key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{left:-9,right:9,top:8,bottom:-8,near:.1,far:30});key.shadow.bias=-.001;key.shadow.normalBias=.025;scene.add(key);const fill=new THREE.DirectionalLight(0x91c7d4,1.15);fill.position.set(8,7,-3);scene.add(fill);
let seed=42;function rand(){seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;}const mat=(c,r=.8)=>new THREE.MeshStandardMaterial({color:c,roughness:r});
function box(w,h,d,x,y,z,m){let mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);mesh.position.set(x,y,z);scene.add(mesh);return mesh;}
// A rimless tank with a black rear screen and clear sides.
const black=mat('#070c0b',.65);box(12.35,.22,5.35,0,-.17,0,black);box(12.1,6,.08,0,2.9,-2.58,mat('#030605',.93));
const glass=new THREE.MeshPhysicalMaterial({color:0x9ccfc4,transparent:true,opacity:.055,roughness:.08,metalness:0,depthWrite:false,side:THREE.DoubleSide});
box(.055,6,5.16,-6.04,2.9,0,glass);box(.055,6,5.16,6.04,2.9,0,glass);box(12.1,6,.035,0,2.9,2.58,glass);
const edgeMat=new THREE.LineBasicMaterial({color:0x9cc7bc,transparent:true,opacity:.36});const edge=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(12.1,6,5.2)),edgeMat);edge.position.y=2.9;scene.add(edge);
box(12,.26,5.08,0,.04,0,mat('#111714'));const gravelGeo=new THREE.IcosahedronGeometry(1,0),gravelMat=mat('#222a25',.85),gravel=new THREE.InstancedMesh(gravelGeo,gravelMat,6600),dummy=new THREE.Object3D();
for(let i=0;i<6600;i++){let x=(rand()-.5)*11.96,z=(rand()-.5)*5,y=.19+.11*rand()+.1*(.5-z/5);dummy.position.set(x,y,z);dummy.rotation.set(rand()*3,rand()*6,rand()*3);const s=.035+rand()*.065;dummy.scale.set(s*(.7+rand()),s*.65,s);dummy.updateMatrix();gravel.setMatrixAt(i,dummy.matrix);gravel.setColorAt(i,new THREE.Color().setHSL(.3+rand()*.1,.04+rand()*.12,.055+rand()*.12));}gravel.receiveShadow=true;scene.add(gravel);
// Use the supplied stone photographs, sampling only their interior mineral surface.
// Triplanar blending keeps the grain continuous around the rounded 3D silhouette.
const stoneImagesReady=[];
function stoneMaterial(file){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=1024;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#52625b';ctx.fillRect(0,0,1024,1024);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
  const image=new Image();
  stoneImagesReady.push(new Promise((resolve,reject)=>{
    image.onload=()=>{ctx.drawImage(image,260,390,720,580,0,0,1024,1024);texture.needsUpdate=true;resolve();};
    image.onerror=()=>{status.hidden=false;status.textContent='石の画像を読み込めませんでした。再読み込みしてください。';reject(new Error('Stone texture failed: '+file));};
  }));image.src='./assets/'+file;
  const material=new THREE.MeshStandardMaterial({map:texture,roughness:.72,metalness:0});
  material.onBeforeCompile=shader=>{
    shader.vertexShader='varying vec3 vStonePosition; varying vec3 vStoneNormal;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvStonePosition=position;vStoneNormal=normal;');
    shader.fragmentShader='varying vec3 vStonePosition; varying vec3 vStoneNormal;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`
      vec3 blend=pow(abs(normalize(vStoneNormal)),vec3(5.));
      blend/=max(dot(blend,vec3(1.)),0.0001);
      vec4 stoneColor=texture2D(map,vStonePosition.yz*.43+.5)*blend.x
        +texture2D(map,vStonePosition.xz*.43+.5)*blend.y
        +texture2D(map,vStonePosition.xy*.43+.5)*blend.z;
      diffuseColor*=stoneColor;
    `);
  };material.customProgramCacheKey=()=> 'reference-stone-triplanar-v1';
  return material;
}
const stoneMats=[stoneMaterial('sanbaseki-blue-green-rounded.png'),stoneMaterial('sanbaseki-red-rounded.png')],rocks=[];
Promise.all(stoneImagesReady).then(()=>{window.stoneTexturesReady=true;}).catch(console.error);
function rock(x,z,sx,sy,sz,angle,color){
  const geo=new THREE.SphereGeometry(1,64,40),p=geo.attributes.position;
  for(let i=0;i<p.count;i++){
    const a=p.getX(i),b=p.getY(i),c=p.getZ(i);
    const f=1+.055*Math.sin(a*3.1+c*2.3)+.035*Math.cos(b*4.2-a*1.8)+.022*Math.sin(c*5.1+b*2.2);
    const y=b<-.68?-.68+(b+.68)*.32:b;
    p.setXYZ(i,a*f,y*f,c*f);
  }
  geo.computeVertexNormals();
  const m=new THREE.Mesh(geo,stoneMats[color]);
  m.scale.set(sx*1.05,sy*.8,sz*1.07);m.position.set(x,sy*.8*.76+.21,z);
  m.rotation.set(.08,angle,-.08);m.castShadow=true;m.receiveShadow=true;m.userData.color=color;
  scene.add(m);rocks.push(m);
}
rock(-3.15,-.7,1.45,1.65,1.08,-.3,0);rock(-4.5,.1,.85,.65,.68,.5,0);rock(-2.1,-.2,.85,.65,.7,.9,0);rock(3.3,-.65,1.25,1.2,.95,.4,1);rock(4.4,.1,.8,.65,.65,-.4,1);rock(2.35,.3,.68,.45,.6,.8,1);rock(-.8,-1.75,.45,.32,.4,.6,0);
// Broad lanceolate leaves grow as rosettes, with an arched midrib.
const plants=[];function plant(x,z,size){const group=new THREE.Group();group.position.set(x,.27,z);scene.add(group);plants.push(group);for(let j=0;j<12;j++){const a=j*2.399+rand()*.4,len=size*(.64+rand()*.5),w=len*(.085+rand()*.025);const dx=Math.sin(a),dz=Math.cos(a);const reach=Math.min(Math.abs(dx)<.001?99:(dx>0?5.65-x:-5.65-x)/dx,Math.abs(dz)<.001?99:(dz>0?2.12-z:-2.12-z)/dz);const lean=Math.min(.3+rand()*.65,Math.max(.08,reach/len));const pos=[],uv=[],idx=[];const rows=22,cols=8;for(let r=0;r<=rows;r++){let t=r/rows,spread=Math.pow(Math.sin(Math.PI*t),.78)*w;for(let c=0;c<=cols;c++){let v=(c/cols-.5)*2;pos.push(v*spread,t*len-.27*t*t*len,lean*len*t*t+Math.abs(v)*spread*.21+Math.sin(t*20)*.012*Math.abs(v));uv.push(c/cols,t);if(r<rows&&c<cols){const i=r*(cols+1)+c;idx.push(i,i+cols+1,i+1,i+1,i+cols+1,i+cols+2);}}}const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(idx);geo.computeVertexNormals();const color=new THREE.Color().setHSL(.27+rand()*.035,.58+rand()*.16,.12+rand()*.075);const m=new THREE.MeshStandardMaterial({color,roughness:.64,side:THREE.DoubleSide});const leaf=new THREE.Mesh(geo,m);leaf.rotation.y=a;leaf.rotation.x=(j%3)*.07;leaf.castShadow=true;leaf.receiveShadow=true;group.add(leaf);const points=[];for(let r=0;r<=22;r++){const t=r/22;points.push(new THREE.Vector3(0,t*len-.27*t*t*len,lean*len*t*t-.006));}const vein=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:0x8ca64b,transparent:true,opacity:.48}));leaf.add(vein);}}
plant(-4.65,-1.6,3.5);plant(-1.85,-1.85,3.9);plant(.1,-1.95,3.15);plant(4.7,-1.65,3.6);plant(2.6,-1.85,3);plant(-5.2,1.05,1.7);plant(4.9,1.1,1.5);
prepareTextures(scene);
const waterFx=createAquariumWater({scene,renderer,camera});
const particlesGeo=new THREE.BufferGeometry(),particlesPos=[];for(let i=0;i<100;i++)particlesPos.push((rand()-.5)*11.5,.5+rand()*4.9,(rand()-.5)*4.8);particlesGeo.setAttribute('position',new THREE.Float32BufferAttribute(particlesPos,3));const particles=new THREE.Points(particlesGeo,new THREE.PointsMaterial({size:.018,color:0xd4ebd3,transparent:true,opacity:.25,depthWrite:false}));scene.add(particles);
const fish=[],fishShaders=[],pectoralFins=[];
const loader=new GLTFLoader();
loader.load('./assets/chousenbuna.glb',gltf=>{prepareTextures(gltf.scene);
  for(let i=0;i<3;i++){
    const root=gltf.scene.clone(true);root.scale.setScalar(25*(1-i*.055));
    root.traverse(o=>{
      if(!o.isMesh)return;o.castShadow=true;o.frustumCulled=false;
      const material=o.material.clone();material.roughness=.66;material.metalness=0;
      if(o.name==='Pectoral_port'||o.name==='Pectoral_starboard'){
        // Keep a thin fin membrane outside the flank, and open it away from the body.
        const side=o.name==='Pectoral_port'?1:-1;
        const joint=new THREE.Vector3(-.022,.0015,side*.0061);
        o.geometry=o.geometry.clone();
        const positions=o.geometry.attributes.position;
        for(let vertex=0;vertex<positions.count;vertex++){
          positions.setXYZ(vertex,positions.getX(vertex)-joint.x,positions.getY(vertex)-joint.y,(positions.getZ(vertex)-side*.0055)*.12);
        }
        positions.needsUpdate=true;o.geometry.computeVertexNormals();o.geometry.computeBoundingSphere();o.position.copy(joint);
        // The atlas contains opaque painted rays. A separate translucent membrane lets
        // the body's own stripes remain visible beneath the fin in every pose.
        material.map=null;material.color.set(0xb5cfc5);material.transparent=true;material.opacity=.32;
        material.depthWrite=false;material.side=THREE.DoubleSide;material.roughness=.48;
        const finBase=new THREE.Vector2();let baseCount=0,minX=Infinity;
        for(let vertex=0;vertex<positions.count;vertex++)minX=Math.min(minX,positions.getX(vertex));
        for(let vertex=0;vertex<positions.count;vertex++)if(positions.getX(vertex)<=minX+.0001){finBase.x+=positions.getX(vertex);finBase.y+=positions.getY(vertex);baseCount++;}
        finBase.divideScalar(baseCount);
        material.onBeforeCompile=shader=>{
          shader.uniforms.finBase={value:finBase};
          shader.vertexShader='uniform vec2 finBase; varying vec2 vFinPosition;\n'+shader.vertexShader;
          shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvFinPosition=position.xy-finBase;');
          shader.fragmentShader='varying vec2 vFinPosition;\n'+shader.fragmentShader;
          shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
            float rayAngle=atan(vFinPosition.y,vFinPosition.x);
            // Every ray shares the anatomical base, not the animation hinge.
            float rayWidth=max(fwidth(rayAngle)*35.,.10);
            float finRay=1.-smoothstep(.10,.10+rayWidth,abs(sin(rayAngle*35.)));
            diffuseColor.rgb*=.78+.34*finRay;
            diffuseColor.a*=.50+.50*finRay;
          `);
        };material.customProgramCacheKey=()=> 'radial-pectoral-v3';o.castShadow=false;
        pectoralFins.push({mesh:o,side,phase:i*2+(side<0?.7:0)});
      }else{
        material.onBeforeCompile=shader=>{
          shader.uniforms.swimTime={value:i*2};fishShaders.push({shader,phase:i*2});
          shader.vertexShader='uniform float swimTime; varying vec3 vFishPosition; varying vec3 vFishNormal;\n'+shader.vertexShader;
          shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>\nvFishPosition=position;vFishNormal=normal;float tailWeight=smoothstep(-0.012,0.039,position.x);transformed.z+=sin(swimTime*5.5-position.x*100.)*0.0038*tailWeight;`);
          if(o.name==='Body_continuous_skin'){
            shader.fragmentShader='varying vec3 vFishPosition; varying vec3 vFishNormal;\n'+shader.fragmentShader;
            shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
              // Reconstruct the baked blurred pectoral footprints using the intact
              // adjacent orange/turquoise bars in the same original body atlas.
              vec2 patchPoint=(vFishPosition.xy-vec2(-.0165,-.0015))/vec2(.0092,.0058);
              float patchMask=1.-smoothstep(.70,1.02,length(patchPoint));
              patchMask*=smoothstep(.35,.75,abs(normalize(vFishNormal).z));
              vec3 restoredPattern=texture2D(map,vec2(vMapUv.x-.2734375,vMapUv.y)).rgb;
              diffuseColor.rgb=mix(diffuseColor.rgb,restoredPattern*diffuse,patchMask);
            `);
          }
        };material.customProgramCacheKey=()=>o.name==='Body_continuous_skin'?'fish-body-pattern-v2':'fish-swim';
      }
      waterFx.applyTo(material);o.material=material;
    });scene.add(root);fish.push(root);
  }
  status.hidden=true;window.aquariumReady=true;
},undefined,error=>{status.textContent='魚を読み込めませんでした。再読み込みしてください。';console.error(error);window.aquariumShowError?.(error);});
let sim=0,last=performance.now();
function animate(now){
  requestAnimationFrame(animate);const dt=Math.min((now-last)/1000,.05);last=now;sim+=dt;
  fish.forEach((f,i)=>{const a=sim*(.16+i*.026)+i*2.094,rx=3.6-i*.35,rz=.62+i*.11;
    f.position.set(rx*Math.cos(a),2.65+i*.52+.35*Math.sin(a*1.6+i),1.05+rz*Math.sin(a));
    f.rotation.set(0,Math.atan2(rz*Math.cos(a),rx*Math.sin(a)),.035*Math.sin(a*2+i));
  });
  fishShaders.forEach(({shader,phase})=>shader.uniforms.swimTime.value=sim+phase);
  pectoralFins.forEach(({mesh,side,phase})=>{
    mesh.rotation.y=-side*(.08+.56*(.5+.5*Math.sin(sim*7.5+phase)));
    mesh.rotation.z=.06*Math.sin(sim*7.5+phase+.8);
    mesh.rotation.x=0;
  });
  plants.forEach((p,i)=>p.rotation.z=layoutEditor.editing?0:Math.sin(sim*.6+i)*.009);
  layoutEditor.update();controls.update();waterFx.update(sim);renderer.render(scene,camera);
}
requestAnimationFrame(animate);
new ResizeObserver(()=>{const w=host.clientWidth,h=host.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.zoom=Math.min(1.4,Math.max(.35,camera.aspect*.95));camera.updateProjectionMatrix();}).observe(host);
function view(name){controls.target.set(0,2.7,0);camera.position.copy({front:new THREE.Vector3(0,4.1,21),angle:new THREE.Vector3(12,8.2,18.5),top:new THREE.Vector3(0,23,.01)}[name]);controls.update();document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===name));}document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>view(b.dataset.view));document.querySelector('#reset').onclick=()=>view('angle');
function setStoneColors(colors){
  rocks.forEach((rock,index)=>rock.material=stoneMats[colors[index]]);
}
const layoutEditor=createLayoutEditor({scene,camera,renderer,controls,rocks,plants,view,setStoneColors});
document.querySelector('#fullscreen').onclick=async()=>{
  try{if(document.fullscreenElement)await document.exitFullscreen();else await document.querySelector('#viewer').requestFullscreen();}
  catch{document.querySelector('#fullscreen').title='このブラウザでは全画面表示を利用できません';}
};
window.aquariumInfo=()=>({fish:fish.length,pectoralFins:pectoralFins.length,rocks:rocks.length,plants:plants.length,editing:layoutEditor.editing,stoneColors:layoutEditor.colors,drawCalls:renderer.info.render.calls});




