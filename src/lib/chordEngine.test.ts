import { describe, expect, it } from "vitest";
import { resolveChord } from "./chordEngine";
import { DEFAULT_CONFIG } from "./gestureMap";
import { makeTemplate } from "./defaultTemplates";
import type { Key } from "../types";

const CMaj: Key = { root: "C", mode: "major" };
const degree = (n: number[]) => makeTemplate(n); // primary shape
const seventh = makeTemplate([1, 2, 3]); // modifier 7th shape

describe("resolveChord — stacking extension + orientation override", () => {
  // Chord hand = peace sign -> degree ii (D minor in C major).
  const ii = degree([1, 2]);

  it("diatonic ii7 when the modifier hand points sideways", () => {
    const { chord } = resolveChord(CMaj, ii, seventh, "side", DEFAULT_CONFIG);
    expect(chord?.name).toBe("Dm7");
  });

  it("forces minor 7th when the modifier hand points down", () => {
    const { chord } = resolveChord(CMaj, ii, seventh, "down", DEFAULT_CONFIG);
    expect(chord?.name).toBe("Dm7");
    expect(chord?.qualityMode).toBe("minorOverride");
  });

  it("forces a (dominant) major 7th when the modifier hand points up", () => {
    const { chord } = resolveChord(CMaj, ii, seventh, "up", DEFAULT_CONFIG);
    expect(chord?.name).toBe("D7");
    expect(chord?.qualityMode).toBe("majorOverride");
  });

  it("an upward modifier hand with no extension still forces major (ii -> II)", () => {
    const open = makeTemplate([]); // rest shape: no extension
    const { chord } = resolveChord(CMaj, ii, open, "up", DEFAULT_CONFIG);
    expect(chord?.name).toBe("D");
    expect(chord?.extension).toBe("none");
  });

  it("is silent with no chord hand", () => {
    expect(resolveChord(CMaj, null, seventh, "up", DEFAULT_CONFIG).chord).toBeNull();
  });

  it("ignores the modifier entirely when that hand is absent", () => {
    const { chord } = resolveChord(CMaj, ii, null, null, DEFAULT_CONFIG);
    expect(chord?.name).toBe("Dm");
  });
});
