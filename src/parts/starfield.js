// Starfield + procedurally drawn vector Santa, sleigh, and reindeer team
// flying across the screen on a looping path.
//
// Two passes:
//   1) Existing fullscreen starfield fragment shader (parallax stars + nebula).
//   2) 2D line overlay drawing Santa's sleigh team in pixel coordinates.
//
// All overlay geometry is procedural; legs and reins animate; Rudolph's nose
// glows. The whole sleigh follows a looping sinusoidal path so it traverses
// the screen repeatedly during the part.

import { createProgram, VS_FULLSCREEN, VW, VH } from '../gl/context.js';
import { drawQuad } from '../gl/quad.js';
import { bindFBO } from '../gl/framebuffer.js';
import { createPaletteTexture, PALETTES } from '../gl/palette.js';

// ---------------------------------------------------------------------------
// Pass 1: starfield FS (unchanged)
// ---------------------------------------------------------------------------
const FS_STARS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform float u_time;
uniform vec2  u_res;
uniform sampler2D u_palette;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453);
}

void main() {
  vec2 p = v_uv * u_res;
  vec3 col = vec3(0.01, 0.01, 0.04);

  for (int layer = 0; layer < 5; layer++) {
    float fl = float(layer + 1);
    float speed = 12.0 * fl;
    float cell = 5.0 - float(layer) * 0.4;
    vec2 q = p;
    q.x += u_time * speed;

    vec2 g = floor(q / cell);
    float h = hash(g + float(layer) * 17.0);
    float thresh = 0.97 - float(layer) * 0.005;
    float bright = smoothstep(thresh, 1.0, h);
    if (bright > 0.0) {
      vec2 frac = fract(q / cell);
      float d = length(frac - 0.5);
      float dot = smoothstep(0.45, 0.0, d);
      float sparkle = (h > 0.997) ? smoothstep(0.5, 0.0, abs(frac.x - 0.5)) +
                                    smoothstep(0.5, 0.0, abs(frac.y - 0.5)) : 0.0;
      float tw = 0.6 + 0.4 * sin(u_time * (3.0 + h * 7.0) + h * 31.0);

      float warm = float(layer) / 4.0;
      vec3 c = mix(vec3(0.55, 0.65, 1.0), vec3(1.0, 0.95, 0.85), warm);
      if (h > 0.999) c = mix(c, vec3(1.0, 0.7, 0.3), 0.6);

      col += c * bright * (dot + sparkle * 0.3) * tw * (0.6 + 0.4 * warm);
    }
  }

  vec2 nq = p * 0.012 + vec2(u_time * 0.05, 0.0);
  float n = 0.0;
  n += hash(floor(nq)) * 0.5;
  n += hash(floor(nq * 2.0)) * 0.25;
  n += hash(floor(nq * 4.0)) * 0.125;
  vec3 neb = mix(vec3(0.10, 0.05, 0.20), vec3(0.05, 0.15, 0.25), v_uv.y);
  col += neb * smoothstep(0.55, 1.0, n) * 0.35;

  outColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Pass 2: 2D vector lines overlay (santa + sleigh + reindeer)
// ---------------------------------------------------------------------------
// Vertex shader takes pixel-space positions in [0..VW, 0..VH] and per-vertex
// RGBA color. Converts to NDC with a Y-flip so y=0 is top.
const VS_LINES = `#version 300 es
in vec2  a_pos;     // pixel coords (0..VW, 0..VH); y=0 is top, but the FBO
                    // blit applies its own Y-flip on present, so we do NOT
                    // flip Y here — we just emit straight NDC and let the
                    // blit put y=0 at the top visually.
in vec4  a_color;
uniform vec2 u_res;
out vec4 v_color;
void main() {
  vec2 ndc = (a_pos / u_res) * 2.0 - 1.0;
  // No Y-flip: the FBO -> screen blit flips Y (matches the convention used
  // by 3D parts via mat4FlipY). Without this, Santa renders upside down.
  gl_Position = vec4(ndc, 0.0, 1.0);
  v_color = a_color;
}
`;

const FS_LINES = `#version 300 es
precision highp float;
in vec4 v_color;
out vec4 outColor;
void main() {
  outColor = v_color;
}
`;

// ---------- color palette for the sleigh team -----------------------------
const C_SLEIGH_RED   = [1.00, 0.20, 0.20, 1.0];
const C_SLEIGH_DARK  = [0.55, 0.05, 0.08, 1.0];
const C_GOLD        = [1.00, 0.82, 0.30, 1.0];
const C_RUNNER      = [0.85, 0.85, 0.95, 1.0]; // metallic sled runner
const C_REINDEER    = [0.70, 0.45, 0.22, 1.0];
const C_REINDEER_HI = [0.92, 0.68, 0.40, 1.0];
const C_ANTLER      = [0.95, 0.85, 0.60, 1.0];
const C_HOOF        = [0.20, 0.12, 0.08, 1.0];
const C_SANTA_RED   = [1.00, 0.25, 0.25, 1.0];
const C_SANTA_SKIN  = [1.00, 0.78, 0.62, 1.0];
const C_BEARD       = [1.00, 1.00, 1.00, 1.0];
const C_RUDOLPH_NOSE= [1.00, 0.30, 0.30, 1.0];
const C_REIN        = [0.85, 0.70, 0.40, 1.0];
const C_GIFT_RED    = [1.00, 0.30, 0.30, 1.0];
const C_GIFT_GREEN  = [0.30, 0.85, 0.40, 1.0];

// Helper: append a line segment (two endpoints) into the vertex buffer.
function pushLine(arr, x0, y0, x1, y1, c0, c1 = c0) {
  arr.push(x0, y0, c0[0], c0[1], c0[2], c0[3]);
  arr.push(x1, y1, c1[0], c1[1], c1[2], c1[3]);
}

// Polyline helper: a chain of points connected by line segments.
function pushPolyline(arr, pts, color) {
  for (let i = 0; i < pts.length - 1; i++) {
    pushLine(arr, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], color);
  }
}

