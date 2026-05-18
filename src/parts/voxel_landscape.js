// Voxel landscape: Comanche-style columnar voxel raycaster over an infinite
// snowy fBm heightmap. The camera glides forward with a slight S-curve.
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
  // Gentle vignette + scanlines.
  vec2 c = v_uv - 0.5;
  col *= mix(0.6, 1.0, 1.0 - smoothstep(0.55, 0.95, length(c)));
  float scan = 0.92 + 0.08 * sin(v_uv.y * float(${VH}) * 3.14159);
  col *= scan;
  outColor = vec4(col, 1.0);
}
`;

const MAP = 256;
const MAP_MASK = MAP - 1;

function buildHeightmap() {
  // Value-noise fBm into a Uint8Array.
  const h = new Uint8Array(MAP * MAP);
  // Permutation seeded.
  const rand = new Uint8Array(MAP * MAP);
  let seed = 1337;
  function rng() { seed = (seed * 1664525 + 1013904223) | 0; return ((seed >>> 0) & 0xff); }
  for (let i = 0; i < rand.length; i++) rand[i] = rng();
  function sample(x, y) { return rand[((y & MAP_MASK) * MAP) + (x & MAP_MASK)] / 255; }
  function smooth(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const a = sample(xi,   yi  );
    const b = sample(xi+1, yi  );
    const c = sample(xi,   yi+1);
    const d = sample(xi+1, yi+1);
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    return a * (1-u) * (1-v) + b * u * (1-v) + c * (1-u) * v + d * u * v;
  }
  for (let y = 0; y < MAP; y++) {
    for (let x = 0; x < MAP; x++) {
      let amp = 1, freq = 1 / 64, sum = 0, norm = 0;
      for (let o = 0; o < 5; o++) {
        sum += smooth(x * freq, y * freq) * amp;
        norm += amp;
        amp *= 0.5;
        freq *= 2;
      }
      const v = sum / norm;
      // Pinch the low end so valleys stay flat (snowy floor look).
      h[y * MAP + x] = Math.min(255, Math.max(0, ((v * 255) | 0)));
    }
  }
  return h;
}

function colorFor(h) {
  // Returns [r,g,b]. h in 0..255. Punched-up Christmas-night palette.
  if (h < 50)  return [20, 40, 90];                // deep valley shadow
  if (h < 90)  return [40, 110, 60];               // saturated pine
  if (h < 130) return [150, 150, 130];             // rocky slope
  if (h < 170) return [220, 230, 240];             // snow line
  return [255, 255, 255];                          // peak
}

export function voxel_landscape(gl) {
  const prog = createProgram(gl, VS_FULLSCREEN, FS);
  const uTex = gl.getUniformLocation(prog, 'u_tex');

  const buf = new Uint8Array(VW * VH * 4);
  const heightmap = buildHeightmap();
  const colormap = new Uint8Array(MAP * MAP * 3);
  for (let i = 0; i < MAP * MAP; i++) {
    const c = colorFor(heightmap[i]);
    colormap[i*3] = c[0]; colormap[i*3+1] = c[1]; colormap[i*3+2] = c[2];
  }

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, VW, VH, 0, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // Per-column y-buffer (lowest screen y already drawn, top-down origin).
  const yBuf = new Int32Array(VW);
  // Sky gradient lookup.
  const sky = new Uint8Array(VH * 3);
  for (let y = 0; y < VH; y++) {
    const t = y / VH;
    sky[y*3]   = (10 + t * 20) | 0;
    sky[y*3+1] = (16 + t * 14) | 0;
    sky[y*3+2] = (40 + t * 60) | 0;
  }
  // Moon.
  const moonX = VW - 50, moonY = 36, moonR = 14;

  let tt = 0, lastT = 0;

  return {
    render(gl, t, fbo) {
      const dt = lastT === 0 ? 0.016 : Math.min(0.05, (t - lastT) / 1000);
      lastT = t;
      tt += dt;

      // Fill sky.
      for (let y = 0; y < VH; y++) {
        const r = sky[y*3], g = sky[y*3+1], b = sky[y*3+2];
        for (let x = 0; x < VW; x++) {
          const j = (y * VW + x) * 4;
          buf[j] = r; buf[j+1] = g; buf[j+2] = b; buf[j+3] = 255;
        }
      }
      // Moon as a circle in the sky band.
      for (let dy = -moonR - 5; dy <= moonR + 5; dy++) {
        for (let dx = -moonR - 5; dx <= moonR + 5; dx++) {
          const xx = moonX + dx, yy = moonY + dy;
          if (xx < 0 || xx >= VW || yy < 0 || yy >= VH) continue;
          const d = Math.sqrt(dx*dx + dy*dy);
          const j = (yy * VW + xx) * 4;
          if (d <= moonR) {
            buf[j] = 245; buf[j+1] = 240; buf[j+2] = 210;
          } else if (d <= moonR + 5) {
            const k = 1 - (d - moonR) / 5;
            buf[j]   = Math.min(255, buf[j]   + (40 * k) | 0);
            buf[j+1] = Math.min(255, buf[j+1] + (35 * k) | 0);
            buf[j+2] = Math.min(255, buf[j+2] + (25 * k) | 0);
          }
        }
      }

      // Camera. Moves forward in z with a slight S-curve in x.
      const camZ = tt * 22.0;
      const camX = Math.sin(tt * 0.25) * 18.0;
      const camAng = Math.sin(tt * 0.18) * 0.20;
      const cosA = Math.cos(camAng), sinA = Math.sin(camAng);
      const camH = 60;
      const horizon = VH * 0.55;
      const scaleHeight = 140;

      for (let x = 0; x < VW; x++) yBuf[x] = VH;

      // March from near to far.
      const zNear = 1.0, zFar = 200.0;
      let z = zNear, dz = 0.5;
      const halfW = VW * 0.5;
      while (z < zFar) {
        // Frustum edges at distance z (FOV ~60deg).
        const half = z * 0.9;
        const leftX  = -half, leftZ = z;
        const rightX =  half, rightZ = z;
        // Rotate by cam angle and add cam pos.
        const lx = camX + leftX  * cosA - leftZ  * sinA;
        const lz = camZ + leftX  * sinA + leftZ  * cosA;
        const rx = camX + rightX * cosA - rightZ * sinA;
        const rz = camZ + rightX * sinA + rightZ * cosA;
        const stepX = (rx - lx) / VW;
        const stepZ = (rz - lz) / VW;
        let sx = lx, sz = lz;
        const invZ = scaleHeight / z;
        const fog = Math.min(1, Math.max(0, (z - 50) / 150));
        for (let x = 0; x < VW; x++) {
          const mx = sx | 0, my = sz | 0;
          const hi = heightmap[((my & MAP_MASK) * MAP) + (mx & MAP_MASK)];
          const screenY = ((camH - hi) * invZ + horizon) | 0;
          if (screenY < yBuf[x]) {
            const cIdx = ((my & MAP_MASK) * MAP + (mx & MAP_MASK)) * 3;
            let cr = colormap[cIdx], cg = colormap[cIdx+1], cb = colormap[cIdx+2];
            // Fog blend.
            const skyIdx = Math.min(VH - 1, Math.max(0, screenY));
            const sr = sky[skyIdx*3], sg = sky[skyIdx*3+1], sb = sky[skyIdx*3+2];
            cr = (cr * (1 - fog) + sr * fog) | 0;
            cg = (cg * (1 - fog) + sg * fog) | 0;
            cb = (cb * (1 - fog) + sb * fog) | 0;
            const top = Math.max(0, screenY);
            const bottom = yBuf[x];
            for (let y = top; y < bottom; y++) {
              const j = (y * VW + x) * 4;
              buf[j] = cr; buf[j+1] = cg; buf[j+2] = cb; buf[j+3] = 255;
            }
            yBuf[x] = top;
          }
          sx += stepX;
          sz += stepZ;
        }
        z += dz;
        dz *= 1.005;
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
