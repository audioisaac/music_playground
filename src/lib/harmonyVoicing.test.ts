import { describe, expect, it } from "vitest";
import { assignHarmonyTargets, pitchClass, shiftRatio } from "./harmonyVoicing";

describe("assignHarmonyTargets", () => {
  it("voices the chord above the sung note (C major over C4)", () => {
    // C4 = 60; chord tones C/E/G -> E4, G4, C5.
    expect(assignHarmonyTargets(60, [0, 4, 7], 3)).toEqual([64, 67, 72]);
  });

  it("snaps to in-key chord tones even when the sung note isn't in the chord", () => {
    // Sing D4 (62) over C major -> harmonies still land on E4, G4, C5.
    expect(assignHarmonyTargets(62, [0, 4, 7], 3)).toEqual([64, 67, 72]);
  });

  it("each voice is strictly higher than the last (no crossing/unison)", () => {
    const t = assignHarmonyTargets(67, [0, 4, 7], 3);
    for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThan(t[i - 1]);
    for (const m of t) expect([0, 4, 7]).toContain(pitchClass(m));
  });

  it("handles empty chord / zero voices", () => {
    expect(assignHarmonyTargets(60, [], 3)).toEqual([]);
    expect(assignHarmonyTargets(60, [0, 4, 7], 0)).toEqual([]);
  });
});

describe("shiftRatio", () => {
  it("is 2.0 for an octave up and 0.5 for an octave down", () => {
    expect(shiftRatio(60, 72)).toBeCloseTo(2);
    expect(shiftRatio(72, 60)).toBeCloseTo(0.5);
    expect(shiftRatio(60, 60)).toBeCloseTo(1);
  });
});
