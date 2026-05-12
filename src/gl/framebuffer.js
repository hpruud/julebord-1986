// Offscreen framebuffer wrapping a single RGBA8 texture target.
// Optionally attaches a DEPTH16 renderbuffer for parts that need depth testing
// (e.g. battle.js with its 3D dunes/trees/ships). Pass `depth: true` to enable.
export function createFBO(gl, w, h, opts = {}) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  let depthRB = null;
  if (opts.depth) {
    depthRB = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depthRB);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthRB);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fbo, tex, w, h, depthRB };
}

export function bindFBO(gl, target) {
  if (target) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, target.w, target.h);
  } else {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
}

export function clearFBO(gl, r=0, g=0, b=0, a=1) {
  gl.clearColor(r, g, b, a);
  // Clear depth too if attached; harmless if not (silently ignored on
  // FBOs without a depth attachment).
  gl.clearDepth(1.0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
}

// Release all GPU resources owned by an FBO record produced by createFBO:
// the color texture, the framebuffer object itself, and the optional depth
// renderbuffer. After this returns the record's fields are nulled out so
// double-frees and accidental re-binds are caught early. Safe to call with
// null/undefined (no-op).
export function disposeFBO(gl, target) {
  if (!target) return;
  if (target.tex) gl.deleteTexture(target.tex);
  if (target.depthRB) gl.deleteRenderbuffer(target.depthRB);
  if (target.fbo) gl.deleteFramebuffer(target.fbo);
  target.tex = null;
  target.depthRB = null;
  target.fbo = null;
}
