// Shared domain types for the gesture chord synth.

/** Pitch-class names we use for roots and notes (sharps spelling). */
export type NoteName =
  | "C"
  | "C#"
  | "D"
  | "D#"
  | "E"
  | "F"
  | "F#"
  | "G"
  | "G#"
  | "A"
  | "A#"
  | "B";

/** A musical key = tonic + mode. */
export type Mode = "major" | "minor";
export interface Key {
  root: NoteName;
  mode: Mode;
}

/** Scale degree selected by the primary hand. 1..7 (Roman numerals I..vii). */
export type Degree = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Triad quality. */
export type Quality = "major" | "minor" | "diminished" | "augmented";

/**
 * How the chord quality relates to the key.
 * - `diatonic`: use the naturally occurring quality for this degree.
 * - `majorOverride` / `minorOverride`: borrow a chord outside the key
 *   (e.g. C minor while in C major).
 */
export type QualityMode = "diatonic" | "majorOverride" | "minorOverride";

/** Extension / "special chord" contributed by the modifier hand. */
export type Extension = "none" | "sus2" | "sus4" | "seventh" | "add9";

/** Which physical hand a detection belongs to (as reported by MediaPipe). */
export type Handedness = "Left" | "Right";

/** Role a hand plays in the instrument. */
export type HandRole = "primary" | "modifier";

/** Which way a hand points (wrist→fingers). Drives the quality override. */
export type Orientation = "up" | "down" | "side";

/** Where the sustained sound comes from. */
export type SoundSource = "synth" | "vocal";

/** What keeps a chord sounding. */
export type SustainMode = "hand" | "voice";

/** Persisted audio preferences. */
export interface SoundSettings {
  source: SoundSource;
  sustainMode: SustainMode;
  /** Vocal mode: output harmonies only (mute dry lead) to reduce feedback. */
  harmoniesOnly: boolean;
  /** 0..1; higher = the voice gate triggers on quieter singing. */
  sensitivity: number;
  /** Selected audio devices (deviceId); undefined = system default. */
  inputDeviceId?: string;
  outputDeviceId?: string;
  /** MiMU-style motion-to-sound mapping (see lib/expression.ts MotionConfig). */
  motion: import("./lib/expression").MotionConfig;
}

/**
 * A normalized, pose-invariant description of a whole hand shape ("outline"):
 * a flat [x0,y0,x1,y1,...] vector of the 21 landmarks. See lib/handShape.ts.
 */
export type PoseVector = number[];

export interface HandPose {
  handedness: Handedness;
  /** Normalized whole-hand shape vector, used for gesture matching. */
  pose: PoseVector;
  /** Which way the hand points — orthogonal to the shape match. */
  orientation: Orientation;
  /** Raw 21 landmarks (normalized 0..1), kept for the overlay. */
  landmarks: Array<{ x: number; y: number; z: number }>;
}

/** The fully resolved chord the engine wants to sound. */
export interface ResolvedChord {
  key: Key;
  degree: Degree;
  qualityMode: QualityMode;
  extension: Extension;
  /** Final triad/extended quality after override is applied. */
  quality: Quality;
  /** Tone.js note names, e.g. ["C4","E4","G4"]. */
  notes: string[];
  /** Human label, e.g. "Cmaj7" or "Dsus4". */
  name: string;
}

/** One entry in a recorded session timeline. */
export interface ChordEvent {
  /** Milliseconds since recording start. */
  t: number;
  action: "on" | "off";
  chord?: ResolvedChord;
}

/** A saved recording: audio + replayable event timeline. */
export interface RecordedSession {
  id: string;
  createdAt: number;
  durationMs: number;
  /** Object URL is recreated on load; the blob is what we persist. */
  audioBlob?: Blob;
  timeline: ChordEvent[];
}
