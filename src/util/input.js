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
        if (!bootDismissed) { dismissBoot(); fire('start'); }
        else { fire('skip'); }
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

  // Left mouse click: start the demo if still on the boot screen, otherwise
  // skip to the next part (same as Space).
  window.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (!bootDismissed) { dismissBoot(); fire('start'); }
    else { fire('skip'); }
  });

  const boot = document.getElementById('boot');
  if (boot) {
    boot.addEventListener('click', () => {
      if (!bootDismissed) { dismissBoot(); fire('start'); }
    }, { once: true });
  }
}

let bootDismissed = false;
function dismissBoot() {
  if (bootDismissed) return;
  bootDismissed = true;
  const boot = document.getElementById('boot');
  if (boot) boot.style.display = 'none';
}

export function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.().catch(() => {});
  } else {
    document.exitFullscreen?.();
  }
}
