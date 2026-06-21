import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONFIG,
  bindExtension,
  bindPrimary,
  makeDefaultConfig,
  resolveExtension,
  resolveOverride,
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

describe("resolveExtension (modifier shape)", () => {
  it("matches modifier shapes to extensions", () => {
    expect(resolveExtension(makeTemplate([1]), DEFAULT_CONFIG)?.extension).toBe("sus2");
    expect(resolveExtension(makeTemplate([1, 2]), DEFAULT_CONFIG)?.extension).toBe("sus4");
    expect(resolveExtension(makeTemplate([1, 2, 3]), DEFAULT_CONFIG)?.extension).toBe("seventh");
  });

  it("returns null for a rest/closed hand", () => {
    expect(resolveExtension(makeTemplate([]), DEFAULT_CONFIG)).toBeNull();
  });

  it("recapture replaces an extension's template", () => {
    const cfg = bindExtension(makeDefaultConfig(), makeTemplate([0]), "seventh", "thumb");
    expect(resolveExtension(makeTemplate([0]), cfg)?.extension).toBe("seventh");
    expect(cfg.modifier.filter((e) => e.extension === "seventh")).toHaveLength(1);
  });
});

describe("resolveOverride (modifier orientation)", () => {
  it("maps up/down/side to quality", () => {
    expect(resolveOverride("up")).toBe("majorOverride");
    expect(resolveOverride("down")).toBe("minorOverride");
    expect(resolveOverride("side")).toBe("diatonic");
  });
});
