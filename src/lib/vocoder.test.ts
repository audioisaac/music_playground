import { describe, expect, it } from "vitest";
import { vocoderBandFreqs } from "./vocoder";

describe("vocoderBandFreqs", () => {
  it("returns the requested number of bands spanning lo..hi", () => {
    const f = vocoderBandFreqs(16, 120, 7000);
    expect(f).toHaveLength(16);
    expect(f[0]).toBeCloseTo(120);
    expect(f[f.length - 1]).toBeCloseTo(7000);
  });

  it("is strictly increasing and log-spaced (constant ratio)", () => {
    const f = vocoderBandFreqs(8, 100, 6400);
    for (let i = 1; i < f.length; i++) expect(f[i]).toBeGreaterThan(f[i - 1]);
    const ratio = f[1] / f[0];
    for (let i = 1; i < f.length; i++) {
      expect(f[i] / f[i - 1]).toBeCloseTo(ratio, 5);
    }
  });

  it("handles degenerate band counts", () => {
    expect(vocoderBandFreqs(0)).toEqual([]);
    expect(vocoderBandFreqs(1, 200)).toEqual([200]);
  });
});
