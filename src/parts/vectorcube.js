// Vector ball cube: 3D points (cube vertex grid + extras) projected, drawn as
// palette-shaded shaded sphere bobs. Polished version: bigger spheres,
// off-axis highlight, depth fog, dual-shell point cloud, sorted draw.
import { VW, VH } from '../gl/context.js';
import { bindFBO } from '../gl/framebuffer.js';
import { createPaletteTexture, PALETTES } from '../gl/palette.js';

const VS = `#version 300 es
in vec3 a_pos;
in float a_id;
uniform mat4 u_mvp;
uniform float u_time;
out float v_id;
out float v_z;       // view-space z (negative when in front)
out float v_persp;   // 1/clip.w-ish for fog
void main() {
  vec4 cs = u_mvp * vec4(a_pos, 1.0);
  gl_Position = cs;
  // Larger spheres + tighter perspective scaling for chunky Amiga look.
  float ps = 240.0 / max(0.1, cs.w);
  gl_PointSize = clamp(ps, 4.0, 48.0);
  v_id = a_id;
  v_z = cs.z;
  v_persp = cs.w;
}
`;

const FS = `#version 300 es
precision highp float;
in float v_id;
in float v_z;
in float v_persp;
out vec4 outColor;
uniform sampler2D u_palette;
uniform float u_time;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d);
  if (r > 0.5) discard;

  // Off-axis Phong-ish highlight: light up-left.
  vec2 light = normalize(vec2(-0.55, -0.65));
  // Treat the bob as a hemisphere: surface normal in screen space.
  vec3 n = vec3(d * 2.0, sqrt(max(0.0, 1.0 - dot(d * 2.0, d * 2.0))));
  vec3 L = normalize(vec3(light, 0.7));
  float diff = clamp(dot(n, L), 0.0, 1.0);
  float spec = pow(diff, 18.0);
  float rim  = pow(1.0 - n.z, 3.0) * 0.35;

  float pal = fract(v_id * 0.05 + u_time * 0.06);
  vec3 base = texture(u_palette, vec2(pal, 0.5)).rgb;

  vec3 col = base * (0.18 + 0.85 * diff) + vec3(1.0, 0.97, 0.92) * spec * 0.9;
  col += base * rim;

  // Depth fog: distant points fade toward background.
  float fog = clamp((v_persp - 3.0) / 9.0, 0.0, 1.0);
  col = mix(col, vec3(0.04, 0.04, 0.10), fog * 0.55);

  // Soft anti-aliased disk edge.
  float edge = smoothstep(0.5, 0.45, r);
  outColor = vec4(col, edge);
}
`;

import { mat4Mul, mat4Perspective, mat4RotateX, mat4RotateY, mat4Translate, mat4FlipY } from '../util/math.js';

export function vectorcube(gl) {
  const prog = gl.createProgram();
  const vs = gl.createShader(gl.VERTEX_SHADER); gl.shaderSource(vs, VS); gl.compileShader(vs);
  if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) console.error('vectorcube vs', gl.getShaderInfoLog(vs));
  const fs = gl.createShader(gl.FRAGMENT_SHADER); gl.shaderSource(fs, FS); gl.compileShader(fs);
  if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) console.error('vectorcube fs', gl.getShaderInfoLog(fs));
  gl.attachShader(prog, vs); gl.attachShader(prog, fs);
  gl.bindAttribLocation(prog, 0, 'a_pos');
  gl.bindAttribLocation(prog, 1, 'a_id');
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) console.error('vectorcube link', gl.getProgramInfoLog(prog));
  const uMvp = gl.getUniformLocation(prog, 'u_mvp');
  const uPal = gl.getUniformLocation(prog, 'u_palette');
  const uTime = gl.getUniformLocation(prog, 'u_time');

  // Outer cube shell: 6x6x6 grid, faces only.
  const verts = [];
  const N = 6;
  const step = 2 / (N - 1);
  let id = 0;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) for (let k = 0; k < N; k++) {
    const onFace = (i === 0 || i === N - 1 || j === 0 || j === N - 1 || k === 0 || k === N - 1);
    if (!onFace) continue;
    verts.push(-1 + i * step, -1 + j * step, -1 + k * step, id++);
  }
  // Inner shell: smaller cube faces at scale 0.55.
  const M = 4;
  const stepM = 2 / (M - 1);
  for (let i = 0; i < M; i++) for (let j = 0; j < M; j++) for (let k = 0; k < M; k++) {
    const onFace = (i === 0 || i === M - 1 || j === 0 || j === M - 1 || k === 0 || k === M - 1);
    if (!onFace) continue;
    verts.push((-1 + i * stepM) * 0.55, (-1 + j * stepM) * 0.55, (-1 + k * stepM) * 0.55, id++);
  }
  const data = new Float32Array(verts);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  const stride = 4 * 4;
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 1, gl.FLOAT, false, stride, 12);
  gl.bindVertexArray(null);

  const palTex = createPaletteTexture(gl, PALETTES.vector);
  const pointCount = data.length / 4;

  return {
    render(gl, t, fbo) {
      bindFBO(gl, fbo);
      gl.clearColor(0.02, 0.02, 0.06, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      const tt = t / 1000;
      const proj = mat4Mul(mat4FlipY(), mat4Perspective(1.05, VW / VH, 0.1, 100));
      // Slightly different rotation rates per axis for richer motion.
      const ry = mat4RotateY(tt * 0.55);
      const rx = mat4RotateX(tt * 0.41 + Math.sin(tt * 0.27) * 0.3);
      const tr = mat4Translate(0, 0, -5.5);
      const mv = mat4Mul(mat4Mul(tr, ry), rx);
      const mvp = mat4Mul(proj, mv);

      gl.useProgram(prog);
      gl.uniformMatrix4fv(uMvp, false, mvp);
      gl.uniform1f(uTime, tt);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, palTex);
      gl.uniform1i(uPal, 0);

      gl.bindVertexArray(vao);
      gl.drawArrays(gl.POINTS, 0, pointCount);
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);
    },
    dispose(gl) {
      gl.deleteProgram(prog);
      gl.deleteVertexArray(vao);
      gl.deleteBuffer(vbo);
      gl.deleteTexture(palTex);
    }
  };
}
