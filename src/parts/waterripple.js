// Heightmap water ripple over a procedural pixel image of a snowflake +
// "ACADEMY JULEBORD 1986" text. Classic 90s PC demo effect: two CPU height buffers
// (current and previous) plus the standard (N+S+E+W)/2 - prev integrator
// with damping. The shader samples the source image with x/y offsets
// derived from the height gradient to produce refraction.
import { createProgram, VS_FULLSCREEN, VW, VH } from '../gl/context.js';
import { drawQuad } from '../gl/quad.js';
import { bindFBO } from '../gl/framebuffer.js';

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_src;     // base image
uniform sampler2D u_height;  // R = signed height encoded as (h+128)
uniform vec2 u_res;
uniform float u_time;

void main() {
  // Read height at neighbours to estimate gradient -> refraction offset.
  vec2 px = 1.0 / u_res;
  float hL = texture(u_height, v_uv - vec2(px.x, 0.0)).r;
  float hR = texture(u_height, v_uv + vec2(px.x, 0.0)).r;
  float hD = texture(u_height, v_uv - vec2(0.0, px.y)).r;
  float hU = texture(u_height, v_uv + vec2(0.0, px.y)).r;
  vec2 grad = vec2(hR - hL, hU - hD);
  vec2 uv = v_uv - grad * 0.6;
  vec3 col = texture(u_src, uv).rgb;
  // Specular-ish highlight from gradient slope.
  float spec = clamp(dot(normalize(vec3(grad * 6.0, 1.0)),
                         normalize(vec3(0.4, 0.6, 0.7))), 0.0, 1.0);
  col += vec3(0.4, 0.7, 1.0) * pow(spec, 8.0) * 0.35;
  // Tint everything cool to sell the "underwater" look.
  col = mix(col, col * vec3(0.7, 0.9, 1.15), 0.4);
  outColor = vec4(col, 1.0);
}
`;

// Build the base image once: dark teal background, big snowflake, title text.
function buildBaseImage() {
  const buf = new Uint8Array(VW * VH * 4);
  for (let i = 0; i < VW * VH; i++) {
    const x = i % VW, y = (i / VW) | 0;
    // Subtle vertical gradient.
    const t = y / VH;
    const r = (10 + t * 14) | 0;
    const g = (28 + t * 22) | 0;
    const b = (55 + t * 30) | 0;
    const j = i * 4;
    buf[j] = r; buf[j+1] = g; buf[j+2] = b; buf[j+3] = 255;
  }
  // Draw a 6-fold-symmetric snowflake centered on the canvas.
  const cx = VW / 2, cy = VH / 2;
  const arms = 6;
  const set = (x, y, r, g, b) => {
    if (x < 0 || x >= VW || y < 0 || y >= VH) return;
    const j = ((y | 0) * VW + (x | 0)) * 4;
    buf[j] = r; buf[j+1] = g; buf[j+2] = b; buf[j+3] = 255;
  };
  for (let a = 0; a < arms; a++) {
    const ang = (a / arms) * Math.PI * 2;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    // Main arm
    for (let r = 0; r < 90; r++) {
      const x = cx + ca * r;
      const y = cy + sa * r;
      const w = 220 - r;
      set(x, y, w, w, 255);
      set(x + 1, y, w, w, 255);
      set(x, y + 1, w, w, 255);
    }
    // Branch tufts every 14 px
    for (let r = 16; r < 80; r += 14) {
      for (let b2 = -1; b2 <= 1; b2 += 2) {
        const bAng = ang + b2 * 0.9;
        const cb = Math.cos(bAng), sb = Math.sin(bAng);
        const baseX = cx + ca * r;
        const baseY = sa * r + cy;
        for (let k = 0; k < 12; k++) {
          set(baseX + cb * k, baseY + sb * k, 200, 220, 255);
        }
      }
    }
  }
  // Draw the title text centered using tiny 5x7 block-letter glyphs.
  // We avoid pulling in the font atlas to keep this part self-contained;
  // a quick block-letter rasterizer works fine at this resolution.
  const stroke = (x, y, w, h, r, g, b) => {
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) set(x + xx, y + yy, r, g, b);
  };
  // Block-letter glyphs as 5x7 boolean grids.
  const G = {
    J: ['00001','00001','00001','00001','00001','10001','01110'],
    U: ['10001','10001','10001','10001','10001','10001','01110'],
    L: ['10000','10000','10000','10000','10000','10000','11111'],
    E: ['11111','10000','10000','11110','10000','10000','11111'],
    B: ['11110','10001','10001','11110','10001','10001','11110'],
    O: ['01110','10001','10001','10001','10001','10001','01110'],
    R: ['11110','10001','10001','11110','10100','10010','10001'],
    D: ['11110','10001','10001','10001','10001','10001','11110'],
    A: ['01110','10001','10001','11111','10001','10001','10001'],
    C: ['01110','10001','10000','10000','10000','10001','01110'],
    M: ['10001','11011','10101','10001','10001','10001','10001'],
    Y: ['10001','10001','01010','00100','00100','00100','00100'],
    '1': ['00100','01100','00100','00100','00100','00100','01110'],
    '9': ['01110','10001','10001','01111','00001','10001','01110'],
    '8': ['01110','10001','10001','01110','10001','10001','01110'],
    '6': ['01110','10000','10000','11110','10001','10001','01110'],
    ' ': ['00000','00000','00000','00000','00000','00000','00000'],
  };
  const drawLine = (text, scale, ty, lwOverride) => {
    const lw = lwOverride != null ? lwOverride : 6 * scale;
    const totalW = text.length * lw;
    const startX = ((VW - totalW) / 2) | 0;
    for (let i = 0; i < text.length; i++) {
      const grid = G[text[i]];
      if (!grid) continue;
      for (let gy = 0; gy < 7; gy++) {
        for (let gx = 0; gx < 5; gx++) {
          if (grid[gy][gx] === '1') {
            stroke(startX + i * lw + gx * scale, ty + gy * scale, scale, scale, 230, 200, 90);
          }
        }
      }
    }
  };
  // Top subtitle above the snowflake, big title below it. The title is
  // packed slightly tighter (lw=16 instead of the usual 18) so the full
  // "JULEBORD 1986 DEMO" sits comfortably within the 320-wide frame.
  drawLine('ACADEMY', 3, 8);
  drawLine('JULEBORD 1986 DEMO', 3, VH - 40, 16);
  return buf;
}

export function waterripple(gl) {
  const prog = createProgram(gl, `#version 300 es
