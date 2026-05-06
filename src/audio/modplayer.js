// Hand-written ProTracker / Soundtracker .mod player (Amiga 4-channel).
//
// Scope: tuned for the 15-sample Ultimate Soundtracker mod shipped with this
// demo (assets/somewhere.mod). Auto-detects 15- vs 31-sample format via the
// 4-byte signature at offset 1080. Implements the effects this mod actually
// uses: Cxx (set channel volume) and E0x (filter on/off, no-op since we have
// no Amiga LED filter to emulate). Other ProTracker effects are parsed and
// silently ignored -- enough to play the embedded mod cleanly while keeping
// the player small.
//
// Audio backend: AudioWorklet. The worklet processor receives a fully parsed
// song (samples + patterns + order list) up front via port message, then
// runs a tick-based sequencer + 4-channel mixer in pull-mode. The main
// thread only handles play/stop/volume/mute via param/messaging.
//
// Tempo math (Soundtracker default):
//   ticks_per_row = 6, vblank rate = 50 Hz (PAL)
//   row rate = 50 / 6 ~= 8.33 rows/sec
//   samples_per_tick = sampleRate / 50
//
// Pitch (Paula chip semantics):
//   playback frequency = 7093789.2 / (2 * period)   (PAL Amiga clock)

import { MOD_BYTES } from './song.js';

// -------- Parser --------

const PERIOD_TABLE = [
  // C-1..B-3 (3 octaves), index = noteIdx
  856, 808, 762, 720, 678, 640, 604, 570, 538, 508, 480, 453,
  428, 404, 381, 360, 339, 320, 302, 285, 269, 254, 240, 226,
  214, 202, 190, 180, 170, 160, 151, 143, 135, 127, 120, 113,
];

function parseMod(bytes) {
  // Detect format by signature at offset 1080.
  const sigBuf = bytes.slice(1080, 1084);
  const sig = String.fromCharCode(sigBuf[0], sigBuf[1], sigBuf[2], sigBuf[3]);
  const knownSigs = ['M.K.', 'M!K!', 'FLT4', '4CHN'];
  const is31 = knownSigs.includes(sig);
  const numSamples = is31 ? 31 : 15;
  const headerLen = is31 ? 1084 : 600;
  const numChannels = 4; // both formats covered here are 4-ch

  const songName = readZString(bytes, 0, 20);

  // Parse sample headers. Each is 30 bytes:
  //   [0..21]  sample name (ASCII, NUL-padded)
  //   [22..23] length in WORDS (big-endian) -> bytes = 2*length
  //   [24]     finetune (low nibble, signed 4-bit)
  //   [25]     volume 0..64
  //   [26..27] repeat-start in WORDS -> bytes = 2*rs
  //   [28..29] repeat-length in WORDS -> bytes = 2*rl
  const samples = [];
  for (let i = 0; i < numSamples; i++) {
    const off = 20 + i * 30;
    const name = readZString(bytes, off, 22);
    const lengthWords = (bytes[off + 22] << 8) | bytes[off + 23];
    const ftRaw = bytes[off + 24] & 0x0f;
    const finetune = ftRaw < 8 ? ftRaw : ftRaw - 16;  // signed 4-bit
    const volume = bytes[off + 25];
    const rsWords = (bytes[off + 26] << 8) | bytes[off + 27];
    const rlWords = (bytes[off + 28] << 8) | bytes[off + 29];
    samples.push({
      name,
      lengthBytes: lengthWords * 2,
      finetune,
      volume,
      loopStart: rsWords * 2,
      loopLength: rlWords * 2, // rl <= 2 means "no loop"
      // pcm: filled in below (Float32Array of signed PCM scaled to -1..1)
      pcm: null,
    });
  }

  // Song length, restart, pattern table.
  // 15-sample: at offsets 470, 471, 472..599
  // 31-sample: at offsets 950, 951, 952..1079
  const tblBase = is31 ? 950 : 470;
  const songLength = bytes[tblBase];
  const restart = bytes[tblBase + 1];
  const orderTable = Array.from(bytes.slice(tblBase + 2, tblBase + 2 + 128));

  // Number of distinct patterns = 1 + max(orderTable[0..songLength-1]).
  let maxPattern = 0;
  for (let i = 0; i < songLength; i++) {
    if (orderTable[i] > maxPattern) maxPattern = orderTable[i];
  }
  const numPatterns = maxPattern + 1;

  // Pattern data: numPatterns * 64 rows * numChannels cells * 4 bytes/cell.
  const patterns = [];
  let off = headerLen;
  for (let p = 0; p < numPatterns; p++) {
    const rows = [];
    for (let r = 0; r < 64; r++) {
      const row = [];
      for (let c = 0; c < numChannels; c++) {
        const b0 = bytes[off + 0];
        const b1 = bytes[off + 1];
        const b2 = bytes[off + 2];
        const b3 = bytes[off + 3];
        // Standard cell layout:
        //   sample = (b0 & 0xF0) | (b2 >> 4)        (1..numSamples, 0 = no sample)
        //   period = ((b0 & 0x0F) << 8) | b1
        //   effect = b2 & 0x0F
        //   param  = b3
        const sample = (b0 & 0xf0) | (b2 >> 4);
        const period = ((b0 & 0x0f) << 8) | b1;
        const effect = b2 & 0x0f;
        const param = b3;
        row.push({ sample, period, effect, param });
        off += 4;
      }
      rows.push(row);
    }
    patterns.push(rows);
  }

  // Sample data: raw 8-bit signed PCM. Convert to Float32 -1..1.
  for (const s of samples) {
    if (s.lengthBytes > 0) {
      const pcm = new Float32Array(s.lengthBytes);
      for (let i = 0; i < s.lengthBytes; i++) {
        // signed 8-bit
        const b = bytes[off + i];
        const v = b < 128 ? b : b - 256;
        pcm[i] = v / 128.0;
      }
      s.pcm = pcm;
      off += s.lengthBytes;
    } else {
      s.pcm = new Float32Array(0);
    }
  }

  return {
    songName,
    numSamples,
    numChannels,
    samples,
    songLength,
    restart,
    orderTable,
    numPatterns,
    patterns,
  };
}