// Approx ellipse outline as N-sided polyline.
function pushEllipse(arr, cx, cy, rx, ry, color, segs = 14, startAng = 0, endAng = Math.PI * 2) {
  let prev = null;
  for (let i = 0; i <= segs; i++) {
    const a = startAng + (endAng - startAng) * (i / segs);
    const x = cx + Math.cos(a) * rx;
    const y = cy + Math.sin(a) * ry;
    if (prev) pushLine(arr, prev[0], prev[1], x, y, color);
    prev = [x, y];
  }
}

// Build one reindeer in local coords, centered at (0,0) facing +X direction.
// `phase` drives leg trotting animation. `isRudolph` enables the glowing nose.
function buildReindeer(arr, ox, oy, phase, isRudolph) {
  // Body ellipse.
  const bodyX = ox, bodyY = oy;
  pushEllipse(arr, bodyX, bodyY, 9, 4.5, C_REINDEER, 14);
  // Tail (small upward flick at the back).
  pushLine(arr, bodyX - 8, bodyY - 1, bodyX - 11, bodyY - 4, C_REINDEER);

  // Neck + head (head slightly above and forward of body).
  const headX = bodyX + 11, headY = bodyY - 6;
  pushLine(arr, bodyX + 7, bodyY - 1, headX - 2, headY + 2, C_REINDEER); // neck
  pushEllipse(arr, headX, headY, 3.2, 2.4, C_REINDEER_HI, 10);          // head
  // Snout.
  pushLine(arr, headX + 2.5, headY + 0.5, headX + 4.5, headY + 1.2, C_REINDEER_HI);
  pushLine(arr, headX + 4.5, headY + 1.2, headX + 4.0, headY + 2.0, C_REINDEER_HI);
  // Eye (tiny line dot).
  pushLine(arr, headX + 0.5, headY - 0.6, headX + 1.2, headY - 0.6, [0, 0, 0, 1]);

  // Rudolph's glowing red nose (lead reindeer only).
  if (isRudolph) {
    // Pulsing glow: outer halos + bright core. Use multiple ellipses to give
    // a soft glow effect.
    const nx = headX + 4.8, ny = headY + 1.4;
    // Outer halos (dim).
    pushEllipse(arr, nx, ny, 4.0, 3.4, [1.0, 0.35, 0.35, 0.25], 12);
    pushEllipse(arr, nx, ny, 3.0, 2.6, [1.0, 0.45, 0.45, 0.45], 10);
    pushEllipse(arr, nx, ny, 2.2, 1.9, [1.0, 0.55, 0.55, 0.7], 10);
    // Bright core: dense crossing lines.
    for (let a = 0; a < Math.PI; a += Math.PI / 6) {
      const dx = Math.cos(a) * 1.6, dy = Math.sin(a) * 1.4;
      pushLine(arr, nx - dx, ny - dy, nx + dx, ny + dy, C_RUDOLPH_NOSE);
    }
  }

  // Antlers: branched lines from top of head.
  const ax = headX, ay = headY - 2.2;
  // Left antler.
  pushLine(arr, ax - 0.8, ay,        ax - 2.5, ay - 4.0, C_ANTLER);
  pushLine(arr, ax - 2.5, ay - 4.0,  ax - 4.5, ay - 5.5, C_ANTLER);
  pushLine(arr, ax - 2.5, ay - 4.0,  ax - 1.0, ay - 6.0, C_ANTLER);
  pushLine(arr, ax - 2.5, ay - 4.0,  ax - 3.8, ay - 2.8, C_ANTLER);
  // Right antler.
  pushLine(arr, ax + 0.8, ay,        ax + 2.5, ay - 4.0, C_ANTLER);
  pushLine(arr, ax + 2.5, ay - 4.0,  ax + 4.5, ay - 5.5, C_ANTLER);
  pushLine(arr, ax + 2.5, ay - 4.0,  ax + 1.0, ay - 6.0, C_ANTLER);
  pushLine(arr, ax + 2.5, ay - 4.0,  ax + 3.8, ay - 2.8, C_ANTLER);

  // Legs: 4 legs, animated trotting via `phase`.
  // Two pairs of legs (front/back) swing in opposite phase for a gallop.
  const swing = Math.sin(phase) * 2.2;
  const swing2 = Math.sin(phase + Math.PI) * 2.2;
  // Front legs (near head end of body).
  const flx = bodyX + 5;
  pushLine(arr, flx, bodyY + 3, flx + swing,  bodyY + 9, C_REINDEER);
  pushLine(arr, flx + swing, bodyY + 9, flx + swing - 0.5, bodyY + 10, C_HOOF);
  pushLine(arr, flx + 1.5, bodyY + 3, flx + 1.5 + swing2, bodyY + 9, C_REINDEER);
  pushLine(arr, flx + 1.5 + swing2, bodyY + 9, flx + 1 + swing2, bodyY + 10, C_HOOF);
  // Back legs.
  const blx = bodyX - 5;
  pushLine(arr, blx, bodyY + 3, blx + swing2, bodyY + 9, C_REINDEER);
  pushLine(arr, blx + swing2, bodyY + 9, blx - 0.5 + swing2, bodyY + 10, C_HOOF);
  pushLine(arr, blx - 1.5, bodyY + 3, blx - 1.5 + swing, bodyY + 9, C_REINDEER);
  pushLine(arr, blx - 1.5 + swing, bodyY + 9, blx - 2 + swing, bodyY + 10, C_HOOF);
}

