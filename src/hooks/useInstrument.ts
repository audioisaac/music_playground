// The audio engine. Owns a shared master bus and two sound sources:
//  - a Tone.PolySynth, and
//  - a live vocal harmonizer (MiMU-style): the DRY mic is the lead (you hear
//    your own voice), with Tone.PitchShift copies stacked in PARALLEL at the
//    gesture chord's intervals (your voice + maj3 + 5th, etc).
// It also hosts a "Voice Lab": capture the mic to a buffer, play it back, and
// pitch-shift that playback. Everything sums into `master` -> limiter ->
// destination; the recorder taps `fxOut`.

import { useCallback, useRef, useState } from "react";
import * as Tone from "tone";
import type { SoundSource } from "../types";
import { midiToNoteName, relativeIntervals } from "../lib/musicTheory";
import type { Expression } from "../lib/expression";
import { estimatePitchHz, hzToMidi } from "../lib/pitch";

const HARMONY_COUNT = 3; // parallel harmony layers stacked on the dry lead
const VOICE_LEVEL = 1.0; // voice bus gain when gated on
const DRY_LEVEL = 1.0; // the un-shifted lead voice (your actual words)
const HARMONY_LEVEL = 0.5; // each harmony note, quieter than the lead
const CAPTURE_SECONDS = 3; // Voice Lab: default capture length
const FEEDBACK_FLOOR = 0.012; // mic RMS (waveform -1..1) at/below this = silence

const MONITOR_TICK_MS = 40; // feedback-duck + read-out cadence (display only)
const PITCH_FFT_SIZE = 2048; // analyser window for the read-out pitch detector
const VOCAL_INFO_STALE_MS = 200; // read-out clears this long after the last detect

interface Harmony {
  shift: Tone.PitchShift;
  gain: Tone.Gain;
}

/** Live read-out for the "Now Playing" panel (sung note + harmony notes). */
export interface VocalInfo {
  sungNote: string | null;
  harmonyNotes: string[];
}

export interface InstrumentApi {
  start: () => Promise<void>;
  ensureMic: (deviceId?: string) => Promise<void>;
  setSource: (source: SoundSource) => void;
  /** Mute the dry lead (output harmonies only) to cut feedback. */
  setHarmoniesOnly: (only: boolean) => void;
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
  /** Live sung note + harmony notes for the read-out (nulls when not singing). */
  getVocalInfo: () => VocalInfo;
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
  const voiceGainRef = useRef<Tone.Gain | null>(null);
  const feedbackDuckRef = useRef<Tone.Gain | null>(null);
  const dryGainRef = useRef<Tone.Gain | null>(null);
  const harmoniesRef = useRef<Harmony[]>([]);
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

  // Parallel harmony state: the chord's intervals (semitones) stacked on the voice.
  const harmonyIntervalsRef = useRef<number[]>([]);
  const vocalActiveRef = useRef(false); // gate open AND a chord is set
  const monitorLoopRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Live read-out (sung note + harmony note names) for the "Now Playing" panel.
  const liveSungMidiRef = useRef<number | null>(null);
  const liveVocalTsRef = useRef(0);

  const sourceRef = useRef<SoundSource>("synth");
  const harmoniesOnlyRef = useRef(false);
  const synthKeyRef = useRef("silence");
  const vocalNotesKeyRef = useRef("none");

