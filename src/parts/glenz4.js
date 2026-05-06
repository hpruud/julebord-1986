// Glenz x4: same translucent glenz vector scene as glenz.js, but rendered
// four times in a 2x2 grid on the same screen. Each tile gets its own
// time-phase offset so the four little scenes tumble out-of-sync, giving the
// part a "multi-monitor demo wall" feel that was popular in early-90s mega
// demos. Geometry, palette and blend mode are identical to the single
// glenz scene -- only the viewport and the per-tile time offset change.
import { VW, VH } from '../gl/context.js';
import { bindFBO } from '../gl/framebuffer.js';
import { createPaletteTexture, PALETTES } from '../gl/palette.js';
import { mat4Mul, mat4Perspective, mat4RotateX, mat4RotateY, mat4RotateZ, mat4Translate, mat4FlipY } from '../util/math.js';

const VS = `#version 300 es
in vec3 a_pos;
in float a_face;
uniform mat4 u_mvp;
out float v_face;
out float v_depth;
void main() {
  vec4 cs = u_mvp * vec4(a_pos, 1.0);
  gl_Position = cs;
  v_face = a_face;
  v_depth = clamp(0.5 - cs.z * 0.05, 0.0, 1.0);
}
`;

const FS = `#version 300 es
precision highp float;
in float v_face;
in float v_depth;
out vec4 outColor;
uniform sampler2D u_palette;
uniform float u_time;
uniform float u_alpha;
uniform float u_palLo;
uniform float u_palHi;
void main() {
  float k = fract(v_face * 0.137 + u_time * 0.10);
  float pal = mix(u_palLo, u_palHi, k);
  vec3 col = texture(u_palette, vec2(pal, 0.5)).rgb;
  col *= mix(0.80, 1.00, v_depth);
  // Premultiplied alpha output to match blendFunc(ONE, ONE_MINUS_SRC_ALPHA).
  outColor = vec4(col * u_alpha, u_alpha);
}
`;

const EDGE_VS = `#version 300 es
in vec3 a_pos;
uniform mat4 u_mvp;
void main() { gl_Position = u_mvp * vec4(a_pos, 1.0); }
`;
const EDGE_FS = `#version 300 es
precision highp float;
out vec4 outColor;
uniform vec3 u_color;
uniform float u_alpha;
void main() { outColor = vec4(u_color * u_alpha, u_alpha); }
`;

function buildCube() {
  const c = [
    [-1,-1,-1],[ 1,-1,-1],[ 1, 1,-1],[-1, 1,-1],
    [-1,-1, 1],[ 1,-1, 1],[ 1, 1, 1],[-1, 1, 1],
  ];
  const faces = [
    [0,1,2,3, 0], [5,4,7,6, 1], [4,0,3,7, 2],
    [1,5,6,2, 3], [3,2,6,7, 4], [4,5,1,0, 5],
  ];
  const verts = [];
  for (const f of faces) {
    const [a,b,cc,d, id] = f;
    const va = c[a], vb = c[b], vc = c[cc], vd = c[d];
    verts.push(...va, id, ...vb, id, ...vc, id);
    verts.push(...va, id, ...vc, id, ...vd, id);
  }
  const edgePairs = [
    [0,1],[1,2],[2,3],[3,0],
    [4,5],[5,6],[6,7],[7,4],
    [0,4],[1,5],[2,6],[3,7],
  ];
  const edges = [];
  for (const [a, b] of edgePairs) edges.push(...c[a], ...c[b]);
  return { tris: new Float32Array(verts), edges: new Float32Array(edges) };
}

