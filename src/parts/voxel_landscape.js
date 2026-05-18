// Voxel landscape: fragment-shader terrain raymarcher. Pure-shader render
// of an infinite snowy fBm heightfield under a moonlit night sky. Uses the
// classic Comanche-style approach but evaluated per-pixel on the GPU so we
// get proper detail at 320x256.
import { createProgram, VS_FULLSCREEN, VW, VH } from '../gl/context.js';
import { drawQuad } from '../gl/quad.js';
import { bindFBO } from '../gl/framebuffer.js';

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform float u_time;
uniform vec2 u_res;

// --- noise --------------------------------------------------------------

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    v += amp * vnoise(p);
    p *= 2.03;
    amp *= 0.5;
  }
  return v;
}

// Terrain height in world units.
float terrain(vec2 p) {
  float h = fbm(p * 0.04);
  // Ridge-style sharpening for mountain spines.
  float ridge = 1.0 - abs(fbm(p * 0.10 + 13.0) - 0.5) * 2.0;
  h = h * 0.75 + ridge * 0.25;
  // Map to world height range with a slight gamma to push valleys down.
  return pow(clamp(h, 0.0, 1.0), 1.4) * 110.0;
}

vec3 skyColor(vec3 rd, vec2 moonNDC) {
  // Vertical night-sky gradient.
  float t = clamp(rd.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = mix(vec3(0.03, 0.04, 0.10), vec3(0.10, 0.12, 0.28), t);
  // Stars (only above the horizon).
  if (rd.y > 0.0) {
    vec2 sp = rd.xz / max(0.05, rd.y) * 4.0;
    float s = step(0.992, hash(floor(sp * 40.0)));
    col += vec3(s) * (0.8 + 0.2 * sin(u_time * 3.0 + hash(floor(sp * 40.0)) * 30.0));
  }
  // Moon disc.
  float moon = smoothstep(0.06, 0.05, length(v_uv - moonNDC));
  float halo = smoothstep(0.18, 0.06, length(v_uv - moonNDC));
  col += vec3(1.0, 0.97, 0.85) * moon;
  col += vec3(0.4, 0.45, 0.55) * halo * 0.35;
  return col;
}

// Terrain shading at hit point.
vec3 terrainColor(vec3 p) {
  float h = p.y;
  // Stratified Christmas-night palette.
  vec3 valley  = vec3(0.08, 0.12, 0.25);
  vec3 pine    = vec3(0.12, 0.32, 0.18);
  vec3 grass   = vec3(0.30, 0.45, 0.22);
  vec3 rock    = vec3(0.55, 0.55, 0.50);
  vec3 snow    = vec3(0.95, 0.97, 1.00);
  vec3 col = valley;
  col = mix(col, pine,  smoothstep(15.0, 35.0, h));
  col = mix(col, grass, smoothstep(35.0, 55.0, h));
  col = mix(col, rock,  smoothstep(55.0, 75.0, h));
  col = mix(col, snow,  smoothstep(75.0, 95.0, h));
  // Normal estimate via finite differences for shading.
  vec2 e = vec2(1.0, 0.0);
  float hL = terrain(p.xz - e.xy);
  float hR = terrain(p.xz + e.xy);
  float hD = terrain(p.xz - e.yx);
  float hU = terrain(p.xz + e.yx);
  vec3 n = normalize(vec3(hL - hR, 2.0, hD - hU));
  // Moonlight comes from upper-right.
  vec3 lightDir = normalize(vec3(0.55, 0.75, -0.35));
  float diff = clamp(dot(n, lightDir), 0.0, 1.0);
  vec3 lit = col * (0.35 + 0.85 * diff);
  // Cool ambient bounce from snow.
  lit += col * vec3(0.05, 0.07, 0.10);
  return lit;
}

void main() {
  // Blit flips Y (v_uv.y=0 ends up at the top of the displayed image);
  // mirror that here so "up" in my ray math matches what the user sees.
  vec2 uv = v_uv * 2.0 - 1.0;
  uv.y = -uv.y;
  uv.x *= u_res.x / u_res.y;

  // Camera flies low over the landscape with a gentle S-curve.
  float t = u_time;
  vec3 ro = vec3(sin(t * 0.18) * 30.0, 130.0 + sin(t * 0.25) * 6.0, t * 22.0);
  float yaw = sin(t * 0.12) * 0.15;
  // Look slightly down toward the horizon.
  vec3 fwd  = normalize(vec3(sin(yaw), -0.18, cos(yaw)));
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
  vec3 up    = cross(fwd, right);
  vec3 rd    = normalize(fwd + right * uv.x * 0.9 + up * uv.y * 0.7);

  // Raymarch the heightfield. Step sizes grow with distance for cheap-but
  // -correct coverage; refine at the crossing.
  float tHit = -1.0;
  float dt = 0.6;
  float dist = 1.0;
  float prev = ro.y - terrain(ro.xz);
  for (int i = 0; i < 220; i++) {
    vec3 p = ro + rd * dist;
    float diff = p.y - terrain(p.xz);
    if (diff < 0.0) {
      // Linear refine between prev and this step.
      tHit = dist - dt * diff / (diff - prev);
      break;
    }
    prev = diff;
    dist += dt;
    dt *= 1.012;
    if (dist > 1200.0) break;
  }

  vec2 moonNDC = vec2(0.78, 0.14);
  vec3 col;
  if (tHit > 0.0) {
    vec3 hit = ro + rd * tHit;
    col = terrainColor(hit);
    // Distance fog blends to sky.
    float fog = 1.0 - exp(-tHit * 0.0035);
    vec3 sky = skyColor(rd, moonNDC);
    col = mix(col, sky, fog);
  } else {
    col = skyColor(rd, moonNDC);
  }

  // Vignette + subtle scanlines.
  vec2 c = v_uv - 0.5;
  col *= mix(0.55, 1.0, 1.0 - smoothstep(0.55, 0.95, length(c)));
  float scan = 0.92 + 0.08 * sin(v_uv.y * u_res.y * 3.14159);
  col *= scan;

  outColor = vec4(col, 1.0);
}
`;

export function voxel_landscape(gl) {
  const prog = createProgram(gl, VS_FULLSCREEN, FS);
  const uTime = gl.getUniformLocation(prog, 'u_time');
  const uRes  = gl.getUniformLocation(prog, 'u_res');
  let startMs = -1;

  return {
    render(gl, t, fbo) {
      if (startMs < 0) startMs = t;
      const tt = (t - startMs) / 1000;
      bindFBO(gl, fbo);
      gl.useProgram(prog);
      gl.uniform1f(uTime, tt);
      gl.uniform2f(uRes, VW, VH);
      drawQuad(gl);
    },
    dispose(gl) {
      gl.deleteProgram(prog);
    },
  };
}
