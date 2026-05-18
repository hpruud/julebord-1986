// Snowglobe: pixel-art Christmas tree silhouette foreground, parallax
// snowfall with wind sine. CPU particle sim blitted into a CPU buffer,
// uploaded as a texture each frame, then composited with a vignette in
// a small fragment shader.
import { createProgram, VS_FULLSCREEN, VW, VH } from '../gl/context.js';
import { drawQuad } from '../gl/quad.js';
import { bindFBO } from '../gl/framebuffer.js';

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_tex;
uniform float u_time;
void main() {
  vec3 col = texture(u_tex, v_uv).rgb;
  // Round vignette to suggest the glass dome of a snow globe.
  vec2 c = v_uv - 0.5;
  c.x *= 1.25;
  float r = length(c);
  float vig = smoothstep(0.62, 0.40, r);
  col *= mix(0.25, 1.0, vig);
  // Soft cool tint near the rim.
  col = mix(col, col * vec3(0.7, 0.85, 1.1), smoothstep(0.40, 0.62, r));
  // Subtle glass highlight (top-left).
  float hi = smoothstep(0.55, 0.20, length(v_uv - vec2(0.28, 0.78)));
  col += vec3(0.20, 0.25, 0.30) * hi * 0.35;
  outColor = vec4(col, 1.0);
}
`;

const N_PARTICLES = 320;

// HSV -> RGB (0..255). h in [0,1), s,v in [0,1].
function hsv(h, s, v) {
  h = (h % 1 + 1) % 1;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r, g, b;
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    default: r = v; g = p; b = q;
  }
  return [(r * 255) | 0, (g * 255) | 0, (b * 255) | 0];
}

export function snowglobe(gl) {
  const prog = createProgram(gl, `#version 300 es
