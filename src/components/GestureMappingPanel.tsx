import type { Orientation, PoseVector } from "../types";
import {
  GestureConfig,
  ORIENTATION_QUALITY,
  bindExtension,
  bindPrimary,
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
  modifierOrientation: Orientation | null;
}

function Detected({ pose }: { pose: PoseVector | null }) {
  return (
    <span className={`detect ${pose ? "on" : "off"}`}>
      {pose ? "● hand detected" : "○ no hand"}
    </span>
  );
}

const ORIENTATION_ROWS: Array<{ o: Orientation; arrow: string }> = [
  { o: "up", arrow: "↑ pointing up" },
  { o: "down", arrow: "↓ pointing down" },
  { o: "side", arrow: "→ sideways" },
];

const QUALITY_LABEL: Record<string, string> = {
  majorOverride: "force MAJOR",
  minorOverride: "force MINOR",
  diatonic: "diatonic (in key)",
};

export function GestureMappingPanel({
  config,
  onChange,
  primaryPose,
  modifierPose,
  modifierOrientation,
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
          <h4>Modifier hand shape → extension</h4>
          <Detected pose={modifierPose} />
        </div>
        <ul className="map-list">
          {DEFAULT_MODIFIER.map((m) => (
            <li key={m.extension}>
              <span className="map-label">{m.label}</span>
              <span className="map-actions">
                <button
                  disabled={!modifierPose}
                  onClick={() =>
                    modifierPose &&
                    onChange(
                      bindExtension(config, modifierPose, m.extension, m.label),
                    )
                  }
                >
                  Recapture
                </button>
                <button
                  className="link"
                  onClick={() =>
                    onChange(
                      bindExtension(
                        config,
                        makeTemplate(m.extended),
                        m.extension,
                        m.label,
                      ),
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
          <h4>Modifier hand orientation → quality</h4>
        </div>
        <p className="hint">
          Stacks on top of the extension above, so you can combine e.g. force
          major + 7th.
        </p>
        <ul className="map-list">
          {ORIENTATION_ROWS.map(({ o, arrow }) => (
            <li
              key={o}
              className={modifierOrientation === o && modifierPose ? "active-row" : ""}
            >
              <span className="map-label">{arrow}</span>
              <span className="map-actions">{QUALITY_LABEL[ORIENTATION_QUALITY[o]]}</span>
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
