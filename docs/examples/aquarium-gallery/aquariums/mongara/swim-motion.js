/* Qualitative balistiform locomotion: coordinated soft dorsal/anal undulation.
   The amplitudes and frequencies are illustrative, not species measurements. */
(function(root){
 'use strict';
 const clamp=(x,a,b)=>Math.min(b,Math.max(a,x)),TAU=Math.PI*2;
 const WAVE_NUMBER=145,ROOT_POWER=1.35;
 function position(t){const a=t*.13;return [.49*Math.sin(a),.365+.045*Math.sin(a*.8)+.009*Math.sin(t*.55),.055+.115*Math.cos(a)]}
 function parameters(t){
  const a=t*.13,vx=.0637*Math.cos(a),vy=.00468*Math.cos(a*.8)+.00495*Math.cos(t*.55),vz=-.01495*Math.sin(a);
  const ax=-.008281*Math.sin(a),az=-.0019435*Math.cos(a),horizontal=Math.hypot(vx,vz),speed=Math.hypot(vx,vy,vz);
  const yawRate=(-vx*az+vz*ax)/Math.max(.00001,vx*vx+vz*vz);
  const activity=.38+.62*clamp(speed/.065,0,1),turn=clamp(yawRate/.55,-1,1),climb=clamp(vy/Math.max(.025,horizontal)/.30,-1,1);
  return {activity,turn,climb,speed,frequency:1.55+.75*activity};
 }
 function createState(){return {phase:0,activity:.8,turn:0,climb:0,roll:0,rollVelocity:0,balance:0,frequency:2.15,speed:0}}
 function step(state,dt,t){
  const p=parameters(t),blend=1-Math.exp(-dt*3);
  for(const key of ['activity','turn','climb','frequency','speed'])state[key]+=(p[key]-state[key])*blend;
  state.phase=(state.phase+dt*TAU*state.frequency)%(TAU*1000);
  // A small damped disturbance and restoring response illustrate postural control.
  const correction=-12*state.roll-5.5*state.rollVelocity;
  state.rollVelocity+=(.30*state.turn+.035*Math.sin(t*.47)+correction)*dt;
  state.roll=clamp(state.roll+state.rollVelocity*dt,-.045,.045);
  state.balance=clamp(correction/1.6,-.22,.22);
  return state;
 }
 function amplitude(state,kind){return (.0065+.004*state.activity)*(kind===1?1:.95)*(1+kind*state.balance*.5)}
 function medianOffset(x,weight,kind,state){const w=clamp(weight,0,1);return amplitude(state,kind)*Math.pow(w,ROOT_POWER)*Math.sin(state.phase-x*WAVE_NUMBER)+state.turn*.0022*w+kind*state.balance*.0014*w}
 function tailOffset(x,state){const u=clamp((x-.095)/.055,0,1),w=u*u*(3-2*u);return w*w*((.00012+.00045*Math.abs(state.turn))*Math.sin(state.phase*.32)+.00055*state.turn)}
 function pectoralOffset(weight,side,state){const w=clamp(weight,0,1),effort=.2+.8*Math.max(Math.abs(state.turn),Math.abs(state.climb));return side*(.00055+.00065*effort*(.5+.5*Math.sin(state.phase*.67+side*.5)))*w}
 function describe(state){if(Math.abs(state.turn)>.42)return '旋回中：鰭の偏りを変えて向きを調整';if(Math.abs(state.climb)>.40)return state.climb>0?'上向きの姿勢を整えながら遊泳':'下向きの姿勢を整えながら遊泳';return 'ゆっくり前進：背鰭と尻鰭が協調して波打つ'}
 const glsl=`
 uniform float aqPhase;
 uniform float aqActivity;
 uniform float aqTurn;
 uniform float aqBalance;
 uniform float aqClimb;
 float aqMedianAmplitude(float kind){return (.0065+.004*aqActivity)*(kind>0.?1.:.95)*(1.+kind*aqBalance*.5);}
 float aqMedianOffset(float x,float weight,float kind){float w=clamp(weight,0.,1.);return aqMedianAmplitude(kind)*pow(w,1.35)*sin(aqPhase-x*145.)+aqTurn*.0022*w+kind*aqBalance*.0014*w;}
 float aqTailOffset(float x){float w=smoothstep(.095,.150,x);return w*w*((.00012+.00045*abs(aqTurn))*sin(aqPhase*.32)+.00055*aqTurn);}
 `;
 const api={position,parameters,createState,step,amplitude,medianOffset,tailOffset,pectoralOffset,describe,glsl,WAVE_NUMBER,ROOT_POWER};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.TriggerfishMotion=api;
})(typeof window!=='undefined'?window:globalThis);
