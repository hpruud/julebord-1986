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

  // Pre-rasterize background (sky gradient + ground + tree silhouette + moon)
  // into a static "scene" buffer that we copy into `buf` each frame before
  // drawing particles on top.
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
    // Moon: filled circle with a slight halo.
    const mx = VW - 60, my = 50, mr = 18;
    for (let y = -mr - 8; y <= mr + 8; y++) for (let x = -mr - 8; x <= mr + 8; x++) {
      const d = Math.sqrt(x*x + y*y);
      const xx = mx + x, yy = my + y;
      if (xx < 0 || xx >= VW || yy < 0 || yy >= VH) continue;
      const j = (yy * VW + xx) * 4;
      if (d <= mr) {
        scene[j] = 245; scene[j+1] = 240; scene[j+2] = 210; scene[j+3] = 255;
      } else if (d <= mr + 6) {
        const k = 1 - (d - mr) / 6;
        scene[j] = Math.min(255, scene[j] + (60 * k) | 0);
        scene[j+1] = Math.min(255, scene[j+1] + (55 * k) | 0);
        scene[j+2] = Math.min(255, scene[j+2] + (35 * k) | 0);
      }
    }
    // Pixel-art Christmas tree, stacked triangles. Anchored bottom-center.
    const cx = (VW / 2) | 0;
    const baseY = (VH * 0.86) | 0;
    function triangle(topY, halfBase, color) {
      const [r, g, b] = color;
      for (let y = 0; y < halfBase; y++) {
        const yy = topY + y;
        if (yy < 0 || yy >= VH) continue;
        for (let x = -y; x <= y; x++) {
          const xx = cx + x;
          if (xx < 0 || xx >= VW) continue;
          const j = (yy * VW + xx) * 4;
          scene[j] = r; scene[j+1] = g; scene[j+2] = b; scene[j+3] = 255;
        }
      }
    }
    triangle(baseY - 80, 18, [20, 70, 30]);
    triangle(baseY - 60, 28, [25, 85, 35]);
    triangle(baseY - 36, 40, [30, 95, 40]);
    // Trunk
    for (let y = 0; y < 8; y++) for (let x = -4; x <= 4; x++) {
      const yy = baseY + y, xx = cx + x;
      if (xx < 0 || xx >= VW || yy < 0 || yy >= VH) continue;
      const j = (yy * VW + xx) * 4;
      scene[j] = 70; scene[j+1] = 40; scene[j+2] = 18; scene[j+3] = 255;
    }
    // Star on top.
    const sx = cx, sy = baseY - 82;
    const star = [[0,0],[0,-1],[0,1],[-1,0],[1,0]];
    for (const [dx, dy] of star) {
      const xx = sx + dx, yy = sy + dy;
      if (xx < 0 || xx >= VW || yy < 0 || yy >= VH) continue;
      const j = (yy * VW + xx) * 4;
      scene[j] = 255; scene[j+1] = 230; scene[j+2] = 100; scene[j+3] = 255;
    }
    // Ornaments (red/gold dots).
    const orns = [
      [-6, -70, 220, 40, 50], [4, -64, 240, 200, 80],
      [-14, -52, 230, 60, 60], [12, -48, 250, 210, 90],
      [-22, -34, 230, 70, 70], [20, -30, 250, 200, 80],
      [-4, -42, 250, 220, 100], [8, -22, 235, 60, 60],
      [-28, -18, 250, 200, 90], [26, -14, 230, 60, 60],
    ];
    for (const [dx, dy, r, g, b] of orns) {
      const xx = cx + dx, yy = baseY + dy;
      if (xx < 0 || xx >= VW || yy < 0 || yy >= VH) continue;
      const j = (yy * VW + xx) * 4;
      scene[j] = r; scene[j+1] = g; scene[j+2] = b; scene[j+3] = 255;
    }
  }
  buildScene();

  return {
    render(gl, t, fbo) {
      const dt = lastT === 0 ? 16 : Math.min(48, t - lastT);
      lastT = t;
      const tt = t / 1000;
      // Copy static scene as background.
      buf.set(scene);
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
