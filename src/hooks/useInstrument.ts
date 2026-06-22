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
import type { Expression } from "../lib/expression";

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
  ensureMic: (deviceId?: string) => Promise<void>;
  setSource: (source: SoundSource) => void;
  /** Drive the sound: which notes (or null) and whether the gate is open. */
  update: (notes: string[] | null, gate: boolean) => void;
  /** Apply MiMU-style motion expression (volume / brightness / bend / reverb). */
  setExpression: (e: Expression) => void;
  /** Switch the input mic device (re-acquires the stream). */
  setInputDevice: (deviceId: string) => Promise<void>;
  /** Route audio to a specific output device (Chromium setSinkId). */
  setOutputDevice: (deviceId: string) => Promise<void>;
  /** Whether output-device selection is supported by this browser. */
  outputSelectable: boolean;
  /** Mic input level in dB (-Infinity if no mic), for voice-activity gating. */
  getInputLevel: () => number;
  /** Post-FX node for the recorder to tap (so expression is recorded). */
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
  const filterRef = useRef<Tone.Filter | null>(null);
  const reverbRef = useRef<Tone.Reverb | null>(null);
  const fxOutRef = useRef<Tone.Gain | null>(null);
  const synthRef = useRef<Tone.PolySynth | null>(null);
  const voiceGainRef = useRef<Tone.Gain | null>(null);
  const dryGainRef = useRef<Tone.Gain | null>(null);
  const harmoniesRef = useRef<Harmony[]>([]);
  const meterRef = useRef<Tone.Meter | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  const sourceRef = useRef<SoundSource>("synth");
  const synthKeyRef = useRef("silence");
  const vocalNotesKeyRef = useRef("none");

  const start = useCallback(async () => {
    await Tone.start();
    // Minimize scheduling latency for live, interactive triggering.
    Tone.getContext().lookAhead = 0;
    if (masterRef.current) return;

    // Chain: master -> filter -> reverb -> fxOut -> limiter -> destination.
    // Motion expression drives master gain (volume), filter cutoff (brightness)
    // and reverb wet; the recorder taps fxOut so expression is captured. The
    // limiter caps any residual speaker->mic feedback so it can't swell.
    const limiter = new Tone.Limiter(-2).toDestination();
    const fxOut = new Tone.Gain(1).connect(limiter);
    const reverb = new Tone.Reverb({ decay: 2.5, wet: 0 }).connect(fxOut);
    const filter = new Tone.Filter({ type: "lowpass", frequency: 12000, Q: 0.7 }).connect(reverb);
    const master = new Tone.Gain(1).connect(filter);
    masterRef.current = master;
    filterRef.current = filter;
    reverbRef.current = reverb;
    fxOutRef.current = fxOut;

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

  // Raw getUserMedia (auto-gain off for low latency / no volume drift), wired
  // into the graph. Pre-warmed at Start and kept open so vocals turn on instantly.
  const openMic = useCallback(async (deviceId?: string) => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        autoGainControl: false,
        echoCancellation: true,
        noiseSuppression: true,
        channelCount: 1,
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      },
    });
    micStreamRef.current = stream;
    const ctx = Tone.getContext().rawContext as AudioContext;
    const src = ctx.createMediaStreamSource(stream);
    micSourceRef.current = src;
    if (meterRef.current) Tone.connect(src, meterRef.current);
    if (dryGainRef.current) Tone.connect(src, dryGainRef.current);
    for (const h of harmoniesRef.current) Tone.connect(src, h.shift);
    setMicReady(true);
    setMicError(null);
  }, []);

  const ensureMic = useCallback(
    async (deviceId?: string) => {
      if (micStreamRef.current) return;
      try {
        await openMic(deviceId);
      } catch (e) {
        setMicError(e instanceof Error ? e.message : String(e));
      }
    },
    [openMic],
  );

  const setInputDevice = useCallback(
    async (deviceId: string) => {
      // Tear down the old stream/source, then re-acquire on the new device.
      micSourceRef.current?.disconnect();
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
      micSourceRef.current = null;
      try {
        await openMic(deviceId);
      } catch (e) {
        setMicError(e instanceof Error ? e.message : String(e));
      }
    },
    [openMic],
  );

  const outputSelectable =
    typeof (AudioContext.prototype as { setSinkId?: unknown }).setSinkId ===
    "function";

  const setOutputDevice = useCallback(
    async (deviceId: string) => {
      const ctx = Tone.getContext().rawContext as AudioContext & {
        setSinkId?: (id: string) => Promise<void>;
      };
      if (ctx.setSinkId) await ctx.setSinkId(deviceId);
    },
    [],
  );

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

  const setExpression = useCallback((e: Expression) => {
    masterRef.current?.gain.rampTo(e.volume, 0.05);
    filterRef.current?.frequency.rampTo(e.brightnessHz, 0.05);
    reverbRef.current?.wet.rampTo(e.reverbWet, 0.08);
    // Pitch bend applies to the synth source.
    synthRef.current?.set({ detune: e.bendCents });
  }, []);

  const getInputLevel = useCallback(() => {
    const m = meterRef.current;
    if (!m || !micStreamRef.current) return -Infinity;
    const v = m.getValue();
    return typeof v === "number" ? v : v[0];
  }, []);

  const getRecordNode = useCallback(() => fxOutRef.current, []);

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
    setExpression,
    setInputDevice,
    setOutputDevice,
    outputSelectable,
    getInputLevel,
    getRecordNode,
    previewAttack,
    previewRelease,
    micError,
    micReady,
  };
}
