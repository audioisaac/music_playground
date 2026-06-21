// Convert MediaPipe hand landmarks into a normalized finger signature.
// Uses distance-from-wrist comparisons so it tolerates hand rotation
// reasonably well (a tip farther from the wrist than its lower joint = extended).

import type { FingerSignature } from "../types";

interface Pt {
  x: number;
  y: number;
  z: number;
}

// Landmark indices: [lowerJoint, tip] per finger, ordered
// [thumb, index, middle, ring, pinky]. Index 0 is the wrist.
const FINGER_JOINTS: Array<[number, number]> = [
  [2, 4], // thumb: MCP, TIP
  [6, 8], // index: PIP, TIP
  [10, 12], // middle: PIP, TIP
  [14, 16], // ring: PIP, TIP
  [18, 20], // pinky: PIP, TIP
];

function dist(a: Pt, b: Pt): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Returns which of the five fingers are extended.
 * A finger counts as extended when its tip is meaningfully farther from the
 * wrist than its lower joint. The thumb uses a smaller margin since it folds
 * across rather than along the palm.
 */
export function computeSignature(landmarks: Pt[]): FingerSignature {
  const wrist = landmarks[0];
  const result = FINGER_JOINTS.map(([lower, tip], i) => {
    const tipD = dist(landmarks[tip], wrist);
    const lowerD = dist(landmarks[lower], wrist);
    const margin = i === 0 ? 1.05 : 1.0; // thumb needs a touch more reach
    return tipD > lowerD * margin;
  });
  return result as FingerSignature;
}

/** Encode a signature to a stable string key, e.g. [true,false,...] -> "10000". */
export function encodeSignature(sig: FingerSignature): string {
  return sig.map((b) => (b ? "1" : "0")).join("");
}

/** Decode a "10000" pattern back to a signature. */
export function decodeSignature(pattern: string): FingerSignature {
  return pattern.split("").map((c) => c === "1") as unknown as FingerSignature;
}

/** Number of extended fingers. */
export function fingerCount(sig: FingerSignature): number {
  return sig.reduce((n, b) => n + (b ? 1 : 0), 0);
}

/** A clenched fist = no extended fingers (used as the "silence" gesture). */
export function isFist(sig: FingerSignature): boolean {
  return fingerCount(sig) === 0;
}
