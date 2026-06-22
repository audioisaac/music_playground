// A classic analysis/synthesis vocoder built from Web Audio / Tone.js nodes.
//
// It imposes the spectral envelope of a MODULATOR (your mic — the formants/words)
// onto a CARRIER (a harmonically-rich synth — the pitch/chord). Per band: the
// modulator's energy in that band opens the carrier's band, so the chord "sings"
// your words. Pure filter banks — no worklet, no pitch detection, near-zero
// latency, and it never outputs the raw mic (so it barely feeds back on speakers).

import * as Tone from "tone";

/** Log-spaced band-center frequencies (Hz) across the speech range. */
export function vocoderBandFreqs(bands: number, lo = 120, hi = 7000): number[] {
  if (bands <= 0) return [];
  if (bands === 1) return [lo];
  const out: number[] = [];
  for (let i = 0; i < bands; i++) {
    out.push(lo * Math.pow(hi / lo, i / (bands - 1)));
  }
  return out;
}

export interface VocoderOptions {
  bands?: number;
  lo?: number;
  hi?: number;
  q?: number;
  /** Modulation depth: how strongly band energy opens the carrier VCA. */
  depth?: number;
  /** Level of the high-pass "sibilance" path (consonant intelligibility). */
  sibilance?: number;
}

export interface VocoderNodes {
  /** Connect the carrier (synth) here. */
  carrier: Tone.Gain;
  /** Connect the modulator (mic) here. */
  modulator: Tone.Gain;
  /** Vocoder output. */
  output: Tone.Gain;
  dispose(): void;
}

/** Build the vocoder node graph. Caller wires carrier/modulator/output. */
export function createVocoder({
  bands = 16,
  lo = 120,
  hi = 7000,
  q = 5,
  depth = 6,
  sibilance = 0.15,
}: VocoderOptions = {}): VocoderNodes {
  const carrier = new Tone.Gain(1);
  const modulator = new Tone.Gain(1);
  const output = new Tone.Gain(1);
  const nodes: { dispose(): void }[] = [carrier, modulator, output];

  for (const f of vocoderBandFreqs(bands, lo, hi)) {
    const carBP = new Tone.Filter({ type: "bandpass", frequency: f, Q: q });
    const modBP = new Tone.Filter({ type: "bandpass", frequency: f, Q: q });
    const rect = new Tone.WaveShaper((x: number) => Math.abs(x)); // full-wave rectify
    const env = new Tone.Filter({ type: "lowpass", frequency: 20 }); // smooth -> envelope
    const amt = new Tone.Gain(depth); // scale the envelope into the VCA gain
    const vca = new Tone.Gain(0); // carrier band, opened by the envelope

    carrier.connect(carBP);
    carBP.connect(vca);
    vca.connect(output);

    modulator.connect(modBP);
    modBP.connect(rect);
    rect.connect(env);
    env.connect(amt);
    amt.connect(vca.gain); // drive the band VCA's gain with the voice envelope

    nodes.push(carBP, modBP, rect, env, amt, vca);
  }

  // Sibilance: pass the voice's high frequencies straight through so unvoiced
  // consonants ("s", "t", "f") survive — pure tones alone can't render them.
  const sibHp = new Tone.Filter({ type: "highpass", frequency: 5000 });
  const sibGain = new Tone.Gain(sibilance);
  modulator.connect(sibHp);
  sibHp.connect(sibGain);
  sibGain.connect(output);
  nodes.push(sibHp, sibGain);

  return {
    carrier,
    modulator,
    output,
    dispose() {
      nodes.forEach((n) => n.dispose());
    },
  };
}
