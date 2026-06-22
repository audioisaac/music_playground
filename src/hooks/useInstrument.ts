// The audio engine. Owns a shared master bus and two sound sources:
//  - a Tone.PolySynth ("Synth"), and
//  - a VOCODER ("Vocoder"): the synth is the carrier and your mic is the
//    modulator, so the gesture chord "sings" your words (the chord, shaped by
//    your mouth). See src/lib/vocoder.ts.
// It also hosts a "Voice Lab": capture the mic to a buffer, play it back, and
// pitch-shift that playback. Everything sums into `master` -> limiter ->
// destination; the recorder taps `fxOut`.

import { useCallback, useRef, useState } from "react";
import * as Tone from "tone";
import type { SoundSource } from "../types";
import type { Expression } from "../lib/expression";
import { createVocoder, type VocoderNodes } from "../lib/vocoder";

const CAPTURE_SECONDS = 3; // Voice Lab: default capture length

export interface InstrumentApi {
  start: () => Promise<void>;
  ensureMic: (deviceId?: string) => Promise<void>;
  setSource: (source: SoundSource) => void;
  /** Voice Lab — capture the mic to a buffer (default 3s). */
  captureVoice: (seconds?: number) => Promise<void>;
  /** Voice Lab — play the captured buffer back, unmodified. */
  playCapture: () => void;
  /** Voice Lab — play the captured buffer pitch-shifted (time-preserving). */
  playCaptureShifted: () => void;
  /** Voice Lab — set the playback pitch shift (semitones; live during playback). */
  setCapturePitch: (semitones: number) => void;
  /** Voice Lab — stop any capture playback. */
  stopCapture: () => void;
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
  /** Voice Lab status. */
  isCapturing: boolean;
  hasCapture: boolean;
}

