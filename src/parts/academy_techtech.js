// ACADEMY logo with classic "tech-tech" effect: per-column vertical sine
// displacement on a big bitmap-font logo. Subtitle "JULEBORD 1986 DEMO"
// sits below it with a milder version of the same wobble. Christmas color
// gradient (red -> snow -> pine green) locked to each letter's local row
// so the gradient stays attached to glyphs as they wave.
//
// Implementation notes:
//   - The logo + subtitle are baked **once** at construction time into a
//     small RGBA mask texture using the CPU `blitText` helper. The mask
//     keeps the font at native 8 px height; the shader scales it up by
//     sampling with stretched UVs (NEAREST) for the chunky pixel look.
//   - Mask layout (144 px wide, 32 px tall):
//        rows  4..11 : "ACADEMY"             (56 px wide, centered at x=20..75)
//        rows 20..27 : "JULEBORD 1986 DEMO"  (18 chars at spacing=7 -> 126 px
//                      wide at x=2..127; glyph art uses cols 0..5 of each
//                      8-wide cell so a 1px gap remains between letters)
//   - Composite shader maps each output column to a mask column, applies
//     a per-column vertical sine displacement (multi-component, with a
//     soft envelope at part start/end), masks pixels outside the glyph
//     interior, and colors with the 'christmas' palette indexed by the
//     letter-local row.

import { createFBO, bindFBO, clearFBO } from '../gl/framebuffer.js';
import { createProgram, VS_FULLSCREEN, VW, VH } from '../gl/context.js';
import { drawQuad } from '../gl/quad.js';
import { createPaletteTexture, PALETTES } from '../gl/palette.js';
import { blitText, textWidth } from '../util/font.js';

// Mask geometry (small bitmap, scaled up by shader).
const MASK_W = 144;
const MASK_H = 32;
const TITLE      = 'ACADEMY';
const SUBTITLE   = 'JULEBORD 1986 DEMO';
const TITLE_Y    = 4;     // top row of title in the mask
const SUBTITLE_Y = 20;    // top row of subtitle in the mask

// Render-time logo geometry in output (320x256) space.
// Title is scaled up 5x vertically (8 -> 40 px) and ~4x horizontally
// (56 -> 224 px wide). Centered around output row 110.
const TITLE_OUT_H   = 40;
const TITLE_OUT_W   = 224;
const TITLE_OUT_CY  = 110;
// Subtitle is much smaller -- scaled 2x (8 -> 16 px tall, 126 -> 252 px wide).
// 18 chars at spacing=7 -> 126 px source width.
const SUB_OUT_H     = 16;
const SUB_OUT_W     = 252;
const SUB_OUT_CY    = 168;

const FS_TECHTECH = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_mask;
uniform sampler2D u_palette;
uniform float u_time;
uniform float u_age;     // seconds since part start
uniform float u_dur;     // total part duration in seconds
uniform vec2  u_res;
uniform vec2  u_maskRes;

// Title region in mask (pixels): x range [20, 76), y range [4, 12).
const float TITLE_MX0 = 20.0;
const float TITLE_MX1 = 76.0;   // 56 px wide
const float TITLE_MY0 = 4.0;
const float TITLE_MY1 = 12.0;
// Subtitle region in mask: spacing=7, 18 chars, starts at x=2 -> 2..128
const float SUB_MX0 = 2.0;
const float SUB_MX1 = 128.0;
const float SUB_MY0 = 20.0;
const float SUB_MY1 = 28.0;

// Output regions.
const float TITLE_OX = ${(VW - TITLE_OUT_W) / 2}.0;
const float TITLE_OW = ${TITLE_OUT_W}.0;
const float TITLE_OCY = ${TITLE_OUT_CY}.0;
const float TITLE_OH  = ${TITLE_OUT_H}.0;
const float SUB_OX  = ${(VW - SUB_OUT_W) / 2}.0;
const float SUB_OW  = ${SUB_OUT_W}.0;
const float SUB_OCY = ${SUB_OUT_CY}.0;
const float SUB_OH  = ${SUB_OUT_H}.0;

// Soft fade-in/out envelope on overall amplitude.
float envelope(float age, float dur) {
  float fadeIn  = smoothstep(0.0, 0.6, age);
  float fadeOut = 1.0 - smoothstep(dur - 0.6, dur, age);
  return fadeIn * fadeOut;
}

// Tech-tech vertical offset for a given output-x position and time.
// Multi-sine sum with different spatial + temporal frequencies.
float techtechOffset(float x, float t, float amp) {
  float w =
      sin(x * 0.07 + t * 2.6)        * 1.00
    + sin(x * 0.18 + t * 4.1 + 1.7)  * 0.42
    + cos(x * 0.11 - t * 1.9)        * 0.30;
  return w * amp;
}

