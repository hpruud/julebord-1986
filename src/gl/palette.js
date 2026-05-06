// Procedural palettes (32 colors each) and a 1D palette texture for sampling in shaders.
import { TAU } from '../util/math.js';

export const PALETTE_SIZE = 32;

// Build palette as flat Uint8Array of length PALETTE_SIZE*4 (rgba).
function pal(colors) {
  const out = new Uint8Array(PALETTE_SIZE * 4);
  for (let i = 0; i < PALETTE_SIZE; i++) {
    const [r, g, b] = colors[i] || [0, 0, 0];
    out[i*4+0] = r;
    out[i*4+1] = g;
    out[i*4+2] = b;
    out[i*4+3] = 255;
  }
  return out;
}

function gradient(stops) {
  // stops: array of [t, [r,g,b]]
  const out = [];
  for (let i = 0; i < PALETTE_SIZE; i++) {
    const t = i / (PALETTE_SIZE - 1);
    let a = stops[0], b = stops[stops.length-1];
    for (let s = 0; s < stops.length-1; s++) {
      if (t >= stops[s][0] && t <= stops[s+1][0]) { a = stops[s]; b = stops[s+1]; break; }
    }
    const span = (b[0] - a[0]) || 1;
    const k = (t - a[0]) / span;
    out.push([
      Math.round(a[1][0] + (b[1][0]-a[1][0]) * k),
      Math.round(a[1][1] + (b[1][1]-a[1][1]) * k),
      Math.round(a[1][2] + (b[1][2]-a[1][2]) * k),
    ]);
  }
  return out;
}

// Hand-tuned palettes per part.
export const PALETTES = {
  intro: pal(gradient([
    [0.0, [0, 0, 0]],
    [0.4, [40, 24, 80]],
    [0.7, [200, 140, 40]],
    [1.0, [255, 240, 180]],
  ])),
  starfield: pal(gradient([
    [0.0, [0, 0, 0]],
    [0.5, [40, 40, 100]],
    [1.0, [240, 240, 255]],
  ])),
  copper: pal((() => {
    const out = [];
    for (let i = 0; i < PALETTE_SIZE; i++) {
      const t = i / PALETTE_SIZE;
      const r = Math.sin(t * TAU + 0) * 0.5 + 0.5;
      const g = Math.sin(t * TAU + 2) * 0.5 + 0.5;
      const b = Math.sin(t * TAU + 4) * 0.5 + 0.5;
      out.push([r*255|0, g*255|0, b*255|0]);
    }
    return out;
  })()),
  plasma: pal((() => {
    const out = [];
    for (let i = 0; i < PALETTE_SIZE; i++) {
      const t = i / PALETTE_SIZE;
      const r = Math.sin(t * TAU * 1.0) * 0.5 + 0.5;
      const g = Math.sin(t * TAU * 1.0 + 2.094) * 0.5 + 0.5;
      const b = Math.sin(t * TAU * 1.0 + 4.188) * 0.5 + 0.5;
      out.push([r*255|0, g*255|0, b*255|0]);
    }
    return out;
  })()),
  bobs: pal(gradient([
    [0.0, [0, 0, 30]],
    [0.5, [200, 60, 180]],
    [1.0, [255, 230, 120]],
  ])),
  fire: pal(gradient([
    [0.0,  [0, 0, 0]],
    [0.15, [40, 0, 0]],
    [0.35, [180, 30, 0]],
    [0.55, [240, 120, 20]],
    [0.75, [255, 220, 60]],
    [1.0,  [255, 255, 220]],
  ])),
  rotozoom: pal(gradient([
    [0.0, [10, 0, 30]],
    [0.5, [80, 30, 160]],
    [1.0, [255, 220, 240]],
  ])),
  tunnel: pal(gradient([
    [0.0, [0, 0, 0]],
    [0.5, [0, 80, 200]],
    [1.0, [180, 240, 255]],
  ])),
  vector: pal(gradient([
    [0.0, [0, 0, 0]],
    [0.4, [40, 80, 30]],
    [0.7, [120, 220, 80]],
    [1.0, [240, 255, 200]],
  ])),
  glenz: pal(gradient([
    [0.0, [0, 0, 0]],
    [0.3, [120, 0, 60]],
    [0.6, [240, 80, 200]],
    [1.0, [255, 220, 255]],
  ])),
  greetz: pal(gradient([
    [0.0, [0, 0, 0]],
    [0.5, [200, 100, 40]],
    [1.0, [255, 240, 200]],
  ])),
  outro: pal(gradient([
    [0.0, [0, 0, 0]],
    [0.5, [80, 40, 120]],
    [1.0, [255, 216, 77]],
  ])),
  // Classic deep-blue Mandelbrot: black -> navy -> blue -> cyan -> white.
  mandel: pal(gradient([
    [0.0,  [0, 0, 20]],
    [0.2,  [0, 30, 90]],
    [0.45, [40, 120, 200]],
    [0.7,  [180, 230, 255]],
    [0.85, [255, 240, 200]],
    [1.0,  [80, 30, 100]],
  ])),
  // Deep-zoom Mandelbrot: purple -> magenta -> gold for a richer feel
  // suited to the spiral structures uncovered at extreme depth.
  mandel_deep: pal(gradient([
    [0.0,  [10, 0, 30]],
    [0.25, [80, 0, 120]],
    [0.5,  [220, 60, 180]],
    [0.75, [255, 180, 80]],
    [1.0,  [255, 250, 230]],
  ])),
  // Julia: warm rainbow for the morphing animation.
  julia: pal(gradient([
    [0.0,  [10, 0, 40]],
    [0.2,  [60, 10, 130]],
    [0.4,  [220, 40, 100]],
    [0.6,  [255, 140, 30]],
    [0.8,  [255, 240, 120]],
    [1.0,  [255, 255, 240]],
  ])),
  // Christmas: red -> snow white -> pine green, top-to-bottom of letter.
  christmas: pal(gradient([
    [0.00, [180,  20,  30]],
    [0.25, [240,  60,  60]],
    [0.50, [255, 240, 220]],
    [0.75, [110, 200,  90]],
    [1.00, [ 30, 120,  50]],
  ])),
};

export function createPaletteTexture(gl, paletteData) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, PALETTE_SIZE, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, paletteData);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

export function updatePaletteTexture(gl, tex, paletteData) {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, PALETTE_SIZE, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, paletteData);
}