// Sleigh + Santa + gifts, centered at (cx, cy). Sleigh faces +X.
// `armRaise` is 0..1: 0 = arm holding reins (default), 1 = arm raised high
// (mid-throw). Used to animate Santa flinging gifts.
function buildSleigh(arr, cx, cy, t, armRaise = 0) {
  // ----- Sled hull (stylized curved boat shape) -----
  // Outer hull as polyline.
  const hull = [
    [cx - 14, cy + 2],
    [cx - 11, cy - 4],
    [cx - 3,  cy - 6],
    [cx + 8,  cy - 6],
    [cx + 14, cy - 4],
    [cx + 17, cy + 0],   // upcurled prow
    [cx + 15, cy + 3],
    [cx + 12, cy + 4],
    [cx - 10, cy + 4],
    [cx - 14, cy + 2],
  ];
  pushPolyline(arr, hull, C_SLEIGH_RED);
  // Inner trim line (gold).
  const trim = [
    [cx - 11, cy - 1],
    [cx - 8,  cy - 3],
    [cx + 10, cy - 3],
    [cx + 13, cy - 1],
  ];
  pushPolyline(arr, trim, C_GOLD);
  // Backrest (tall rear panel).
  pushLine(arr, cx - 11, cy - 4, cx - 13, cy - 11, C_SLEIGH_DARK);
  pushLine(arr, cx - 13, cy - 11, cx - 9, cy - 12, C_SLEIGH_DARK);
  pushLine(arr, cx - 9, cy - 12, cx - 7, cy - 6, C_SLEIGH_DARK);
  // Gold star atop backrest.
  const sx = cx - 11, sy = cy - 13;
  pushLine(arr, sx - 1.5, sy, sx + 1.5, sy, C_GOLD);
  pushLine(arr, sx, sy - 1.5, sx, sy + 1.5, C_GOLD);
  pushLine(arr, sx - 1, sy - 1, sx + 1, sy + 1, C_GOLD);
  pushLine(arr, sx - 1, sy + 1, sx + 1, sy - 1, C_GOLD);

  // ----- Runner (metallic sled blade under the hull) -----
  pushLine(arr, cx - 14, cy + 5, cx + 15, cy + 5, C_RUNNER);
  pushLine(arr, cx - 14, cy + 5, cx - 16, cy + 3, C_RUNNER);
  pushLine(arr, cx + 15, cy + 5, cx + 18, cy + 2, C_RUNNER);
  // Vertical struts to hull.
  pushLine(arr, cx - 8, cy + 4, cx - 8, cy + 5, C_RUNNER);
  pushLine(arr, cx,     cy + 4, cx,     cy + 5, C_RUNNER);
  pushLine(arr, cx + 8, cy + 4, cx + 8, cy + 5, C_RUNNER);

  // ----- Gift sack (in the back of the sleigh) -----
  // Pile of small wrapped gifts.
  // Gift 1 (red).
  const g1x = cx - 7, g1y = cy - 4;
  pushLine(arr, g1x - 2, g1y, g1x + 2, g1y, C_GIFT_RED);
  pushLine(arr, g1x + 2, g1y, g1x + 2, g1y - 4, C_GIFT_RED);
  pushLine(arr, g1x + 2, g1y - 4, g1x - 2, g1y - 4, C_GIFT_RED);
  pushLine(arr, g1x - 2, g1y - 4, g1x - 2, g1y, C_GIFT_RED);
  pushLine(arr, g1x, g1y, g1x, g1y - 4, C_GOLD);          // ribbon vertical
  pushLine(arr, g1x - 2, g1y - 2, g1x + 2, g1y - 2, C_GOLD); // ribbon horizontal
  // Gift 2 (green, smaller, on top).
  const g2x = cx - 4, g2y = cy - 7;
  pushLine(arr, g2x - 1.5, g2y, g2x + 1.5, g2y, C_GIFT_GREEN);
  pushLine(arr, g2x + 1.5, g2y, g2x + 1.5, g2y - 3, C_GIFT_GREEN);
  pushLine(arr, g2x + 1.5, g2y - 3, g2x - 1.5, g2y - 3, C_GIFT_GREEN);
  pushLine(arr, g2x - 1.5, g2y - 3, g2x - 1.5, g2y, C_GIFT_GREEN);
  pushLine(arr, g2x, g2y, g2x, g2y - 3, C_GOLD);

  // ----- Santa (sitting in the front of the sleigh) -----
  // Torso (red coat).
  const stx = cx + 4, sty = cy - 4;
  pushLine(arr, stx - 3, sty,     stx + 3, sty,     C_SANTA_RED);
  pushLine(arr, stx + 3, sty,     stx + 3, sty - 6, C_SANTA_RED);
  pushLine(arr, stx + 3, sty - 6, stx - 3, sty - 6, C_SANTA_RED);
  pushLine(arr, stx - 3, sty - 6, stx - 3, sty,     C_SANTA_RED);
  // Belt (dark line at bottom of torso).
  pushLine(arr, stx - 3, sty - 1, stx + 3, sty - 1, [0.05, 0.05, 0.05, 1]);
  pushLine(arr, stx - 0.5, sty - 1, stx - 0.5, sty, C_GOLD); // belt buckle

  // Arm (one visible) holding the reins; raises high when throwing a gift.
  // armRaise = 0 -> resting forward, armRaise = 1 -> arm up & back over head.
  // We blend the elbow + glove endpoints between resting and throwing poses.
  const armSwing = Math.sin(t * 4) * 0.6;
  // Resting pose: forearm extended forward to reins.
  const restEx = stx + 7,                  restEy = sty - 2 + armSwing;
  // Throwing pose: arm up and back, hand over Santa's head, ready to fling.
  const throwEx = stx - 2,                 throwEy = sty - 14;
  const ex = restEx + (throwEx - restEx) * armRaise;
  const ey = restEy + (throwEy - restEy) * armRaise;
  pushLine(arr, stx + 3, sty - 4, ex, ey, C_SANTA_RED);
  // Glove (white) at hand.
  const gxEnd = ex + (armRaise > 0.5 ? -1.0 : 1.0);
  const gyEnd = ey + (armRaise > 0.5 ? -1.0 : 1.0);
  pushLine(arr, ex, ey, gxEnd, gyEnd, C_BEARD);

  // Head (skin oval).
  pushEllipse(arr, stx, sty - 9, 2.2, 2.6, C_SANTA_SKIN, 10);
  // Beard (wavy white below face).
  pushLine(arr, stx - 2, sty - 8, stx - 2.5, sty - 6, C_BEARD);
  pushLine(arr, stx - 2.5, sty - 6, stx,      sty - 5, C_BEARD);
  pushLine(arr, stx,       sty - 5, stx + 2.5, sty - 6, C_BEARD);
  pushLine(arr, stx + 2.5, sty - 6, stx + 2,  sty - 8, C_BEARD);
  // Mustache.
  pushLine(arr, stx - 1.5, sty - 8, stx,      sty - 7.5, C_BEARD);
  pushLine(arr, stx,       sty - 7.5, stx + 1.5, sty - 8, C_BEARD);

  // Hat: red triangle with white trim and bobble.
  pushLine(arr, stx - 2.5, sty - 11, stx + 2.5, sty - 11, C_BEARD); // trim
  pushLine(arr, stx - 2.5, sty - 11, stx + 1,   sty - 16, C_SANTA_RED);
  pushLine(arr, stx + 1,   sty - 16, stx + 2.5, sty - 11, C_SANTA_RED);
  // Hat bobble.
  pushEllipse(arr, stx + 1, sty - 17, 1.2, 1.2, C_BEARD, 8);
}

