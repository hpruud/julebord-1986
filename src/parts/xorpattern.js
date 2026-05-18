// Classic (x ^ y) & t XOR/AND bitplane texture, palette-cycled.
// Late-80s/early-90s cracktro staple: tiny code, infinite mesmerizing detail.
import { makeShaderPart } from './_shaderpart.js';

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform float u_time;
uniform vec2  u_res;
uniform sampler2D u_palette;

// Integer XOR via float bit ops isn't free in GLSL, but we have ints.
void main() {
  // Pixel coords in the internal 320x256 buffer, with a slow zoom so the
  // pattern is never static.
  float zoom = 0.55 + 0.45 * sin(u_time * 0.21);
  vec2 p = v_uv * u_res * zoom;
  // Gentle drift so the symmetry center wanders.
  p += vec2(sin(u_time * 0.27) * 40.0, cos(u_time * 0.19) * 32.0);
  int x = int(floor(p.x));
  int y = int(floor(p.y));
  // The (x^y) bit pattern is the visual fingerprint; AND with a slowly
  // changing mask animates it. Add an XOR-with-frame term for the classic
  // pulsing variant.
  int frame = int(u_time * 30.0);
  int v = (x ^ y) ^ (frame >> 2);
  // Modulo into palette range. (x^y) goes up to ~511 at our resolution;
  // mask to 5 bits for a 32-step palette index.
  int idx = v & 31;
  // Add a subtle additional cycle to keep things lively even when idx is
  // momentarily uniform across large regions.
  float pu = (float(idx) + 0.5) / 32.0 + u_time * 0.05;
  pu = fract(pu);
  vec3 col = texture(u_palette, vec2(pu, 0.5)).rgb;
  outColor = vec4(col, 1.0);
}
`;

export const xorpattern = makeShaderPart(FS, 'plasma');