function buildOctahedron() {
  const c = [
    [ 1, 0, 0], [-1, 0, 0],
    [ 0, 1, 0], [ 0,-1, 0],
    [ 0, 0, 1], [ 0, 0,-1],
  ];
  const faces = [
    [0,2,4, 0],[2,1,4, 1],[1,3,4, 2],[3,0,4, 3],
    [2,0,5, 4],[1,2,5, 5],[3,1,5, 6],[0,3,5, 7],
  ];
  const verts = [];
  for (const f of faces) {
    const [a, b, cc, id] = f;
    verts.push(...c[a], id, ...c[b], id, ...c[cc], id);
  }
  const edgePairs = [
    [0,2],[2,1],[1,3],[3,0],
    [0,4],[2,4],[1,4],[3,4],
    [0,5],[2,5],[1,5],[3,5],
  ];
  const edges = [];
  for (const [a, b] of edgePairs) edges.push(...c[a], ...c[b]);
  return { tris: new Float32Array(verts), edges: new Float32Array(edges) };
}

function buildIcosahedron() {
  const t = (1 + Math.sqrt(5)) / 2;
  const n = Math.hypot(1, t);
  const a = 1 / n, b = t / n;
  const c = [
    [-a,  b,  0], [ a,  b,  0], [-a, -b,  0], [ a, -b,  0],
    [ 0, -a,  b], [ 0,  a,  b], [ 0, -a, -b], [ 0,  a, -b],
    [ b,  0, -a], [ b,  0,  a], [-b,  0, -a], [-b,  0,  a],
  ];
  const faces = [
    [0,11,5, 0], [0,5,1, 1], [0,1,7, 2], [0,7,10, 3], [0,10,11, 4],
    [1,5,9, 5], [5,11,4, 6], [11,10,2, 7], [10,7,6, 8], [7,1,8, 9],
    [3,9,4, 10], [3,4,2, 11], [3,2,6, 12], [3,6,8, 13], [3,8,9, 14],
    [4,9,5, 15], [2,4,11, 16], [6,2,10, 17], [8,6,7, 18], [9,8,1, 19],
  ];
  const verts = [];
  for (const f of faces) {
    const [ia, ib, ic, id] = f;
    verts.push(...c[ia], id, ...c[ib], id, ...c[ic], id);
  }
  const seen = new Set();
  const edges = [];
  for (const f of faces) {
    const [ia, ib, ic] = f;
    const pairs = [[ia,ib],[ib,ic],[ic,ia]];
    for (const [p, q] of pairs) {
      const k = p < q ? `${p}_${q}` : `${q}_${p}`;
      if (seen.has(k)) continue;
      seen.add(k);
      edges.push(...c[p], ...c[q]);
    }
  }
  return { tris: new Float32Array(verts), edges: new Float32Array(edges) };
}

function makeMesh(gl, data, withFaceAttr) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  const stride = withFaceAttr ? 16 : 12;
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
  if (withFaceAttr) {
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, stride, 12);
  }
  gl.bindVertexArray(null);
  return { vao, vbo, count: data.length / (withFaceAttr ? 4 : 3) };
}

function scaleMat(k) {
  return new Float32Array([k,0,0,0, 0,k,0,0, 0,0,k,0, 0,0,0,1]);
}