// Build reins from sleigh harness point to each reindeer's neck.
function buildReins(arr, sleighX, sleighY, deer) {
  // Sleigh harness anchor: front of sleigh.
  const hx = sleighX + 17, hy = sleighY + 0;
  for (const d of deer) {
    // Curved rein: 3-segment polyline with a slight droop.
    const tx = d.x - 8, ty = d.y - 5; // attaches near reindeer's neck
    const mx = (hx + tx) * 0.5, my = (hy + ty) * 0.5 + 2; // slight sag
    pushLine(arr, hx, hy, mx, my, C_REIN);
    pushLine(arr, mx, my, tx, ty, C_REIN);
  }
}

// Compute Santa's glove (hand) position in *local* sleigh coords given
// armRaise (0..1). Mirror this with the same transform used for the rest of
// the geometry to get a world-space spawn point for thrown gifts.
function santaHandLocal(armRaise, t) {
  const stx = 4, sty = -4; // Santa torso anchor (sleigh-local)
  const armSwing = Math.sin(t * 4) * 0.6;
  const restEx = stx + 7,  restEy = sty - 2 + armSwing;
  const throwEx = stx - 2, throwEy = sty - 14;
  const ex = restEx + (throwEx - restEx) * armRaise;
  const ey = restEy + (throwEy - restEy) * armRaise;
  return [ex, ey];
}

