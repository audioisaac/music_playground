import { describe, expect, it } from "vitest";
import {
  buildChord,
  diatonicTriad,
  noteToMidi,
  relativeIntervals,
  romanNumeral,
} from "./musicTheory";
import type { Key } from "../types";

const CMaj: Key = { root: "C", mode: "major" };
const AMin: Key = { root: "A", mode: "minor" };

describe("diatonicTriad", () => {
  it("gives the I, IV, V triads of C major as major chords", () => {
    expect(diatonicTriad(CMaj, 1)).toEqual({ rootPc: 0, quality: "major" });
    expect(diatonicTriad(CMaj, 4)).toEqual({ rootPc: 5, quality: "major" });
    expect(diatonicTriad(CMaj, 5)).toEqual({ rootPc: 7, quality: "major" });
  });

  it("gives ii, iii, vi as minor and vii as diminished in C major", () => {
    expect(diatonicTriad(CMaj, 2).quality).toBe("minor");
    expect(diatonicTriad(CMaj, 3).quality).toBe("minor");
    expect(diatonicTriad(CMaj, 6).quality).toBe("minor");
    expect(diatonicTriad(CMaj, 7).quality).toBe("diminished");
  });

  it("uses the natural-minor pattern for a minor key", () => {
    expect(diatonicTriad(AMin, 1)).toEqual({ rootPc: 9, quality: "minor" });
    expect(diatonicTriad(AMin, 3).quality).toBe("major"); // C major (relative)
  });
});

describe("buildChord", () => {
  it("builds the C major triad for degree I of C major", () => {
    const chord = buildChord(CMaj, 1);
    expect(chord.notes).toEqual(["C4", "E4", "G4"]);
    expect(chord.name).toBe("C");
  });

  it("voices notes upward across the octave boundary", () => {
    // ii of C major = D minor: D F A, all in octave 4.
    expect(buildChord(CMaj, 2).notes).toEqual(["D4", "F4", "A4"]);
    // vii of C major = B diminished: B D F -> D and F wrap to octave 5.
    expect(buildChord(CMaj, 7).notes).toEqual(["B4", "D5", "F5"]);
  });

  it("applies a minor override to borrow a chord outside the key", () => {
    const chord = buildChord(CMaj, 1, "minorOverride");
    expect(chord.notes).toEqual(["C4", "D#4", "G4"]);
    expect(chord.quality).toBe("minor");
    expect(chord.name).toBe("Cm");
  });

  it("applies a major override (e.g. minor key tonic to major)", () => {
    const chord = buildChord(AMin, 1, "majorOverride");
    expect(chord.quality).toBe("major");
    expect(chord.name).toBe("A");
  });

  it("turns a chord into a sus2 (the '2nd' special chord)", () => {
    const chord = buildChord(CMaj, 1, "diatonic", "sus2");
    expect(chord.notes).toEqual(["C4", "D4", "G4"]);
    expect(chord.name).toBe("Csus2");
  });

  it("turns a chord into a sus4 (the '4th' special chord)", () => {
    const chord = buildChord(CMaj, 1, "diatonic", "sus4");
    expect(chord.notes).toEqual(["C4", "F4", "G4"]);
    expect(chord.name).toBe("Csus4");
  });

  it("adds a major 7th to the I chord and a dominant 7th to V", () => {
    expect(buildChord(CMaj, 1, "diatonic", "seventh").notes).toEqual([
      "C4",
      "E4",
      "G4",
      "B4",
    ]);
    // V7 (G dominant 7) should have F natural (b7), not F#.
    const g7 = buildChord(CMaj, 5, "diatonic", "seventh");
    expect(g7.notes).toEqual(["G4", "B4", "D5", "F5"]);
    expect(g7.name).toBe("G7");
  });
});

describe("noteToMidi", () => {
  it("maps note names to MIDI numbers (C4 = 60)", () => {
    expect(noteToMidi("C4")).toBe(60);
    expect(noteToMidi("A4")).toBe(69);
    expect(noteToMidi("D#5")).toBe(75);
    expect(noteToMidi("C5")).toBe(72);
  });
});

describe("relativeIntervals", () => {
  it("gives semitone offsets from the lowest note", () => {
    expect(relativeIntervals(["C4", "E4", "G4"])).toEqual([0, 4, 7]);
    expect(relativeIntervals(["C4", "E4", "G4", "B4"])).toEqual([0, 4, 7, 11]);
  });

  it("normalizes to the lowest note regardless of octave/order", () => {
    expect(relativeIntervals(["G4", "C5", "E5"])).toEqual([0, 5, 9]);
    expect(relativeIntervals([])).toEqual([]);
  });
});

describe("romanNumeral", () => {
  it("formats by quality", () => {
    expect(romanNumeral(1, "major")).toBe("I");
    expect(romanNumeral(2, "minor")).toBe("ii");
    expect(romanNumeral(7, "diminished")).toBe("vii°");
  });
});
