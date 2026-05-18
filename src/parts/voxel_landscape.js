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
uniform vec2 u_santaOffset;

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
  vec3 cheekCol   = vec3(0.98, 0.55, 0.50);
  vec3 mittenCol  = vec3(0.10, 0.08, 0.08);
  vec3 ribbonCol  = vec3(0.95, 0.90, 0.30);

  vec3 col = vec3(0.0);
  float a = 0.0;

  // Reins: two thin lines from sleigh stretching up toward the team, then
  // forward toward Rudolph (the lead reindeer).
  for (int s = 0; s < 2; s++) {
    float sx = (float(s) - 0.5) * 2.0 * 0.020;
    float line = step(abs(q.x - sx), 0.0022) * step(-0.115, q.y) * step(q.y, 0.030);
    if (line > 0.0) { col = reinCol; a = max(a, line * 0.85); }
  }
  // Center rein leading to Rudolph up front.
  {
    float lead = step(abs(q.x), 0.0022) * step(-0.180, q.y) * step(q.y, -0.105);
    if (lead > 0.0) { col = reinCol; a = max(a, lead * 0.85); }
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

      // Two tiny black eyes on the head.
      for (int e = 0; e < 2; e++) {
        float ex = (float(e) - 0.5) * 2.0 * r * 0.22;
        float eye = smoothstep(r * 0.07, r * 0.03, length(hp - vec2(ex, -r * 0.05)));
        if (eye > 0.0) col = mix(col, reinCol, eye);
      }

      // Harness collar with a tiny gold bell hanging beneath the head.
      vec2 cp = rp - vec2(0.0, -r * 0.55);
      float collar = step(abs(cp.y), r * 0.06) * step(abs(cp.x), r * 0.55);
      if (collar > 0.0) col = mix(col, sleighCol, collar);
      float bell = smoothstep(r * 0.10, r * 0.05, length(cp - vec2(0.0, r * 0.10)));
      if (bell > 0.0) { col = mix(col, buckle, bell); a = max(a, bell); }

      // Forked antlers: two diagonal branches forming a V above the head,
      // plus a small inner branch for a bushier silhouette.
      for (int b = 0; b < 2; b++) {
        float dir = float(b) * 2.0 - 1.0;
        vec2 ap = rp - vec2(0.0, -r * 1.05);
        float branch = step(abs(ap.x + dir * ap.y * 0.55), r * 0.09)
                     * step(-antH, ap.y) * step(ap.y, 0.0);
        if (branch > 0.0) { col = mix(col, antlerCol, branch); a = max(a, branch * 0.95); }
        // Small inner fork.
        float inner = step(abs(ap.x + dir * (ap.y + antH * 0.45) * 1.10), r * 0.07)
                    * step(-antH * 0.55, ap.y) * step(ap.y, -antH * 0.20);
        if (inner > 0.0) { col = mix(col, antlerCol, inner); a = max(a, inner * 0.9); }
      }
    }
  }

  // Rudolph: lead reindeer up front, centered, with a big glowing red nose.
  {
    float persp = 1.0 - 3.0 * 0.22;            // matches "row 3" perspective
    float yRow  = -0.025 - 3.0 * 0.047;
    float r     = 0.014 * persp;
    float antH  = 0.028 * persp;
    float bob   = sin(u_time * 8.0 + 3.9) * 0.004 * persp;
    vec2 rp = q - vec2(0.0, yRow + bob);

    // Body.
    float body = smoothstep(r, r * 0.78, length(rp * vec2(1.3, 1.0)));
    if (body > 0.0) { col = mix(col, deerCol, body); a = max(a, body); }
    vec2 bep = rp - vec2(0.0, r * 0.45);
    float belly = smoothstep(r * 0.55, r * 0.35, length(bep * vec2(1.7, 1.3)));
    if (belly > 0.0) col = mix(col, deerBelly, belly * 0.75);

    // Head.
    vec2 hp = rp - vec2(0.0, -r * 0.95);
    float head = smoothstep(r * 0.60, r * 0.42, length(hp * vec2(1.2, 1.0)));
    if (head > 0.0) { col = mix(col, deerCol, head); a = max(a, head); }

    // Eyes.
    for (int e = 0; e < 2; e++) {
      float ex = (float(e) - 0.5) * 2.0 * r * 0.24;
      float eye = smoothstep(r * 0.08, r * 0.035, length(hp - vec2(ex, -r * 0.08)));
      if (eye > 0.0) col = mix(col, reinCol, eye);
    }

    // Harness collar + bell.
    vec2 cp = rp - vec2(0.0, -r * 0.55);
    float collar = step(abs(cp.y), r * 0.07) * step(abs(cp.x), r * 0.60);
    if (collar > 0.0) col = mix(col, sleighCol, collar);
    float bell = smoothstep(r * 0.12, r * 0.05, length(cp - vec2(0.0, r * 0.11)));
    if (bell > 0.0) { col = mix(col, buckle, bell); a = max(a, bell); }

    // Antlers (bushier).
    for (int b = 0; b < 2; b++) {
      float dir = float(b) * 2.0 - 1.0;
      vec2 ap = rp - vec2(0.0, -r * 1.10);
      float branch = step(abs(ap.x + dir * ap.y * 0.55), r * 0.10)
                   * step(-antH * 1.15, ap.y) * step(ap.y, 0.0);
      if (branch > 0.0) { col = mix(col, antlerCol, branch); a = max(a, branch * 0.95); }
      float inner = step(abs(ap.x + dir * (ap.y + antH * 0.55) * 1.10), r * 0.08)
                  * step(-antH * 0.65, ap.y) * step(ap.y, -antH * 0.20);
      if (inner > 0.0) { col = mix(col, antlerCol, inner); a = max(a, inner * 0.9); }
    }

    // Big glowing red nose with halo. The halo brightens with a slow sine
    // so it really sells the "glow".
    float pulse = 0.85 + 0.15 * sin(u_time * 5.5);
    vec2 np = hp - vec2(0.0, -r * 0.32);
    // Outer halo (additive feel via mix with bright red).
    float halo = smoothstep(r * 0.70, r * 0.25, length(np)) * 0.55 * pulse;
    if (halo > 0.0) { col = mix(col, noseRed * 1.05, halo); a = max(a, halo * 0.7); }
    // Inner bright core.
    float nose = smoothstep(r * 0.30, r * 0.16, length(np));
    if (nose > 0.0) { col = mix(col, vec3(1.0, 0.55, 0.45) * pulse, nose); a = max(a, nose); }
    // Tiny white highlight on the nose for "shiny".
    float hi = smoothstep(r * 0.10, r * 0.04, length(np - vec2(-r * 0.08, -r * 0.08)));
    if (hi > 0.0) col = mix(col, vec3(1.0, 0.95, 0.90), hi * 0.9);
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

  // Decorative gold star on the side of the sleigh (back-right corner).
  vec2 starP = q - vec2(0.026, 0.050);
  float starR = length(starP);
  float starA = atan(starP.y, starP.x);
  float starShape = starR < 0.012
    ? smoothstep(0.012 + sin(starA * 5.0) * 0.004, 0.004, starR) : 0.0;
  if (starShape > 0.0) col = mix(col, sleighTrim, starShape);

  // A second little star mirrored on the left.
  vec2 starP2 = q - vec2(-0.026, 0.050);
  float starR2 = length(starP2);
  float starA2 = atan(starP2.y, starP2.x);
  float starShape2 = starR2 < 0.012
    ? smoothstep(0.012 + sin(starA2 * 5.0) * 0.004, 0.004, starR2) : 0.0;
  if (starShape2 > 0.0) col = mix(col, sleighTrim, starShape2);

  // Gift sack peeking out the back of the sleigh.
  vec2 sk = q - vec2(-0.030, 0.030);
  float sack = smoothstep(0.017, 0.011, length(sk * vec2(1.0, 1.2)));
  if (sack > 0.0) { col = mix(col, sackCol, sack); a = max(a, sack); }
  // Golden ribbon tied around the sack.
  float ribbonBand = step(abs(sk.y), 0.0022) * step(abs(sk.x), 0.014);
  if (ribbonBand > 0.0) col = mix(col, ribbonCol, ribbonBand);
  float ribbonKnot = smoothstep(0.005, 0.002, length(sk - vec2(0.0, -0.001)));
  if (ribbonKnot > 0.0) col = mix(col, ribbonCol, ribbonKnot);

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

  // Santa's mittens gripping the reins (two black blobs at the sides).
  for (int m = 0; m < 2; m++) {
    float mx = (float(m) - 0.5) * 2.0 * 0.020;
    vec2 mp = q - vec2(mx, -0.005);
    float mit = smoothstep(0.006, 0.0035, length(mp * vec2(1.0, 1.2)));
    if (mit > 0.0) { col = mix(col, mittenCol, mit); a = max(a, mit); }
  }

  // White fur trim along the bottom of the coat.
  float bottomFur = step(abs(stp.y - 0.020), 0.0032) * step(abs(stp.x), 0.022);
  if (bottomFur > 0.0) { col = mix(col, fur, bottomFur); a = max(a, bottomFur); }

  // Face (skin tone) above the coat collar.
  vec2 fp = q - vec2(0.0, -0.005);
  float face = smoothstep(0.012, 0.008, length(fp * vec2(1.0, 1.1)));
  if (face > 0.0) { col = mix(col, skin, face); a = max(a, face); }

  // Rosy cheeks: two soft pink dots on the face.
  for (int ch = 0; ch < 2; ch++) {
    float cx = (float(ch) - 0.5) * 2.0 * 0.005;
    float cheek = smoothstep(0.0030, 0.0014, length(fp - vec2(cx, 0.0)));
    if (cheek > 0.0) col = mix(col, cheekCol, cheek * 0.85);
  }
  // Tiny black eyes on Santa.
  for (int se = 0; se < 2; se++) {
    float sex = (float(se) - 0.5) * 2.0 * 0.0035;
    float seye = smoothstep(0.0014, 0.0006, length(fp - vec2(sex, -0.003)));
    if (seye > 0.0) col = mix(col, reinCol, seye);
  }

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
  sPos += u_santaOffset;
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
  const uSantaOffset = gl.getUniformLocation(prog, 'u_santaOffset');
  let startMs = -1;
  let lastMs = -1;

  // Player-controlled Santa offset (uv space). Arrow keys nudge sPos so the
  // viewer can steer Santa around the scene while the loop animation runs.
  const keys = { ArrowLeft: false, ArrowRight: false, ArrowUp: false, ArrowDown: false };
  let ox = 0, oy = 0;
  const SPEED = 0.4; // uv units per second
  const MAX = 0.45;
  const onKeyDown = (e) => {
    if (e.code in keys) { keys[e.code] = true; e.preventDefault(); }
  };
  const onKeyUp = (e) => {
    if (e.code in keys) { keys[e.code] = false; e.preventDefault(); }
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  return {
    render(gl, t, fbo) {
      if (startMs < 0) { startMs = t; lastMs = t; }
      const dt = Math.max(0, Math.min(0.1, (t - lastMs) / 1000));
      lastMs = t;
      const tt = (t - startMs) / 1000;
      let dx = 0, dy = 0;
      if (keys.ArrowLeft)  dx -= 1;
      if (keys.ArrowRight) dx += 1;
      if (keys.ArrowUp)    dy -= 1; // uv y grows downward in our convention
      if (keys.ArrowDown)  dy += 1;
      ox = Math.max(-MAX, Math.min(MAX, ox + dx * SPEED * dt));
      oy = Math.max(-MAX, Math.min(MAX, oy + dy * SPEED * dt));
      bindFBO(gl, fbo);
      gl.useProgram(prog);
      gl.uniform1f(uTime, tt);
      gl.uniform2f(uRes, VW, VH);
      gl.uniform2f(uSantaOffset, ox, oy);
      drawQuad(gl);
    },
    dispose(gl) {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      gl.deleteProgram(prog);
    },
  };
}
