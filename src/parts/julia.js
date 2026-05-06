// Animated Julia set: c = c(t) traces a smooth orbit through interesting
// regions of parameter space, producing a continuously morphing fractal.
//
// Iterates z_{n+1} = z_n^2 + c with z_0 = pixel position. Uses smooth escape
// time for banding-free coloring through a palette texture. No precision
// issues (no zoom), so visually it's the most reliably-pretty of the three.
import { makeShaderPart } from './_shaderpart.js';

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform float u_time;
uniform vec2  u_res;
uniform sampler2D u_palette;

const int MAX_ITER = 220;

void main() {
  // Aspect-correct pixel coords centered on screen, view radius ~1.6.
  vec2 z = (v_uv - 0.5) * 2.0;
  z.x *= u_res.x / u_res.y;
  z *= 1.6;

  // Animated c parameter. Move along a Lissajous curve sized to stay near
  // the boundary of the Mandelbrot set (where Julia sets are most ornate).
  // Radius ~0.78, slowly wobbling, multiple incommensurate frequencies so
  // the path never repeats too obviously.
  float t = u_time * 0.18;
  float r = 0.78 + 0.04 * sin(u_time * 0.13);
  vec2 c = vec2(
    r * cos(t) + 0.05 * sin(u_time * 0.41),
    r * sin(t * 1.07) + 0.05 * cos(u_time * 0.37)
  );

  // Iterate.
  float iter = 0.0;
  float bail = 0.0;
  for (int i = 0; i < MAX_ITER; i++) {
    z = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y) + c;
    float r2 = dot(z, z);
    if (r2 > 256.0) { bail = r2; break; }
    iter += 1.0;
  }

  vec3 col;
  if (iter >= float(MAX_ITER)) {
    // Inside set: dark with subtle hue shift over time.
    float pulse = 0.5 + 0.5 * sin(u_time * 0.8);
    col = vec3(0.0, 0.01, 0.06) + 0.05 * pulse * vec3(0.4, 0.2, 0.6);
  } else {
    // Smooth escape time.
    float logZn = 0.5 * log(bail);
    float nu = log(logZn / log(2.0)) / log(2.0);
    float mu = iter + 1.0 - nu;
    float pal = fract(mu * 0.035 + u_time * 0.09);
    float pu = (pal * 31.0 + 0.5) / 32.0;
    col = texture(u_palette, vec2(pu, 0.5)).rgb;
    // Slight darken at extreme low iter for depth.
    float edge = smoothstep(0.0, 4.0, iter);
    col *= edge;
  }

  outColor = vec4(col, 1.0);
}
`;

export const julia = makeShaderPart(FS, 'julia');
