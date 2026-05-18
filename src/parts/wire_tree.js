// Wireframe Christmas tree: 4 stacked cone tiers + 3D star + 8 orbiting wire
// gift cubes, all CPU-projected and rasterized into a pixel buffer.
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
  // Slight vignette + scanline.
  vec2 c = v_uv - 0.5;
  col *= mix(0.55, 1.0, 1.0 - smoothstep(0.50, 0.95, length(c)));
  float scan = 0.92 + 0.08 * sin(v_uv.y * float(${VH}) * 3.14159);
  col *= scan;
  outColor = vec4(col, 1.0);
}
`;

// ---- Geometry helpers ----------------------------------------------------

function coneEdges(cy, radius, height, segs) {
  // Returns array of [ax,ay,az, bx,by,bz, r,g,b].
  // A tier is rendered as a single horizontal ring at its base. Stacked rings
  // read clearly as a stylized Christmas tree without spoke clutter.
  // `height` and the apex are no longer drawn; kept in the signature so callers
  // don't change.
  void height;
  const out = [];
  const hue = Math.min(1, cy / 90);
  const r = (40 + hue * 60) | 0;
  const g = (170 + hue * 60) | 0;
  const b = (70 + hue * 90) | 0;
  const ring = [];
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    ring.push([Math.cos(a) * radius, cy, Math.sin(a) * radius]);
  }
  for (let i = 0; i < segs; i++) {
    const a = ring[i], b2 = ring[(i + 1) % segs];
    out.push([a[0], a[1], a[2], b2[0], b2[1], b2[2], r, g, b]);
  }
  return out;
}

function trunkEdges(yTop, yBot, color) {
  // Vertical brown trunk connecting the bottom tier to the ground.
  return [[0, yBot, 0, 0, yTop, 0, color[0], color[1], color[2]]];
}

function cubeEdges(cx, cy, cz, size, color) {
  const h = size / 2;
  const v = [
    [cx-h,cy-h,cz-h],[cx+h,cy-h,cz-h],[cx+h,cy+h,cz-h],[cx-h,cy+h,cz-h],
    [cx-h,cy-h,cz+h],[cx+h,cy-h,cz+h],[cx+h,cy+h,cz+h],[cx-h,cy+h,cz+h],
  ];
  const edges = [
    [0,1],[1,2],[2,3],[3,0],
    [4,5],[5,6],[6,7],[7,4],
    [0,4],[1,5],[2,6],[3,7],
  ];
  return edges.map(([a, b]) => [
    v[a][0], v[a][1], v[a][2],
    v[b][0], v[b][1], v[b][2],
    color[0], color[1], color[2],
  ]);
}

function star3D(cx, cy, cz, r, color) {
  // 5-point star drawn in two perpendicular planes (Z=cz and X=cx).
  const out = [];
  function star(plane) {
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const rr = i % 2 === 0 ? r : r * 0.42;
      const dx = Math.cos(a) * rr;
      const dy = Math.sin(a) * rr;
      if (plane === 'xy') pts.push([cx + dx, cy + dy, cz]);
      else                pts.push([cx, cy + dy, cz + dx]);
    }
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      out.push([a[0], a[1], a[2], b[0], b[1], b[2], color[0], color[1], color[2]]);
    }
  }
  star('xy');
  star('yz');
  return out;
}

export function wire_tree(gl) {
  const prog = createProgram(gl, VS_FULLSCREEN, FS);
  const uTex = gl.getUniformLocation(prog, 'u_tex');

  const buf   = new Uint8Array(VW * VH * 4);
  const scene = new Uint8Array(VW * VH * 4);
  const tex   = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, VW, VH, 0, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // Static background scene: deep navy + sparse stars + moon.
  (function buildScene() {
    for (let y = 0; y < VH; y++) {
      const t = y / VH;
      const r = (4 + t * 14) | 0;
      const g = (6 + t * 8)  | 0;
      const b = (24 + t * 36) | 0;
      for (let x = 0; x < VW; x++) {
        const j = (y * VW + x) * 4;
        scene[j] = r; scene[j+1] = g; scene[j+2] = b; scene[j+3] = 255;
      }
    }
    for (let i = 0; i < 110; i++) {
      const x = (Math.random() * VW) | 0;
      const y = (Math.random() * VH) | 0;
      const j = (y * VW + x) * 4;
      const c = 140 + ((Math.random() * 100) | 0);
      scene[j] = c; scene[j+1] = c; scene[j+2] = Math.min(255, c + 20);
    }
  })();

  // Build edge list once. Stacked horizontal rings (branch silhouettes) +
  // brown trunk + star above the top ring.
  const edges = [];
  edges.push(...coneEdges( 0, 50, 0, 24));
  edges.push(...coneEdges(18, 40, 0, 22));
  edges.push(...coneEdges(36, 30, 0, 18));
  edges.push(...coneEdges(54, 20, 0, 14));
  edges.push(...coneEdges(72, 10, 0, 10));
  edges.push(...trunkEdges(0, -16, [120, 70, 40]));
  edges.push(...star3D(0, 90, 0, 12, [255, 235, 130]));

  // Per-frame: gifts orbit. Each gift gets its own animated edge set.
  const giftColors = [
    [230,  60,  60], [240, 200,  80], [110, 200,  90], [120, 160, 240],
    [240, 120, 200], [255, 180,  80], [180, 220, 240], [220, 220, 130],
  ];

  // Ornament positions: dots distributed around each ring, slightly offset
  // outward so they sit on the branch silhouette. Each has its own phase so
  // they twinkle out of sync.
  const ornaments = [];
  {
    const ringSpec = [
      [ 0, 50, 14], [18, 40, 12], [36, 30, 10], [54, 20,  8], [72, 10,  6],
    ];
    let phase = 0;
    for (const [cy, radius, n] of ringSpec) {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + (cy * 0.13);
        ornaments.push({
          p: [Math.cos(a) * radius, cy + 1, Math.sin(a) * radius],
          phase: phase++ * 0.41,
        });
      }
    }
  }

  // Garland helix: a stream of points winding 3.5 turns from the bottom ring
  // up to the top ring. Rendered as colored short segments that "march" with
  // a hue cycle so it looks like running Christmas lights.
  const GARLAND_N = 120;
  const garland = [];
  for (let i = 0; i < GARLAND_N; i++) {
    const t = i / (GARLAND_N - 1);
    // Radius tapers linearly from 50 (bottom) to 8 (top); y from -2 to 82.
    const r = 50 - t * 42;
    const y = -2 + t * 84;
    const a = t * Math.PI * 2 * 3.5;
    garland.push([Math.cos(a) * r, y, Math.sin(a) * r]);
  }

  // Falling snow: 2D screen-space particles. Pre-seeded with random y so the
  // first frame already has snow everywhere.
  const SNOW_N = 70;
  const snow = [];
  for (let i = 0; i < SNOW_N; i++) {
    snow.push({
      x: Math.random() * VW,
      y: Math.random() * VH,
      vy: 12 + Math.random() * 22,
      vx: (Math.random() - 0.5) * 4,
      sway: Math.random() * Math.PI * 2,
      bright: 180 + ((Math.random() * 60) | 0),
    });
  }

  let tt = 0, lastT = 0;

  function plot(x, y, r, g, b) {
    if (x < 0 || x >= VW || y < 0 || y >= VH) return;
    const j = ((y | 0) * VW + (x | 0)) * 4;
    buf[j] = r; buf[j+1] = g; buf[j+2] = b; buf[j+3] = 255;
  }

  function plotAdd(x, y, r, g, b) {
    // Additive plot for overlapping bright particles (snow, sparkles).
    if (x < 0 || x >= VW || y < 0 || y >= VH) return;
    const j = ((y | 0) * VW + (x | 0)) * 4;
    buf[j]   = Math.min(255, buf[j]   + r);
    buf[j+1] = Math.min(255, buf[j+1] + g);
    buf[j+2] = Math.min(255, buf[j+2] + b);
    buf[j+3] = 255;
  }

  function filledDisc(cx, cy, r, R, G, B) {
    const x0 = (cx - r) | 0, x1 = (cx + r) | 0;
    const y0 = (cy - r) | 0, y1 = (cy + r) | 0;
    const r2 = r * r;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= r2) plot(x, y, R, G, B);
      }
    }
  }

  // HSV->RGB, h in [0,1], s,v in [0,1].
  function hsv(h, s, v) {
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

  function thickLine(x0, y0, x1, y1, r, g, b) {
    // DDA with a precomputed step count. Endpoints are floats from project(),
    // so the classical Bresenham `x===xe && y===ye` termination is unreliable
    // (truncated targets can be over- or under-stepped and the loop runs away).
    const ix0 = x0 | 0, iy0 = y0 | 0;
    const ix1 = x1 | 0, iy1 = y1 | 0;
    const dxi = ix1 - ix0, dyi = iy1 - iy0;
    const n = Math.max(Math.abs(dxi), Math.abs(dyi));
    if (n === 0) { plot(ix0, iy0, r, g, b); return; }
    const xMajor = Math.abs(dxi) >= Math.abs(dyi);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = (x0 + (x1 - x0) * t) | 0;
      const y = (y0 + (y1 - y0) * t) | 0;
      plot(x, y, r, g, b);
      if (xMajor) plot(x, y + 1, r, g, b);
      else        plot(x + 1, y, r, g, b);
    }
  }
  const line = thickLine;

  return {
    render(gl, t, fbo) {
      const dt = lastT === 0 ? 0.016 : Math.min(0.05, (t - lastT) / 1000);
      lastT = t;
      tt += dt;

      buf.set(scene);

      // View / projection: tree spins about Y; slight tilt about X.
      const ang = tt * 0.35;
      const tilt = Math.sin(tt * 0.4) * 0.08;
      const cosA = Math.cos(ang),  sinA = Math.sin(ang);
      const cosT = Math.cos(tilt), sinT = Math.sin(tilt);
      // Camera distance from origin (along +Z, looking down -Z toward origin),
      // framed so the gifts and tree (y in [-12 .. 92]) sit on screen.
      const camZ = 230;
      const camY = 38;
      const f   = 240; // focal length (pixels per unit at z=1)

      function project(p) {
        let x = p[0], y = p[1], z = p[2];
        const rx = x * cosA + z * sinA;
        const rz = -x * sinA + z * cosA;
        x = rx; z = rz;
        const ry = y * cosT - z * sinT;
        const rz2 = y * sinT + z * cosT;
        y = ry; z = rz2;
        y -= camY;
        z = camZ - z;
        if (z < 5) return null;
        const sx = VW * 0.5 + (x * f) / z;
        const sy = VH * 0.5 - (y * f) / z;
        return [sx, sy, z];
      }

      // Build the dynamic gift edges this frame. Presents sit on a slow
      // turntable below the tree base, well clear of the lowest tier, and
      // each box also spins on its own Y axis with a little vertical bob.
      const dynamic = [];
      for (let i = 0; i < 8; i++) {
        // Each gift has its own orbital speed/direction, breathing radius,
        // and vertical hop so they all swirl around the tree at different
        // tempos instead of orbiting in lockstep.
        const dir       = (i % 2 === 0) ? 1 : -1;
        const speed     = 0.55 + (i % 4) * 0.18;
        const phase     = (i / 8) * Math.PI * 2 + tt * speed * dir;
        const orbitR    = 60 + Math.sin(tt * 0.9 + i * 1.3) * 10;
        const cx = Math.cos(phase) * orbitR;
        const cz = Math.sin(phase) * orbitR;
        // Vertical hop: each gift bounces between -12 and a few units above
        // the tree base. abs(sin) gives a nice springy bounce profile.
        const hop = Math.abs(Math.sin(tt * 1.4 + i * 0.9));
        const cy = -12 + hop * 14;
        const size = 8 + (i % 3);
        const spin = tt * (1.4 + (i % 3) * 0.4) * dir + i;
        const cs = Math.cos(spin), sn = Math.sin(spin);
        const h = size / 2;
        const v = [
          [-h,-h,-h], [ h,-h,-h], [ h, h,-h], [-h, h,-h],
          [-h,-h, h], [ h,-h, h], [ h, h, h], [-h, h, h],
        ].map(([vx, vy, vz]) => {
          const rx = vx * cs + vz * sn;
          const rz = -vx * sn + vz * cs;
          return [cx + rx, cy + vy, cz + rz];
        });
        const cubeE = [
          [0,1],[1,2],[2,3],[3,0],
          [4,5],[5,6],[6,7],[7,4],
          [0,4],[1,5],[2,6],[3,7],
        ];
        const col = giftColors[i];
        for (const [a, b] of cubeE) {
          dynamic.push([
            v[a][0], v[a][1], v[a][2],
            v[b][0], v[b][1], v[b][2],
            col[0], col[1], col[2],
          ]);
        }
        // Bow ribbons across the top face: short cross of contrasting edges.
        const bowH = h + 0.2;
        const bowCol = [255, 240, 180];
        dynamic.push([
          cx - h * cs, cy + bowH, cz + h * sn,
          cx + h * cs, cy + bowH, cz - h * sn,
          bowCol[0], bowCol[1], bowCol[2],
        ]);
        dynamic.push([
          cx + h * sn, cy + bowH, cz + h * cs,
          cx - h * sn, cy + bowH, cz - h * cs,
          bowCol[0], bowCol[1], bowCol[2],
        ]);
      }

      // Garland: short segments connecting consecutive helix points, hue-
      // shifted along their position so the whole spiral looks like running
      // lights chasing up the tree.
      for (let i = 0; i < garland.length - 1; i++) {
        const c = hsv(((i / 12) + tt * 0.6) % 1, 0.95, 1);
        dynamic.push([
          garland[i][0], garland[i][1], garland[i][2],
          garland[i + 1][0], garland[i + 1][1], garland[i + 1][2],
          c[0], c[1], c[2],
        ]);
      }

      const all = edges.concat(dynamic);
      for (const e of all) {
        const a = project([e[0], e[1], e[2]]);
        const b = project([e[3], e[4], e[5]]);
        if (!a || !b) continue;
        // Per-edge depth fade.
        const z = (a[2] + b[2]) * 0.5;
        const fade = Math.max(0.25, Math.min(1, 1 - (z - 160) / 160));
        const r = (e[6] * fade) | 0;
        const g = (e[7] * fade) | 0;
        const bb = (e[8] * fade) | 0;
        line(a[0], a[1], b[0], b[1], r, g, bb);
      }

      // Twinkling ornaments: project each, draw a filled disc whose color
      // pulses through HSV space and whose radius breathes.
      for (const o of ornaments) {
        const p = project(o.p);
        if (!p) continue;
        const pulse = 0.5 + 0.5 * Math.sin(tt * 4.2 + o.phase * 5.3);
        const c = hsv((o.phase + tt * 0.25) % 1, 0.8, 0.55 + pulse * 0.45);
        const fade = Math.max(0.3, Math.min(1, 1 - (p[2] - 160) / 160));
        const r = 1.3 + pulse * 1.5;
        filledDisc(p[0], p[1], r, (c[0] * fade) | 0, (c[1] * fade) | 0, (c[2] * fade) | 0);
      }

      // Star sparkles: short radial spokes emanating from the star center,
      // rotating slowly and pulsing in length.
      const starP = project([0, 90, 0]);
      if (starP) {
        const pulse = 0.5 + 0.5 * Math.sin(tt * 3.0);
        const len = 9 + pulse * 7;
        const baseAng = tt * 0.9;
        for (let i = 0; i < 8; i++) {
          const a = baseAng + (i / 8) * Math.PI * 2;
          const ex = starP[0] + Math.cos(a) * len;
          const ey = starP[1] + Math.sin(a) * len;
          const c = (180 + pulse * 75) | 0;
          line(starP[0], starP[1], ex, ey, c, c, (c * 0.6) | 0);
        }
        // Bright core
        filledDisc(starP[0], starP[1], 2 + pulse * 1.5, 255, 250, 200);
      }

      // Snow particles: update position then draw as additive small dots.
      for (const s of snow) {
        s.sway += dt * 2;
        s.x += (s.vx + Math.sin(s.sway) * 6) * dt;
        s.y += s.vy * dt;
        if (s.y >= VH) {
          s.y = -2;
          s.x = Math.random() * VW;
        }
        if (s.x < 0) s.x += VW;
        else if (s.x >= VW) s.x -= VW;
        const b = s.bright;
        plotAdd(s.x, s.y, b, b, b);
        plotAdd(s.x + 1, s.y, (b * 0.55) | 0, (b * 0.55) | 0, (b * 0.55) | 0);
        plotAdd(s.x, s.y + 1, (b * 0.55) | 0, (b * 0.55) | 0, (b * 0.55) | 0);
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
