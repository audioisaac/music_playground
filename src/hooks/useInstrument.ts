// The audio engine. Owns a shared master bus and two sound sources:
//  - a Tone.PolySynth, and
//  - a live vocal harmonizer (mic -> N pitch-shifters tuned to the chord's
//    relative intervals).
// The mic is also metered for voice-activity gating. Everything sums into
// `master`, which the recorder taps so it captures whichever source is active.

import { useCallback, useRef, useState } from "react";
import * as Tone from "tone";
import type { SoundSource } from "../types";
import { relativeIntervals } from "../lib/musicTheory";

const VOICE_COUNT = 4; // max simultaneous harmonized voices
const VOICE_LEVEL = 1.0; // master voice-bus gain when gated on

interface Voice {
  shift: Tone.PitchShift;
  gain: Tone.Gain;
}

export interface InstrumentApi {
  start: () => Promise<void>;
  ensureMic: () => Promise<void>;
  setSource: (source: SoundSource) => void;
  /** Drive the sound: which notes (or null) and whether the gate is open. */
  update: (notes: string[] | null, gate: boolean) => void;
  /** Mic input level in dB (-Infinity if no mic), for voice-activity gating. */
  getInputLevel: () => number;
  /** Master node for the recorder to tap. */
  getRecordNode: () => Tone.ToneAudioNode | null;
  /** Always sound notes via the synth (used for in-app replay). */
  previewAttack: (notes: string[]) => void;
  previewRelease: () => void;
  micError: string | null;
  micReady: boolean;
}

export function useInstrument(): InstrumentApi {
  const [micError, setMicError] = useState<string | null>(null);
  const [micReady, setMicReady] = useState(false);

  const masterRef = useRef<Tone.Gain | null>(null);
  const synthRef = useRef<Tone.PolySynth | null>(null);
  const voiceGainRef = useRef<Tone.Gain | null>(null);
  const voicesRef = useRef<Voice[]>([]);
  const meterRef = useRef<Tone.Meter | null>(null);
  const micRef = useRef<Tone.UserMedia | null>(null);

  const sourceRef = useRef<SoundSource>("synth");
  const synthKeyRef = useRef("silence");
  const vocalNotesKeyRef = useRef("none");

  const start = useCallback(async () => {
    await Tone.start();
    if (masterRef.current) return;

    const master = new Tone.Gain(1).toDestination();
    masterRef.current = master;

    synthRef.current = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "fatsawtooth", count: 3, spread: 24 },
      envelope: { attack: 0.04, decay: 0.2, sustain: 0.7, release: 0.6 },
      volume: -10,
    }).connect(master);

    const voiceGain = new Tone.Gain(0).connect(master);
    voiceGainRef.current = voiceGain;
    voicesRef.current = Array.from({ length: VOICE_COUNT }, () => {
      const gain = new Tone.Gain(0).connect(voiceGain);
      const shift = new Tone.PitchShift({ pitch: 0, windowSize: 0.1 }).connect(gain);
      return { shift, gain };
    });

    meterRef.current = new Tone.Meter();
  }, []);

  const ensureMic = useCallback(async () => {
    if (micRef.current) return;
    try {
      const mic = new Tone.UserMedia();
      await mic.open();
      micRef.current = mic;
      if (meterRef.current) mic.connect(meterRef.current);
      for (const v of voicesRef.current) mic.connect(v.shift);
      setMicReady(true);
      setMicError(null);
    } catch (e) {
      setMicError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const applySynth = useCallback((notes: string[] | null, gate: boolean) => {
    const target = gate && notes && notes.length ? notes : null;
    const key = target ? target.join(",") : "silence";
    if (key === synthKeyRef.current) return;
    synthKeyRef.current = key;
    const s = synthRef.current;
    if (!s) return;
    s.releaseAll();
    if (target) s.triggerAttack(target, Tone.now() + 0.01);
  }, []);

  const applyVocal = useCallback((notes: string[] | null, gate: boolean) => {
    const key = notes && notes.length ? notes.join(",") : "none";
    if (key !== vocalNotesKeyRef.current) {
      vocalNotesKeyRef.current = key;
      const intervals = notes ? relativeIntervals(notes) : [];
      const perVoice = intervals.length ? 1 / intervals.length : 0;
      voicesRef.current.forEach((v, i) => {
        if (i < intervals.length) {
          v.shift.pitch = intervals[i];
          v.gain.gain.rampTo(perVoice, 0.03);
        } else {
          v.gain.gain.rampTo(0, 0.03);
        }
      });
    }
    const on = !!(gate && notes && notes.length);
    voiceGainRef.current?.gain.rampTo(on ? VOICE_LEVEL : 0, on ? 0.03 : 0.08);
  }, []);

  const update = useCallback(
    (notes: string[] | null, gate: boolean) => {
      if (sourceRef.current === "synth") {
        applySynth(notes, gate);
        voiceGainRef.current?.gain.rampTo(0, 0.05);
      } else {
        applyVocal(notes, gate);
        synthRef.current?.releaseAll();
        synthKeyRef.current = "silence";
      }
    },
    [applySynth, applyVocal],
  );

  const setSource = useCallback((source: SoundSource) => {
    sourceRef.current = source;
    // Force the next update() to reconfigure from a clean slate.
    if (source === "synth") {
      voiceGainRef.current?.gain.rampTo(0, 0.05);
      vocalNotesKeyRef.current = "none";
    } else {
      synthRef.current?.releaseAll();
      synthKeyRef.current = "silence";
    }
  }, []);

  const getInputLevel = useCallback(() => {
    const m = meterRef.current;
    if (!m || !micRef.current) return -Infinity;
    const v = m.getValue();
    return typeof v === "number" ? v : v[0];
  }, []);

  const getRecordNode = useCallback(() => masterRef.current, []);

  const previewAttack = useCallback((notes: string[]) => {
    const s = synthRef.current;
    if (!s) return;
    s.releaseAll();
    s.triggerAttack(notes, Tone.now() + 0.01);
  }, []);

  const previewRelease = useCallback(() => {
    synthRef.current?.releaseAll();
  }, []);

  return {
    start,
    ensureMic,
    setSource,
    update,
    getInputLevel,
    getRecordNode,
    previewAttack,
    previewRelease,
    micError,
    micReady,
  };
}
