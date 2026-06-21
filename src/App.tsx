import { useCallback, useEffect, useRef, useState } from "react";
import type { FingerSignature, HandPose, Handedness, Key, ResolvedChord } from "./types";
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
  primarySig: FingerSignature | null;
  modifierSig: FingerSignature | null;
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
  const [live, setLive] = useState<LiveSigs>({ primarySig: null, modifierSig: null });
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
    const primaryPose = poses.find((p) => p.handedness === primaryHand) ?? null;
    const modifierPose = poses.find((p) => p.handedness !== primaryHand) ?? null;
    const primarySig = primaryPose?.fingers ?? null;
    const modifierSig = modifierPose?.fingers ?? null;

    // Throttle the live-signature UI update (used by the calibration panel).
    const now = performance.now();
    if (now - lastLiveRef.current > 80) {
      lastLiveRef.current = now;
      setLive({ primarySig, modifierSig });
    }

    const result = resolveChord(keyRef.current, primarySig, modifierSig, configRef.current);
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
            primarySig={live.primarySig}
            modifierSig={live.modifierSig}
          />
          <RecorderPanel recorder={recorder} />
        </div>
      </main>

      <footer className="footer">
        <p>
          Chord hand: number of fingers = scale degree (1–5; bind 6 &amp; 7 in
          Gesture Mapping). Modifier hand: add sus2 / sus4 / 7th, or force
          major/minor for borrowed chords. Hold a shape to sustain.
        </p>
      </footer>
    </div>
  );
}
