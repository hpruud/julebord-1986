// Deep-zoom Mandelbrot via perturbation theory.
//
// Standard Mandelbrot iteration runs out of precision around zoom 1e7 with
// 32-bit floats. Perturbation theory rescues this:
//
//   Compute a "reference orbit" Z_n at high precision (JS doubles) for one
//   point near the view center. For every pixel at offset d from the
//   reference, the iteration z = z^2 + c becomes:
//
//     Z + e = (Z + e)^2 + (C + d)
//           = Z^2 + 2 Z e + e^2 + C + d
//
//   Subtracting Z_{n+1} = Z_n^2 + C gives:
//
//     e_{n+1} = 2 Z_n e_n + e_n^2 + d
//
//   Since Z_n is large in absolute terms but e_n stays small, the per-pixel
//   delta iteration only needs single-precision floats — no precision loss
//   at deep zooms. The reference orbit is uploaded as a 1D RGBA32F texture
//   indexed by iteration count (R,G = Z.x, Z.y; B = |Z|^2 cached).
//
// Limitations of this minimal implementation:
//   * No "glitch detection" (Pauldelbrot algorithm) — when a pixel's e_n
//     grows comparable to Z_n, perturbation breaks down and we'd need a
//     secondary reference. For the smooth-zoom path used here that's
//     acceptable; visible glitches are rare on Seahorse Valley targets and
//     get hidden by the palette cycling. If they show up, the easy fix is
//     to recompute the reference more often.
//   * Reference orbit length capped at MAX_ITER; pixels still inside set
//     after that are colored as "inside".
//
// Zoom path: exponential ramp from 1 to ~1e12 over the part duration, then
// loops. The user perceives "infinite" zoom since detail keeps emerging.
import { createProgram, VS_FULLSCREEN, VW, VH } from '../gl/context.js';
import { drawQuad } from '../gl/quad.js';
import { bindFBO } from '../gl/framebuffer.js';
import { createPaletteTexture, PALETTES } from '../gl/palette.js';

const MAX_ITER = 800;

// Target deep in Seahorse Valley with very deep detail.
// (well-known Mandelbrot deep-zoom target)
const TARGET_X = -0.743643887037151;
const TARGET_Y =  0.131825904205330;

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform vec2  u_res;
uniform float u_time;
uniform float u_zoom;          // current zoom factor (large)
uniform float u_rot;           // view rotation angle (radians)
uniform int   u_refLen;        // valid length of reference orbit
uniform sampler2D u_ref;       // reference orbit: R,G = Zx, Zy at each iter
uniform sampler2D u_palette;

const int MAX_ITER = ${MAX_ITER};

vec2 cmul(vec2 a, vec2 b) {
  return vec2(a.x*b.x - a.y*b.y, a.x*b.y + a.y*b.x);
}

