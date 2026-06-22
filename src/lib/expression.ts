// Pure mapping from hand motion to live sound parameters (MiMU-style
// expression). No audio/browser deps so it is fully unit-testable.

import type { HandMotion } from "./handShape";

/** Which motion axes are active. Disabled axes hold the neutral value. */
export interface MotionConfig {
  enabled: boolean;
  volume: boolean; // hand height -> loudness
  brightness: boolean; // hand distance -> filter cutoff
  bend: boolean; // hand tilt -> pitch bend
  reverb: boolean; // hand left/right -> reverb wet
}

export const DEFAULT_MOTION: MotionConfig = {
  enabled: false,
  volume: true,
  brightness: true,
  bend: true,
  reverb: true,
};

/** Resolved expression sent to the audio engine. */
export interface Expression {
  volume: number; // linear gain, 0..1
  brightnessHz: number; // low-pass cutoff
  bendCents: number; // synth detune
  reverbWet: number; // 0..1
}

// Neutral = no audible effect: full volume, fully open filter, no bend, dry.
export const NEUTRAL_EXPRESSION: Expression = {
  volume: 1,
  brightnessHz: 12000,
  bendCents: 0,
  reverbWet: 0,
};

const MIN_HZ = 300;
const MAX_HZ = 8000;
const MAX_BEND_CENTS = 200;
const MAX_REVERB = 0.6;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function mapMotionToExpression(
  m: HandMotion,
  cfg: MotionConfig,
): Expression {
  if (!cfg.enabled) return NEUTRAL_EXPRESSION;
  return {
    volume: cfg.volume ? lerp(0.1, 1, m.y) : NEUTRAL_EXPRESSION.volume,
    // Log-ish sweep so the cutoff feels even across the range.
    brightnessHz: cfg.brightness
      ? Math.round(MIN_HZ * Math.pow(MAX_HZ / MIN_HZ, m.size))
      : NEUTRAL_EXPRESSION.brightnessHz,
    bendCents: cfg.bend ? Math.round(m.roll * MAX_BEND_CENTS) : 0,
    reverbWet: cfg.reverb ? m.x * MAX_REVERB : 0,
  };
}
