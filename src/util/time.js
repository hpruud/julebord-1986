// Deterministic clock that starts at first user gesture.
let startMs = 0;
let started = false;
let pausedAt = 0;
let totalPaused = 0;
let isPaused = false;

export function startClock() {
  if (started) return;
  started = true;
  startMs = performance.now();
}

export function now() {
  if (!started) return 0;
  if (isPaused) return pausedAt - startMs - totalPaused;
  return performance.now() - startMs - totalPaused;
}

export function pause() {
  if (!started || isPaused) return;
  isPaused = true;
  pausedAt = performance.now();
}

export function resume() {
  if (!isPaused) return;
  totalPaused += performance.now() - pausedAt;
  isPaused = false;
}

export function isStarted() { return started; }
