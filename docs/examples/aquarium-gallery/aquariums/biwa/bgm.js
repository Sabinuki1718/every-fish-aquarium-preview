(() => {
  const tracks=window.BGM_TRACKS||[],audio=document.getElementById('bgmAudio'),select=document.getElementById('bgmSelect'),toggle=document.getElementById('bgmToggle'),volume=document.getElementById('bgmVolume'),status=document.getElementById('bgmStatus');
  const key='biwa-june-aquarium/bgm-v1';let saved={},requestId=0;
  try{saved=JSON.parse(localStorage.getItem(key)||'{}')}catch{}
  tracks.forEach((track,i)=>{const option=document.createElement('option');option.value=String(i);option.textContent=track.label;select.append(option)});
  select.value=String(Number.isInteger(saved.track)&&saved.track>=0&&saved.track<tracks.length?saved.track:0);
  audio.volume=Number.isFinite(saved.volume)?Math.min(1,Math.max(0,saved.volume)):.25;volume.value=String(Math.round(audio.volume*100));
  function save(){try{localStorage.setItem(key,JSON.stringify({track:Number(select.value),volume:audio.volume}))}catch{}}
  function reflect(){const playing=!audio.paused;toggle.textContent=playing?'一時停止':'再生';toggle.setAttribute('aria-pressed',String(playing));}
  async function play(){const id=++requestId;status.textContent='';try{await audio.play();if(id===requestId)reflect()}catch(error){if(id!==requestId||error.name==='AbortError')return;status.textContent='再生できませんでした';reflect()}}
  function choose(){const track=tracks[Number(select.value)];if(!track)return;audio.src=track.src;status.textContent='';}
  choose();
  toggle.onclick=()=>{if(audio.paused)play();else{++requestId;audio.pause();reflect()}};
  select.onchange=()=>{const wasPlaying=!audio.paused;++requestId;audio.pause();choose();save();reflect();if(wasPlaying)play()};
  volume.oninput=()=>{audio.volume=Number(volume.value)/100;save()};
  audio.addEventListener('play',reflect);audio.addEventListener('pause',reflect);
  audio.addEventListener('error',()=>{status.textContent='音源を読み込めませんでした';reflect()});
  // Audio begins only after an explicit press of the play button.
})();
