// Each fish draws a new delay after every arrival, independently of its peers.
export function createFishBehavior(position=0,random=Math.random){
  return {mode:'rest',position,started:0,duration:2+random()*18,random,kind:'level',serial:0};
}

export function advanceFishBehavior(state,now){
  if(now>=state.started+state.duration){
    if(state.mode==='rest'){
      const choice=state.random();
      state.kind=choice<.45?'level':choice<.75?'short':'relocate';
      state.mode='move';state.serial++;
      state.duration=state.kind==='short'?1.5+state.random()*1.8:state.kind==='level'?3+state.random()*3.5:3.8+state.random()*4.6;
    }else{
      state.position=1-state.position;state.mode='rest';
      state.duration=6+state.random()*30;
    }
    // Resume from the current time after a suspended tab without replaying moves.
    state.started=now;
  }
  return {moving:state.mode==='move',kind:state.kind,serial:state.serial,from:state.position,
    to:state.mode==='move'?1-state.position:state.position,
    progress:Math.min(1,Math.max(0,(now-state.started)/state.duration))};
}