function readZString(bytes, off, maxLen) {
  let end = off;
  while (end < off + maxLen && bytes[end] !== 0) end++;
  return String.fromCharCode.apply(null, bytes.slice(off, end));
}

// -------- AudioWorklet processor source (string, loaded via blob URL) --------
//
// Receives the parsed song over the port; runs the sequencer + mixer in real
// time. Communicates back only for high-level events (e.g. song looped).
const WORKLET_SRC = `
class ModProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'volume', defaultValue: 0.6, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'muted',  defaultValue: 0,   minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.song = null;
    this.playing = false;
    // Sequencer state.
    this.songPos = 0;     // index into orderTable
    this.row = 0;         // 0..63
    this.tick = 0;        // 0..speed-1
    this.speed = 6;
    // Sample timing: number of audio samples remaining until next tick.
    this.samplesPerTick = 0;
    this.samplesUntilTick = 0;
    // 4 mix channels.
    this.ch = [];
    for (let i = 0; i < 4; i++) {
      this.ch.push({
        sampleIdx: 0,        // 1..15 (or 0 = none)
        position: 0,          // float index into pcm
        playbackRate: 0,      // pcm samples per output sample
        volume: 64,           // 0..64
        active: false,
      });
    }

    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'load') {
        this.song = m.song;
        this.reset();
      } else if (m.type === 'play') {
        this.playing = true;
      } else if (m.type === 'stop') {
        this.playing = false;
      } else if (m.type === 'reset') {
        this.reset();
      }
    };
  }

  reset() {
    this.songPos = 0;
    this.row = 0;
    this.tick = 0;
    this.speed = 6;
    // Soundtracker default tempo: 50 Hz vblank, 6 ticks per row.
    // samples_per_tick = sampleRate / 50.
    this.samplesPerTick = Math.floor(sampleRate / 50);
    this.samplesUntilTick = 0;
    for (const c of this.ch) {
      c.sampleIdx = 0;
      c.position = 0;
      c.playbackRate = 0;
      c.volume = 0;
      c.active = false;
    }
  }

  doTick() {
    if (!this.song) return;
    if (this.tick === 0) {
      // Process new row.
      const patIdx = this.song.orderTable[this.songPos];
      const rowCells = this.song.patterns[patIdx][this.row];
      for (let i = 0; i < 4; i++) {
        const cell = rowCells[i];
        const ch = this.ch[i];
        // If sample number present, set channel sample + reset volume.
        if (cell.sample > 0 && cell.sample <= this.song.samples.length) {
          ch.sampleIdx = cell.sample;
          ch.volume = this.song.samples[cell.sample - 1].volume;
        }
        // If period present, retrigger note at that pitch.
        if (cell.period > 0) {
          // freq = 7093789.2 / (2 * period); rate (pcm samples per output sample)
          //      = freq / sampleRate
          const freq = 7093789.2 / (2 * cell.period);
          ch.playbackRate = freq / sampleRate;
          ch.position = 0;
          ch.active = ch.sampleIdx > 0 && this.song.samples[ch.sampleIdx - 1].pcm.length > 0;
        }
        // Effects on tick 0.
        if (cell.effect === 0xC) {
          // Cxx: set volume (clamped to 0..64).
          ch.volume = Math.min(64, cell.param);
        }
        // E0x: filter on/off -- no-op (no LED filter to emulate).
        // Any other effect: silently ignored. The embedded mod uses only C and E0.
      }
    }
    // Advance tick / row / song position.
    this.tick++;
    if (this.tick >= this.speed) {
      this.tick = 0;
      this.row++;
      if (this.row >= 64) {
        this.row = 0;
        this.songPos++;
        if (this.songPos >= this.song.songLength) {
          // Loop back to start (or restart marker).
          this.songPos = this.song.restart < this.song.songLength ? this.song.restart : 0;
          this.port.postMessage({ type: 'loop' });
        }
      }
    }
  }

  process(inputs, outputs, parameters) {
    if (!this.playing || !this.song) {
      return true; // keep alive for resume
    }
    const out = outputs[0];
    const left = out[0];
    const right = out[1];
    const len = left.length;
    const masterVol = parameters.volume[0];
    const muted = parameters.muted[0] >= 0.5;
    const gainScale = muted ? 0 : masterVol;

    for (let i = 0; i < len; i++) {
      // Tick scheduler: advance song state every samplesPerTick output samples.
      if (this.samplesUntilTick <= 0) {
        this.doTick();
        this.samplesUntilTick = this.samplesPerTick;
      }
      this.samplesUntilTick--;

      // Mix 4 channels. Amiga panning: ch0,3 -> left, ch1,2 -> right.
      // Soften to ~0.7/0.3 split to avoid harsh hard-pan.
      let l = 0, r = 0;
      for (let c = 0; c < 4; c++) {
        const ch = this.ch[c];
        if (!ch.active || ch.sampleIdx === 0) continue;
        const samp = this.song.samples[ch.sampleIdx - 1];
        const pcm = samp.pcm;
        let pos = ch.position;
        if (pos >= pcm.length) {
          // No-loop sample: end of sample, deactivate.
          // (this mod has no looping samples; we still check for safety)
          if (samp.loopLength > 2) {
            // Loop sample: wrap pos back into [loopStart, loopStart+loopLength).
            pos = samp.loopStart + ((pos - samp.loopStart) % samp.loopLength);
            ch.position = pos;
          } else {
            ch.active = false;
            continue;
          }
        }
        // Linear interpolation between two adjacent pcm samples.
        const ipos = pos | 0;
        const frac = pos - ipos;
        const s0 = pcm[ipos] || 0;
        const s1 = (ipos + 1 < pcm.length) ? pcm[ipos + 1]
                 : (samp.loopLength > 2 ? pcm[samp.loopStart] : s0);
        const sm = (s0 + (s1 - s0) * frac) * (ch.volume / 64);
        if (c === 0 || c === 3) {
          l += sm * 0.7;
          r += sm * 0.3;
        } else {
          l += sm * 0.3;
          r += sm * 0.7;
        }
        ch.position += ch.playbackRate;
      }
      // Final gain + soft clip.
      l *= gainScale;
      r *= gainScale;
      // Soft clip via tanh-ish curve (cheap).
      if (l > 1) l = 1; else if (l < -1) l = -1;
      if (r > 1) r = 1; else if (r < -1) r = -1;
      left[i] = l;
      right[i] = r;
    }
    return true;
  }
}

registerProcessor('mod-processor', ModProcessor);
`;

