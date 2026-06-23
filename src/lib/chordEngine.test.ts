import { describe, expect, it } from "vitest";
import { resolveChord } from "./chordEngine";
import { DEFAULT_CONFIG } from "./gestureMap";
import { makeTemplate } from "./defaultTemplates";
import type { Key } from "../types";

const CMaj: Key = { root: "C", mode: "major" };
const degree = (n: number[]) => makeTemplate(n); // primary shape
const seventh = makeTemplate([1, 2, 3]); // modifier 7th shape

describe("resolveChord — extension + chord-hand facing flip", () => {
  // Chord hand = peace sign -> degree ii (D minor in C major).
  const ii = degree([1, 2]);
  const I = degree([1]); // index -> degree I (C major)

  it("diatonic ii7 (palm) with the modifier hand's 7th shape", () => {
    const { chord } = resolveChord(CMaj, ii, seventh, DEFAULT_CONFIG, 0, "palm");
    expect(chord?.name).toBe("Dm7");
    expect(chord?.qualityMode).toBe("diatonic");
  });

  it("flips minor → major when the back of the chord hand faces the camera", () => {
    // ii (Dm) -> flip -> D major; with the 7th shape -> D7.
    const { chord } = resolveChord(CMaj, ii, seventh, DEFAULT_CONFIG, 0, "back");
    expect(chord?.qualityMode).toBe("flip");
    expect(chord?.name).toBe("D7");
  });

  it("flips a major chord to minor (I/C -> Cm)", () => {
    const palm = resolveChord(CMaj, I, null, DEFAULT_CONFIG, 0, "palm").chord;
    expect(palm?.name).toBe("C");
    const back = resolveChord(CMaj, I, null, DEFAULT_CONFIG, 0, "back").chord;
    expect(back?.name).toBe("Cm");
    expect(back?.quality).toBe("minor");
  });

  it("defaults to palm (diatonic) when facing is omitted", () => {
    const { chord } = resolveChord(CMaj, ii, null, DEFAULT_CONFIG);
    expect(chord?.name).toBe("Dm");
  });

  it("is silent with no chord hand", () => {
    expect(resolveChord(CMaj, null, seventh, DEFAULT_CONFIG, 0, "back").chord).toBeNull();
  });

  it("threads the inversion through to the voicing + slash name", () => {
    const root = resolveChord(CMaj, I, null, DEFAULT_CONFIG, 0).chord;
    expect(root?.notes).toEqual(["C4", "E4", "G4"]);
    expect(root?.name).toBe("C");

    const first = resolveChord(CMaj, I, null, DEFAULT_CONFIG, 1).chord;
    expect(first?.notes).toEqual(["E4", "G4", "C5"]); // 3rd in bass
    expect(first?.name).toBe("C/E");

    const second = resolveChord(CMaj, I, null, DEFAULT_CONFIG, 2).chord;
    expect(second?.notes).toEqual(["G4", "C5", "E5"]); // 5th in bass
    expect(second?.name).toBe("C/G");
  });

  it("combines flip + inversion (Dm 1st inversion -> D/F#)", () => {
    const { chord } = resolveChord(CMaj, ii, null, DEFAULT_CONFIG, 1, "back");
    expect(chord?.quality).toBe("major");
    expect(chord?.name).toBe("D/F#");
  });
});
