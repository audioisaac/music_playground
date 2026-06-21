// A thin React wrapper around a Tone.js PolySynth with hold-to-sustain control.

import { useCallback, useRef } from "react";
import * as Tone from "tone";

export interface SynthApi {
  /** Must be called from a user gesture to unlock the audio context. */
  start: () => Promise<void>;
  /** Sound a chord, replacing whatever is currently held (sustain model). */
  setChord: (notes: string[]) => void;
  /** Release all currently held notes (silence). */
  release: () => void;
  /** The underlying Tone node, so a recorder can tap the output. */
  getNode: () => Tone.PolySynth | null;
  isStarted: () => boolean;
}

export function useSynth(): SynthApi {
  const synthRef = useRef<Tone.PolySynth | null>(null);
  const startedRef = useRef(false);

  const ensureSynth = useCallback(() => {
    if (!synthRef.current) {
      synthRef.current = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "fatsawtooth", count: 3, spread: 24 },
        envelope: { attack: 0.04, decay: 0.2, sustain: 0.7, release: 0.6 },
        volume: -10,
      }).toDestination();
    }
    return synthRef.current;
  }, []);

  const start = useCallback(async () => {
    await Tone.start();
    ensureSynth();
    startedRef.current = true;
  }, [ensureSynth]);

  const setChord = useCallback(
    (notes: string[]) => {
      const synth = ensureSynth();
      synth.releaseAll();
      // Tiny offset avoids overlapping attack/release at the same timestamp.
      synth.triggerAttack(notes, Tone.now() + 0.01);
    },
    [ensureSynth],
  );

  const release = useCallback(() => {
    synthRef.current?.releaseAll();
  }, []);

  const getNode = useCallback(() => synthRef.current, []);
  const isStarted = useCallback(() => startedRef.current, []);

  return { start, setChord, release, getNode, isStarted };
}
