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
    // When the page is reloaded between demo runs we re-add the
    // `?autostart=1` query param. Auto-click the boot overlay so the demo
    // resumes without requiring another user gesture. Audio may stay muted
    // until the user interacts (browser autoplay policy), but visuals run.
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('autostart') === '1') {
        // Defer to next tick so the rest of boot() can finish wiring up.
        setTimeout(() => boot.click(), 0);
      }
    } catch {}
  }
}

export function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.().catch(() => {});
  } else {
    document.exitFullscreen?.();
  }
}