// Draw a tossed gift at world position (wx, wy) with rotation `rot` and
// color tint. Gift is a small square wrapped with a ribbon. Alpha fades as
// the gift ages out. Always drawn in WORLD space (no path transform).
function drawWorldGift(arr, wx, wy, rot, color, alpha) {
  const sz = 2.6; // half-side
  // Pre-compute the four corners rotated.
  const co = Math.cos(rot), si = Math.sin(rot);
  const corners = [
    [-sz, -sz], [ sz, -sz], [ sz,  sz], [-sz,  sz],
  ].map(([x, y]) => [wx + x * co - y * si, wy + x * si + y * co]);
  const c = [color[0], color[1], color[2], alpha];
  // Box outline.
  pushLine(arr, corners[0][0], corners[0][1], corners[1][0], corners[1][1], c);
  pushLine(arr, corners[1][0], corners[1][1], corners[2][0], corners[2][1], c);
  pushLine(arr, corners[2][0], corners[2][1], corners[3][0], corners[3][1], c);
  pushLine(arr, corners[3][0], corners[3][1], corners[0][0], corners[0][1], c);
  // Ribbon: cross through the center, gold-tinted.
  const gold = [C_GOLD[0], C_GOLD[1], C_GOLD[2], alpha];
  // Horizontal ribbon: midpoints of left/right edges.
  const hx0 = (corners[0][0] + corners[3][0]) * 0.5;
  const hy0 = (corners[0][1] + corners[3][1]) * 0.5;
  const hx1 = (corners[1][0] + corners[2][0]) * 0.5;
  const hy1 = (corners[1][1] + corners[2][1]) * 0.5;
  pushLine(arr, hx0, hy0, hx1, hy1, gold);
  // Vertical ribbon: midpoints of top/bottom edges.
  const vx0 = (corners[0][0] + corners[1][0]) * 0.5;
  const vy0 = (corners[0][1] + corners[1][1]) * 0.5;
  const vx1 = (corners[2][0] + corners[3][0]) * 0.5;
  const vy1 = (corners[2][1] + corners[3][1]) * 0.5;
  pushLine(arr, vx0, vy0, vx1, vy1, gold);
  // Tiny bow on top: two small triangles. We pick the first ribbon endpoint
  // as the "top" anchor and emit two tiny outward strokes.
  pushLine(arr, vx0, vy0, vx0 + co * 1.2 - si * 1.2, vy0 + si * 1.2 + co * 1.2, gold);
  pushLine(arr, vx0, vy0, vx0 + co * -1.2 - si * 1.2, vy0 + si * -1.2 + co * 1.2, gold);
}