in vec2 a_pos; out vec2 v_uv;
void main(){ v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }
`, FS);
  const uSrc = gl.getUniformLocation(prog, 'u_src');
  const uHt  = gl.getUniformLocation(prog, 'u_height');
  const uRes = gl.getUniformLocation(prog, 'u_res');
  const uTime = gl.getUniformLocation(prog, 'u_time');

  // Base image texture
  const baseBuf = buildBaseImage();
  const baseTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, baseTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, VW, VH, 0, gl.RGBA, gl.UNSIGNED_BYTE, baseBuf);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // Height buffers (signed int as Int16Array)
  const W = VW, H = VH;
  let h0 = new Int16Array(W * H);
  let h1 = new Int16Array(W * H);
  // RGBA upload buffer for height (we encode height into R; offset by 128).
  const htBuf = new Uint8Array(W * H * 4);
  const htTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, htTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, htBuf);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  let lastDrop = 0;

  return {
    render(gl, t, fbo) {
      // Periodic random drops to keep the surface alive.
      if (t - lastDrop > 220) {
        lastDrop = t;
        const dx = 8 + ((Math.random() * (W - 16)) | 0);
        const dy = 8 + ((Math.random() * (H - 16)) | 0);
        const amp = 700 + ((Math.random() * 400) | 0);
        const r = 3;
        for (let yy = -r; yy <= r; yy++) for (let xx = -r; xx <= r; xx++) {
          if (xx*xx + yy*yy <= r*r) h0[(dy+yy)*W + (dx+xx)] = amp;
        }
      }
      // Ripple integration: new = ((N+S+E+W)/2) - prev, damped.
      for (let y = 1; y < H - 1; y++) {
        const row = y * W;
        for (let x = 1; x < W - 1; x++) {
          const i = row + x;
          let n = (h0[i-1] + h0[i+1] + h0[i-W] + h0[i+W]) >> 1;
          n -= h1[i];
          n -= n >> 5; // ~3% damping
          h1[i] = n;
        }
      }
      // swap
      const tmp = h0; h0 = h1; h1 = tmp;
      // Encode h0 -> R channel, clamped and offset by 128.
      for (let i = 0, j = 0; i < W * H; i++, j += 4) {
        let v = h0[i] >> 3;       // scale down: shader expects ~unit range
        if (v < -127) v = -127;
        if (v > 127) v = 127;
        htBuf[j] = (v + 128) & 0xff;
        htBuf[j+1] = htBuf[j];
        htBuf[j+2] = htBuf[j];
        htBuf[j+3] = 255;
      }
      gl.bindTexture(gl.TEXTURE_2D, htTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, htBuf);

      bindFBO(gl, fbo);
      gl.useProgram(prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, baseTex);
      gl.uniform1i(uSrc, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, htTex);
      gl.uniform1i(uHt, 1);
      gl.uniform2f(uRes, W, H);
      gl.uniform1f(uTime, t / 1000);
      drawQuad(gl);
      gl.activeTexture(gl.TEXTURE0);
    },
    dispose(gl) {
      gl.deleteProgram(prog);
      gl.deleteTexture(baseTex);
      gl.deleteTexture(htTex);
    },
  };
}
