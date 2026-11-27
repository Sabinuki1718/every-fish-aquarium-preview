const tracks=[
  {file:'./assets/bgm/bgm-1.mp3'},
  {file:'./assets/bgm/bgm-2.mp3'},
  {file:'./assets/bgm/bgm-3.mp3'}
];
export function setupBGM(){
  const audio=document.getElementById('bgm-audio'),toggle=document.getElementById('bgm-toggle');
  const volume=document.getElementById('bgm-volume');
  const buttons=[...document.querySelectorAll('[data-bgm]')];
  let chosen=0;
  try{const saved=JSON.parse(localStorage.getItem('dangouo-bgm-v1')||'null');if(saved){chosen=Math.max(0,Math.min(2,Number(saved.track)||0));const v=Number(saved.volume);volume.value=Number.isFinite(v)?Math.max(0,Math.min(100,v)):35;}}catch{}
  audio.loop=true;audio.volume=Number(volume.value)/100;audio.preload='none';
  function save(){try{localStorage.setItem('dangouo-bgm-v1',JSON.stringify({track:chosen,volume:Number(volume.value)}));}catch{}}
  function notify(message){const status=document.getElementById('toast');status.textContent=message;status.classList.add('visible');setTimeout(()=>status.classList.remove('visible'),2000);}
  function sync(){buttons.forEach((b,i)=>{b.classList.toggle('active',i===chosen);b.setAttribute('aria-pressed',String(i===chosen));});toggle.textContent=audio.paused?'再生':'一時停止';toggle.setAttribute('aria-pressed',String(!audio.paused));}
  function choose(i,play=false){chosen=i;audio.src=tracks[i].file;sync();save();if(play)audio.play().then(sync).catch(()=>{sync();notify('音声を再生できませんでした');});}
  buttons.forEach((button,i)=>button.onclick=()=>choose(i,true));
  toggle.onclick=()=>{if(audio.paused)audio.play().then(sync).catch(()=>notify('音声を再生できませんでした'));else audio.pause();};
  volume.oninput=()=>{audio.volume=Number(volume.value)/100;save();};
  audio.addEventListener('play',sync);audio.addEventListener('pause',sync);
  audio.addEventListener('error',()=>notify('BGMを読み込めませんでした'));
  choose(chosen);
}
