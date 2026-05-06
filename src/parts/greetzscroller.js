// Greetz scroller: vertical scrolling multi-line credits.
// Visible text strings live in src/text.js (TEXT.greetz).
import { createProgram, VS_FULLSCREEN, VW, VH } from '../gl/context.js';
import { drawQuad } from '../gl/quad.js';
import { bindFBO } from '../gl/framebuffer.js';
import { buildFontAtlas } from '../util/font.js';
import { TEXT } from '../text.js';

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_tex;
uniform float u_time;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  // Deep purple gradient with twinkling stars and a sweeping aurora.
  vec3 bg = mix(vec3(0.04, 0.02, 0.10), vec3(0.18, 0.06, 0.28), v_uv.y);

  // Aurora wave: vertical bands of soft color sliding sideways.
  float wave = sin(v_uv.y * 18.0 - u_time * 0.6 + sin(v_uv.x * 4.0 + u_time * 0.4) * 1.5);
  bg += vec3(0.30, 0.10, 0.55) * smoothstep(0.5, 1.0, wave) * 0.35;

  // Twinkling stars.
  vec2 p = v_uv * vec2(640.0, 512.0);
  for (int layer = 0; layer < 2; layer++) {
    float fl = float(layer + 1);
    vec2 q = p + vec2(0.0, u_time * fl * 5.0); // stars drift down
    vec2 cell = floor(q / 5.0);
    float h = hash(cell + float(layer) * 31.0);
    if (h > 0.985) {
      vec2 fc = fract(q / 5.0);
      float d = length(fc - 0.5);
      float dot = smoothstep(0.5, 0.0, d);
      float tw = 0.4 + 0.6 * sin(u_time * 3.0 + h * 30.0);
      bg += vec3(1.0, 0.95, 0.85) * dot * tw * 0.7 / fl;
    }
  }

  vec4 fg = texture(u_tex, v_uv);
  vec3 col = mix(bg, fg.rgb, fg.a);

  // Falling snow overlay (3 drifting layers).
  for (int sl = 0; sl < 3; sl++) {
    float fl = float(sl + 1);
    float speed = 16.0 + fl * 10.0;
    vec2 sq = v_uv * vec2(320.0, 256.0) * (0.6 + fl * 0.3);
    sq.y += u_time * speed;
    sq.x += sin(u_time * 0.4 + sq.y * 0.04) * 4.0;
    vec2 cell = floor(sq / 8.0);
    float h = hash(cell + float(sl) * 53.0);
    float thr = 0.93 - fl * 0.01;
    if (h > thr) {
      vec2 fc = fract(sq / 8.0);
      float d = length(fc - 0.5);
      float flake = smoothstep(0.45, 0.0, d);
      col += vec3(1.0, 1.0, 1.0) * flake * (0.5 + 0.4 / fl);
    }
  }

  // Subtle scanlines.
  col *= 0.92 + 0.08 * sin(v_uv.y * 320.0 * 3.14159);

  outColor = vec4(col, 1.0);
}
`;

const _atlas = buildFontAtlas();
function _getGlyph(ch) {
  let c = ch.charCodeAt(0);
  if (c >= 97 && c <= 122) c -= 32;
  const w = _atlas.w;
  const bytes = new Uint8Array(8);
  for (let y=0;y<8;y++) {
    let by=0;
    for (let x=0;x<8;x++) {
      const idx=((y*w)+(c*8+x))*4;
      if (_atlas.data[idx]>0) by |= (1<<(7-x));
    }
    bytes[y]=by;
  }
  return bytes;
}
function drawScaled(buf, bw, bh, ch, x, y, scale, r, g, b) {
  const glyph = _getGlyph(ch);
  for (let gy=0; gy<8; gy++) {
    const row = glyph[gy];
    for (let gx=0; gx<8; gx++) {
      if (!((row >> (7-gx)) & 1)) continue;
      for (let sy=0; sy<scale; sy++) {
        const py=y+gy*scale+sy;
        if (py<0||py>=bh) continue;
        for (let sx=0; sx<scale; sx++) {
          const px=x+gx*scale+sx;
          if (px<0||px>=bw) continue;
          const idx=(py*bw+px)*4;
          buf[idx]=r; buf[idx+1]=g; buf[idx+2]=b; buf[idx+3]=255;
        }
      }
    }
  }
}
function drawText(buf, bw, bh, text, x, y, scale, r, g, b) {
  for (let i=0;i<text.length;i++) drawScaled(buf,bw,bh,text[i],x+i*8*scale,y,scale,r,g,b);
}

const GREETZ = TEXT.greetz.list;

export function greetzscroller(gl) {
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

  const lineH = 18;
  const totalH = GREETZ.length * lineH;

  return {
    render(gl, t, fbo) {
      buf.fill(0);
      const tt = t/1000;
      const speed = 24; // px/s
      const off = tt * speed;
      for (let i=0;i<GREETZ.length;i++) {
        const s = GREETZ[i];
        if (!s) continue;
        const y = (VH + 8) - Math.round(off) + i * lineH;
        if (y < -16 || y > VH+8) continue;
        const x = ((VW - s.length*8*1) / 2) | 0;
        const phase = tt + i*0.25;
        const r = 200 + (Math.sin(phase) * 0.5 + 0.5) * 55 | 0;
        const g = 180 + (Math.sin(phase+1) * 0.5 + 0.5) * 75 | 0;
        const b = 80  + (Math.sin(phase+2) * 0.5 + 0.5) * 175 | 0;
        // Drop shadow.
        drawText(buf, VW, VH, s, x + 1, y + 1, 1, 15, 5, 25);
        drawText(buf, VW, VH, s, x, y, 1, r, g, b);
      }
      // Header banner top with shadow + glow color cycle.
      const hdr = TEXT.greetz.header;
      const hx = ((VW - hdr.length*8) / 2) | 0;
      // Christmas red->gold pulse.
      const hp = (Math.sin(tt * 2) * 0.5 + 0.5);
      const hr = (200 + 55 * hp) | 0;
      const hg = (60  + 156 * hp) | 0;
      const hb = (50  + 27  * hp) | 0;
      drawText(buf, VW, VH, hdr, hx + 1, 9, 1, 30, 10, 5);
      drawText(buf, VW, VH, hdr, hx, 8, 1, hr, hg, hb);

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
