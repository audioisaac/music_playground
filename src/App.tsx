import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PoseVector,
  HandPose,
  Handedness,
  Key,
  Orientation,
  ResolvedChord,
  SoundSettings as Settings,
} from "./types";
import { useHandTracking } from "./hooks/useHandTracking";
import { useInstrument } from "./hooks/useInstrument";
import { useRecorder } from "./hooks/useRecorder";
import { useDevices } from "./hooks/useDevices";
import { chordId, resolveChord } from "./lib/chordEngine";
import { GestureConfig } from "./lib/gestureMap";
import { handMotion, type HandMotion } from "./lib/handShape";
import { mapMotionToExpression, NEUTRAL_EXPRESSION } from "./lib/expression";
import { loadConfig, loadSettings, saveConfig, saveSettings } from "./lib/storage";
import { StatusBar } from "./components/StatusBar";
import { CameraView } from "./components/CameraView";
import { KeySelector } from "./components/KeySelector";
import { ChordDisplay } from "./components/ChordDisplay";
import { GestureMappingPanel } from "./components/GestureMappingPanel";
import { RecorderPanel } from "./components/RecorderPanel";
import { SoundSettings } from "./components/SoundSettings";
import { MotionPanel } from "./components/MotionPanel";

// How many consecutive frames a gesture must hold before it commits.
// 1 = commit immediately for the snappiest response (shape matching is stable
// enough that flicker is rare).
const STABLE_FRAMES = 1;
// How long the voice gate stays open after the level drops, so words/breaths
// don't stutter the sustain.
const VOICE_HOLD_MS = 160;

/** Voice-gate threshold in dB from the 0..1 sensitivity slider. */
function thresholdDb(sensitivity: number): number {
  return -30 - sensitivity * 35; // 0 -> -30 dB (loud), 1 -> -65 dB (sensitive)
}

interface LiveSigs {
  primaryPose: PoseVector | null;
  modifierPose: PoseVector | null;
  modifierOrientation: Orientation | null;
}
interface DisplayState {
  chord: ResolvedChord | null;
  primaryLabel: string | null;
  modifierLabel: string | null;
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [started, setStarted] = useState(false);
  const [musicKey, setMusicKey] = useState<Key>({ root: "C", mode: "major" });
  const [config, setConfig] = useState<GestureConfig>(() => loadConfig());
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [primaryHandedness, setPrimaryHandedness] = useState<Handedness>("Right");
  const [live, setLive] = useState<LiveSigs>({
    primaryPose: null,
    modifierPose: null,
    modifierOrientation: null,
  });
  const [display, setDisplay] = useState<DisplayState>({
    chord: null,
    primaryLabel: null,
    modifierLabel: null,
  });
  const [audioUi, setAudioUi] = useState({ inputLevel: 0, voiceActive: false });
  const [liveMotion, setLiveMotion] = useState<HandMotion | null>(null);

  const instrument = useInstrument();
  const recorder = useRecorder(instrument);
  const devices = useDevices(started);

  // Mutable mirrors so the per-frame callback can stay identity-stable.
  const keyRef = useRef(musicKey);
  const configRef = useRef(config);
  const settingsRef = useRef(settings);
  const primaryHandRef = useRef(primaryHandedness);
  const instrumentRef = useRef(instrument);
  const recorderRef = useRef(recorder);
  keyRef.current = musicKey;
  configRef.current = config;
  settingsRef.current = settings;
  primaryHandRef.current = primaryHandedness;
  instrumentRef.current = instrument;
  recorderRef.current = recorder;

  // Gesture debounce + audio change-detection state.
  const pendingIdRef = useRef("silence");
  const pendingCountRef = useRef(0);
  const committedShapeRef = useRef("silence");
  const committedChordRef = useRef<ResolvedChord | null>(null);
  const lastPlayKeyRef = useRef("silence");
  const lastAboveRef = useRef(0);
  const lastLiveRef = useRef(0);
  const expressionAppliedRef = useRef(false);

