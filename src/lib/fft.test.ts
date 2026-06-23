import { describe, expect, it } from "vitest";
import { fft } from "./fft";

describe("fft", () => {
  it("round-trips (forward then inverse ≈ original)", () => {
    const n = 64;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.sin(i) + 0.5 * Math.cos(0.3 * i);
    const re0 = Float64Array.from(re);
    fft(re, im, false);
    fft(re, im, true);
    for (let i = 0; i < n; i++) {
      expect(re[i]).toBeCloseTo(re0[i], 9);
      expect(im[i]).toBeCloseTo(0, 9);
    }
  });

  it("puts a pure cosine's energy in the expected bin", () => {
    const n = 32;
    const bin = 4;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * bin * i) / n);
    fft(re, im, false);
    const mag = (k: number) => Math.hypot(re[k], im[k]);
    // Energy concentrated at bin 4 (and its mirror n-4), ~0 elsewhere.
    expect(mag(bin)).toBeGreaterThan(n / 4);
    expect(mag(bin + 1)).toBeLessThan(1e-6);
  });
});
