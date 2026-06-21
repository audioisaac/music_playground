import { useState } from "react";
import type { Degree, FingerSignature, ModifierBinding } from "../types";
import {
  GestureConfig,
  bindModifier,
  bindPrimary,
} from "../lib/gestureMap";
import { encodeSignature } from "../lib/fingerPose";
import { resetConfig } from "../lib/storage";

interface Props {
  config: GestureConfig;
  onChange: (config: GestureConfig) => void;
  primarySig: FingerSignature | null;
  modifierSig: FingerSignature | null;
}

const FINGER_LABELS = ["👍", "☝️", "🖕", "💍", "🤙"];

function PatternDots({ pattern }: { pattern: string }) {
  return (
    <span className="pattern-dots">
      {pattern.split("").map((c, i) => (
        <span key={i} className={c === "1" ? "on" : "off"} title={FINGER_LABELS[i]}>
          {c === "1" ? "●" : "○"}
        </span>
      ))}
    </span>
  );
}

const MODIFIER_OPTIONS: Array<{ key: string; value: ModifierBinding; label: string }> = [
  { key: "sus2", value: { kind: "extension", extension: "sus2" }, label: "sus2 (2nd)" },
  { key: "sus4", value: { kind: "extension", extension: "sus4" }, label: "sus4 (4th)" },
  { key: "seventh", value: { kind: "extension", extension: "seventh" }, label: "7th" },
  { key: "add9", value: { kind: "extension", extension: "add9" }, label: "add9" },
  { key: "maj", value: { kind: "override", override: "major" }, label: "force MAJOR" },
  { key: "min", value: { kind: "override", override: "minor" }, label: "force MINOR" },
];

export function GestureMappingPanel({
  config,
  onChange,
  primarySig,
  modifierSig,
}: Props) {
  const [degree, setDegree] = useState<Degree>(6);
  const [modKey, setModKey] = useState<string>("seventh");

  const primaryPattern = primarySig ? encodeSignature(primarySig) : null;
  const modifierPattern = modifierSig ? encodeSignature(modifierSig) : null;

  const bindCurrentPrimary = () => {
    if (!primaryPattern) return;
    onChange(
      bindPrimary(config, primaryPattern, degree, `Custom → degree ${degree}`),
    );
  };

  const bindCurrentModifier = () => {
    if (!modifierPattern) return;
    const opt = MODIFIER_OPTIONS.find((o) => o.key === modKey)!;
    onChange(bindModifier(config, modifierPattern, opt.value, opt.label));
  };

  const removePrimary = (pattern: string) =>
    onChange({ ...config, primary: config.primary.filter((e) => e.pattern !== pattern) });
  const removeModifier = (pattern: string) =>
    onChange({ ...config, modifier: config.modifier.filter((e) => e.pattern !== pattern) });

  return (
    <section className="panel mapping-panel">
      <h2>Gesture Mapping</h2>
      <p className="hint">
        Counts 1–5 on the chord hand map to degrees 1–5 automatically. Bind a
        shape here to reach <strong>6 &amp; 7</strong> or to customize anything.
      </p>

      <div className="bind-row">
        <div>
          <div className="bind-label">Chord hand now:</div>
          {primaryPattern ? <PatternDots pattern={primaryPattern} /> : <em>none</em>}
        </div>
        <select
          value={degree}
          onChange={(e) => setDegree(Number(e.target.value) as Degree)}
        >
          {[1, 2, 3, 4, 5, 6, 7].map((d) => (
            <option key={d} value={d}>
              degree {d}
            </option>
          ))}
        </select>
        <button disabled={!primaryPattern} onClick={bindCurrentPrimary}>
          Bind shape
        </button>
      </div>

      <div className="bind-row">
        <div>
          <div className="bind-label">Modifier hand now:</div>
          {modifierPattern ? <PatternDots pattern={modifierPattern} /> : <em>none</em>}
        </div>
        <select value={modKey} onChange={(e) => setModKey(e.target.value)}>
          {MODIFIER_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
        <button disabled={!modifierPattern} onClick={bindCurrentModifier}>
          Bind shape
        </button>
      </div>

      <details className="bindings-list">
        <summary>Current bindings</summary>
        <h4>Chord hand</h4>
        <ul>
          {config.primary.map((e) => (
            <li key={e.pattern}>
              <PatternDots pattern={e.pattern} /> → degree {e.degree}
              <button className="link" onClick={() => removePrimary(e.pattern)}>
                remove
              </button>
            </li>
          ))}
        </ul>
        <h4>Modifier hand</h4>
        <ul>
          {config.modifier.map((e) => (
            <li key={e.pattern}>
              <PatternDots pattern={e.pattern} /> → {e.label}
              <button className="link" onClick={() => removeModifier(e.pattern)}>
                remove
              </button>
            </li>
          ))}
        </ul>
      </details>

      <button className="reset" onClick={() => onChange(resetConfig())}>
        Reset to defaults
      </button>
    </section>
  );
}
