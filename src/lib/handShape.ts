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
const INDEX_MCP = 5;
const MIDDLE_MCP = 9;
const PINKY_MCP = 17;
const FINGERTIPS = [8, 12, 16, 20]; // index, middle, ring, pinky tips
const EPS = 1e-6;

// How far the hand must rotate forward/back before it changes the inversion.
export const TILT_DEADZONE = 0.3;

// Palm/back facing: sign of the wrist→index-MCP→pinky-MCP winding. Flip this one
// constant if palm and back come out swapped on your camera.
export const FACING_SIGN = 1;
const FACING_DEADZONE = 0.004; // near edge-on -> treat as palm (normal)

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
 * Forward/back rotation of the hand from landmark depth (z). MediaPipe reports z
 * relative to the wrist, smaller = closer to the camera. Returns the mean
 * fingertip depth minus the wrist depth, normalized by the 2D palm length so it
 * is roughly scale-invariant:
 *   negative → fingertips toward the camera (hand rotated AWAY from the body)
 *   positive → fingertips away from the camera (rotated TOWARD the body)
 * z is the least reliable axis, so callers should use a generous deadzone.
 */
export function handDepthTilt(landmarks: Pt[]): number {
  const wrist = landmarks[WRIST];
  const mid = landmarks[MIDDLE_MCP];
  const palm = Math.hypot(mid.x - wrist.x, mid.y - wrist.y);
  if (palm < EPS) return 0;
  const wz = wrist.z ?? 0;
  let sum = 0;
  for (const i of FINGERTIPS) sum += (landmarks[i].z ?? 0) - wz;
  return sum / FINGERTIPS.length / palm;
}

/**
 * Map forward/back tilt to a triad inversion:
 *  0 = root position, 1 = 3rd in the bass (away), 2 = 5th in the bass (toward).
 */
export function tiltToInversion(tilt: number): 0 | 1 | 2 {
  if (tilt < -TILT_DEADZONE) return 1; // away from body → 3rd in bass
  if (tilt > TILT_DEADZONE) return 2; // toward body → 5th in bass
  return 0;
}

/**
 * Whether the **palm** or the **back** of the hand faces the camera, from the
 * winding order of wrist(0) → index-MCP(5) → pinky-MCP(17) in the image plane
 * (a 2D cross product — no depth needed). The sign flips between the two hands,
 * so it is corrected by handedness. MCPs (not fingertips) are used so it works
 * for any chord shape regardless of which fingers are extended. Edge-on (near
 * zero) defaults to "palm" (the normal state).
 */
export function handFacing(landmarks: Pt[], handedness: Handedness): "palm" | "back" {
  const w = landmarks[WRIST];
  const idx = landmarks[INDEX_MCP];
  const pky = landmarks[PINKY_MCP];
  const cross = (idx.x - w.x) * (pky.y - w.y) - (idx.y - w.y) * (pky.x - w.x);
  if (Math.abs(cross) < FACING_DEADZONE) return "palm";
  const signed = (handedness === "Left" ? -1 : 1) * FACING_SIGN * cross;
  return signed > 0 ? "palm" : "back";
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
