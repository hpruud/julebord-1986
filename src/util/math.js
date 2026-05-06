// Math helpers and lookup tables.
export const TAU = Math.PI * 2;

const SIN_LUT_SIZE = 4096;
const SIN_LUT = new Float32Array(SIN_LUT_SIZE);
for (let i = 0; i < SIN_LUT_SIZE; i++) {
  SIN_LUT[i] = Math.sin((i / SIN_LUT_SIZE) * TAU);
}

export function fastSin(x) {
  const i = ((x / TAU) * SIN_LUT_SIZE) | 0;
  return SIN_LUT[((i % SIN_LUT_SIZE) + SIN_LUT_SIZE) % SIN_LUT_SIZE];
}

export function fastCos(x) {
  return fastSin(x + Math.PI / 2);
}

export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, t) => {
  const x = clamp((t - a) / (b - a), 0, 1);
  return x * x * (3 - 2 * x);
};

// All matrices are column-major (the convention WebGL expects with transpose=false).
// Index convention: m[col*4 + row].

export function mat4Identity() {
  return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
}

export function mat4Perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  // Column-major: each group of 4 is a column.
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

// Column-major multiplication: C = A * B.
// C[col,row] = sum_k A[k,row] * B[col,k]
// Index helper: col*4 + row
export function mat4Mul(a, b) {
  const o = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let s = 0;
      for (let k = 0; k < 4; k++) {
        s += a[k * 4 + row] * b[col * 4 + k];
      }
      o[col * 4 + row] = s;
    }
  }
  return o;
}

// Standard column-major rotation matrices.
export function mat4RotateY(a) {
  const c = Math.cos(a), s = Math.sin(a);
  // Column 0: (c, 0, -s, 0); Column 1: (0,1,0,0); Column 2: (s, 0, c, 0); Column 3: (0,0,0,1)
  return new Float32Array([c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1]);
}
export function mat4RotateX(a) {
  const c = Math.cos(a), s = Math.sin(a);
  // Column 0: (1,0,0,0); Column 1: (0, c, s, 0); Column 2: (0, -s, c, 0); Column 3: (0,0,0,1)
  return new Float32Array([1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1]);
}
export function mat4RotateZ(a) {
  const c = Math.cos(a), s = Math.sin(a);
  // Column 0: (c, s, 0, 0); Column 1: (-s, c, 0, 0)
  return new Float32Array([c,s,0,0, -s,c,0,0, 0,0,1,0, 0,0,0,1]);
}
export function mat4Translate(x, y, z) {
  // Column-major translate: x,y,z occupy column 3.
  return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, x,y,z,1]);
}

// Multiplied on the LEFT of a projection to flip the rendered image vertically.
// This is needed because the project's blit pass applies a Y-flip when sampling
// the FBO (to make CPU-uploaded textures display right-side up). GLSL parts that
// render via projection matrices need this counter-flip so they match.
export function mat4FlipY() {
  return new Float32Array([1,0,0,0, 0,-1,0,0, 0,0,1,0, 0,0,0,1]);
}
