// Shared helper: build a "fullscreen fragment effect" part from a fragment shader source.
// The fragment shader receives standard uniforms: u_time, u_res, u_palette, optional extras.
import { createProgram, VS_FULLSCREEN, VW, VH } from '../gl/context.js';
import { drawQuad } from '../gl/quad.js';
import { bindFBO } from '../gl/framebuffer.js';
import { createPaletteTexture, PALETTES } from '../gl/palette.js';

export function makeShaderPart(fsSrc, paletteName, extraUniforms = []) {
  return function factory(gl) {
    const prog = createProgram(gl, VS_FULLSCREEN, fsSrc);
    const uTime = gl.getUniformLocation(prog, 'u_time');
    const uRes  = gl.getUniformLocation(prog, 'u_res');
    const uPal  = gl.getUniformLocation(prog, 'u_palette');
    const uExtras = {};
    for (const name of extraUniforms) {
      uExtras[name] = gl.getUniformLocation(prog, name);
    }
    const palTex = createPaletteTexture(gl, PALETTES[paletteName] || PALETTES.plasma);
    return {
      prog,
      render(gl, t /* ms */, fbo) {
        bindFBO(gl, fbo);
        gl.useProgram(prog);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, palTex);
        gl.uniform1i(uPal, 0);
        gl.uniform1f(uTime, t / 1000);
        gl.uniform2f(uRes, VW, VH);
        drawQuad(gl);
      },
      dispose(gl) {
        gl.deleteProgram(prog);
        gl.deleteTexture(palTex);
      },
      uExtras,
    };
  };
}
