/* MusicBox — audio: one shared player for 30-second iTunes previews.
   The playing state drives the spinning-disc UI via the
   'musicbox:preview' event; render code just adds .playing to the
   matching .disc-btn. */

let audio = null;
let currentKey = null;

function emit(state) {
  document.dispatchEvent(new CustomEvent('musicbox:preview', {
    detail: { key: currentKey, state },
  }));
}

export function isPlaying(key) {
  return currentKey === key && audio && !audio.paused;
}

export function stopPreview() {
  if (audio) {
    // Detach handlers before clearing the source: setting src='' makes the
    // browser fire an 'error' event, which would otherwise re-trigger the
    // stale onerror callback (and its "Preview unavailable" toast) on every
    // stop — natural end, modal close, switching tracks, etc.
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }
  if (currentKey) {
    emit('stopped');
    currentKey = null;
  }
}

// Toggle: play if idle, pause if this key is playing.
export function togglePreview(key, url, { onError } = {}) {
  if (!url) return;
  if (isPlaying(key)) {
    stopPreview();
    return;
  }
  stopPreview();

  audio = audio || new Audio();
  audio.volume = 0.85;
  currentKey = key;
  audio.src = url;
  audio.onended = () => { emit('stopped'); currentKey = null; };
  audio.onerror = () => {
    emit('stopped');
    currentKey = null;
    if (onError) onError();
  };
  audio.play().then(() => emit('playing')).catch(() => {
    emit('stopped');
    currentKey = null;
    if (onError) onError();
  });
}
