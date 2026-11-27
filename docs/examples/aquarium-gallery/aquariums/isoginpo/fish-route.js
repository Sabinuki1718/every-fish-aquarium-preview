import {createSwimArc} from './swim-path.js';

// Level routes stay level, rather than getting a decorative vertical arc.
export function createFishRoute(start,yaw,kind,perches,surfaceHeight,random=Math.random){
  const inside=p=>Math.abs(p.x)<=5.0&&Math.abs(p.z)<=2.05;
  if(kind!=='relocate'){
    for(let attempt=0;attempt<24;attempt++){
      const angle=yaw+(random()-.5)*(attempt<6?1.4:Math.PI*2);
      const distance=kind==='short'?.35+random()*.7:1+random()*1.7;
      const end={x:start.x-Math.cos(angle)*distance,y:start.y,z:start.z+Math.sin(angle)*distance};
      if(!inside(end))continue;
      let clear=true;
      for(let n=0;n<=20&&clear;n++){
        const v=n/20,x=start.x+(end.x-start.x)*v,z=start.z+(end.z-start.z)*v;
        for(const offset of [-.16,0,.16]){
          if(surfaceHeight(x+Math.sin(angle)*offset,z+Math.cos(angle)*offset)>start.y-.29){clear=false;break;}
        }
      }
      if(clear)return {start:{...start},end,lift:0,kind};
    }
  }
  // If a straight route is blocked, choose another perch or an open sand patch.
  let end;
  for(let attempt=0;attempt<20;attempt++){
    const target=perches[Math.floor(random()*perches.length)];
    end=random()<.55?{x:target.x+(random()-.5)*.3,z:target.z+(random()-.5)*.3}:{x:(random()-.5)*8.7,z:1.1+random()*.85};
    end.y=surfaceHeight(end.x,end.z)+.34;
    if(inside(end)&&Math.hypot(end.x-start.x,end.z-start.z)>.85)break;
  }
  // A close destination still has horizontal travel when the layout is crowded.
  if(Math.hypot(end.x-start.x,end.z-start.z)<.1){end.x=start.x>0?start.x-.6:start.x+.6;end.y=surfaceHeight(end.x,end.z)+.34;}
  end.x=Math.max(-5,Math.min(5,end.x));end.z=Math.max(-2.05,Math.min(2.05,end.z));
  end.y=surfaceHeight(end.x,end.z)+.34;
  return {...createSwimArc(start,end,Math.max(start.y,end.y)+.35+random()*.8,surfaceHeight),kind:'relocate'};
}

