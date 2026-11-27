/* BGM starts only after an explicit play gesture. */
(() => {
  'use strict';
  const audio = document.getElementById('bgm-audio');
  const button = document.getElementById('bgm-toggle');
  const volume = document.getElementById('bgm-volume');
  const output = document.getElementById('bgm-volume-value');
  const status = document.getElementById('bgm-status');
  const key = 'okinawa-harbor-bgm-volume-v1';
  let saved = null;
  try { saved = localStorage.getItem(key); } catch (_) {}
  const initial = saved === null ? 25 : Number(saved);
  volume.value = Number.isFinite(initial) ? Math.max(0, Math.min(100, initial)) : 25;
  function setVolume() {
    audio.volume = Number(volume.value) / 100;
    output.value = volume.value + '%';
    volume.setAttribute('aria-valuetext', volume.value + '%');
  }
  function sync() {
    const playing = !audio.paused && !audio.ended;
    button.textContent = playing ? 'BGMを停止' : 'BGMを再生';
    button.setAttribute('aria-pressed', String(playing));
    status.textContent = playing ? '再生中 · リピート' : '再生ボタンで音楽が流れます';
  }
  setVolume();
  volume.addEventListener('input', () => {
    setVolume();
    try { localStorage.setItem(key, volume.value); } catch (_) {}
  });
  button.addEventListener('click', async () => {
    if (!audio.paused) { audio.pause(); return; }
    button.disabled = true;
    status.textContent = '音楽を読み込み中';
    try { await audio.play(); }
    catch (_) { status.textContent = '再生できませんでした。もう一度再生してください。'; }
    finally { button.disabled = false; }
  });
  audio.addEventListener('playing', sync);
  audio.addEventListener('pause', sync);
  audio.addEventListener('error', () => { status.textContent = '音楽を読み込めませんでした。再読み込みしてください。'; });
  sync();
})();
