function showFailure(message){
  const loading=document.getElementById('loading');
  loading.hidden=false;loading.replaceChildren();
  const text=document.createElement('p');text.textContent=message;
  const retry=document.createElement('button');retry.textContent='軽量画質で再読み込み';
  retry.onclick=()=>{const url=new URL(location.href);url.searchParams.set('quality','light');location.assign(url);};
  loading.append(text,retry);
}
window.addEventListener('aquarium-failed',event=>showFailure(event.detail));
import('./app.js').catch(error=>{
  console.error(error);
  showFailure('水槽の描画を開始できませんでした。ほかのタブを閉じてから、軽量画質でお試しください。');
});