void main() {
  // Pixel offset from view center, in fractal-plane units.
  vec2 px = (v_uv - 0.5) * 2.0;
  px.x *= u_res.x / u_res.y;
  // Rotate the view about the reference center.
  float cs = cos(u_rot), sn = sin(u_rot);
  px = mat2(cs, -sn, sn, cs) * px;
  // d = c - C_ref, scaled by zoom (smaller at higher zoom).
  vec2 d = px / u_zoom;

  // Perturbation iteration:
  //   e_{n+1} = 2 Z_n e_n + e_n^2 + d
  //   z_{n+1} = Z_{n+1} + e_{n+1}
  // We only track e (small float), reading Z_n from the reference texture.
  vec2 e = vec2(0.0);
  int iter = 0;
  float bail = 0.0;
  bool escaped = false;

  for (int i = 0; i < MAX_ITER; i++) {
    if (i >= u_refLen) break;
    // Sample Z_i from ref texture (centered texel sampling).
    float u = (float(i) + 0.5) / float(MAX_ITER);
    vec2 Zi = texture(u_ref, vec2(u, 0.5)).rg;
    // e_{i+1} = 2 * Z_i * e + e*e + d
    e = 2.0 * cmul(Zi, e) + cmul(e, e) + d;
    // z_{i+1} = Z_{i+1} + e_{i+1} -- but we need the next Z to test escape,
    // so sample Z_{i+1} for the bailout check.
    int ni = i + 1;
    if (ni >= u_refLen) { iter = ni; break; }
    float un = (float(ni) + 0.5) / float(MAX_ITER);
    vec2 Zn = texture(u_ref, vec2(un, 0.5)).rg;
    vec2 z = Zn + e;
    float r2 = dot(z, z);
    if (r2 > 256.0) {
      bail = r2;
      iter = ni;
      escaped = true;
      break;
    }
    iter = ni;
  }

  vec3 col;
  if (!escaped) {
    float pulse = 0.5 + 0.5 * sin(u_time * 0.5);
    col = vec3(0.0, 0.0, 0.04) + 0.05 * pulse * vec3(0.3, 0.1, 0.6);
  } else {
    float logZn = 0.5 * log(bail);
    float nu = log(logZn / log(2.0)) / log(2.0);
    float mu = float(iter) + 1.0 - nu;
    float t = fract(mu * 0.018 + u_time * 0.06);
    float pu = (t * 31.0 + 0.5) / 32.0;
    col = texture(u_palette, vec2(pu, 0.5)).rgb;
    float edge = smoothstep(0.0, 8.0, float(iter));
    col *= edge;
  }
  outColor = vec4(col, 1.0);
}
`;

// Compute high-precision reference orbit for center C = (cx, cy).
// Returns Float32Array of length MAX_ITER * 4 (RGBA, with R=Zx, G=Zy)
// and the actual valid length (where |Z|^2 stays bounded).
function computeReference(cx, cy) {
  const data = new Float32Array(MAX_ITER * 4);
  let zx = 0, zy = 0;
  let len = 0;
  for (let i = 0; i < MAX_ITER; i++) {
    data[i * 4 + 0] = zx;
    data[i * 4 + 1] = zy;
    data[i * 4 + 2] = 0;
    data[i * 4 + 3] = 1;
    len = i + 1;
    // z = z^2 + c
    const nx = zx * zx - zy * zy + cx;
    const ny = 2 * zx * zy + cy;
    zx = nx; zy = ny;
    if (zx * zx + zy * zy > 1e10) {
      // reference orbit escaped (shouldn't happen for points in/near the set)
      break;
    }
  }
  return { data, len };
}

export function mandel_deep(gl) {
  const prog = createProgram(gl, VS_FULLSCREEN, FS);
  const uRes    = gl.getUniformLocation(prog, 'u_res');
  const uTime   = gl.getUniformLocation(prog, 'u_time');
  const uZoom   = gl.getUniformLocation(prog, 'u_zoom');
  const uRot    = gl.getUniformLocation(prog, 'u_rot');
  const uRefLen = gl.getUniformLocation(prog, 'u_refLen');
  const uRef    = gl.getUniformLocation(prog, 'u_ref');
  const uPal    = gl.getUniformLocation(prog, 'u_palette');

  // Need EXT_color_buffer_float / OES_texture_float_linear? Actually we don't
  // render to it — only sample. RGBA32F sampling needs OES_texture_float_linear
  // for LINEAR filtering, but we use NEAREST so plain RGBA32F upload is fine
  // in WebGL2 (R32F + texImage2D works with internalformat RGBA32F).
  // Build reference orbit.
  const { data, len } = computeReference(TARGET_X, TARGET_Y);
  const refTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, refTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, MAX_ITER, 1, 0, gl.RGBA, gl.FLOAT, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const palTex = createPaletteTexture(gl, PALETTES.mandel || PALETTES.plasma);

  // Track when this part started so the zoom resets to wide-view each entry.
  let startMs = -1;

  return {
    render(gl, t /* ms */, fbo) {
      if (startMs < 0) startMs = t;
      const elapsed = (t - startMs) / 1000;
      // Monotonic exponential zoom over the FULL part duration (30s); no
      // clamp, no static tail. Start at zoom 1e3 (already in seahorse
      // territory -- perturbation needs |e| << |Z|, which fails near zoom 1)
      // and ramp to 1e12 by 30s. If the part overruns, we keep zooming
      // deeper -- the perturbation method handles arbitrary depths.
      const ZMIN_LOG = Math.log(1e3);
      const ZMAX_LOG = Math.log(1e12);
      const ramp = elapsed / 30;
      const eased = Math.pow(ramp, 1.2);
      const logZ = ZMIN_LOG + (ZMAX_LOG - ZMIN_LOG) * eased;
      const zoom = Math.exp(logZ);
      // Accelerating rotation: starts gentle, picks up as we descend.
      const rot = 0.15 * Math.pow(elapsed, 1.5);

      bindFBO(gl, fbo);
      gl.useProgram(prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, refTex);
      gl.uniform1i(uRef, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, palTex);
      gl.uniform1i(uPal, 1);
      gl.uniform2f(uRes, VW, VH);
      gl.uniform1f(uTime, t / 1000);
      gl.uniform1f(uZoom, zoom);
      gl.uniform1f(uRot, rot);
      gl.uniform1i(uRefLen, len);
      drawQuad(gl);
      gl.activeTexture(gl.TEXTURE0);
    },
    dispose(gl) {
      gl.deleteProgram(prog);
      gl.deleteTexture(refTex);
      gl.deleteTexture(palTex);
    },
  };
}
