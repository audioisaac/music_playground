// The audio engine. Owns a shared master bus and two sound sources:
//  - a Tone.PolySynth, and
//  - a live vocal harmonizer: the DRY mic is the lead (so you hear your own
//    words), with pitch-shifted copies added as quieter harmony notes.
// The mic is also metered for voice-activity gating. Everything sums into
// `master` -> limiter -> destination; the recorder taps `master`.

import { useCallback, useRef, useState } from "react";
import * as Tone from "tone";
import type { SoundSource, VocalMode } from "../types";
import { noteToMidi, relativeIntervals } from "../lib/musicTheory";
import type { Expression } from "../lib/expression";
import { estimatePitchHz, hzToMidi } from "../lib/pitch";
import { saveVoiceSample } from "../lib/storage";

const HARMONY_COUNT = 3; // pitch-shifted notes added above the dry lead
const SAMPLER_VOICES = 4; // simultaneous sampler notes (chord size)
const VOICE_LEVEL = 1.0; // voice bus gain when gated on
const DRY_LEVEL = 1.0; // the un-shifted lead voice (your actual words)
const HARMONY_LEVEL = 0.5; // each harmony note, quieter than the lead
const SAMPLER_LEVEL = 0.6; // each sampler voice (headroom for the limiter)
const SAMPLE_SECONDS = 2; // length of the recorded voice sample

interface Harmony {
  node: AudioWorkletNode;
  gain: Tone.Gain;
}
interface SamplerVoice {
  player: Tone.Player;
  gain: Tone.Gain;
}

export interface InstrumentApi {
  start: () => Promise<void>;
  ensureMic: (deviceId?: string) => Promise<void>;
  setSource: (source: SoundSource) => void;
  /** Choose the vocal engine (sampler vs live harmonizer). */
  setVocalMode: (mode: VocalMode) => void;
  /** Live only: mute the dry lead (output harmonies only) to cut feedback. */
  setHarmoniesOnly: (only: boolean) => void;
  /** Record a short voice sample for the sampler (persisted). */
  recordSample: () => Promise<void>;
  /** Install a previously-saved voice sample at startup. */
  loadSample: (blob: Blob) => Promise<void>;
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
  hasSample: boolean;
  isRecordingSample: boolean;
}

