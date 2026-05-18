// Santa multiplexer: classic Amiga sprite-multiplexer effect. Two stacked
// rows of tiny Santa-sleigh sprites ride sine waves across the screen, over
// a slow-scrolling starfield. Pre-rasterized sprite gets blitted many times
// per frame into a CPU buffer.
import { createProgram, VS_FULLSCREEN, VW, VH } from '../gl/context.js';
import { drawQuad } from '../gl/quad.js';
import { bindFBO } from '../gl/framebuffer.js';

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_tex;
void main() {
  vec3 col = texture(u_tex, v_uv).rgb;
  // Subtle scanlines for retro feel.
  float scan = 0.92 + 0.08 * sin(v_uv.y * float(${VH}) * 3.14159);
  col *= scan;
  outColor = vec4(col, 1.0);
}
`;

// Sprite dimensions.
const SW = 32, SH = 12;

function buildSprite() {
  // Tiny pixel-art Santa sleigh + 2 reindeer. 0 alpha = transparent.
  // Encoded as a 32x12 array of color codes:
  //   . = transparent, R = red, P = pink, K = black, W = white,
  //   B = brown, G = green leaves, Y = yellow rein/nose
  const art = [
    "................................",
    "..............RRRR..............",
    ".............RWWWR..............",
    ".....BB.....RWPPWR..............",
    "..BBBBBBB..RRWWWWR..............",
    ".BWWWWWWB.RYRRRRRR..BB...BB.....",
    "BWWPPPPWWBYY.....RR.BBB.BBB.....",
    "BWWWWWWWWB.......RR.B.B.B.B.....",
    ".BBBBBBBB........RRYBBBYBBB.....",
    "..K.....K.........YYY.YYY.......",
    "..K.....K.........Y...Y.........",
    "................................",
  ];
  const map = {
    '.': [0,0,0,0],
    'R': [220,40,50,255],
    'P': [250,200,200,255],
    'K': [20,20,20,255],
    'W': [240,240,240,255],
    'B': [110,55,20,255],
    'G': [60,160,60,255],
    'Y': [255,210,80,255],
  };
  const buf = new Uint8Array(SW * SH * 4);
  for (let y = 0; y < SH; y++) {
    const row = art[y];
    for (let x = 0; x < SW; x++) {
      const c = map[row[x]] || map['.'];
      const j = (y * SW + x) * 4;
      buf[j] = c[0]; buf[j+1] = c[1]; buf[j+2] = c[2]; buf[j+3] = c[3];
    }
  }
  return buf;
}

export function santa_multiplex(gl) {
  const prog = createProgram(gl, VS_FULLSCREEN, FS);
  const uTex = gl.getUniformLocation(prog, 'u_tex');

  const buf = new Uint8Array(VW * VH * 4);
  const sprite = buildSprite();

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, VW, VH, 0, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // Pre-render stars at fixed positions (slow horizontal scroll via offset).
  const N_STARS = 120;
  const starX = new Float32Array(N_STARS);
  const starY = new Float32Array(N_STARS);
  const starL = new Uint8Array(N_STARS); // layer 1..3
  for (let i = 0; i < N_STARS; i++) {
    starX[i] = Math.random() * VW;
    starY[i] = Math.random() * VH;
    starL[i] = 1 + ((Math.random() * 3) | 0);
  }

  function plotStar(x, y, layer) {
    if (x < 0 || x >= VW || y < 0 || y >= VH) return;
    const j = ((y | 0) * VW + (x | 0)) * 4;
    const c = layer === 1 ? 220 : layer === 2 ? 170 : 110;
    buf[j] = c; buf[j+1] = c; buf[j+2] = Math.min(255, c + 20); buf[j+3] = 255;
  }

  function blitSprite(dstX, dstY) {
    const x0 = dstX | 0, y0 = dstY | 0;
    for (let sy = 0; sy < SH; sy++) {
      const dy = y0 + sy;
      if (dy < 0 || dy >= VH) continue;
      for (let sx = 0; sx < SW; sx++) {
        const dx = x0 + sx;
        if (dx < 0 || dx >= VW) continue;
        const sj = (sy * SW + sx) * 4;
        if (sprite[sj + 3] === 0) continue;
        const dj = (dy * VW + dx) * 4;
        buf[dj]   = sprite[sj];
        buf[dj+1] = sprite[sj+1];
        buf[dj+2] = sprite[sj+2];
        buf[dj+3] = 255;
      }
    }
  }

  let tt = 0, lastT = 0;
  const COUNT_PER_ROW = 12;

  return {
    render(gl, t, fbo) {
      const dt = lastT === 0 ? 0.016 : Math.min(0.05, (t - lastT) / 1000);
      lastT = t;
      tt += dt;

      // Clear with dark blue sky gradient.
      for (let y = 0; y < VH; y++) {
        const ty = y / VH;
        const r = (6 + ty * 14) | 0;
        const g = (8 + ty * 10) | 0;
        const b = (28 + ty * 30) | 0;
        for (let x = 0; x < VW; x++) {
          const j = (y * VW + x) * 4;
          buf[j] = r; buf[j+1] = g; buf[j+2] = b; buf[j+3] = 255;
        }
      }
      // Stars: scroll based on layer.
      for (let i = 0; i < N_STARS; i++) {
        const layer = starL[i];
        const off = tt * (8 + layer * 6);
        let x = (starX[i] - off) % VW;
        if (x < 0) x += VW;
        plotStar(x, starY[i], layer);
      }

      // Two rows of sprite copies sliding L->R along sine waves.
      const baseY1 = VH * 0.30;
      const baseY2 = VH * 0.60;
      const spacing = VW / COUNT_PER_ROW;
      const scroll1 =  tt * 26.0;
      const scroll2 = -tt * 22.0;
      for (let i = 0; i < COUNT_PER_ROW; i++) {
        const phase = i / COUNT_PER_ROW * Math.PI * 2;
        // Row 1.
        let x1 = ((i * spacing + scroll1) % (VW + SW)) - SW;
        if (x1 < -SW) x1 += VW + SW;
        const y1 = baseY1 + Math.sin(tt * 1.4 + phase * 2) * 36 - SH / 2;
        blitSprite(x1, y1);
        // Row 2 (offset phase + opposite scroll).
        let x2 = (VW + SW) - (((i * spacing - scroll2) % (VW + SW)) + SW);
        if (x2 < -SW) x2 += VW + SW;
        if (x2 >= VW) x2 -= VW + SW;
        const y2 = baseY2 + Math.sin(tt * 1.6 + phase * 2 + Math.PI) * 30 - SH / 2;
        blitSprite(x2, y2);
      }

      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, VW, VH, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      bindFBO(gl, fbo);
      gl.useProgram(prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(uTex, 0);
      drawQuad(gl);
    },
    dispose(gl) {
      gl.deleteProgram(prog);
      gl.deleteTexture(tex);
    },
  };
}
