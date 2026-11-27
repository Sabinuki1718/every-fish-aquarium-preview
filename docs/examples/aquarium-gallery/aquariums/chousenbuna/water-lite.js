import * as THREE from './vendor/three.module.js';

// Transparent, animated water with a Fresnel sheen. No reflection framebuffer,
// floating-point render target, multisampling or depth-texture pass is required.
export function createLightWater({scene,level,depth}){
  const time={value:0};
  const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,
    uniforms:{waterTime:time},
    vertexShader:`uniform float waterTime;varying vec3 waterWorld;
      void main(){vec3 p=position;p.z+=.013*sin(p.x*2.4+waterTime)+.006*sin(p.y*5.-waterTime*1.5);
      vec4 world=modelMatrix*vec4(p,1.);waterWorld=world.xyz;gl_Position=projectionMatrix*viewMatrix*world;}`,
    fragmentShader:`varying vec3 waterWorld;uniform float waterTime;
      void main(){vec2 p=waterWorld.xz;vec3 n=normalize(vec3(.035*cos(p.x*2.4+waterTime),1.,.025*cos(p.y*5.-waterTime*1.5)));
      vec3 eye=normalize(cameraPosition-waterWorld);float fresnel=pow(1.-abs(dot(n,eye)),4.);
      float shine=pow(max(0.,dot(reflect(-normalize(vec3(-.3,1.,.4)),n),eye)),80.);
      gl_FragColor=vec4(mix(vec3(.08,.19,.20),vec3(.6,.76,.77),fresnel)+vec3(shine*.35),.025+fresnel*.20+shine*.10);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`
  });
  const surface=new THREE.Mesh(new THREE.PlaneGeometry(12,depth,48,24),material);
  surface.rotation.x=-Math.PI/2;surface.position.y=level;surface.renderOrder=2;scene.add(surface);
  const points=[[-6,level+.02,-depth/2],[6,level+.02,-depth/2],[6,level+.02,depth/2],[-6,level+.02,depth/2]].map(p=>new THREE.Vector3(...p));
  scene.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:0xa8d6d2,transparent:true,opacity:.35})));
  return {surface,update(t){time.value=t;},applyTo(){}};
}

