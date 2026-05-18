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
  // v_uv.y = 0 at bottom, 1 at top of the framebuffer.
  // Horizon sits slightly above center; everything above is sky.
  float horizon = 0.55;
  vec3 col;
  if (v_uv.y > horizon) {
    // Sky: dark blue gradient + sparse stars + a soft horizon glow.
    float t = (v_uv.y - horizon) / (1.0 - horizon);
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
    // d = h / (horizon - v_uv.y) gives distance forward to that pixel.
    float h = 1.0;
    float dy = horizon - v_uv.y;            // 0 at horizon, grows toward bottom
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
  }
  outColor = vec4(col, 1.0);
}
`;

export const checkerfloor = makeShaderPart(FS, 'christmas');
