import { makeShaderPart } from './_shaderpart.js';

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform float u_time;
uniform vec2  u_res;
uniform sampler2D u_palette;

void main() {
  vec2 p = v_uv * u_res;
  vec3 col = vec3(0.04, 0.02, 0.10);

  // 48 bobs forming a 3D Lissajous-like wireframe sphere swirl.
  // Two interleaved swarms with different frequencies for depth.
  float bestZ = -1e9;
  vec3 bestCol = vec3(0.0);

  for (int i = 0; i < 48; i++) {
    float fi = float(i);
    float t = u_time;
    // Spherical-ish parametric coords.
    float a = fi * 0.3 + t * 0.6;
    float b = fi * 0.13 + t * 0.4;
    float r = 70.0 + 28.0 * sin(t * 0.7 + fi * 0.2);
    vec2 c = vec2(
      u_res.x * 0.5 + sin(a) * cos(b) * r,
      u_res.y * 0.5 + cos(a) * 0.7 * r
    );
    float z = sin(b);                 // -1..1, fake depth
    float scale = 0.7 + 0.6 * z;       // closer = bigger
    float radius = 14.0 * scale;
    float d = length(p - c) / radius;

    if (d < 1.0) {
      // Shaded sphere bob: bright spot offset toward upper-left.
      vec2 nrm = (p - c) / radius;
      vec2 light = vec2(-0.5, -0.5);
      float lambert = clamp(0.4 + dot(nrm, light) * -1.0, 0.0, 1.0);
      // Edge glow.
      float rim = pow(d, 2.0);
      // Palette per bob (warm rainbow).
      float pal = fract(fi * 0.083 + t * 0.07);
      vec3 base = texture(u_palette, vec2(pal, 0.5)).rgb;
      // Blend in white highlight.
      vec3 c0 = mix(base * lambert, vec3(1.0, 0.98, 0.92), pow(1.0 - d, 6.0) * 0.7);

      // Z-test: keep nearest bob's color, halo behind.
      if (z > bestZ) {
        bestZ = z;
        bestCol = c0;
      }
    } else if (d < 1.4) {
      // Soft outer glow halo (always additive).
      float pal = fract(fi * 0.083 + t * 0.07);
      vec3 base = texture(u_palette, vec2(pal, 0.5)).rgb;
      col += base * pow(1.4 - d, 3.0) * 0.25;
    }
  }

  if (bestZ > -1e8) col = max(col, bestCol);

  outColor = vec4(col, 1.0);
}
`;

export const bobs = makeShaderPart(FS, 'bobs');
