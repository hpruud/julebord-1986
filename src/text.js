// Central text content for all parts of the demo.
// Edit strings here to change what appears on screen — no need to touch the part code.
//
// Notes:
// - The bitmap font is uppercase-only (lowercase letters get auto-uppercased on render).
//   So `'Julebord 2026'` will render as `JULEBORD 2026`. Keep your case as you like
//   it in the source — visually it makes no difference today.
// - Width limits @ internal resolution 320 px:
//     scale 4: max 10 chars  (8*4 px each)
//     scale 3: max 13 chars
//     scale 2: max 20 chars
//     scale 1: max 40 chars
//   Strings longer than the canvas width will overflow; trim or lower the scale.

export const TEXT = {
  // ---- Part 0: intro_logo ------------------------------------------------
  intro: {
    big:   'ACADEMY',         // scale 4 christmas-wave colors
    line2: 'presents',        // scale 2 white
    line3: 'Julebord 1986 Demo',   // scale 2 gold + red shadow
  },

  // ---- Part 12: sinescroller --------------------------------------------
  // One long string; rendered char-by-char along a sine wave. Pad with
  // leading/trailing spaces so the loop doesn't snap. Use ' * ' as a separator.
  sinescroller:
  '   ACADEMY JULEBORD 1986 DEMO  *  MERRY CHRISTMAS FROM THE WHOLE CREW  *  ' +
    'HO HO HO  *  SANTA IS COMING TO TOWN  *  ' +
    'JINGLE BELLS JINGLE BELLS JINGLE ALL THE WAY  *  ' +
    'REINDEER ON THE ROOFTOPS AND PIXELS ON THE SCREEN  *  ' +
    'STAY WARM EAT COOKIES KEEP CODING  *  PIXELS BEFORE POLYGONS  *   ',

  // ---- Part 11: greetzscroller ------------------------------------------
  greetz: {
    header: 'J U L E B O R D  1 9 8 6  D E M O',  // pulsing top banner
    list: [
      'MADE BY ACADEMY IN 2026',
      '',
      'MERRY CHRISTMAS TO',
      'ALL THE OLD CREWS',
      'THE DEMOSCENE',
      'CHIP MUSICIANS EVERYWHERE',
      'PIXEL ARTISTS PAST AND PRESENT',
      'KEEPERS OF THE ASSEMBLER',
      'THE MODERN CODERS',
      'ALL THE SANTAS WORLDWIDE',
      'THE REINDEER FLIGHT TEAM',
      'THE ELVES IN THE WORKSHOP',
      'EVERY SNOWFLAKE FALLING NOW',
      'THOSE STILL RUNNING AMIGAS',
      'THOSE EMULATING DREAMS',
      '',
      'AND TO YOU',
      'WATCHING THIS RIGHT NOW',
      'BY THE FIRE WITH COOKIES',
      '',
      'STAY WARM',
      'STAY CREATIVE',
      'KEEP THE SCENE ALIVE',
      '',
      'HAPPY JULEBORD 1986',
      'FROM ACADEMY',
      'HO HO HO',
      '',
      'A SPECIAL GREETING GOES TO PATIENT',
	  'YOU ARE NEVER FORGOTTEN...',
    ],
  },

  // ---- Part 13: outro_credits -------------------------------------------
  // Each entry is [text, scale]. Empty string = vertical spacer.
  // For the crew table we pre-pad every row to the same length so that all
  // four rows centre to the same X — this keeps the "label" and "value"
  // columns aligned. (Each line is centered independently in the renderer,
  // so identical-length strings line up.) Longest row dictates the padding:
  // "MUSIC    EQUALIZER" = 18 chars.
  outro: {
    lines: [
      ['JULEBORD 1986 DEMO', 2],
      ['', 1],
      ['CODE     SADDAM   ',     1],
      ['DESIGN   SADDAM   ',     1],
      ['PIXELS   SADDAM   ',     1],
      ['MUSIC    EQUALIZER',     1],
      ['', 1],
      ['MERRY CHRISTMAS', 2],
      ['', 1],
      ['-=* PIXELS BEFORE POLYGONS *=-', 1],
      ['', 1],
      ["BAHA'I", 2],
      ['', 1],
      ['A PRODUCTION BY', 1],
      ['ACADEMY IN 2026', 2],
      ['', 1],
      ['THE END - PRESS SPACE TO RESTART', 1],
    ],
  },
};
