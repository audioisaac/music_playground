// Pure pitch helpers (no audio/browser deps) so the voice sampler can be tuned
// to the recorded sample's base pitch, and so they are unit-testable.

/**
 * Estimate the fundamental frequency (Hz) of a mono sample buffer via
 * autocorrelation. Returns 0 when no clear pitch is found (too quiet/noisy).
 */
export function estimatePitchHz(samples: Float32Array, sampleRate: number): number {
  const n = samples.length;
  if (n < 2) return 0;

  // Require enough signal energy to bother (RMS gate).
  let sumSq = 0;
  for (let i = 0; i < n; i++) sumSq += samples[i] * samples[i];
  const rms = Math.sqrt(sumSq / n);
  if (rms < 0.01) return 0;

  // Search the human-voice range ~70..1000 Hz.
  const minLag = Math.floor(sampleRate / 1000);
  const maxLag = Math.min(Math.floor(sampleRate / 70), Math.floor(n / 2));

  // Raw (un-normalized) correlation: the running sum has fewer terms as the lag
  // grows, so the true period beats its octave-down multiples instead of losing
  // to them (which is what dividing by (n-lag) caused).
  let bestLag = -1;
  let bestCorr = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    for (let i = 0; i < n - lag; i++) corr += samples[i] * samples[i + lag];
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  // Reject weak correlations relative to the zero-lag energy (sumSq).
  if (bestLag <= 0 || bestCorr < sumSq * 0.3) return 0;

  // Parabolic interpolation around the peak for sub-sample accuracy.
  const lag = parabolicPeak(samples, bestLag, n);
  return sampleRate / lag;
}

/** Refine the integer peak lag using its neighbours (parabolic vertex). */
function parabolicPeak(samples: Float32Array, lag: number, n: number): number {
  const corrAt = (l: number) => {
    if (l < 1 || l >= n / 2) return 0;
    let c = 0;
    for (let i = 0; i < n - l; i++) c += samples[i] * samples[i + l];
    return c;
  };
  const a = corrAt(lag - 1);
  const b = corrAt(lag);
  const c = corrAt(lag + 1);
  const denom = a - 2 * b + c;
  if (denom === 0) return lag;
  return lag + (0.5 * (a - c)) / denom;
}

/** MIDI note number for a frequency (A4 = 440 Hz = 69). */
export function hzToMidi(hz: number): number {
  return Math.round(69 + 12 * Math.log2(hz / 440));
}

/**
 * Fractional MIDI note for a frequency (un-rounded). The live harmonizer needs
 * the exact sung pitch so a harmony shift `target − sung` lands the harmony on
 * the integer target even when the singer is slightly flat/sharp.
 */
export function hzToMidiPrecise(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}
