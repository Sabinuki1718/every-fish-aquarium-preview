/* Fish Kit fin-control port (CC0), adapted to aquarium GLB morphs and -X heads.
   Source: fish-kit.js SWIM_BODY, finWhim, swim(), finMove(), flutter().
   Geometry, materials, breathing, gaze and ecology remain the model's own. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.FISHKIT_FINS=api;})(typeof window==='undefined'?globalThis:window,function(){
 'use strict';
 const TAU=2*Math.PI,clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),fract=x=>x-Math.floor(x);
 const hash=x=>fract(Math.sin(x*12.9898+4.1414)*43758.5453);
 const smooth=(a,b,x)=>{x=clamp((x-a)/(b-a),0,1);return x*x*(3-2*x);};
 function whim(id,t){const T=1.4+2.6*hash(id*17+.3),k=t/T+hash(id*5+1.7)*9,seg=Math.floor(k);
  const value=s=>hash(s*3.7+id*11)<.45?0:-.6+1.6*hash(s*1.3+id*23+5);
  const m=smooth(0,.2+.7*hash(id*7+seg),fract(k)*T);return value(seg-1)*(1-m)+value(seg)*m;}
 function rotate(v,axis,angle){const l=Math.hypot(...axis),a=axis.map(x=>x/l),c=Math.cos(angle),s=Math.sin(angle),d=v[0]*a[0]+v[1]*a[1]+v[2]*a[2];return [v[0]*c+(a[1]*v[2]-a[2]*v[1])*s+a[0]*d*(1-c),v[1]*c+(a[2]*v[0]-a[0]*v[2])*s+a[1]*d*(1-c),v[2]*c+(a[0]*v[1]-a[1]*v[0])*s+a[2]*d*(1-c)];}
 function sample(p,data,base,aux,pose,L){
  const [kind,gate,id]=data,[fw,along,h]=aux;if(kind<.5||gate<=0)return p.slice();
  const {clock:t,flap,flow,steer,seed,puffer=false,resident=false}=pose,slow=1-flow;
  const side=base[2]<0?-1:1;let q=p.slice();
  if(kind===4){
   const phase=.2+.3*hash(side*3.1+seed*7);
   let angle=.03+.08*slow+.22*slow*(.5-.5*Math.cos(TAU*flap-fw*.9));
   angle+=.10+.04*slow+.08*.36*Math.sin(TAU*(phase*t+(side>0?.2:.7)));
   angle-=.18*.45*whim((side>0?.13:.57)+seed*3.1,t);
   angle=clamp(angle,0,.53);const ray=p.map((x,k)=>x-base[k]);const r=rotate(ray,[-.2,-1,0],side*fw*angle);q=r.map((x,k)=>x+base[k]);
  }else if(kind===5){
   const angle=clamp(.05+.17*slow+.04*Math.sin(4.4*t+seed),0,.30);
   const r=rotate(p.map((x,k)=>x-base[k]),[1,0,0],-side*fw*angle);q=r.map((x,k)=>x+base[k]);
  }else if(kind===1||kind===2){
   const mph=TAU*((.35+.45*hash(id*5+seed*11))*t+hash(id*3+seed*5));
   const fph=TAU*((.2+.4*hash(id*9+seed*13))*t+hash(id*4+seed*3));
   let fold=(puffer?.035:.08+.28*flow)+.10*(.7*Math.sin(fph)+.3*Math.sin(2.6*fph+.8))+.14*whim(id+seed*3.1,t);
   fold=clamp(fold,0,.65)*.65*gate;
   const tilt=Math.sign(h)*((puffer?.24:(resident?.075:.11))*(Math.sin(mph)+.5*Math.sin(2.3*mph+1.1))+steer*.12)*gate;
   q=[p[0]+Math.abs(h)*Math.sin(fold),base[1]+h*Math.cos(fold)*Math.cos(tilt),p[2]+h*Math.cos(fold)*Math.sin(tilt)];
  }
  const progress=p[0]/L,arg=TAU*(2.5*t-progress*2.5-p[1]/L*1.5);
  const fine=L*.008*(1+.4*flow)*.7*Math.pow(gate,1.5)*(kind===4?.1:1);
  let flutter=fine*(Math.sin(arg)+.35*Math.sin(1.7*arg+1.3));
  const fid=kind===4?(side>0?.31:.77):id;
  if(fid>=0){const hz=1.1+1.2*hash(fid*13+seed*31),phase=TAU*(hz*t+hash(fid*7+seed*17+3)-along*.8-gate*.3),w=gate*(.35+.65*along);
   const flag=L*.035*(.6+.7*flow)*.60*w*w*(kind===4?.6:1)*(puffer&&kind!==4?1.25:1);
   flutter+=flag*(Math.sin(phase)+.45*Math.sin(1.73*phase+2.1+TAU*.37*t));}
  const reach=Math.max(Math.hypot(...p.map((x,k)=>x-base[k])),L*.003);flutter=clamp(flutter,-reach*.24,reach*.24);
  q[2]+=kind===4?side*flutter:flutter;
  if(kind===4||kind===5)q[2]=side*Math.max(side*q[2],side*p[2]);
  const gain=pose.gain===undefined?1:pose.gain;return q.map((v,k)=>p[k]+(v-p[k])*gain);
 }
 const glsl=`
attribute vec3 _fk_data, _fk_base, _fk_aux;
uniform float fkLength, fkPuffer, fkGain;
#ifdef USE_INSTANCING
attribute vec4 fkMotion, fkMood;
#else
uniform vec4 fkMotion, fkMood;
#endif
float fkHash(float n){return fract(sin(n*12.9898+4.1414)*43758.5453);}
float fkValue(float id,float seg){if(fkHash(seg*3.7+id*11.)<.45)return 0.;return mix(-.6,1.,fkHash(seg*1.3+id*23.+5.));}
float fkWhim(float id,float t){float T=1.4+2.6*fkHash(id*17.+.3),k=t/T+fkHash(id*5.+1.7)*9.,seg=floor(k);return mix(fkValue(id,seg-1.),fkValue(id,seg),smoothstep(0.,.2+.7*fkHash(id*7.+seg),fract(k)*T));}
vec3 fkRotate(vec3 v,vec3 axis,float a){axis=normalize(axis);return v*cos(a)+cross(axis,v)*sin(a)+axis*dot(axis,v)*(1.-cos(a));}
vec3 fkDeform(vec3 p){
 float kind=_fk_data.x,g=_fk_data.y,id=_fk_data.z,fw=_fk_aux.x,along=_fk_aux.y,h=_fk_aux.z,L=fkLength;
 if(kind<.5||g<=0.)return p;
 float t=fkMotion.x,flap=fkMotion.y,flow=fkMotion.z,steer=fkMotion.w,seed=fkMood.x,slow=1.-flow,sd=_fk_base.z<0.?-1.:1.;vec3 q=p;
 if(kind==4.){
  float phase=mix(.2,.5,fkHash(sd*3.1+seed*7.));
  float angle=.03+.08*slow+.22*slow*(.5-.5*cos(6.2831853*flap-fw*.9));
  angle+=.10+.04*slow+.08*.36*sin(6.2831853*(phase*t+(sd>0.?.2:.7)));
  angle-=.18*.45*fkWhim((sd>0.?.13:.57)+seed*3.1,t);
  q=_fk_base+fkRotate(p-_fk_base,vec3(-.2,-1.,0.),sd*fw*clamp(angle,0.,.53));
 }else if(kind==5.){
  float angle=clamp(.05+.17*slow+.04*sin(4.4*t+seed),0.,.30);
  q=_fk_base+fkRotate(p-_fk_base,vec3(1.,0.,0.),-sd*fw*angle);
 }else if(kind==1.||kind==2.){
  float mph=6.2831853*(mix(.35,.8,fkHash(id*5.+seed*11.))*t+fkHash(id*3.+seed*5.));
  float fph=6.2831853*(mix(.2,.6,fkHash(id*9.+seed*13.))*t+fkHash(id*4.+seed*3.));
  float fold=(fkPuffer>.5?.035:.08+.28*flow)+.10*(.7*sin(fph)+.3*sin(2.6*fph+.8))+.14*fkWhim(id+seed*3.1,t);
  fold=clamp(fold,0.,.65)*.65*g;
  float strength=fkPuffer>.5?.24:(fkMood.y>.5?.075:.11);
  float tilt=sign(h)*(strength*(sin(mph)+.5*sin(2.3*mph+1.1))+steer*.12)*g;
  q=vec3(p.x+abs(h)*sin(fold),_fk_base.y+h*cos(fold)*cos(tilt),p.z+h*cos(fold)*sin(tilt));
 }
 float arg=6.2831853*(2.5*t-p.x/L*2.5-p.y/L*1.5);
 float fine=L*.008*(1.+.4*flow)*.7*pow(g,1.5)*(kind==4.?.1:1.);
 float ripple=fine*(sin(arg)+.35*sin(1.7*arg+1.3));
 float fid=kind==4.?(sd>0.?.31:.77):id;
 if(fid>=0.){
  float hz=mix(1.1,2.3,fkHash(fid*13.+seed*31.));
  float ph=6.2831853*(hz*t+fkHash(fid*7.+seed*17.+3.)-along*.8-g*.3),W=g*(.35+.65*along);
  float flag=L*.035*(.6+.7*flow)*.60*W*W*(kind==4.?.6:1.)*((fkPuffer>.5&&kind!=4.)?1.25:1.);
  ripple+=flag*(sin(ph)+.45*sin(1.73*ph+2.1+6.2831853*.37*t));
 }
 float reach=max(length(p-_fk_base),L*.003);ripple=clamp(ripple,-reach*.24,reach*.24);
 q.z+=kind==4.?sd*ripple:ripple;
 if(kind==4.||kind==5.)q.z=sd*max(sd*q.z,sd*p.z);
 return mix(p,q,fkGain);
}
`;
 function bindBatch(batch,source){
  const spec=source.userData.fishkitFin;if(!spec)return;
  const T=rootThree(),material=source.material.clone(),prior=source.material.onBeforeCompile;
  material.onBeforeCompile=function(shader,renderer){if(prior)prior.call(this,shader,renderer);
   shader.uniforms.fkLength={value:spec.length};shader.uniforms.fkPuffer={value:spec.puffer?1:0};shader.uniforms.fkGain={value:spec.gain};
   shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\n'+glsl).replace('#include <morphtarget_vertex>','#include <morphtarget_vertex>\ntransformed += fkDeform(position)-position;');
   this.userData.fkCompiled=true;
  };
  material.customProgramCacheKey=()=> 'aquarium-fishkit-fins-v5';
  batch.material=material;
  batch.geometry.setAttribute('fkMotion',new T.InstancedBufferAttribute(new Float32Array(batch.count*4),4).setUsage(T.DynamicDrawUsage));
  batch.geometry.setAttribute('fkMood',new T.InstancedBufferAttribute(new Float32Array(batch.count*4),4).setUsage(T.DynamicDrawUsage));
  batch.userData.fishkitFin=spec;
 }
 function rootThree(){return typeof window==='undefined'?null:window.THREE;}
 function prepare(gltf){
  const T=rootThree(),map=new Map();gltf.scene.traverse(mesh=>{const spec=mesh.userData.fishkitFin;if(!mesh.isMesh||!spec)return;
   const old=mesh.morphTargetInfluences.length,keep=[0,1];if(spec.puffer)keep.push(old-1);
   for(const key of Object.keys(mesh.geometry.morphAttributes))mesh.geometry.morphAttributes[key]=keep.map(i=>mesh.geometry.morphAttributes[key][i]).filter(Boolean);
   mesh.morphTargetInfluences=keep.map(i=>mesh.morphTargetInfluences[i]);mesh.morphTargetDictionary={body_positive:0,body_negative:1};if(spec.puffer)mesh.morphTargetDictionary.inflate=2;
   spec.runtimeTrimmed=true;map.set(mesh.name,{keep,old,matched:0});
  });
  gltf.animations=gltf.animations.map(clip=>{const tracks=clip.tracks.map(track=>{
   const match=track.name.match(/^(.*)\.morphTargetInfluences$/),spec=match&&map.get(match[1]);if(!spec)return track;
   if(track.getValueSize()!==spec.old)throw new Error('Unexpected fin animation width: '+track.name);
   const values=new Float32Array(track.times.length*spec.keep.length);
   for(let i=0;i<track.times.length;i++)spec.keep.forEach((k,j)=>values[i*spec.keep.length+j]=track.values[i*spec.old+k]);
   spec.matched++;return new T.NumberKeyframeTrack(track.name,track.times.slice(),values,track.getInterpolation());
  });return new T.AnimationClip(clip.name,clip.duration,tracks);});
  for(const [name,spec]of map)if(!spec.matched)throw new Error('Fin animation track missing: '+name);
  return gltf;
 }
 function individual(o,dt,resident){
  const T=rootThree();if(!o.finState)o.finState={clock:o.phase*2.7,flap:o.phase*.61,flow:.3,turn:0,previous:o.position.clone(),yaw:o.yaw,seed:fract(o.phase*.731+o.f.id.length*.127)};
  const s=o.finState,L=o.f.display_length_m,speed=o.position.distanceTo(s.previous)/Math.max(dt,.001);
  const target=resident?.02:clamp(speed/Math.max(L*3,.05),0,1),gain=1-Math.exp(-dt*3);
  s.flow+=(target-s.flow)*gain;const turn=T.MathUtils.euclideanModulo(o.yaw-s.yaw+Math.PI,Math.PI*2)-Math.PI;s.turn+=(clamp(turn/Math.max(dt,.001)*.12,-.3,.3)-s.turn)*gain;
  s.clock+=dt*(1+.6*s.flow);s.flap+=dt*(resident?.27:.60+.22*s.flow);s.resident=resident;s.previous.copy(o.position);s.yaw=o.yaw;
  for(const mesh of o.meshes){const spec=mesh.userData.fishkitFin;if(spec&&!spec.runtimeTrimmed&&mesh.morphTargetInfluences)for(let j=spec.poseStart;j<spec.poseStart+spec.poseCount;j++)mesh.morphTargetInfluences[j]=0;}
 }
 function updateBatch(batch){if(!batch.userData.fishkitFin)return;const a=batch.geometry.getAttribute('fkMotion'),b=batch.geometry.getAttribute('fkMood');
  batch.userData.individuals.forEach((o,i)=>{const s=o.finState;a.setXYZW(i,s.clock,s.flap,s.flow,s.turn);b.setXYZW(i,s.seed,s.resident?1:0,0,0);});a.needsUpdate=b.needsUpdate=true;
 }
 return {revision:5,hash,whim,sample,glsl,prepare,bindBatch,individual,updateBatch};
});
