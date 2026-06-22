import type { HandMotion } from "../lib/handShape";
import type { MotionConfig } from "../lib/expression";

interface Props {
  motion: MotionConfig;
  onChange: (m: MotionConfig) => void;
  live: HandMotion | null;
}

const AXES: Array<{
  key: keyof Omit<MotionConfig, "enabled">;
  label: string;
  value: (m: HandMotion) => number;
}> = [
  { key: "volume", label: "Height → volume", value: (m) => m.y },
  { key: "brightness", label: "Distance → brightness", value: (m) => m.size },
  { key: "bend", label: "Tilt → pitch bend", value: (m) => (m.roll + 1) / 2 },
  { key: "reverb", label: "Left/right → reverb", value: (m) => m.x },
];

export function MotionPanel({ motion, onChange, live }: Props) {
  return (
    <section className="panel motion-panel">
      <div className="map-head">
        <h2>Motion control</h2>
        <label className="switch">
          <input
            type="checkbox"
            checked={motion.enabled}
            onChange={(e) => onChange({ ...motion, enabled: e.target.checked })}
          />
          {motion.enabled ? "on" : "off"}
        </label>
      </div>
      <p className="hint">
        Hold a chord shape and move the chord hand — position, distance and tilt
        shape the sound without changing the chord.
      </p>
      <ul className="map-list">
        {AXES.map((a) => (
          <li key={a.key}>
            <label className="axis-label">
              <input
                type="checkbox"
                checked={motion[a.key]}
                disabled={!motion.enabled}
                onChange={(e) => onChange({ ...motion, [a.key]: e.target.checked })}
              />
              {a.label}
            </label>
            <span className="meter axis-meter">
              <span
                className={`meter-fill ${motion.enabled && motion[a.key] ? "live" : ""}`}
                style={{
                  width: `${Math.round((live ? a.value(live) : 0) * 100)}%`,
                }}
              />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