  const handlePoses = useCallback((poses: HandPose[]) => {
    const primaryHand = primaryHandRef.current;
    const primaryHandPose = poses.find((p) => p.handedness === primaryHand) ?? null;
    const modifierHandPose = poses.find((p) => p.handedness !== primaryHand) ?? null;
    const primaryPose = primaryHandPose?.pose ?? null;
    const modifierPose = modifierHandPose?.pose ?? null;
    const modifierOrientation = modifierHandPose?.orientation ?? null;
    const now = performance.now();

    // 1. Resolve the chord from the hands and debounce the gesture shape.
    const result = resolveChord(
      keyRef.current,
      primaryPose,
      modifierPose,
      modifierOrientation,
      configRef.current,
    );
    const shapeId = chordId(result.chord);
    if (shapeId === pendingIdRef.current) {
      pendingCountRef.current += 1;
    } else {
      pendingIdRef.current = shapeId;
      pendingCountRef.current = 1;
    }
    if (pendingCountRef.current >= STABLE_FRAMES && shapeId !== committedShapeRef.current) {
      committedShapeRef.current = shapeId;
      committedChordRef.current = result.chord;
      setDisplay({
        chord: result.chord,
        primaryLabel: result.primaryLabel,
        modifierLabel: result.modifierLabel,
      });
    }

    // 2. Compute the gate (what keeps the chord sounding).
    const s = settingsRef.current;
    const chord = committedChordRef.current;
    let gate = false;
    let voiceActive = false;
    if (chord) {
      if (s.sustainMode === "hand") {
        gate = true;
      } else {
        const level = instrumentRef.current.getInputLevel();
        if (level > thresholdDb(s.sensitivity)) lastAboveRef.current = now;
        voiceActive = now - lastAboveRef.current < VOICE_HOLD_MS;
        gate = voiceActive;
      }
    }

    // 3. Drive the audio only when the (chord, gate) state changes.
    const playKey = gate && chord ? committedShapeRef.current : "silence";
    if (playKey !== lastPlayKeyRef.current) {
      lastPlayKeyRef.current = playKey;
      instrumentRef.current.update(chord ? chord.notes : null, gate);
      recorderRef.current.logEvent(gate && chord ? "on" : "off", gate ? chord : null);
    }

    // 4. Motion expression: map the chord hand's position/tilt/distance to the
    //    live sound. Reset to neutral once when disabled or the hand leaves.
    let motion: HandMotion | null = null;
    if (s.motion.enabled && primaryHandPose) {
      motion = handMotion(primaryHandPose.landmarks);
      instrumentRef.current.setExpression(mapMotionToExpression(motion, s.motion));
      expressionAppliedRef.current = true;
    } else if (expressionAppliedRef.current) {
      instrumentRef.current.setExpression(NEUTRAL_EXPRESSION);
      expressionAppliedRef.current = false;
    }

    // 5. Throttled UI updates (calibration poses + input meter + motion bars).
    if (now - lastLiveRef.current > 80) {
      lastLiveRef.current = now;
      setLive({ primaryPose, modifierPose, modifierOrientation });
      setLiveMotion(motion);
      const level = instrumentRef.current.getInputLevel();
      setAudioUi({
        inputLevel: Number.isFinite(level)
          ? Math.max(0, Math.min(1, (level + 60) / 60))
          : 0,
        voiceActive,
      });
    }
  }, []);

  const { status, error } = useHandTracking({
    videoRef,
    canvasRef,
    enabled: started,
    onPoses: handlePoses,
  });

  const handleStart = useCallback(async () => {
    const s = settingsRef.current;
    await instrument.start();
    instrument.setSource(s.source);
    // Pre-warm the mic now (overlapping the camera/model load) so vocals turn
    // on instantly later instead of paying ~3s of getUserMedia on first use.
    instrument.ensureMic(s.inputDeviceId);
    if (s.outputDeviceId) instrument.setOutputDevice(s.outputDeviceId).catch(() => {});
    setStarted(true);
  }, [instrument]);

