// Blits a low-res texture to screen with optional CRT overlay.
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
let uTex, uScreen, uLores, uCrt, uShake, uTime, uFlash;

export function initBlit(gl) {
  prog = createProgram(gl, VS_FULLSCREEN, FS);
  uTex    = gl.getUniformLocation(prog, 'u_tex');
  uScreen = gl.getUniformLocation(prog, 'u_screenSize');
  uLores  = gl.getUniformLocation(prog, 'u_loresSize');
  uCrt    = gl.getUniformLocation(prog, 'u_crt');
  uShake  = gl.getUniformLocation(prog, 'u_shake');
  uTime   = gl.getUniformLocation(prog, 'u_time');
  uFlash  = gl.getUniformLocation(prog, 'u_flash');
}

export function blitToScreen(gl, srcTex, opts) {
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
