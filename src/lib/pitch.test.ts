import { describe, expect, it } from "vitest";
import { estimatePitchHz, hzToMidi } from "./pitch";

const sr = 44100;

function sine(hz: number, sampleRate: number, n: number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.sin((2 * Math.PI * hz * i) / sampleRate);
  return out;
}

describe("estimatePitchHz", () => {
  it("recovers the pitch of a pure tone (to the nearest semitone)", () => {
    // Integer-lag autocorrelation: assert via MIDI, which is what the sampler uses.
    expect(hzToMidi(estimatePitchHz(sine(220, sr, sr), sr))).toBe(hzToMidi(220));
    expect(hzToMidi(estimatePitchHz(sine(440, sr, sr), sr))).toBe(hzToMidi(440));
    expect(estimatePitchHz(sine(220, sr, sr), sr)).toBeCloseTo(220, -1);
  });

  it("returns 0 for near-silence", () => {
    expect(estimatePitchHz(new Float32Array(44100), 44100)).toBe(0);
  });
});

describe("hzToMidi", () => {
  it("maps reference pitches to MIDI numbers", () => {
    expect(hzToMidi(440)).toBe(69);
    expect(hzToMidi(261.63)).toBe(60); // middle C
  });
});
