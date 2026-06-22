// Whole-hand shape recognition.
//
// Instead of classifying each finger as extended/folded (which was brittle —
// the thumb tip never gets close to the wrist, so it always read "extended"),
// we treat the hand as an outline: normalize all 21 landmarks into a
// pose-invariant vector and compare whole shapes by distance.

import type { Handedness, Orientation, PoseVector } from "../types";

export interface Pt {
  x: number;
  y: number;
  z?: number;
}

const WRIST = 0;
const MIDDLE_MCP = 9;
const EPS = 1e-6;

// cos(40°): how close to vertical the hand must point to count as up/down.
const VERTICAL_COS = 0.766;

/**
 * Which way the hand points, from the wrist→middle-MCP axis in image space
 * (image y grows downward). Used as an orthogonal channel to the
 * orientation-invariant shape matching: up/down vs sideways.
 */
export function handOrientation(landmarks: Pt[]): Orientation {
  const wrist = landmarks[WRIST];
  const mid = landmarks[MIDDLE_MCP];
  const vx = mid.x - wrist.x;
  const vy = mid.y - wrist.y;
  const len = Math.hypot(vx, vy);
  if (len < EPS) return "side";
  // Component along vertical-up (0,-1), normalized.
  const cosUp = -vy / len;
  if (cosUp > VERTICAL_COS) return "up";
  if (cosUp < -VERTICAL_COS) return "down";
  return "side";
}

/**
 * Continuous motion features for expressive control, read from the RAW
 * landmarks (before normalization). Because shape recognition is invariant to
 * position/size/rotation, these can drive expression without changing the chord:
 *  - x, y: hand position in frame, 0..1 (y inverted so raising the hand → 1)
 *  - size: palm length |wrist→middle-MCP| (distance-to-camera proxy), ~0..1
 *  - roll: hand tilt, −1 (tilted left) .. +1 (right), 0 = pointing straight up
 */
export interface HandMotion {
  x: number;
  y: number;
  size: number;
  roll: number;
}

export function handMotion(landmarks: Pt[]): HandMotion {
  const wrist = landmarks[WRIST];
  const mid = landmarks[MIDDLE_MCP];
  const vx = mid.x - wrist.x;
  const vy = mid.y - wrist.y;
  const len = Math.hypot(vx, vy);
  // Signed angle from vertical-up, mapped to −1..+1 over ±90°.
  const roll = len < EPS ? 0 : Math.max(-1, Math.min(1, Math.atan2(vx, -vy) / (Math.PI / 2)));
  // Palm length in normalized image units is roughly 0.1 (far) .. 0.45 (near).
  const size = Math.max(0, Math.min(1, (len - 0.1) / 0.35));
  return {
    x: Math.max(0, Math.min(1, wrist.x)),
    y: Math.max(0, Math.min(1, 1 - wrist.y)),
    size,
    roll,
  };
}

/**
 * Normalize a hand into a translation/scale/rotation/chirality-invariant
 * vector (the "outline"):
 *  1. translate so the wrist is the origin,
 *  2. mirror x for Left hands so both hands share one canonical space,
 *  3. rotate so the wrist→middle-MCP axis points straight up,
 *  4. scale by the palm length |middleMCP - wrist|.
 * Returns a flat [x0,y0,x1,y1,...] vector of length 42 (z is ignored — it is
 * the least reliable axis from a single camera).
 */
export function normalizePose(
  landmarks: Pt[],
  handedness: Handedness,
): PoseVector {
  const origin = landmarks[WRIST];
  const pts = landmarks.map((p) => ({
    x: (p.x - origin.x) * (handedness === "Left" ? -1 : 1),
    y: p.y - origin.y,
  }));

  const mid = pts[MIDDLE_MCP];
  const palmLen = Math.hypot(mid.x, mid.y);
  if (palmLen < EPS) return new Array(landmarks.length * 2).fill(0);

  // Rotate the wrist→middle-MCP vector to point up (angle -PI/2).
  const current = Math.atan2(mid.y, mid.x);
  const rot = -Math.PI / 2 - current;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);

  const out: number[] = [];
  for (const p of pts) {
    const rx = p.x * cos - p.y * sin;
    const ry = p.x * sin + p.y * cos;
    out.push(rx / palmLen, ry / palmLen);
  }
  return out;
}

/** Mean per-landmark Euclidean distance between two normalized poses. */
export function poseDistance(a: PoseVector, b: PoseVector): number {
  if (a.length !== b.length || a.length === 0) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i += 2) {
    const dx = a[i] - b[i];
    const dy = a[i + 1] - b[i + 1];
    sum += Math.hypot(dx, dy);
  }
  return sum / (a.length / 2);
}
