import { describe, expect, it } from "vitest";
import {
  handDepthTilt,
  handMotion,
  handOrientation,
  normalizePose,
  poseDistance,
  Pt,
  tiltToInversion,
} from "./handShape";

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

describe("handOrientation", () => {
  // Only the wrist (0) and middle-MCP (9) matter; fill the rest arbitrarily.
  const oriented = (dx: number, dy: number): Pt[] => {
    const pts: Pt[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }));
    pts[9] = { x: 0.5 + dx, y: 0.5 + dy };
    return pts;
  };

  it("classifies fingers above the wrist as 'up'", () => {
    expect(handOrientation(oriented(0, -0.3))).toBe("up");
  });
  it("classifies fingers below the wrist as 'down'", () => {
    expect(handOrientation(oriented(0, 0.3))).toBe("down");
  });
  it("classifies a horizontal hand as 'side'", () => {
    expect(handOrientation(oriented(0.3, 0))).toBe("side");
    expect(handOrientation(oriented(-0.3, 0))).toBe("side");
  });
});

describe("handMotion", () => {
  // Only wrist (0) and middle-MCP (9) matter; fill the rest arbitrarily.
  const hand = (wrist: Pt, mid: Pt): Pt[] => {
    const pts: Pt[] = Array.from({ length: 21 }, () => ({ ...wrist }));
    pts[0] = wrist;
    pts[9] = mid;
    return pts;
  };

  it("reports a high y when the hand is near the top of the frame", () => {
    // image y grows downward, so small wrist.y = high in frame -> y near 1.
    const m = handMotion(hand({ x: 0.5, y: 0.1 }, { x: 0.5, y: 0.0 }));
    expect(m.y).toBeGreaterThan(0.8);
  });

  it("gives opposite roll signs for left vs right tilt", () => {
    const left = handMotion(hand({ x: 0.5, y: 0.5 }, { x: 0.3, y: 0.3 }));
    const right = handMotion(hand({ x: 0.5, y: 0.5 }, { x: 0.7, y: 0.3 }));
    expect(left.roll).toBeLessThan(0);
    expect(right.roll).toBeGreaterThan(0);
  });

  it("reports ~0 roll when pointing straight up", () => {
    const m = handMotion(hand({ x: 0.5, y: 0.6 }, { x: 0.5, y: 0.3 }));
    expect(Math.abs(m.roll)).toBeLessThan(0.05);
  });

  it("grows size as the palm gets larger (closer)", () => {
    const small = handMotion(hand({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.42 }));
    const large = handMotion(hand({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.1 }));
    expect(large.size).toBeGreaterThan(small.size);
  });
});

describe("handDepthTilt / tiltToInversion", () => {
  // wrist (0) and middle-MCP (9) set the 2D palm; fingertips (8/12/16/20) carry z.
  const tiltedHand = (tipZ: number): Pt[] => {
    const pts: Pt[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
    pts[0] = { x: 0.5, y: 0.6, z: 0 }; // wrist
    pts[9] = { x: 0.5, y: 0.3, z: 0 }; // middle-MCP (palm length ~0.3)
    for (const i of [8, 12, 16, 20]) pts[i] = { x: 0.5, y: 0.2, z: tipZ };
    return pts;
  };

  it("is negative when the fingertips rotate toward the camera (away from body)", () => {
    expect(handDepthTilt(tiltedHand(-0.2))).toBeLessThan(0);
  });
  it("is positive when the fingertips rotate away from the camera (toward body)", () => {
    expect(handDepthTilt(tiltedHand(0.2))).toBeGreaterThan(0);
  });
  it("maps tilt to inversions with a deadzone", () => {
    expect(tiltToInversion(0)).toBe(0);
    expect(tiltToInversion(-1)).toBe(1); // away → 3rd in bass
    expect(tiltToInversion(1)).toBe(2); // toward → 5th in bass
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
