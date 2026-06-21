import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PoseVector,
  HandPose,
  Handedness,
  Key,
  Orientation,
  ResolvedChord,
} from "./types";
import { useHandTracking } from "./hooks/useHandTracking";
import { useSynth } from "./hooks/useSynth";
import { useRecorder } from "./hooks/useRecorder";
import { chordId, resolveChord } from "./lib/chordEngine";
import { GestureConfig } from "./lib/gestureMap";
import { loadConfig, saveConfig } from "./lib/storage";
import { StatusBar } from "./components/StatusBar";
import { CameraView } from "./components/CameraView";
import { KeySelector } from "./components/KeySelector";
import { ChordDisplay } from "./components/ChordDisplay";
import { GestureMappingPanel } from "./components/GestureMappingPanel";
import { RecorderPanel } from "./components/RecorderPanel";

// How many consecutive frames a gesture must hold before it commits.
// Smooths out detection jitter without adding noticeable latency.
const STABLE_FRAMES = 2;

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

  const synth = useSynth();
  const recorder = useRecorder(synth);

  // Mutable mirrors so the per-frame callback can stay identity-stable.
  const keyRef = useRef(musicKey);
  const configRef = useRef(config);
  const primaryHandRef = useRef(primaryHandedness);
  const synthRef = useRef(synth);
  const recorderRef = useRef(recorder);
  keyRef.current = musicKey;
  configRef.current = config;
  primaryHandRef.current = primaryHandedness;
  synthRef.current = synth;
  recorderRef.current = recorder;

  // Debounce / change-detection state.
  const pendingIdRef = useRef("silence");
  const pendingCountRef = useRef(0);
  const committedIdRef = useRef("silence");
  const lastLiveRef = useRef(0);

  const handlePoses = useCallback((poses: HandPose[]) => {
    const primaryHand = primaryHandRef.current;
    const primaryHandPose = poses.find((p) => p.handedness === primaryHand) ?? null;
    const modifierHandPose = poses.find((p) => p.handedness !== primaryHand) ?? null;
    const primaryPose = primaryHandPose?.pose ?? null;
    const modifierPose = modifierHandPose?.pose ?? null;
    const modifierOrientation = modifierHandPose?.orientation ?? null;

    // Throttle the live-pose UI update (used by the calibration panel).
    const now = performance.now();
    if (now - lastLiveRef.current > 80) {
      lastLiveRef.current = now;
      setLive({ primaryPose, modifierPose, modifierOrientation });
    }

    const result = resolveChord(
      keyRef.current,
      primaryPose,
      modifierPose,
      modifierOrientation,
      configRef.current,
    );
    const id = chordId(result.chord);

    if (id === pendingIdRef.current) {
      pendingCountRef.current += 1;
    } else {
      pendingIdRef.current = id;
      pendingCountRef.current = 1;
    }

    if (pendingCountRef.current >= STABLE_FRAMES && id !== committedIdRef.current) {
      committedIdRef.current = id;
      if (result.chord) {
        synthRef.current.setChord(result.chord.notes);
        recorderRef.current.logEvent("on", result.chord);
      } else {
        synthRef.current.release();
        recorderRef.current.logEvent("off", null);
      }
      setDisplay({
        chord: result.chord,
        primaryLabel: result.primaryLabel,
        modifierLabel: result.modifierLabel,
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
    await synth.start();
    setStarted(true);
  }, [synth]);

  const handleConfigChange = useCallback((next: GestureConfig) => {
    setConfig(next);
    saveConfig(next);
  }, []);

  // Re-voice the held chord when the key changes mid-play.
  useEffect(() => {
    committedIdRef.current = "force-rebuild";
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
          diatonic. Hold a shape to sustain; recalibrate any shape in Gesture Mapping.
        </p>
      </footer>
    </div>
  );
}
