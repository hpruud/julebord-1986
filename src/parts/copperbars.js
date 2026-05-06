// Copper bars + ACADEMY logo overlay (Fairlight-cracktro style).
//
// The classic Amiga "copper bars" effect: 8 stacked colour bars sliding
// up/down on sine waves, painted with the copper register trick. On top of
// the bars sits a chunky ACADEMY logo whose interior is filled with its own
// horizontal copper-stripe gradient -- the way the FLT/Fairlight crack
// intros did it. The logo bobs up and down in sync with the average of the
// background bars so the whole scene feels coupled.
//
// Implementation:
// - A small RGBA mask texture holds the rasterised "ACADEMY" text (white
//   pixels where letters are, black elsewhere), drawn once at startup with
//   the existing 8x8 bitmap font scaled up.
// - The fragment shader renders the bars exactly as before, then for each
//   pixel that lands inside the logo's bounding box it samples the mask
//   (with a pixel offset for the up/down bob). When inside a letter it
//   replaces the colour with a hot horizontal-stripe palette; an outline
//   layer (mask sampled with +/-1 px taps) gives a thin dark border so the
//   letters pop against the bright bars.
import { createProgram, VS_FULLSCREEN, VW, VH } from '../gl/context.js';
import { drawQuad } from '../gl/quad.js';
import { bindFBO } from '../gl/framebuffer.js';
import { createPaletteTexture, PALETTES } from '../gl/palette.js';
import { CHUNKY_GLYPHS, CHUNKY_GLYPH_W, CHUNKY_GLYPH_H } from '../util/chunky_font.js';

// Logo metrics. We use the hand-designed 16x20 chunky glyphs and upscale by
// LOGO_SCALE (each base pixel becomes a SCALExSCALE block). At scale 2 each
// letter becomes 32x40 px with ~8-px-thick strokes -- chunky like the real
// Fairlight/Paradox crack intros. 7 letters * 32 = 224 px + 6 gaps * 4 px =
// 248 px total, centred in the 320 px canvas with 36 px margins.
const LOGO = 'ACADEMY';
const LOGO_SCALE = 2;
const LETTER_W = CHUNKY_GLYPH_W * LOGO_SCALE;   // 32
const LETTER_H = CHUNKY_GLYPH_H * LOGO_SCALE;   // 40
const LETTER_GAP = 4;                            // px between letters in final
const LOGO_W = LOGO.length * LETTER_W + (LOGO.length - 1) * LETTER_GAP; // 248
const LOGO_H = LETTER_H;                         // 40
const LOGO_X = ((VW - LOGO_W) / 2) | 0;          // 36
// Centre vertically a bit above the middle so the bars below look like a
// "sea" supporting the logo. Adjust BOB_AMP for swing magnitude.
const LOGO_CY = 80;
const BOB_AMP = 10;

// Build a small mask texture sized to the logo bounding box (LOGO_W x LOGO_H).
// Each base-pixel of every glyph is expanded into a SCALExSCALE block of
// white pixels in the big bitmap. Letters sit at fixed x-offsets stride =
// LETTER_W + LETTER_GAP.
function buildLogoMaskBitmap() {
  const big = new Uint8Array(LOGO_W * LOGO_H * 4);
  for (let li = 0; li < LOGO.length; li++) {
    const ch = LOGO[li];
    const glyph = CHUNKY_GLYPHS[ch];
    if (!glyph) continue;
    const ox = li * (LETTER_W + LETTER_GAP);
    for (let gy = 0; gy < CHUNKY_GLYPH_H; gy++) {
      const row = glyph[gy];
      for (let gx = 0; gx < CHUNKY_GLYPH_W; gx++) {
        if (row[gx] !== '#') continue;
        // Expand to a SCALExSCALE block.
        for (let dy = 0; dy < LOGO_SCALE; dy++) {
          const py = gy * LOGO_SCALE + dy;
          for (let dx = 0; dx < LOGO_SCALE; dx++) {
            const px = ox + gx * LOGO_SCALE + dx;
            const bIdx = (py * LOGO_W + px) * 4;
            big[bIdx + 0] = 255;
            big[bIdx + 1] = 255;
            big[bIdx + 2] = 255;
            big[bIdx + 3] = 255;
          }
        }
      }
    }
  }
  return big;
}

