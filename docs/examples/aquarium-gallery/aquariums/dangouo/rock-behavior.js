import * as THREE from './vendor/three.module.js';

// The local disc contact, in tank units. Its offset is from this model's
// actual GLB, not a generic fish's center or bounding box.
const DISC=new THREE.Vector3(-172,-135.7,0).multiplyScalar(.03/642*100/3);
const UP=new THREE.Vector3(0,1,0),DOWN=new THREE.Vector3(0,-1,0);
const smooth=t=>t*t*(3-2*t);
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const shortest=a=>Math.atan2(Math.sin(a),Math.cos(a));
export function createRockBehavior({getStones,seed=7391}){
  let randomSeed=seed,time=0;
  const fish=[],ray=new THREE.Raycaster(),normalMatrix=new THREE.Matrix3();
  function random(){randomSeed=(Math.imul(randomSeed,1664525)+1013904223)>>>0;return randomSeed/4294967296;}
  function stone(id){return getStones().find(s=>s.userData.id===id);}
  function contact(s,u,v,heading){
    if(!s)return null;s.updateWorldMatrix(true,true);
    const mesh=s.children[0],p=mesh.localToWorld(new THREE.Vector3(u,0,v));
    ray.set(new THREE.Vector3(p.x,12,p.z),DOWN);const hit=ray.intersectObject(mesh,false)[0];
    if(!hit)return null;
    const n=hit.face.normal.clone().applyMatrix3(normalMatrix.getNormalMatrix(mesh.matrixWorld)).normalize();
    if(n.y<.77)return null;
    const forward=new THREE.Vector3(-Math.cos(heading),0,Math.sin(heading));
    forward.addScaledVector(n,-forward.dot(n)).normalize();
    const x=forward.negate(),z=new THREE.Vector3().crossVectors(x,n).normalize();
    const q=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x,n,z));
    const pos=hit.point.clone().addScaledVector(n,.012).sub(DISC.clone().applyQuaternion(q));
    return {position:pos,quaternion:q,point:hit.point.clone(),normal:n};
  }
  function free(p,owner){
    for(const f of fish){if(f===owner)continue;
      const occupied=f.destination?.pose?.position||f.root.position;
      if(occupied.distanceTo(p)<1.08)return false;
      if(f.mode==='moving'&&f.root.position.distanceTo(p)<1.04)return false;
    }return true;
  }
  function reserve(owner,preferred=null,exclude=null){
    const stones=getStones().filter(s=>s.userData.id!==exclude);
    // Favor nearby stones, but retain a few candidate slots on each stone.
    stones.sort((a,b)=>{
      if(a.userData.id===preferred)return -1;if(b.userData.id===preferred)return 1;
      return a.position.distanceTo(owner.root.position)-b.position.distanceTo(owner.root.position);
    });
    for(const s of stones){
      const slots=[[0,.08],[.32,.12],[-.32,.12],[.12,.35],[-.10,-.32],[.42,-.14],[-.42,-.14],[0,.45],[0,-.45]];
      const offset=Math.floor(random()*slots.length);
      for(let i=0;i<slots.length;i++){
        const [u,v]=slots[(i+offset)%slots.length];
        const heading=(random()-.5)*1.2+(owner.index===2?.22:0);
        const pose=contact(s,u,v,heading);
        if(pose&&free(pose.position,owner))return {stoneId:s.userData.id,u,v,heading,pose};
      }
    }return null;
  }
  function dock(f,target,t,initial=false){
    f.mode='resting';f.anchor=target;f.destination=null;f.heading=target.heading;f.turnTarget=target.heading;
    f.nextTurn=t+8+random()*14;f.nextMove=t+(initial?40+f.index*27:55+random()*65);
    f.root.position.copy(target.pose.position);f.root.quaternion.copy(target.pose.quaternion);f.activity=.025;
  }
  function add(f){
    f.mode='unplaced';f.root.position.set(-3+f.index*3,1.4,2.0);
    // First arrivals reserve space before the next fish is placed.
    const target=reserve(f,['stone-3','stone-8','stone-6'][f.index]);
    if(!target)throw Error('No separated stone contact available for fish '+f.index);
    dock(f,target,0,true);fish.push(f);
  }
  function beginMove(f,t){
    const target=reserve(f,null,f.anchor.stoneId);
    if(!target){f.nextMove=t+12;return;}
    f.mode='moving';f.destination=target;f.departure=f.root.position.clone();f.departureQ=f.root.quaternion.clone();f.start=t;
    f.duration=3.6+Math.min(2.4,f.departure.distanceTo(target.pose.position)*.36);
  }
  function topAt(x,z){
    let y=.26;
    ray.set(new THREE.Vector3(x,12,z),DOWN);
    for(const s of getStones()){s.updateWorldMatrix(true,true);const hit=ray.intersectObject(s.children[0],false)[0];if(hit)y=Math.max(y,hit.point.y);}
    return y;
  }
  function update(t){
    const dt=Math.min(.12,Math.max(0,t-time));time=t;
    for(const f of fish){
      if(f.mode==='resting'){
        if(t>f.nextTurn){f.turnTarget=f.anchor.heading+(random()-.5)*.42;f.nextTurn=t+12+random()*18;}
        f.heading+=shortest(f.turnTarget-f.heading)*(1-Math.exp(-dt*.6));
        let pose=contact(stone(f.anchor.stoneId),f.anchor.u,f.anchor.v,f.heading);
        // Moving an occupied stone moves the attached fish with it. If two
        // edited stones overlap, find another separated contact instead.
        if(!pose||!free(pose.position,f)){
          const replacement=reserve(f,f.anchor.stoneId);if(replacement){dock(f,replacement,t);pose=replacement.pose;}
        }
        if(pose){f.anchor.pose=pose;f.root.position.copy(pose.position);f.root.quaternion.copy(pose.quaternion);}
        f.activity=.025;
        if(t>=f.nextMove)beginMove(f,t);
      }
      if(f.mode==='moving'){
        const d=f.destination;
        const fresh=contact(stone(d.stoneId),d.u,d.v,d.heading);
        if(fresh)d.pose=fresh;
        // Re-reserve if a user moves the landing rock into an occupied slot.
        if(!free(d.pose.position,f)){
          const replacement=reserve(f,null,f.anchor.stoneId);if(replacement)f.destination=replacement;
        }
        const end=f.destination.pose,u=clamp((t-f.start)/f.duration,0,1),e=smooth(u);
        const p=f.departure.clone().lerp(end.position,e);
        p.y+=.52*Math.sin(Math.PI*u);
        const clearance=.22+.24*smooth(clamp(u/.18,0,1))*smooth(clamp((1-u)/.18,0,1));
        p.y=Math.max(p.y,topAt(p.x,p.z)+clearance);
        // A transfer passing another fish glides above it, not through it.
        for(const other of fish){if(other===f)continue;const horizontal=Math.hypot(p.x-other.root.position.x,p.z-other.root.position.z);
          if(horizontal<.95&&u>.12&&u<.88)p.y=Math.max(p.y,other.root.position.y+Math.sqrt(1.05**2-horizontal**2));
        }
        const tangent=end.position.clone().sub(f.departure);tangent.y=.35*Math.cos(Math.PI*u);tangent.normalize();
        const travelQ=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(-1,0,0),tangent);
        const q=f.departureQ.clone().slerp(travelQ,smooth(clamp(u/.22,0,1)));
        q.slerp(end.quaternion,smooth(clamp((u-.72)/.28,0,1)));
        f.root.position.copy(p);f.root.quaternion.copy(q);
        f.activity=.18+.82*Math.sin(Math.PI*u);
        if(u>=1)dock(f,f.destination,t);
      }
    }
  }
  return {add,update,snapshot(){return fish.map(f=>({index:f.index,mode:f.mode,stoneId:f.anchor?.stoneId,destinationId:f.destination?.stoneId,position:f.root.position.toArray(),contact:f.mode==='resting'?f.anchor?.pose?.point.toArray():null,activity:f.activity}));}};
}