  const handleConfigChange = useCallback((next: GestureConfig) => {
    setConfig(next);
    saveConfig(next);
  }, []);

  const handleSettingsChange = useCallback((next: Settings) => {
    setSettings(next);
    saveSettings(next);
  }, []);

  const handleInputDevice = useCallback((deviceId: string) => {
    handleSettingsChange({ ...settingsRef.current, inputDeviceId: deviceId || undefined });
    instrumentRef.current.setInputDevice(deviceId);
  }, [handleSettingsChange]);

  const handleOutputDevice = useCallback((deviceId: string) => {
    handleSettingsChange({ ...settingsRef.current, outputDeviceId: deviceId || undefined });
    instrumentRef.current.setOutputDevice(deviceId).catch(() => {});
  }, [handleSettingsChange]);

  // Apply source changes to the audio engine and force the next frame to
  // re-drive the new path with the current chord.
  useEffect(() => {
    instrumentRef.current.setSource(settings.source);
    lastPlayKeyRef.current = "force-rebuild";
  }, [settings.source]);

  // Open the mic when a feature needs it.
  useEffect(() => {
    if (started && (settings.source === "vocal" || settings.sustainMode === "voice")) {
      instrumentRef.current.ensureMic();
    }
  }, [started, settings.source, settings.sustainMode]);

  // Re-voice the held chord when the key changes mid-play.
  useEffect(() => {
    committedShapeRef.current = "force-rebuild";
    lastPlayKeyRef.current = "force-rebuild";
  }, [musicKey]);

  return (
    <div className="app">
      <StatusBar
        started={started}
        trackingStatus={status}
        primaryHandedness={primaryHandedness}
        onStart={handleStart}
        onSwapHands={() =>
          setPrimaryHandedness((h) => (h === "Right" ? "Left" : "Right"))
        }
      />

      <main className="layout">
        <div className="left-col">
          <CameraView
            videoRef={videoRef}
            canvasRef={canvasRef}
            status={status}
            error={error}
          />
          <ChordDisplay
            chord={display.chord}
            primaryLabel={display.primaryLabel}
            modifierLabel={display.modifierLabel}
          />
        </div>

        <div className="right-col">
          <SoundSettings
            settings={settings}
            onChange={handleSettingsChange}
            micError={instrument.micError}
            micReady={instrument.micReady}
            inputLevel={audioUi.inputLevel}
            voiceActive={audioUi.voiceActive}
            devices={devices}
            outputSelectable={instrument.outputSelectable}
            onInputDevice={handleInputDevice}
            onOutputDevice={handleOutputDevice}
          />
          <MotionPanel
            motion={settings.motion}
            onChange={(m) => handleSettingsChange({ ...settings, motion: m })}
            live={liveMotion}
          />
          <KeySelector value={musicKey} onChange={setMusicKey} />
          <GestureMappingPanel
            config={config}
            onChange={handleConfigChange}
            primaryPose={live.primaryPose}
            modifierPose={live.modifierPose}
            modifierOrientation={live.modifierOrientation}
          />
          <RecorderPanel recorder={recorder} />
        </div>
      </main>

      <footer className="footer">
        <p>
          Chord hand shapes pick the scale degree (index=I, peace=ii, … shaka=vi,
          horns=vii°). Modifier hand stacks two things: its <em>shape</em> adds an
          extension (sus2 / sus4 / 7th / add9) and its <em>orientation</em> sets
          the quality — point up = force major, down = force minor, sideways =
          diatonic. Choose the synth or your own harmonized vocals, and sustain
          either while your hand is up or only while you sing.
        </p>
      </footer>
    </div>
  );
}
