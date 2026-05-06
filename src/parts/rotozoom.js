import { makeShaderPart } from './_shaderpart.js';

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform float u_time;
uniform vec2  u_res;
uniform sampler2D u_palette;

// Procedural tile: concentric diamond rings + 8-point star, with checker base.
float pat(vec2 p) {
  vec2 g = floor(p);
  vec2 f = fract(p) - 0.5;

  // Checker base.
  float ck = mod(g.x + g.y, 2.0);
  float base = ck * 0.45 + 0.10;

  // Diamond ring (Manhattan distance).
  float md = abs(f.x) + abs(f.y);
  float ring = smoothstep(0.05, 0.0, abs(md - 0.30))
             + smoothstep(0.04, 0.0, abs(md - 0.45)) * 0.6;

  // 8-point star: rotate by 45° and union with axes.
  vec2 r = vec2(f.x + f.y, f.x - f.y) * 0.7071;
  float star = smoothstep(0.06, 0.0, min(abs(f.x), abs(f.y)))
             + smoothstep(0.06, 0.0, min(abs(r.x), abs(r.y))) * 0.7;
  float center = smoothstep(0.18, 0.0, length(f));

  return clamp(base + ring * 0.55 + star * 0.35 + center * 0.6, 0.0, 1.0);
}

void main() {
  vec2 p = (v_uv - 0.5) * u_res;

  // Two-frequency rotozoom: combine fast spin with slow zoom + figure-8 drift.
  float a = u_time * 0.55;
  float z = 1.6 + sin(u_time * 0.37) * 0.9;
  float ca = cos(a) * z;
  float sa = sin(a) * z;
  vec2 q = vec2(p.x * ca - p.y * sa, p.x * sa + p.y * ca);
  q *= 0.045;
  // Drift center for that "swimming" feel.
  q += vec2(sin(u_time * 0.3) * 1.2, cos(u_time * 0.41) * 0.9);

  float v = pat(q);
  // Cycle palette.
  v = fract(v + u_time * 0.06);
  vec3 col = texture(u_palette, vec2(v, 0.5)).rgb;

  // Vignette so it feels framed.
  float vig = 1.0 - smoothstep(0.45, 1.05, length(v_uv - 0.5) * 1.4);
  col *= 0.55 + 0.45 * vig;

  outColor = vec4(col, 1.0);
}
`;

export const rotozoom = makeShaderPart(FS, 'rotozoom');
