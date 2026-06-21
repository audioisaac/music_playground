import type { TrackingStatus } from "../hooks/useHandTracking";

interface Props {
  started: boolean;
  trackingStatus: TrackingStatus;
  primaryHandedness: "Left" | "Right";
  onStart: () => void;
  onSwapHands: () => void;
}

export function StatusBar({
  started,
  trackingStatus,
  primaryHandedness,
  onStart,
  onSwapHands,
}: Props) {
  return (
    <header className="status-bar">
      <h1>🎹 Gesture Chord Synth</h1>
      <div className="status-actions">
        {!started ? (
          <button className="start" onClick={onStart}>
            ▶ Start
          </button>
        ) : (
          <span className={`pill ${trackingStatus}`}>{trackingStatus}</span>
        )}
        <button className="swap" onClick={onSwapHands} disabled={!started}>
          Chord hand: {primaryHandedness}
        </button>
      </div>
    </header>
  );
}
