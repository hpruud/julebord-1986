// Kaleido: 6-fold polar kaleidoscope of an inline procedural plasma.
// Pure fragment shader. The source pattern is a slow-swirling sin-of-sin
// plasma; the kaleido fold gives it living-mandala symmetry.
import { makeShaderPart } from './_shaderpart.js';

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform float u_time;
uniform vec2  u_res;
uniform sampler2D u_palette;

// Procedural plasma in source space. Returns a scalar in [-1, 1] used to
// index the palette.
float plasma(vec2 p, float t) {
  float a = sin(p.x * 3.1 + t * 0.7);
  float b = sin((p.y + p.x * 0.4) * 2.6 - t * 0.9);
  float c = sin(length(p - vec2(sin(t * 0.31), cos(t * 0.27))) * 4.2 + t * 1.1);
  float d = sin((p.x - p.y) * 1.7 + sin(t * 0.5) * 3.0);
  return (a + b + c + d) * 0.25;
}

void main() {
  // Center, correct aspect so the kaleido wedges aren't squashed.
  vec2 p = v_uv - 0.5;
  p.x *= u_res.x / u_res.y;

  // Polar coords.
  float r     = length(p);
  float theta = atan(p.y, p.x);

  // Slow global rotation.
  theta += u_time * 0.18;

  // 6-fold symmetry: fold theta into [0, pi/3] then mirror.
  float seg = 3.14159265 / 3.0;
  theta = mod(theta, seg * 2.0);
  if (theta > seg) theta = seg * 2.0 - theta;

  // Slow radial zoom (in and out).
  float zoom = 1.0 + 0.35 * sin(u_time * 0.23);
  r *= zoom;

  // Back to cartesian in source space.
  vec2 q = vec2(cos(theta), sin(theta)) * r * 3.6;

  // Sample plasma.
  float v = plasma(q, u_time);
  float idx = fract(v * 0.5 + 0.5 + u_time * 0.04);
  vec3 col = texture(u_palette, vec2(idx, 0.5)).rgb;

  // Center sparkle (white pinch) + soft outer vignette.
  col += vec3(1.0, 0.95, 0.85) * smoothstep(0.04, 0.0, r) * 0.6;
  col *= 1.0 - smoothstep(0.55, 0.95, length(p));

  outColor = vec4(col, 1.0);
}
`;

export const kaleido = makeShaderPart(FS, 'plasma');
