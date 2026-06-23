// The audio engine. Owns a shared master bus and two sound sources:
//  - a Tone.PolySynth ("Synth"), and
//  - a live HARMONIZER ("Harmonize", Antares-style): your mic is the lead and
//    N formant-preserving pitch-shifters (public/formant-shifter-worklet.js) add
//    in-key harmony voices following the gesture chord — your real voice in
//    harmony, not chipmunky.
// It also hosts a "Voice Lab": capture the mic to a buffer, play it back, and
// pitch-shift that playback. Everything sums into `master` -> limiter ->
// destination; the recorder taps `fxOut`.

import { useCallback, useRef, useState } from "react";
import * as Tone from "tone";
import type { SoundSource } from "../types";
import type { Expression } from "../lib/expression";
import { noteToMidi } from "../lib/musicTheory";
import { estimatePitchHz } from "../lib/pitch";
import { assignHarmonyTargets, shiftRatio } from "../lib/harmonyVoicing";

const HARMONY_VOICES = 3; // simultaneous harmony voices stacked above the lead
const VOICE_LEVEL = 1.0; // voice bus gain when gated on
const DRY_LEVEL = 1.0; // the un-shifted lead voice (your actual voice)
const HARMONY_LEVEL = 0.6; // each harmony voice, a touch under the lead
const CAPTURE_SECONDS = 3; // Voice Lab: default capture length
const CONTROL_TICK_MS = 30; // pitch-detect + retarget cadence (~33 Hz)
const PITCH_FFT_SIZE = 2048; // analyser window for the sung-pitch detector

