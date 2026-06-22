import { describe, expect, it } from "vitest";
import {
  DEFAULT_MOTION,
  NEUTRAL_EXPRESSION,
  mapMotionToExpression,
} from "./expression";
import type { HandMotion } from "./handShape";

const motion = (m: Partial<HandMotion>): HandMotion => ({
  x: 0,
  y: 0,
  size: 0,
  roll: 0,
  ...m,
});
const on = { ...DEFAULT_MOTION, enabled: true };

describe("mapMotionToExpression", () => {
  it("returns neutral when motion is disabled", () => {
    expect(mapMotionToExpression(motion({ y: 1 }), DEFAULT_MOTION)).toEqual(
      NEUTRAL_EXPRESSION,
    );
  });

  it("maps hand height to volume (low at bottom, full at top)", () => {
    expect(mapMotionToExpression(motion({ y: 0 }), on).volume).toBeCloseTo(0.1);
    expect(mapMotionToExpression(motion({ y: 1 }), on).volume).toBeCloseTo(1);
  });

  it("maps distance (size) to filter cutoff, monotonically increasing", () => {
    const near = mapMotionToExpression(motion({ size: 1 }), on).brightnessHz;
    const far = mapMotionToExpression(motion({ size: 0 }), on).brightnessHz;
    expect(near).toBeGreaterThan(far);
  });

  it("maps tilt to symmetric pitch bend", () => {
    expect(mapMotionToExpression(motion({ roll: 1 }), on).bendCents).toBe(200);
    expect(mapMotionToExpression(motion({ roll: -1 }), on).bendCents).toBe(-200);
    expect(mapMotionToExpression(motion({ roll: 0 }), on).bendCents).toBe(0);
  });

  it("holds an axis at neutral when only that axis is disabled", () => {
    const cfg = { ...on, volume: false };
    expect(mapMotionToExpression(motion({ y: 0 }), cfg).volume).toBe(
      NEUTRAL_EXPRESSION.volume,
    );
  });
});