function createLogoMaskTexture(gl) {
  const data = buildLogoMaskBitmap();
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, LOGO_W, LOGO_H, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform float u_time;
uniform vec2  u_res;
uniform sampler2D u_mask;
uniform vec2  u_logoOrigin;   // pixel coords of logo top-left within u_res
uniform vec2  u_logoSize;     // pixel size of logo bbox
uniform float u_logoBob;      // current y-offset (px) of the logo

// Identical bar primitive as before -- a soft falloff body with a sharp
// specular highlight at the centre line.
vec3 copperBar(float y, float center, float halfWidth, vec3 baseCol) {
  float d = abs(y - center) / halfWidth;
  if (d > 1.0) return vec3(0.0);
  float edge = pow(1.0 - d, 1.4);
  float spec = pow(1.0 - smoothstep(0.0, 0.18, d), 4.0);
  vec3 col = baseCol * edge;
  col += vec3(1.0, 0.95, 0.85) * spec * 0.7;
  return col;
}

// Sample the alpha of the logo mask in pixel coordinates relative to the
// logo bbox top-left. Returns 0 (outside) or 1 (inside).
float sampleMask(vec2 pxInLogo) {
  if (pxInLogo.x < 0.0 || pxInLogo.y < 0.0 ||
      pxInLogo.x >= u_logoSize.x || pxInLogo.y >= u_logoSize.y) return 0.0;
  vec2 uv = pxInLogo / u_logoSize;
  return step(0.5, texture(u_mask, uv).r);
}

void main() {
  vec2 p = v_uv * u_res;
  vec3 col = vec3(0.0);

  // Slow background tint (sea-of-bars feel).
  float bg = 0.5 + 0.5 * sin(p.y * 0.025 + u_time * 0.4);
  col += vec3(0.05, 0.04, 0.10) + vec3(bg) * vec3(0.04, 0.02, 0.07);

  // 8 stacked christmas bars.
  vec3 palette[8];
  palette[0] = vec3(0.95, 0.20, 0.20);
  palette[1] = vec3(0.20, 0.85, 0.30);
  palette[2] = vec3(1.00, 0.95, 0.30);
  palette[3] = vec3(0.95, 0.95, 1.00);
  palette[4] = vec3(0.75, 0.10, 0.15);
  palette[5] = vec3(0.10, 0.55, 0.20);
  palette[6] = vec3(1.00, 0.75, 0.20);
  palette[7] = vec3(0.85, 0.30, 0.25);

  for (int i = 0; i < 8; i++) {
    float fi = float(i);
    float center = u_res.y * 0.5
                 + sin(u_time * (0.45 + fi * 0.07) + fi * 0.9) * (u_res.y * 0.42);
    float hw = 12.0 + 3.0 * sin(u_time * 1.1 + fi);
    col += copperBar(p.y, center, hw, palette[i]);
  }

  // Gentle scanline darkening (CRT/Amiga vibe).
  col *= 0.92 + 0.08 * sin(p.y * 3.14159);

  // ---- ACADEMY logo overlay (Fairlight-cracktro style) ----
  // Logo position in screen-pixel space, with the bob applied.
  vec2 logoTL = u_logoOrigin + vec2(0.0, u_logoBob);
  vec2 pxInLogo = p - logoTL;

  float m = sampleMask(pxInLogo);
  // Outline test: any of the 4-neighbour samples lit but centre dark -> edge.
  float mL = sampleMask(pxInLogo + vec2(-1.0,  0.0));
  float mR = sampleMask(pxInLogo + vec2( 1.0,  0.0));
  float mU = sampleMask(pxInLogo + vec2( 0.0, -1.0));
  float mD = sampleMask(pxInLogo + vec2( 0.0,  1.0));
  float mNeighbour = max(max(mL, mR), max(mU, mD));
  float onOutline = (1.0 - m) * mNeighbour;

  // Drop shadow: shifted-down-right copy of the mask, drawn before any
  // logo body so the body overdraws it.
  float mShadow = sampleMask(pxInLogo - vec2(2.0, 2.0));
  if (mShadow > 0.5 && m < 0.5 && onOutline < 0.5) {
    col = mix(col, vec3(0.02, 0.01, 0.03), 0.65);
  }

  if (m > 0.5) {
    // Inside-letter copper stripes. Use the local Y *within the logo*, plus
    // a slow scroll, to produce horizontal bands that look like the FLT
    // chrome stripes. Christmas-themed five-stop palette with crisp band
    // boundaries (very narrow smoothsteps) so it reads like real Amiga
    // copper-list bands rather than a soft gradient.
    float ly = pxInLogo.y;
    float k = ly / u_logoSize.y;                  // 0 top -> 1 bottom of logo
    // Add a gentle scroll so the stripes appear to flow upward through the
    // letters; modulus keeps it inside the letter band.
    float kk = fract(k * 1.4 + u_time * 0.20);

    // Five hot bands: dark-red -> red -> gold -> white -> green -> dark-green.
    // Crisp transitions (smoothstep with 0.02 width) for that copper-list
    // hard-edge look.
    vec3 c0 = vec3(0.40, 0.03, 0.04);   // deep red
    vec3 c1 = vec3(1.00, 0.18, 0.20);   // bright red
    vec3 c2 = vec3(1.00, 0.85, 0.30);   // gold
    vec3 c3 = vec3(1.00, 1.00, 0.95);   // near-white
    vec3 c4 = vec3(0.30, 0.90, 0.40);   // bright green
    vec3 c5 = vec3(0.05, 0.35, 0.10);   // deep green

    vec3 stripe = c0;
    stripe = mix(stripe, c1, smoothstep(0.10, 0.14, kk));
    stripe = mix(stripe, c2, smoothstep(0.28, 0.32, kk));
    stripe = mix(stripe, c3, smoothstep(0.46, 0.50, kk));
    stripe = mix(stripe, c4, smoothstep(0.62, 0.66, kk));
    stripe = mix(stripe, c5, smoothstep(0.82, 0.86, kk));

    // Bevel: lighten the top half, darken the bottom half within each
    // letter to suggest 3D shading (light-from-above). This gives the
    // chunky letterforms volume without needing real 3D.
    float bevel = mix(1.18, 0.78, k);
    stripe *= bevel;

    // Specular highlight on the very top edge (within ~10% of letter top).
    float sheen = smoothstep(0.12, 0.0, k);
    stripe += vec3(1.0, 0.97, 0.85) * sheen * 0.35;

    col = stripe;
  } else if (onOutline > 0.5) {
    // Hard 1-px black outline around every letter -- the trick that keeps
    // the chrome-striped letters readable against the bright copper bars.
    col = vec3(0.02, 0.01, 0.02);
  }

  outColor = vec4(col, 1.0);
}
`;

export function copperbars(gl) {
  const prog = createProgram(gl, VS_FULLSCREEN, FS);
  const uTime        = gl.getUniformLocation(prog, 'u_time');
  const uRes         = gl.getUniformLocation(prog, 'u_res');
  const uMask        = gl.getUniformLocation(prog, 'u_mask');
  const uLogoOrigin  = gl.getUniformLocation(prog, 'u_logoOrigin');
  const uLogoSize    = gl.getUniformLocation(prog, 'u_logoSize');
  const uLogoBob     = gl.getUniformLocation(prog, 'u_logoBob');

  // Palette texture is unused by this shader currently but kept around to
  // match the original makeShaderPart contract -- some pipelines still bind
  // texture unit 0; we'll bind the mask there instead.
  const palTex  = createPaletteTexture(gl, PALETTES.copper || PALETTES.plasma);
  const maskTex = createLogoMaskTexture(gl);

  return {
    prog,
    render(gl, t /* ms */, fbo) {
      bindFBO(gl, fbo);
      gl.useProgram(prog);

      // Bind mask to texture unit 0.
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, maskTex);
      gl.uniform1i(uMask, 0);

      const tt = t / 1000;
      gl.uniform1f(uTime, tt);
      gl.uniform2f(uRes, VW, VH);
      gl.uniform2f(uLogoOrigin, LOGO_X, LOGO_CY - LOGO_H * 0.5);
      gl.uniform2f(uLogoSize, LOGO_W, LOGO_H);

      // Bob: snappier sine so the logo visibly rides the copper waves
      // instead of drifting. ~2.4 rad/s -> a full cycle every ~2.6 s,
      // roughly 3x the original 0.69 rad/s pace.
      const bob = Math.sin(tt * 2.4) * BOB_AMP;
      gl.uniform1f(uLogoBob, bob);

      drawQuad(gl);

      // Suppress unused-var lint by referencing palTex once in dispose path.
      void palTex;
    },
    dispose(gl) {
      gl.deleteProgram(prog);
      gl.deleteTexture(maskTex);
      gl.deleteTexture(palTex);
    },
  };
}
