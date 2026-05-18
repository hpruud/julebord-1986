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

const N = 1400;

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
    // Full moon ported from the spacebattle scene: pixel-art disc with
    // soft two-stage halo, named maria, Tycho + Copernicus crater
    // highlights, sinusoidal surface mottling, and cool limb darkening.
    const mcx = VW * 0.66, mcy = VH * 0.30;
    const MOON_R = VH * 0.090;        // ~23 px to match the spacebattle moon
    const HALO_WIDE = MOON_R / 0.09 * 0.32; // outer halo radius (≈82 px)
    const HALO_TIGHT = MOON_R / 0.09 * 0.16;
    const gx0 = Math.max(0, (mcx - HALO_WIDE) | 0), gx1 = Math.min(VW, (mcx + HALO_WIDE + 1) | 0);
    const gy0 = Math.max(0, (mcy - HALO_WIDE) | 0), gy1 = Math.min(VH, (mcy + HALO_WIDE + 1) | 0);
    const moonCoreR = 255, moonCoreG = 253, moonCoreB = 240; // (1.00, 0.99, 0.94)
    for (let y = gy0; y < gy1; y++) {
      for (let x = gx0; x < gx1; x++) {
        const dx = x - mcx, dy = y - mcy;
        const r = Math.sqrt(dx * dx + dy * dy);
        if (r >= HALO_WIDE) continue;
        const j = (y * VW + x) * 4;

        // Two-stage halo: cool wide + bright tight, additive over the sky.
        const tw = Math.max(0, 1 - r / HALO_WIDE);
        const tt2 = Math.max(0, 1 - r / HALO_TIGHT);
        const haloWide  = tw * tw;            // smoothstep-ish falloff
        const haloTight = tt2 * tt2;
        const ar = (haloWide * 0.55 * 0.10 + haloTight * 0.85 * 0.18) * 255;
        const ag = (haloWide * 0.62 * 0.10 + haloTight * 0.90 * 0.18) * 255;
        const ab = (haloWide * 0.78 * 0.10 + haloTight * 1.00 * 0.18) * 255;
        scene[j]   = Math.min(255, scene[j]   + (ar | 0));
        scene[j+1] = Math.min(255, scene[j+1] + (ag | 0));
        scene[j+2] = Math.min(255, scene[j+2] + (ab | 0));

        if (r > MOON_R + 0.5) continue;
        // Disc with 1-pixel anti-aliased edge.
        const edge = MOON_R + 0.5 - r;             // 1.0 inside, 0..1 across the edge
        const disc = Math.max(0, Math.min(1, edge));

        // Moon-local UV in [-1..1] across the disc.
        const u = dx / MOON_R, v = dy / MOON_R;

        // Maria (loose Imbrium, Serenitatis, Tranquillitatis, Nubium, Crisium).
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

        // Surface mottling via stacked sines (cheap fake noise).
        let mott = Math.sin(u * 18 + 1.7) * Math.cos(v * 17 + 0.3)
                 + Math.sin(u * 31)       * Math.cos(v * 29);
        mott = mott * 0.5 + 0.5; // 0..1
        const mottAmp = 0.025;

        // Crater highlights: Tycho (bottom) + rays, Copernicus (mid).
        const tdx = u - (-0.05), tdy = v - (-0.55);
        const tychoR = Math.sqrt(tdx * tdx + tdy * tdy);
        const tychoSpot = Math.max(0, 1 - tychoR / 0.10) * 0.18;
        const tychoRays = Math.max(0, 1 - tychoR / 0.45) * 0.04;
        const cdx = u - (-0.10), cdy = v - 0.05;
        const coperR = Math.sqrt(cdx * cdx + cdy * cdy);
        const coperSpot = Math.max(0, 1 - coperR / 0.06) * 0.15;
        const bright = tychoSpot + tychoRays + coperSpot;

        // Compose moon color, then cool limb darkening over the outer 22%.
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

        // Blend disc over (halo-augmented) sky using the AA edge.
        const sR = scene[j]   / 255;
        const sG = scene[j+1] / 255;
        const sB = scene[j+2] / 255;
        scene[j]   = ((mr * disc + sR * (1 - disc)) * 255) | 0;
        scene[j+1] = ((mg * disc + sG * (1 - disc)) * 255) | 0;
        scene[j+2] = ((mb * disc + sB * (1 - disc)) * 255) | 0;
      }
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

  // Particle pool. Each particle now carries its own RGB tint, kind, and
  // sparkle phase so we can mix peony, chrysanthemum, ring, willow and
  // palm bursts in the same shower of colors.
  const px = new Float32Array(N);
  const py = new Float32Array(N);
  const vx = new Float32Array(N);
  const vy = new Float32Array(N);
  const life = new Float32Array(N); // seconds remaining; <=0 means dead
  const maxLife = new Float32Array(N);
  const pr = new Uint8Array(N);
  const pg = new Uint8Array(N);
  const pb = new Uint8Array(N);
  const kind = new Uint8Array(N);     // 0 normal, 1 willow (heavy drag), 2 palm streamer, 3 crackle
  const phase = new Float32Array(N);  // per-particle sparkle phase
  const drag = new Float32Array(N);   // per-particle velocity damping
  const grav = new Float32Array(N);   // per-particle gravity multiplier
  // Rocket trails: a few rising sparks that "launch" a burst at apex.
  const ROCKETS = 6;
  const rkx = new Float32Array(ROCKETS);
  const rky = new Float32Array(ROCKETS);
  const rkvy = new Float32Array(ROCKETS);
  const rklife = new Float32Array(ROCKETS);
  const rkhue = new Float32Array(ROCKETS);

  let nextBurstAt = 0.2;
  let flashAmt = 0;
  let lastT = 0;
  let tt = 0;

  function pickColor(baseHue, jitter) {
    const h = (baseHue + (Math.random() - 0.5) * jitter + 1) % 1;
    const s = 0.55 + Math.random() * 0.45;
    const v = 0.85 + Math.random() * 0.15;
    return hsv(h, s, v);
  }

  // Spawn a burst at (cx, cy). Returns the burst's flash amount so caller
  // can punch the sky.
  function emitBurst(cx, cy) {
    // Pick a "shape" for this burst.
    const kindRoll = Math.random();
    let shape;
    if (kindRoll < 0.30) shape = 'peony';
    else if (kindRoll < 0.50) shape = 'chrys';
    else if (kindRoll < 0.65) shape = 'ring';
    else if (kindRoll < 0.78) shape = 'willow';
    else if (kindRoll < 0.88) shape = 'palm';
    else shape = 'crackle';

    // Color scheme: solo, dual, or rainbow.
    const schemeRoll = Math.random();
    const baseHue = Math.random();
    const dualHue = (baseHue + 0.5 + (Math.random() - 0.5) * 0.2) % 1;
    const useRainbow = schemeRoll > 0.78;
    const useDual = !useRainbow && schemeRoll > 0.45;

    let count, speed, baseLife, k, dragV, gravV;
    switch (shape) {
      case 'ring':    count = 70; speed = 80; baseLife = 1.4; k = 0; dragV = 0.82; gravV = 0.7; break;
      case 'chrys':   count = 110; speed = 75; baseLife = 1.7; k = 0; dragV = 0.78; gravV = 1.0; break;
      case 'willow':  count = 80;  speed = 55; baseLife = 2.2; k = 1; dragV = 0.55; gravV = 1.6; break;
      case 'palm':    count = 50;  speed = 90; baseLife = 1.6; k = 2; dragV = 0.85; gravV = 1.1; break;
      case 'crackle': count = 90;  speed = 70; baseLife = 1.3; k = 3; dragV = 0.80; gravV = 1.0; break;
      default:        count = 95;  speed = 70; baseLife = 1.4; k = 0; dragV = 0.78; gravV = 1.0;
    }

    let spawned = 0;
    for (let i = 0; i < N && spawned < count; i++) {
      if (life[i] > 0) continue;
      let ang, mag;
      if (shape === 'ring') {
        // Tight speed band -> visible ring.
        ang = (spawned / count) * Math.PI * 2 + Math.random() * 0.08;
        mag = speed * (0.95 + Math.random() * 0.10);
      } else if (shape === 'palm') {
        // Upward fan: narrow cone biased up.
        ang = -Math.PI / 2 + (Math.random() - 0.5) * 1.2;
        mag = speed * (0.7 + Math.random() * 0.6);
      } else if (shape === 'chrys') {
        ang = Math.random() * Math.PI * 2;
        mag = speed * (0.45 + Math.random() * 0.95);
      } else {
        ang = Math.random() * Math.PI * 2;
        mag = speed * (0.55 + Math.random() * 0.85);
      }
      px[i] = cx;
      py[i] = cy;
      vx[i] = Math.cos(ang) * mag;
      vy[i] = Math.sin(ang) * mag;
      const ml = baseLife * (0.75 + Math.random() * 0.5);
      life[i] = ml;
      maxLife[i] = ml;
      let col;
      if (useRainbow) {
        col = hsv(Math.random(), 0.9, 1.0);
      } else if (useDual) {
        col = pickColor(Math.random() < 0.5 ? baseHue : dualHue, 0.05);
      } else {
        col = pickColor(baseHue, 0.10);
      }
      pr[i] = col[0]; pg[i] = col[1]; pb[i] = col[2];
      kind[i] = k;
      phase[i] = Math.random() * Math.PI * 2;
      drag[i] = dragV;
      grav[i] = gravV;
      spawned++;
    }
    return shape === 'ring' || shape === 'palm' ? 0.45 : 0.32;
  }

  function launchRocket() {
    for (let i = 0; i < ROCKETS; i++) {
      if (rklife[i] > 0) continue;
      rkx[i] = VW * (0.10 + Math.random() * 0.80);
      rky[i] = VH;
      rkvy[i] = -(110 + Math.random() * 35);
      rklife[i] = 1.4 + Math.random() * 0.4;
      rkhue[i] = Math.random();
      return;
    }
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

      // Decay trail buffer ~12% per frame for snappier sparkle tails.
      for (let i = 0; i < trail.length; i += 4) {
        trail[i]   = (trail[i]   * 224) >> 8;
        trail[i+1] = (trail[i+1] * 224) >> 8;
        trail[i+2] = (trail[i+2] * 224) >> 8;
      }
      // Flash decays exponentially.
      flashAmt *= Math.pow(0.02, dt);

      // Launch rockets steadily, and occasionally fire bursts directly in
      // the sky for variety (some "high altitude" shells).
      if (tt >= nextBurstAt) {
        if (Math.random() < 0.75) {
          launchRocket();
        } else {
          const cx = VW * (0.10 + Math.random() * 0.80);
          const cy = VH * (0.12 + Math.random() * 0.30);
          flashAmt = Math.max(flashAmt, emitBurst(cx, cy));
        }
        // Faster cadence + occasional double-tap salvos.
        nextBurstAt = tt + 0.18 + Math.random() * 0.45;
        if (Math.random() < 0.25) nextBurstAt = tt + 0.05;
      }

      // Update rockets: rising sparks that explode at apex.
      for (let i = 0; i < ROCKETS; i++) {
        if (rklife[i] <= 0) continue;
        rklife[i] -= dt;
        rkvy[i] += 35 * dt;          // gravity slows the climb
        rky[i]  += rkvy[i] * dt;
        // Paint rising trail (warm white spark + faint color tail).
        const col = hsv(rkhue[i], 0.7, 1.0);
        additivePixel(rkx[i],     rky[i],     255, 240, 200);
        additivePixel(rkx[i] + (Math.random() - 0.5) * 2, rky[i] + 1, col[0] >> 1, col[1] >> 1, col[2] >> 1);
        additivePixel(rkx[i],     rky[i] + 2, col[0] >> 2, col[1] >> 2, col[2] >> 2);
        // Explode at apex (vy ~ 0) or end of life.
        if (rkvy[i] >= -8 || rklife[i] <= 0) {
          flashAmt = Math.max(flashAmt, emitBurst(rkx[i], rky[i]));
          rklife[i] = 0;
        }
      }

      // Integrate + paint particles.
      const baseGravity = 60;
      for (let i = 0; i < N; i++) {
        if (life[i] <= 0) continue;
        const k = kind[i];
        // Per-kind drag / gravity.
        const d = Math.pow(drag[i], dt);
        vx[i] *= d;
        vy[i] *= d;
        vy[i] += baseGravity * grav[i] * dt;
        px[i] += vx[i] * dt;
        py[i] += vy[i] * dt;
        life[i] -= dt;

        const lk = Math.max(0, life[i] / maxLife[i]); // 1..0
        // Twinkle: cosine modulation around brightness 1.
        const tw = 0.65 + 0.45 * Math.cos(tt * 22 + phase[i]);
        // Color easing: punchy mid-life, dim at the end.
        const ease = Math.pow(lk, 0.55);
        const r = Math.min(255, pr[i] * ease * tw) | 0;
        const g = Math.min(255, pg[i] * ease * tw) | 0;
        const b = Math.min(255, pb[i] * ease * tw) | 0;
        additivePixel(px[i],     py[i],     r, g, b);

        // Bright sparkle cross arms (white).
        const arm = (ease * tw * 160) | 0;
        additivePixel(px[i] + 1, py[i],     arm, arm, arm);
        additivePixel(px[i] - 1, py[i],     arm, arm, arm);
        additivePixel(px[i],     py[i] + 1, arm, arm, arm);
        additivePixel(px[i],     py[i] - 1, arm, arm, arm);

        // Kind-specific extras.
        if (k === 1) {
          // Willow: drip extra trailing embers behind the particle.
          const tr = (ease * 90) | 0;
          additivePixel(px[i] - vx[i] * dt * 1.5, py[i] - vy[i] * dt * 1.5,
                        (r * 0.6) | 0, (g * 0.4) | 0, (b * 0.2) | 0);
          additivePixel(px[i], py[i] + 2, tr, (tr * 0.7) | 0, (tr * 0.3) | 0);
        } else if (k === 2) {
          // Palm: thick streamer along motion direction.
          additivePixel(px[i] - vx[i] * dt, py[i] - vy[i] * dt, r, (g * 0.8) | 0, (b * 0.4) | 0);
          additivePixel(px[i] - vx[i] * dt * 2, py[i] - vy[i] * dt * 2, (r * 0.5) | 0, (g * 0.4) | 0, (b * 0.2) | 0);
        } else if (k === 3) {
          // Crackle: occasional bright white pop.
          if (lk < 0.55 && Math.random() < 0.18) {
            additivePixel(px[i] + (Math.random() - 0.5) * 4,
                          py[i] + (Math.random() - 0.5) * 4,
                          255, 255, 220);
          }
        }
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
      gl.uniform1f(uFlash, Math.min(0.35, flashAmt));
      drawQuad(gl);
    },
    dispose(gl) {
      gl.deleteProgram(prog);
      gl.deleteTexture(tex);
    },
  };
}
