import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONFIG,
  bindPrimary,
  resolveModifier,
  resolvePrimary,
} from "./gestureMap";
import { decodeSignature } from "./fingerPose";

const sig = (pattern: string) => decodeSignature(pattern);

describe("resolvePrimary", () => {
  it("maps finger counts 1..5 to degrees 1..5 by default", () => {
    expect(resolvePrimary(sig("01000"), DEFAULT_CONFIG)?.degree).toBe(1);
    expect(resolvePrimary(sig("01100"), DEFAULT_CONFIG)?.degree).toBe(2);
    expect(resolvePrimary(sig("11111"), DEFAULT_CONFIG)?.degree).toBe(5);
  });

  it("returns null for a fist (silence)", () => {
    expect(resolvePrimary(sig("00000"), DEFAULT_CONFIG)).toBeNull();
  });

  it("uses exact-pattern bindings for degrees 6 and 7", () => {
    expect(resolvePrimary(sig("10001"), DEFAULT_CONFIG)?.degree).toBe(6);
    expect(resolvePrimary(sig("01001"), DEFAULT_CONFIG)?.degree).toBe(7);
  });

  it("lets a custom binding override the count fallback", () => {
    // "11000" is count 2 -> degree 2 by default; rebind it to degree 7.
    const cfg = bindPrimary(DEFAULT_CONFIG, "11000", 7, "custom");
    expect(resolvePrimary(sig("11000"), cfg)?.degree).toBe(7);
  });
});

describe("resolveModifier", () => {
  it("maps default shapes to extensions", () => {
    expect(resolveModifier(sig("01000"), DEFAULT_CONFIG)?.value).toEqual({
      kind: "extension",
      extension: "sus2",
    });
    expect(resolveModifier(sig("01110"), DEFAULT_CONFIG)?.value).toEqual({
      kind: "extension",
      extension: "seventh",
    });
  });

  it("maps thumb/pinky to major/minor overrides", () => {
    expect(resolveModifier(sig("10000"), DEFAULT_CONFIG)?.value).toEqual({
      kind: "override",
      override: "major",
    });
    expect(resolveModifier(sig("00001"), DEFAULT_CONFIG)?.value).toEqual({
      kind: "override",
      override: "minor",
    });
  });

  it("returns null for an unbound shape", () => {
    expect(resolveModifier(sig("00100"), DEFAULT_CONFIG)).toBeNull();
  });
});
