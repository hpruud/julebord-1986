// Sine scroller: renders a looping text with per-character vertical sine offset.
// Uses CPU rendering into a Uint8Array, uploaded to a texture each frame for simplicity.
// Visible text string lives in src/text.js (TEXT.sinescroller).
import { createProgram, VS_FULLSCREEN, VW, VH } from '../gl/context.js';
import { drawQuad } from '../gl/quad.js';
import { bindFBO } from '../gl/framebuffer.js';
import { buildFontAtlas } from '../util/font.js';
import { TEXT as TEXT_DATA } from '../text.js';

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_tex;
uniform float u_time;

float bar(float y, float c, float w) {
  return smoothstep(w, 0.0, abs(y - c));
}

void main() {
  // Copper-bar field background to give the scroller proper Amiga vibe.
  vec3 bg = mix(vec3(0.02, 0.02, 0.06), vec3(0.06, 0.04, 0.14), v_uv.y);
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float center = 0.5 + sin(u_time * (0.4 + fi * 0.1) + fi) * 0.45;
    float w = 0.04 + 0.01 * sin(u_time + fi);
    float k = bar(v_uv.y, center, w);
    vec3 c;
    if (i == 0)      c = vec3(0.95, 0.20, 0.20);  // red
    else if (i == 1) c = vec3(0.20, 0.85, 0.30);  // green
    else if (i == 2) c = vec3(1.0, 0.95, 0.30);   // gold
    else if (i == 3) c = vec3(0.95, 0.95, 1.0);   // snow white
    else             c = vec3(0.85, 0.30, 0.30);  // soft red
    bg += c * k * 0.55;
  }

  vec4 fg = texture(u_tex, v_uv);
  outColor = vec4(mix(bg, fg.rgb, fg.a), 1.0);
}
`;

const TEXT = TEXT_DATA.sinescroller;

export function sinescroller(gl) {
  const prog = createProgram(gl, VS_FULLSCREEN, FS);
  const uTex = gl.getUniformLocation(prog, 'u_tex');
  const uTime = gl.getUniformLocation(prog, 'u_time');

  // CPU buffer + texture
  const buf = new Uint8Array(VW * VH * 4);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, VW, VH, 0, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // Sync the scroll so the text enters cleanly from the right at part start
  // and the LAST character exits the left edge exactly when the part ends.
  // Part duration lives in src/timeline.js — keep these in sync.
  //   startOffset = -VW            -> char 0 sits just off the right edge
  //   endOffset   = TEXT.length*16 -> last char sits just off the left edge
  //   travel      = endOffset - startOffset (covers both off-screen margins)
  //   speed       = travel / PART_DUR_S
  // Single linear pass (no modulo loop), so the screen is empty during the
  // fade-in (text not yet entered) and during the fade-out (text already gone).
  const PART_DUR_S = 42;            // matches timeline.js sinescroller.dur (ms/1000)
  const charW = 16;                 // 8 px glyph * 2 scale (see drawScaled)
  const startOffset = -VW;
  const endOffset = TEXT.length * charW;
  const totalTravelPx = endOffset - startOffset;
  const speed = totalTravelPx / PART_DUR_S; // ~115.81 px/s for current text

  return {
    render(gl, t, fbo) {
      // clear buf
      buf.fill(0);
      const tt = t / 1000;
      // Linear, non-looping offset that starts off-right and ends off-left.
      // Clamp to endOffset so a runtime-extended part duration just leaves
      // an empty screen instead of dragging the text further left forever.
      const offset = Math.min(startOffset + tt * speed, endOffset);
      const baseY = (VH/2 - 16) | 0;
      // Single-pass draw. No '+ 4' wrap-around copies and no modulo on the
      // index — the text scrolls across exactly once and then the screen is
      // empty, which is what we want right before the fade-out transition.
      for (let i = 0; i < TEXT.length; i++) {
        const ch = TEXT[i];
        const x = (i * charW) - (offset | 0);
        if (x < -16 || x > VW + 16) continue;
        // Stacked sine for richer wobble.
        const yWobble = Math.sin(tt * 2 + i * 0.5) * 24
                      + Math.sin(tt * 0.7 + i * 0.13) * 14;
        const y = baseY + Math.round(yWobble);
        // Color cycling - per-char rainbow with brightness pulse.
        const hue = (i * 0.25 + tt * 1.5);
        const r = 128 + (Math.sin(hue) * 0.5 + 0.5) * 127 | 0;
        const g = 128 + (Math.sin(hue + 2.094) * 0.5 + 0.5) * 127 | 0;
        const b = 128 + (Math.sin(hue + 4.188) * 0.5 + 0.5) * 127 | 0;
        // Drop shadow first (offset +2,+2, dark blue).
        drawScaled(buf, VW, VH, ch, x + 2, y + 2, 2, 10, 5, 25);
        drawScaled(buf, VW, VH, ch, x, y, 2, r, g, b);
      }
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, VW, VH, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      bindFBO(gl, fbo);
      gl.useProgram(prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(uTex, 0);
      gl.uniform1f(uTime, tt);
      drawQuad(gl);
    },
    dispose(gl) {
      gl.deleteProgram(prog);
      gl.deleteTexture(tex);
    }
  };
}

// Draw a glyph at integer scale. We render 8x8, each pixel becomes scale x scale in output.
function drawScaled(buf, bw, bh, ch, x, y, scale, r, g, b) {
  const FONT_GLYPH = getGlyph(ch);
  for (let gy = 0; gy < 8; gy++) {
    const row = FONT_GLYPH[gy];
    for (let gx = 0; gx < 8; gx++) {
      if (!((row >> (7 - gx)) & 1)) continue;
      for (let sy = 0; sy < scale; sy++) {
        const py = y + gy*scale + sy;
        if (py < 0 || py >= bh) continue;
        for (let sx = 0; sx < scale; sx++) {
          const px = x + gx*scale + sx;
          if (px < 0 || px >= bw) continue;
          const idx = (py*bw + px) * 4;
          buf[idx+0] = r;
          buf[idx+1] = g;
          buf[idx+2] = b;
          buf[idx+3] = 255;
        }
      }
    }
  }
}

// helper to get glyph bytes via blitChar's font (re-import not feasible; build local cache)
const _glyphCache = (() => {
  // Reconstruct glyphs from atlas bytes back to row bytes for fast access.
  const { data, w } = buildFontAtlas();
  const cache = {};
  for (let code = 0; code < 128; code++) {
    const bytes = new Uint8Array(8);
    for (let y = 0; y < 8; y++) {
      let byte = 0;
      for (let x = 0; x < 8; x++) {
        const idx = ((y * w) + (code * 8 + x)) * 4;
        if (data[idx] > 0) byte |= (1 << (7 - x));
      }
      bytes[y] = byte;
    }
    cache[code] = bytes;
  }
  return cache;
})();
function getGlyph(ch) {
  let c = ch.charCodeAt(0);
  if (c >= 97 && c <= 122) c -= 32; // lowercase -> upper
  return _glyphCache[c] || _glyphCache[32];
}
