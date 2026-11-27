// A small independent entrypoint can report module, WebGL and network failures.
(()=>{
  const status=document.getElementById('loading');
  function showError(error){
    if(document.getElementById('render-retry')){status.hidden=false;return;}
    status.hidden=false;status.replaceChildren();status.classList.add('render-error');
    const message=document.createElement('p');message.textContent='水槽の3D表示を開始できませんでした。';status.append(message);
    const retry=document.createElement('button');retry.id='render-retry';retry.textContent='軽量表示で再読み込み';
    retry.onclick=()=>{const url=new URL(location.href);url.searchParams.set('quality','lite');location.href=url.href;};status.append(retry);
    const details=document.createElement('details'),summary=document.createElement('summary'),text=document.createElement('p');
    summary.textContent='詳細';text.textContent=error?.message||String(error||'読み込みエラー');details.append(summary,text);status.append(details);
  }
  window.aquariumShowError=showError;
  window.addEventListener('unhandledrejection',event=>showError(event.reason));
  window.addEventListener('error',event=>{if(event.error)showError(event.error);});
  const timer=setTimeout(()=>{if(!window.aquariumReady)showError(new Error('読み込みに時間がかかっています。通信状態を確認して再読み込みしてください。'));},60000);
  import('./app.js?v=mobile-1').then(()=>{
    if(window.aquariumReady)clearTimeout(timer);
  }).catch(error=>{clearTimeout(timer);showError(error);});
})();


