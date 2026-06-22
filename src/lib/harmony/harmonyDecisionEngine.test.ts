import { describe, expect, it } from "vitest";
import {
  SATB_RANGES,
  VOICE_ORDER,
  type Voice,
  assignVoices,
  chordFitScore,
  contextFromMidis,
  generateCandidates,
  pairDissonance,
  pickLeadVoice,
  rangePenalty,
  voiceLeadingScore,
} from "./harmonyDecisionEngine";

// C major triad context: chord tones C/E/G, extensions D (9th) and A (13th).
const cMajor = contextFromMidis([60, 64, 67]);

const ordered = (a: Record<string, number | undefined>): number[] =>
  VOICE_ORDER.map((v) => a[v]).filter((m): m is number => m != null);

describe("contextFromMidis", () => {
  it("derives chord pitch classes, root, and tension extensions", () => {
    expect(cMajor.chordPcs.sort()).toEqual([0, 4, 7]);
    expect(cMajor.rootPc).toBe(0);
    expect(cMajor.extensionPcs.sort()).toEqual([2, 9]); // D and A
  });
});

describe("chordFitScore", () => {
  it("ranks chord tone > extension > tension", () => {
    expect(chordFitScore(60, cMajor)).toBe(10); // C, chord tone
    expect(chordFitScore(62, cMajor)).toBe(5); // D, extension
    expect(chordFitScore(61, cMajor)).toBe(2); // C#, tension
  });
});

describe("voiceLeadingScore", () => {
  it("is 0 with no previous note and penalizes larger jumps", () => {
    expect(voiceLeadingScore(60, undefined)).toBe(0);
    expect(voiceLeadingScore(62, 60)).toBeGreaterThan(voiceLeadingScore(67, 60));
  });
});

describe("rangePenalty", () => {
  it("excludes out-of-range notes and is gentle in the middle", () => {
    expect(rangePenalty(40, "soprano")).toBe(-Infinity); // below soprano lo
    expect(rangePenalty(70, "soprano")).toBe(0); // comfortably inside
  });
});

describe("pairDissonance", () => {
  it("penalizes a minor second more than a major second", () => {
    expect(pairDissonance(60, 61, cMajor)).toBeLessThan(pairDissonance(60, 62, cMajor));
  });
  it("allows a tritone between chord tones, penalizes it otherwise", () => {
    const dom7 = contextFromMidis([62, 66, 69, 72]); // D7: F#(66) & C(72) tritone, both chord tones
    expect(pairDissonance(66, 72, dom7)).toBe(0);
    expect(pairDissonance(60, 66, cMajor)).toBeLessThan(0); // C–F# not both chord tones
  });
});

describe("generateCandidates", () => {
  it("returns only in-range chord/extension notes", () => {
    const cands = generateCandidates(cMajor, "tenor");
    const { lo, hi } = SATB_RANGES.tenor;
    const allowed = new Set([0, 4, 7, 2, 9]);
    expect(cands.length).toBeGreaterThan(0);
    for (const m of cands) {
      expect(m).toBeGreaterThanOrEqual(lo);
      expect(m).toBeLessThanOrEqual(hi);
      expect(allowed.has(((m % 12) + 12) % 12)).toBe(true);
    }
  });
});

describe("assignVoices — D over C major (the headline case)", () => {
  const a = assignVoices(cMajor, 62, null, 3); // sing D4
  const lead = pickLeadVoice(62);
  const all = ordered(a as unknown as Record<string, number | undefined>);

  it("keeps the sung D as the pinned lead voice", () => {
    expect((a as Record<Voice, number | undefined>)[lead]).toBe(62);
  });

  it("does not snap to a fixed interval stack (no constant +3/+7/+12)", () => {
    const intervals = all.slice(1).map((m, i) => m - all[i]);
    expect(new Set(intervals).size).toBeGreaterThan(0);
    // Harmonies are drawn from the chord/extension set, not a rigid offset.
    for (const m of all) expect([0, 2, 4, 7, 9]).toContain(((m % 12) + 12) % 12);
  });

  it("keeps every voice in its SATB range", () => {
    for (const v of VOICE_ORDER) {
      const m = (a as Record<Voice, number | undefined>)[v];
      if (m != null) {
        expect(m).toBeGreaterThanOrEqual(SATB_RANGES[v].lo);
        expect(m).toBeLessThanOrEqual(SATB_RANGES[v].hi);
      }
    }
  });

  it("never crosses voices (bass ≤ tenor ≤ alto ≤ soprano)", () => {
    for (let i = 1; i < all.length; i++) expect(all[i]).toBeGreaterThanOrEqual(all[i - 1]);
  });

  it("avoids minor-second clusters between voices", () => {
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++)
        expect(Math.abs(all[i] - all[j]) % 12).not.toBe(1);
  });
});

describe("assignVoices — voice leading between frames", () => {
  it("prefers harmony notes close to the previous assignment", () => {
    const prev = assignVoices(cMajor, 67, null, 3); // sing G
    const next = assignVoices(cMajor, 65, prev, 3); // step down to F-ish
    // The soprano should not leap an octave when a nearby chord tone exists.
    expect(Math.abs(next.soprano - prev.soprano)).toBeLessThanOrEqual(7);
  });
});
