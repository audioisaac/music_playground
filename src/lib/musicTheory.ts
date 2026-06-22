// Pure music-theory helpers: scales, diatonic triads, and chord building.
// No browser or audio dependencies so this module is fully unit-testable.

import type {
  Degree,
  Extension,
  Key,
  NoteName,
  Quality,
  QualityMode,
  ResolvedChord,
} from "../types";

export const NOTE_NAMES: NoteName[] = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

/** Semitone offsets from the tonic for each scale degree (0-indexed degree). */
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const NATURAL_MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];

/** Diatonic triad qualities for each degree (0-indexed) in major / minor. */
const MAJOR_TRIAD_QUALITIES: Quality[] = [
  "major",
  "minor",
  "minor",
  "major",
  "major",
  "minor",
  "diminished",
];
const MINOR_TRIAD_QUALITIES: Quality[] = [
  "minor",
  "diminished",
  "major",
  "minor",
  "minor",
  "major",
  "major",
];

function pitchClass(root: NoteName): number {
  return NOTE_NAMES.indexOf(root);
}

/**
 * Parse a Tone-style note name ("C4", "D#5") into a MIDI number (C4 = 60).
 * Sharps only, matching how `buildChord` spells notes.
 */
export function noteToMidi(note: string): number {
  const m = /^([A-G]#?)(-?\d+)$/.exec(note);
  if (!m) throw new Error(`Bad note name: ${note}`);
  const pc = NOTE_NAMES.indexOf(m[1] as NoteName);
  const octave = parseInt(m[2], 10);
  return (octave + 1) * 12 + pc;
}

/**
 * Semitone offsets of a chord's notes relative to its lowest note, e.g.
 * ["C4","E4","G4"] -> [0,4,7]. Used by the vocal harmonizer to shift the live
 * voice into the chord (relative harmony — independent of the sung pitch).
 */
export function relativeIntervals(notes: string[]): number[] {
  if (notes.length === 0) return [];
  const midis = notes.map(noteToMidi);
  const low = Math.min(...midis);
  return midis.map((m) => m - low);
}

/**
 * Inverse of `noteToMidi`: a MIDI number to a Tone-style note name (C4 = 60),
 * spelled with sharps. Used to display the sung pitch and live harmony notes.
 */
export function midiToNoteName(midi: number): string {
  const m = Math.round(midi);
  const pc = ((m % 12) + 12) % 12;
  const octave = Math.floor(m / 12) - 1;
  return `${NOTE_NAMES[pc]}${octave}`;
}

/** Roman numeral label for a degree given its quality. */
export function romanNumeral(degree: Degree, quality: Quality): string {
  const base = ["I", "II", "III", "IV", "V", "VI", "VII"][degree - 1];
  if (quality === "minor") return base.toLowerCase();
  if (quality === "diminished") return base.toLowerCase() + "°";
  if (quality === "augmented") return base + "+";
  return base;
}

/** The semitone interval set above the chord root for a quality. */
function triadIntervals(quality: Quality): number[] {
  switch (quality) {
    case "major":
      return [0, 4, 7];
    case "minor":
      return [0, 3, 7];
    case "diminished":
      return [0, 3, 6];
    case "augmented":
      return [0, 4, 8];
  }
}

/**
 * The diatonic root pitch-class and quality for a scale degree in a key.
 */
export function diatonicTriad(
  key: Key,
  degree: Degree,
): { rootPc: number; quality: Quality } {
  const scale = key.mode === "major" ? MAJOR_SCALE : NATURAL_MINOR_SCALE;
  const qualities =
    key.mode === "major" ? MAJOR_TRIAD_QUALITIES : MINOR_TRIAD_QUALITIES;
  const idx = degree - 1;
  const rootPc = (pitchClass(key.root) + scale[idx]) % 12;
  return { rootPc, quality: qualities[idx] };
}

/** Apply a major/minor override (borrowed chord) to a base quality. */
function applyOverride(base: Quality, mode: QualityMode): Quality {
  if (mode === "majorOverride") return "major";
  if (mode === "minorOverride") return "minor";
  return base;
}

/**
 * Build the actual notes for a chord. Pitch classes are voiced into octave 4,
 * wrapping upward so the chord stays in a tidy range.
 */
export function buildChord(
  key: Key,
  degree: Degree,
  qualityMode: QualityMode = "diatonic",
  extension: Extension = "none",
  baseOctave = 4,
): ResolvedChord {
  const { rootPc, quality: diatonicQuality } = diatonicTriad(key, degree);
  const quality = applyOverride(diatonicQuality, qualityMode);

  let intervals = [...triadIntervals(quality)];

  // Extensions / "special chords" from the modifier hand.
  switch (extension) {
    case "sus2":
      // Replace the third with a major second.
      intervals = [0, 2, 7];
      break;
    case "sus4":
      // Replace the third with a perfect fourth.
      intervals = [0, 5, 7];
      break;
    case "seventh": {
      // Add a seventh appropriate to the chord quality.
      // Dominant chords (major triad on V, or any major-override) get a b7;
      // minor chords get a b7; major (non-dominant) gets a major 7.
      const seventh =
        quality === "major" && degree !== 5 && qualityMode !== "majorOverride"
          ? 11
          : 10;
      intervals.push(seventh);
      break;
    }
    case "add9":
      intervals.push(14);
      break;
    case "none":
    default:
      break;
  }

  const notes = intervals.map((semi) => {
    const pc = (rootPc + semi) % 12;
    const octaveBump = Math.floor((rootPc + semi) / 12);
    return `${NOTE_NAMES[pc]}${baseOctave + octaveBump}`;
  });

  return {
    key,
    degree,
    qualityMode,
    extension,
    quality,
    notes,
    name: chordName(NOTE_NAMES[rootPc], quality, extension),
  };
}

/** Human-readable chord name, e.g. "Cmaj7", "Dsus4", "Bdim". */
export function chordName(
  root: NoteName,
  quality: Quality,
  extension: Extension,
): string {
  let suffix = "";
  switch (quality) {
    case "minor":
      suffix = "m";
      break;
    case "diminished":
      suffix = "dim";
      break;
    case "augmented":
      suffix = "aug";
      break;
    default:
      suffix = "";
  }

  switch (extension) {
    case "sus2":
      return `${root}sus2`;
    case "sus4":
      return `${root}sus4`;
    case "seventh":
      if (quality === "major") return `${root}7`; // dominant-style label
      if (quality === "minor") return `${root}m7`;
      if (quality === "diminished") return `${root}dim7`;
      return `${root}${suffix}7`;
    case "add9":
      return `${root}${suffix}add9`;
    default:
      return `${root}${suffix}`;
  }
}