// ---------------------------------------------------------------------------
// Part factory
// ---------------------------------------------------------------------------
export function starfield(gl) {
  // --- Pass 1: starfield program ---
  const progStars = createProgram(gl, VS_FULLSCREEN, FS_STARS);
  const uTimeS = gl.getUniformLocation(progStars, 'u_time');
  const uResS  = gl.getUniformLocation(progStars, 'u_res');
  const uPalS  = gl.getUniformLocation(progStars, 'u_palette');
  const palTex = createPaletteTexture(gl, PALETTES.starfield || PALETTES.plasma);

  // --- Pass 2: lines program ---
  const progLines = gl.createProgram();
  const vsL = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vsL, VS_LINES); gl.compileShader(vsL);
  if (!gl.getShaderParameter(vsL, gl.COMPILE_STATUS)) console.error('starfield lines vs', gl.getShaderInfoLog(vsL));
  const fsL = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(fsL, FS_LINES); gl.compileShader(fsL);
  if (!gl.getShaderParameter(fsL, gl.COMPILE_STATUS)) console.error('starfield lines fs', gl.getShaderInfoLog(fsL));
  gl.attachShader(progLines, vsL);
  gl.attachShader(progLines, fsL);
  gl.bindAttribLocation(progLines, 0, 'a_pos');
  gl.bindAttribLocation(progLines, 1, 'a_color');
  gl.linkProgram(progLines);
  if (!gl.getProgramParameter(progLines, gl.LINK_STATUS)) console.error('starfield lines link', gl.getProgramInfoLog(progLines));
  const uResL = gl.getUniformLocation(progLines, 'u_res');

  // VAO/VBO for line geometry. We re-upload every frame since legs animate
  // and the whole sleigh translates.
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  // Reserve a generous initial size.
  gl.bufferData(gl.ARRAY_BUFFER, 4 * 6 * 4096, gl.DYNAMIC_DRAW);
  const stride = 6 * 4; // 2 pos + 4 color = 6 floats per vertex
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 8);
  gl.bindVertexArray(null);

  // ---- Persistent state across frames ----
  // List of in-flight thrown gifts. Each: { x, y, vx, vy, spin, rot, color,
  // age, life }. Positions/velocities are in world (pixel) space.
  const gifts = [];
  // Last call's `t` (ms), so we can compute dt for physics integration.
  let prevT = -1;
  // Schedule for the next throw (ms-of-part). Random jitter between throws.
  let nextThrowAt = 600;
  // Schedule for the throw animation: `throwAnimEnd` is the absolute t (ms)
  // at which the arm finishes its windup-and-release cycle. The arm starts
  // raising at `throwAnimStart` and the gift spawns at `throwReleaseAt`.
  let throwAnimStart = -1;
  let throwAnimEnd   = -1;
  let throwReleaseAt = -1;
  let throwReleased  = false;
  // Track the previous frame's sleigh world position so we can derive its
  // velocity, which we add to thrown gifts' initial velocity (so they look
  // like they're falling away from the sleigh, not from a fixed point).
  let prevPathX = null, prevPathY = null;

  // Palette of pretty gift wrap colors used round-robin per throw.
  const GIFT_COLORS = [
    [1.00, 0.30, 0.30], // red
    [0.30, 0.85, 0.40], // green
    [0.40, 0.65, 1.00], // blue
    [1.00, 0.78, 0.30], // gold
    [0.95, 0.45, 0.85], // pink
    [0.55, 0.85, 0.95], // ice blue
  ];
  let nextColorIdx = 0;

  return {
    render(gl, t /* ms */, fbo) {
      // Compute frame dt (seconds), clamped to avoid big jumps after a pause.
      const dt = (prevT < 0) ? 1 / 60 : Math.min(0.1, (t - prevT) / 1000);
      prevT = t;

      // ---- Pass 1: starfield background ----
      bindFBO(gl, fbo);
      gl.useProgram(progStars);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, palTex);
      gl.uniform1i(uPalS, 0);
      gl.uniform1f(uTimeS, t / 1000);
      gl.uniform2f(uResS, VW, VH);
      drawQuad(gl);

      // ---- Pass 2: vector sleigh team ----
      const tt = t / 1000;
      // Looping path: sleigh enters from the right (off-screen) and exits to
      // the left, then loops every PERIOD seconds. (Reindeer face +X, but
      // visually it's nicer to fly leftward across the screen, so we mirror
      // by flipping the X scale below.)
      const PERIOD = 9.0;
      const phase01 = ((tt % PERIOD) + PERIOD) % PERIOD / PERIOD; // 0..1
      // Path goes from x = VW + 80 (off right) to x = -100 (off left).
      const pathX = (VW + 80) + (-(VW + 180)) * phase01;
      // Vertical sine swoop, plus a slow drift.
      const pathY = VH * 0.35
        + Math.sin(tt * 1.2) * 18
        + Math.sin(tt * 0.43 + 1.7) * 8;

      // Sleigh world-space velocity (px/sec): used as base for thrown gifts.
      let sleighVx = 0, sleighVy = 0;
      if (prevPathX !== null && dt > 0) {
        sleighVx = (pathX - prevPathX) / dt;
        sleighVy = (pathY - prevPathY) / dt;
      }
      prevPathX = pathX;
      prevPathY = pathY;

      // ---- Throw scheduling ----
      // Trigger a new throw when t crosses nextThrowAt and Santa is on screen.
      // The throw has a windup (~250ms raising the arm), a release moment,
      // and a follow-through (~200ms lowering). During the entire animation
      // we set armRaise based on a smooth bell shape.
      const onScreen = pathX > -20 && pathX < VW + 20;
      if (onScreen && t >= nextThrowAt && throwAnimEnd < t) {
        throwAnimStart = t;
        throwReleaseAt = t + 220;        // peak of the throw
        throwAnimEnd   = t + 420;        // arm back to rest
        throwReleased  = false;
        // Schedule next throw 0.45..0.95s out.
        nextThrowAt = t + 450 + Math.random() * 500;
      }

      // Compute armRaise (0..1) from animation timing.
      let armRaise = 0;
      if (t >= throwAnimStart && t <= throwAnimEnd) {
        const u = (t - throwAnimStart) / (throwAnimEnd - throwAnimStart);
        // Bell shape: 0 -> 1 by release, then back to 0.
        armRaise = Math.sin(u * Math.PI);
      }

      // ---- Spawn the gift at the release moment ----
      if (!throwReleased && throwAnimStart > 0 && t >= throwReleaseAt) {
        throwReleased = true;
        // Hand position in local (sleigh) space at release.
        const [hlx, hly] = santaHandLocal(1.0, tt);
        // Apply the same world transform we use for the body: mirror X then
        // translate by (pathX, pathY).
        const hwx = pathX + (-hlx);
        const hwy = pathY + hly;
        // Throw velocity: a backward-up flick relative to the sleigh's
        // motion, so the gift appears to be tossed out of the back. The
        // sleigh moves in -X (leftward), so "backward" relative to motion is
        // +X. Add the sleigh's own velocity so the gift starts with momentum.
        const tossVx = sleighVx + 35 + Math.random() * 25;  // toss to the right
        const tossVy = sleighVy - 50 - Math.random() * 30;  // toss upward (negative y = up)
        const color = GIFT_COLORS[nextColorIdx % GIFT_COLORS.length];
        nextColorIdx++;
        gifts.push({
          x: hwx, y: hwy,
          vx: tossVx, vy: tossVy,
          spin: (Math.random() - 0.5) * 8.0, // rad/sec
          rot: Math.random() * Math.PI * 2,
          color,
          age: 0,
          life: 4.5,        // seconds before despawn
        });
        // Limit total gifts on screen to avoid runaway.
        if (gifts.length > 24) gifts.shift();
      }

      // ---- Integrate physics for all in-flight gifts ----
      const GRAVITY = 130; // px/s^2 (positive = downward, since y grows down)
      for (let i = gifts.length - 1; i >= 0; i--) {
        const g = gifts[i];
        g.vy += GRAVITY * dt;
        g.x += g.vx * dt;
        g.y += g.vy * dt;
        g.rot += g.spin * dt;
        g.age += dt;
        // Cull when off-bottom or expired.
        if (g.age > g.life || g.y > VH + 20 || g.x < -20 || g.x > VW + 20) {
          gifts.splice(i, 1);
        }
      }

      // ---- Build line geometry ----
      const verts = [];
      const local = [];

      // Reindeer positions in local space.
      const REINDEER = [
        [ 30,  3, false], [ 30, -11, false],
        [ 56,  3, false], [ 56, -11, false],
        [ 82,  3, false], [ 82, -11, false],
        [108, -4, true],
      ];
      const trotSpeed = 12.0;
      for (let i = 0; i < REINDEER.length; i++) {
        const [dx, dy, rud] = REINDEER[i];
        const bob = Math.sin(tt * 3.0 + i * 0.7) * 1.2;
        const phase = tt * trotSpeed + i * 0.9;
        buildReindeer(local, dx, dy + bob, phase, rud);
      }
      // Sleigh + Santa with throw arm pose.
      buildSleigh(local, 0, 0, tt, armRaise);
      buildReins(local, 0, 0, REINDEER.map(([dx, dy], i) => ({
        x: dx, y: dy + Math.sin(tt * 3.0 + i * 0.7) * 1.2,
      })));

      // Transform local -> world (mirror X, translate by path).
      for (let i = 0; i < local.length; i += 6) {
        const lx = local[i], ly = local[i + 1];
        const wx = pathX + (-lx);
        const wy = pathY + ly;
        verts.push(wx, wy, local[i + 2], local[i + 3], local[i + 4], local[i + 5]);
      }

      // ---- Draw thrown gifts directly in world space (no transform) ----
      for (const g of gifts) {
        // Fade out in the last 25% of life.
        const fadeStart = g.life * 0.75;
        const alpha = g.age < fadeStart
          ? 1.0
          : Math.max(0, 1 - (g.age - fadeStart) / (g.life - fadeStart));
        drawWorldGift(verts, g.x, g.y, g.rot, g.color, alpha);
      }

      // Upload + draw.
      const data = new Float32Array(verts);
      gl.useProgram(progLines);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      gl.uniform2f(uResL, VW, VH);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.LINES, 0, data.length / 6);
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);
    },
    dispose(gl) {
      gl.deleteProgram(progStars);
      gl.deleteProgram(progLines);
      gl.deleteTexture(palTex);
      gl.deleteVertexArray(vao);
      gl.deleteBuffer(vbo);
    },
  };
}
