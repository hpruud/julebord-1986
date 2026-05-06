// Transition effects between scene FBO and tmp FBO.
import { createProgram, VS_FULLSCREEN } from '../gl/context.js';
import { drawQuad } from '../gl/quad.js';
import { bindFBO, clearFBO } from '../gl/framebuffer.js';

const FS_FADE = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_tex;
uniform float u_t; // 0..1 progress
uniform float u_inDir; // 1.0 = fade IN (from black), 0.0 = fade OUT (to black)
void main() {
  vec3 c = texture(u_tex, v_uv).rgb;
  float k = mix(1.0 - u_t, u_t, u_inDir);
  outColor = vec4(c * k, 1.0);
}
`;

const FS_WIPE = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_tex;
uniform float u_t;
uniform float u_inDir;
void main() {
  // Diagonal wipe with a bright leading edge.
  float edge = mix(1.0 - u_t, u_t, u_inDir);
  // Diagonal coordinate (top-left to bottom-right).
  float d = (v_uv.x + v_uv.y) * 0.5;
  vec3 c = texture(u_tex, v_uv).rgb;
  if (d > edge) c = vec3(0.0);
  // Bright edge band.
  float band = smoothstep(0.04, 0.0, abs(d - edge));
  c += vec3(1.0, 0.95, 0.85) * band * 0.85;
  outColor = vec4(c, 1.0);
}
`;

const FS_FLASH = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_tex;
uniform float u_t;
uniform float u_inDir;
void main() {
  float k = mix(1.0 - u_t, u_t, u_inDir);
  // Light chromatic aberration that fades with k.
  float ca = (1.0 - k) * 0.012;
  vec2 ctr = v_uv - 0.5;
  vec3 c;
  c.r = texture(u_tex, v_uv + ctr * ca).r;
  c.g = texture(u_tex, v_uv).g;
  c.b = texture(u_tex, v_uv - ctr * ca).b;
  // Strong white flash at start, decays cubically.
  float white = pow(1.0 - k, 3.0);
  c = mix(c, vec3(1.0), white);
  outColor = vec4(c, 1.0);
}
`;

const FS_TEAR = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_tex;
uniform float u_t;
uniform float u_inDir;
uniform float u_time;
void main() {
  float k = mix(1.0 - u_t, u_t, u_inDir);
  vec2 uv = v_uv;
  float band = floor(uv.y * 32.0);
  float n = fract(sin(band*12.9898 + u_time*0.1)*43758.5453);
  uv.x += (n - 0.5) * 0.4 * (1.0 - k);
  vec3 c = texture(u_tex, uv).rgb;
  outColor = vec4(c * k, 1.0);
}
`;

let progs = null;

function ensure(gl) {
  if (progs) return progs;
  progs = {
    fade:  build(gl, FS_FADE),
    wipe:  build(gl, FS_WIPE),
    flash: build(gl, FS_FLASH),
    tear:  build(gl, FS_TEAR),
  };
  return progs;
}

function build(gl, fs) {
  const p = createProgram(gl, VS_FULLSCREEN, fs);
  return {
    p,
    uTex: gl.getUniformLocation(p, 'u_tex'),
    uT:   gl.getUniformLocation(p, 'u_t'),
    uInDir: gl.getUniformLocation(p, 'u_inDir'),
    uTime: gl.getUniformLocation(p, 'u_time'),
  };
}

export function runTransition(gl, kind, srcFbo, dstFbo, t, isIn) {
  const set = ensure(gl);
  const e = set[kind] || set.fade;
  bindFBO(gl, dstFbo);
  clearFBO(gl, 0, 0, 0, 1);
  gl.useProgram(e.p);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, srcFbo.tex);
  gl.uniform1i(e.uTex, 0);
  gl.uniform1f(e.uT, t);
  gl.uniform1f(e.uInDir, isIn ? 1.0 : 0.0);
  if (e.uTime) gl.uniform1f(e.uTime, performance.now() / 1000);
  drawQuad(gl);
}
