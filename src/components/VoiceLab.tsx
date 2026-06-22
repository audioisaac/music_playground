import { useState } from "react";

interface Props {
  /** 0..1 live mic level for the meter. */
  inputLevel: number;
  isCapturing: boolean;
  hasCapture: boolean;
  micError: string | null;
  onCapture: () => void;
  onPlayOriginal: () => void;
  onPlayShifted: () => void;
  onPitchChange: (semitones: number) => void;
  onStop: () => void;
}

/**
 * A staged diagnostic for the vocal pipeline, independent of gestures/chords:
 *   1. Capture the mic to a buffer.
 *   2. Play it back faithfully.
 *   3. Play it back pitch-shifted (the worklet) with a semitone slider.
 * Each stage is verifiable on its own, to isolate where any problem is.
 */
export function VoiceLab({
  inputLevel,
  isCapturing,
  hasCapture,
  micError,
  onCapture,
  onPlayOriginal,
  onPlayShifted,
  onPitchChange,
  onStop,
}: Props) {
  const [pitch, setPitch] = useState(0);

  return (
    <section className="panel voice-lab">
      <h2>Voice Lab</h2>
      <p className="hint">
        Prove the basics in order — capture your voice, play it back, then
        pitch-shift it. 🎧 Headphones recommended.
      </p>

      {/* Step 1 — capture */}
      <div className="lab-step">
        <span className="lab-num">1</span>
        <div className="lab-body">
          <button onClick={onCapture} disabled={isCapturing}>
            {isCapturing ? "● Recording…" : "Record 3s"}
          </button>
          <span className="hint" style={{ margin: 0 }}>
            {micError
              ? `Mic error: ${micError}`
              : isCapturing
                ? "Speak now…"
                : hasCapture
                  ? "Captured ✓"
                  : "No capture yet"}
          </span>
          <span className="meter">
            <span
              className={`meter-fill ${isCapturing ? "live" : ""}`}
              style={{ width: `${Math.round(inputLevel * 100)}%` }}
            />
          </span>
        </div>
      </div>

      {/* Step 2 — faithful playback */}
      <div className="lab-step">
        <span className="lab-num">2</span>
        <div className="lab-body">
          <button onClick={onPlayOriginal} disabled={!hasCapture}>
            Play original
          </button>
          <button onClick={onStop} disabled={!hasCapture}>
            Stop
          </button>
        </div>
      </div>

      {/* Step 3 — modulate */}
      <div className="lab-step">
        <span className="lab-num">3</span>
        <div className="lab-body">
          <button onClick={onPlayShifted} disabled={!hasCapture}>
            Play shifted
          </button>
          <label className="lab-pitch">
            Pitch: {pitch > 0 ? `+${pitch}` : pitch} st
            <input
              type="range"
              min={-12}
              max={12}
              step={1}
              value={pitch}
              onChange={(e) => {
                const v = Number(e.target.value);
                setPitch(v);
                onPitchChange(v);
              }}
            />
          </label>
        </div>
      </div>
    </section>
  );
}
