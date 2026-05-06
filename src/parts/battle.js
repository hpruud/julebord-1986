// "Snowy Forest Night" - moonlit vector landscape part (originally a desert
// sunset; rebranded for the Julebord 1986 demo). The dune heightfield is
// reused but coloured as snow-capped pine forest, the horizon disc is now
// a full moon, and snowflake point sprites drift down from the upper sky.

import { VW, VH } from '../gl/context.js';
import { bindFBO } from '../gl/framebuffer.js';
import { mat4Mul, mat4Perspective, mat4RotateX, mat4RotateY, mat4RotateZ, mat4Translate, mat4FlipY } from '../util/math.js';

// ------- Sky + sun (fullscreen pre-pass) -------
const SKY_VS = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;
const SKY_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform float u_time;

// Cheap 2D hash for sparkly stars.
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  // The final blit applies a Y flip. So in this shader, v_uv.y = 0 maps to the
  // TOP of the screen and v_uv.y = 1 maps to the BOTTOM of the screen.
  float screenY = v_uv.y; // 0 top, 1 bottom (after blit flip)

  // Night sky band: midnight blue at zenith softening to a slightly warmer
  // indigo near the tree-line, then a near-black ground placeholder below
  // the horizon (which the dunes overdraw anyway).
  vec3 high = vec3(0.02, 0.04, 0.12);   // deep zenith
  vec3 mid  = vec3(0.06, 0.10, 0.22);   // mid sky
  vec3 low  = vec3(0.10, 0.14, 0.28);   // near horizon, faint moon-glow
  vec3 sky;
  if (screenY < 0.40)        sky = mix(high, mid, screenY / 0.40);
  else if (screenY < 0.70)   sky = mix(mid, low, (screenY - 0.40) / 0.30);
  else                       sky = vec3(0.02, 0.03, 0.06); // below-horizon placeholder

  // Star field across the upper sky (only above horizon so dunes hide the
  // rest). Discrete points, not a noise field, so they read as proper
  // pixel-art stars on the 320x256 canvas.
  if (screenY < 0.70) {
    // Quantise to ~1.5-pixel cells so individual stars stay crisp.
    vec2 cell = floor(vec2(v_uv.x, screenY) * vec2(160.0, 128.0));
    float h = hash(cell);
    // Roughly 1 in 80 cells gets a star.
    if (h > 0.9875) {
      float bright = 0.55 + 0.45 * hash(cell + 17.0);
      // Slow twinkle: per-star phase from another hash.
      float tw = 0.7 + 0.3 * sin(u_time * 1.3 + hash(cell + 31.0) * 6.28);
      sky += vec3(bright * tw);
    }
  }

  // Full moon: bright luminous disc with a soft two-stage halo and detailed
  // maria. The disc itself is computed on a quantised pixel grid (320x256)
  // and uses a hard threshold so the silhouette is a perfectly chunky
  // pixel-art circle - no anti-aliased edge.
  // The 320x256 framebuffer has a 1.25:1 pixel aspect, so the X axis is
  // compensated where needed.
  vec2 moonCentre = vec2(0.66, 0.30);

  // Halo uses the smooth (non-quantised) UV so the glow stays soft and
  // gradient-y around the hard disc.
  vec2 pHalo = (vec2(v_uv.x, screenY) - moonCentre) * vec2(1.25, 1.0);
  float rHalo = length(pHalo);
  float MOON_R = 0.090;
  float haloWide  = smoothstep(0.32, MOON_R, rHalo);
  float haloTight = smoothstep(0.16, MOON_R, rHalo);
  sky += vec3(0.55, 0.62, 0.78) * haloWide  * 0.10;
  sky += vec3(0.85, 0.90, 1.00) * haloTight * 0.18;

  // Pixel-quantised sample for the moon disc. Snap v_uv to the 320x256
  // grid (the internal framebuffer resolution) using pixel CENTRES so the
  // resulting disc is symmetric. After snapping, every fragment within
  // the same source pixel computes the exact same r/maria/mottling, which
  // is exactly the pixel-art look we want.
  vec2 px = (floor(v_uv * vec2(320.0, 256.0)) + 0.5) / vec2(320.0, 256.0);
  vec2 p = (vec2(px.x, px.y) - moonCentre) * vec2(1.25, 1.0);
  float r = length(p);

  // Hard pixel-perfect disc with a 1-pixel-wide anti-aliased edge so the
  // silhouette looks round even on the small 320x256 framebuffer.
  // We use the smooth (non-quantised) radius for the alpha so adjacent
  // edge pixels can fade in partial coverage, but the interior detail
  // (maria, mottling, craters) still uses the snapped sample point so
  // surface features stay chunky pixel-art.
  // 1 pixel in moon-local UV is roughly 1/256 vertically and 1/320
  // horizontally; ~0.005 covers either case.
  float disc = smoothstep(MOON_R + 0.005, MOON_R - 0.001, rHalo);
  // Bright near-white core; cool tint at the limb so it reads spherical.
  vec3 moonCore = vec3(1.00, 0.99, 0.94);
  // Maria: low-amplitude darkening blobs in moon-local UV (-1..1 across disc).
  // Shapes loosely based on Mare Imbrium (upper-left), Mare Serenitatis +
  // Mare Tranquillitatis (right cluster) and Mare Nubium (lower).
  vec2 mp = p / MOON_R;
  float maria = 0.0;
  // Mare Imbrium - large oval upper-left
  vec2 d1 = (mp - vec2(-0.30,  0.30)) * vec2(1.0, 1.3);
  maria += smoothstep(0.55, 0.10, length(d1)) * 0.13;
  // Mare Serenitatis - mid-right round patch
  vec2 d2 = (mp - vec2( 0.25,  0.05)) * vec2(1.1, 1.0);
  maria += smoothstep(0.30, 0.05, length(d2)) * 0.11;
  // Mare Tranquillitatis - elongated patch right of Serenitatis
  vec2 d3 = (mp - vec2( 0.45, -0.15)) * vec2(0.9, 1.4);
  maria += smoothstep(0.32, 0.05, length(d3)) * 0.10;
  // Mare Nubium / Humorum - lower-left
  vec2 d4 = (mp - vec2(-0.20, -0.40)) * vec2(1.2, 1.0);
  maria += smoothstep(0.32, 0.05, length(d4)) * 0.09;
  // Mare Crisium - small detached oval far-right
  vec2 d5 = (mp - vec2( 0.65,  0.25)) * vec2(1.4, 1.0);
  maria += smoothstep(0.18, 0.03, length(d5)) * 0.10;
  // Subtle high-frequency surface mottling (cheap noise via stacked sines).
  float mott = sin(mp.x * 18.0 + 1.7) * cos(mp.y * 17.0 + 0.3)
             + sin(mp.x * 31.0) * cos(mp.y * 29.0);
  mott = mott * 0.5 + 0.5;          // 0..1
  float mottAmp = 0.025;
  vec3 moonCol = moonCore - vec3(maria) - vec3(mottAmp) * (mott - 0.5);
  // Bright crater highlights (Tycho near bottom + Copernicus mid).
  float tychoR = length(mp - vec2(-0.05, -0.55));
  float tychoSpot = smoothstep(0.10, 0.0, tychoR) * 0.18;
  float tychoRays = smoothstep(0.45, 0.10, tychoR) * 0.04;
  float coperR = length(mp - vec2(-0.10,  0.05));
  float coperSpot = smoothstep(0.06, 0.0, coperR) * 0.15;
  moonCol += vec3(tychoSpot + tychoRays + coperSpot);
  // Soft limb darkening only in the last ~22% of the radius for a
  // spherical read. Quantised so it steps in 1-pixel bands.
  float limb = smoothstep(0.78, 1.00, length(mp));
  moonCol = mix(moonCol, moonCol * vec3(0.84, 0.86, 0.96), limb);

  sky = mix(sky, moonCol, disc);

  outColor = vec4(sky, 1.0);
}
`;

// ------- Dunes (flat-shaded triangles) -------
const DUNE_VS = `#version 300 es
in vec3 a_pos;
in float a_shade;
uniform mat4 u_mvp;
out float v_shade;
void main() {
  gl_Position = u_mvp * vec4(a_pos, 1.0);
  v_shade = a_shade;
}
`;
const DUNE_FS = `#version 300 es
precision highp float;
in float v_shade;
out vec4 outColor;
void main() {
  // Snow-capped pine-forest ramp. Shadowed valleys read as dark blue-green
  // forest interior, mid slopes are pine-needle green, sunlit (moonlit)
  // crests are powder-blue snow tipped almost white. The hard 0.92 split
  // between green and snow imitates a thin dusting only on the highest
  // ridges, leaving most of the terrain looking like forest floor / grass.
  vec3 c0 = vec3(0.04, 0.10, 0.08);   // deep forest shadow
  vec3 c1 = vec3(0.08, 0.20, 0.12);   // pine green mid (muted winter tone)
  vec3 c2 = vec3(0.16, 0.32, 0.20);   // moonlit foliage (still subdued)
  vec3 c3 = vec3(0.78, 0.86, 0.92);   // snow base (cool moonlit)
  vec3 c4 = vec3(0.96, 0.98, 1.00);   // snow highlight
  float s = clamp(v_shade, 0.0, 1.0);
  vec3 col;
  if (s < 0.50) {
    col = mix(c0, c1, s / 0.50);
  } else if (s < 0.92) {
    col = mix(c1, c2, (s - 0.50) / 0.42);
  } else {
    // Snow line: snow only on the highest-lit slopes.
    col = mix(c3, c4, (s - 0.92) / 0.08);
  }
  outColor = vec4(col, 1.0);
}
`;

// ------- Floating object (rotating low-poly diamond/octahedron, flat shaded) -------
const OBJ_VS = `#version 300 es
in vec3 a_pos;
in float a_shade;
uniform mat4 u_mvp;
out float v_shade;
void main() {
  gl_Position = u_mvp * vec4(a_pos, 1.0);
  v_shade = a_shade;
}
`;
const OBJ_FS = `#version 300 es
precision highp float;
in float v_shade;
out vec4 outColor;
uniform vec3 u_colorLo;
uniform vec3 u_colorHi;
void main() {
  vec3 col = mix(u_colorLo, u_colorHi, clamp(v_shade, 0.0, 1.0));
  outColor = vec4(col, 1.0);
}
`;

// Detailed-ship shader: per-vertex normal + 8-color palette index, Gouraud
// lighting with ambient + diffuse + a small Phong specular term. Emissive
// (unlit) channel via the alpha-style "emissive" flag baked into normal.w.
//
// Vertex layout (28 bytes / 7 floats per vertex):
//   pos.xyz (3f)  normal.xyz (3f)  colorIdx (1f, 0..7)
//
// The colorIdx channel addresses an 8-entry RGBA palette uniform; the
// alpha component encodes (1.0 = lit, 0.0 = emissive) so cockpit windows /
// engine glows can pop at full brightness.
const OBJ2_VS = `#version 300 es
in vec3 a_pos;
in vec3 a_normal;
in float a_colorIdx;
uniform mat4 u_mvp;
uniform mat4 u_model;
uniform vec4 u_palette[8];
out vec3 v_color;
out float v_lit;
void main() {
  gl_Position = u_mvp * vec4(a_pos, 1.0);
  // Rotate normal by model matrix (assumes uniform scale, no shear).
  vec3 n = normalize(mat3(u_model) * a_normal);
  // Two-light setup: warm sunset key from horizon, cool fill from sky.
  vec3 keyDir  = normalize(vec3( 0.55, 0.30, 0.80));   // warm sun
  vec3 fillDir = normalize(vec3(-0.20, 0.90,-0.30));   // cool top fill
  float key  = max(dot(n, keyDir),  0.0);
  float fill = max(dot(n, fillDir), 0.0);
  // Phong-ish spec from key light, view = -z.
  vec3 viewDir = vec3(0.0, 0.0, 1.0);
  vec3 refl = reflect(-keyDir, n);
  float spec = pow(max(dot(refl, viewDir), 0.0), 12.0) * 0.45;
  // Lookup palette entry (workaround: GLSL ES 3.00 needs constant index for
  // some drivers; use a chain of mixes).
  int idx = int(clamp(a_colorIdx + 0.5, 0.0, 7.0));
  vec4 pal = u_palette[0];
  if (idx == 1) pal = u_palette[1];
  else if (idx == 2) pal = u_palette[2];
  else if (idx == 3) pal = u_palette[3];
  else if (idx == 4) pal = u_palette[4];
  else if (idx == 5) pal = u_palette[5];
  else if (idx == 6) pal = u_palette[6];
  else if (idx == 7) pal = u_palette[7];
  vec3 albedo = pal.rgb;
  float emissive = 1.0 - pal.a;       // pal.a==0 -> fully emissive
  vec3 ambient = albedo * 0.32;
  vec3 lit = albedo * (key * 0.85 + fill * 0.35) + vec3(1.0,0.95,0.85) * spec;
  vec3 col = ambient + lit;
  // Mix toward pure albedo when emissive (windows / engines glow at night).
  col = mix(col, albedo * 1.35, emissive);
  v_color = col;
  v_lit = 1.0;
}
`;
const OBJ2_FS = `#version 300 es
precision highp float;
in vec3 v_color;
in float v_lit;
out vec4 outColor;
void main() {
  outColor = vec4(v_color, 1.0);
}
`;

// Bright unlit lines for laser bolts.
const LINE_VS = `#version 300 es
in vec3 a_pos;
uniform mat4 u_mvp;
void main() { gl_Position = u_mvp * vec4(a_pos, 1.0); }
`;
const LINE_FS = `#version 300 es
precision highp float;
out vec4 outColor;
uniform vec3 u_color;
void main() { outColor = vec4(u_color, 1.0); }
`;

// Point sprites for explosions and smoke. Each particle carries:
//   a_pos    : world-space position (vec3)
//   a_size   : screen-space size in pixels (float)
//   a_color  : RGBA tint (vec4) - alpha is overall intensity
// The fragment shader makes a soft round disk via gl_PointCoord.
const PART_VS = `#version 300 es
in vec3 a_pos;
in float a_size;
in vec4 a_color;
uniform mat4 u_mvp;
out vec4 v_color;
void main() {
  gl_Position = u_mvp * vec4(a_pos, 1.0);
  // Perspective scaling: bigger when close.
  float w = max(0.001, gl_Position.w);
  gl_PointSize = clamp(a_size / w, 1.0, 64.0);
  v_color = a_color;
}
`;
const PART_FS = `#version 300 es
precision highp float;
in vec4 v_color;
out vec4 outColor;
uniform float u_mode; // 0 = soft glow (additive), 1 = puff (alpha)
void main() {
  vec2 d = gl_PointCoord - vec2(0.5);
  float r = length(d);
  if (r > 0.5) discard;
  float a;
  if (u_mode < 0.5) {
    // Hot core fireball: bright center, fast falloff.
    a = pow(1.0 - r * 2.0, 1.6);
  } else {
    // Soft smoke puff.
    a = (1.0 - r * 2.0) * 0.7;
  }
  outColor = vec4(v_color.rgb, v_color.a * a);
}
`;

import { drawQuad } from '../gl/quad.js';

function compile(gl, vsSrc, fsSrc, attribs) {
  const prog = gl.createProgram();
  const vs = gl.createShader(gl.VERTEX_SHADER); gl.shaderSource(vs, vsSrc); gl.compileShader(vs);
  if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) console.error('battle vs:', gl.getShaderInfoLog(vs));
  const fs = gl.createShader(gl.FRAGMENT_SHADER); gl.shaderSource(fs, fsSrc); gl.compileShader(fs);
  if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) console.error('battle fs:', gl.getShaderInfoLog(fs));
  gl.attachShader(prog, vs); gl.attachShader(prog, fs);
  for (let i = 0; i < attribs.length; i++) gl.bindAttribLocation(prog, i, attribs[i]);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) console.error('battle link:', gl.getProgramInfoLog(prog));
  return prog;
}

// Build heightmap and triangle buffer.
// Grid GW x GD spanning x in [-W..+W], z in [-D_FAR..0], y from height function.
function buildDunes() {
  const GW = 64;       // columns (x)
  const GD = 96;       // depth rows (z)
  const W  = 30.0;
  const D_NEAR = -1.0;
  const D_FAR  = -90.0;

  // height function
  function h(x, z) {
    // larger rolling dunes + smaller bumps
    const a = Math.sin(x * 0.18) * Math.cos(z * 0.12) * 1.6;
    const b = Math.sin(x * 0.07 + z * 0.05) * 2.4;
    const c = Math.sin(x * 0.32 + z * 0.21) * 0.5;
    // farther (more negative z) -> taller mountains in the back
    const farBoost = Math.max(0, (-z - 30) / 60) * 2.5;
    return a + b + c + farBoost;
  }

  const verts = [];
  function vertex(ix, iz) {
    const u = ix / (GW - 1);
    const v = iz / (GD - 1);
    const x = -W + u * 2 * W;
    const z = D_NEAR + v * (D_FAR - D_NEAR);
    const y = h(x, z) - 3.0; // ground sits below camera (negative y); +y is up
    return [x, y, z];
  }

  for (let iz = GD - 2; iz >= 0; iz--) {
    for (let ix = 0; ix < GW - 1; ix++) {
      const a = vertex(ix,   iz);
      const b = vertex(ix+1, iz);
      const c = vertex(ix,   iz+1);
      const d = vertex(ix+1, iz+1);

      // flat-shading: per-triangle shade based on slope (cheap "lighting").
      function shade(p0, p1, p2) {
        const ux = p1[0]-p0[0], uy = p1[1]-p0[1], uz = p1[2]-p0[2];
        const vx = p2[0]-p0[0], vy = p2[1]-p0[1], vz = p2[2]-p0[2];
        // normal = u x v
        let nx = uy*vz - uz*vy;
        let ny = uz*vx - ux*vz;
        let nz = ux*vy - uy*vx;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len; ny /= len; nz /= len;
        // Force normals to point up (dunes are a heightfield, no overhangs).
        if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
        // Light: full moon overhead and slightly forward, so flat tops
        // catch the most light (snow line) and steep slopes face down into
        // shadow. Slight z-bias gives the ridges a subtle directional cast.
        const lx = 0.10, ly = 0.95, lz = 0.30;
        const ll = Math.hypot(lx, ly, lz);
        const dot = (nx*lx + ny*ly + nz*lz) / ll;
        // Map -1..1 -> 0.30..1.0 (strong ambient so back slopes are still
        // visibly forest, not pitch black at night).
        const lit = 0.30 + 0.70 * (dot * 0.5 + 0.5);
        return Math.max(0.0, Math.min(1.0, lit));
      }

      const s1 = shade(a, b, c);
      const s2 = shade(b, d, c);
      verts.push(a[0],a[1],a[2], s1,  b[0],b[1],b[2], s1,  c[0],c[1],c[2], s1);
      verts.push(b[0],b[1],b[2], s2,  d[0],d[1],d[2], s2,  c[0],c[1],c[2], s2);
    }
  }
  return new Float32Array(verts);
}

// ------- Pine trees (silhouetted forest scattered across the dunes) -------
// Each tree is a stylised pine: two perpendicular triangle "billboards"
// crossed in an X so the silhouette reads from any angle. We also add a
// short trunk quad. Trees are placed at deterministic random (x,z) on the
// heightfield so the layout is stable across runs.
//
// Vertex layout matches duneStride (pos.xyz + shade) so we can render with
// a dedicated shader that ignores shade and outputs a near-black forest
// silhouette with a hint of moon-rim on the tips.
const TREE_VS = `#version 300 es
in vec3 a_pos;
in float a_shade;
uniform mat4 u_mvp;
out float v_shade;
out float v_height;
void main() {
  gl_Position = u_mvp * vec4(a_pos, 1.0);
  v_shade = a_shade;
  // Encode local Y (0..1 from base to tip) into shade attr: we set it that
  // way in buildTrees().
  v_height = a_shade;
}
`;
const TREE_FS = `#version 300 es
precision highp float;
in float v_shade;
in float v_height;
out vec4 outColor;
void main() {
  // Dark forest pine green - rich enough to read as evergreen needles, but
  // dark enough to silhouette cleanly against the moonlit snow. The very
  // top picks up a touch of cool moon-rim lighting on the tip.
  vec3 body = vec3(0.05, 0.16, 0.09);
  vec3 tip  = vec3(0.10, 0.26, 0.14);
  vec3 rim  = vec3(0.55, 0.62, 0.72);
  // Smooth body->tip ramp gives a slight vertical gradient (lower needles
  // sit deeper in shadow than the upper crown).
  vec3 col = mix(body, tip, smoothstep(0.0, 1.0, v_height));
  // Hard moon-rim only on the very tips so silhouettes still read.
  float rimMix = smoothstep(0.85, 1.05, v_height) * 0.22;
  col = mix(col, rim, rimMix);
  outColor = vec4(col, 1.0);
}
`;

function buildTrees() {
  // Same height function as buildDunes() so trees sit on the ground.
  function h(x, z) {
    const a = Math.sin(x * 0.18) * Math.cos(z * 0.12) * 1.6;
    const b = Math.sin(x * 0.07 + z * 0.05) * 2.4;
    const c = Math.sin(x * 0.32 + z * 0.21) * 0.5;
    const farBoost = Math.max(0, (-z - 30) / 60) * 2.5;
    return a + b + c + farBoost;
  }

  // Tiny deterministic LCG for repeatable scatter.
  let seed = 0x13579bdf;
  function rnd() { seed = (seed * 1664525 + 1013904223) | 0; return ((seed >>> 0) / 4294967296); }

  const verts = [];
  // pushTri stores pos.xyz + shade; we use shade to encode "height fraction"
  // (0=base, 1=tip) so the FS can rim-light tips.
  function pushTri(p0, p1, p2, h0, h1, h2) {
    verts.push(p0[0],p0[1],p0[2], h0,
               p1[0],p1[1],p1[2], h1,
               p2[0],p2[1],p2[2], h2);
  }

  const W = 30.0;
  const D_NEAR = -2.0;
  const D_FAR  = -85.0;

  // ~120 trees scattered. Avoid placing trees too close to the camera path
  // (centre x corridor) so the foreground doesn't get cluttered.
  const N = 140;
  for (let i = 0; i < N; i++) {
    const x = -W + rnd() * 2 * W;
    const z = D_NEAR + rnd() * (D_FAR - D_NEAR);
    // Skip a narrow camera-corridor near the front so we keep clear sight
    // lines to the moon and ships.
    if (Math.abs(x) < 3.5 && z > -25.0) continue;

    const groundY = h(x, z) - 3.0;
    // Tree size: bigger in the back so distant pines still register.
    const distNorm = Math.min(1.0, (-z) / 80.0);  // 0 near .. 1 far
    const baseHeight = 1.6 + rnd() * 1.2 + distNorm * 1.5;
    const baseHalfW  = 0.55 + rnd() * 0.30;
    // Trunk
    const trunkH = baseHeight * 0.18;
    const trunkHalfW = 0.10;
    // Tip Y (top of foliage cone), base Y (bottom of foliage cone)
    const baseY = groundY + trunkH;
    const tipY  = baseY + baseHeight;

    // Cross billboards: two perpendicular triangles.
    // Plane 1: lies in XY (normal = +Z) -> base spans (x-bw, x+bw) at z
    pushTri([x - baseHalfW, baseY, z],
            [x + baseHalfW, baseY, z],
            [x,             tipY,  z],
            0.0, 0.0, 1.0);
    // Plane 2: lies in ZY (normal = +X) -> base spans (z-bw, z+bw) at x
    pushTri([x, baseY, z - baseHalfW],
            [x, baseY, z + baseHalfW],
            [x, tipY,  z],
            0.0, 0.0, 1.0);

    // Mid-cone (slightly smaller, set higher) for a layered pine silhouette.
    const midBaseY = baseY + baseHeight * 0.35;
    const midTipY  = baseY + baseHeight * 1.15;
    const midHalfW = baseHalfW * 0.75;
    pushTri([x - midHalfW, midBaseY, z],
            [x + midHalfW, midBaseY, z],
            [x,            midTipY,  z],
            0.35, 0.35, 1.10);
    pushTri([x, midBaseY, z - midHalfW],
            [x, midBaseY, z + midHalfW],
            [x, midTipY,  z],
            0.35, 0.35, 1.10);

    // Trunk quad (two triangles) - very small dark rectangle.
    pushTri([x - trunkHalfW, groundY, z],
            [x + trunkHalfW, groundY, z],
            [x + trunkHalfW, baseY,   z],
            0.0, 0.0, 0.0);
    pushTri([x - trunkHalfW, groundY, z],
            [x + trunkHalfW, baseY,   z],
            [x - trunkHalfW, baseY,   z],
            0.0, 0.0, 0.0);
  }
  return new Float32Array(verts);
}


// ------- Santa + reindeer flying across the sky --------------------------
// Built as a flat 2D pixel-art silhouette in pixel coordinates (0..VW,
// 0..VH) with per-vertex RGB colour. Rendered with a dedicated screen-
// space shader that takes pixel coords and converts them to clip space.
// The whole composite is ~64x16 px wide; we translate it horizontally
// each frame to make Santa fly across the sky.
const SANTA_VS = `#version 300 es
in vec2 a_pos;        // pixel coords (0..VW, 0..VH); y=0 is top
in vec3 a_color;
uniform vec2 u_offset;   // pixel offset applied to a_pos
uniform vec2 u_screen;   // VW, VH
out vec3 v_color;
void main() {
  vec2 px = a_pos + u_offset;
  // Convert pixel coords to NDC. Do NOT flip Y here - the FBO-to-screen
  // blit applies a Y-flip on present, so emitting straight NDC puts
  // pixel y=0 at the top of the screen visually (same convention as
  // starfield.js's santa overlay).
  vec2 ndc = (px / u_screen) * 2.0 - 1.0;
  gl_Position = vec4(ndc, 0.0, 1.0);
  v_color = a_color;
}
`;
const SANTA_FS = `#version 300 es
precision highp float;
in vec3 v_color;
out vec4 outColor;
void main() { outColor = vec4(v_color, 1.0); }
`;

function buildSanta() {
  // 64x16 pixel-art mesh. Each filled cell = 2 triangles (a quad).
  // We hand-place rectangles to draw four reindeer + sleigh + santa.
  // Coordinates are in local "pixel" units; (0,0) is top-left of bbox.
  const verts = [];
  function rect(x, y, w, h, r, g, b) {
    const x0 = x,     y0 = y;
    const x1 = x + w, y1 = y + h;
    verts.push(x0,y0,r,g,b,  x1,y0,r,g,b,  x0,y1,r,g,b);
    verts.push(x1,y0,r,g,b,  x1,y1,r,g,b,  x0,y1,r,g,b);
  }

  // Palette
  const BROWN_BODY  = [0.50, 0.30, 0.16];   // reindeer body
  const BROWN_DARK  = [0.28, 0.16, 0.08];   // antlers / runners
  const RED_NOSE    = [1.00, 0.15, 0.10];   // Rudolph's nose
  const RED_SLEIGH  = [0.78, 0.10, 0.10];   // sleigh + Santa coat
  const GOLD        = [1.00, 0.82, 0.20];   // sleigh trim
  const SKIN        = [0.95, 0.78, 0.62];   // Santa face
  const WHITE       = [0.96, 0.96, 0.96];   // beard / hat trim

  // ----- Four reindeer in a row, each occupying a 10-px-wide slot -----
  // Reindeer silhouette (8x10 px):
  //   Antlers at top, head, body, four legs.
  // Stride: 10 px between reindeer fronts.
  for (let i = 0; i < 4; i++) {
    const ox = i * 10;
    // Antlers (two 1px stems with a 1px branch each, mostly decorative)
    rect(ox + 1, 0, 1, 2, ...BROWN_DARK);
    rect(ox + 0, 1, 1, 1, ...BROWN_DARK);   // left antler branch
    rect(ox + 3, 0, 1, 2, ...BROWN_DARK);
    rect(ox + 4, 1, 1, 1, ...BROWN_DARK);   // right antler branch

    // Head (3x3)
    rect(ox + 1, 2, 4, 3, ...BROWN_BODY);
    // Snout extension (1px forward)
    rect(ox + 5, 3, 1, 1, ...BROWN_BODY);
    // Body (5x3) tucked behind the head
    rect(ox + 0, 5, 7, 3, ...BROWN_BODY);
    // Legs - alternating gallop pose so the team looks animated.
    if (i % 2 === 0) {
      rect(ox + 0, 8, 1, 3, ...BROWN_BODY);   // front leg back
      rect(ox + 2, 8, 1, 2, ...BROWN_BODY);   // front leg short
      rect(ox + 4, 8, 1, 3, ...BROWN_BODY);   // back  leg back
      rect(ox + 6, 8, 1, 2, ...BROWN_BODY);   // back  leg short
    } else {
      rect(ox + 0, 8, 1, 2, ...BROWN_BODY);
      rect(ox + 2, 8, 1, 3, ...BROWN_BODY);
      rect(ox + 4, 8, 1, 2, ...BROWN_BODY);
      rect(ox + 6, 8, 1, 3, ...BROWN_BODY);
    }
    // Tail
    rect(ox - 1, 5, 1, 1, ...BROWN_BODY);
  }

  // ----- Lead reindeer's red nose (Rudolph) -----
  // The lead reindeer is the rightmost one (closest to the sleigh).
  // i = 3 corresponds to the front of the team since we draw moving right.
  const leadX = 3 * 10;
  rect(leadX + 5, 4, 1, 1, ...RED_NOSE);   // glowing nose pixel

  // ----- Reins: thin gold lines from sleigh to each reindeer's head -----
  // (Drawn as 1-px-tall horizontal strips between reindeer; cheap but reads.)
  for (let i = 0; i < 4; i++) {
    const x0 = i * 10 + 5;     // approx head of this reindeer
    const x1 = (i + 1) * 10;   // approx tail of next (or sleigh start at 40)
    if (x1 > x0) rect(x0, 4, x1 - x0, 1, ...GOLD);
  }

  // ----- Sleigh at x=42..60 (18px wide, 8px tall body + runners) -----
  const sx = 42;
  // Sleigh body main (deep red)
  rect(sx + 0, 6, 16, 4, ...RED_SLEIGH);
  // Curved front lip (rises up to the front)
  rect(sx + 14, 4, 2, 2, ...RED_SLEIGH);
  rect(sx + 16, 5, 1, 1, ...RED_SLEIGH);
  // Gold trim along top edge
  rect(sx + 0, 5, 16, 1, ...GOLD);
  rect(sx + 14, 3, 2, 1, ...GOLD);
  // Runner (curved bottom rail in dark brown)
  rect(sx - 1, 10, 18, 1, ...BROWN_DARK);
  rect(sx + 16, 9, 1, 1, ...BROWN_DARK);   // upturned rear of runner

  // ----- Santa sitting in the sleigh -----
  // Santa hat (red triangle approx + white trim + white pom)
  rect(sx + 4, 0, 4, 1, ...RED_SLEIGH);    // hat tip row
  rect(sx + 3, 1, 6, 1, ...RED_SLEIGH);    // hat
  rect(sx + 3, 2, 6, 1, WHITE[0], WHITE[1], WHITE[2]);  // hat trim
  // White pom on the hat tip
  rect(sx + 4, 0, 1, 1, WHITE[0], WHITE[1], WHITE[2]);
  // Face (skin)
  rect(sx + 4, 3, 4, 2, ...SKIN);
  // Beard (white) - covers lower face and hangs onto the coat
  rect(sx + 3, 5, 6, 1, WHITE[0], WHITE[1], WHITE[2]);
  // Coat (red) - the body; sits on top of the sleigh
  rect(sx + 3, 6, 6, 1, ...RED_SLEIGH);
  rect(sx + 4, 7, 4, 1, ...RED_SLEIGH);    // narrower mid-body

  // The team is travelling LEFT->RIGHT across the screen, so the reindeer
  // (which pull the sleigh) must be at the FRONT = right-hand side. The
  // mesh above was authored with reindeer on the left and sleigh on the
  // right, so mirror every x-coordinate horizontally around the bbox.
  // Vertex stride: 5 floats (x, y, r, g, b). After mirroring, also swap the
  // two triangles' winding-equivalent vertices isn't needed because we draw
  // with cull-face disabled (no glEnable(CULL_FACE) for santa).
  let minX =  Infinity, maxX = -Infinity;
  for (let i = 0; i < verts.length; i += 5) {
    const x = verts[i];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
  }
  const sum = minX + maxX;
  for (let i = 0; i < verts.length; i += 5) {
    verts[i] = sum - verts[i];   // reflect across (minX+maxX)/2
  }

  // ----- Speed lines / motion streaks BEHIND the team in white -----
  // Team moves left->right, so streaks trail to the LEFT of the sleigh.
  // After mirroring, the sleigh's left edge is at x = minX (well, near it).
  // Place 5 short dashes just left of that.
  for (let i = 0; i < 5; i++) {
    rect(minX - 2 - i * 3, 6 + (i % 2), 2, 1, 0.85, 0.90, 1.00);
  }

  return new Float32Array(verts);
}


function buildObject() {
  const v = [
    [ 1, 0, 0],
    [-1, 0, 0],
    [ 0, 1, 0],
    [ 0,-1, 0],
    [ 0, 0, 1],
    [ 0, 0,-1],
  ];
  const F = [];
  // 8 faces, alternating between two color slots for facet contrast.
  const f = [
    [0,2,4],[2,1,4],[1,3,4],[3,0,4],
    [2,0,5],[1,2,5],[3,1,5],[0,3,5],
  ];
  for (let i = 0; i < f.length; i++) {
    F.push({ idx: f[i], col: i % 2, smooth: false });
  }
  return buildMesh({ verts: v, faces: F });
}

// Helper: take a vertex/index list and return flat-shaded triangle data
// (3 floats pos + 1 float shade per vertex), with per-face shade computed
// from a simple top-light dot product.
function facesToFlatShaded(verts, faces, lightDir = [-0.4, 0.8, 0.4]) {
  const out = [];
  const lLen = Math.hypot(...lightDir) || 1;
  const lx = lightDir[0]/lLen, ly = lightDir[1]/lLen, lz = lightDir[2]/lLen;
  for (let i = 0; i < faces.length; i++) {
    const [a,b,c] = faces[i];
    const p0 = verts[a], p1 = verts[b], p2 = verts[c];
    const ux = p1[0]-p0[0], uy = p1[1]-p0[1], uz = p1[2]-p0[2];
    const vx = p2[0]-p0[0], vy = p2[1]-p0[1], vz = p2[2]-p0[2];
    let nx = uy*vz - uz*vy;
    let ny = uz*vx - ux*vz;
    let nz = ux*vy - uy*vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    let dot = nx*lx + ny*ly + nz*lz;
    if (dot < 0) dot = -dot * 0.35; // soft fill
    const s = Math.max(0.15, Math.min(1.0, dot));
    out.push(p0[0],p0[1],p0[2], s,
             p1[0],p1[1],p1[2], s,
             p2[0],p2[1],p2[2], s);
  }
  return new Float32Array(out);
}

// Multi-material mesh builder for the detailed OBJ2 shader.
// Input: { verts: [[x,y,z], ...], faces: [{ idx:[a,b,c], col:0..7, smooth:bool }] }
// Output: Float32Array with stride 7 (pos.xyz, normal.xyz, colorIdx).
//
// For smooth faces: vertex normals are accumulated across all smooth faces
// that share each vertex (creates Gouraud-style soft shading on curved hulls
// like the Falcon's saucer).
// For flat faces: vertices are duplicated and given the face normal.
// Smooth-vs-flat is decided per-face; flat faces never share vertices with
// other faces (each gets fresh duplicates).
function buildMesh(spec) {
  const { verts, faces } = spec;
  // Step 1: accumulate smooth normals at original vertex indices.
  const smoothN = verts.map(() => [0,0,0]);
  for (const f of faces) {
    if (!f.smooth) continue;
    const [a,b,c] = f.idx;
    const p0 = verts[a], p1 = verts[b], p2 = verts[c];
    const ux = p1[0]-p0[0], uy = p1[1]-p0[1], uz = p1[2]-p0[2];
    const vx = p2[0]-p0[0], vy = p2[1]-p0[1], vz = p2[2]-p0[2];
    let nx = uy*vz - uz*vy;
    let ny = uz*vx - ux*vz;
    let nz = ux*vy - uy*vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    smoothN[a][0]+=nx; smoothN[a][1]+=ny; smoothN[a][2]+=nz;
    smoothN[b][0]+=nx; smoothN[b][1]+=ny; smoothN[b][2]+=nz;
    smoothN[c][0]+=nx; smoothN[c][1]+=ny; smoothN[c][2]+=nz;
  }
  // Normalize accumulated smooth normals.
  for (const n of smoothN) {
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    n[0]/=l; n[1]/=l; n[2]/=l;
  }
  // Step 2: emit triangles. Each face emits 3 fresh vertices (no index buffer)
  // for simplicity; flat faces use the face normal, smooth faces use vertex
  // smooth normals.
  const out = [];
  for (const f of faces) {
    const [a,b,c] = f.idx;
    const col = f.col || 0;
    const p0 = verts[a], p1 = verts[b], p2 = verts[c];
    let n0, n1, n2;
    if (f.smooth) {
      n0 = smoothN[a]; n1 = smoothN[b]; n2 = smoothN[c];
    } else {
      const ux = p1[0]-p0[0], uy = p1[1]-p0[1], uz = p1[2]-p0[2];
      const vx = p2[0]-p0[0], vy = p2[1]-p0[1], vz = p2[2]-p0[2];
      let nx = uy*vz - uz*vy;
      let ny = uz*vx - ux*vz;
      let nz = ux*vy - uy*vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      n0 = n1 = n2 = [nx, ny, nz];
    }
    out.push(
      p0[0],p0[1],p0[2], n0[0],n0[1],n0[2], col,
      p1[0],p1[1],p1[2], n1[0],n1[1],n1[2], col,
      p2[0],p2[1],p2[2], n2[0],n2[1],n2[2], col,
    );
  }
  return new Float32Array(out);
}

// Quad helper for ship builders: pushes two triangles for [a,b,c,d] ccw.
function quad(faces, a, b, c, d, col, smooth = false) {
  faces.push({ idx:[a,b,c], col, smooth });
  faces.push({ idx:[a,c,d], col, smooth });
}
function tri(faces, a, b, c, col, smooth = false) {
  faces.push({ idx:[a,b,c], col, smooth });
}
// =====================================================================
// DETAILED SHIP BUILDERS
// All ships use the multi-material `buildMesh` path. Each ship's geometry
// is authored in a local space oriented along -z = forward, +y = up.
// Color indices reference an 8-entry palette set per-ship at draw time.
// =====================================================================

// ---------- Star Destroyer ----------
// Wedge-shaped Imperial hull: triangular cross-section with sloped sides,
// long superstructure ridge running down the dorsal centerline, command
// bridge tower with windows, three engine bells at the back, and a faint
// ventral hangar bay groove. Color slots:
//   0 hull mid    1 hull dark    2 hull light    3 windows (emissive)
//   4 engine ring 5 engine glow (emissive)        6 ridge accent
function buildStarDestroyer() {
  const v = [];
  const F = [];
  const P = (...xs) => { v.push(xs); return v.length - 1; };

  // Hull profile: a long triangular dagger.
  // Dorsal centerline (top ridge) and two sloped flanks meeting at a keel.
  // Keep all numbers in [-2..+2] roughly.
  const TIP = -2.20;          // nose Z
  const TAIL = 1.10;          // back Z
  const W = 1.05;             // back half-width
  const TOP_Y = 0.08;          // ridge top
  const FLANK_Y = -0.02;       // sloped flanks meet flat sides here
  const KEEL_Y = -0.20;        // ventral keel
  // Nose & ridge points
  const noseTop = P(0,    TOP_Y, TIP);
  const noseKeel = P(0,   KEEL_Y, TIP);
  // Tail dorsal corners
  const tailTL = P(-W*0.60, TOP_Y,  TAIL);     // top-left of dorsal flat
  const tailTR = P( W*0.60, TOP_Y,  TAIL);
  // Tail flank corners (where dorsal slope meets flat side)
  const tailFL = P(-W,      FLANK_Y, TAIL);
  const tailFR = P( W,      FLANK_Y, TAIL);
  // Tail keel corners
  const tailKL = P(-W*0.55, KEEL_Y, TAIL);
  const tailKR = P( W*0.55, KEEL_Y, TAIL);
  // Mid-hull points (helps break up huge tris and add the ridge)
  const midZ = (TIP + TAIL) * 0.5;
  const midTL = P(-W*0.40, TOP_Y,  midZ);
  const midTR = P( W*0.40, TOP_Y,  midZ);
  const midFL = P(-W*0.65, FLANK_Y, midZ);
  const midFR = P( W*0.65, FLANK_Y, midZ);
  const midKL = P(-W*0.35, KEEL_Y, midZ);
  const midKR = P( W*0.35, KEEL_Y, midZ);

  // Dorsal panels (top, light gray)
  // Nose -> mid (ridge stays a line)
  tri(F, noseTop, midTR, midTL, 2);
  // Mid -> tail dorsal flat
  quad(F, midTL, midTR, tailTR, tailTL, 2);
  // Dorsal-to-flank slope (left)
  tri(F, noseTop, midTL, midFL, 0);
  quad(F, midTL, midFL, tailFL, tailTL, 0);
  // Dorsal-to-flank slope (right)
  tri(F, noseTop, midFR, midTR, 0);
  quad(F, midTR, midFR, tailFR, tailTR, 0);
  // Flank-to-keel (left, darker)
  tri(F, noseKeel, midFL, noseTop, 1); // small front fillet
  // Actually rebuild flanks more carefully: ventral side
  // Left flank panel (mid color)
  quad(F, noseKeel, midKL, midFL, noseTop, 1);  // nose triangle wedge (wraps)
  quad(F, midKL, tailKL, tailFL, midFL, 1);
  // Right flank panel
  quad(F, noseTop, midFR, midKR, noseKeel, 1);
  quad(F, midFR, tailFR, tailKR, midKR, 1);
  // Ventral (bottom) panels
  tri(F, noseKeel, midKR, midKL, 1);
  quad(F, midKL, midKR, tailKR, tailKL, 1);
  // Tail cap (back of ship)
  // Top tail flat -> flank -> keel: split into two quads.
  quad(F, tailTL, tailTR, tailFR, tailFL, 0);   // upper back
  quad(F, tailFL, tailFR, tailKR, tailKL, 1);   // lower back

  // ---- Dorsal superstructure ridge (raised spine, light) ----
  const RY = TOP_Y + 0.06;
  const ridgeF_L = P(-0.05, RY, midZ + 0.30);
  const ridgeF_R = P( 0.05, RY, midZ + 0.30);
  const ridgeB_L = P(-0.10, RY, TAIL - 0.05);
  const ridgeB_R = P( 0.10, RY, TAIL - 0.05);
  // ridge top
  quad(F, ridgeF_L, ridgeF_R, ridgeB_R, ridgeB_L, 2);
  // ridge sides
  // (use the dorsal points as the base; pick 4 anchors on dorsal plane)
  const baseF_L = P(-0.05, TOP_Y, midZ + 0.30);
  const baseF_R = P( 0.05, TOP_Y, midZ + 0.30);
  const baseB_L = P(-0.10, TOP_Y, TAIL - 0.05);
  const baseB_R = P( 0.10, TOP_Y, TAIL - 0.05);
  quad(F, baseF_L, ridgeF_L, ridgeB_L, baseB_L, 6); // left side accent
  quad(F, baseB_R, ridgeB_R, ridgeF_R, baseF_R, 6); // right side accent
  quad(F, baseF_R, ridgeF_R, ridgeF_L, baseF_L, 6); // front face
  quad(F, baseB_L, ridgeB_L, ridgeB_R, baseB_R, 6); // back face

  // ---- Bridge tower (rear dorsal) ----
  // Two-tier tower: lower wide block + upper thin command deck with windows.
  const tx = 0.14, tz0 = 0.55, tz1 = 0.95;
  const TY0 = TOP_Y;
  const TY1 = 0.26;
  const TY2 = 0.40;
  // Lower box
  const L0 = P(-tx, TY0, tz0), L1 = P( tx, TY0, tz0);
  const L2 = P(-tx, TY0, tz1), L3 = P( tx, TY0, tz1);
  const L4 = P(-tx, TY1, tz0+0.02), L5 = P( tx, TY1, tz0+0.02);
  const L6 = P(-tx, TY1, tz1-0.02), L7 = P( tx, TY1, tz1-0.02);
  quad(F, L0,L1,L5,L4, 2); // front
  quad(F, L3,L2,L6,L7, 2); // back
  quad(F, L2,L0,L4,L6, 2); // left
  quad(F, L1,L3,L7,L5, 2); // right
  quad(F, L4,L5,L7,L6, 0); // top (becomes deck)
  // Upper command deck (narrower, taller)
  const ux = 0.09, uz0 = tz0 + 0.04, uz1 = tz1 - 0.04;
  const U0 = P(-ux, TY1, uz0), U1 = P( ux, TY1, uz0);
  const U2 = P(-ux, TY1, uz1), U3 = P( ux, TY1, uz1);
  const U4 = P(-ux, TY2, uz0+0.01), U5 = P( ux, TY2, uz0+0.01);
  const U6 = P(-ux, TY2, uz1-0.01), U7 = P( ux, TY2, uz1-0.01);
  quad(F, U0,U1,U5,U4, 2);
  quad(F, U3,U2,U6,U7, 2);
  quad(F, U2,U0,U4,U6, 2);
  quad(F, U1,U3,U7,U5, 2);
  quad(F, U4,U5,U7,U6, 0);
  // Bridge windows (emissive horizontal strips on front face of upper deck)
  const wy0 = TY1 + 0.04, wy1 = TY1 + 0.10;
  const W0 = P(-ux*0.85, wy0, uz0 - 0.001);
  const W1 = P( ux*0.85, wy0, uz0 - 0.001);
  const W2 = P(-ux*0.85, wy1, uz0 - 0.005);
  const W3 = P( ux*0.85, wy1, uz0 - 0.005);
  quad(F, W0, W1, W3, W2, 3);
  // Two sphere domes on top of deck (sensor globes)
  function dome(cx, cz, cy, r, col) {
    // 4-tri cap (low-poly hemisphere)
    const top = P(cx, cy + r, cz);
    const a   = P(cx + r, cy, cz);
    const b   = P(cx, cy, cz + r);
    const c   = P(cx - r, cy, cz);
    const d   = P(cx, cy, cz - r);
    tri(F, top, a, b, col, true);
    tri(F, top, b, c, col, true);
    tri(F, top, c, d, col, true);
    tri(F, top, d, a, col, true);
  }
  dome(-0.045, (uz0+uz1)/2, TY2, 0.04, 2);
  dome( 0.045, (uz0+uz1)/2, TY2, 0.04, 2);

  // ---- Engine bells (back of ship, three large + four small) ----
  function ring(cx, cy, cz, r, depth, ringCol, glowCol) {
    // Cylinder: front ring of N points, back ring of N points (slightly smaller),
    // glow disc inside.
    const N = 8;
    const front = [];
    const back  = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      front.push(P(cx + Math.cos(a)*r,        cy + Math.sin(a)*r,        cz));
      back .push(P(cx + Math.cos(a)*r*0.85,   cy + Math.sin(a)*r*0.85,   cz + depth));
    }
    // Outer wall (smooth-shaded)
    for (let i = 0; i < N; i++) {
      const j = (i+1) % N;
      quad(F, front[i], back[i], back[j], front[j], ringCol, true);
    }
    // Glow disc (slightly recessed) - emissive
    const glowZ = cz + depth * 0.4;
    const center = P(cx, cy, glowZ);
    for (let i = 0; i < N; i++) {
      const j = (i+1) % N;
      const a = (i / N) * Math.PI * 2;
      const aj = (j / N) * Math.PI * 2;
      const ri = r * 0.78;
      const ga = P(cx + Math.cos(a) *ri, cy + Math.sin(a) *ri, glowZ);
      const gb = P(cx + Math.cos(aj)*ri, cy + Math.sin(aj)*ri, glowZ);
      tri(F, center, ga, gb, glowCol);
    }
  }
  ring( 0.00, 0.00, TAIL - 0.05, 0.22, 0.22, 4, 5);
  ring(-0.42, 0.00, TAIL - 0.05, 0.20, 0.20, 4, 5);
  ring( 0.42, 0.00, TAIL - 0.05, 0.20, 0.20, 4, 5);
  ring(-0.70,-0.06, TAIL - 0.03, 0.10, 0.12, 4, 5);
  ring( 0.70,-0.06, TAIL - 0.03, 0.10, 0.12, 4, 5);

  return buildMesh({ verts: v, faces: F });
}

// ---------- X-wing ----------
// More detailed Incom T-65: nose cone, fuselage, cockpit canopy (emissive
// blue-gray), R2-D2 astromech dome behind canopy, four S-foils with engine
// intakes at the wing roots, wingtip cannons.
//   0 hull white   1 hull gray   2 red trim   3 canopy (emissive)
//   4 R2 blue      5 cannon dark  6 engine glow (emissive)  7 engine ring
function buildXWing() {
  const v = [];
  const F = [];
  const P = (...xs) => { v.push(xs); return v.length - 1; };

  // Fuselage cross-section: roughly square, tapering toward nose.
  // Forward (-z) is nose direction.
  // Nose tip
  const NX = 0.0, NY = 0.0, NZ = -0.95;
  const noseTip = P(NX, NY, NZ);
  // Nose ring (4 points, very small)
  const nr = 0.04;
  const n0 = P( nr, nr, -0.55);
  const n1 = P(-nr, nr, -0.55);
  const n2 = P(-nr,-nr, -0.55);
  const n3 = P( nr,-nr, -0.55);
  // Mid fuselage ring (larger)
  const mr = 0.10;
  const m0 = P( mr, mr,  0.00);
  const m1 = P(-mr, mr,  0.00);
  const m2 = P(-mr,-mr,  0.00);
  const m3 = P( mr,-mr,  0.00);
  // Rear ring (engine block)
  const rr = 0.13;
  const r0 = P( rr, rr,  0.55);
  const r1 = P(-rr, rr,  0.55);
  const r2 = P(-rr,-rr,  0.55);
  const r3 = P( rr,-rr,  0.55);
  // Build fuselage segments
  // Nose tip -> nose ring (4 tris)
  tri(F, noseTip, n0, n1, 0);
  tri(F, noseTip, n1, n2, 0);
  tri(F, noseTip, n2, n3, 0);
  tri(F, noseTip, n3, n0, 0);
  // Nose ring -> mid ring (4 quads)
  quad(F, n0, n1, m1, m0, 0); // top
  quad(F, n1, n2, m2, m1, 0); // left
  quad(F, n2, n3, m3, m2, 1); // bottom (gray)
  quad(F, n3, n0, m0, m3, 0); // right
  // Mid ring -> rear ring
  quad(F, m0, m1, r1, r0, 0);
  quad(F, m1, m2, r2, r1, 0);
  quad(F, m2, m3, r3, r2, 1);
  quad(F, m3, m0, r0, r3, 0);
  // Rear cap (engine block back)
  quad(F, r3, r2, r1, r0, 1);

  // Cockpit canopy: trapezoid prism on top of mid fuselage.
  const cy0 = mr, cy1 = mr + 0.10;
  const cz0 = -0.20, cz1 = 0.20;
  const cx = 0.07;
  const k0 = P( cx, cy0, cz0), k1 = P(-cx, cy0, cz0);
  const k2 = P(-cx, cy0, cz1), k3 = P( cx, cy0, cz1);
  const k4 = P( cx*0.7, cy1, cz0+0.04), k5 = P(-cx*0.7, cy1, cz0+0.04);
  const k6 = P(-cx*0.7, cy1, cz1-0.04), k7 = P( cx*0.7, cy1, cz1-0.04);
  quad(F, k0, k4, k7, k3, 3); // right (window)
  quad(F, k1, k2, k6, k5, 3); // left (window)
  quad(F, k0, k1, k5, k4, 3); // front
  quad(F, k3, k7, k6, k2, 3); // back
  quad(F, k4, k5, k6, k7, 3); // top

  // R2-D2 dome behind cockpit
  function r2dome(cxr, cyr, czr, rr2) {
    const top = P(cxr, cyr + rr2, czr);
    const fr = P(cxr, cyr + rr2*0.3, czr - rr2);
    const bk = P(cxr, cyr + rr2*0.3, czr + rr2);
    const lt = P(cxr - rr2, cyr + rr2*0.3, czr);
    const rt = P(cxr + rr2, cyr + rr2*0.3, czr);
    tri(F, top, fr, lt, 4, true);
    tri(F, top, lt, bk, 4, true);
    tri(F, top, bk, rt, 4, true);
    tri(F, top, rt, fr, 4, true);
  }
  r2dome(0.0, mr, 0.30, 0.07);

  // S-foils: 4 wings forming an X, each with a thin elongated panel.
  // Each wing has root (at fuselage rear), tip (out + slightly back), with
  // engine intake at the root and a cannon at the tip.
  function wing(sx, sy, mirror) {
    // sx/sy = direction of wing (right/up unit-ish multipliers)
    const tipX = 0.70 * sx;
    const tipY = 0.40 * sy;
    const rootZ0 = 0.30, rootZ1 = 0.55;
    const tipZ0 = 0.40, tipZ1 = 0.55;
    // Engine pod at root: small cylinder protruding back
    const ex = 0.18 * sx, ey = 0.13 * sy;
    const e0 = P( ex+0.04*sx, ey, rootZ1);
    const e1 = P( ex-0.04*sx, ey, rootZ1);
    const e2 = P( ex-0.04*sx, ey, rootZ1+0.10);
    const e3 = P( ex+0.04*sx, ey, rootZ1+0.10);
    // The engine "ring" (back face) is emissive glow; sides are gray ring.
    quad(F, e0, e1, e2, e3, 7);                    // outer side (gray)
    // emissive glow disc on back
    const eb0 = P( ex+0.03*sx, ey-0.01*sy, rootZ1+0.10);
    const eb1 = P( ex-0.03*sx, ey-0.01*sy, rootZ1+0.10);
    const eb2 = P( ex-0.03*sx, ey+0.01*sy, rootZ1+0.10);
    const eb3 = P( ex+0.03*sx, ey+0.01*sy, rootZ1+0.10);
    quad(F, eb0, eb1, eb2, eb3, 6);
    // Wing panel itself (a flat thin rectangle from root to tip)
    const thick = 0.025;
    const wr0 = P(ex,        ey,        rootZ0);
    const wr1 = P(ex,        ey,        rootZ1);
    const wt0 = P(tipX,      tipY,      tipZ0);
    const wt1 = P(tipX,      tipY,      tipZ1);
    const wr0u = P(ex,       ey + thick*sy, rootZ0);
    const wr1u = P(ex,       ey + thick*sy, rootZ1);
    const wt0u = P(tipX,     tipY + thick*sy, tipZ0);
    const wt1u = P(tipX,     tipY + thick*sy, tipZ1);
    if (mirror) {
      quad(F, wr0, wt0, wt1, wr1, 0);
      quad(F, wr1u, wt1u, wt0u, wr0u, 0);
      // red stripe on top
      const s0 = P(ex + 0.05*sx, ey + thick*sy + 0.001, rootZ0 + 0.04);
      const s1 = P(ex + 0.05*sx, ey + thick*sy + 0.001, rootZ0 + 0.10);
      const s2 = P(tipX*0.6,     tipY*0.6 + thick*sy + 0.001, tipZ0 + 0.05);
      const s3 = P(tipX*0.6,     tipY*0.6 + thick*sy + 0.001, tipZ0 + 0.11);
      quad(F, s0, s2, s3, s1, 2);
    } else {
      quad(F, wr0, wr1, wt1, wt0, 0);
      quad(F, wr0u, wt0u, wt1u, wr1u, 0);
      const s0 = P(ex + 0.05*sx, ey + thick*sy + 0.001, rootZ0 + 0.04);
      const s1 = P(ex + 0.05*sx, ey + thick*sy + 0.001, rootZ0 + 0.10);
      const s2 = P(tipX*0.6,     tipY*0.6 + thick*sy + 0.001, tipZ0 + 0.05);
      const s3 = P(tipX*0.6,     tipY*0.6 + thick*sy + 0.001, tipZ0 + 0.11);
      quad(F, s1, s3, s2, s0, 2);
    }
    // Wingtip cannon: a thin long cylinder running -z .. +z at tip.
    const cr = 0.025;
    const c0 = P(tipX + cr, tipY, -0.20);
    const c1 = P(tipX - cr, tipY, -0.20);
    const c2 = P(tipX - cr, tipY, 0.55);
    const c3 = P(tipX + cr, tipY, 0.55);
    const c4 = P(tipX, tipY + cr, -0.20);
    const c5 = P(tipX, tipY - cr, -0.20);
    const c6 = P(tipX, tipY - cr, 0.55);
    const c7 = P(tipX, tipY + cr, 0.55);
    quad(F, c0, c4, c7, c3, 5);
    quad(F, c4, c1, c2, c7, 5);
    quad(F, c1, c5, c6, c2, 5);
    quad(F, c5, c0, c3, c6, 5);
    // cannon tip cap
    tri(F, c0, c4, c5, 5);
    tri(F, c4, c1, c5, 5);
  }
  wing( 1,  1, false); // upper-right
  wing(-1,  1, true);  // upper-left
  wing( 1, -1, true);  // lower-right
  wing(-1, -1, false); // lower-left

  return buildMesh({ verts: v, faces: F });
}

// ---------- TIE Fighter ----------
// Detailed: octa-faceted spherical pod, front viewport (emissive),
// chin twin guns, two solar-panel wings with rib detail and central strut.
//   0 panel black  1 pod gray   2 pod dark   3 viewport (emissive)
//   4 strut       5 panel rib   6 gun barrel
function buildTie() {
  const v = [];
  const F = [];
  const P = (...xs) => { v.push(xs); return v.length - 1; };

  // Pod: cube with chamfered edges via 14 verts (8 corners + 6 face centers
  // pulled out slightly for a faceted ball).
  const s = 0.20;
  const c = 0.13;
  // 8 cube corners (chamfered toward center-faces)
  const C000 = P(-c, -c, -c);
  const C100 = P( c, -c, -c);
  const C010 = P(-c,  c, -c);
  const C110 = P( c,  c, -c);
  const C001 = P(-c, -c,  c);
  const C101 = P( c, -c,  c);
  const C011 = P(-c,  c,  c);
  const C111 = P( c,  c,  c);
  // 6 face-center "pushed out" points
  const Fpx = P( s, 0, 0);
  const Fnx = P(-s, 0, 0);
  const Fpy = P( 0, s, 0);
  const Fny = P( 0,-s, 0);
  const Fpz = P( 0, 0, s);
  const Fnz = P( 0, 0,-s);
  // Each face: 4 triangles fanning from center to 4 corners (smooth shading).
  // +X face: corners C100, C110, C111, C101
  tri(F, Fpx, C100, C110, 1, true);
  tri(F, Fpx, C110, C111, 1, true);
  tri(F, Fpx, C111, C101, 1, true);
  tri(F, Fpx, C101, C100, 1, true);
  // -X face
  tri(F, Fnx, C010, C000, 1, true);
  tri(F, Fnx, C000, C001, 1, true);
  tri(F, Fnx, C001, C011, 1, true);
  tri(F, Fnx, C011, C010, 1, true);
  // +Y face
  tri(F, Fpy, C110, C010, 1, true);
  tri(F, Fpy, C010, C011, 1, true);
  tri(F, Fpy, C011, C111, 1, true);
  tri(F, Fpy, C111, C110, 1, true);
  // -Y face
  tri(F, Fny, C100, C101, 2, true);
  tri(F, Fny, C101, C001, 2, true);
  tri(F, Fny, C001, C000, 2, true);
  tri(F, Fny, C000, C100, 2, true);
  // +Z face (back)
  tri(F, Fpz, C101, C111, 1, true);
  tri(F, Fpz, C111, C011, 1, true);
  tri(F, Fpz, C011, C001, 1, true);
  tri(F, Fpz, C001, C101, 1, true);
  // -Z face (front) - we'll leave the center for the viewport plate

  // Front viewport: a hexagonal emissive plate inset on -Z face.
  const vpZ = -s - 0.005;
  const vpR = 0.10;
  const vpC = P(0, 0, vpZ);
  const vp = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    vp.push(P(Math.cos(a) * vpR, Math.sin(a) * vpR, vpZ));
  }
  for (let i = 0; i < 6; i++) {
    tri(F, vpC, vp[i], vp[(i+1)%6], 3);
  }
  // Hex frame around viewport: small dark ring connecting hex to -Z face corners.
  // (Connect each hex vertex to nearest cube corner with thin dark strip.)
  // For simplicity, fill the -Z face minus the hex with 4 trapezoidal strips.
  // Top strip: from C010-C110 down to top hex edge (vp[1]-vp[2]).
  // Use ordering: vp[0]=right, vp[1]=upper-right, vp[2]=upper-left, vp[3]=left, vp[4]=lower-left, vp[5]=lower-right
  quad(F, C010, C110, vp[1], vp[2], 2); // top strip
  quad(F, C110, C100, vp[0], vp[1], 2); // right strip
  quad(F, C100, C000, vp[5], vp[0], 2); // bottom strip
  quad(F, C000, C010, vp[2], vp[3], 2); // left strip
  // wait: only 4 strips for 4 cube edges; but hex has 6 corners. Add two
  // small triangles at the diagonal corners.
  // Actually the 4 quads each consume 2 hex verts; that's 8 hex assignments
  // for only 6 verts - means duplicates. Let me redo cleanly:
  // Use 4 trapezoids using shared hex verts. Order cube corners:
  //   tl=C010, tr=C110, br=C100, bl=C000
  // Hex (around z=-s, ccw from +x): vp[0..5]
  // Top: tl(C010)-tr(C110)-vp[1]-vp[2]  (already added)
  // Right: tr(C110)-br(C100)-vp[5]?? no — vp index 0 is at +x, vp[5] is at +x,-y.
  // Let me just add a couple of corner triangles for completeness.
  tri(F, C110, vp[0], vp[1], 2); // upper-right corner fill
  tri(F, C100, vp[5], vp[0], 2); // lower-right corner fill
  tri(F, C000, vp[4], vp[5], 2); // lower-left corner fill
  tri(F, C010, vp[3], vp[4], 2); // upper-left corner fill -- but vp[3] is left, vp[4] is lower-left
  // (Some of these may overlap with the strips; visually fine.)

  // Chin guns: two short barrels under the pod, pointing forward.
  function gun(gx) {
    const gr = 0.018;
    const gz0 = -s - 0.02, gz1 = -s - 0.18;
    const a = P(gx + gr, -c - 0.02, gz0);
    const b = P(gx - gr, -c - 0.02, gz0);
    const cc= P(gx - gr, -c - 0.04, gz1);
    const d = P(gx + gr, -c - 0.04, gz1);
    const e = P(gx, -c - 0.02 + gr, gz0);
    const f = P(gx, -c - 0.02 - gr, gz0);
    const g = P(gx, -c - 0.04 - gr, gz1);
    const h = P(gx, -c - 0.04 + gr, gz1);
    quad(F, a, e, h, d, 6);
    quad(F, e, b, cc, h, 6);
    quad(F, b, f, g, cc, 6);
    quad(F, f, a, d, g, 6);
    // tip cap
    tri(F, e, a, f, 6);
    tri(F, a, b, f, 6); // (degenerate-ish but fine)
  }
  gun(-0.06);
  gun( 0.06);

  // Solar panels (hexagonal, with rib detail) on each side at x = +/- panelX.
  function panel(side) {
    const px = 0.55 * side;
    // hex shape in YZ plane, radius 0.40 vertical, 0.34 depth
    const ry = 0.40, rz = 0.30;
    const h0 = P(px, 0, rz);
    const h1 = P(px, ry*0.6, rz*0.5);
    const h2 = P(px, ry, 0);
    const h3 = P(px, ry*0.6, -rz*0.5);
    const h4 = P(px, 0, -rz);
    const h5 = P(px,-ry*0.6, -rz*0.5);
    const h6 = P(px,-ry, 0);
    const h7 = P(px,-ry*0.6, rz*0.5);
    // outer face (fan from center)
    const cen = P(px, 0, 0);
    tri(F, cen, h0, h1, 0);
    tri(F, cen, h1, h2, 0);
    tri(F, cen, h2, h3, 0);
    tri(F, cen, h3, h4, 0);
    tri(F, cen, h4, h5, 0);
    tri(F, cen, h5, h6, 0);
    tri(F, cen, h6, h7, 0);
    tri(F, cen, h7, h0, 0);
    // back face (slightly recessed)
    const bx = px - 0.04 * side;
    const b0 = P(bx, 0, rz*0.95);
    const b2 = P(bx, ry*0.95, 0);
    const b4 = P(bx, 0, -rz*0.95);
    const b6 = P(bx,-ry*0.95, 0);
    const bcen = P(bx, 0, 0);
    tri(F, bcen, b2, b0, 0);
    tri(F, bcen, b4, b2, 0);
    tri(F, bcen, b6, b4, 0);
    tri(F, bcen, b0, b6, 0);
    // edge rim (between front and back) - 4 quads
    if (side > 0) {
      quad(F, h0, b0, b2, h2, 5);
      quad(F, h2, b2, b4, h4, 5);
      quad(F, h4, b4, b6, h6, 5);
      quad(F, h6, b6, b0, h0, 5);
    } else {
      quad(F, h2, b2, b0, h0, 5);
      quad(F, h4, b4, b2, h2, 5);
      quad(F, h6, b6, b4, h4, 5);
      quad(F, h0, b0, b6, h6, 5);
    }
    // Rib detail on outer face: vertical and horizontal "I-beam" ribs.
    const ribZ = 0.012 * side;
    const rt = 0.025;
    // vertical rib (top to bottom)
    const vr0 = P(px + ribZ, ry, rt);
    const vr1 = P(px + ribZ, ry,-rt);
    const vr2 = P(px + ribZ,-ry,-rt);
    const vr3 = P(px + ribZ,-ry, rt);
    quad(F, vr0, vr1, vr2, vr3, 5);
    // horizontal rib
    const hr0 = P(px + ribZ, rt,  rz);
    const hr1 = P(px + ribZ,-rt,  rz);
    const hr2 = P(px + ribZ,-rt, -rz);
    const hr3 = P(px + ribZ, rt, -rz);
    quad(F, hr0, hr3, hr2, hr1, 5);
  }
  panel( 1);
  panel(-1);

  // Struts connecting pod to panels (small horizontal bars)
  function strut(side) {
    const x0 = side * (s + 0.005);
    const x1 = side * 0.51;
    const a = P(x0, 0.025, 0.025);
    const b = P(x0,-0.025, 0.025);
    const c = P(x0,-0.025,-0.025);
    const d = P(x0, 0.025,-0.025);
    const e = P(x1, 0.025, 0.025);
    const f = P(x1,-0.025, 0.025);
    const g = P(x1,-0.025,-0.025);
    const h = P(x1, 0.025,-0.025);
    quad(F, a, b, f, e, 4);
    quad(F, b, c, g, f, 4);
    quad(F, c, d, h, g, 4);
    quad(F, d, a, e, h, 4);
  }
  strut( 1);
  strut(-1);

  return buildMesh({ verts: v, faces: F });
}

// ---------- Millennium Falcon ----------
// Saucer-shaped hull (smooth-shaded ring), top and bottom domes,
// front mandibles with cargo bay gap, side cockpit on starboard side
// with emissive viewports, top quad-laser turret, bottom radar dish,
// rear engine glow strip.
//   0 hull cream    1 hull dark (panel lines)  2 cockpit blue (emissive)
//   3 turret gray   4 dish white               5 engine glow (emissive)
//   6 antenna       7 panel mid (warm beige)
function buildFalcon() {
  const v = [];
  const F = [];
  const P = (...xs) => { v.push(xs); return v.length - 1; };

  const N = 16;             // saucer ring resolution
  const R = 0.85;           // outer radius
  const H = 0.08;           // saucer half-height at rim
  const DR = 0.55;          // dome radius (top/bottom)
  const DH = 0.18;          // dome height

  // Outer rim ring (top and bottom edge of saucer)
  const rimT = [];
  const rimB = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const cx = Math.cos(a) * R;
    const cz = Math.sin(a) * R;
    rimT.push(P(cx,  H, cz));
    rimB.push(P(cx, -H, cz));
  }
  // Inner top-dome ring
  const innerT = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    innerT.push(P(Math.cos(a)*DR, H, Math.sin(a)*DR));
  }
  // Inner bottom-dome ring
  const innerB = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    innerB.push(P(Math.cos(a)*DR, -H, Math.sin(a)*DR));
  }
  // Top-dome apex
  const topApex = P(0,  H + DH, 0);
  // Bottom-dome apex
  const botApex = P(0, -H - DH, 0);

  // Top flat ring (outer rim down to inner ring) - segmented for panel lines
  for (let i = 0; i < N; i++) {
    const j = (i+1) % N;
    // alternate panel colors for visible sectors
    const col = (i % 2 === 0) ? 0 : 7;
    quad(F, rimT[i], rimT[j], innerT[j], innerT[i], col);
  }
  // Bottom flat ring
  for (let i = 0; i < N; i++) {
    const j = (i+1) % N;
    const col = (i % 2 === 0) ? 7 : 0;
    quad(F, innerB[i], innerB[j], rimB[j], rimB[i], col);
  }
  // Outer rim wall (smooth-shaded)
  for (let i = 0; i < N; i++) {
    const j = (i+1) % N;
    quad(F, rimT[i], rimB[i], rimB[j], rimT[j], 1, true);
  }
  // Top dome (smooth)
  for (let i = 0; i < N; i++) {
    const j = (i+1) % N;
    tri(F, topApex, innerT[i], innerT[j], 0, true);
  }
  // Bottom dome (smooth)
  for (let i = 0; i < N; i++) {
    const j = (i+1) % N;
    tri(F, botApex, innerB[j], innerB[i], 0, true);
  }

  // Front mandibles with cargo gap.
  // The mandibles are two prongs sticking out at -z (forward).
  // Inner edges define the cargo bay slot.
  const MGapZ = -R - 0.55;       // far tip of mandibles
  const MRootZ = -R + 0.10;      // where mandibles meet saucer
  const MGapX = 0.18;            // half-width of cargo gap
  const MOuterX = 0.55;          // outer edge of mandible
  const MY0 = -0.04, MY1 = 0.04;
  // Left mandible (4 corners top, 4 corners bottom)
  const LM0 = P(-MOuterX, MY0, MRootZ);
  const LM1 = P(-MGapX,   MY0, MRootZ);
  const LM2 = P(-MGapX,   MY0, MGapZ);
  const LM3 = P(-MOuterX, MY0, MGapZ + 0.10);
  const LM4 = P(-MOuterX, MY1, MRootZ);
  const LM5 = P(-MGapX,   MY1, MRootZ);
  const LM6 = P(-MGapX,   MY1, MGapZ);
  const LM7 = P(-MOuterX, MY1, MGapZ + 0.10);
  // top
  quad(F, LM4, LM5, LM6, LM7, 7);
  // bottom
  quad(F, LM0, LM3, LM2, LM1, 1);
  // outer side
  quad(F, LM0, LM4, LM7, LM3, 0);
  // inner side (faces gap)
  quad(F, LM1, LM2, LM6, LM5, 1);
  // front cap
  quad(F, LM3, LM7, LM6, LM2, 0);
  // Right mandible (mirror)
  const RM0 = P( MOuterX, MY0, MRootZ);
  const RM1 = P( MGapX,   MY0, MRootZ);
  const RM2 = P( MGapX,   MY0, MGapZ);
  const RM3 = P( MOuterX, MY0, MGapZ + 0.10);
  const RM4 = P( MOuterX, MY1, MRootZ);
  const RM5 = P( MGapX,   MY1, MRootZ);
  const RM6 = P( MGapX,   MY1, MGapZ);
  const RM7 = P( MOuterX, MY1, MGapZ + 0.10);
  quad(F, RM7, RM6, RM5, RM4, 7);
  quad(F, RM1, RM2, RM3, RM0, 1);
  quad(F, RM3, RM7, RM4, RM0, 0);
  quad(F, RM5, RM6, RM2, RM1, 1);
  quad(F, RM2, RM6, RM7, RM3, 0);

  // Side cockpit (starboard, +x side): a tube with windows on the front.
  const ckX0 = R*0.55, ckX1 = R*0.95;
  const ckZ0 = -0.30, ckZ1 = 0.05;
  const ckY0 = H, ckY1 = H + 0.10;
  const K0 = P(ckX0, ckY0, ckZ0);
  const K1 = P(ckX1, ckY0, ckZ0);
  const K2 = P(ckX1, ckY0, ckZ1);
  const K3 = P(ckX0, ckY0, ckZ1);
  const K4 = P(ckX0+0.02, ckY1, ckZ0+0.02);
  const K5 = P(ckX1-0.02, ckY1, ckZ0+0.02);
  const K6 = P(ckX1-0.02, ckY1, ckZ1-0.02);
  const K7 = P(ckX0+0.02, ckY1, ckZ1-0.02);
  // front (with emissive viewport)
  quad(F, K0, K4, K5, K1, 2);
  // back
  quad(F, K2, K6, K7, K3, 0);
  // left (toward saucer)
  quad(F, K3, K7, K4, K0, 0);
  // right (outboard) — emissive side window
  quad(F, K1, K5, K6, K2, 2);
  // top
  quad(F, K4, K7, K6, K5, 0);

  // Top quad-laser turret (dorsal): cylindrical mount + crossed barrels.
  const TMX = 0.0, TMZ = 0.0, TMY = H + DH * 0.5;
  // Mount cylinder (8 sides)
  const turret = [];
  const turretTop = [];
  const tr = 0.10, th = 0.06;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    turret.push(P(TMX + Math.cos(a)*tr, TMY, TMZ + Math.sin(a)*tr));
    turretTop.push(P(TMX + Math.cos(a)*tr*0.9, TMY+th, TMZ + Math.sin(a)*tr*0.9));
  }
  for (let i = 0; i < 8; i++) {
    const j = (i+1) % 8;
    quad(F, turret[i], turret[j], turretTop[j], turretTop[i], 3, true);
  }
  // Turret cap
  const tcen = P(TMX, TMY+th, TMZ);
  for (let i = 0; i < 8; i++) {
    tri(F, tcen, turretTop[i], turretTop[(i+1)%8], 3, true);
  }
  // 4 gun barrels sticking out forward and slightly down
  function tbarrel(dx, dy) {
    const cr = 0.012;
    const z0 = TMZ - 0.05, z1 = TMZ - 0.30;
    const cx = TMX + dx, cy = TMY + th + dy;
    const a = P(cx + cr, cy, z0);
    const b = P(cx - cr, cy, z0);
    const c = P(cx - cr, cy, z1);
    const d = P(cx + cr, cy, z1);
    const e = P(cx, cy + cr, z0);
    const f = P(cx, cy - cr, z0);
    const g = P(cx, cy - cr, z1);
    const h = P(cx, cy + cr, z1);
    quad(F, a, e, h, d, 3);
    quad(F, e, b, c, h, 3);
    quad(F, b, f, g, c, 3);
    quad(F, f, a, d, g, 3);
  }
  tbarrel(-0.025,  0.020);
  tbarrel( 0.025,  0.020);
  tbarrel(-0.025, -0.020);
  tbarrel( 0.025, -0.020);

  // Bottom radar dish (ventral, off-center): white dish on a stalk.
  const dishX = -0.30, dishZ = 0.20, dishY = -H - DH * 0.4;
  // Stalk
  const stk0 = P(dishX-0.015, -H, dishZ-0.015);
  const stk1 = P(dishX+0.015, -H, dishZ-0.015);
  const stk2 = P(dishX+0.015, -H, dishZ+0.015);
  const stk3 = P(dishX-0.015, -H, dishZ+0.015);
  const stk4 = P(dishX-0.015, dishY+0.04, dishZ-0.015);
  const stk5 = P(dishX+0.015, dishY+0.04, dishZ-0.015);
  const stk6 = P(dishX+0.015, dishY+0.04, dishZ+0.015);
  const stk7 = P(dishX-0.015, dishY+0.04, dishZ+0.015);
  quad(F, stk0, stk1, stk5, stk4, 6);
  quad(F, stk1, stk2, stk6, stk5, 6);
  quad(F, stk2, stk3, stk7, stk6, 6);
  quad(F, stk3, stk0, stk4, stk7, 6);
  // Dish: low-poly inverted cone
  const dr = 0.13;
  const dishCen = P(dishX, dishY-0.02, dishZ);
  const dRing = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    dRing.push(P(dishX + Math.cos(a)*dr, dishY+0.04, dishZ + Math.sin(a)*dr));
  }
  for (let i = 0; i < 8; i++) {
    tri(F, dishCen, dRing[(i+1)%8], dRing[i], 4, true);
  }
  // Underside
  for (let i = 0; i < 8; i++) {
    tri(F, dishCen, dRing[i], dRing[(i+1)%8], 1, true);
  }

  // Rear engine glow strip: a thin emissive bar across the back of the saucer.
  // Located at z=+R, spanning x=[-R*0.5..+R*0.5], y near 0.
  const eg0 = P(-R*0.5, -0.02, R*0.92);
  const eg1 = P( R*0.5, -0.02, R*0.92);
  const eg2 = P( R*0.5,  0.02, R*0.92);
  const eg3 = P(-R*0.5,  0.02, R*0.92);
  quad(F, eg0, eg1, eg2, eg3, 5);

  return buildMesh({ verts: v, faces: F });
}

// ---------- Slave I ----------
// Boba Fett's ship: rounded teardrop with horizontal flight orientation
// (we'll rotate it -90deg X at draw time, body along Y axis at rest).
// Detailed: side wing fins, antenna array, weapon pods, cockpit window.
//   0 hull green-gray  1 hull dark  2 cockpit (emissive)
//   3 antenna          4 weapon     5 engine glow (emissive)
//   6 trim
function buildSlave1() {
  const v = [];
  const F = [];
  const P = (...xs) => { v.push(xs); return v.length - 1; };

  // Body cross-sections at three Y heights: nose (bottom y), waist (mid),
  // tail (top, widest). Each section is an ellipse-ish 8-vert ring.
  function ring(y, rx, rz, twist=0) {
    const arr = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + twist;
      arr.push(P(Math.cos(a)*rx, y, Math.sin(a)*rz));
    }
    return arr;
  }
  const nose  = ring(-0.65, 0.10, 0.07);   // very small nose
  const lower = ring(-0.30, 0.30, 0.20);
  const waist = ring( 0.05, 0.42, 0.28);
  const upper = ring( 0.40, 0.55, 0.32);
  const tail  = ring( 0.60, 0.55, 0.30);
  const N = 8;

  // Connect rings with smooth-shaded quads
  function connect(a, b, col) {
    for (let i = 0; i < N; i++) {
      const j = (i+1) % N;
      quad(F, a[i], a[j], b[j], b[i], col, true);
    }
  }
  connect(nose, lower, 0);
  connect(lower, waist, 0);
  connect(waist, upper, 0);
  connect(upper, tail, 1);

  // Nose cap (flat tip)
  const noseCen = P(0, -0.72, 0);
  for (let i = 0; i < N; i++) {
    tri(F, noseCen, nose[(i+1)%N], nose[i], 0, true);
  }
  // Tail cap
  const tailCen = P(0, 0.65, 0);
  for (let i = 0; i < N; i++) {
    tri(F, tailCen, tail[i], tail[(i+1)%N], 1, true);
  }

  // Cockpit: emissive viewport on the front (the "nose" side, which is
  // -z when oriented horizontally; here it's at -z since we'll rotate -90 X).
  // After -90 X rotation, the ship's "front" maps from -z (in build space)
  // to ... actually the rotation maps +y -> +z, -y -> -z, +z -> -y. So the
  // forward direction (after rotation) corresponds to -y in build space.
  // We want the cockpit on the FORWARD face = bottom in build space.
  // Place cockpit on lower ring, -z side (which becomes the "front" after rot).
  // Actually let's rethink: rx=-PI/2 around X means y_world = -z_build,
  // z_world = y_build. So for forward = -z_world, we want +y_build big-positive
  // viewing direction... no, forward is the direction the ship is pointing.
  // Slave I is fired bottom-first: nose is at -y (build), so forward in
  // world = -y_build mapped through Rx(-90). Rx(-90) sends (x,y,z)->(x,z,-y),
  // so -y_build -> +z_world. That means after rotation, "forward" is +z_world,
  // which is BEHIND the camera (we look at -z). So we'd actually want to
  // rotate +90 X, not -90, OR build the ship with nose at +y. Already noted
  // in shipPositions: rx = -PI/2. Let's just trust that and place the
  // cockpit window so it ends up on the right side after rotation.
  // After rx=-PI/2: build +y -> world +z; build -y -> world -z. So if our
  // build "tail" is at +y, after rotation it's at +z (=back), which is
  // correct for "fires nose first": nose at build -y -> world -z (forward).
  // Cockpit window then goes on the lower ring, at the -z (build) side
  // (which becomes -y world = down, but Slave I's cockpit faces forward so
  // any front-facing surface works). Actually the cockpit is on the forward
  // upper face. Put it on the lower ring at the -z build face -> after
  // rotation that's -y world (down) which is wrong.
  // Simplest fix: place cockpit window on +y side (build), which after
  // rotation becomes... wait. If forward (world -z) = build -y, then "up"
  // (world +y) maps to build... Rx(-90): world +y is the rotation of build
  // (x, ?, ?). Inverse: world (X,Y,Z) = (x_b, -z_b, y_b). So world +y = -z_b.
  // Cockpit "up and forward" in world = (-y_b small + -z_b large) in build.
  // Place cockpit on the build -z side of the upper-mid region.
  const cwy = 0.10;       // cockpit center y (build, near waist/upper)
  const cwz = -0.32;      // forward in build = -z; but that's "down" world.
  // Actually let's just put it on the build -y (nose) end, on the front face.
  // The nose ring is small; place a small emissive plate on the -y end at
  // the +z side... I'm overthinking this. Render it and adjust.
  // Place cockpit window as a small emissive panel on the upper-front quadrant.
  const cw0 = P(-0.20, 0.20, -0.30);
  const cw1 = P( 0.20, 0.20, -0.30);
  const cw2 = P( 0.20, 0.40, -0.28);
  const cw3 = P(-0.20, 0.40, -0.28);
  quad(F, cw0, cw1, cw2, cw3, 2);

  // Side wing fins: two flat triangular fins on left/right flanks.
  function fin(side) {
    // Mounted near upper ring on build x=+/-, sweeping down-out.
    const root0 = P(side * 0.42, 0.30, -0.20);
    const root1 = P(side * 0.42, 0.50,  0.15);
    const tip   = P(side * 0.95, -0.15, -0.05);
    tri(F, root0, root1, tip, 6);
    tri(F, root0, tip, root1, 6); // back face (double-sided fin)
    // Add a thicker rim (small extruded outline)
    const back0 = P(side * 0.40, 0.30, -0.20);
    const back1 = P(side * 0.40, 0.50,  0.15);
    const backT = P(side * 0.93, -0.15, -0.05);
    tri(F, back0, backT, back1, 1);
  }
  fin( 1);
  fin(-1);

  // Antenna array on top (build +y is "back" of ship after rotation, so
  // these antennas trail behind in flight - which matches Slave I).
  function antenna(ax, ay, az, len) {
    const r = 0.012;
    const a = P(ax-r, ay,    az-r);
    const b = P(ax+r, ay,    az-r);
    const cc= P(ax+r, ay,    az+r);
    const d = P(ax-r, ay,    az+r);
    const e = P(ax-r, ay+len,az-r);
    const f = P(ax+r, ay+len,az-r);
    const g = P(ax+r, ay+len,az+r);
    const h = P(ax-r, ay+len,az+r);
    quad(F, a, b, f, e, 3);
    quad(F, b, cc, g, f, 3);
    quad(F, cc, d, h, g, 3);
    quad(F, d, a, e, h, 3);
  }
  antenna(-0.10, 0.62, -0.10, 0.30);
  antenna( 0.10, 0.62, -0.10, 0.35);
  antenna( 0.00, 0.62,  0.05, 0.40);

  // Weapon pods: two boxes on the lower flanks
  function pod(side) {
    const px = side * 0.32, py = -0.20, pz = 0.0;
    const sx = 0.08, sy = 0.15, sz = 0.18;
    const a = P(px-sx, py-sy, pz-sz);
    const b = P(px+sx, py-sy, pz-sz);
    const cc= P(px+sx, py-sy, pz+sz);
    const d = P(px-sx, py-sy, pz+sz);
    const e = P(px-sx, py+sy, pz-sz);
    const f = P(px+sx, py+sy, pz-sz);
    const g = P(px+sx, py+sy, pz+sz);
    const h = P(px-sx, py+sy, pz+sz);
    quad(F, a, b, f, e, 4);
    quad(F, b, cc, g, f, 4);
    quad(F, cc, d, h, g, 4);
    quad(F, d, a, e, h, 4);
    quad(F, a, d, cc, b, 4);
    quad(F, e, f, g, h, 4);
  }
  pod( 1);
  pod(-1);

  // Engine glow strip on the tail (build +y end)
  const eg0 = P(-0.30, 0.61, -0.18);
  const eg1 = P( 0.30, 0.61, -0.18);
  const eg2 = P( 0.30, 0.61,  0.18);
  const eg3 = P(-0.30, 0.61,  0.18);
  quad(F, eg0, eg1, eg2, eg3, 5);

  return buildMesh({ verts: v, faces: F });
}

export function battle(gl) {
  const skyProg  = compile(gl, SKY_VS,  SKY_FS,  ['a_pos']);
  const uTimeSky = gl.getUniformLocation(skyProg, 'u_time');
  const duneProg = compile(gl, DUNE_VS, DUNE_FS, ['a_pos','a_shade']);
  const uMvpDune     = gl.getUniformLocation(duneProg, 'u_mvp');
  const treeProg = compile(gl, TREE_VS, TREE_FS, ['a_pos','a_shade']);
  const uMvpTree = gl.getUniformLocation(treeProg, 'u_mvp');
  const santaProg = compile(gl, SANTA_VS, SANTA_FS, ['a_pos','a_color']);
  const uOffsetSanta = gl.getUniformLocation(santaProg, 'u_offset');
  const uScreenSanta = gl.getUniformLocation(santaProg, 'u_screen');
  const obj2Prog = compile(gl, OBJ2_VS, OBJ2_FS, ['a_pos','a_normal','a_colorIdx']);
  const uMvpObj2     = gl.getUniformLocation(obj2Prog, 'u_mvp');
  const uModelObj2   = gl.getUniformLocation(obj2Prog, 'u_model');
  const uPaletteObj2 = gl.getUniformLocation(obj2Prog, 'u_palette');
  const lineProg = compile(gl, LINE_VS, LINE_FS, ['a_pos']);
  const uMvpLine = gl.getUniformLocation(lineProg, 'u_mvp');
  const uColLine = gl.getUniformLocation(lineProg, 'u_color');

  // Particle program for explosions and smoke trails.
  const partProg = compile(gl, PART_VS, PART_FS, ['a_pos', 'a_size', 'a_color']);
  const uMvpPart  = gl.getUniformLocation(partProg, 'u_mvp');
  const uModePart = gl.getUniformLocation(partProg, 'u_mode');

  // OBJ2 vertex stride: 7 floats (pos.xyz, normal.xyz, colorIdx) * 4 bytes
  const obj2Stride = 7 * 4;

  // Helper: build a VAO for an OBJ2 multi-material mesh.
  function makeMeshVao(data) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, obj2Stride, 0);   // pos
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, obj2Stride, 12);  // normal
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, obj2Stride, 24);  // colorIdx
    gl.bindVertexArray(null);
    return { vao, vbo, count: data.length / 7 };
  }

  // Dunes still use the simple shader (their format is unchanged).
  const duneStride = 4 * 4;
  function makeDuneVao(data) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, duneStride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, duneStride, 12);
    gl.bindVertexArray(null);
    return { vao, vbo, count: data.length / 4 };
  }
  const duneMesh = makeDuneVao(buildDunes());
  const treeMesh = makeDuneVao(buildTrees());

  // Santa VAO (2D pixel-coord mesh: pos.xy + color.rgb = 5 floats / 20 bytes per vertex).
  const santaData = buildSanta();
  const santaVao = gl.createVertexArray();
  const santaVbo = gl.createBuffer();
  gl.bindVertexArray(santaVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, santaVbo);
  gl.bufferData(gl.ARRAY_BUFFER, santaData, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 5 * 4, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 5 * 4, 2 * 4);
  gl.bindVertexArray(null);
  const santaCount = santaData.length / 5;

  // Ships
  const ships = {
    falcon:       makeMeshVao(buildFalcon()),
    xwing:        makeMeshVao(buildXWing()),
    tie:          makeMeshVao(buildTie()),
    star:         makeMeshVao(buildStarDestroyer()),
    slave1:       makeMeshVao(buildSlave1()),
    octahedron:   makeMeshVao(buildObject()),
  };

  // 8-entry RGBA palettes per ship (alpha: 1.0=lit, 0.0=emissive).
  // Each entry is 4 floats in a 32-float Float32Array, packed for the
  // u_palette[8] uniform array in OBJ2_VS.
  function packPalette(entries) {
    const out = new Float32Array(8 * 4);
    for (let i = 0; i < 8; i++) {
      const e = entries[i] || [0,0,0,1];
      out[i*4+0] = e[0];
      out[i*4+1] = e[1];
      out[i*4+2] = e[2];
      out[i*4+3] = (e.length >= 4) ? e[3] : 1.0;
    }
    return out;
  }
  const PALETTES = {
    star: packPalette([
      [0.55, 0.58, 0.62, 1.0],   // 0 hull mid
      [0.32, 0.34, 0.40, 1.0],   // 1 hull dark
      [0.78, 0.82, 0.88, 1.0],   // 2 hull light
      [1.00, 0.85, 0.40, 0.0],   // 3 windows (emissive amber)
      [0.30, 0.33, 0.38, 1.0],   // 4 engine ring (gunmetal)
      [0.60, 0.85, 1.00, 0.0],   // 5 engine glow (emissive cyan-blue)
      [0.45, 0.50, 0.58, 1.0],   // 6 ridge accent
      [0.55, 0.58, 0.62, 1.0],
    ]),
    xwing: packPalette([
      [0.92, 0.90, 0.85, 1.0],   // 0 hull white
      [0.55, 0.55, 0.55, 1.0],   // 1 hull gray
      [0.85, 0.18, 0.15, 1.0],   // 2 red trim
      [0.40, 0.70, 0.95, 0.0],   // 3 canopy (emissive)
      [0.85, 0.85, 0.92, 1.0],   // 4 R2 white-blue
      [0.20, 0.20, 0.22, 1.0],   // 5 cannon dark
      [1.00, 0.55, 0.20, 0.0],   // 6 engine glow (emissive orange)
      [0.40, 0.42, 0.45, 1.0],   // 7 engine ring
    ]),
    tie: packPalette([
      [0.10, 0.10, 0.13, 1.0],   // 0 panel black
      [0.60, 0.62, 0.66, 1.0],   // 1 pod gray
      [0.30, 0.32, 0.36, 1.0],   // 2 pod dark
      [1.00, 0.30, 0.20, 0.0],   // 3 viewport (emissive red)
      [0.45, 0.45, 0.50, 1.0],   // 4 strut
      [0.20, 0.22, 0.26, 1.0],   // 5 panel rib
      [0.30, 0.30, 0.32, 1.0],   // 6 gun barrel
      [0.40, 0.42, 0.45, 1.0],
    ]),
    falcon: packPalette([
      [0.82, 0.78, 0.68, 1.0],   // 0 hull cream
      [0.42, 0.38, 0.32, 1.0],   // 1 hull dark (panel lines)
      [0.60, 0.85, 1.00, 0.0],   // 2 cockpit (emissive blue)
      [0.50, 0.50, 0.52, 1.0],   // 3 turret gray
      [0.85, 0.85, 0.85, 1.0],   // 4 dish white
      [1.00, 0.75, 0.30, 0.0],   // 5 engine glow (emissive yellow-orange)
      [0.55, 0.50, 0.45, 1.0],   // 6 antenna
      [0.70, 0.65, 0.55, 1.0],   // 7 panel mid (warm beige)
    ]),
    slave1: packPalette([
      [0.42, 0.50, 0.45, 1.0],   // 0 hull green-gray
      [0.22, 0.28, 0.24, 1.0],   // 1 hull dark
      [0.80, 0.50, 0.20, 0.0],   // 2 cockpit (emissive amber)
      [0.30, 0.32, 0.35, 1.0],   // 3 antenna
      [0.18, 0.20, 0.22, 1.0],   // 4 weapon
      [0.95, 0.60, 0.25, 0.0],   // 5 engine glow
      [0.60, 0.65, 0.55, 1.0],   // 6 trim
      [0.42, 0.50, 0.45, 1.0],
    ]),
    octahedron: packPalette([
      [1.00, 0.85, 0.40, 1.0],   // 0 gold light
      [0.85, 0.55, 0.20, 1.0],   // 1 gold dark
      [1.00, 0.85, 0.40, 1.0],
      [1.00, 0.85, 0.40, 1.0],
      [1.00, 0.85, 0.40, 1.0],
      [1.00, 0.85, 0.40, 1.0],
      [1.00, 0.85, 0.40, 1.0],
      [1.00, 0.85, 0.40, 1.0],
    ]),
  };

  // Laser-bolt VBO: dynamic line segments.
  const MAX_BOLTS = 64;
  const boltVao = gl.createVertexArray();
  gl.bindVertexArray(boltVao);
  const boltVbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, boltVbo);
  gl.bufferData(gl.ARRAY_BUFFER, MAX_BOLTS * 2 * 3 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
  gl.bindVertexArray(null);

  const bolts = [];

  // ---- Particle system (explosions + smoke) ----
  // Each particle: { pos[3], vel[3], size, color[4], life, age, mode }
  // mode: 0 = additive fireball, 1 = alpha smoke
  const MAX_PARTICLES = 512;
  const partVao = gl.createVertexArray();
  gl.bindVertexArray(partVao);
  const partVbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, partVbo);
  // Stride: pos(3) + size(1) + color(4) = 8 floats = 32 bytes.
  gl.bufferData(gl.ARRAY_BUFFER, MAX_PARTICLES * 32, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 32, 12);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16);
  gl.bindVertexArray(null);

  const particles = [];

  function spawnParticle(p) {
    if (particles.length >= MAX_PARTICLES) particles.shift();
    particles.push(p);
  }

  // Burst of fireball + sparks at world-space point.
  function spawnExplosion(pos, scale = 1.0) {
    // Hot core fireball - a few large soft puffs that fade yellow→orange→red.
    const core = 6;
    for (let i = 0; i < core; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = (0.5 + Math.random() * 1.5) * scale;
      spawnParticle({
        pos: [pos[0], pos[1], pos[2]],
        vel: [Math.cos(ang) * sp, (Math.random() - 0.3) * sp, Math.sin(ang) * sp],
        size: (28 + Math.random() * 18) * scale,
        color: [1.0, 0.95, 0.55, 1.0],
        life: 0.55 + Math.random() * 0.25,
        age: 0,
        mode: 0,
        kind: 'fire',
      });
    }
    // Sparks - small fast bright dots.
    const sparks = 14;
    for (let i = 0; i < sparks; i++) {
      const ang = Math.random() * Math.PI * 2;
      const tilt = (Math.random() - 0.5) * 0.8;
      const sp = (3 + Math.random() * 4) * scale;
      spawnParticle({
        pos: [pos[0], pos[1], pos[2]],
        vel: [Math.cos(ang) * sp, tilt * sp + 0.5, Math.sin(ang) * sp],
        size: (4 + Math.random() * 4) * scale,
        color: [1.0, 0.85, 0.35, 1.0],
        life: 0.35 + Math.random() * 0.4,
        age: 0,
        mode: 0,
        kind: 'spark',
      });
    }
    // Smoke that lingers after the flash.
    const smoke = 5;
    for (let i = 0; i < smoke; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = (0.3 + Math.random() * 0.6) * scale;
      spawnParticle({
        pos: [pos[0], pos[1], pos[2]],
        vel: [Math.cos(ang) * sp, 0.6 + Math.random() * 0.4, Math.sin(ang) * sp],
        size: (40 + Math.random() * 20) * scale,
        color: [0.35, 0.30, 0.28, 0.55],
        life: 1.6 + Math.random() * 0.8,
        age: -0.15, // small delay before smoke appears
        mode: 1,
        kind: 'smoke',
      });
    }
  }

  // Engine smoke / exhaust trail puff at world-space point.
  function spawnTrail(pos, color) {
    spawnParticle({
      pos: [pos[0], pos[1], pos[2]],
      vel: [(Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.2, 0.6 + Math.random() * 0.4],
      size: 10 + Math.random() * 6,
      color: color,
      life: 0.7 + Math.random() * 0.4,
      age: 0,
      mode: 1,
      kind: 'trail',
    });
  }

  // ---- Hero-pass choreography ----
  // The desert part runs ~18s. We carve it into hero windows where each
  // ship gets a close pass for the camera. During its hero window, a ship
  // overrides its baseline trajectory with a scripted close flyby.
  // Windows (in seconds since the part started):
  //   0.0 -  3.0 : Star Destroyer slow ominous loom (top-left)
  //   3.0 -  6.0 : Three TIE Fighters dive across center
  //   6.0 -  9.5 : Falcon banking flyby right-to-left
  //   9.5 - 13.0 : X-wing pair attack run
  //  13.0 - 16.0 : Slave I horizontal stalk pass
  //  16.0 - 18.0 : All ships fly together (climax)
  function heroOverride(kind, tt, partTime, base) {
    // partTime is seconds since the part started, in [0..18].
    // Smooth fade-in/out for hero so transitions don't pop.
    function inWin(start, end) {
      if (partTime < start || partTime > end) return 0;
      const fadeIn = 0.6, fadeOut = 0.6;
      const tIn = Math.min(1, (partTime - start) / fadeIn);
      const tOut = Math.min(1, (end - partTime) / fadeOut);
      return Math.min(tIn, tOut);
    }
    function lerpShip(target, w) {
      // Blend each numeric field of `target` with the base by weight w.
      const out = {...base};
      for (const k of ['x','y','z','rx','ry','rz','scale']) {
        if (k in target) out[k] = base[k] * (1-w) + target[k] * w;
      }
      return out;
    }

    if (kind === 'star') {
      const w = inWin(0.0, 3.5);
      if (w > 0) {
        // Slow loom from upper-left, large on screen.
        const k = (partTime - 0.0) / 3.5; // 0..1
        return lerpShip({
          x: -6 + k * 6,
          y:  4.2,
          z: base.z + 8,    // closer
          ry: -0.15,
          rx: 0.08,
          scale: 5.5,
        }, w);
      }
    } else if (kind === 'tie') {
      const w = inWin(3.0, 6.5);
      if (w > 0) {
        const k = (partTime - 3.0) / 3.5;
        const i = base._tieIndex || 0;
        return lerpShip({
          x: -4 + k * 8 + i * 0.8,
          y:  2.8 + Math.sin(k * Math.PI * 2 + i) * 0.4,
          z: base.z + 6 - i * 0.5, // very close
          ry: 0.15 + i * 0.05,
          rx: 0.0,
          scale: 1.2,
        }, w);
      }
    } else if (kind === 'falcon') {
      const w = inWin(6.0, 9.8);
      if (w > 0) {
        const k = (partTime - 6.0) / 3.8;
        return lerpShip({
          // Banks right-to-left across screen, close to camera.
          x:  6 - k * 12,
          y:  2.6 + Math.sin(k * Math.PI) * 0.5,
          z: base.z + 4,
          ry: Math.PI * 0.5 + Math.sin(k * Math.PI) * 0.3,
          rz: -0.45 * Math.sin(k * Math.PI),
          rx: 0.05,
          scale: 1.3,
        }, w);
      }
    } else if (kind === 'xwing') {
      const w = inWin(9.5, 13.2);
      if (w > 0) {
        const k = (partTime - 9.5) / 3.7;
        const i = base._xwingIndex || 0;   // 0 = leader, 1 = wingman
        return lerpShip({
          x:  -4 + k * 8 + i * 1.2,
          y:   2.4 + Math.sin(k * Math.PI * 1.5 + i) * 0.6,
          z:   base.z + 5 - i * 0.6,
          ry:  0.4 + Math.sin(k * 4 + i) * 0.4,
          rz:  Math.sin(k * 5 + i) * 0.5,
          rx:  0.05,
          scale: 0.85,
        }, w);
      }
    } else if (kind === 'slave1') {
      const w = inWin(13.0, 16.2);
      if (w > 0) {
        const k = (partTime - 13.0) / 3.2;
        return lerpShip({
          x:  5 - k * 10,
          y:  3.0 + Math.sin(k * Math.PI) * 0.4,
          z: base.z + 5,
          rx: -Math.PI / 2,
          ry: 0.2 + Math.sin(k * 3) * 0.15,
          rz: 0.0,
          scale: 0.95,
        }, w);
      }
    }
    return base;
  }

  function shipPositions(tt, partTime) {
    const bob = (a, hz, ph) => Math.sin(tt * hz + ph) * a;
    const cz = -((tt * 4.0) % 30.0);

    const baseFleet = [
      {
        kind: 'star',
        scale: 4.0,
        x: -8 + (tt * 0.8) % 22,
        y:  4.5 + bob(0.2, 0.3, 0),
        z: cz - 38,
        rx: 0.05, ry: 0.0, rz: 0.0,
        faction: 'imp',
      },
      ...[0,1,2].map(i => ({
        kind: 'tie',
        _tieIndex: i,
        scale: 0.7,
        x: -3 + i*1.4 + bob(2.5, 0.9, i * 1.7),
        y:  2.8 + bob(0.9, 1.2, i * 0.8),
        z: cz - 10 - i*0.4 + bob(1.5, 0.7, i),
        rx: 0.05, ry: 0.15 * Math.sin(tt * 0.8 + i), rz: 0.0,
        faction: 'imp',
      })),
      {
        kind: 'xwing',
        _xwingIndex: 0,
        scale: 0.55,
        x:  3.5 + Math.sin(tt * 0.6) * 2.5,
        y:  2.6 + Math.cos(tt * 0.9) * 0.6,
        z: cz - 7.5 + Math.cos(tt * 0.5) * 1.2,
        rx: 0.0, ry: 0.6 + Math.sin(tt * 0.6) * 0.3, rz: Math.sin(tt * 1.1) * 0.4,
        faction: 'reb',
      },
      {
        kind: 'xwing',
        _xwingIndex: 1,
        scale: 0.55,
        x: -2.0 + Math.cos(tt * 0.7 + 1.0) * 2.0,
        y:  3.4 + Math.sin(tt * 1.1 + 0.5) * 0.5,
        z: cz - 8.5 + Math.sin(tt * 0.6) * 1.0,
        rx: 0.0, ry: -0.4 + Math.cos(tt * 0.7) * 0.3, rz: Math.sin(tt * 1.3 + 1) * 0.3,
        faction: 'reb',
      },
      {
        kind: 'falcon',
        scale: 0.8,
        x:  Math.sin(tt * 0.35) * 4.5,
        y:  1.9 + Math.sin(tt * 0.5) * 0.4,
        z: cz - 5.5 + Math.cos(tt * 0.35) * 1.5,
        rx: 0.05, ry: tt * 0.35 + Math.PI * 0.5, rz: Math.sin(tt * 0.35) * 0.35,
        faction: 'reb',
      },
      {
        kind: 'slave1',
        scale: 0.55,
        x:  4.5 - (tt * 0.5) % 9,
        y:  3.6 + Math.sin(tt * 0.4) * 0.3,
        z: cz - 11 + Math.sin(tt * 0.6) * 0.8,
        rx: -Math.PI / 2, ry: Math.sin(tt * 0.4) * 0.2, rz: 0.0,
        faction: 'neutral',
      },
      {
        kind: 'octahedron',
        scale: 0.6,
        x: 0.0,
        y: 5.5 + Math.sin(tt * 0.6) * 0.4,
        z: cz - 25.0,
        rx: tt * 0.5, ry: tt * 0.9, rz: 0.0,
        faction: 'beacon',
      },
    ];
    // Apply hero overrides where applicable.
    return baseFleet.map(s => heroOverride(s.kind, tt, partTime, s));
  }

  // Track when the part started (for hero choreography).
  let partStartT = -1;
  let lastFrameT = -1;
  let lastTrailT = 0;

  // ---- Snowfall ----
  // World-space snowflakes drifting down through the camera volume. They
  // share the PART_VS/PART_FS shader (mode = 1, soft alpha puff) so we just
  // need a parallel VAO/VBO with the same vertex layout (pos.xyz + size +
  // color.rgba = 8 floats per vertex).
  const SNOW_COUNT = 320;
  const SNOW_STRIDE_BYTES = 32;          // 8 floats x 4 bytes
  const snowVao = gl.createVertexArray();
  gl.bindVertexArray(snowVao);
  const snowVbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, snowVbo);
  gl.bufferData(gl.ARRAY_BUFFER, SNOW_COUNT * SNOW_STRIDE_BYTES, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, SNOW_STRIDE_BYTES, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 1, gl.FLOAT, false, SNOW_STRIDE_BYTES, 12);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 4, gl.FLOAT, false, SNOW_STRIDE_BYTES, 16);
  gl.bindVertexArray(null);

  // Snow simulation volume (camera-relative). Camera sits at world y=camY,
  // looks toward -z, and translates +z over time (camForward). We keep
  // flakes in a fixed-size box that follows the camera so they're always
  // visible without unbounded memory growth.
  const SNOW_BOX = { xRad: 28.0, yMin: -1.5, yMax: 9.0, zNear: 5.0, zFar: -75.0 };
  // Each flake: { x, y, z, fallSpeed (units/sec), sway (rad/sec), swayPhase, size, bright }
  const snow = new Array(SNOW_COUNT);
  for (let i = 0; i < SNOW_COUNT; i++) {
    snow[i] = {
      x: (Math.random() * 2 - 1) * SNOW_BOX.xRad,
      y: SNOW_BOX.yMin + Math.random() * (SNOW_BOX.yMax - SNOW_BOX.yMin),
      // Start z in the visible band ahead of the camera (the camera origin
      // gets translated +z as time passes; the dunes themselves were built
      // with z in [-90..-1], i.e. in front of the world origin. After the
      // camera's translate(0,-camY,camForward), the camera sits effectively
      // at world z = -camForward, and looks toward the dunes ahead at more
      // negative z. So flakes living in zNear..zFar (5..-75) wrap around
      // the camera nicely.
      z: SNOW_BOX.zFar + Math.random() * (SNOW_BOX.zNear - SNOW_BOX.zFar),
      fallSpeed: 0.6 + Math.random() * 0.9,
      sway: 0.4 + Math.random() * 0.6,
      swayPhase: Math.random() * Math.PI * 2,
      size: 8.0 + Math.random() * 14.0,    // pixel size at perspective w=1
      bright: 0.75 + Math.random() * 0.25,
    };
  }
  // Scratch buffer reused every frame to avoid allocating during render.
  const snowScratch = new Float32Array(SNOW_COUNT * 8);

  // Periodically spawn laser bolts.
  let lastFireT = 0;
  function maybeFire(tt, fleet) {
    // Faster fire cadence + occasional bursts of 2-3 bolts.
    if (tt - lastFireT < 0.10) return;
    lastFireT = tt;
    const burstCount = Math.random() < 0.35 ? (2 + ((Math.random() * 2) | 0)) : 1;
    const shooters = fleet.filter(s => s.faction === 'imp' || s.faction === 'reb' || s.faction === 'neutral');
    if (shooters.length < 2) return;

    for (let burst = 0; burst < burstCount; burst++) {
      const shooter = shooters[(Math.random() * shooters.length) | 0];
      const candidates = fleet.filter(s => {
        if (s === shooter) return false;
        if (shooter.faction === 'imp')     return s.faction === 'reb';
        if (shooter.faction === 'reb')     return s.faction === 'imp';
        if (shooter.faction === 'neutral') return s.faction === 'reb' || s.faction === 'imp';
        return false;
      });
      if (!candidates.length) continue;
      const target = candidates[(Math.random() * candidates.length) | 0];
      const a = [shooter.x + (Math.random()-0.5)*0.3, shooter.y + (Math.random()-0.5)*0.2, shooter.z];
      // Slight aim error so not every bolt is a perfect hit.
      const miss = Math.random() < 0.55;
      const jitter = miss ? 1.4 : 0.25;
      const b = [
        target.x + (Math.random()-0.5) * jitter,
        target.y + (Math.random()-0.5) * jitter * 0.7,
        target.z + (Math.random()-0.5) * jitter * 0.5,
      ];
      let col;
      if (shooter.faction === 'imp')      col = [1.0, 0.25, 0.20];
      else if (shooter.faction === 'reb') col = [0.30, 1.0, 0.30];
      else                                col = [1.0, 0.7, 0.20];
      if (bolts.length >= MAX_BOLTS) bolts.shift();
      bolts.push({
        a, b, col,
        t0: tt,
        life: 0.40 + Math.random() * 0.12,
        hit: !miss,
        exploded: false,
      });
    }
  }

  function shipModel(s) {
    let m = mat4Translate(s.x, s.y, s.z);
    if (s.ry) m = mat4Mul(m, mat4RotateY(s.ry));
    if (s.rx) m = mat4Mul(m, mat4RotateX(s.rx));
    if (s.rz) m = mat4Mul(m, mat4RotateZ(s.rz));
    if (s.scale && s.scale !== 1.0) {
      const k = s.scale;
      const sm = new Float32Array([k,0,0,0, 0,k,0,0, 0,0,k,0, 0,0,0,1]);
      m = mat4Mul(m, sm);
    }
    return m;
  }

  return {
    render(gl, t, fbo) {
      bindFBO(gl, fbo);
      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);

      gl.clearColor(0,0,0,1);
      gl.clear(gl.COLOR_BUFFER_BIT);

      const tt = t / 1000;
      if (partStartT < 0) partStartT = tt;
      if (lastFrameT < 0) lastFrameT = tt;
      const dt = Math.min(0.066, Math.max(0, tt - lastFrameT));
      lastFrameT = tt;
      const partTime = tt - partStartT;

      // Sky / sun pass
      gl.useProgram(skyProg);
      gl.uniform1f(uTimeSky, tt);
      drawQuad(gl);

      // Camera matrix
      const proj = mat4Mul(mat4FlipY(), mat4Perspective(1.05, VW / VH, 0.1, 200.0));
      const camY = 1.05 + Math.sin(tt * 0.3) * 0.10;
      const camForward = (tt * 4.0) % 30.0;
      const view = mat4Mul(
        mat4RotateX(-0.08),
        mat4Translate(0, -camY, camForward)
      );
      const vp = mat4Mul(proj, view);

      // Dunes (now snow-capped pine forest; the dune FS bakes its own
      // 5-stop ramp so u_colorLo/u_colorHi are no longer needed).
      gl.useProgram(duneProg);
      gl.uniformMatrix4fv(uMvpDune, false, vp);
      gl.bindVertexArray(duneMesh.vao);
      gl.drawArrays(gl.TRIANGLES, 0, duneMesh.count);
      gl.bindVertexArray(null);

      // Pine tree silhouettes scattered across the terrain. Drawn after the
      // dunes (depth-tested against them) so trees in valleys are correctly
      // occluded by ridges in front of them.
      gl.useProgram(treeProg);
      gl.uniformMatrix4fv(uMvpTree, false, vp);
      gl.bindVertexArray(treeMesh.vao);
      gl.drawArrays(gl.TRIANGLES, 0, treeMesh.count);
      gl.bindVertexArray(null);

      // Santa + reindeer flying across the sky above the moon. Pure 2D
      // overlay in pixel coords - depth-test still active but the SANTA_VS
      // emits gl_Position.z=0 so it sits in front of the sky/dunes/trees
      // (which all draw with proper depth) since they're behind. We disable
      // depth-test for this pass so it always draws on top of the sky.
      // Disabling depth also avoids interfering with subsequent ship draws.
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(santaProg);
      gl.uniform2f(uScreenSanta, VW, VH);
      // Animate horizontal position: enter from left -8 px and exit at the
      // right (VW + 80). Loop slowly so it feels like a leisurely fly-by.
      // Santa local bbox spans roughly x=-16 .. x=60, so the offset is the
      // x of the LEFT-MOST pixel of the team.
      const SANTA_PERIOD = 14.0;          // seconds for a full crossing
      const SANTA_Y      = 28.0;          // pixel y from top of FB
      const cycle = (partTime % SANTA_PERIOD) / SANTA_PERIOD;
      const santaX = -20 + cycle * (VW + 100);
      // Tiny sinusoidal bob so the sleigh feels alive.
      const santaY = SANTA_Y + Math.sin(partTime * 2.5) * 1.0;
      gl.uniform2f(uOffsetSanta, santaX, santaY);
      gl.bindVertexArray(santaVao);
      gl.drawArrays(gl.TRIANGLES, 0, santaCount);
      gl.bindVertexArray(null);
      gl.enable(gl.DEPTH_TEST);

      // Fleet
      const fleet = shipPositions(tt, partTime);
      fleet.sort((a, b) => a.z - b.z);

      // Render ships using OBJ2 shader
      gl.useProgram(obj2Prog);
      for (const s of fleet) {
        const mesh = ships[s.kind];
        const palette = PALETTES[s.kind];
        const model = shipModel(s);
        const mvp = mat4Mul(vp, model);
        gl.uniformMatrix4fv(uMvpObj2, false, mvp);
        gl.uniformMatrix4fv(uModelObj2, false, model);
        gl.uniform4fv(uPaletteObj2, palette);
        gl.bindVertexArray(mesh.vao);
        gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
      }
      gl.bindVertexArray(null);

      // Lasers
      maybeFire(tt, fleet);
      // Step bolts and trigger impacts (explosion when head reaches target).
      for (let i = bolts.length - 1; i >= 0; i--) {
        const b = bolts[i];
        const k = (tt - b.t0) / b.life;
        // Bolt head reaches target around k * 1.6 >= 1 (~ life * 0.625).
        if (!b.exploded && b.hit && k * 1.6 >= 1.0) {
          b.exploded = true;
          // Slight bias toward camera for visibility of fireball.
          spawnExplosion([b.b[0], b.b[1], b.b[2] + 0.2], 1.0);
        }
        if (tt - b.t0 > b.life) bolts.splice(i, 1);
      }

      // Engine smoke trails. Emit a puff for each ship every ~50ms.
      if (tt - lastTrailT > 0.05) {
        lastTrailT = tt;
        for (const s of fleet) {
          if (s.faction === 'beacon') continue;
          // Engine offset depends on ship kind and orientation.
          let ex = s.x, ey = s.y, ez = s.z;
          let scale = 1.0;
          let color = [0.55, 0.55, 0.60, 0.55];
          if (s.kind === 'starDestroyer') { ez += 4.0 * (s.scale || 1); scale = 1.6; color = [0.45, 0.55, 0.70, 0.55]; }
          else if (s.kind === 'falcon')   { ez += 1.2 * (s.scale || 1); scale = 1.0; color = [0.85, 0.55, 0.30, 0.50]; }
          else if (s.kind === 'xwing')    { ez += 1.0 * (s.scale || 1); scale = 0.7; color = [0.85, 0.55, 0.40, 0.45]; }
          else if (s.kind === 'tie')      { continue; } // TIEs have ion drives - skip trails
          else if (s.kind === 'slave1')   { ez += 1.0 * (s.scale || 1); scale = 0.9; color = [0.55, 0.55, 0.55, 0.55]; }
          else continue;
          spawnTrail([ex + (Math.random()-0.5)*0.3, ey + (Math.random()-0.5)*0.3, ez], color);
          // Falcon and Star Destroyer get extra puffs for fatter wakes.
          if (s.kind === 'starDestroyer') {
            spawnTrail([ex + (Math.random()-0.5)*0.8, ey + (Math.random()-0.5)*0.4, ez], color);
            spawnTrail([ex + (Math.random()-0.5)*0.8, ey + (Math.random()-0.5)*0.4, ez], color);
          }
        }
      }

      // Step particles.
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.age += dt;
        if (p.age >= p.life) { particles.splice(i, 1); continue; }
        // Negative age = pre-spawn delay; don't move yet.
        if (p.age < 0) continue;
        p.pos[0] += p.vel[0] * dt;
        p.pos[1] += p.vel[1] * dt;
        p.pos[2] += p.vel[2] * dt;
        // Drag and gravity differ by kind.
        const drag = (p.kind === 'spark') ? 1.5 : 0.9;
        p.vel[0] *= 1 - drag * dt;
        p.vel[1] *= 1 - drag * dt;
        p.vel[2] *= 1 - drag * dt;
        if (p.kind === 'spark') p.vel[1] -= 4.0 * dt;
        if (p.kind === 'smoke') { p.vel[1] += 0.4 * dt; }
        if (p.kind === 'trail') { p.size += 18 * dt; } // smoke expands
      }

      // Render particles.
      // Collect into two buckets: additive (fireballs/sparks) and alpha (smoke/trails).
      if (particles.length > 0) {
        const add = [];
        const alpha = [];
        for (const p of particles) {
          if (p.age < 0) continue;
          (p.mode === 0 ? add : alpha).push(p);
        }

        function uploadAndDraw(list, mode) {
          if (!list.length) return;
          const data = new Float32Array(list.length * 8);
          for (let i = 0; i < list.length; i++) {
            const p = list[i];
            const k = p.age / p.life;
            // Color fade: fireball goes yellow→orange→red, alpha drops; smoke stays gray, alpha drops.
            let r = p.color[0], g = p.color[1], bb = p.color[2], a = p.color[3];
            if (p.kind === 'fire') {
              // yellow(1,.95,.55) -> orange(1,.5,.15) -> red(.6,.1,.05)
              if (k < 0.5) {
                const u = k / 0.5;
                r = 1.0;       g = 0.95 - 0.45 * u; bb = 0.55 - 0.40 * u;
              } else {
                const u = (k - 0.5) / 0.5;
                r = 1.0 - 0.4 * u; g = 0.50 - 0.40 * u; bb = 0.15 - 0.10 * u;
              }
              a = (1.0 - k) * 1.0;
            } else if (p.kind === 'spark') {
              a = (1.0 - k) * 1.0;
            } else if (p.kind === 'smoke' || p.kind === 'trail') {
              a = p.color[3] * (1.0 - k);
            }
            data[i*8+0] = p.pos[0];
            data[i*8+1] = p.pos[1];
            data[i*8+2] = p.pos[2];
            data[i*8+3] = p.size * (p.kind === 'fire' ? (1.0 + k * 0.6) : (p.kind === 'trail' || p.kind === 'smoke') ? (1.0 + k * 0.9) : 1.0);
            data[i*8+4] = r;
            data[i*8+5] = g;
            data[i*8+6] = bb;
            data[i*8+7] = a;
          }
          gl.bindVertexArray(partVao);
          gl.bindBuffer(gl.ARRAY_BUFFER, partVbo);
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
          gl.enable(gl.BLEND);
          if (mode === 0) gl.blendFunc(gl.SRC_ALPHA, gl.ONE);             // additive
          else            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); // alpha
          gl.useProgram(partProg);
          gl.uniformMatrix4fv(uMvpPart, false, vp);
          gl.uniform1f(uModePart, mode === 0 ? 0.0 : 1.0);
          gl.drawArrays(gl.POINTS, 0, list.length);
          gl.bindVertexArray(null);
          gl.disable(gl.BLEND);
        }

        // Draw smoke first (alpha) so fireballs sit on top.
        uploadAndDraw(alpha, 1);
        uploadAndDraw(add, 0);
      }

      // ---- Snowfall ----
      // Step every flake (gravity-fall + horizontal sway) and recycle any
      // that fall below the ground or drift behind the camera. Then upload
      // and draw with alpha blending. Snow is drawn AFTER explosions so it
      // covers the scene like a foreground veil.
      for (let i = 0; i < SNOW_COUNT; i++) {
        const f = snow[i];
        f.y -= f.fallSpeed * dt;
        f.x += Math.sin(tt * f.sway + f.swayPhase) * 0.4 * dt;
        // Recycle: when a flake falls below ground or its world-space z
        // (relZ - camForward) drifts behind the camera, respawn at top
        // with a fresh xz position somewhere in the visible band.
        if (f.y < SNOW_BOX.yMin) {
          f.y = SNOW_BOX.yMax;
          f.x = (Math.random() * 2 - 1) * SNOW_BOX.xRad;
          f.z = SNOW_BOX.zFar + Math.random() * (SNOW_BOX.zNear - SNOW_BOX.zFar);
        }
        // Pack into scratch buffer. World z = stored relZ shifted by the
        // camera's forward translation so flakes hover in a band that
        // always sits in front of the moving camera.
        const wx = f.x;
        const wy = f.y;
        const wz = f.z - camForward;
        const idx = i * 8;
        snowScratch[idx + 0] = wx;
        snowScratch[idx + 1] = wy;
        snowScratch[idx + 2] = wz;
        snowScratch[idx + 3] = f.size;
        snowScratch[idx + 4] = f.bright;
        snowScratch[idx + 5] = f.bright;
        snowScratch[idx + 6] = f.bright * 1.05;   // tiny cool tint
        snowScratch[idx + 7] = 0.85;
      }
      gl.bindVertexArray(snowVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, snowVbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, snowScratch);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(partProg);
      gl.uniformMatrix4fv(uMvpPart, false, vp);
      gl.uniform1f(uModePart, 1.0);   // soft puff (mode 1)
      gl.drawArrays(gl.POINTS, 0, SNOW_COUNT);
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);

      if (bolts.length > 0) {
        const data = new Float32Array(bolts.length * 6);
        for (let i = 0; i < bolts.length; i++) {
          const b = bolts[i];
          const k = (tt - b.t0) / b.life;
          const head = [
            b.a[0] + (b.b[0]-b.a[0]) * Math.min(1, k * 1.6),
            b.a[1] + (b.b[1]-b.a[1]) * Math.min(1, k * 1.6),
            b.a[2] + (b.b[2]-b.a[2]) * Math.min(1, k * 1.6),
          ];
          const tail = [
            b.a[0] + (b.b[0]-b.a[0]) * Math.max(0, k * 1.6 - 0.25),
            b.a[1] + (b.b[1]-b.a[1]) * Math.max(0, k * 1.6 - 0.25),
            b.a[2] + (b.b[2]-b.a[2]) * Math.max(0, k * 1.6 - 0.25),
          ];
          data[i*6+0] = tail[0]; data[i*6+1] = tail[1]; data[i*6+2] = tail[2];
          data[i*6+3] = head[0]; data[i*6+4] = head[1]; data[i*6+5] = head[2];
        }
        gl.useProgram(lineProg);
        gl.uniformMatrix4fv(uMvpLine, false, vp);
        gl.bindVertexArray(boltVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, boltVbo);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        const groups = new Map();
        for (let i = 0; i < bolts.length; i++) {
          const key = bolts[i].col.join(',');
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(i);
        }
        for (const [key, idxs] of groups) {
          const [r,g,bb] = key.split(',').map(Number);
          gl.uniform3f(uColLine, r, g, bb);
          for (const i of idxs) {
            gl.drawArrays(gl.LINES, i * 2, 2);
          }
        }
        gl.disable(gl.BLEND);
        gl.bindVertexArray(null);
      }
    },
    dispose(gl) {
      gl.deleteProgram(skyProg);
      gl.deleteProgram(duneProg);
      gl.deleteProgram(treeProg);
      gl.deleteProgram(santaProg);
      gl.deleteProgram(obj2Prog);
      gl.deleteProgram(lineProg);
      gl.deleteProgram(partProg);
      gl.deleteVertexArray(duneMesh.vao); gl.deleteBuffer(duneMesh.vbo);
      gl.deleteVertexArray(treeMesh.vao); gl.deleteBuffer(treeMesh.vbo);
      gl.deleteVertexArray(santaVao); gl.deleteBuffer(santaVbo);
      for (const k of Object.keys(ships)) {
        gl.deleteVertexArray(ships[k].vao);
        gl.deleteBuffer(ships[k].vbo);
      }
      gl.deleteVertexArray(boltVao);
      gl.deleteBuffer(boltVbo);
      gl.deleteVertexArray(partVao);
      gl.deleteBuffer(partVbo);
      gl.deleteVertexArray(snowVao);
      gl.deleteBuffer(snowVbo);
    }
  };
}
