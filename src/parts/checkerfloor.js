// Pseudo-3D scrolling checkerboard floor: candy-cane red/white tiles below
// the horizon, starry night sky above. Pure fragment shader: each pixel
// in the bottom half is reverse-projected onto an infinite plane.
import { makeShaderPart } from './_shaderpart.js';

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform float u_time;
uniform vec2  u_res;
uniform sampler2D u_palette;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  // After the final display blit, v_uv.y == 1 is the BOTTOM of the screen
  // and v_uv.y == 0 is the TOP. Flip into a screen-space y where
  // sy == 0 is the bottom and sy == 1 is the top so the floor/horizon math
  // below reads naturally.
  float sy = 1.0 - v_uv.y;
  // Horizon sits slightly above center; everything above is sky.
  float horizon = 0.55;
  vec3 col;
  if (sy > horizon) {
    // Sky: dark blue gradient + sparse stars + a soft horizon glow.
    float t = (sy - horizon) / (1.0 - horizon);
    col = mix(vec3(0.05, 0.04, 0.18), vec3(0.0, 0.0, 0.04), t);
    // Horizon glow (warm).
    col += vec3(0.45, 0.18, 0.20) * exp(-t * 12.0) * 0.6;
    // Stars on a coarse grid.
    vec2 sp = v_uv * u_res;
    vec2 cell = floor(sp / 3.0);
    float h = hash(cell);
    if (h > 0.992) {
      float tw = 0.5 + 0.5 * sin(u_time * 3.0 + h * 50.0);
      col += vec3(0.9, 0.95, 1.0) * tw;
    }
  } else {
    // Floor: project the pixel onto an infinite checker plane.
    // Camera at height h looking forward; floor at y=0.
    // d = h / (horizon - sy) gives distance forward to that pixel.
    float h = 1.0;
    float dy = horizon - sy;                // 0 at horizon, grows toward bottom
    float dist = h / max(dy, 0.0008);
    // World x: spread across screen, scaled by distance for perspective.
    float wx = (v_uv.x - 0.5) * dist * 2.2;
    // World z: forward distance with time scroll.
    float wz = dist - u_time * 2.2;
    // Tile coordinates.
    float tileX = floor(wx * 0.6);
    float tileZ = floor(wz * 0.6);
    float check = mod(tileX + tileZ, 2.0);
    // Candy-cane: red on one side, white on the other, with a touch of pine
    // green stripes for variety.
    vec3 red   = vec3(0.85, 0.10, 0.18);
    vec3 white = vec3(0.95, 0.95, 0.90);
    col = mix(red, white, check);
    // Fog into the horizon so the pattern doesn't strobe at infinity.
    float fog = clamp(dist / 22.0, 0.0, 1.0);
    vec3 fogCol = vec3(0.35, 0.10, 0.18);
    col = mix(col, fogCol, fog);
    // Subtle palette tint pulled from the part palette, indexed by depth.
    float pu = fract(dist * 0.06 + u_time * 0.05);
    vec3 tint = texture(u_palette, vec2(pu, 0.5)).rgb;
    col = mix(col, col * tint * 1.4, 0.18);

    // ----- Boing Ball shadow (only on floor pixels) -----
    // The ball lives at apparent forward distance BZ in camera space; its
    // shadow sits directly under it on the floor and stretches based on
    // bounce height.
    float JUMP_PERIOD = 1.2;
    float jumpIdx = floor(u_time / JUMP_PERIOD);
    float jumpT   = fract(u_time / JUMP_PERIOD);
    float BZ      = 3.8;
    float R       = 0.75;
    float bxNow   = (hash(vec2(jumpIdx, 7.3)) - 0.5) * 4.4;
    float bxPrev  = (hash(vec2(jumpIdx - 1.0, 7.3)) - 0.5) * 4.4;
    float bx      = mix(bxPrev, bxNow, smoothstep(0.0, 1.0, jumpT));
    float bounceN = 4.0 * jumpT * (1.0 - jumpT);                 // 0..1, peaks at 0.5
    float jumpH   = 0.8 + hash(vec2(jumpIdx, 11.7)) * 0.4;
    float by      = R + bounceN * jumpH;
    // Floor-plane camera-frame position is (wx, 0, dist).
    float dxShadow = wx - bx;
    float dzShadow = dist - BZ;
    float shadowR = R * 1.05 + bounceN * 0.25;
    float shadowD = sqrt(dxShadow * dxShadow + dzShadow * dzShadow);
    float shadowMask = 1.0 - smoothstep(shadowR * 0.7, shadowR, shadowD);
    // Soften with bounce height -- shadow fades when ball is high up.
    shadowMask *= mix(0.55, 0.18, bounceN);
    col *= 1.0 - shadowMask;
  }

  // ----- Boing Ball (drawn over both sky and floor) -----
  {
    float JUMP_PERIOD = 1.2;
    float jumpIdx = floor(u_time / JUMP_PERIOD);
    float jumpT   = fract(u_time / JUMP_PERIOD);
    float BZ      = 3.8;
    float R       = 0.75;
    float bxNow   = (hash(vec2(jumpIdx, 7.3)) - 0.5) * 4.4;
    float bxPrev  = (hash(vec2(jumpIdx - 1.0, 7.3)) - 0.5) * 4.4;
    float bx      = mix(bxPrev, bxNow, smoothstep(0.0, 1.0, jumpT));
    float bounceN = 4.0 * jumpT * (1.0 - jumpT);
    float jumpH   = 0.8 + hash(vec2(jumpIdx, 11.7)) * 0.4;
    float by      = R + bounceN * jumpH;

    // Project ball center to screen-space (in the floor's (uv.x, sy) frame).
    float ball_uvx = 0.5 + bx / (BZ * 2.2);
    float ball_sy  = horizon + (by - 1.0) / BZ;
    float r_uvx    = R / (BZ * 2.2);
    float r_sy     = R / BZ;

    // Normalized offset within ball ellipse.
    float px = (v_uv.x - ball_uvx) / r_uvx;
    float py = (sy       - ball_sy ) / r_sy;
    float rho2 = px * px + py * py;
    if (rho2 < 1.0) {
      // Sphere normal (right-handed, +Y up, +Z toward viewer).
      float nz = sqrt(1.0 - rho2);
      vec3 n = vec3(px, py, nz);

      // Forward rolling: angle around X axis, driven by the floor's scroll
      // speed and the L-R drift since both contribute to perceived roll.
      float floorScroll = u_time * 2.2;            // matches u_time * 2.2 floor scroll
      float rollX       = floorScroll / R;
      // Sideways tilt from L-R motion (roll around Z axis).
      float rollZ       = -bx / R;
      // Apply rollX (rotate Y,Z).
      float ca = cos(rollX), sa = sin(rollX);
      vec3 nr = vec3(n.x, n.y * ca - n.z * sa, n.y * sa + n.z * ca);
      // Apply rollZ (rotate X,Y).
      float cb = cos(rollZ), sb = sin(rollZ);
      nr = vec3(nr.x * cb - nr.y * sb, nr.x * sb + nr.y * cb, nr.z);

      // Spherical UV: longitude/latitude on rotated sphere.
      float u = atan(nr.x, nr.z) / 6.28318 + 0.5;
      float v = nr.y * 0.5 + 0.5;
      // Classic Boing Ball: 8 longitudinal x 8 latitudinal red/white check.
      float cu = floor(u * 8.0);
      float cv = floor(v * 8.0);
      float chk = mod(cu + cv, 2.0);
      vec3 ballRed   = vec3(0.92, 0.10, 0.18);
      vec3 ballWhite = vec3(0.96, 0.96, 0.92);
      vec3 ballCol = mix(ballWhite, ballRed, chk);

      // Lambert + a touch of rim for that '84 CGI shine.
      vec3 lightDir = normalize(vec3(-0.35, 0.55, 0.75));
      float lambert = max(0.0, dot(n, lightDir));
      float rim = pow(1.0 - nz, 3.0) * 0.35;
      ballCol *= 0.35 + 0.75 * lambert;
      ballCol += vec3(0.20, 0.05, 0.05) * rim;

      // Soft anti-alias at the silhouette.
      float edge = smoothstep(1.0, 0.92, rho2);
      col = mix(col, ballCol, edge);
    }
  }
  outColor = vec4(col, 1.0);
}
`;

export const checkerfloor = makeShaderPart(FS, 'christmas');