  // Lightweight monitor (~40 ms) — NOT in the harmony DSP path. It only:
  //  (a) feedback-ducks the voice bus when the mic goes quiet (speaker-safe), and
  //  (b) detects the sung pitch for the "Now Playing" read-out (display only).
  const monitorLoop = useCallback(() => {
    if (sourceRef.current !== "vocal") return;
    const an = analyserRef.current;
    if (!an) return;
    const buf = an.getValue() as Float32Array;

    let sumSq = 0;
    for (let i = 0; i < buf.length; i++) sumSq += buf[i] * buf[i];
    const open = Math.sqrt(sumSq / buf.length) > FEEDBACK_FLOOR;
    feedbackDuckRef.current?.gain.rampTo(open ? 1 : 0, open ? 0.02 : 0.12);

    if (!vocalActiveRef.current) return;
    const hz = estimatePitchHz(buf, Tone.getContext().sampleRate);
    if (!hz) return; // unvoiced: keep the last read-out briefly (then it goes stale)
    liveSungMidiRef.current = hzToMidi(hz);
    liveVocalTsRef.current = performance.now();
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

    // Voice bus bypasses the reverb so harmonies stay clean/dry. A feedback-duck
    // gain sits after it: the harmony loop pulls it to 0 when the mic goes quiet,
    // so the live mic->speaker path can't sustain a howl on built-in speakers.
    const feedbackDuck = new Tone.Gain(1).connect(fxOut);
    feedbackDuckRef.current = feedbackDuck;
    const voiceGain = new Tone.Gain(0).connect(feedbackDuck);
    voiceGainRef.current = voiceGain;

    // Dry lead: the user's actual voice/words, un-shifted.
    dryGainRef.current = new Tone.Gain(0).connect(voiceGain);

    meterRef.current = new Tone.Meter();
    // Waveform analyser: a parallel tap used to detect the sung pitch for the
    // "Now Playing" read-out and the feedback duck (display/safety only).
    analyserRef.current = new Tone.Analyser("waveform", PITCH_FFT_SIZE);

    // Parallel harmony layers: each is a Tone.PitchShift fed by the mic and set
    // to a FIXED chord interval (your voice + maj3 + 5th, …). Time-preserving and
    // worklet-free, so it's reliable. mic -> shift -> gain -> voiceGain.
    harmoniesRef.current = Array.from({ length: HARMONY_COUNT }, () => {
      const gain = new Tone.Gain(0).connect(voiceGain);
      const shift = new Tone.PitchShift({ pitch: 0, windowSize: 0.05, feedback: 0 }).connect(gain);
      return { shift, gain };
    });

    // Voice Lab playback pitch shifter: time-preserving (no chipmunk).
    capturePitchShiftRef.current = new Tone.PitchShift({ pitch: 0 }).connect(fxOut);

    // Lightweight monitor (~40 ms): feedback duck + read-out pitch (not the DSP).
    if (!monitorLoopRef.current) {
      monitorLoopRef.current = setInterval(monitorLoop, MONITOR_TICK_MS);
    }
  }, [monitorLoop]);

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
      // MiMU-style parallel harmony: stack the chord's intervals (relative to its
      // lowest note) on the live voice — your voice + maj3 + 5th, etc. Fixed per
      // chord, so the shift is instant (no per-frame solving / pitch detection).
      const intervals = notes && notes.length ? relativeIntervals(notes).slice(1) : [];
      harmonyIntervalsRef.current = intervals;
      harmoniesRef.current.forEach((h, i) => {
        if (i < intervals.length) {
          h.shift.pitch = intervals[i];
          h.gain.gain.rampTo(HARMONY_LEVEL, 0.03);
        } else {
          h.gain.gain.rampTo(0, 0.05);
        }
      });
      const dryTarget = notes && notes.length && !harmoniesOnlyRef.current ? DRY_LEVEL : 0;
      dryGainRef.current?.gain.rampTo(dryTarget, 0.02);
    }
    const on = !!(gate && notes && notes.length);
    vocalActiveRef.current = on; // gate + read-out/feedback monitor
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
      feedbackDuckRef.current?.gain.rampTo(1, 0.05); // reset (synth doesn't route here)
      vocalNotesKeyRef.current = "none";
      liveSungMidiRef.current = null;
    } else {
      synthRef.current?.releaseAll();
      synthKeyRef.current = "silence";
    }
  }, []);

  const setHarmoniesOnly = useCallback((only: boolean) => {
    harmoniesOnlyRef.current = only;
    vocalNotesKeyRef.current = "none"; // force dry-lead level to re-apply
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

  const getVocalInfo = useCallback((): VocalInfo => {
    const stale = performance.now() - liveVocalTsRef.current > VOCAL_INFO_STALE_MS;
    const sung = liveSungMidiRef.current;
    if (sourceRef.current !== "vocal" || stale || sung == null) {
      return { sungNote: null, harmonyNotes: [] };
    }
    // Parallel layers = the sung note plus each chord interval.
    return {
      sungNote: midiToNoteName(sung),
      harmonyNotes: harmonyIntervalsRef.current.map((i) => midiToNoteName(sung + i)),
    };
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
    setHarmoniesOnly,
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
    getVocalInfo,
    getRecordNode,
    previewAttack,
    previewRelease,
    micError,
    micReady,
    isCapturing,
    hasCapture,
  };
}