export function useInstrument(): InstrumentApi {
  const [micError, setMicError] = useState<string | null>(null);
  const [micReady, setMicReady] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [hasCapture, setHasCapture] = useState(false);

  const masterRef = useRef<Tone.Gain | null>(null);
  const filterRef = useRef<Tone.Filter | null>(null);
  const reverbRef = useRef<Tone.Reverb | null>(null);
  const fxOutRef = useRef<Tone.Gain | null>(null);
  const synthRef = useRef<Tone.PolySynth | null>(null);
  // Vocoder: the synth is the carrier; `synthDirect` is the plain-synth path and
  // `vocoderOut` is the vocoded path — one is open at a time per Source.
  const vocoderRef = useRef<VocoderNodes | null>(null);
  const synthDirectRef = useRef<Tone.Gain | null>(null);
  const vocoderOutRef = useRef<Tone.Gain | null>(null);
  const meterRef = useRef<Tone.Meter | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const micPullElRef = useRef<HTMLAudioElement | null>(null);
  // Voice Lab: captured buffer + a time-preserving pitch shifter for playback.
  const capturedBufferRef = useRef<AudioBuffer | null>(null);
  const capturePlayerRef = useRef<Tone.Player | null>(null);
  const capturePitchShiftRef = useRef<Tone.PitchShift | null>(null);
  const capturePitchRef = useRef(0);

  const sourceRef = useRef<SoundSource>("synth");
  const synthKeyRef = useRef("silence");

  const start = useCallback(async () => {
    await Tone.start();
    // Small look-ahead (not 0): 0 starves the scheduler and causes crackle.
    Tone.getContext().lookAhead = 0.02;
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

    const synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "fatsawtooth", count: 3, spread: 24 },
      // Flat envelope: near-instant attack, no decay, full sustain -> constant
      // volume while held (no crescendo/decay), quick release.
      envelope: { attack: 0.01, decay: 0, sustain: 1, release: 0.08 },
      volume: -10,
    });
    synthRef.current = synth;

    // The synth is the carrier for both modes: a direct path (plain Synth) and a
    // vocoder path (the chord sings your words). One output gain is open per Source.
    const synthDirect = new Tone.Gain(1).connect(master); // Synth mode
    const vocoderOut = new Tone.Gain(0).connect(master); // Vocoder mode
    const vocoder = createVocoder();
    vocoder.output.connect(vocoderOut);
    synth.connect(synthDirect);
    synth.connect(vocoder.carrier);
    synthDirectRef.current = synthDirect;
    vocoderOutRef.current = vocoderOut;
    vocoderRef.current = vocoder;

    meterRef.current = new Tone.Meter(); // mic level for the "while singing" gate

    // Voice Lab playback pitch shifter: time-preserving (no chipmunk).
    capturePitchShiftRef.current = new Tone.PitchShift({ pitch: 0 }).connect(fxOut);
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
    // Chrome quirk: a MediaStreamAudioSourceNode stays silent unless the stream
    // is also "pulled" by a media element. Attach a muted <audio> to wake it up.
    if (!micPullElRef.current) {
      const el = document.createElement("audio");
      el.muted = true;
      micPullElRef.current = el;
    }
    micPullElRef.current.srcObject = stream;
    micPullElRef.current.play().catch(() => {});
    if (meterRef.current) Tone.connect(src, meterRef.current);
    // Mic = the vocoder's modulator (its formants shape the carrier synth).
    if (vocoderRef.current) Tone.connect(src, vocoderRef.current.modulator);
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

  // The synth is the carrier in BOTH modes; the Source just routes it to the
  // plain output or through the vocoder, so update() always plays the chord.
  const update = useCallback(
    (notes: string[] | null, gate: boolean) => {
      applySynth(notes, gate);
    },
    [applySynth],
  );

  const setSource = useCallback((source: SoundSource) => {
    sourceRef.current = source;
    const vocoder = source !== "synth"; // "vocal" value = Vocoder mode
    synthDirectRef.current?.gain.rampTo(vocoder ? 0 : 1, 0.05);
    vocoderOutRef.current?.gain.rampTo(vocoder ? 1 : 0, 0.05);
  }, []);

  // ── Voice Lab: capture → playback → modulate ───────────────────────────────

  const stopCapture = useCallback(() => {
    const p = capturePlayerRef.current;
    if (p) {
      try { p.stop(); } catch { /* not started */ }
      p.dispose();
      capturePlayerRef.current = null;
    }
  }, []);

  // Step 1 — capture: record the mic source to an AudioBuffer (no gestures needed).
  const captureVoice = useCallback(
    async (seconds = CAPTURE_SECONDS) => {
      await ensureMic();
      const src = micSourceRef.current;
      if (!src) return;
      const rec = new Tone.Recorder();
      Tone.connect(src, rec);
      setIsCapturing(true);
      rec.start();
      await new Promise((r) => setTimeout(r, seconds * 1000));
      const blob = await rec.stop();
      rec.dispose(); // releases the src -> recorder connection
      const ctx = Tone.getContext().rawContext as AudioContext;
      capturedBufferRef.current = await ctx.decodeAudioData(await blob.arrayBuffer());
      setIsCapturing(false);
      setHasCapture(true);
    },
    [ensureMic],
  );

  // Build a fresh one-shot player from the captured buffer (caller routes/starts).
  const newCapturePlayer = useCallback((): Tone.Player | null => {
    const buf = capturedBufferRef.current;
    if (!buf) return null;
    stopCapture();
    const player = new Tone.Player(new Tone.ToneAudioBuffer(buf));
    capturePlayerRef.current = player;
    return player;
  }, [stopCapture]);

  // Step 2 — faithful playback: straight to fxOut, no shifter.
  const playCapture = useCallback(() => {
    const player = newCapturePlayer();
    if (!player || !fxOutRef.current) return;
    player.connect(fxOutRef.current);
    player.start();
  }, [newCapturePlayer]);

  // Step 3 — modulate: through Tone.PitchShift (time-preserving — pitch changes,
  // tempo/length stay the same, so no chipmunk).
  const playCaptureShifted = useCallback(() => {
    const player = newCapturePlayer();
    const shift = capturePitchShiftRef.current;
    if (!player || !shift) return;
    shift.pitch = capturePitchRef.current;
    player.connect(shift); // -> fxOut
    player.start();
  }, [newCapturePlayer]);

  const setCapturePitch = useCallback((semitones: number) => {
    capturePitchRef.current = semitones;
    if (capturePitchShiftRef.current) {
      capturePitchShiftRef.current.pitch = semitones; // live during playback
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
    captureVoice,
    playCapture,
    playCaptureShifted,
    setCapturePitch,
    stopCapture,
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
    isCapturing,
    hasCapture,
  };
}