export function glenz4(gl) {
  // Fill program.
  const prog = gl.createProgram();
  const vs = gl.createShader(gl.VERTEX_SHADER); gl.shaderSource(vs, VS); gl.compileShader(vs);
  const fs = gl.createShader(gl.FRAGMENT_SHADER); gl.shaderSource(fs, FS); gl.compileShader(fs);
  gl.attachShader(prog, vs); gl.attachShader(prog, fs);
  gl.bindAttribLocation(prog, 0, 'a_pos');
  gl.bindAttribLocation(prog, 1, 'a_face');
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) console.error('glenz4 link', gl.getProgramInfoLog(prog));
  const uMvp   = gl.getUniformLocation(prog, 'u_mvp');
  const uPal   = gl.getUniformLocation(prog, 'u_palette');
  const uTime  = gl.getUniformLocation(prog, 'u_time');
  const uAlpha = gl.getUniformLocation(prog, 'u_alpha');
  const uPalLo = gl.getUniformLocation(prog, 'u_palLo');
  const uPalHi = gl.getUniformLocation(prog, 'u_palHi');

  // Edge program.
  const eProg = gl.createProgram();
  const evs = gl.createShader(gl.VERTEX_SHADER); gl.shaderSource(evs, EDGE_VS); gl.compileShader(evs);
  const efs = gl.createShader(gl.FRAGMENT_SHADER); gl.shaderSource(efs, EDGE_FS); gl.compileShader(efs);
  gl.attachShader(eProg, evs); gl.attachShader(eProg, efs);
  gl.bindAttribLocation(eProg, 0, 'a_pos');
  gl.linkProgram(eProg);
  const uMvpE   = gl.getUniformLocation(eProg, 'u_mvp');
  const uColE   = gl.getUniformLocation(eProg, 'u_color');
  const uAlphaE = gl.getUniformLocation(eProg, 'u_alpha');

  const cube = buildCube();
  const oct  = buildOctahedron();
  const ico  = buildIcosahedron();
  const cubeMesh = makeMesh(gl, cube.tris, true);
  const cubeEdge = makeMesh(gl, cube.edges, false);
  const octMesh  = makeMesh(gl, oct.tris,  true);
  const octEdge  = makeMesh(gl, oct.edges, false);
  const icoMesh  = makeMesh(gl, ico.tris,  true);
  const icoEdge  = makeMesh(gl, ico.edges, false);

  const palTex = createPaletteTexture(gl, PALETTES.christmas);

  // 2x2 tile layout. Each tile gets a time-phase offset so the four little
  // scenes are visibly out-of-sync rather than being four identical copies.
  // Quadrants are addressed in the framebuffer's pixel space (origin lower-left).
  const halfW = (VW / 2) | 0;
  const halfH = (VH / 2) | 0;
  const tiles = [
    { x: 0,     y: halfH, phase:  0.00 }, // top-left
    { x: halfW, y: halfH, phase:  3.70 }, // top-right
    { x: 0,     y: 0,     phase:  7.30 }, // bottom-left
    { x: halfW, y: 0,     phase: 11.10 }, // bottom-right
  ];

  // Render one full glenz scene (cube + oct + ico) using the supplied time.
  // Aspect ratio is tile aspect (halfW/halfH), not full-screen aspect.
  function renderScene(t) {
    const tt = t / 1000;
    const aspect = halfW / halfH;
    const proj = mat4Mul(mat4FlipY(), mat4Perspective(1.25, aspect, 0.1, 100));
    const camZ = -3.6 - 0.5 * Math.sin(tt * 0.55);
    const breath = 0.5 + 0.5 * Math.sin(tt * 0.7);

    gl.useProgram(prog);
    gl.uniform1i(uPal, 0);
    gl.uniform1f(uTime, tt);

    // ---- Cube ----
    {
      const r = mat4Mul(mat4RotateY(tt * 0.5), mat4Mul(mat4RotateX(tt * 0.4), mat4RotateZ(tt * 0.25)));
      const sm = scaleMat(1.55);
      const tr = mat4Translate(0.55 * Math.sin(tt * 0.4), 0.15 * Math.cos(tt * 0.33), camZ);
      const mvp = mat4Mul(proj, mat4Mul(tr, mat4Mul(r, sm)));
      gl.useProgram(prog);
      gl.uniformMatrix4fv(uMvp, false, mvp);
      gl.uniform1f(uAlpha, 0.55 + 0.10 * breath);
      gl.uniform1f(uPalLo, 0.00);
      gl.uniform1f(uPalHi, 0.22);
      gl.bindVertexArray(cubeMesh.vao);
      gl.drawArrays(gl.TRIANGLES, 0, cubeMesh.count);

      gl.useProgram(eProg);
      gl.uniformMatrix4fv(uMvpE, false, mvp);
      gl.uniform3f(uColE, 1.00, 0.45, 0.40);
      gl.uniform1f(uAlphaE, 0.55);
      gl.bindVertexArray(cubeEdge.vao);
      gl.drawArrays(gl.LINES, 0, cubeEdge.count);
    }

    // ---- Octahedron ----
    {
      const r = mat4Mul(mat4RotateY(-tt * 0.85), mat4Mul(mat4RotateX(-tt * 0.7), mat4RotateZ(tt * 0.45)));
      const sm = scaleMat(1.95);
      const tr = mat4Translate(-0.55 * Math.sin(tt * 0.4), -0.15 * Math.cos(tt * 0.33), camZ);
      const mvp = mat4Mul(proj, mat4Mul(tr, mat4Mul(r, sm)));

      gl.useProgram(prog);
      gl.uniformMatrix4fv(uMvp, false, mvp);
      gl.uniform1f(uAlpha, 0.55 + 0.10 * breath);
      gl.uniform1f(uPalLo, 0.78);
      gl.uniform1f(uPalHi, 1.00);
      gl.bindVertexArray(octMesh.vao);
      gl.drawArrays(gl.TRIANGLES, 0, octMesh.count);

      gl.useProgram(eProg);
      gl.uniformMatrix4fv(uMvpE, false, mvp);
      gl.uniform3f(uColE, 0.45, 0.95, 0.50);
      gl.uniform1f(uAlphaE, 0.55);
      gl.bindVertexArray(octEdge.vao);
      gl.drawArrays(gl.LINES, 0, octEdge.count);
    }

    // ---- Icosahedron ----
    {
      const r = mat4Mul(mat4RotateY(tt * 1.15), mat4Mul(mat4RotateX(tt * 0.95), mat4RotateZ(-tt * 0.6)));
      const sm = scaleMat(1.30);
      const tr = mat4Translate(0.0, 0.25 * Math.sin(tt * 0.9), camZ);
      const mvp = mat4Mul(proj, mat4Mul(tr, mat4Mul(r, sm)));

      gl.useProgram(prog);
      gl.uniformMatrix4fv(uMvp, false, mvp);
      gl.uniform1f(uAlpha, 0.40 + 0.08 * breath);
      gl.uniform1f(uPalLo, 0.28);
      gl.uniform1f(uPalHi, 0.40);
      gl.bindVertexArray(icoMesh.vao);
      gl.drawArrays(gl.TRIANGLES, 0, icoMesh.count);

      gl.useProgram(eProg);
      gl.uniformMatrix4fv(uMvpE, false, mvp);
      gl.uniform3f(uColE, 1.00, 0.85, 0.55);
      gl.uniform1f(uAlphaE, 0.40);
      gl.bindVertexArray(icoEdge.vao);
      gl.drawArrays(gl.LINES, 0, icoEdge.count);
    }
  }

  return {
    render(gl, t, fbo) {
      // bindFBO sets the viewport to the full FBO (VW x VH); we override per-tile below.
      bindFBO(gl, fbo);
      gl.viewport(0, 0, VW, VH);
      gl.clearColor(0.02, 0.03, 0.06, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.DEPTH_TEST);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, palTex);

      // Render each tile with its own time offset and viewport.
      for (const tile of tiles) {
        gl.viewport(tile.x, tile.y, halfW, halfH);
        // Phase shift in seconds -> milliseconds. Each tile sees a different
        // moment of the same animation, so the four scenes drift in/out of sync.
        renderScene(t + tile.phase * 1000);
      }

      // Restore full viewport so subsequent passes (transitions, post) are fine.
      gl.viewport(0, 0, VW, VH);
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);
    },
    dispose(gl) {
      gl.deleteProgram(prog);
      gl.deleteProgram(eProg);
      gl.deleteVertexArray(cubeMesh.vao); gl.deleteBuffer(cubeMesh.vbo);
      gl.deleteVertexArray(cubeEdge.vao); gl.deleteBuffer(cubeEdge.vbo);
      gl.deleteVertexArray(octMesh.vao);  gl.deleteBuffer(octMesh.vbo);
      gl.deleteVertexArray(octEdge.vao);  gl.deleteBuffer(octEdge.vbo);
      gl.deleteVertexArray(icoMesh.vao);  gl.deleteBuffer(icoMesh.vbo);
      gl.deleteVertexArray(icoEdge.vao);  gl.deleteBuffer(icoEdge.vbo);
      gl.deleteTexture(palTex);
    }
  };
}