void main() {
  vec2 px = v_uv * u_res; // 0..(VW,VH)
  float t = u_time;
  float env = envelope(u_age, u_dur);
  vec3 col = vec3(0.0);

  // ---- Title: ACADEMY ----
  if (px.x >= TITLE_OX && px.x < TITLE_OX + TITLE_OW) {
    float yOff = techtechOffset(px.x, t, 14.0 * env);
    // Letter-local Y in [0,1] over the title's output band.
    float ly = (px.y - yOff - (TITLE_OCY - TITLE_OH * 0.5)) / TITLE_OH;
    if (ly >= 0.0 && ly <= 1.0) {
      // Map (px.x, ly) into mask uv covering the title region.
      float mx = TITLE_MX0 + (px.x - TITLE_OX) / TITLE_OW * (TITLE_MX1 - TITLE_MX0);
      float my = TITLE_MY0 + ly * (TITLE_MY1 - TITLE_MY0);
      vec2 muv = vec2(mx, my) / u_maskRes;
      float m = texture(u_mask, muv).r;
      if (m > 0.5) {
        // Vertical Christmas gradient locked to letter-local row.
        // Offset slightly so neither extreme of the palette dominates.
        float pi = clamp(ly * 0.95 + 0.025, 0.0, 1.0);
        vec3 c = texture(u_palette, vec2(pi, 0.5)).rgb;
        col = c;
      }
    }
  }

  // ---- Subtitle: JULEBORD 1986 (milder wobble, snowy white tint) ----
  if (px.x >= SUB_OX && px.x < SUB_OX + SUB_OW) {
    float yOff = techtechOffset(px.x * 1.3, t * 0.85 + 0.7, 4.0 * env);
    float ly = (px.y - yOff - (SUB_OCY - SUB_OH * 0.5)) / SUB_OH;
    if (ly >= 0.0 && ly <= 1.0) {
      float mx = SUB_MX0 + (px.x - SUB_OX) / SUB_OW * (SUB_MX1 - SUB_MX0);
      float my = SUB_MY0 + ly * (SUB_MY1 - SUB_MY0);
      vec2 muv = vec2(mx, my) / u_maskRes;
      float m = texture(u_mask, muv).r;
      if (m > 0.5) {
        // Subtitle in soft snow-white with a faint red/green tinge from the
        // palette top/bottom, but pulled toward white.
        float pi = clamp(ly * 0.6 + 0.2, 0.0, 1.0);
        vec3 c = texture(u_palette, vec2(pi, 0.5)).rgb;
        c = mix(c, vec3(1.0, 0.97, 0.92), 0.55);
        col = c;
      }
    }
  }

  outColor = vec4(col, 1.0);
}
`;

function buildMaskBitmap() {
  const buf = new Uint8Array(MASK_W * MASK_H * 4);
  // Title at x=20 (centers 56px text in 96px-wide region; we have 128px buffer,
  // so center of title = 48 falls at x=(20..76); we want it usable as
  // [TITLE_MX0..TITLE_MX1] = [20..76] which matches.)
  blitText(buf, MASK_W, MASK_H, TITLE, 20, TITLE_Y, 255, 255, 255, 8);
  // Subtitle "JULEBORD 1986 DEMO" -- 18 chars at spacing=7 -> 126 px wide,
  // at x=2 (so spans x=2..127). Note: spacing 7 makes letters touch (glyph
  // cells are 8 wide), but the glyph artwork only uses cols 0..5 so
  // spacing=7 still leaves a 1px gap.
  blitText(buf, MASK_W, MASK_H, SUBTITLE, 2, SUBTITLE_Y, 255, 255, 255, 7);
  return buf;
}

function createMaskTexture(gl) {
  const data = buildMaskBitmap();
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, MASK_W, MASK_H, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

export function academy_techtech(gl) {
  const maskTex = createMaskTexture(gl);
  const palTex  = createPaletteTexture(gl, PALETTES.christmas || PALETTES.plasma);

  const prog = createProgram(gl, VS_FULLSCREEN, FS_TECHTECH);
  const uMask    = gl.getUniformLocation(prog, 'u_mask');
  const uPal     = gl.getUniformLocation(prog, 'u_palette');
  const uTime    = gl.getUniformLocation(prog, 'u_time');
  const uAge     = gl.getUniformLocation(prog, 'u_age');
  const uDur     = gl.getUniformLocation(prog, 'u_dur');
  const uRes     = gl.getUniformLocation(prog, 'u_res');
  const uMaskRes = gl.getUniformLocation(prog, 'u_maskRes');

  // Director gives us t (ms since part start) directly. We don't know the
  // configured part duration here, but the envelope only needs an approximate
  // "long part" value to produce a clean fade-out. Use 12s to match timeline.
  const DUR_SECONDS = 12.0;

  return {
    render(gl, t, fbo) {
      bindFBO(gl, fbo);
      clearFBO(gl, 0, 0, 0, 1);
      gl.useProgram(prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, maskTex);
      gl.uniform1i(uMask, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, palTex);
      gl.uniform1i(uPal, 1);
      const seconds = t / 1000;
      gl.uniform1f(uTime, seconds);
      gl.uniform1f(uAge, seconds);
      gl.uniform1f(uDur, DUR_SECONDS);
      gl.uniform2f(uRes, VW, VH);
      gl.uniform2f(uMaskRes, MASK_W, MASK_H);
      drawQuad(gl);
      gl.activeTexture(gl.TEXTURE0);
    },
    dispose(gl) {
      gl.deleteProgram(prog);
      gl.deleteTexture(maskTex);
      gl.deleteTexture(palTex);
    },
  };
}
