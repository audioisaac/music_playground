import type {
  SoundSettings as Settings,
  SoundSource,
  SustainMode,
} from "../types";
import type { DeviceList } from "../hooks/useDevices";

interface Props {
  settings: Settings;
  onChange: (next: Settings) => void;
  micError: string | null;
  micReady: boolean;
  /** 0..1 live mic level for the meter (voice mode). */
  inputLevel: number;
  /** Whether the voice gate is currently open. */
  voiceActive: boolean;
  devices: DeviceList;
  outputSelectable: boolean;
  onInputDevice: (deviceId: string) => void;
  onOutputDevice: (deviceId: string) => void;
}

const SOURCES: Array<{ v: SoundSource; label: string }> = [
  { v: "synth", label: "Synth" },
  { v: "vocal", label: "My vocals" },
];
const SUSTAINS: Array<{ v: SustainMode; label: string }> = [
  { v: "hand", label: "Hand up" },
  { v: "voice", label: "While singing" },
];

function deviceLabel(d: MediaDeviceInfo, i: number): string {
  return d.label || `${d.kind === "audioinput" ? "Input" : "Output"} ${i + 1}`;
}

export function SoundSettings({
  settings,
  onChange,
  micError,
  micReady,
  inputLevel,
  voiceActive,
  devices,
  outputSelectable,
  onInputDevice,
  onOutputDevice,
}: Props) {
  const needsMic =
    settings.source === "vocal" || settings.sustainMode === "voice";

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
        <>
          <p className="hint">
            Your own voice (dry) + a chord-aware SATB harmony chosen in real time
            and WSOLA-shifted onto your voice.
          </p>
          <label className="switch" style={{ marginTop: 6 }}>
            <input
              type="checkbox"
              checked={settings.harmoniesOnly}
              onChange={(e) =>
                onChange({ ...settings, harmoniesOnly: e.target.checked })
              }
            />
            Harmonies only (mute my dry voice — reduces feedback)
          </label>
        </>
      )}

      {needsMic && (
        <p className={`hint ${micError ? "" : "warn"}`}>
          {micError
            ? `Mic error: ${micError}`
            : micReady
              ? "🎧 Mic on. Tip: earphones for output + your computer mic for input — no feedback, no Bluetooth-mic delay."
              : "🎤 Starting mic…"}
        </p>
      )}

      <div className="setting-row">
        <span className="setting-label">Input</span>
        <select
          value={settings.inputDeviceId ?? ""}
          onChange={(e) => onInputDevice(e.target.value)}
        >
          <option value="">System default</option>
          {devices.inputs.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {deviceLabel(d, i)}
            </option>
          ))}
        </select>
      </div>

      <div className="setting-row">
        <span className="setting-label">Output</span>
        <select
          value={settings.outputDeviceId ?? ""}
          disabled={!outputSelectable}
          onChange={(e) => onOutputDevice(e.target.value)}
        >
          <option value="">System default</option>
          {devices.outputs.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {deviceLabel(d, i)}
            </option>
          ))}
        </select>
      </div>
      {!outputSelectable && (
        <p className="hint">
          Output device selection needs a Chromium browser (uses your OS default
          here).
        </p>
      )}
    </section>
  );
}
