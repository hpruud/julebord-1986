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
  float v = 0.0;
  // Classic plasma sines.
  v += sin(p.x * 0.06 + u_time * 1.3);
  v += sin(p.y * 0.08 + u_time * 1.1);
  v += sin((p.x + p.y) * 0.05 + u_time * 0.9);
  // Radial wave (origin orbits).
  float cx = p.x * 0.04 + sin(u_time * 0.5) * 5.0;
  float cy = p.y * 0.05 + cos(u_time * 0.7) * 5.0;
  v += sin(sqrt(cx * cx + cy * cy + 1.0) + u_time * 1.7);
  // Second radial wave (opposite phase) for richer interference.
  float dx = p.x * 0.03 - cos(u_time * 0.43) * 6.0;
  float dy = p.y * 0.035 - sin(u_time * 0.61) * 6.0;
  v += sin(sqrt(dx * dx + dy * dy + 1.0) * 1.3 - u_time * 1.4);
  // High-freq detail.
  v += 0.5 * sin(p.x * 0.13 - p.y * 0.11 + u_time * 2.3);

  // Normalize and cycle.
  v = v * 0.10 + 0.5;
  v = fract(v + u_time * 0.06);

  vec3 col = texture(u_palette, vec2(v, 0.5)).rgb;

  // Subtle bloom-like saturation lift in bright regions.
  float lum = dot(col, vec3(0.3, 0.59, 0.11));
  col = mix(col, col * vec3(1.15, 1.05, 1.20), smoothstep(0.55, 0.95, lum));

  outColor = vec4(col, 1.0);
}
`;

export const plasma = makeShaderPart(FS, 'plasma');
