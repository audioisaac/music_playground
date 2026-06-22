// The audio engine. Owns a shared master bus and two sound sources:
//  - a Tone.PolySynth, and
//  - a live vocal harmonizer: the DRY mic is the lead (so you hear your own
//    words), with pitch-shifted copies added as quieter harmony notes.
// The mic is also metered for voice-activity gating. Everything sums into
// `master` -> limiter -> destination; the recorder taps `master`.

import { useCallback, useRef, useState } from "react";
import * as Tone from "tone";
import type { SoundSource } from "../types";
import { relativeIntervals } from "../lib/musicTheory";

const HARMONY_COUNT = 3; // pitch-shifted notes added above the dry lead
const VOICE_LEVEL = 1.0; // voice bus gain when gated on
const DRY_LEVEL = 1.0; // the un-shifted lead voice (your actual words)
const HARMONY_LEVEL = 0.5; // each harmony note, quieter than the lead

interface Harmony {
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
  const dryGainRef = useRef<Tone.Gain | null>(null);
  const harmoniesRef = useRef<Harmony[]>([]);
  const meterRef = useRef<Tone.Meter | null>(null);
  const micRef = useRef<Tone.UserMedia | null>(null);

  const sourceRef = useRef<SoundSource>("synth");
  const synthKeyRef = useRef("silence");
  const vocalNotesKeyRef = useRef("none");

  const start = useCallback(async () => {
    await Tone.start();
    // Minimize scheduling latency for live, interactive triggering.
    Tone.getContext().lookAhead = 0;
    if (masterRef.current) return;

    // master -> limiter -> destination: the limiter caps any residual
    // speaker->mic feedback so it can't swell into a crescendo.
    const limiter = new Tone.Limiter(-2).toDestination();
    const master = new Tone.Gain(1).connect(limiter);
    masterRef.current = master;

    synthRef.current = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "fatsawtooth", count: 3, spread: 24 },
      // Flat envelope: near-instant attack, no decay, full sustain -> constant
      // volume while held (no crescendo/decay), quick release.
      envelope: { attack: 0.01, decay: 0, sustain: 1, release: 0.08 },
      volume: -10,
    }).connect(master);

    const voiceGain = new Tone.Gain(0).connect(master);
    voiceGainRef.current = voiceGain;

    // Dry lead: the user's actual voice/words, un-shifted.
    dryGainRef.current = new Tone.Gain(0).connect(voiceGain);

    // Harmony voices: only the non-root chord intervals, quieter than the lead.
    harmoniesRef.current = Array.from({ length: HARMONY_COUNT }, () => {
      const gain = new Tone.Gain(0).connect(voiceGain);
      const shift = new Tone.PitchShift({ pitch: 0, windowSize: 0.05 }).connect(gain);
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
      if (dryGainRef.current) mic.connect(dryGainRef.current);
      for (const h of harmoniesRef.current) mic.connect(h.shift);
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
    if (target) s.triggerAttack(target); // no scheduling offset -> immediate
  }, []);

  const applyVocal = useCallback((notes: string[] | null, gate: boolean) => {
    const key = notes && notes.length ? notes.join(",") : "none";
    if (key !== vocalNotesKeyRef.current) {
      vocalNotesKeyRef.current = key;
      // intervals[0] is the root (0) -> the dry lead; the rest are harmonies.
      const harmonies = notes ? relativeIntervals(notes).slice(1) : [];
      dryGainRef.current?.gain.rampTo(notes && notes.length ? DRY_LEVEL : 0, 0.02);
      harmoniesRef.current.forEach((h, i) => {
        if (i < harmonies.length) {
          h.shift.pitch = harmonies[i];
          h.gain.gain.rampTo(HARMONY_LEVEL, 0.02);
        } else {
          h.gain.gain.rampTo(0, 0.02);
        }
      });
    }
    const on = !!(gate && notes && notes.length);
    // Short ramps gate the bus without swelling.
    voiceGainRef.current?.gain.rampTo(on ? VOICE_LEVEL : 0, on ? 0.005 : 0.03);
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
    s.triggerAttack(notes);
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
