// Classic fire effect: CPU cellular automaton, palette-mapped via shader.
import { createProgram, VS_FULLSCREEN, VW, VH } from '../gl/context.js';
import { drawQuad } from '../gl/quad.js';
import { bindFBO } from '../gl/framebuffer.js';
import { createPaletteTexture, PALETTES } from '../gl/palette.js';

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_idx;     // R channel = intensity 0..255
uniform sampler2D u_palette;
void main() {
  // Sim has y=0 at top, ignites at bottom. The sim buffer is uploaded row 0
  // first; in GL, texture row 0 sits at the bottom (v_uv.y == 0 after the
  // final display blit). Net effect on screen: v_uv.y == 0 corresponds to
  // the TOP of the displayed image, v_uv.y == 1 to the BOTTOM (ignition).
  // We attenuate intensity in the upper part of the screen so flames die
  // out before reaching the top with bright colors.
  vec2 uv = v_uv;
  float v = texture(u_idx, uv).r;
  // After the display blit, v_uv.y == 1 is the TOP of the screen and
  // v_uv.y == 0 is the BOTTOM (ignition row). Only attenuate intensity in
  // the top sliver of the screen so the palette retains full dynamic range
  // (yellows/whites) elsewhere; multiplying intensity over a wide range
  // washes out the hot end of the palette.
  float topFade = 1.0 - smoothstep(0.85, 1.0, v_uv.y);
  v *= topFade;
  // Palette texture is 32 texels wide with LINEAR + REPEAT. Sampling at u=0.0
  // would interpolate between palette[0] (black) and palette[31] (white) due
  // to the wrap, producing grey at the dark end. Map v into the centered
  // range [0.5/32, 31.5/32] so v=0 lands inside texel 0 (pure black).
  float pu = (v * 31.0 + 0.5) / 32.0;
  vec3 col = texture(u_palette, vec2(pu, 0.5)).rgb;
  outColor = vec4(col, 1.0);
}
`;

export function fire(gl) {
  const W = VW, H = VH;
  const buf = new Uint8Array(W * H * 4); // RGBA but only R used
  const prog = createProgram(gl, VS_FULLSCREEN, FS);
  const uIdx = gl.getUniformLocation(prog, 'u_idx');
  const uPal = gl.getUniformLocation(prog, 'u_palette');

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const palTex = createPaletteTexture(gl, PALETTES.fire);

  // intensity buffer (single channel)
  const I = new Uint8Array(W * H);
  // ignite bottom row
  function ignite() {
    for (let x = 0; x < W; x++) I[(H-1)*W + x] = 255;
  }
  ignite();

  return {
    render(gl, t, fbo) {
      // step: each pixel from row y inherits from row y+1 with random spread
      for (let y = 0; y < H - 1; y++) {
        const dst = y * W;
        const src = (y + 1) * W;
        for (let x = 0; x < W; x++) {
          const rand = (Math.random() * 3) | 0;
          const sx = x + rand - 1;
          const sIdx = src + (sx < 0 ? 0 : sx >= W ? W-1 : sx);
          const decay = (Math.random() * 3) | 0;
          let v = I[sIdx] - decay;
          if (v < 0) v = 0;
          I[dst + x] = v;
        }
      }
      // re-ignite bottom with flicker
      for (let x = 0; x < W; x++) {
        I[(H-1)*W + x] = (200 + Math.random() * 55) | 0;
      }
      // copy I to RGBA buf (R channel)
      for (let i = 0, j = 0; i < W*H; i++, j += 4) {
        const v = I[i];
        buf[j+0] = v;
        buf[j+1] = v;
        buf[j+2] = v;
        buf[j+3] = 255;
      }
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);

      bindFBO(gl, fbo);
      gl.useProgram(prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(uIdx, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, palTex);
      gl.uniform1i(uPal, 1);
      drawQuad(gl);
      gl.activeTexture(gl.TEXTURE0);
    },
    dispose(gl) {
      gl.deleteProgram(prog);
      gl.deleteTexture(tex);
      gl.deleteTexture(palTex);
    }
  };
}
