// WebGL2 context, low-res framebuffer, and shader/program helpers.
export const VW = 320;
export const VH = 256;

export function getGL(canvas) {
  const gl = canvas.getContext('webgl2', {
    antialias: false,
    alpha: false,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
  });
  if (!gl) {
    document.body.innerHTML = '<div style="color:#fff;font-family:monospace;padding:32px;">WebGL2 is required. Please use a recent Chrome, Firefox, Edge, or Safari 15+.</div>';
    throw new Error('WebGL2 not available');
  }
  canvas.width = VW;
  canvas.height = VH;
  return gl;
}

export function compileShader(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    console.error('Shader compile error:', log, '\n', src);
    throw new Error('Shader compile: ' + log);
  }
  return sh;
}

export function createProgram(gl, vsSrc, fsSrc) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p);
    console.error('Program link error:', log);
    throw new Error('Program link: ' + log);
  }
  return p;
}

// Default vertex shader emitting fullscreen NDC quad.
export const VS_FULLSCREEN = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;
