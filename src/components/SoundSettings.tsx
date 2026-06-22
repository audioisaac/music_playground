import type { SoundSettings as Settings, SoundSource, SustainMode } from "../types";

interface Props {
  settings: Settings;
  onChange: (next: Settings) => void;
  micError: string | null;
  micReady: boolean;
  /** 0..1 live mic level for the meter (voice mode). */
  inputLevel: number;
  /** Whether the voice gate is currently open. */
  voiceActive: boolean;
}

const SOURCES: Array<{ v: SoundSource; label: string }> = [
  { v: "synth", label: "Synth" },
  { v: "vocal", label: "My vocals" },
];
const SUSTAINS: Array<{ v: SustainMode; label: string }> = [
  { v: "hand", label: "Hand up" },
  { v: "voice", label: "While singing" },
];

export function SoundSettings({
  settings,
  onChange,
  micError,
  micReady,
  inputLevel,
  voiceActive,
}: Props) {
  const needsMic = settings.source === "vocal" || settings.sustainMode === "voice";

  return (
    <section className="panel sound-settings">
      <h2>Sound</h2>

      <div className="setting-row">
        <span className="setting-label">Source</span>
        <div className="seg">
          {SOURCES.map((s) => (
            <button
              key={s.v}
              className={`seg-btn ${settings.source === s.v ? "active" : ""}`}
              onClick={() => onChange({ ...settings, source: s.v })}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="setting-row">
        <span className="setting-label">Sustain</span>
        <div className="seg">
          {SUSTAINS.map((s) => (
            <button
              key={s.v}
              className={`seg-btn ${settings.sustainMode === s.v ? "active" : ""}`}
              onClick={() => onChange({ ...settings, sustainMode: s.v })}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {settings.sustainMode === "voice" && (
        <div className="setting-row">
          <span className="setting-label">Sensitivity</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={settings.sensitivity}
            onChange={(e) =>
              onChange({ ...settings, sensitivity: Number(e.target.value) })
            }
          />
        </div>
      )}

      {settings.sustainMode === "voice" && (
        <div className="meter">
          <div
            className={`meter-fill ${voiceActive ? "live" : ""}`}
            style={{ width: `${Math.round(inputLevel * 100)}%` }}
          />
        </div>
      )}

      {settings.source === "vocal" && (
        <p className="hint">
          You'll hear your own voice (dry) plus harmony notes following the chord.
        </p>
      )}

      {needsMic && (
        <p className={`hint ${micError ? "" : "warn"}`}>
          {micError
            ? `Mic error: ${micError}`
            : micReady
              ? "🎧 Mic on — use headphones, or the speakers will feed back."
              : "Requesting microphone…"}
        </p>
      )}
    </section>
  );
}
