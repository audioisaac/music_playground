import { describe, expect, it } from "vitest";
import { normalizePose, poseDistance, Pt } from "./handShape";

// A deterministic, distinct set of 21 landmarks (geometry need not be a real
// hand for invariance tests — only that points differ and palm length > 0).
const HAND: Pt[] = Array.from({ length: 21 }, (_, i) => ({
  x: 0.5 + 0.03 * i * Math.cos(i),
  y: 0.9 - 0.03 * i,
  z: 0,
}));

interface Sim {
  dx: number;
  dy: number;
  s: number;
  theta: number;
}
function transform(pts: Pt[], { dx, dy, s, theta }: Sim): Pt[] {
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return pts.map((p) => ({
    x: (p.x * cos - p.y * sin) * s + dx,
    y: (p.x * sin + p.y * cos) * s + dy,
    z: 0,
  }));
}

describe("normalizePose", () => {
  it("is invariant to translation, scale, and rotation", () => {
    const base = normalizePose(HAND, "Right");
    const moved = normalizePose(
      transform(HAND, { dx: 0.3, dy: -0.2, s: 2.5, theta: 0.7 }),
      "Right",
    );
    expect(poseDistance(base, moved)).toBeLessThan(1e-6);
  });

  it("maps a mirrored Left hand to the same vector as the Right hand", () => {
    const right = normalizePose(HAND, "Right");
    const mirrored = HAND.map((p) => ({ x: -p.x, y: p.y, z: 0 }));
    const left = normalizePose(mirrored, "Left");
    expect(poseDistance(right, left)).toBeLessThan(1e-6);
  });

  it("returns a zero vector when the palm has no length", () => {
    const degenerate: Pt[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }));
    expect(normalizePose(degenerate, "Right").every((v) => v === 0)).toBe(true);
  });
});

describe("poseDistance", () => {
  it("is zero for identical poses and positive otherwise", () => {
    const a = normalizePose(HAND, "Right");
    expect(poseDistance(a, a)).toBe(0);
    const b = normalizePose(
      HAND.map((p, i) => (i === 8 ? { x: p.x + 0.5, y: p.y - 0.5 } : p)),
      "Right",
    );
    expect(poseDistance(a, b)).toBeGreaterThan(0);
  });
});