export function useInstrument(): InstrumentApi {
  const [micError, setMicError] = useState<string | null>(null);
  const [micReady, setMicReady] = useState(false);
  const [hasSample, setHasSample] = useState(false);
  const [isRecordingSample, setIsRecordingSample] = useState(false);

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
  const micPullElRef = useRef<HTMLAudioElement | null>(null);
  const samplerVoicesRef = useRef<SamplerVoice[]>([]);
  const baseMidiRef = useRef(60); // pitch of the recorded sample (default C4)

  const sourceRef = useRef<SoundSource>("synth");
  const vocalModeRef = useRef<VocalMode>("sampler");
  const harmoniesOnlyRef = useRef(false);
  const synthKeyRef = useRef("silence");
  const vocalNotesKeyRef = useRef("none");
  const samplerNotesKeyRef = useRef("none");

  const start = useCallback(async () => {
    await Tone.start();
    // Small look-ahead (not 0): 0 starves the scheduler and causes crackle.
    Tone.getContext().lookAhead = 0.02;
    if (masterRef.current) return;

    const ctx = Tone.getContext().rawContext as AudioContext;
    // WSOLA pitch-shift worklet (cleaner than the granular Tone.PitchShift).
    try {
      await ctx.audioWorklet.addModule(
        import.meta.env.BASE_URL + "soundtouch-worklet.js",
      );
    } catch (e) {
      setMicError(`Harmonizer worklet failed to load: ${e instanceof Error ? e.message : e}`);
    }

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

    // Voice bus bypasses the reverb so harmonies stay clean/dry.
    const voiceGain = new Tone.Gain(0).connect(fxOut);
    voiceGainRef.current = voiceGain;

    // Dry lead: the user's actual voice/words, un-shifted.
    dryGainRef.current = new Tone.Gain(0).connect(voiceGain);

    // Harmony voices: WSOLA pitch-shifter worklet per non-root chord interval.
    harmoniesRef.current = Array.from({ length: HARMONY_COUNT }, () => {
      const gain = new Tone.Gain(0).connect(voiceGain);
      const node = new AudioWorkletNode(ctx, "soundtouch-shifter", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
      });
      Tone.connect(node, gain);
      return { node, gain };
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
    if (dryGainRef.current) Tone.connect(src, dryGainRef.current);
    for (const h of harmoniesRef.current) src.connect(h.node);
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
      const dryTarget = notes && notes.length && !harmoniesOnlyRef.current ? DRY_LEVEL : 0;
      dryGainRef.current?.gain.rampTo(dryTarget, 0.02);
      harmoniesRef.current.forEach((h, i) => {
        if (i < harmonies.length) {
          const p = h.node.parameters.get("pitch");
          if (p) p.value = harmonies[i];
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

  // Sampler: play the recorded voice transposed to each chord note (replicate +
  // transpose). Looping players give constant sustain; no mic in the output.
  const applySampler = useCallback((notes: string[] | null, gate: boolean) => {
    const voices = samplerVoicesRef.current;
    const key = notes && notes.length ? notes.join(",") : "none";
    if (key !== samplerNotesKeyRef.current) {
      samplerNotesKeyRef.current = key;
      const midis = notes ? notes.map(noteToMidi) : [];
      const base = baseMidiRef.current;
      voices.forEach((v, i) => {
        if (i < midis.length) {
          v.player.playbackRate = Math.pow(2, (midis[i] - base) / 12);
          v.gain.gain.rampTo(SAMPLER_LEVEL, 0.02);
        } else {
          v.gain.gain.rampTo(0, 0.02);
        }
      });
    }
    const on = !!(gate && notes && notes.length && voices.length);
    voiceGainRef.current?.gain.rampTo(on ? VOICE_LEVEL : 0, on ? 0.005 : 0.03);
  }, []);

  const muteLive = useCallback(() => {
    dryGainRef.current?.gain.rampTo(0, 0.03);
    harmoniesRef.current.forEach((h) => h.gain.gain.rampTo(0, 0.03));
    vocalNotesKeyRef.current = "none";
  }, []);

  const muteSampler = useCallback(() => {
    samplerVoicesRef.current.forEach((v) => v.gain.gain.rampTo(0, 0.03));
    samplerNotesKeyRef.current = "none";
  }, []);

  const update = useCallback(
    (notes: string[] | null, gate: boolean) => {
      if (sourceRef.current === "synth") {
        applySynth(notes, gate);
        voiceGainRef.current?.gain.rampTo(0, 0.05);
      } else if (vocalModeRef.current === "sampler") {
        applySampler(notes, gate);
        muteLive();
        synthRef.current?.releaseAll();
        synthKeyRef.current = "silence";
      } else {
        applyVocal(notes, gate);
        muteSampler();
        synthRef.current?.releaseAll();
        synthKeyRef.current = "silence";
      }
    },
    [applySynth, applyVocal, applySampler, muteLive, muteSampler],
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

  const setVocalMode = useCallback(
    (mode: VocalMode) => {
      vocalModeRef.current = mode;
      if (mode === "sampler") muteLive();
      else muteSampler();
    },
    [muteLive, muteSampler],
  );

  const setHarmoniesOnly = useCallback((only: boolean) => {
    harmoniesOnlyRef.current = only;
    vocalNotesKeyRef.current = "none"; // force dry-lead level to re-apply
  }, []);

  // Build (or rebuild) the looping sampler players from a decoded buffer.
  const buildSampler = useCallback((buf: AudioBuffer) => {
    const vg = voiceGainRef.current;
    if (!vg) return;
    const toneBuf = new Tone.ToneAudioBuffer(buf);
    if (samplerVoicesRef.current.length === 0) {
      samplerVoicesRef.current = Array.from({ length: SAMPLER_VOICES }, () => {
        const gain = new Tone.Gain(0).connect(vg);
        const player = new Tone.Player({ loop: true, fadeIn: 0.01, fadeOut: 0.01 }).connect(gain);
        return { player, gain };
      });
    }
    for (const v of samplerVoicesRef.current) {
      v.player.buffer = toneBuf;
      try {
        v.player.stop();
      } catch {
        /* not started yet */
      }
      v.player.start();
    }
  }, []);

  const installSampleBlob = useCallback(
    async (blob: Blob) => {
      const arrayBuf = await blob.arrayBuffer();
      const ctx = Tone.getContext().rawContext as AudioContext;
      const audioBuf = await ctx.decodeAudioData(arrayBuf);
      const hz = estimatePitchHz(audioBuf.getChannelData(0), audioBuf.sampleRate);
      baseMidiRef.current = hz ? hzToMidi(hz) : 60;
      buildSampler(audioBuf);
      samplerNotesKeyRef.current = "none";
      setHasSample(true);
    },
    [buildSampler],
  );

  const recordSample = useCallback(async () => {
    await ensureMic();
    const src = micSourceRef.current;
    if (!src) return;
    const rec = new Tone.Recorder();
    Tone.connect(src, rec);
    setIsRecordingSample(true);
    rec.start();
    await new Promise((r) => setTimeout(r, SAMPLE_SECONDS * 1000));
    const blob = await rec.stop();
    rec.dispose();
    setIsRecordingSample(false);
    await installSampleBlob(blob);
    await saveVoiceSample(blob);
  }, [ensureMic, installSampleBlob]);

  const loadSample = useCallback(
    (blob: Blob) => installSampleBlob(blob),
    [installSampleBlob],
  );

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
    setVocalMode,
    setHarmoniesOnly,
    recordSample,
    loadSample,
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
    hasSample,
    isRecordingSample,
  };
}
