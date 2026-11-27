import {createLightWater} from './water-lite.js';
import * as THREE from './vendor/three.module.js';
import {Reflector} from './vendor/Reflector.js';

// One continuous height field drives both the geometry and its optical normal.
const waves=`
uniform float waterTime;
float waterHeight(vec2 p){
  float h=.017*sin(dot(p,vec2(.82,.57))*2.7-waterTime*1.35);
  h+=.008*sin(dot(p,vec2(-.46,.89))*5.9-waterTime*1.92);
  h+=.0028*sin(dot(p,vec2(.24,-.97))*13.1+waterTime*2.5);
  h+=.0009*sin(dot(p,vec2(.94,.33))*32.7-waterTime*3.7);
  h+=.00035*sin(dot(p,vec2(-.72,.69))*63.0+waterTime*4.4);
  float edge=min(6.-abs(p.x),4.0-abs(p.y));
  return h*smoothstep(.015,.22,edge)+.028*exp(-max(edge,0.)*40.);
}
`;

export function createAquariumWater({scene,renderer,camera,level=7.333333}){
  if(renderer.aquariumLightMode)return createLightWater({scene,level,depth:8});
  const time={value:0};
  const refractedCamera=new THREE.PerspectiveCamera();
  const refractionMatrix=new THREE.Matrix4();
  const waterCenter=new THREE.Vector3(0,level,0);
  const type=renderer.extensions.has('EXT_color_buffer_float')?THREE.HalfFloatType:THREE.UnsignedByteType;
  const refraction=new THREE.WebGLRenderTarget(1,1,{type,depthBuffer:true,samples:2});
  refraction.depthTexture=new THREE.DepthTexture(1,1,THREE.UnsignedIntType);
  const shader={
    name:'AquariumWater',
    uniforms:{color:{value:new THREE.Color()},tDiffuse:{value:null},textureMatrix:{value:new THREE.Matrix4()},
      waterTime:time,tRefraction:{value:null},tDepth:{value:null},
      inverseProjection:{value:new THREE.Matrix4()},cameraWorld:{value:new THREE.Matrix4()},
      refractionMatrix:{value:new THREE.Matrix4()},refractionEye:{value:new THREE.Vector3()},
      surfaceLevel:{value:level},pixelSize:{value:new THREE.Vector2(1,1)}},
    vertexShader:`${waves}
      uniform mat4 textureMatrix,refractionMatrix;
      varying vec3 vWaterWorld;
      varying vec4 vReflection;
      varying vec4 vScreen,vRefraction;
      void main(){
        vec4 local=vec4(position,1.);
        vec4 world=modelMatrix*local;
        float wave=waterHeight(world.xz);
        local.z+=wave;world.y+=wave;
        vWaterWorld=world.xyz;
        vReflection=textureMatrix*local;
        vRefraction=refractionMatrix*world;
        vScreen=projectionMatrix*viewMatrix*world;
        gl_Position=vScreen;
      }`,
    fragmentShader:`${waves}
      uniform sampler2D tDiffuse,tRefraction,tDepth;
      uniform mat4 inverseProjection,cameraWorld;
      uniform vec3 refractionEye;
      uniform float surfaceLevel;
      uniform vec2 pixelSize;
      varying vec3 vWaterWorld;
      varying vec4 vReflection,vScreen,vRefraction;
      vec3 scenePosition(vec2 uv,float depth){
        vec4 q=inverseProjection*vec4(uv*2.-1.,depth*2.-1.,1.);
        return (cameraWorld*vec4(q.xyz/q.w,1.)).xyz;
      }
      void main(){
        vec2 p=vWaterWorld.xz;
        float e=.004;
        vec3 n=normalize(vec3(-(waterHeight(p+vec2(e,0.))-waterHeight(p-vec2(e,0.)))/(2.*e),
          1.,-(waterHeight(p+vec2(0.,e))-waterHeight(p-vec2(0.,e)))/(2.*e)));
        vec3 eye=normalize(cameraPosition-vWaterWorld);
        bool below=cameraPosition.y<surfaceLevel;
        if(below)n=-n;
        float facing=clamp(dot(n,eye),.001,1.);
        float fresnel=.02037+.97963*pow(1.-facing,5.);
        if(below&&facing<.6614)fresnel=1.;
        vec2 screenUv=vRefraction.xy/vRefraction.w*.5+.5;
        vec3 nView=mat3(viewMatrix)*n;
        vec2 distort=nView.xy*.018/clamp(abs(vScreen.w)*.13,.65,4.);
        vec2 refractUv=clamp(screenUv+distort,pixelSize,1.-pixelSize);
        float depth=texture2D(tDepth,refractUv).r;
        vec3 hit=scenePosition(refractUv,depth);
        // Reject distortion into a nearer foreground object.
        if(depth<1.&&length(hit-refractionEye)<length(vWaterWorld-refractionEye)-.03){
          refractUv=screenUv;depth=texture2D(tDepth,refractUv).r;hit=scenePosition(refractUv,depth);
        }
        float distanceInWater=depth<.99999?min(length(hit-vWaterWorld),14.):4.;
        vec3 transmission=exp(-vec3(.016,.006,.004)*distanceInWater);
        vec3 refracted=texture2D(tRefraction,refractUv).rgb;
        refracted=refracted*transmission+vec3(.018,.045,.035)*(1.-transmission);
        vec2 reflectUv=vReflection.xy/vReflection.w+n.xz*.035;
        vec3 reflected=texture2D(tDiffuse,clamp(reflectUv,pixelSize,1.-pixelSize)).rgb;
        // A restrained soft specular lobe, matching the aquarium's overhead light.
        vec3 light=normalize(vec3(-.25,1.,.35));
        float glint=pow(max(0.,dot(n,normalize(light+eye))),750.);
        vec3 waterColor=mix(refracted,reflected,fresnel)+vec3(1.2,1.35,1.3)*glint*.08;
        gl_FragColor=vec4(max(waterColor,vec3(0.)),1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  };
  const surface=new Reflector(new THREE.PlaneGeometry(12,8,120,80),{
    textureWidth:1024,textureHeight:1024,clipBias:.0007,multisample:0,shader,
  });
  surface.rotation.x=-Math.PI/2;surface.position.y=level;
  surface.material.side=THREE.DoubleSide;
  surface.material.uniforms.waterTime=time;
  surface.material.uniforms.tRefraction.value=refraction.texture;
  surface.material.uniforms.tDepth.value=refraction.depthTexture;
  surface.camera.layers.enable(1);
  surface.getRenderTarget().texture.type=type;
  scene.add(surface);

  // These physical ceiling strips appear only in the water's reflection pass.
  for(const [z,width,strength] of [[-.9,.11,3.4],[1.15,.18,2.2]]){
    const light=new THREE.Mesh(new THREE.PlaneGeometry(8.8,width),new THREE.ShaderMaterial({
      side:THREE.DoubleSide,transparent:true,depthWrite:false,
      uniforms:{strength:{value:strength}},
      vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader:`uniform float strength;varying vec2 vUv;void main(){
        float a=smoothstep(0.,.07,vUv.x)*smoothstep(0.,.07,1.-vUv.x);
        a*=smoothstep(0.,.22,vUv.y)*smoothstep(0.,.22,1.-vUv.y);
        gl_FragColor=vec4(vec3(.9,1.,.96)*strength,a);
      }`,
    }));
    light.position.set(0,9,z);light.rotation.x=Math.PI/2;light.layers.set(1);scene.add(light);
  }

  const softbox=new THREE.Mesh(new THREE.PlaneGeometry(16,8),new THREE.ShaderMaterial({
    transparent:true,depthWrite:false,side:THREE.DoubleSide,
    vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader:`varying vec2 vUv;void main(){
      vec2 q=abs(vUv-.5)*2.;float fade=1.-smoothstep(.45,1.,max(q.x,q.y));
      gl_FragColor=vec4(vec3(1.15,1.3,1.22),fade*.65);
    }`,
  }));
  softbox.position.set(-22,9.2,-30);softbox.lookAt(0,level,0);softbox.layers.set(1);scene.add(softbox);

  // Clear, curved contact meniscus at the tank walls, without foam or ocean surf.
  const rimGeometry=new THREE.BufferGeometry();
  const vertices=[];
  for(let i=0;i<4;i++)for(let j=0;j<=80;j++){
    const t=j/80;
    const x=i===0?-6+12*t:i===1?6:i===2?6-12*t:-6;
    const z=i===0?-4.0:i===1?-4.0+8.0*t:i===2?4.0:4.0-8.0*t;
    vertices.push(x,level+.027,z);
  }
  rimGeometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  const rim=new THREE.LineLoop(rimGeometry,new THREE.LineBasicMaterial({color:0xb3dbce,transparent:true,opacity:.32,depthWrite:false}));
  scene.add(rim);

  const patched=new WeakSet();
  function applyTo(material){
    if(!material?.isMeshStandardMaterial||material.transparent||patched.has(material))return;
    patched.add(material);
    const previous=material.onBeforeCompile,oldKey=material.customProgramCacheKey;
    // Evaluate the previous cache key before replacing onBeforeCompile.
    const key=oldKey.call(material);
    material.onBeforeCompile=function(shader,render){
      previous.call(this,shader,render);shader.uniforms.aquariumTime=time;
      shader.vertexShader='varying vec3 vAquariumWorld,vAquariumNormal;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <worldpos_vertex>',`#include <worldpos_vertex>
        vec4 aquariumLocal=vec4(transformed,1.);
        #ifdef USE_INSTANCING
          aquariumLocal=instanceMatrix*aquariumLocal;
        #endif
        vAquariumWorld=(modelMatrix*aquariumLocal).xyz;
        vAquariumNormal=normalize(transformedNormal*mat3(viewMatrix));
      `);
      shader.fragmentShader=`uniform float aquariumTime;varying vec3 vAquariumWorld,vAquariumNormal;
        float caustic(vec2 p){
          p+=.24*vec2(sin(p.y*2.1+aquariumTime*.46),cos(p.x*1.8-aquariumTime*.39));
          float f=sin(p.x*4.2+sin(p.y*2.8+aquariumTime*.5))+sin(p.y*4.6+sin(p.x*2.4-aquariumTime*.42));
          return pow(max(0.,1.-abs(f)*2.6),8.);
        }\n`+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
        if(vAquariumWorld.y>.12&&vAquariumWorld.y<7.333333&&abs(vAquariumWorld.x)<6.01&&abs(vAquariumWorld.z)<4.05){
          vec3 nWater=normalize(vAquariumNormal);
          float causticLight=caustic((vAquariumWorld.xz+vAquariumWorld.y*vec2(.20,.08))*1.75);
          float strength=(.15+.85*max(0.,nWater.y))*.15;
          outgoingLight+=vec3(.78,1.,.88)*causticLight*strength*(.22+.78*diffuseColor.rgb);
          vec3 dir=normalize(cameraPosition-vAquariumWorld);
          vec3 wall=vec3(dir.x>0.?6.:-6.,dir.y>0.?7.333333:.12,dir.z>0.?4.01:-4.01);
          vec3 travel=(wall-vAquariumWorld)/vec3(abs(dir.x)<.0001?.0001:dir.x,abs(dir.y)<.0001?.0001:dir.y,abs(dir.z)<.0001?.0001:dir.z);
          float path=min(length(cameraPosition-vAquariumWorld),max(0.,min(travel.x,min(travel.y,travel.z))));
          vec3 absorption=exp(-vec3(.012,.005,.003)*path);
          outgoingLight=outgoingLight*absorption+vec3(.012,.026,.020)*(1.-absorption);
        }
        #include <opaque_fragment>
      `);
    };
    material.customProgramCacheKey=()=>key+'|aquarium-caustics-v1';material.needsUpdate=true;
  }
  scene.traverse(object=>{if(object.isMesh){const mats=Array.isArray(object.material)?object.material:[object.material];mats.forEach(applyTo);}});

  let width=0,height=0;
  const clearColor=new THREE.Color();
  function update(t){
    time.value=t;
    const size=renderer.getDrawingBufferSize(new THREE.Vector2());
    const scale=Math.min(1,1440/size.x,1440/size.y);
    const w=Math.max(1,Math.round(size.x*scale)),h=Math.max(1,Math.round(size.y*scale));
    if(w!==width||h!==height){refraction.setSize(w,h);width=w;height=h;}
    surface.material.uniforms.pixelSize.value.set(1/w,1/h);
    camera.updateMatrixWorld();
    // Virtual optical viewpoint: central ray follows Snell's law at air/water.
    // Projective sampling preserves the water plane while the submerged scene bends.
    refractedCamera.position.copy(camera.position);refractedCamera.up.copy(camera.up);
    if(camera.position.y>level){
      const h=camera.position.y-level,r2=camera.position.x**2+camera.position.z**2;
      refractedCamera.position.y=level+Math.sqrt(1.333**2*h*h+(1.333**2-1)*r2);
      refractedCamera.lookAt(waterCenter);
    }else refractedCamera.quaternion.copy(camera.quaternion);
    refractedCamera.near=camera.near;refractedCamera.far=camera.far;
    refractedCamera.projectionMatrix.copy(camera.projectionMatrix);
    refractedCamera.projectionMatrixInverse.copy(refractedCamera.projectionMatrix).invert();
    refractedCamera.updateMatrixWorld();
    refractionMatrix.multiplyMatrices(refractedCamera.projectionMatrix,refractedCamera.matrixWorldInverse);
    surface.material.uniforms.refractionMatrix.value.copy(refractionMatrix);
    surface.material.uniforms.refractionEye.value.copy(refractedCamera.position);
    surface.material.uniforms.inverseProjection.value.copy(refractedCamera.projectionMatrixInverse);
    surface.material.uniforms.cameraWorld.value.copy(refractedCamera.matrixWorld);
    const target=renderer.getRenderTarget(),shadow=renderer.shadowMap.autoUpdate;
    const alpha=renderer.getClearAlpha();renderer.getClearColor(clearColor);
    const overlays=[];scene.traverse(object=>{if(object.type==='BoxHelper'&&object.visible){overlays.push(object);object.visible=false;}});
    surface.visible=false;rim.visible=false;renderer.shadowMap.autoUpdate=false;
    try{
      renderer.setClearColor(0x0c1712,1);renderer.setRenderTarget(refraction);renderer.clear();renderer.render(scene,refractedCamera);
    }finally{
      renderer.setRenderTarget(target);renderer.setClearColor(clearColor,alpha);
      renderer.shadowMap.autoUpdate=shadow;surface.visible=true;rim.visible=true;overlays.forEach(object=>object.visible=true);
    }
  }
  return {update,applyTo,surface};
}



