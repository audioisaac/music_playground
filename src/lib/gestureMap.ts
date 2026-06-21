// The configurable layer that turns hand signatures into musical intent.
//
// Primary hand  -> scale degree (1..7)
// Modifier hand -> an extension ("special chord") OR a major/minor override
//
// Bindings are exact finger-pattern matches and take priority over the
// count-based fallback, so the calibration UI can bind any shape (notably
// degrees 6 & 7, which a plain finger count can't reach).

import type { Degree, FingerSignature, ModifierBinding } from "../types";
import { encodeSignature, fingerCount } from "./fingerPose";

export interface PrimaryEntry {
  pattern: string;
  degree: Degree;
  label: string;
}
export interface ModifierEntry {
  pattern: string;
  value: ModifierBinding;
  label: string;
}
export interface GestureConfig {
  primary: PrimaryEntry[];
  modifier: ModifierEntry[];
}

// Suggested exact shapes for the two degrees a finger count can't express.
const DEFAULT_PRIMARY: PrimaryEntry[] = [
  { pattern: "10001", degree: 6, label: "Thumb + pinky (shaka)" },
  { pattern: "01001", degree: 7, label: "Index + pinky (horns)" },
];

const DEFAULT_MODIFIER: ModifierEntry[] = [
  {
    pattern: "01000",
    value: { kind: "extension", extension: "sus2" },
    label: "Index — sus2 (2nd)",
  },
  {
    pattern: "01100",
    value: { kind: "extension", extension: "sus4" },
    label: "Index + middle — sus4 (4th)",
  },
  {
    pattern: "01110",
    value: { kind: "extension", extension: "seventh" },
    label: "Index + middle + ring — 7th",
  },
  {
    pattern: "01111",
    value: { kind: "extension", extension: "add9" },
    label: "Four fingers — add9",
  },
  {
    pattern: "10000",
    value: { kind: "override", override: "major" },
    label: "Thumb — force MAJOR (borrowed)",
  },
  {
    pattern: "00001",
    value: { kind: "override", override: "minor" },
    label: "Pinky — force MINOR (borrowed)",
  },
];

export const DEFAULT_CONFIG: GestureConfig = {
  primary: DEFAULT_PRIMARY,
  modifier: DEFAULT_MODIFIER,
};

/**
 * Resolve the primary hand to a scale degree.
 * Exact pattern bindings win; otherwise a finger count of 1..5 maps directly
 * to degrees 1..5. A fist (count 0) means "no chord" -> null.
 */
export function resolvePrimary(
  sig: FingerSignature,
  config: GestureConfig,
): { degree: Degree; label: string } | null {
  const pattern = encodeSignature(sig);
  const exact = config.primary.find((e) => e.pattern === pattern);
  if (exact) return { degree: exact.degree, label: exact.label };

  const count = fingerCount(sig);
  if (count >= 1 && count <= 5) {
    return { degree: count as Degree, label: `${count} finger(s)` };
  }
  return null;
}

/**
 * Resolve the modifier hand to an extension or override.
 * Only exact pattern bindings apply; anything else means "no modifier".
 */
export function resolveModifier(
  sig: FingerSignature,
  config: GestureConfig,
): { value: ModifierBinding; label: string } | null {
  const pattern = encodeSignature(sig);
  const exact = config.modifier.find((e) => e.pattern === pattern);
  return exact ? { value: exact.value, label: exact.label } : null;
}

/** Upsert a primary binding for a pattern (used by the calibration UI). */
export function bindPrimary(
  config: GestureConfig,
  pattern: string,
  degree: Degree,
  label: string,
): GestureConfig {
  const primary = config.primary.filter((e) => e.pattern !== pattern);
  primary.push({ pattern, degree, label });
  return { ...config, primary };
}

/** Upsert a modifier binding for a pattern. */
export function bindModifier(
  config: GestureConfig,
  pattern: string,
  value: ModifierBinding,
  label: string,
): GestureConfig {
  const modifier = config.modifier.filter((e) => e.pattern !== pattern);
  modifier.push({ pattern, value, label });
  return { ...config, modifier };
}
