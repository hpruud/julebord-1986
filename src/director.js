// Director: schedules timeline parts, runs transitions, owns the low-res FBO.
import { createFBO, bindFBO, clearFBO, disposeFBO } from './gl/framebuffer.js';
import { VW, VH } from './gl/context.js';
import { initBlit, blitToScreen } from './gl/blit.js';
import { now } from './util/time.js';

import { parts as partRegistry } from './parts/registry.js';
import { runTransition } from './parts/transitions.js';

export class Director {
  constructor(gl, canvas, timeline) {
    this.gl = gl;
    this.canvas = canvas;
    this.timeline = timeline;
    this.scene = createFBO(gl, VW, VH, { depth: true });
    this.tmp   = createFBO(gl, VW, VH); // for transitions/post (no depth needed)
    initBlit(gl);

    this.idx = -1;
    this.partStartMs = 0;
    this.current = null;
    this.transitioning = false;
    this.transitionStart = 0;
    this.transitionDur = 600;
    this.transitionKind = 'fade';
    this.crt = 0; // 0 or 1
    this.flash = 0;
    this.shake = 0;

    this.totalEndMs = 0;
    let acc = 0;
    for (const p of timeline.parts) acc += p.dur;
    this.totalEndMs = acc;
  }

  setCrt(on) { this.crt = on ? 1 : 0; }

  start() {
    this._enterPart(0);
  }

  skip() {
    // If we're already transitioning, fast-forward the current transition
    // to completion so the user sees an immediate response. Otherwise begin
    // the out-transition off the current part.
    if (this.transitioning) {
      this.transitionStart = now() - this.transitionDur;
      return;
    }
    this._beginOutTransition();
  }

  _instantiate(id) {
    const factory = partRegistry[id];
    if (!factory) {
      console.warn('Unknown part id:', id);
      return null;
    }
    const inst = factory(this.gl);
    return inst;
  }

  _enterPart(idx) {
    if (idx >= this.timeline.parts.length) {
      if (this.current && this.current.dispose) this.current.dispose(this.gl);
      this.current = null;
      this.idx = idx;
      this.transitioning = false;
      return;
    }
    this.idx = idx;
    const def = this.timeline.parts[idx];
    if (this.current && this.current.dispose) this.current.dispose(this.gl);
    this.current = this._instantiate(def.id);
    this.partStartMs = now();
    if (this.current && this.current.init) this.current.init(this.gl);

    // Trigger an in-transition
    this.transitioning = true;
    this.transitionStart = now();
    this.transitionDur = 600;
    this.transitionKind = def.transitionIn || 'fade';
    this._inTransition = true;

    if (this.transitionKind === 'flash') this.flash = 1.0;
  }

  _beginOutTransition() {
    if (this.idx < 0 || this.idx >= this.timeline.parts.length) return;
    const def = this.timeline.parts[this.idx];
    this.transitioning = true;
    this._inTransition = false;
    this.transitionStart = now();
    this.transitionDur = 600;
    this.transitionKind = def.transitionOut || 'fade';
    if (this.transitionKind === 'flash') this.flash = 1.0;
    if (this.transitionKind === 'tear') this.shake = 6.0;
  }

  update(t) {
    // Frame-rate-independent decay for flash/shake. The previous code used
    // a per-frame multiplier (`*= 0.92`), which made effects fade ~2.4x
    // faster on a 144 Hz monitor than on 60 Hz, and lingered weirdly when
    // the tab was backgrounded (RAF throttled to 1 Hz). Now we treat the
    // multiplier as "0.92 per ~16.67 ms frame" and exponentiate by real dt.
    const dt = (this._lastUpdateT != null) ? Math.max(0, t - this._lastUpdateT) : 16.67;
    this._lastUpdateT = t;
    const flashDecay = Math.pow(0.92, dt / 16.67);
    const shakeDecay = Math.pow(0.90, dt / 16.67);
    this.flash *= flashDecay;
    if (this.flash < 0.01) this.flash = 0;
    this.shake *= shakeDecay;
    if (this.shake < 0.05) this.shake = 0;

    if (!this.current && this.idx < 0) return;

    if (this.transitioning) {
      const tt = (t - this.transitionStart) / this.transitionDur;
      if (tt >= 1) {
        this.transitioning = false;
        if (!this._inTransition) {
          // Out transition done. Wrap from the last part back to the first
          // so the demo loops indefinitely (last part runs forever until
          // SPACE, then we restart from part 0).
          //
          // When we wrap (nextIdx === 0), reload the page instead of
          // continuing in-process. This gives every "run" of the demo a
          // truly fresh state -- no risk of effect-internal closure state,
          // accumulated RAF drift, GL/audio context warts, or any of the
          // other subtle "second run" issues users have reported.
          const nextIdx = (this.idx + 1) % this.timeline.parts.length;
          if (nextIdx === 0) {
            // Hard reload with an auto-start flag so the next run begins
            // without requiring a user click on the boot overlay.
            try {
              const url = new URL(window.location.href);
              url.searchParams.set('autostart', '1');
              window.location.replace(url.toString());
            } catch {
              window.location.reload();
            }
            return;
          }
          this._enterPart(nextIdx);
        }
      }
    } else {
      // Check if part dur exceeded. The last part is treated as
      // "indefinite": we never auto-advance off it -- the user must press
      // SPACE to restart the demo.
      const def = this.timeline.parts[this.idx];
      const isLast = this.idx === this.timeline.parts.length - 1;
      if (def && !isLast && (t - this.partStartMs) >= def.dur) {
        this._beginOutTransition();
      }
    }
  }

  render(t, screenW, screenH) {
    const gl = this.gl;
    // Render current part into scene FBO
    bindFBO(gl, this.scene);
    clearFBO(gl, 0, 0, 0, 1);
    if (this.current && this.current.render) {
      const localT = t - this.partStartMs;
      this.current.render(gl, localT, this.scene);
    }

    // Apply transition into tmp FBO if active
    let presentTex = this.scene.tex;
    if (this.transitioning) {
      const tt = Math.min(1, (t - this.transitionStart) / this.transitionDur);
      runTransition(gl, this.transitionKind, this.scene, this.tmp, tt, this._inTransition);
      presentTex = this.tmp.tex;
    }

    blitToScreen(gl, presentTex, {
      screenW, screenH,
      loresW: VW, loresH: VH,
      crt: this.crt,
      shake: this.shake,
      time: t / 1000,
      flash: this.flash,
    });
  }

  isFinished() {
    // The demo loops indefinitely (last part stays on screen until the user
    // presses SPACE, which wraps back to part 0), so it is never "finished".
    return false;
  }

  // Release GPU resources. The Director normally lives for the whole page
  // lifetime so this isn't called in production, but it makes hot-reload /
  // tests / context-recreation flows correct.
  dispose() {
    const gl = this.gl;
    if (this.current && this.current.dispose) this.current.dispose(gl);
    this.current = null;
    disposeFBO(gl, this.scene);
    disposeFBO(gl, this.tmp);
    this.scene = null;
    this.tmp = null;
  }
}
