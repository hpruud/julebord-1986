# Academy - Julebord 2026 Demo

A browser-native Christmas demo in the spirit of late-80s / early-90s Amiga 500 demoscene productions, by **Julebord 2026**. Pure HTML + ES modules + WebGL2. No build step. No audio. No external assets. Just pixels, copper bars, and snow.

## Run it

This demo uses ES modules and an `AudioWorklet`, both of which Chromium-based browsers refuse to load from `file://`. **You must serve the folder over HTTP**.

### Option A — Python
```
cd C:\dev\amiga-demo
python -m http.server 8080
```
Then open http://localhost:8080/

### Option B — Node `npx`
```
cd C:\dev\amiga-demo
npx http-server -p 8080 .
```

Open `http://localhost:8080/` in **Chrome (latest)**, click anywhere, and the demo plays.

## Controls

- **Click** — start the demo
- **SPACE** — skip current part
- **F** — toggle fullscreen
- **ESC** — exit fullscreen
- **C** — toggle CRT overlay (scanlines + chroma aberration + vignette)
- **P** — pause / resume (clock pause; also suspends audio)
- **M** — mute / unmute background music

## Music

Background music is `assets/somewhere.mod` — a 4-channel 15-sample
Ultimate Soundtracker module ("somewhere"), played by a small
hand-written `.mod` player living at `src/audio/modplayer.js`. The mod
bytes are base64-embedded into `src/audio/song.js` so the demo needs no
network fetch at runtime (still requires HTTP origin for the worklet,
see "Run it" above). The song loops continuously.

## What's in it

20 parts (see `src/timeline.js` for the authoritative order):

1. Intro logo — "JULEBORD 1986 DEMO" title
2. Starfield — 3-layer parallax with Santa silhouette
3. Copper bars — sweeping horizontal bars with ACADEMY chunky-font overlay
4. Plasma — classic palette-cycled plasma
5. Bobs — additive sprite swarm
6. Fire — CPU cellular-automaton fire effect
7. Bobs+Fire — composite of the above
8. Rotozoomer — rotated/zoomed procedural texture
9. Mandelbrot — single-precision zoom into Seahorse Valley
10. Glenz vectors — translucent additive cube (premultiplied alpha)
11. Glenz vectors x4 — 2x2 grid of glenz cubes
12. Mandelbrot deep — perturbation-theory deep zoom
13. ACADEMY tech-tech — wobbling Christmas-colored ACADEMY logo with "JULEBORD 1986" subtitle
14. Julia — animated Julia set with orbiting `c`
15. Greetz scroller — vertical greetings
16. Tunnel — angular/radial palette-cycled tunnel
17. Sine scroller — horizontal scroll text with vertical sine wobble
18. Vector cube — 3D point cube with palette-shaded sphere bobs
19. Battle — moonlit snowy forest with X-wings, TIE fighters, Star Destroyer, and Santa flying past the moon
20. Outro credits — "A production by Julebord 2026" with falling snow

## Architecture

```
amiga-demo/
  index.html
  src/
    main.js              # bootstrap, RAF loop
    director.js          # timeline scheduler + transitions
    timeline.js          # part order, durations, transitions
    text.js              # ALL visible on-screen text (edit here)
    gl/
      context.js         # WebGL2 setup
      framebuffer.js     # FBO helpers
      quad.js            # fullscreen quad
      blit.js            # FBO -> screen + CRT overlay + flash + shake
      palette.js         # 32-color palettes per part, palette texture
    parts/
      _shaderpart.js     # helper for fullscreen-shader effects
      transitions.js     # fade / wipe / flash / tear shaders
      registry.js
      *.js               # one file per effect
    util/
      time.js            # deterministic clock, pause/resume
      input.js           # keys, fullscreen, click-to-start
      math.js            # mat4, fast sin/cos LUT
      font.js            # procedural 8x8 bitmap font + atlas
  README.md
```

The whole demo renders into a **320×256** internal framebuffer (low-res Amiga PAL feel) and is upscaled with nearest-neighbor to the viewport. Optional CRT overlay adds scanlines, mild chromatic aberration, and a vignette.

## Editing

- **All on-screen text**: edit `src/text.js` (intro, sinescroller, greetz list, outro credits — one place).
- **Part order / durations / transitions**: edit `src/timeline.js`.
- **Palettes**: edit `src/gl/palette.js` (`PALETTES` map).
- **Per-part parameters**: each effect file in `src/parts/` is self-contained.

## Browser support

Targets the **latest Chrome stable**, desktop. Requires WebGL2 (any modern Chrome on a normal GPU).

## Credits

- Code, design, pixels: **Julebord 2026**
- No audio (intentional)
- No third-party assets — everything procedural

Pixels before polygons. Merry Christmas.
