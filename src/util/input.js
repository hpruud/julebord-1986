// Input handler: keyboard, fullscreen, click-to-start.
const listeners = {
  skip: [],
  pause: [],
  toggleCrt: [],
  start: [],
  mute: [],
};

export function onSkip(fn) { listeners.skip.push(fn); }
export function onPause(fn) { listeners.pause.push(fn); }
export function onToggleCrt(fn) { listeners.toggleCrt.push(fn); }
export function onStart(fn) { listeners.start.push(fn); }
export function onMute(fn) { listeners.mute.push(fn); }

function fire(name) {
  for (const fn of listeners[name]) {
    try { fn(); } catch (e) { console.error(e); }
  }
}

export function initInput() {
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        fire('skip');
        break;
      case 'KeyP':
        fire('pause');
        break;
      case 'KeyC':
        fire('toggleCrt');
        break;
      case 'KeyM':
        fire('mute');
        break;
      case 'KeyF':
        toggleFullscreen();
        break;
      case 'Escape':
        if (document.fullscreenElement) {
          document.exitFullscreen?.();
        }
        break;
    }
  });

  const boot = document.getElementById('boot');
  if (boot) {
    boot.addEventListener('click', () => {
      boot.style.display = 'none';
      fire('start');
    }, { once: true });
  }
}

export function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.().catch(() => {});
  } else {
    document.exitFullscreen?.();
  }
}