/** One harmony voice: a pitch shifter (worklet, or Tone.PitchShift fallback). */
interface HarmonyVoice {
  /** Mic connects here. */
  input: Tone.ToneAudioNode | AudioWorkletNode;
  gain: Tone.Gain;
  /** Set the shift ratio (target/sung frequency). */
  setRatio: (ratio: number) => void;
}

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
  // Harmonizer voice bus: dry lead + N formant-preserving shifters -> voiceGain.
  const voiceGainRef = useRef<Tone.Gain | null>(null);
  const dryGainRef = useRef<Tone.Gain | null>(null);
  const harmoniesRef = useRef<HarmonyVoice[]>([]);
  const meterRef = useRef<Tone.Meter | null>(null);
  const analyserRef = useRef<Tone.Analyser | null>(null);
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
  // Harmonizer state.
  const chordPcsRef = useRef<number[]>([]); // current gesture chord, pitch classes
  const vocalActiveRef = useRef(false); // gate open AND a chord is set
  const controlLoopRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Control loop (~33 Hz): detect the sung pitch and retarget each harmony voice
  // to an in-key chord tone above it. Runs on the main thread; the formant shift
  // itself runs continuously in the worklet, so the harmonies track instantly.
  const controlLoop = useCallback(() => {
    if (sourceRef.current !== "vocal" || !vocalActiveRef.current) return;
    const an = analyserRef.current;
    const voices = harmoniesRef.current;
    const pcs = chordPcsRef.current;
    if (!an || voices.length === 0 || pcs.length === 0) return;
    const buf = an.getValue() as Float32Array;
    const hz = estimatePitchHz(buf, Tone.getContext().sampleRate);
    if (!hz) return; // unvoiced: hold the last targets (lead stays audible)
    const sung = 69 + 12 * Math.log2(hz / 440); // fractional MIDI
    const targets = assignHarmonyTargets(Math.round(sung), pcs, voices.length);
    voices.forEach((v, i) => {
      if (i < targets.length) {
        v.setRatio(shiftRatio(sung, targets[i]));
        v.gain.gain.rampTo(HARMONY_LEVEL, 0.05);
      } else {
        v.gain.gain.rampTo(0, 0.08);
      }
    });
  }, []);

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

    synthRef.current = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "fatsawtooth", count: 3, spread: 24 },
      // Flat envelope: near-instant attack, no decay, full sustain -> constant
      // volume while held (no crescendo/decay), quick release.
      envelope: { attack: 0.01, decay: 0, sustain: 1, release: 0.08 },
      volume: -10,
    }).connect(master);

    // Load the formant-preserving pitch-shifter worklet (self-contained — no
    // vendored lib). On failure, voices fall back to Tone.PitchShift (non-formant).
    const ctx = Tone.getContext().rawContext as AudioContext;
    let workletReady = false;
    try {
      await ctx.audioWorklet.addModule(
        import.meta.env.BASE_URL + "formant-shifter-worklet.js",
      );
      workletReady = true;
    } catch (e) {
      setMicError(
        `Formant shifter unavailable (using fallback): ${e instanceof Error ? e.message : e}`,
      );
    }

    // Voice bus bypasses the reverb so the harmony stays clean/dry.
    const voiceGain = new Tone.Gain(0).connect(fxOut);
    voiceGainRef.current = voiceGain;
    dryGainRef.current = new Tone.Gain(0).connect(voiceGain); // un-shifted lead

    harmoniesRef.current = Array.from({ length: HARMONY_VOICES }, () => {
      const gain = new Tone.Gain(0).connect(voiceGain);
      if (workletReady) {
        try {
          const node = new AudioWorkletNode(ctx, "formant-shifter", {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            channelCount: 1,
          });
          Tone.connect(node, gain);
          const p = node.parameters.get("ratio");
          return {
            input: node,
            gain,
            setRatio: (r: number) => { if (p) p.value = r; },
          };
        } catch { /* fall through to the Tone.PitchShift fallback */ }
      }
      const shift = new Tone.PitchShift({ pitch: 0, windowSize: 0.05, feedback: 0 }).connect(gain);
      return {
        input: shift,
        gain,
        setRatio: (r: number) => { shift.pitch = 12 * Math.log2(r); },
      };
    });

    meterRef.current = new Tone.Meter(); // mic level for the "while singing" gate
    analyserRef.current = new Tone.Analyser("waveform", PITCH_FFT_SIZE);

    // Voice Lab playback pitch shifter: time-preserving (no chipmunk).
    capturePitchShiftRef.current = new Tone.PitchShift({ pitch: 0 }).connect(fxOut);

    // Control loop: retarget the harmony voices to the sung pitch + chord.
    if (!controlLoopRef.current) {
      controlLoopRef.current = setInterval(controlLoop, CONTROL_TICK_MS);
    }
  }, [controlLoop]);

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
    if (analyserRef.current) Tone.connect(src, analyserRef.current);
    // Mic = the lead (dry) + the input to each formant-shift harmony voice.
    if (dryGainRef.current) Tone.connect(src, dryGainRef.current);
    for (const v of harmoniesRef.current) Tone.connect(src, v.input);
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

  // Harmonize mode: the mic is the lead; the gesture chord only picks the harmony
  // notes (the control loop sets the shift ratios from the detected sung pitch).
  const applyHarmonize = useCallback((notes: string[] | null, gate: boolean) => {
    chordPcsRef.current =
      notes && notes.length ? notes.map((n) => ((noteToMidi(n) % 12) + 12) % 12) : [];
    const on = !!(gate && notes && notes.length);
    vocalActiveRef.current = on;
    dryGainRef.current?.gain.rampTo(on ? DRY_LEVEL : 0, on ? 0.02 : 0.05);
    voiceGainRef.current?.gain.rampTo(on ? VOICE_LEVEL : 0, on ? 0.01 : 0.05);
    if (!on) harmoniesRef.current.forEach((v) => v.gain.gain.rampTo(0, 0.08));
  }, []);

  const update = useCallback(
    (notes: string[] | null, gate: boolean) => {
      if (sourceRef.current === "synth") {
        applySynth(notes, gate);
        voiceGainRef.current?.gain.rampTo(0, 0.05);
        vocalActiveRef.current = false;
      } else {
        applyHarmonize(notes, gate);
        synthRef.current?.releaseAll();
        synthKeyRef.current = "silence";
      }
    },
    [applySynth, applyHarmonize],
  );

  const setSource = useCallback((source: SoundSource) => {
    sourceRef.current = source;
    if (source === "synth") {
      voiceGainRef.current?.gain.rampTo(0, 0.05);
      vocalActiveRef.current = false;
    } else {
      synthRef.current?.releaseAll();
      synthKeyRef.current = "silence";
    }
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
