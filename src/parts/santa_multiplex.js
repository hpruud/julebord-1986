// Santa multiplexer: classic Amiga sprite-multiplexer effect. Three stacked
// rows of bold pixel-art Christmas stars / Santa medallions ride sine waves
// across a slow-scrolling starfield. A single sprite is pre-rasterized once
// and blitted many times per frame into a CPU buffer.
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
  // Subtle scanlines.
  float scan = 0.92 + 0.08 * sin(v_uv.y * float(${VH}) * 3.14159);
  col *= scan;
  // Soft vignette.
  vec2 c = v_uv - 0.5;
  col *= mix(0.55, 1.0, 1.0 - smoothstep(0.55, 0.95, length(c)));
  outColor = vec4(col, 1.0);
}
`;

// 5-point pixel-art Christmas star with a santa-red center dot. Reads
// instantly at small size and tints well per copy.
const SW = 24, SH = 24;
const SPRITE_RECIPES = [
  // Mostly-yellow festive star.
  { outline: [40, 30, 5], fill: [255, 215, 60], center: [240, 60, 60], glow: [255, 240, 160] },
  // Snow-white star.
  { outline: [30, 50, 80], fill: [245, 248, 255], center: [220, 40, 50], glow: [200, 220, 255] },
  // Pine-green star.
  { outline: [10, 40, 20], fill: [120, 220, 90], center: [255, 220, 80], glow: [180, 240, 160] },
  // Christmas-red star.
  { outline: [40, 10, 15], fill: [240, 70, 80], center: [255, 220, 80], glow: [255, 180, 180] },
];

function buildSprite(recipe) {
  // Geometrically correct regular 5-point star, rasterized at runtime.
  // Outer points sit on a circle of radius Router; inner vertices sit on
  // a circle of radius Router / phi^2 (the golden-ratio star), which is
  // the only inner radius that produces a star with straight, equal arms.
  const cx = SW / 2, cy = SH / 2;
  const Router = SW / 2 - 0.5;
  const PHI = (1 + Math.sqrt(5)) / 2;
  const Rinner = Router / (PHI * PHI);

  // 10 vertices, alternating outer/inner, starting from the top point and
  // going clockwise. -PI/2 puts vertex 0 straight up.
  const verts = [];
  for (let k = 0; k < 10; k++) {
    const r = (k % 2 === 0) ? Router : Rinner;
    const a = -Math.PI / 2 + k * Math.PI / 5;
    verts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }

  function pointInPoly(px, py) {
    let inside = false;
    for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
      const [xi, yi] = verts[i], [xj, yj] = verts[j];
      const intersect = ((yi > py) !== (yj > py)) &&
        (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }
  function distToEdge(px, py) {
    let min = Infinity;
    for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
      const [xi, yi] = verts[i], [xj, yj] = verts[j];
      const dx = xj - xi, dy = yj - yi;
      const len2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((px - xi) * dx + (py - yi) * dy) / len2));
      const ex = xi + t * dx, ey = yi + t * dy;
      const d = Math.hypot(px - ex, py - ey);
      if (d < min) min = d;
    }
    return min;
  }

  const buf = new Uint8Array(SW * SH * 4);
  for (let y = 0; y < SH; y++) {
    for (let x = 0; x < SW; x++) {
      const px = x + 0.5, py = y + 0.5;
      const inside = pointInPoly(px, py);
      const dEdge = distToEdge(px, py);
      // Pull in pixels right at the silhouette so arm tips don't dropout.
      if (!inside && dEdge > 0.45) {
        const j = (y * SW + x) * 4;
        buf[j + 3] = 0;
        continue;
      }
      const dCenter = Math.hypot(px - cx, py - cy);
      const onOutline = dEdge < 1.1;
      // Upper-left glow lobe for a soft highlight.
      const gx = (cx - 2.2) - px, gy = (cy - 2.2) - py;
      const inGlow = !onOutline && dCenter < Rinner + 0.5 && (gx * gx + gy * gy) < 12.0;
      let c;
      if (dCenter < 2.1)       c = recipe.center;
      else if (onOutline)      c = recipe.outline;
      else if (inGlow)         c = recipe.glow;
      else                     c = recipe.fill;
      const j = (y * SW + x) * 4;
      buf[j] = c[0]; buf[j + 1] = c[1]; buf[j + 2] = c[2]; buf[j + 3] = 255;
    }
  }
  return buf;
}

export function santa_multiplex(gl) {
  const prog = createProgram(gl, VS_FULLSCREEN, FS);
  const uTex = gl.getUniformLocation(prog, 'u_tex');

  const buf = new Uint8Array(VW * VH * 4);
  const sprites = SPRITE_RECIPES.map(buildSprite);

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, VW, VH, 0, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // Background stars.
  const N_STARS = 140;
  const starX = new Float32Array(N_STARS);
  const starY = new Float32Array(N_STARS);
  const starL = new Uint8Array(N_STARS);
  for (let i = 0; i < N_STARS; i++) {
    starX[i] = Math.random() * VW;
    starY[i] = Math.random() * VH;
    starL[i] = 1 + ((Math.random() * 3) | 0);
  }

  function plotStar(x, y, layer) {
    if (x < 0 || x >= VW || y < 0 || y >= VH) return;
    const j = ((y | 0) * VW + (x | 0)) * 4;
    const c = layer === 1 ? 230 : layer === 2 ? 175 : 110;
    buf[j] = c; buf[j+1] = c; buf[j+2] = Math.min(255, c + 25); buf[j+3] = 255;
  }

  function blitSprite(sprite, dstX, dstY) {
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
  // Three rows of sprites at different phases / scroll speeds.
  const ROWS = [
    { baseY: VH * 0.22, count: 7, speed:  34, amp: 26, freq: 1.3, phase: 0 },
    { baseY: VH * 0.50, count: 8, speed: -28, amp: 32, freq: 1.6, phase: Math.PI },
    { baseY: VH * 0.78, count: 7, speed:  22, amp: 22, freq: 1.1, phase: Math.PI * 0.5 },
  ];

  return {
    render(gl, t, fbo) {
      const dt = lastT === 0 ? 0.016 : Math.min(0.05, (t - lastT) / 1000);
      lastT = t;
      tt += dt;

      // Deep blue night sky gradient.
      for (let y = 0; y < VH; y++) {
        const ty = y / VH;
        const r = (4 + ty * 14) | 0;
        const g = (6 + ty * 10) | 0;
        const b = (28 + ty * 38) | 0;
        for (let x = 0; x < VW; x++) {
          const j = (y * VW + x) * 4;
          buf[j] = r; buf[j+1] = g; buf[j+2] = b; buf[j+3] = 255;
        }
      }
      // Parallax stars.
      for (let i = 0; i < N_STARS; i++) {
        const layer = starL[i];
        const off = tt * (8 + layer * 6);
        let x = (starX[i] - off) % VW;
        if (x < 0) x += VW;
        plotStar(x, starY[i], layer);
      }

      // Sprite rows.
      for (let r = 0; r < ROWS.length; r++) {
        const row = ROWS[r];
        const spacing = (VW + SW) / row.count;
        for (let i = 0; i < row.count; i++) {
          const sprIdx = (i + r) % sprites.length;
          const sprite = sprites[sprIdx];
          let x = ((i * spacing + tt * row.speed) % (VW + SW * 2)) - SW;
          while (x < -SW) x += VW + SW * 2;
          while (x > VW)  x -= VW + SW * 2;
          const localPhase = (i / row.count) * Math.PI * 2 + row.phase;
          const y = row.baseY + Math.sin(tt * row.freq + localPhase) * row.amp - SH / 2;
          blitSprite(sprite, x, y);
        }
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

