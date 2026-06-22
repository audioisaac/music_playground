// Real-time harmony DECISION engine (no audio/DOM deps → fully unit-testable).
//
// This is the "brain" that replaces fixed-interval harmonies (lead + 3 / +7 /
// +12) with a small constrained-optimization solver: given the sung melody note
// and the current chord, it scores candidate notes (chord-fit, voice-leading,
// vocal range, dissonance, spacing) and picks an SATB voice assignment that
// sounds like a choir reacting to a singer.
//
// It runs on the MAIN thread at control rate (~30 ms), NOT inside the
// AudioWorklet — the worklet just pitch-shifts by an AudioParam, so the heavy
// scoring never touches the audio callback. The search space is tiny
// (≤ ~8 candidates × 3 free voices), so a full search costs microseconds.

export type Voice = "soprano" | "alto" | "tenor" | "bass";

export interface VoiceRange {
  lo: number;
  hi: number;
}

/** Comfortable SATB vocal ranges (MIDI note numbers). */
export const SATB_RANGES: Record<Voice, VoiceRange> = {
  soprano: { lo: 60, hi: 81 },
  alto: { lo: 55, hi: 74 },
  tenor: { lo: 48, hi: 69 },
  bass: { lo: 40, hi: 60 },
};

/** Voices from lowest to highest (the no-crossing order). */
export const VOICE_ORDER: Voice[] = ["bass", "tenor", "alto", "soprano"];

export interface HarmonyContext {
  /** Chord-tone pitch classes (0..11). */
  chordPcs: number[];
  /** Chord root pitch class (0..11). */
  rootPc: number;
  /** Consonant tension pitch classes (e.g. 9th, 13th). */
  extensionPcs: number[];
}

export interface SatbAssignment {
  soprano: number;
  alto: number;
  tenor: number;
  bass?: number;
}

// Scoring weights. Higher score = better; penalties are negative.
const W = {
  chordTone: 10,
  extension: 5,
  tension: 2,
  voiceLeading: 1.0, // per semitone of motion from the previous frame
  rangeEdge: 0.5, // per semitone into a range's soft edge
  dissonanceM2: 8, // major-2nd cluster
  dissonancem2: 14, // minor-2nd cluster (harsher)
  dissonanceTritone: 6, // tritone between non-chord tones
  spacingGap: 0.5, // per semitone of excess gap between adjacent voices
} as const;

const RANGE_EDGE_MARGIN = 3; // semitones of "soft edge" at each end of a range
const UPPER_MAX_GAP = 12; // octave max between adjacent upper voices
const BASS_MAX_GAP = 19; // bass may sit a 12th below the tenor

function pc(midi: number): number {
  return ((Math.round(midi) % 12) + 12) % 12;
}

function uniq(xs: number[]): number[] {
  return [...new Set(xs)];
}

/**
 * Build a harmony context from a chord's MIDI notes (e.g. [60,64,67] for C).
 * Extensions default to the 9th and 13th above the root (the spec's "C E G A").
 */
export function contextFromMidis(chordMidis: number[]): HarmonyContext {
  const chordPcs = uniq(chordMidis.map(pc));
  const rootPc = pc(Math.min(...chordMidis));
  const extensionPcs = [(rootPc + 2) % 12, (rootPc + 9) % 12].filter(
    (p) => !chordPcs.includes(p),
  );
  return { chordPcs, rootPc, extensionPcs };
}

// ── Step A — candidate generation ────────────────────────────────────────────

/** Every in-range MIDI note whose pitch class is a chord tone or extension. */
export function generateCandidates(ctx: HarmonyContext, voice: Voice): number[] {
  const pcs = new Set([...ctx.chordPcs, ...ctx.extensionPcs].map((p) => ((p % 12) + 12) % 12));
  const { lo, hi } = SATB_RANGES[voice];
  const out: number[] = [];
  for (let m = lo; m <= hi; m++) if (pcs.has(pc(m))) out.push(m);
  return out;
}

// ── Step B — scoring ─────────────────────────────────────────────────────────

/** Chord tone (+10) > extension (+5) > any other tension (+2). */
export function chordFitScore(midi: number, ctx: HarmonyContext): number {
  const p = pc(midi);
  if (ctx.chordPcs.includes(p)) return W.chordTone;
  if (ctx.extensionPcs.includes(p)) return W.extension;
  return W.tension;
}

/** Reward stepwise motion; penalize large jumps from the previous frame. */
export function voiceLeadingScore(midi: number, prevMidi: number | undefined): number {
  if (prevMidi == null) return 0;
  return -W.voiceLeading * Math.abs(midi - prevMidi);
}

/** 0 well inside the range, soft penalty toward the edges, −∞ outside. */
export function rangePenalty(midi: number, voice: Voice): number {
  const { lo, hi } = SATB_RANGES[voice];
  if (midi < lo || midi > hi) return -Infinity;
  const below = Math.max(0, lo + RANGE_EDGE_MARGIN - midi);
  const above = Math.max(0, midi - (hi - RANGE_EDGE_MARGIN));
  return -W.rangeEdge * (below + above) || 0; // `|| 0` collapses -0 to 0
}

/**
 * Penalize a harsh interval between two voices. Minor/major-2nd clusters are
 * always bad; a tritone is allowed only when both notes are chord tones (so a
 * dominant chord's chordal tritone is fine, an incidental one is not).
 */
