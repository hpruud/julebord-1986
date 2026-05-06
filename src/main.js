// Bootstrap, RAF loop, fullscreen scaling, input wiring.
import { getGL, VW, VH } from './gl/context.js';
import { Director } from './director.js';
import { initInput, onSkip, onPause, onToggleCrt, onStart, onMute } from './util/input.js';
import { startClock, now, isStarted, pause, resume } from './util/time.js';
import { TIMELINE } from './timeline.js';
import { createModPlayer } from './audio/modplayer.js';

const canvas = document.getElementById('cv');
const gl = getGL(canvas);

let director = null;

function fitCanvas() {
  // We render to a 320x256 internal FBO; the canvas backbuffer is the
  // upscale target. Pick the smallest *integer* scale that fully covers the
  // viewport, capped at 4x (1280x1024 backbuffer) — going higher just costs
  // fillrate for the CRT post pass without adding visible detail since the
  // source is 320x256 nearest-neighbor.
  const w = Math.max(VW, Math.floor(window.innerWidth));
  const h = Math.max(VH, Math.floor(window.innerHeight));
  const SCALE_MAX = 4;
  const scale = Math.max(1, Math.min(SCALE_MAX, Math.floor(Math.min(w / VW, h / VH))));
  canvas.width  = VW * scale;
  canvas.height = VH * scale;
}

let crtOn = 0;
let paused = false;
let modPlayer = null;
let audioCtx = null;

async function boot() {
  initInput();
  const timeline = TIMELINE;
  director = new Director(gl, canvas, timeline);
  window.__director = director;
  fitCanvas();
  window.addEventListener('resize', fitCanvas);

  onSkip(() => {
    if (director) director.skip();
  });
  onToggleCrt(() => {
    crtOn = crtOn ? 0 : 1;
    if (director) director.setCrt(!!crtOn);
  });
  onPause(() => {
    // Toggle the global clock between paused/running. While paused, `now()`
    // returns a frozen value, so the director's part-age and per-part
    // animations all stop. The render loop keeps running, but every frame
    // produces an identical output.
    if (!isStarted()) return;
    paused = !paused;
    if (paused) {
      pause();
      if (audioCtx) audioCtx.suspend().catch(() => {});
    } else {
      resume();
      if (audioCtx) audioCtx.resume().catch(() => {});
    }
  });
  onMute(() => {
    if (modPlayer) modPlayer.toggleMute();
  });
  onStart(() => {
    startClock();
    director.start();
    requestAnimationFrame(loop);
    // Audio context must be created inside this user-gesture handler.
    // Failure to load the mod must not block the visual demo.
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) {
        audioCtx = new Ctx();
        window.__audioCtx = audioCtx;
        createModPlayer(audioCtx).then(p => {
          modPlayer = p;
          window.__modPlayer = p;
          p.start();
        }).catch(err => {
          console.warn('mod player failed to start:', err);
        });
      }
    } catch (e) {
      console.warn('audio init failed:', e);
    }
  });
}

function loop() {
  if (!isStarted()) {
    requestAnimationFrame(loop);
    return;
  }
  // While paused, `now()` returns a frozen value but director.update still
  // decays flash/shake (per-frame multiplier, not time-based) and re-renders
  // an identical frame. Skip both to honour the pause and save CPU/GPU.
  if (!paused) {
    const t = now();
    director.update(t);
    director.render(t, canvas.width, canvas.height);
  }
  requestAnimationFrame(loop);
}

boot().catch(err => {
  console.error(err);
  const pre = document.createElement('pre');
  pre.style.cssText = 'color:#f88;background:#000;padding:16px;position:fixed;left:0;top:0;right:0;z-index:9999;white-space:pre-wrap;';
  pre.textContent = String((err && err.stack) || err);
  document.body.appendChild(pre);
});
