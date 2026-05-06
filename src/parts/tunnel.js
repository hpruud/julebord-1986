import { makeShaderPart } from './_shaderpart.js';

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform float u_time;
uniform vec2  u_res;
uniform sampler2D u_palette;

void main() {
  vec2 p = (v_uv - 0.5) * vec2(u_res.x / u_res.y, 1.0) * 2.0;

  // Wobbly tunnel center.
  p += vec2(sin(u_time * 0.7), cos(u_time * 0.9)) * 0.18;

  float a = atan(p.y, p.x);
  float r = length(p);

  // Tunnel coords.
  float u = a / 3.14159 * 5.0 + u_time * 0.25;
  float v = 1.0 / max(r, 0.015) + u_time * 0.85;

  // Brick-checker pattern (offset rows for masonry feel).
  float row = floor(v);
  float ushift = u + 0.5 * mod(row, 2.0);
  float ck = step(0.0, sin(ushift * 6.2831 * 0.5));
  // Mortar lines (sharp).
  float mortar = smoothstep(0.0, 0.04, abs(fract(v) - 0.5)) *
                 smoothstep(0.0, 0.05, abs(fract(ushift * 0.5) - 0.5));

  // Depth darkening.
  float depth = clamp(r * 1.5, 0.0, 1.0);

  // Hot center glow.
  float glow = pow(1.0 - clamp(r * 1.2, 0.0, 1.0), 4.0);

  // Palette index combines pattern + slow cycle.
  float palIdx = fract(ck * 0.5 + row * 0.07 + u_time * 0.08);
  vec3 col = texture(u_palette, vec2(palIdx, 0.5)).rgb;
  col *= mortar; // dark mortar lines
  col *= depth;
  // Hot core.
  col += vec3(1.0, 0.85, 0.55) * glow * 0.8;

  outColor = vec4(col, 1.0);
}
`;

export const tunnel = makeShaderPart(FS, 'tunnel');
