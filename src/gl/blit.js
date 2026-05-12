// Blits a low-res texture to screen with optional CRT overlay.
//
// State model: a single cached program + uniform locations is held in module
// scope. This is fine because the demo creates exactly one WebGL2 context
// (see src/gl/context.js) for the lifetime of the page. If you ever need to
// support context loss recovery or multiple contexts, call `initBlit(gl)`
// again with the new context: the cache is keyed by the GL object and will
// be rebuilt on mismatch, so the old (now-invalid) program reference is
// dropped rather than reused.
import { createProgram, VS_FULLSCREEN } from './context.js';
import { drawQuad } from './quad.js';

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_tex;
uniform vec2  u_screenSize;   // device pixels of canvas
uniform vec2  u_loresSize;    // 320,256
uniform float u_crt;          // 0..1
uniform float u_shake;        // pixels
uniform float u_time;
uniform float u_flash;        // 0..1 white flash
void main() {
  vec2 uv = vec2(v_uv.x, 1.0 - v_uv.y);
  uv.x += sin(u_time*30.0 + uv.y*40.0) * u_shake / u_screenSize.x;
  uv.y += cos(u_time*27.0 + uv.x*40.0) * u_shake / u_screenSize.y;
  vec3 col = texture(u_tex, uv).rgb;

  if (u_crt > 0.001) {
    // scanlines
    float sl = 0.5 + 0.5 * sin(uv.y * u_loresSize.y * 3.14159);
    float scan = mix(1.0, 0.75 + 0.25*sl, u_crt);
    col *= scan;
    // chroma offset
    vec2 ch = vec2(1.5/u_screenSize.x, 0.0) * u_crt;
    float r = texture(u_tex, uv + ch).r;
    float b = texture(u_tex, uv - ch).b;
    col = mix(col, vec3(r, col.g, b), u_crt * 0.6);
    // vignette
    vec2 d = uv - 0.5;
    float vg = 1.0 - dot(d,d) * 0.9 * u_crt;
    col *= vg;
  }

  col = mix(col, vec3(1.0), u_flash);
  outColor = vec4(col, 1.0);
}
`;

let prog = null;
let progGL = null; // GL context the cached program belongs to
let uTex, uScreen, uLores, uCrt, uShake, uTime, uFlash;

export function initBlit(gl) {
  // If we were previously initialised against a different context (e.g.
  // after context loss / recovery), drop the stale reference. We can't
  // safely call deleteProgram on the old context here because it may be
  // lost; that's the caller's responsibility.
  if (progGL && progGL !== gl) {
    prog = null;
  }
  if (prog) return;
  prog = createProgram(gl, VS_FULLSCREEN, FS);
  progGL = gl;
  uTex    = gl.getUniformLocation(prog, 'u_tex');
  uScreen = gl.getUniformLocation(prog, 'u_screenSize');
  uLores  = gl.getUniformLocation(prog, 'u_loresSize');
  uCrt    = gl.getUniformLocation(prog, 'u_crt');
  uShake  = gl.getUniformLocation(prog, 'u_shake');
  uTime   = gl.getUniformLocation(prog, 'u_time');
  uFlash  = gl.getUniformLocation(prog, 'u_flash');
}

export function blitToScreen(gl, srcTex, opts) {
  if (!prog || progGL !== gl) {
    // Lazy/defensive init so callers don't have to remember the ordering.
    // The Director already calls initBlit explicitly; this just makes the
    // module robust to future refactors.
    initBlit(gl);
  }
  const { screenW, screenH, loresW, loresH, crt=0, shake=0, time=0, flash=0 } = opts;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, screenW, screenH);
  gl.useProgram(prog);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, srcTex);
  gl.uniform1i(uTex, 0);
  gl.uniform2f(uScreen, screenW, screenH);
  gl.uniform2f(uLores, loresW, loresH);
  gl.uniform1f(uCrt, crt);
  gl.uniform1f(uShake, shake);
  gl.uniform1f(uTime, time);
  gl.uniform1f(uFlash, flash);
  drawQuad(gl);
}
