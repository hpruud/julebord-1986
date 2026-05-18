// Fireworks: CPU particle bursts over a dark night sky with a low silhouette.
// Each burst is a radial explosion with gravity and drag; particles paint
// into a decaying "trail" buffer that gives them sparkle tails. A brief
// white flash sells the pop when a burst spawns.
import { createProgram, VS_FULLSCREEN, VW, VH } from '../gl/context.js';
import { drawQuad } from '../gl/quad.js';
import { bindFBO } from '../gl/framebuffer.js';
import { PALETTES, PALETTE_SIZE } from '../gl/palette.js';

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_tex;
uniform float u_time;
uniform float u_flash;
void main() {
  vec3 col = texture(u_tex, v_uv).rgb;
  // Light vignette so the corners feel like night.
  vec2 c = v_uv - 0.5;
  col *= mix(0.55, 1.0, 1.0 - smoothstep(0.50, 0.95, length(c)));
  // White flash from the latest burst.
  col = mix(col, vec3(1.0), u_flash);
  outColor = vec4(col, 1.0);
}
`;

const N = 600;

export function fireworks(gl) {
  const prog = createProgram(gl, VS_FULLSCREEN, FS);
  const uTex   = gl.getUniformLocation(prog, 'u_tex');
  const uTime  = gl.getUniformLocation(prog, 'u_time');
  const uFlash = gl.getUniformLocation(prog, 'u_flash');

  const buf   = new Uint8Array(VW * VH * 4);
  const trail = new Uint8Array(VW * VH * 4);
  const scene = new Uint8Array(VW * VH * 4);

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, VW, VH, 0, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // Background: night-sky gradient + low silhouette skyline + sparse stars.
  (function buildScene() {
    for (let y = 0; y < VH; y++) {
      for (let x = 0; x < VW; x++) {
        const j = (y * VW + x) * 4;
        const t = y / VH;
        scene[j]   = (4 + t * 18) | 0;
        scene[j+1] = (6 + t * 12) | 0;
        scene[j+2] = (20 + t * 30) | 0;
        scene[j+3] = 255;
      }
    }
    // Stars.
    for (let i = 0; i < 90; i++) {
      const x = (Math.random() * VW) | 0;
      const y = (Math.random() * VH * 0.70) | 0;
      const j = (y * VW + x) * 4;
      const b = 160 + ((Math.random() * 80) | 0);
      scene[j] = b; scene[j+1] = b; scene[j+2] = Math.min(255, b + 20);
    }
    // Skyline silhouette along the bottom: jagged triangle peaks.
    const baseY = (VH * 0.82) | 0;
    for (let x = 0; x < VW; x++) {
      const h =
        20 + 18 * Math.sin(x * 0.05) +
        10 * Math.sin(x * 0.13 + 1.7) +
        6  * Math.sin(x * 0.31 + 0.4);
      const top = (baseY - h) | 0;
      for (let y = top; y < VH; y++) {
        const j = (y * VW + x) * 4;
        // Almost black with a hint of cold blue.
        const k = (y - top) / Math.max(1, VH - top);
        scene[j]   = (8 + k * 8) | 0;
        scene[j+1] = (10 + k * 10) | 0;
        scene[j+2] = (18 + k * 12) | 0;
      }
    }
    // A few warm window lights in the silhouette.
    for (let i = 0; i < 14; i++) {
      const x = ((Math.random() * VW) | 0);
      const y = baseY + 4 + ((Math.random() * 24) | 0);
      const j = (y * VW + x) * 4;
      scene[j] = 230; scene[j+1] = 180; scene[j+2] = 60;
    }
  })();

  // Sample palette colors (christmas) once.
  const palData = PALETTES.christmas;
  const palRGB = new Uint8Array(PALETTE_SIZE * 3);
  for (let i = 0; i < PALETTE_SIZE; i++) {
    palRGB[i*3]   = palData[i*4];
    palRGB[i*3+1] = palData[i*4+1];
    palRGB[i*3+2] = palData[i*4+2];
  }

  // Particle pool.
  const px = new Float32Array(N);
  const py = new Float32Array(N);
  const vx = new Float32Array(N);
  const vy = new Float32Array(N);
  const life = new Float32Array(N); // seconds remaining; <=0 means dead
  const maxLife = new Float32Array(N);
  const hue = new Uint8Array(N);    // palette index

  let nextBurstAt = 0.3;
  let flashAmt = 0;
  let lastT = 0;
  let tt = 0;

  function spawnBurst() {
    const cx = VW * (0.15 + Math.random() * 0.70);
    const cy = VH * (0.18 + Math.random() * 0.40);
    const count = 36 + ((Math.random() * 44) | 0);
    const baseHue = (Math.random() * PALETTE_SIZE) | 0;
    const speed = 50 + Math.random() * 35;
    let spawned = 0;
    for (let i = 0; i < N && spawned < count; i++) {
      if (life[i] > 0) continue;
      const ang = Math.random() * Math.PI * 2;
      const mag = speed * (0.55 + Math.random() * 0.85);
      px[i] = cx;
      py[i] = cy;
      vx[i] = Math.cos(ang) * mag;
      vy[i] = Math.sin(ang) * mag;
      const ml = 0.9 + Math.random() * 0.8;
      life[i] = ml;
      maxLife[i] = ml;
      // Spread hue around baseHue for varied sparkle.
      const h = (baseHue + ((Math.random() * 6) | 0) - 3 + PALETTE_SIZE) % PALETTE_SIZE;
      hue[i] = h;
      spawned++;
    }
    flashAmt = 0.55;
  }

  function additivePixel(x, y, r, g, b) {
    if (x < 0 || x >= VW || y < 0 || y >= VH) return;
    const j = ((y | 0) * VW + (x | 0)) * 4;
    trail[j]   = Math.min(255, trail[j]   + r);
    trail[j+1] = Math.min(255, trail[j+1] + g);
    trail[j+2] = Math.min(255, trail[j+2] + b);
  }

  return {
    render(gl, t, fbo) {
      const dt = lastT === 0 ? 0.016 : Math.min(0.05, (t - lastT) / 1000);
      lastT = t;
      tt += dt;

      // Decay trail buffer ~7% per frame.
      for (let i = 0; i < trail.length; i += 4) {
        trail[i]   = (trail[i]   * 232) >> 8;
        trail[i+1] = (trail[i+1] * 232) >> 8;
        trail[i+2] = (trail[i+2] * 232) >> 8;
      }
      // Flash decays exponentially.
      flashAmt *= Math.pow(0.05, dt);

      // Spawn bursts on schedule.
      if (tt >= nextBurstAt) {
        spawnBurst();
        nextBurstAt = tt + 0.55 + Math.random() * 0.9;
      }

      // Integrate + paint particles.
      const gravity = 60;
      for (let i = 0; i < N; i++) {
        if (life[i] <= 0) continue;
        vx[i] *= Math.pow(0.78, dt);
        vy[i] *= Math.pow(0.78, dt);
        vy[i] += gravity * dt;
        px[i] += vx[i] * dt;
        py[i] += vy[i] * dt;
        life[i] -= dt;
        const k = Math.max(0, life[i] / maxLife[i]); // 1..0
        const h = hue[i];
        const r = (palRGB[h*3]   * k) | 0;
        const g = (palRGB[h*3+1] * k) | 0;
        const b = (palRGB[h*3+2] * k) | 0;
        // Bright core + soft cross.
        additivePixel(px[i],     py[i],     r, g, b);
        const half = (k * 90) | 0;
        additivePixel(px[i] + 1, py[i],     half, half, half);
        additivePixel(px[i] - 1, py[i],     half, half, half);
        additivePixel(px[i],     py[i] + 1, half, half, half);
        additivePixel(px[i],     py[i] - 1, half, half, half);
      }

      // Compose: scene + trail (additive saturated).
      for (let i = 0; i < buf.length; i += 4) {
        buf[i]   = Math.min(255, scene[i]   + trail[i]);
        buf[i+1] = Math.min(255, scene[i+1] + trail[i+1]);
        buf[i+2] = Math.min(255, scene[i+2] + trail[i+2]);
        buf[i+3] = 255;
      }

      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, VW, VH, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      bindFBO(gl, fbo);
      gl.useProgram(prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(uTex, 0);
      gl.uniform1f(uTime, tt);
      gl.uniform1f(uFlash, Math.min(0.55, flashAmt));
      drawQuad(gl);
    },
    dispose(gl) {
      gl.deleteProgram(prog);
      gl.deleteTexture(tex);
    },
  };
}