export function pairDissonance(a: number, b: number, ctx: HarmonyContext): number {
  const ic = Math.abs(Math.round(a) - Math.round(b)) % 12;
  if (ic === 1) return -W.dissonancem2;
  if (ic === 2) return -W.dissonanceM2;
  if (ic === 6) {
    const bothChord = ctx.chordPcs.includes(pc(a)) && ctx.chordPcs.includes(pc(b));
    return bothChord ? 0 : -W.dissonanceTritone;
  }
  return 0;
}

/** Crossing (higher < lower) is forbidden; oversized gaps are mildly penalized. */
export function spacingPenalty(lower: number, higher: number, isBassPair: boolean): number {
  if (higher < lower) return -Infinity;
  const maxGap = isBassPair ? BASS_MAX_GAP : UPPER_MAX_GAP;
  const excess = Math.max(0, higher - lower - maxGap);
  return -W.spacingGap * excess;
}

// ── Step C — optimizer ───────────────────────────────────────────────────────

function rangeCentre(v: Voice): number {
  const { lo, hi } = SATB_RANGES[v];
  return (lo + hi) / 2;
}

/** The SATB part the sung melody occupies: a containing range nearest in tessitura. */
export function pickLeadVoice(midi: number): Voice {
  const containing = VOICE_ORDER.filter(
    (v) => midi >= SATB_RANGES[v].lo && midi <= SATB_RANGES[v].hi,
  );
  const pool = containing.length ? containing : [...VOICE_ORDER];
  return pool.reduce((best, v) =>
    Math.abs(midi - rangeCentre(v)) < Math.abs(midi - rangeCentre(best)) ? v : best,
  );
}

function scoreAssignment(
  map: Partial<Record<Voice, number>>,
  ctx: HarmonyContext,
  prev: Partial<SatbAssignment> | null,
): number {
  const ordered = VOICE_ORDER.filter((v) => map[v] != null);
  let s = 0;
  for (const v of ordered) {
    const m = map[v] as number;
    const rp = rangePenalty(m, v);
    if (rp === -Infinity) return -Infinity;
    s += chordFitScore(m, ctx) + rp + voiceLeadingScore(m, prev?.[v]);
  }
  for (let i = 1; i < ordered.length; i++) {
    const sp = spacingPenalty(
      map[ordered[i - 1]] as number,
      map[ordered[i]] as number,
      ordered[i - 1] === "bass",
    );
    if (sp === -Infinity) return -Infinity;
    s += sp;
  }
  for (let i = 0; i < ordered.length; i++)
    for (let j = i + 1; j < ordered.length; j++)
      s += pairDissonance(map[ordered[i]] as number, map[ordered[j]] as number, ctx);
  return s;
}

/**
 * Choose the best SATB note assignment for the current melody + chord.
 *
 * The sung melody is PINNED to its SATB part (it is the dry lead, heard
 * directly), and the other `voiceCount` parts are solved by full search over
 * their in-range chord/extension candidates, keeping voice-leading continuity
 * with `prev`. The lead part in the result equals (the rounded) `melodyMidi`.
 */
export function assignVoices(
  ctx: HarmonyContext,
  melodyMidi: number,
  prev: Partial<SatbAssignment> | null,
  voiceCount = 3,
): SatbAssignment {
  const lead = pickLeadVoice(melodyMidi);
  const leadMidi = Math.round(melodyMidi);
  const freeVoices = VOICE_ORDER.filter((v) => v !== lead).slice(0, voiceCount);
  const cands = freeVoices.map((v) => generateCandidates(ctx, v));

  const pinned: Partial<Record<Voice, number>> = { [lead]: leadMidi };
  let best: { score: number; map: Partial<Record<Voice, number>> } | null = null;

  const total = cands.reduce((a, c) => a * Math.max(c.length, 1), 1);
  for (let n = 0; n < total; n++) {
    const map: Partial<Record<Voice, number>> = { ...pinned };
    let rem = n;
    let ok = true;
    for (let k = 0; k < freeVoices.length; k++) {
      const c = cands[k];
      if (c.length === 0) {
        ok = false;
        break;
      }
      map[freeVoices[k]] = c[rem % c.length];
      rem = Math.floor(rem / c.length);
    }
    if (!ok) continue;
    const score = scoreAssignment(map, ctx, prev);
    if (score > -Infinity && (!best || score > best.score)) best = { score, map };
  }

  const map = best?.map ?? fallbackAssignment(ctx, pinned, freeVoices);
  return {
    soprano: map.soprano ?? leadMidi,
    alto: map.alto ?? leadMidi,
    tenor: map.tenor ?? leadMidi,
    bass: map.bass,
  };
}

/** If no valid combination is found, place each free voice on its nearest chord tone. */
function fallbackAssignment(
  ctx: HarmonyContext,
  pinned: Partial<Record<Voice, number>>,
  freeVoices: Voice[],
): Partial<Record<Voice, number>> {
  const map: Partial<Record<Voice, number>> = { ...pinned };
  for (const v of freeVoices) {
    const cands = generateCandidates(ctx, v);
    const centre = rangeCentre(v);
    map[v] = cands.length
      ? cands.reduce((b, m) => (Math.abs(m - centre) < Math.abs(b - centre) ? m : b))
      : Math.round(centre);
  }
  return map;
}
