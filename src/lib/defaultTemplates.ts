// Built-in hand-shape templates, synthesized from a canonical open-hand model.
//
// These are approximate by design: holistic nearest-neighbour matching over a
// small set of distinct poses is forgiving, and the Gesture Mapping panel lets
// the user re-capture any gesture to their own hand for better accuracy.

import type { Degree, ModifierBinding, PoseVector } from "../types";
import { normalizePose, Pt } from "./handShape";

// A flat, upright, palm-forward RIGHT hand. Coordinates are arbitrary units
// with the wrist at the origin and fingers pointing "up" (negative y).
// Index order matches MediaPipe's 21 hand landmarks.
const OPEN_HAND: Pt[] = [
  { x: 0.0, y: 0.0 }, // 0  wrist
  { x: -0.2, y: -0.2 }, // 1  thumb cmc
  { x: -0.35, y: -0.42 }, // 2  thumb mcp
  { x: -0.48, y: -0.6 }, // 3  thumb ip
  { x: -0.6, y: -0.72 }, // 4  thumb tip
  { x: -0.18, y: -0.8 }, // 5  index mcp
  { x: -0.2, y: -1.05 }, // 6  index pip
  { x: -0.21, y: -1.22 }, // 7  index dip
  { x: -0.22, y: -1.38 }, // 8  index tip
  { x: 0.0, y: -0.85 }, // 9  middle mcp
  { x: 0.0, y: -1.13 }, // 10 middle pip
  { x: 0.0, y: -1.32 }, // 11 middle dip
  { x: 0.0, y: -1.5 }, // 12 middle tip
  { x: 0.16, y: -0.82 }, // 13 ring mcp
  { x: 0.18, y: -1.08 }, // 14 ring pip
  { x: 0.19, y: -1.26 }, // 15 ring dip
  { x: 0.2, y: -1.42 }, // 16 ring tip
  { x: 0.32, y: -0.72 }, // 17 pinky mcp
  { x: 0.36, y: -0.94 }, // 18 pinky pip
  { x: 0.38, y: -1.08 }, // 19 pinky dip
  { x: 0.4, y: -1.2 }, // 20 pinky tip
];

// finger index (0=thumb..4=pinky) -> [mcp, pip/ip, dip, tip] landmark indices.
const FINGER_LM: Record<number, [number, number, number, number]> = {
  0: [2, 3, 3, 4], // thumb (no dip; ip used twice)
  1: [5, 6, 7, 8],
  2: [9, 10, 11, 12],
  3: [13, 14, 15, 16],
  4: [17, 18, 19, 20],
};

function clone(hand: Pt[]): Pt[] {
  return hand.map((p) => ({ x: p.x, y: p.y }));
}

function lerp(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Curl a finger into the palm so its tip sits near/below the knuckle. */
function foldFinger(hand: Pt[], finger: number): void {
  const wrist = hand[0];
  if (finger === 0) {
    // Thumb tucks across the palm toward the index knuckle.
    const indexMcp = hand[5];
    hand[3] = lerp(hand[2], indexMcp, 0.5);
    hand[4] = lerp(hand[2], indexMcp, 0.9);
    return;
  }
  const [mcp, pip, dip, tip] = FINGER_LM[finger];
  const up = { x: hand[mcp].x - wrist.x, y: hand[mcp].y - wrist.y };
  hand[pip] = { x: hand[mcp].x + up.x * 0.1, y: hand[mcp].y + up.y * 0.1 };
  hand[dip] = { x: hand[mcp].x - up.x * 0.05, y: hand[mcp].y - up.y * 0.05 };
  hand[tip] = { x: hand[mcp].x - up.x * 0.2, y: hand[mcp].y - up.y * 0.2 };
}

/** Build a normalized template with the given fingers extended (0=thumb..4=pinky). */
export function makeTemplate(extended: number[]): PoseVector {
  const hand = clone(OPEN_HAND);
  for (let f = 0; f < 5; f++) {
    if (!extended.includes(f)) foldFinger(hand, f);
  }
  return normalizePose(hand, "Right");
}

// "Rest" shapes that mean silence / no modifier (a relaxed or clenched hand).
// Matching is holistic, so single-finger gestures can sit close to a fist; we
// keep these as explicit references and treat "rest is closest" as no gesture.
export const REST_TEMPLATES: PoseVector[] = [makeTemplate([])];

export interface DefaultPrimary {
  degree: Degree;
  extended: number[];
  label: string;
}
export interface DefaultModifier {
  key: string;
  value: ModifierBinding;
  extended: number[];
  label: string;
}

// Fingers: 0 thumb, 1 index, 2 middle, 3 ring, 4 pinky.
export const DEFAULT_PRIMARY: DefaultPrimary[] = [
  { degree: 1, extended: [1], label: "Index up" },
  { degree: 2, extended: [1, 2], label: "Index + middle (peace)" },
  { degree: 3, extended: [1, 2, 3], label: "Three fingers" },
  { degree: 4, extended: [1, 2, 3, 4], label: "Four fingers" },
  { degree: 5, extended: [0, 1, 2, 3, 4], label: "Open palm" },
  { degree: 6, extended: [0, 4], label: "Thumb + pinky (shaka)" },
  { degree: 7, extended: [1, 4], label: "Index + pinky (horns)" },
];

export const DEFAULT_MODIFIER: DefaultModifier[] = [
  { key: "sus2", value: { kind: "extension", extension: "sus2" }, extended: [1], label: "Index — sus2 (2nd)" },
  { key: "sus4", value: { kind: "extension", extension: "sus4" }, extended: [1, 2], label: "Index + middle — sus4 (4th)" },
  { key: "seventh", value: { kind: "extension", extension: "seventh" }, extended: [1, 2, 3], label: "Three fingers — 7th" },
  { key: "add9", value: { kind: "extension", extension: "add9" }, extended: [1, 2, 3, 4], label: "Four fingers — add9" },
  { key: "major", value: { kind: "override", override: "major" }, extended: [0], label: "Thumb only — force MAJOR" },
  { key: "minor", value: { kind: "override", override: "minor" }, extended: [4], label: "Pinky only — force MINOR" },
];
