// Pure note-selection for the live harmonizer (Antares "chordal" style): given
// the sung pitch and the gesture chord, pick a target chord tone per harmony
// voice and turn it into a pitch-shift ratio. No audio deps -> unit-testable.

/** Pitch class (0..11) of a MIDI note. */
export function pitchClass(midi: number): number {
  return ((Math.round(midi) % 12) + 12) % 12;
}

/** The smallest MIDI note strictly above `midi` whose pitch class is in `pcs`. */
function nextChordToneAbove(midi: number, pcs: number[]): number {
  const base = Math.floor(midi);
  for (let cand = base + 1; cand <= base + 24; cand++) {
    if (pcs.includes(((cand % 12) + 12) % 12)) return cand;
  }
  return base + 12;
}

/**
 * Stack `voiceCount` harmony voices on chord tones above the sung note: voice i
 * is the i-th chord tone strictly above the previous one, so the harmonies voice
 * the gesture chord over the melody (and stay in-key no matter what you sing).
 */
export function assignHarmonyTargets(
  sungMidi: number,
  chordPcs: number[],
  voiceCount: number,
): number[] {
  const pcs = [...new Set(chordPcs.map((p) => ((p % 12) + 12) % 12))].sort(
    (a, b) => a - b,
  );
  if (pcs.length === 0 || voiceCount <= 0) return [];
  const targets: number[] = [];
  let m = sungMidi;
  for (let i = 0; i < voiceCount; i++) {
    m = nextChordToneAbove(m, pcs);
    targets.push(m);
  }
  return targets;
}

/** Pitch-shift ratio (target/​sung frequency) to move `sungMidi` to `targetMidi`. */
export function shiftRatio(sungMidi: number, targetMidi: number): number {
  return Math.pow(2, (targetMidi - sungMidi) / 12);
}
