// Single-precision Mandelbrot zoom into Seahorse Valley.
//
// Iterates z_{n+1} = z_n^2 + c starting from z_0 = 0. Uses smooth (continuous)
// escape-time for banding-free coloring through a palette texture, with a
// time-driven palette cycle for the classic Amiga shimmer.
//
// The zoom is monotonic (always pushing deeper) using part-local elapsed
// time, so the user always sees motion -- no idle wide-view phase.
//
// Precision note: GLSL highp float is 32-bit. Around zoom 1e6..1e7 the
// mantissa runs out of resolution; we cap the zoom at 1.5e5 to stay in
// the safe envelope. The deeper-zoom variant (mandel_deep) handles
// extreme depths via perturbation theory.
import { createProgram, VS_FULLSCREEN, VW, VH } from '../gl/context.js';
import { drawQuad } from '../gl/quad.js';
import { bindFBO } from '../gl/framebuffer.js';
import { createPaletteTexture, PALETTES } from '../gl/palette.js';

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform float u_time;     // global time (palette cycle)
uniform float u_zoom;     // current linear zoom factor
uniform float u_rot;      // rotation angle (radians) of the view
uniform vec2  u_res;
uniform sampler2D u_palette;

const int MAX_ITER = 320;

// Seahorse Valley target (high-detail spiral region near the main bulb).
const vec2 TARGET = vec2(-0.745, 0.105);

void main() {
  // Aspect-correct pixel coords centered on screen.
  vec2 p = (v_uv - 0.5) * 2.0;
  p.x *= u_res.x / u_res.y;

  // Rotate the view about the target. Rotation accelerates over the part
  // lifetime so deep zooms feel kinetic rather than static.
  float cs = cos(u_rot), sn = sin(u_rot);
  p = mat2(cs, -sn, sn, cs) * p;

  vec2 c = TARGET + p / u_zoom;

  // Iterate.
  vec2 z = vec2(0.0);
  float iter = 0.0;
  float bail = 0.0;
  for (int i = 0; i < MAX_ITER; i++) {
    z = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y) + c;
    float r2 = dot(z, z);
    if (r2 > 256.0) { bail = r2; break; }
    iter += 1.0;
  }

  vec3 col;
  if (iter >= float(MAX_ITER)) {
    float pulse = 0.5 + 0.5 * sin(u_time * 0.6);
    col = vec3(0.02, 0.0, 0.04) + 0.04 * pulse * vec3(0.3, 0.1, 0.5);
  } else {
    float logZn = 0.5 * log(bail);
    float nu = log(logZn / log(2.0)) / log(2.0);
    float mu = iter + 1.0 - nu;
    float t = fract(mu * 0.025 + u_time * 0.07);
    float pu = (t * 31.0 + 0.5) / 32.0;
    col = texture(u_palette, vec2(pu, 0.5)).rgb;
    float edge = smoothstep(0.0, 6.0, iter);
    col *= edge;
  }
  outColor = vec4(col, 1.0);
}
`;

export function mandel(gl) {
  const prog = createProgram(gl, VS_FULLSCREEN, FS);
  const uTime = gl.getUniformLocation(prog, 'u_time');
  const uZoom = gl.getUniformLocation(prog, 'u_zoom');
  const uRot  = gl.getUniformLocation(prog, 'u_rot');
  const uRes  = gl.getUniformLocation(prog, 'u_res');
  const uPal  = gl.getUniformLocation(prog, 'u_palette');
  const palTex = createPaletteTexture(gl, PALETTES.mandel || PALETTES.plasma);

  // Zoom range: ZOOM_MIN (whole set visible) to ZOOM_MAX (deep seahorses).
  // The full part duration is the ramp -- no clamp, no static tail.
  const ZOOM_MIN = 1.2;
  const ZOOM_MAX = 1.5e5;
  const LOG_ZMIN = Math.log(ZOOM_MIN);
  const LOG_ZMAX = Math.log(ZOOM_MAX);

  let startMs = -1;

  return {
    render(gl, t /* ms */, fbo) {
      if (startMs < 0) startMs = t;
      const elapsed = (t - startMs) / 1000;
      // Monotonic zoom that runs the FULL part duration (30s). No clamp,
      // no static tail. We push slightly past the safe single-precision
      // envelope at the end -- the resulting blockiness reads as a final
      // crescendo rather than a freeze, then the part transitions out.
      const ramp = elapsed / 30; // 0..1+ over 30s, may exceed 1 if part overruns
      const eased = Math.pow(ramp, 1.4);
      const logZ = LOG_ZMIN + (LOG_ZMAX - LOG_ZMIN) * eased;
      const zoom = Math.exp(logZ);
      // Rotation: accelerates with elapsed^1.5 so deep frames spin visibly.
      const rot = 0.18 * Math.pow(elapsed, 1.5);

      bindFBO(gl, fbo);
      gl.useProgram(prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, palTex);
      gl.uniform1i(uPal, 0);
      gl.uniform1f(uTime, t / 1000);
      gl.uniform1f(uZoom, zoom);
      gl.uniform1f(uRot, rot);
      gl.uniform2f(uRes, VW, VH);
      drawQuad(gl);
    },
    dispose(gl) {
      gl.deleteProgram(prog);
      gl.deleteTexture(palTex);
    },
  };
}
