// Outro credits: list of credits with starfield background.
// Visible text strings live in src/text.js (TEXT.outro).
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
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
void main() {
  // Parallax starfield + soft nebula gradient.
  vec2 p = v_uv * vec2(640.0, 512.0);
  vec3 bg = mix(vec3(0.04, 0.02, 0.10), vec3(0.02, 0.05, 0.12), v_uv.y);
  // Slow nebula puff.
  float n = hash(floor(p * 0.012));
  bg += vec3(0.18, 0.08, 0.22) * smoothstep(0.6, 1.0, n) * 0.4;

  for (int layer = 0; layer < 3; layer++) {
    float fl = float(layer + 1);
    vec2 q = p + vec2(u_time * fl * 4.0, 0.0);
    vec2 cell = floor(q / 4.0);
    float h = hash(cell + float(layer) * 17.0);
    float thr = 0.985 - float(layer) * 0.005;
    float sb = smoothstep(thr, 1.0, h) * (0.5 + 0.5 * sin(u_time * 2.0 + h * 30.0));
    if (sb > 0.0) {
      vec2 fc = fract(q / 4.0);
      float d = length(fc - 0.5);
      float dot = smoothstep(0.5, 0.0, d);
      bg += vec3(0.85, 0.9, 1.0) * sb * dot;
    }
  }

  vec4 fg = texture(u_tex, v_uv);
  vec3 col = mix(bg, fg.rgb, fg.a);

  // Falling snow overlay (3 layers of drifting flakes).
  for (int sl = 0; sl < 3; sl++) {
    float fl = float(sl + 1);
    float speed = 18.0 + fl * 12.0;
    vec2 sq = v_uv * vec2(320.0, 256.0) * (0.6 + fl * 0.3);
    sq.y += u_time * speed;
    sq.x += sin(u_time * 0.4 + sq.y * 0.04) * 4.0; // gentle horizontal sway
    vec2 cell = floor(sq / 8.0);
    float h = hash(cell + float(sl) * 53.0);
    float thr = 0.93 - fl * 0.01;
    if (h > thr) {
      vec2 fc = fract(sq / 8.0);
      float d = length(fc - 0.5);
      float flake = smoothstep(0.45, 0.0, d);
      col += vec3(1.0, 1.0, 1.0) * flake * (0.55 + 0.45 / fl);
    }
  }

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
      if (_atlas.data[idx]>0) by |= (1 << (7-x));
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
function centerText(text, scale) {
  return ((VW - text.length*8*scale) / 2) | 0;
}

const LINES = TEXT.outro.lines;

export function outro_credits(gl) {
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
      // Compute total block height. Non-empty lines occupy 8*scale + LINE_GAP,
      // empty entries are pure spacers of SPACER px (no extra trailing gap so
      // the total stays within VH=256).
      const LINE_GAP = 4;
      const SPACER = 6;
      let totalH = 0;
      for (const [s, sc] of LINES) totalH += s ? 8*sc + LINE_GAP : SPACER;
      let y = ((VH - totalH) / 2) | 0;
      const fade = Math.min(1, tt / 1.0);
      for (const [s, sc] of LINES) {
        if (s) {
          const x = centerText(s, sc);
          const r = 200 + (Math.sin(tt*1.5 + y*0.05) * 0.5 + 0.5)*55 | 0;
          const g = 180 + (Math.sin(tt*1.5 + 2 + y*0.05) * 0.5 + 0.5)*75 | 0;
          const b = 60  + (Math.sin(tt*1.5 + 4 + y*0.05) * 0.5 + 0.5)*120 | 0;
          // Drop shadow first (offset +sc, +sc px).
          const sh = (40 * fade) | 0;
          drawText(buf, VW, VH, s, x + sc, y + sc, sc, sh, sh, sh);
          drawText(buf, VW, VH, s, x, y, sc, (r*fade)|0, (g*fade)|0, (b*fade)|0);
          y += 8*sc + LINE_GAP;
        } else {
          y += SPACER;
        }
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
