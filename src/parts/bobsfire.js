// Composite part: fire burns in the background while bobs render fully opaque
// in the foreground.
//
// Implementation note: instead of compositing the bobs render texture (which
// has soft halos that bleed when masked), we re-evaluate the bobs analytically
// in this shader and only output bob color for pixels strictly inside a bob
// sphere (d < 1.0). Outside the spheres we show the fire texture untouched.
// This gives crisp edges with no color bleed in either direction.
import { fire } from './fire.js';
import { createFBO, bindFBO, clearFBO } from '../gl/framebuffer.js';
import { createProgram, VS_FULLSCREEN, VW, VH } from '../gl/context.js';
import { drawQuad } from '../gl/quad.js';
import { createPaletteTexture, PALETTES } from '../gl/palette.js';

const FS_COMPOSITE = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_fire;
uniform sampler2D u_palette;
uniform float u_time;
uniform vec2  u_res;

void main() {
  vec2 p = v_uv * u_res;
  float t = u_time;

  // --- Bobs (mirrors bobs.js, minus the halo branch that caused bleed) ---
  float bestZ = -1e9;
  vec3 bestCol = vec3(0.0);
  bool hit = false;

  for (int i = 0; i < 48; i++) {
    float fi = float(i);
    float a = fi * 0.3 + t * 0.6;
    float b = fi * 0.13 + t * 0.4;
    float r = 70.0 + 28.0 * sin(t * 0.7 + fi * 0.2);
    vec2 c = vec2(
      u_res.x * 0.5 + sin(a) * cos(b) * r,
      u_res.y * 0.5 + cos(a) * 0.7 * r
    );
    float z = sin(b);
    float scale = 0.7 + 0.6 * z;
    float radius = 14.0 * scale;
    float d = length(p - c) / radius;

    if (d < 1.0) {
      vec2 nrm = (p - c) / radius;
      vec2 light = vec2(-0.5, -0.5);
      float lambert = clamp(0.4 + dot(nrm, light) * -1.0, 0.0, 1.0);
      float pal = fract(fi * 0.083 + t * 0.07);
      vec3 base = texture(u_palette, vec2(pal, 0.5)).rgb;
      vec3 c0 = mix(base * lambert, vec3(1.0, 0.98, 0.92), pow(1.0 - d, 6.0) * 0.7);
      if (z > bestZ) {
        bestZ = z;
        bestCol = c0;
        hit = true;
      }
    }
  }

  if (hit) {
    outColor = vec4(bestCol, 1.0);
  } else {
    outColor = vec4(texture(u_fire, v_uv).rgb, 1.0);
  }
}
`;

export function bobsfire(gl) {
  const fboFire = createFBO(gl, VW, VH);

  const subFire = fire(gl);

  const prog = createProgram(gl, VS_FULLSCREEN, FS_COMPOSITE);
  const uFire = gl.getUniformLocation(prog, 'u_fire');
  const uPal  = gl.getUniformLocation(prog, 'u_palette');
  const uTime = gl.getUniformLocation(prog, 'u_time');
  const uRes  = gl.getUniformLocation(prog, 'u_res');

  const palTex = createPaletteTexture(gl, PALETTES.bobs || PALETTES.plasma);

  return {
    render(gl, t, fbo) {
      // 1) Render fire into its FBO.
      subFire.render(gl, t, fboFire);
      // 2) Composite: re-evaluate bobs analytically; show fire elsewhere.
      bindFBO(gl, fbo);
      clearFBO(gl, 0, 0, 0, 1);
      gl.useProgram(prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, fboFire.tex);
      gl.uniform1i(uFire, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, palTex);
      gl.uniform1i(uPal, 1);
      gl.uniform1f(uTime, t / 1000);
      gl.uniform2f(uRes, VW, VH);
      drawQuad(gl);
      gl.activeTexture(gl.TEXTURE0);
    },
    dispose(gl) {
      if (subFire.dispose) subFire.dispose(gl);
      gl.deleteProgram(prog);
      gl.deleteTexture(palTex);
      gl.deleteFramebuffer(fboFire.fbo);
      gl.deleteTexture(fboFire.tex);
    },
  };
}
