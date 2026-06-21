import type { PoseVector } from "../types";
import {
  GestureConfig,
  bindModifier,
  bindPrimary,
  modifierId,
} from "../lib/gestureMap";
import {
  DEFAULT_MODIFIER,
  DEFAULT_PRIMARY,
  makeTemplate,
} from "../lib/defaultTemplates";
import { resetConfig } from "../lib/storage";

interface Props {
  config: GestureConfig;
  onChange: (config: GestureConfig) => void;
  primaryPose: PoseVector | null;
  modifierPose: PoseVector | null;
}

function Detected({ pose }: { pose: PoseVector | null }) {
  return (
    <span className={`detect ${pose ? "on" : "off"}`}>
      {pose ? "● hand detected" : "○ no hand"}
    </span>
  );
}

export function GestureMappingPanel({
  config,
  onChange,
  primaryPose,
  modifierPose,
}: Props) {
  return (
    <section className="panel mapping-panel">
      <h2>Gesture Mapping</h2>
      <p className="hint">
        Each gesture is matched by whole hand shape. Hold a shape in front of the
        camera and press <strong>Recapture</strong> to teach it your own hand, or
        <strong> reset</strong> to the built-in shape.
      </p>

      <div className="map-section">
        <div className="map-head">
          <h4>Chord hand → degree</h4>
          <Detected pose={primaryPose} />
        </div>
        <ul className="map-list">
          {DEFAULT_PRIMARY.map((d) => (
            <li key={d.degree}>
              <span className="map-label">
                <strong>{d.degree}</strong> — {d.label}
              </span>
              <span className="map-actions">
                <button
                  disabled={!primaryPose}
                  onClick={() =>
                    primaryPose &&
                    onChange(bindPrimary(config, primaryPose, d.degree, d.label))
                  }
                >
                  Recapture
                </button>
                <button
                  className="link"
                  onClick={() =>
                    onChange(
                      bindPrimary(config, makeTemplate(d.extended), d.degree, d.label),
                    )
                  }
                >
                  reset
                </button>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="map-section">
        <div className="map-head">
          <h4>Modifier hand → special chord</h4>
          <Detected pose={modifierPose} />
        </div>
        <ul className="map-list">
          {DEFAULT_MODIFIER.map((m) => (
            <li key={modifierId(m.value)}>
              <span className="map-label">{m.label}</span>
              <span className="map-actions">
                <button
                  disabled={!modifierPose}
                  onClick={() =>
                    modifierPose &&
                    onChange(bindModifier(config, modifierPose, m.value, m.label))
                  }
                >
                  Recapture
                </button>
                <button
                  className="link"
                  onClick={() =>
                    onChange(
                      bindModifier(config, makeTemplate(m.extended), m.value, m.label),
                    )
                  }
                >
                  reset
                </button>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <button className="reset" onClick={() => onChange(resetConfig())}>
        Reset all to defaults
      </button>
    </section>
  );
}
