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
  // Vertical night-sky gradient: darker at the zenith, slightly warmer
  // near the horizon. rd.y > 0 means looking up at sky.
  float t = clamp(rd.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = mix(vec3(0.10, 0.12, 0.28), vec3(0.03, 0.04, 0.10), t);
  // Stars: spherical mapping of the ray direction onto a stable 2D star
  // field, so they don't slide with camera motion in a weird grid pattern.
  if (rd.y > 0.02) {
    vec2 sp = vec2(atan(rd.x, rd.z), rd.y);
    vec2 g  = sp * vec2(40.0, 60.0);
    vec2 gi = floor(g);
    vec2 gf = fract(g) - 0.5;
    float r = hash(gi);
    // Only ~3% of cells get a star.
    float on = step(0.97, r);
    // Star sits at a sub-cell offset so they don't grid-align.
    vec2 off = (vec2(hash(gi + 7.7), hash(gi + 3.3)) - 0.5) * 0.7;
    float d  = length(gf - off);
    float core = smoothstep(0.06, 0.0, d) * on;
    // Subtle twinkle.
    float tw = 0.6 + 0.4 * sin(u_time * 2.5 + r * 30.0);
    col += vec3(0.95, 0.97, 1.0) * core * tw;
    // Sparse big stars on a coarser grid.
    vec2 gB  = sp * vec2(14.0, 22.0);
    vec2 giB = floor(gB);
    vec2 gfB = fract(gB) - 0.5;
    float rB = hash(giB + 1.3);
    float onB = step(0.985, rB);
    float dB  = length(gfB);
    float coreB = smoothstep(0.12, 0.0, dB) * onB;
    col += vec3(1.0, 0.95, 0.85) * coreB * (0.7 + 0.3 * sin(u_time * 1.7 + rB * 20.0));
  }
  // Full moon: a soft, slightly textured disc with a warm halo.
  vec2 mp = (v_uv - moonNDC) * vec2(u_res.x / u_res.y, 1.0);
  float mr = length(mp);
  float disc = smoothstep(0.075, 0.065, mr);
  float rim  = smoothstep(0.080, 0.072, mr) - smoothstep(0.072, 0.065, mr);
  // Faint maria texture so it doesn't read as a flat circle.
  float maria = vnoise(mp * 60.0) * 0.15 + vnoise(mp * 25.0) * 0.10;
  vec3 moonCol = vec3(0.98, 0.96, 0.88) - vec3(maria) * disc;
  col = mix(col, moonCol, disc);
  col += vec3(1.0, 0.95, 0.80) * rim * 0.6;
  // Wide soft halo.
  float halo = smoothstep(0.30, 0.075, mr);
  col += vec3(0.55, 0.62, 0.80) * halo * halo * 0.18;
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

// Tiny Santa+sleigh silhouette in screen space, drawn as the union of a
// few analytic shapes. The whole sprite spans ~0.25 in NDC width.
// Reindeer lead on +x (sleigh flies left-to-right toward the moon).
float santaShape(vec2 q) {
  float a = 0.0;
  // Three reindeer in front, each with a tiny gallop bob and short antlers.
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float bob = sin(u_time * 9.0 + fi * 1.7) * 0.007;
    vec2 rp = q - vec2(0.040 + fi * 0.055, bob);
    a = max(a, smoothstep(0.026, 0.020, length(rp * vec2(0.55, 1.5))));
    vec2 hp = rp - vec2(0.022, -0.008);
    a = max(a, smoothstep(0.013, 0.009, length(hp * vec2(0.9, 1.2))));
    float ant = step(-0.034, hp.y) * step(hp.y, -0.014) * step(abs(hp.x - 0.003), 0.014);
    a = max(a, ant * 0.75);
  }
  // Sleigh body and upturned rear runner.
  vec2 sp = q - vec2(-0.070, 0.006);
  a = max(a, smoothstep(0.038, 0.030, length(sp * vec2(0.5, 1.5))));
  vec2 rp2 = q - vec2(-0.108, -0.010);
  a = max(a, smoothstep(0.012, 0.009, length(rp2 * vec2(0.9, 1.1))));
  // Santa dome + hat tip.
  vec2 stp = q - vec2(-0.058, -0.030);
  a = max(a, smoothstep(0.020, 0.015, length(stp * vec2(0.7, 1.0))));
  vec2 htp = q - vec2(-0.074, -0.052);
  a = max(a, smoothstep(0.010, 0.007, length(htp * vec2(1.5, 1.0))));
  // Reins.
  float lineDist = abs(q.y + 0.002 - q.x * 0.05);
  float rein = smoothstep(0.0025, 0.0012, lineDist) * step(-0.060, q.x) * step(q.x, 0.135);
  a = max(a, rein * 0.45);
  return clamp(a, 0.0, 1.0);
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

  // Flying Santa+sleigh silhouetted against the night sky and moon.
  // Path runs lower-left -> upper-right, passing through the moon at
  // about t=0.6 of the cycle. Camera advances +Z, so the diagonal motion
  // visually tracks "with" the ground sliding past while heading toward
  // the moon in the upper right.
  float sCycle = mod(u_time + 2.0, 16.0) / 16.0;
  vec2 sPos = mix(vec2(-0.30, 0.85), vec2(1.30, -0.30), sCycle);
  sPos.y += sin(u_time * 1.6) * 0.008;
  vec2 sq = (v_uv - sPos) * vec2(u_res.x / u_res.y, 1.0);
  float sA = santaShape(sq);
  col = mix(col, vec3(0.02, 0.02, 0.04), sA);

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
