// Metaballs: 6 moving blob centers, per-pixel field summed in the fragment
// shader and threshold-mapped through the christmas palette.
import { makeShaderPart } from './_shaderpart.js';

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform float u_time;
uniform vec2  u_res;
uniform sampler2D u_palette;

vec2 ball(float i, float t) {
  // Lissajous orbits with slightly incommensurate frequencies so the balls
  // never settle into a periodic pattern.
  float a = 0.31 + i * 0.07;
  float b = 0.47 + i * 0.05;
  return vec2(
    0.5 + 0.35 * sin(t * a + i * 1.7),
    0.5 + 0.35 * cos(t * b + i * 2.3)
  );
}

void main() {
  vec2 p = v_uv;
  // Keep the field in aspect-corrected space so blobs stay round.
  vec2 aspect = vec2(u_res.x / u_res.y, 1.0);
  float field = 0.0;
  for (int i = 0; i < 6; i++) {
    vec2 c = ball(float(i), u_time);
    vec2 d = (p - c) * aspect;
    field += 0.04 / (dot(d, d) + 0.001);
  }
  // Soft threshold with a couple of bands so we get the classic ringed look.
  float v = field * 0.18;
  v = fract(v + u_time * 0.03);
  vec3 col = texture(u_palette, vec2(v, 0.5)).rgb;
  // Slight darkening outside the blob "membrane" to keep BG black-ish.
  float core = smoothstep(0.6, 1.6, field);
  col *= mix(0.35, 1.0, core);
  outColor = vec4(col, 1.0);
}
`;

export const metaballs = makeShaderPart(FS, 'christmas');