in vec2 a_pos; out vec2 v_uv;
void main(){ v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }
`, FS);
  const uTex = gl.getUniformLocation(prog, 'u_tex');
  const uTime = gl.getUniformLocation(prog, 'u_time');

  const buf = new Uint8Array(VW * VH * 4);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, VW, VH, 0, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // Particle state. Each particle gets a depth layer in [1..3]; deeper
  // particles are smaller, dimmer, and fall slower.
  const px = new Float32Array(N_PARTICLES);
  const py = new Float32Array(N_PARTICLES);
  const pl = new Uint8Array(N_PARTICLES); // layer 1..3
  for (let i = 0; i < N_PARTICLES; i++) {
    px[i] = Math.random() * VW;
    py[i] = Math.random() * VH;
    pl[i] = 1 + ((Math.random() * 3) | 0);
  }
  let lastT = 0;

  function plotPixel(x, y, r, g, b) {
    if (x < 0 || x >= VW || y < 0 || y >= VH) return;
    const j = ((y | 0) * VW + (x | 0)) * 4;
    buf[j] = r; buf[j+1] = g; buf[j+2] = b; buf[j+3] = 255;
  }

  // Pre-rasterize background (sky gradient + ground + moon) into a static
  // "scene" buffer. The tree, ornaments, garland and star are drawn per
  // frame so they can rotate around the trunk axis.
  const scene = new Uint8Array(VW * VH * 4);
  function buildScene() {
    for (let y = 0; y < VH; y++) {
      for (let x = 0; x < VW; x++) {
        const j = (y * VW + x) * 4;
        const t = y / VH;
        // Sky: deep navy at top fading to slightly purple near horizon.
        let r = (8 + t * 26) | 0;
        let g = (10 + t * 22) | 0;
        let b = (40 + t * 36) | 0;
        // Ground: snowy band on lower fifth.
        if (y > VH * 0.82) {
          const k = (y - VH * 0.82) / (VH * 0.18);
          r = (180 + k * 60) | 0;
          g = (190 + k * 55) | 0;
          b = (220 + k * 35) | 0;
        }
        scene[j] = r; scene[j+1] = g; scene[j+2] = b; scene[j+3] = 255;
      }
    }
    // Full moon ported from the spacebattle scene: pixel-art disc with
    // soft two-stage halo, named maria, Tycho + Copernicus crater
    // highlights, sinusoidal surface mottling, and cool limb darkening.
    const mcx = VW - 60, mcy = 50;
    const MOON_R = VH * 0.090;             // ~23 px
    const HALO_WIDE  = MOON_R / 0.09 * 0.32;
    const HALO_TIGHT = MOON_R / 0.09 * 0.16;
    const gx0 = Math.max(0, (mcx - HALO_WIDE) | 0), gx1 = Math.min(VW, (mcx + HALO_WIDE + 1) | 0);
    const gy0 = Math.max(0, (mcy - HALO_WIDE) | 0), gy1 = Math.min(VH, (mcy + HALO_WIDE + 1) | 0);
    const moonCoreR = 255, moonCoreG = 253, moonCoreB = 240; // (1.00, 0.99, 0.94)
    for (let y = gy0; y < gy1; y++) {
      for (let x = gx0; x < gx1; x++) {
        const dx = x - mcx, dy = y - mcy;
        const rDist = Math.sqrt(dx * dx + dy * dy);
        if (rDist >= HALO_WIDE) continue;
        const j = (y * VW + x) * 4;

        // Two-stage halo: cool wide + bright tight, additive over the sky.
        // Match battle's `smoothstep(outer, MOON_R, r)` cubic falloff so the
        // halo intensity reaches ~1 right at the moon's edge, not ~0.5.
        const tw  = Math.max(0, Math.min(1, (HALO_WIDE  - rDist) / (HALO_WIDE  - MOON_R)));
        const tt2 = Math.max(0, Math.min(1, (HALO_TIGHT - rDist) / (HALO_TIGHT - MOON_R)));
        const haloWide  = tw  * tw  * (3 - 2 * tw);
        const haloTight = tt2 * tt2 * (3 - 2 * tt2);
        const ar = (haloWide * 0.55 * 0.10 + haloTight * 0.85 * 0.18) * 255;
        const ag = (haloWide * 0.62 * 0.10 + haloTight * 0.90 * 0.18) * 255;
        const ab = (haloWide * 0.78 * 0.10 + haloTight * 1.00 * 0.18) * 255;
        scene[j]   = Math.min(255, scene[j]   + (ar | 0));
        scene[j+1] = Math.min(255, scene[j+1] + (ag | 0));
        scene[j+2] = Math.min(255, scene[j+2] + (ab | 0));

        if (rDist > MOON_R + 0.5) continue;
        const edge = MOON_R + 0.5 - rDist;
        const disc = Math.max(0, Math.min(1, edge));
        const u = dx / MOON_R, v = dy / MOON_R;

        const blob = (du, dv, sx, sy, inner, outer, amp) => {
          const px2 = (u - du) * sx, py2 = (v - dv) * sy;
          const d = Math.sqrt(px2 * px2 + py2 * py2);
          const t = 1 - Math.max(0, Math.min(1, (d - inner) / (outer - inner)));
          return t * t * amp;
        };
        let maria = 0;
        maria += blob(-0.30,  0.30, 1.0, 1.3, 0.10, 0.55, 0.13);
        maria += blob( 0.25,  0.05, 1.1, 1.0, 0.05, 0.30, 0.11);
        maria += blob( 0.45, -0.15, 0.9, 1.4, 0.05, 0.32, 0.10);
        maria += blob(-0.20, -0.40, 1.2, 1.0, 0.05, 0.32, 0.09);
        maria += blob( 0.65,  0.25, 1.4, 1.0, 0.03, 0.18, 0.10);

        let mott = Math.sin(u * 18 + 1.7) * Math.cos(v * 17 + 0.3)
                 + Math.sin(u * 31)       * Math.cos(v * 29);
        mott = mott * 0.5 + 0.5;
        const mottAmp = 0.025;

        const tdx = u - (-0.05), tdy = v - (-0.55);
        const tychoR = Math.sqrt(tdx * tdx + tdy * tdy);
        const tychoSpot = Math.max(0, 1 - tychoR / 0.10) * 0.18;
        const tychoRays = Math.max(0, 1 - tychoR / 0.45) * 0.04;
        const cdx = u - (-0.10), cdy = v - 0.05;
        const coperR = Math.sqrt(cdx * cdx + cdy * cdy);
        const coperSpot = Math.max(0, 1 - coperR / 0.06) * 0.15;
        const bright = tychoSpot + tychoRays + coperSpot;

        let mr = (moonCoreR / 255) - maria - mottAmp * (mott - 0.5) + bright;
        let mg = (moonCoreG / 255) - maria - mottAmp * (mott - 0.5) + bright;
        let mb = (moonCoreB / 255) - maria - mottAmp * (mott - 0.5) + bright;
        const rUV = Math.sqrt(u * u + v * v);
        const limb = Math.max(0, Math.min(1, (rUV - 0.78) / 0.22));
        mr = mr * (1 - limb) + mr * 0.84 * limb;
        mg = mg * (1 - limb) + mg * 0.86 * limb;
        mb = mb * (1 - limb) + mb * 0.96 * limb;
        mr = Math.max(0, Math.min(1, mr));
        mg = Math.max(0, Math.min(1, mg));
        mb = Math.max(0, Math.min(1, mb));

        const sR = scene[j]   / 255;
        const sG = scene[j+1] / 255;
        const sB = scene[j+2] / 255;
        scene[j]   = ((mr * disc + sR * (1 - disc)) * 255) | 0;
        scene[j+1] = ((mg * disc + sG * (1 - disc)) * 255) | 0;
        scene[j+2] = ((mb * disc + sB * (1 - disc)) * 255) | 0;
      }
    }
  }
  buildScene();

  // Tree geometry parameters (used both for silhouette and for animated
  // ornaments/garland that orbit the trunk axis).
  const TREE_CX = (VW / 2) | 0;
  const TREE_BASE_Y = (VH * 0.86) | 0;
  // Three stacked triangles (apexY, halfBase, color). y measured down from
  // TREE_BASE_Y; halfBase doubles as the triangle height.
  const TRI = [
    { apex: -80, half: 18, col: [20, 70, 30] },
    { apex: -60, half: 28, col: [25, 85, 35] },
    { apex: -36, half: 40, col: [30, 95, 40] },
  ];
  // Ornaments parameterised by (theta around trunk axis, height fraction
  // along the lowest triangle, color). At runtime we rotate theta by
  // `treeRot` and project: x = cx + sin(theta+rot)*radiusAtY, brightness
  // dims for ornaments on the back side.
  const ORNAMENTS = [
    { th: 0.0,  hy: -68, col: [220,  40,  50] },
    { th: 0.7,  hy: -60, col: [240, 200,  80] },
    { th: 1.4,  hy: -52, col: [230,  60,  60] },
    { th: 2.1,  hy: -46, col: [250, 210,  90] },
    { th: 2.8,  hy: -38, col: [230,  70,  70] },
    { th: 3.5,  hy: -30, col: [250, 200,  80] },
    { th: 4.2,  hy: -42, col: [250, 220, 100] },
    { th: 4.9,  hy: -22, col: [235,  60,  60] },
    { th: 5.6,  hy: -18, col: [250, 200,  90] },
    { th: 0.35, hy: -14, col: [230,  60,  60] },
    { th: 1.05, hy: -24, col: [250, 200, 110] },
    { th: 1.75, hy: -10, col: [235,  90,  90] },
  ];

  // Helper: half-width of the tree silhouette at a given y offset from the
  // base. Walks the triangles top-down. Returns 0 outside the tree.
  function treeHalfWidth(dy) {
    for (const t of TRI) {
      if (dy >= t.apex && dy < t.apex + t.half) {
        return dy - t.apex;
      }
    }
    return 0;
  }

  function plotScene(x, y, r, g, b) {
    if (x < 0 || x >= VW || y < 0 || y >= VH) return;
    const j = ((y | 0) * VW + (x | 0)) * 4;
    buf[j] = r; buf[j+1] = g; buf[j+2] = b; buf[j+3] = 255;
  }
  function plotShade(x, y, r, g, b, k) {
    if (x < 0 || x >= VW || y < 0 || y >= VH) return;
    const j = ((y | 0) * VW + (x | 0)) * 4;
    buf[j]   = ((buf[j]   * (1 - k) + r * k) | 0);
    buf[j+1] = ((buf[j+1] * (1 - k) + g * k) | 0);
    buf[j+2] = ((buf[j+2] * (1 - k) + b * k) | 0);
    buf[j+3] = 255;
  }

  function drawTree(tt) {
    const treeRot = tt * 1.8; // radians per second-ish
    // 1) Filled triangle silhouette (symmetric, so silhouette doesn't
    // change with rotation around the vertical axis).
    for (const t of TRI) {
      const [r, g, b] = t.col;
      for (let yy = 0; yy < t.half; yy++) {
        const py2 = TREE_BASE_Y + t.apex + yy;
        if (py2 < 0 || py2 >= VH) continue;
        for (let xx = -yy; xx <= yy; xx++) {
          plotScene(TREE_CX + xx, py2, r, g, b);
        }
      }
    }
    // 2) Shading band: darken the side away from the light (rotates with
    // the tree so the shadow sweeps around the trunk). This is the main
    // visual cue that the tree is spinning.
    const lightDir = Math.cos(treeRot);            // -1..1 across the X axis
    for (const t of TRI) {
      for (let yy = 0; yy < t.half; yy++) {
        const py2 = TREE_BASE_Y + t.apex + yy;
        if (py2 < 0 || py2 >= VH) continue;
        for (let xx = -yy; xx <= yy; xx++) {
          // u = -1..1 across the slice; shade ~= max(0, -u*lightDir)
          const u = xx / Math.max(1, yy);
          const shade = Math.max(0, -u * lightDir);
          if (shade > 0.02) {
            plotShade(TREE_CX + xx, py2, 6, 22, 10, shade * 0.55);
          }
          // Highlight on the lit side for a fake specular sheen.
          const hi = Math.max(0, u * lightDir);
          if (hi > 0.5) {
            plotShade(TREE_CX + xx, py2, 180, 220, 150, (hi - 0.5) * 0.35);
          }
        }
      }
    }
    // 3) Trunk.
    for (let yy = 0; yy < 8; yy++) {
      for (let xx = -4; xx <= 4; xx++) {
        plotScene(TREE_CX + xx, TREE_BASE_Y + yy, 70, 40, 18);
      }
    }
    // 4) Helical garland: ~3 turns from base to apex, hue-cycling, animated
    // phase so the spiral appears to rotate with the tree.
    const TURNS = 3.0;
    const TOP_Y = TRI[0].apex;   // -80
    const BOT_Y = TRI[TRI.length - 1].apex + TRI[TRI.length - 1].half - 1;
    for (let s = 0; s <= 240; s++) {
      const k = s / 240;
      const dy = (TOP_Y + (BOT_Y - TOP_Y) * k) | 0;
      const hw = treeHalfWidth(dy);
      if (hw <= 0) continue;
      const ang = treeRot + k * TURNS * Math.PI * 2;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      // Only render front-facing samples (sa>=0). Back-facing are hidden
      // behind the tree.
      if (sa < 0) continue;
      const px2 = TREE_CX + (ca * hw) | 0;
      const py2 = TREE_BASE_Y + dy;
      // Hue cycles down the strand for that classic rainbow garland look.
      const hue = (k * 3 + tt * 0.4) % 1;
      const [rr, gg, bb] = hsv(hue, 0.9, 1.0);
      plotScene(px2, py2, rr, gg, bb);
    }
    // 4b) Twinkling fairy lights scattered over the front of the tree.
    // Pseudo-random but deterministic positions; each light has its own
    // blink phase so the whole tree shimmers.
    const N_LIGHTS = 36;
    for (let i = 0; i < N_LIGHTS; i++) {
      // Stable hash-based position inside the lowest triangle's bbox.
      const r1 = Math.sin(i * 12.9898) * 43758.5453;
      const r2 = Math.sin(i * 78.233)  * 12345.6789;
      const u = r1 - Math.floor(r1);          // 0..1 vertical along tree
      const v = (r2 - Math.floor(r2)) * 2 - 1; // -1..1 horizontal
      const dy = (TOP_Y + (BOT_Y - TOP_Y) * u) | 0;
      const hw = treeHalfWidth(dy);
      if (hw <= 1) continue;
      // Place the light on a cylinder around the trunk so it rotates with
      // the tree. Use v as an angle offset.
      const ang = treeRot + v * Math.PI;
      const sa = Math.sin(ang);
      if (sa < 0.05) continue;                 // hide back-of-tree lights
      const px2 = (TREE_CX + Math.cos(ang) * hw * 0.85) | 0;
      const py2 = TREE_BASE_Y + dy;
      // Per-light blink: each has its own frequency and phase.
      const freq = 2.0 + (r1 - Math.floor(r1)) * 3.0;
      const phase = i * 1.7;
      const blink = 0.5 + 0.5 * Math.sin(tt * freq + phase);
      if (blink < 0.45) continue;
      const intensity = (blink - 0.45) / 0.55;
      // Warm white/yellow/red/blue/green palette.
      const palette = [
        [255, 240, 180], [255, 180,  90], [255,  90,  90],
        [120, 180, 255], [140, 255, 160], [255, 220, 255],
      ];
      const [lr, lg, lb] = palette[i % palette.length];
      plotShade(px2, py2, lr, lg, lb, Math.min(1, intensity * sa));
      // Soft 1-px halo (cross pattern) for stronger blinks.
      if (intensity > 0.5) {
        const h = (intensity - 0.5) * 0.6 * sa;
        plotShade(px2 + 1, py2, lr, lg, lb, h);
        plotShade(px2 - 1, py2, lr, lg, lb, h);
        plotShade(px2, py2 + 1, lr, lg, lb, h);
        plotShade(px2, py2 - 1, lr, lg, lb, h);
      }
    }

    // 4c) Drifting snow caps on the front edges of each triangle tier.
    // Settled snow that brightens the lit side of the tree.
    for (const t of TRI) {
      for (let yy = 0; yy < 2; yy++) {
        const py2 = TREE_BASE_Y + t.apex + yy;
        if (py2 < 0 || py2 >= VH) continue;
        for (let xx = -(yy + t.half - 1); xx <= (yy + t.half - 1); xx++) {
          // Only the bottom of each tier (boughs edge) gets snow.
          const atEdge = yy === 0 ? false : (xx === -(yy) || xx === yy);
          if (!atEdge) continue;
          plotShade(TREE_CX + xx, py2, 230, 240, 255, 0.55);
        }
      }
      // Snow line along the bottom edge of each tier.
      const py2 = TREE_BASE_Y + t.apex + t.half - 1;
      for (let xx = -(t.half - 1); xx <= (t.half - 1); xx += 2) {
        const noise = Math.sin(xx * 2.3 + t.apex) * 0.5 + 0.5;
        if (noise > 0.4) {
          plotShade(TREE_CX + xx, py2, 235, 245, 255, 0.45 + noise * 0.3);
        }
      }
    }

    // 5) Orbiting ornaments.
    for (const o of ORNAMENTS) {
      const hw = treeHalfWidth(o.hy);
      if (hw <= 0) continue;
      const ang = o.th + treeRot;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      // Dim ornaments on the back of the tree; hide the ones that would
      // be deepest behind the silhouette.
      if (sa < -0.15) continue;
      const px2 = (TREE_CX + ca * hw * 0.95) | 0;
      const py2 = TREE_BASE_Y + o.hy;
      const front = Math.max(0, Math.min(1, (sa + 0.15) / 1.15));
      const [rO, gO, bO] = o.col;
      // 1px hot core + tiny halo.
      plotShade(px2, py2, rO, gO, bO, 0.85 + front * 0.15);
      // Sparkle highlight.
      plotShade(px2 - 1, py2 - 1, 255, 250, 220, 0.35 * front);
    }
    // 6) Star on top: 5-pointed shimmering star anchored at apex of the
    // smallest triangle, now with a soft pulsing halo and longer rays.
    const starY = TREE_BASE_Y + TRI[0].apex - 2;
    const twinkle = 0.7 + 0.3 * Math.sin(tt * 4);
    // Soft halo: 5x5 falloff around the star.
    for (let hy = -3; hy <= 3; hy++) {
      for (let hx = -3; hx <= 3; hx++) {
        const d = Math.sqrt(hx * hx + hy * hy);
        if (d < 0.5 || d > 3.2) continue;
        const k = Math.max(0, (3.2 - d) / 3.2) * 0.35 * twinkle;
        plotShade(TREE_CX + hx, starY + hy, 255, 230, 140, k);
      }
    }
    const sr = 255, sg = (210 + 20 * twinkle) | 0, sb = (90 + 30 * twinkle) | 0;
    plotScene(TREE_CX, starY, sr, sg, sb);
    plotScene(TREE_CX + 1, starY, sr, sg, sb);
    plotScene(TREE_CX - 1, starY, sr, sg, sb);
    plotScene(TREE_CX, starY - 1, sr, sg, sb);
    plotScene(TREE_CX, starY + 1, sr, sg, sb);
    // Rays that pulse longer on stronger twinkles.
    plotScene(TREE_CX + 2, starY, 255, 230, 130);
    plotScene(TREE_CX - 2, starY, 255, 230, 130);
    plotScene(TREE_CX, starY - 2, 255, 230, 130);
    plotScene(TREE_CX, starY + 2, 255, 230, 130);
    if (twinkle > 0.85) {
      plotScene(TREE_CX + 3, starY, 255, 220, 110);
      plotScene(TREE_CX - 3, starY, 255, 220, 110);
      plotScene(TREE_CX, starY - 3, 255, 220, 110);
      // Diagonal twinkle sparks.
      plotShade(TREE_CX + 2, starY - 2, 255, 230, 160, 0.6);
      plotShade(TREE_CX - 2, starY - 2, 255, 230, 160, 0.6);
      plotShade(TREE_CX + 2, starY + 2, 255, 230, 160, 0.6);
      plotShade(TREE_CX - 2, starY + 2, 255, 230, 160, 0.6);
    }
  }

  return {
    render(gl, t, fbo) {
      const dt = lastT === 0 ? 16 : Math.min(48, t - lastT);
      lastT = t;
      const tt = t / 1000;
      // Copy static scene as background.
      buf.set(scene);
      // Draw rotating tree (silhouette + animated garland + orbiting
      // ornaments + spinning star) on top of the sky/ground/moon.
      drawTree(tt);
      // Wind: global sine + per-layer offset.
      const wind = Math.sin(tt * 0.7) * 18;
      for (let i = 0; i < N_PARTICLES; i++) {
        const layer = pl[i];
        const fall = (18 + layer * 14) * (dt / 1000);
        const drift = (wind / layer) * (dt / 1000);
        py[i] += fall;
        px[i] += drift + Math.sin(tt * 1.3 + i * 0.7) * 0.3;
        if (py[i] >= VH) {
          py[i] = -2;
          px[i] = Math.random() * VW;
        }
        if (px[i] < 0) px[i] += VW;
        if (px[i] >= VW) px[i] -= VW;
        // Draw: deeper layers smaller and bluer.
        const x = px[i] | 0, y = py[i] | 0;
        if (layer === 1) {
          // Big flake: 2x2 plus
          plotPixel(x, y, 255, 255, 255);
          plotPixel(x+1, y, 250, 250, 255);
          plotPixel(x, y+1, 240, 245, 255);
          plotPixel(x+1, y+1, 230, 240, 255);
        } else if (layer === 2) {
          plotPixel(x, y, 220, 230, 250);
          plotPixel(x+1, y, 200, 215, 240);
        } else {
          plotPixel(x, y, 160, 180, 220);
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
    },
  };
}
