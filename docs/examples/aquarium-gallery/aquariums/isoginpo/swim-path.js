// A continuous horizontal advance accompanies both ascent and descent.
// Water level 6.7: reserve room for the entire tilted fish, fins and wave troughs.
export const SWIM_CEILING=5.55;
export function createSwimArc(start,end,clearance,surfaceHeight){
  start={...start,y:Math.min(start.y,SWIM_CEILING)};
  end={...end,y:Math.min(end.y,SWIM_CEILING)};
  let lift=Math.max(.25,clearance-(start.y+end.y)*.5);
  for(let n=1;n<80;n++){
    const v=n/80,x=start.x+(end.x-start.x)*v,z=start.z+(end.z-start.z)*v;
    const baseline=start.y+(end.y-start.y)*v;
    lift=Math.max(lift,(surfaceHeight(x,z)+.37-baseline)/(4*v*(1-v)));
  }
  return {start:{...start},end:{...end},lift};
}

export function sampleSwimArc(path,v){
  const {start:a,end:b,lift}=path,dx=b.x-a.x,dz=b.z-a.z;
  let y=a.y+(b.y-a.y)*v+4*lift*v*(1-v),slope=b.y-a.y+4*lift*(1-2*v);
  const ceiling=SWIM_CEILING,shoulder=Math.min(ceiling,Math.max(a.y,b.y,ceiling-.4));
  // Smoothly flatten excessive arcs; retain horizontal travel and the endpoints.
  if(lift>0&&y>shoulder&&shoulder<ceiling){
    const room=ceiling-shoulder,excess=y-shoulder,ratio=room/(room+excess);
    y=shoulder+room*(1-ratio);slope*=ratio*ratio;
  }
  if(y>ceiling){y=ceiling;slope=0;}
  return {x:a.x+dx*v,y,z:a.z+dz*v,
    pitch:-Math.atan2(slope,Math.hypot(dx,dz))};
}

