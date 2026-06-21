import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONFIG,
  bindPrimary,
  makeDefaultConfig,
  resolveModifier,
  resolvePrimary,
} from "./gestureMap";
import { makeTemplate } from "./defaultTemplates";

describe("resolvePrimary (whole-hand matching)", () => {
  it("matches each built-in degree shape to its degree", () => {
    expect(resolvePrimary(makeTemplate([1]), DEFAULT_CONFIG)?.degree).toBe(1);
    expect(resolvePrimary(makeTemplate([1, 2]), DEFAULT_CONFIG)?.degree).toBe(2);
    expect(resolvePrimary(makeTemplate([0, 1, 2, 3, 4]), DEFAULT_CONFIG)?.degree).toBe(5);
    expect(resolvePrimary(makeTemplate([0, 4]), DEFAULT_CONFIG)?.degree).toBe(6);
    expect(resolvePrimary(makeTemplate([1, 4]), DEFAULT_CONFIG)?.degree).toBe(7);
  });

  it("returns null for an unrecognized shape (e.g. a fist)", () => {
    expect(resolvePrimary(makeTemplate([]), DEFAULT_CONFIG)).toBeNull();
  });

  it("recapture replaces a degree's template", () => {
    const cfg = bindPrimary(makeDefaultConfig(), makeTemplate([0]), 1, "thumb");
    // Degree 1 now answers to a thumb-only shape...
    expect(resolvePrimary(makeTemplate([0]), cfg)?.degree).toBe(1);
    // ...and there is still exactly one entry per degree.
    expect(cfg.primary.filter((e) => e.degree === 1)).toHaveLength(1);
  });
});

describe("resolveModifier", () => {
  it("matches modifier shapes to extensions and overrides", () => {
    expect(resolveModifier(makeTemplate([1]), DEFAULT_CONFIG)?.value).toEqual({
      kind: "extension",
      extension: "sus2",
    });
    expect(resolveModifier(makeTemplate([0]), DEFAULT_CONFIG)?.value).toEqual({
      kind: "override",
      override: "major",
    });
    expect(resolveModifier(makeTemplate([4]), DEFAULT_CONFIG)?.value).toEqual({
      kind: "override",
      override: "minor",
    });
  });
});
