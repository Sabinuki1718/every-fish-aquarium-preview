const audio=document.getElementById('bgm-audio');
const track=document.getElementById('bgm-track');
const toggle=document.getElementById('bgm-toggle');
const volume=document.getElementById('bgm-volume');
const status=document.getElementById('bgm-status');
const storageKey='aquarium-bgm:'+document.title;
const tracks=['assets/audio/bgm1.mp3','assets/audio/bgm2.mp3','assets/audio/bgm3.mp3'];
let request=0;
audio.loop=true;audio.volume=.12;
try{
  const saved=JSON.parse(localStorage.getItem(storageKey));
  if(Number.isInteger(saved?.track)&&saved.track>=0&&saved.track<3)track.value=String(saved.track);
  if(Number.isFinite(saved?.volume)&&saved.volume>=0&&saved.volume<=1)audio.volume=saved.volume;
}catch{/* Use quiet defaults if browser storage is unavailable. */}
volume.value=String(Math.round(audio.volume*100));
audio.src=tracks[Number(track.value)];
function save(){try{localStorage.setItem(storageKey,JSON.stringify({track:Number(track.value),volume:audio.volume}));}catch{}}
function sync(){const playing=!audio.paused;toggle.textContent=playing?'停止':'再生';toggle.setAttribute('aria-pressed',String(playing));}
async function play(){
  const current=++request;status.textContent='';
  try{await audio.play();}catch(error){if(current===request&&error.name!=='AbortError')status.textContent='再生できませんでした';}
  if(current===request)sync();
}
toggle.onclick=()=>{if(audio.paused)play();else{request++;audio.pause();audio.currentTime=0;sync();}};
track.onchange=()=>{
  const playing=!audio.paused;request++;audio.pause();audio.src=tracks[Number(track.value)];
  status.textContent='';save();sync();if(playing)play();
};
volume.oninput=()=>{audio.volume=Number(volume.value)/100;save();};
audio.addEventListener('play',sync);audio.addEventListener('pause',sync);
audio.addEventListener('error',()=>{status.textContent='再生できませんでした';sync();});
sync();

