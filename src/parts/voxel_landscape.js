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

// Santa+sleigh seen from behind, drawn as the union of a few analytic
// shapes with per-shape colors so he reads as Santa in red coat, brown
// reindeer with tan antlers, dark-red sleigh.
// q is local aspect-corrected coords with (0,0) at the back of the
// sleigh. y < 0 = further away (forward in scene), y > 0 = closer to us.
vec4 santaSprite(vec2 q) {
  vec3 sleighCol  = vec3(0.40, 0.10, 0.08);
  vec3 sleighTrim = vec3(0.88, 0.72, 0.22);
  vec3 coatCol    = vec3(0.82, 0.14, 0.16);
  vec3 fur        = vec3(0.96, 0.96, 0.98);
  vec3 skin       = vec3(0.95, 0.78, 0.60);
  vec3 belt       = vec3(0.08, 0.06, 0.05);
  vec3 buckle     = vec3(0.92, 0.78, 0.20);
  vec3 deerCol    = vec3(0.34, 0.20, 0.11);
  vec3 deerBelly  = vec3(0.52, 0.36, 0.22);
  vec3 antlerCol  = vec3(0.62, 0.45, 0.28);
  vec3 reinCol    = vec3(0.10, 0.06, 0.04);
  vec3 noseRed    = vec3(0.98, 0.20, 0.16);
  vec3 sackCol    = vec3(0.45, 0.32, 0.18);

  vec3 col = vec3(0.0);
  float a = 0.0;

  // Reins: two thin lines from sleigh stretching up toward the team.
  for (int s = 0; s < 2; s++) {
    float sx = (float(s) - 0.5) * 2.0 * 0.020;
    float line = step(abs(q.x - sx), 0.0022) * step(-0.115, q.y) * step(q.y, 0.030);
    if (line > 0.0) { col = reinCol; a = max(a, line * 0.85); }
  }

  // Reindeer team: 3 rows of 2, far rows drawn first so near rows overdraw.
  for (int i = 2; i >= 0; i--) {
    float fi = float(i);
    float persp = 1.0 - fi * 0.22;
    float yRow  = -0.025 - fi * 0.047;
    float xSep  = 0.030 * persp;
    float r     = 0.014 * persp;
    float antH  = 0.028 * persp;
    for (int s = 0; s < 2; s++) {
      float sx  = (float(s) - 0.5) * 2.0 * xSep;
      float bob = sin(u_time * 8.0 + fi * 1.3 + float(s) * 0.7) * 0.004 * persp;
      vec2 rp = q - vec2(sx, yRow + bob);

      // Body oval (rear/rump view).
      float body = smoothstep(r, r * 0.78, length(rp * vec2(1.3, 1.0)));
      if (body > 0.0) { col = mix(col, deerCol, body); a = max(a, body); }

      // Lighter belly fur on the underside.
      vec2 bep = rp - vec2(0.0, r * 0.45);
      float belly = smoothstep(r * 0.55, r * 0.35, length(bep * vec2(1.7, 1.3)));
      if (belly > 0.0) col = mix(col, deerBelly, belly * 0.75);

      // Head peeking up above the body.
      vec2 hp = rp - vec2(0.0, -r * 0.95);
      float head = smoothstep(r * 0.55, r * 0.40, length(hp * vec2(1.2, 1.0)));
      if (head > 0.0) { col = mix(col, deerCol, head); a = max(a, head); }

      // Rudolph (front-row, left reindeer): glowing red nose.
      if (i == 0 && s == 0) {
        float nose = smoothstep(r * 0.18, r * 0.08, length(hp - vec2(0.0, -r * 0.20)));
        if (nose > 0.0) { col = mix(col, noseRed, nose); a = max(a, nose); }
      }

      // Forked antlers: two diagonal branches forming a V above the head.
      for (int b = 0; b < 2; b++) {
        float dir = float(b) * 2.0 - 1.0;
        vec2 ap = rp - vec2(0.0, -r * 1.05);
        float branch = step(abs(ap.x + dir * ap.y * 0.55), r * 0.09)
                     * step(-antH, ap.y) * step(ap.y, 0.0);
        if (branch > 0.0) { col = mix(col, antlerCol, branch); a = max(a, branch * 0.95); }
      }
    }
  }

  // Sleigh runners: thin rails below the hull with curled front tips.
  for (int s = 0; s < 2; s++) {
    float sx = (float(s) - 0.5) * 2.0 * 0.030;
    vec2 rp = q - vec2(sx, 0.072);
    float rail = step(abs(rp.y), 0.0028) * step(abs(rp.x), 0.034);
    if (rail > 0.0) { col = mix(col, sleighCol, rail); a = max(a, rail); }
    float tip = smoothstep(0.009, 0.005, length((q - vec2(sx + 0.030, 0.066)) * vec2(1.0, 1.4)));
    if (tip > 0.0) { col = mix(col, sleighCol, tip); a = max(a, tip); }
  }

  // Sleigh hull.
  vec2 sp = q - vec2(0.0, 0.045);
  float sleigh = smoothstep(0.052, 0.040, length(sp * vec2(0.70, 1.6)));
  if (sleigh > 0.0) { col = mix(col, sleighCol, sleigh); a = max(a, sleigh); }

  // Gold trim band along the top edge of the sleigh.
  float trim = step(abs(sp.y + 0.020), 0.0028) * step(abs(sp.x), 0.046);
  if (trim > 0.0) { col = mix(col, sleighTrim, trim); a = max(a, trim); }

  // Gift sack peeking out the back of the sleigh.
  vec2 sk = q - vec2(-0.030, 0.030);
  float sack = smoothstep(0.017, 0.011, length(sk * vec2(1.0, 1.2)));
  if (sack > 0.0) { col = mix(col, sackCol, sack); a = max(a, sack); }

  // Santa coat.
  vec2 stp = q - vec2(0.0, 0.015);
  float coat = smoothstep(0.026, 0.020, length(stp * vec2(0.9, 1.0)));
  if (coat > 0.0) { col = mix(col, coatCol, coat); a = max(a, coat); }

  // Black belt across the coat.
  float beltMask = step(abs(stp.y - 0.008), 0.0035) * step(abs(stp.x), 0.022);
  if (beltMask > 0.0) { col = mix(col, belt, beltMask); a = max(a, beltMask); }
  // Gold buckle in the middle of the belt.
  float buckleM = step(abs(stp.y - 0.008), 0.0035) * step(abs(stp.x), 0.0048);
  if (buckleM > 0.0) col = mix(col, buckle, buckleM);

  // White fur trim along the bottom of the coat.
  float bottomFur = step(abs(stp.y - 0.020), 0.0032) * step(abs(stp.x), 0.022);
  if (bottomFur > 0.0) { col = mix(col, fur, bottomFur); a = max(a, bottomFur); }

  // Face (skin tone) above the coat collar.
  vec2 fp = q - vec2(0.0, -0.005);
  float face = smoothstep(0.012, 0.008, length(fp * vec2(1.0, 1.1)));
  if (face > 0.0) { col = mix(col, skin, face); a = max(a, face); }

  // White beard wrapping the lower half of the face.
  vec2 bdp = q - vec2(0.0, 0.001);
  float beard = smoothstep(0.013, 0.008, length(bdp * vec2(1.15, 0.95)))
              * step(bdp.y, 0.001);
  if (beard > 0.0) { col = mix(col, fur, beard); a = max(a, beard); }

  // Hat body (red).
  vec2 htp = q - vec2(0.006, -0.018);
  float hat = smoothstep(0.014, 0.009, length(htp * vec2(1.3, 0.9)));
  if (hat > 0.0) { col = mix(col, coatCol, hat); a = max(a, hat); }

  // White fur band at the hat brim.
  float brim = step(abs(htp.y - 0.005), 0.0032) * step(abs(htp.x), 0.014);
  if (brim > 0.0) { col = mix(col, fur, brim); a = max(a, brim); }

  // White pom on top of the hat.
  vec2 pp = q - vec2(0.014, -0.028);
  float pom = smoothstep(0.006, 0.0038, length(pp));
  if (pom > 0.0) { col = mix(col, fur, pom); a = max(a, pom); }

  return vec4(col, clamp(a, 0.0, 1.0));
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

  // Flying Santa+sleigh seen from behind: starts close in the foreground,
  // shrinks as he flies away into the scene and ends up silhouetted right
  // on the moon, then loops.
  float sCycle = mod(u_time + 3.0, 18.0) / 18.0;
  vec2 sStart = vec2(0.50, 0.62);
  vec2 sEnd   = vec2(0.78, 0.16);
  vec2 sPos = mix(sStart, sEnd, sCycle);
  sPos.x += sin(u_time * 0.7) * 0.010;
  sPos.y += sin(u_time * 1.2) * 0.005;
  float sScale = mix(1.30, 0.28, sCycle);
  vec2 sq = (v_uv - sPos) * vec2(u_res.x / u_res.y, 1.0) / sScale;
  vec4 sv = santaSprite(sq);
  col = mix(col, sv.rgb, sv.a);

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