// -------- Public API --------

let workletReadyPromise = null;
function ensureWorkletLoaded(audioCtx) {
  if (workletReadyPromise) return workletReadyPromise;
  const blob = new Blob([WORKLET_SRC], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  workletReadyPromise = audioCtx.audioWorklet.addModule(url);
  return workletReadyPromise;
}

export async function createModPlayer(audioCtx) {
  const song = parseMod(MOD_BYTES);
  await ensureWorkletLoaded(audioCtx);
  const node = new AudioWorkletNode(audioCtx, 'mod-processor', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  });
  // Send the parsed song. Float32Array sample buffers transfer cheaply.
  node.port.postMessage({ type: 'load', song: serializeSong(song) });
  node.connect(audioCtx.destination);

  const volumeParam = node.parameters.get('volume');
  const mutedParam = node.parameters.get('muted');

  let muted = false;
  let lastVolume = 0.6;
  volumeParam.value = lastVolume;
  mutedParam.value = 0;

  return {
    songName: song.songName,
    node,
    start() { node.port.postMessage({ type: 'play' }); },
    stop()  { node.port.postMessage({ type: 'stop' }); },
    suspend() { return audioCtx.suspend(); },
    resume()  { return audioCtx.resume(); },
    setVolume(v) {
      lastVolume = Math.max(0, Math.min(1, v));
      volumeParam.value = lastVolume;
    },
    toggleMute() {
      muted = !muted;
      mutedParam.value = muted ? 1 : 0;
      return muted;
    },
    isMuted() { return muted; },
    dispose() { node.disconnect(); },
  };
}

// Strip non-transferable bits (none here, but be explicit) and return a
// plain object suitable for postMessage.
function serializeSong(song) {
  return {
    songName: song.songName,
    numSamples: song.numSamples,
    numChannels: song.numChannels,
    samples: song.samples.map(s => ({
      name: s.name,
      lengthBytes: s.lengthBytes,
      finetune: s.finetune,
      volume: s.volume,
      loopStart: s.loopStart,
      loopLength: s.loopLength,
      pcm: s.pcm, // Float32Array, structured-cloned
    })),
    songLength: song.songLength,
    restart: song.restart,
    orderTable: song.orderTable,
    numPatterns: song.numPatterns,
    patterns: song.patterns,
  };
}
