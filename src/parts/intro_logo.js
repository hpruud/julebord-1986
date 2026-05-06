// Intro logo: animated big logo with copper-bar fill behind big letters.
// Visible text strings live in src/text.js (TEXT.intro).
import { createProgram, VS_FULLSCREEN, VW, VH } from '../gl/context.js';
import { drawQuad } from '../gl/quad.js';
import { bindFBO } from '../gl/framebuffer.js';
import { blitChar } from '../util/font.js';
import { TEXT } from '../text.js';

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_tex;
uniform float u_time;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  // Background: deep starfield + rolling copper bands at the bottom.
  vec3 bg = vec3(0.02, 0.01, 0.06);

  // Stars (3 layers).
  vec2 q = v_uv * vec2(640.0, 512.0);
  for (int layer = 0; layer < 3; layer++) {
    float fl = float(layer + 1);
    vec2 qq = q + vec2(u_time * fl * 6.0, 0.0);
    vec2 g = floor(qq / 4.0);
    float h = hash(g + float(layer) * 17.0);
    float thr = 0.985 - float(layer) * 0.005;
    float br = smoothstep(thr, 1.0, h);
    if (br > 0.0) {
      vec2 fc = fract(qq / 4.0);
      float d = length(fc - 0.5);
      float dot = smoothstep(0.5, 0.0, d);
      bg += vec3(0.7, 0.85, 1.0) * br * dot * (0.4 + 0.6 / fl);
    }
  }

  // Copper bands at the bottom third.
  float by = clamp((v_uv.y - 0.55) / 0.45, 0.0, 1.0);
  if (by > 0.0) {
    float w1 = sin(by * 22.0 + u_time * 1.6) * 0.5 + 0.5;
    float w2 = sin(by * 9.0 - u_time * 0.9) * 0.5 + 0.5;
    vec3 cop = mix(vec3(0.05, 0.10, 0.04), vec3(0.55, 0.10, 0.10), w1);
    cop = mix(cop, vec3(1.0, 0.85, 0.30), w2 * 0.5);
    bg = mix(bg, cop, smoothstep(0.0, 0.6, by) * 0.85);
  }

  // Sweeping diagonal spotlight.
  float sl = sin(v_uv.x * 6.2831 - u_time * 1.2 + v_uv.y * 4.0) * 0.5 + 0.5;
  bg += vec3(0.3, 0.25, 0.55) * smoothstep(0.85, 1.0, sl) * 0.3;

  vec4 fg = texture(u_tex, v_uv);
  outColor = vec4(mix(bg, fg.rgb, fg.a), 1.0);
}
`;

const FONT_GLYPH = (() => {
  // mirrored from font.js cache approach
  return null; // we just use blitChar with scale via expand fn below.
})();

function drawScaled(buf, bw, bh, ch, x, y, scale, r, g, b) {
  // Use blitChar by rasterizing onto a temp tiny array, then up-scale by writing scaled pixels
  // Simpler: re-implement glyph lookup from font.js via blitChar (not exported). Instead:
  // Use the public buildFontAtlas to get a glyph row.
  const glyph = _getGlyph(ch);
  for (let gy = 0; gy < 8; gy++) {
    const row = glyph[gy];
    for (let gx = 0; gx < 8; gx++) {
      if (!((row >> (7 - gx)) & 1)) continue;
      for (let sy = 0; sy < scale; sy++) {
        const py = y + gy*scale + sy;
        if (py < 0 || py >= bh) continue;
        for (let sx = 0; sx < scale; sx++) {
          const px = x + gx*scale + sx;
          if (px < 0 || px >= bw) continue;
          const idx = (py*bw + px)*4;
          buf[idx+0]=r; buf[idx+1]=g; buf[idx+2]=b; buf[idx+3]=255;
        }
      }
    }
  }
}
function drawText(buf, bw, bh, text, x, y, scale, r, g, b, charW=8) {
  for (let i=0;i<text.length;i++) drawScaled(buf,bw,bh,text[i],x+i*charW*scale,y,scale,r,g,b);
}

import { buildFontAtlas } from '../util/font.js';
const _atlas = buildFontAtlas();
function _getGlyph(ch) {
  let c = ch.charCodeAt(0);
  if (c >= 97 && c <= 122) c -= 32;
  const w = _atlas.w;
  const bytes = new Uint8Array(8);
  for (let y=0;y<8;y++) {
    let by = 0;
    for (let x=0;x<8;x++) {
      const idx = ((y * w) + (c*8 + x)) * 4;
      if (_atlas.data[idx] > 0) by |= (1 << (7 - x));
    }
    bytes[y] = by;
  }
  return bytes;
}

export function intro_logo(gl) {
  const prog = createProgram(gl, VS_FULLSCREEN, FS);
  const uTex = gl.getUniformLocation(prog, 'u_tex');
  const uTime = gl.getUniformLocation(prog, 'u_time');

  const buf = new Uint8Array(VW*VH*4);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, VW, VH, 0, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  return {
    render(gl, t, fbo) {
      buf.fill(0);
      const tt = t / 1000;
      // Big logo, scale 4. Source string from src/text.js.
      const big = TEXT.intro.big;
      const bigScale = 4;
      const bigW = big.length * 8 * bigScale;
      const bigX = ((VW - bigW) / 2) | 0;
      // Vertically center the whole stack (big=32, gap=8, line2=16, gap=10, line3=16 = ~82).
      const bigY = ((VH - 82) / 2) | 0;
      // Drop shadow first (offset +3, +3, deep christmas green).
      for (let i = 0; i < big.length; i++) {
        drawScaled(buf, VW, VH, big[i], bigX + i*8*bigScale + 3, bigY + 3, bigScale, 5, 30, 10);
      }
      // Christmas wave: red <-> gold <-> green per character.
      for (let i = 0; i < big.length; i++) {
        const phase = tt * 2 + i * 0.5;
        const k = Math.sin(phase) * 0.5 + 0.5;
        const k2 = Math.sin(phase + 1.7) * 0.5 + 0.5;
        const r = (220 * (1 - k2 * 0.6) + 30 * k) | 0;
        const g = (40 + 200 * k2 * (1 - k * 0.5)) | 0;
        const b = (30 + 60 * k) | 0;
        drawScaled(buf, VW, VH, big[i], bigX + i*8*bigScale, bigY, bigScale, r, g, b);
      }
      // Line 2: scale 2 (text from src/text.js).
      const sub1 = TEXT.intro.line2;
      const sub1Scale = 2;
      const sub1W = sub1.length * 8 * sub1Scale;
      const sub1X = ((VW - sub1W) / 2) | 0;
      const sub1Y = bigY + 8*bigScale + 8;
      const fade1 = Math.min(1, Math.max(0, (tt - 0.3) / 0.5));
      const k1 = (220 * fade1) | 0;
      drawText(buf, VW, VH, sub1, sub1X, sub1Y, sub1Scale, k1, k1, k1);
      // Line 3: scale 2, gold with red drop shadow (text from src/text.js).
      const sub = TEXT.intro.line3;
      const subScale = 2;
      const subW = sub.length * 8 * subScale;
      const subX = ((VW - subW) / 2) | 0;
      const subY = sub1Y + 8*sub1Scale + 10;
      const fade = Math.min(1, Math.max(0, (tt - 0.9) / 0.6));
      const kr = (255 * fade) | 0;
      const kg = (216 * fade) | 0;
      const kb = (77  * fade) | 0;
      drawText(buf, VW, VH, sub, subX + subScale, subY + subScale, subScale, 40, 5, 5);
      drawText(buf, VW, VH, sub, subX, subY, subScale, kr, kg, kb);

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
