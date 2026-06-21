import type { Key, Mode, NoteName } from "../types";
import { NOTE_NAMES } from "../lib/musicTheory";

interface Props {
  value: Key;
  onChange: (key: Key) => void;
}

export function KeySelector({ value, onChange }: Props) {
  return (
    <section className="panel">
      <h2>Key</h2>
      <div className="note-grid">
        {NOTE_NAMES.map((n: NoteName) => (
          <button
            key={n}
            className={`note-btn ${n === value.root ? "active" : ""}`}
            onClick={() => onChange({ ...value, root: n })}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="mode-toggle">
        {(["major", "minor"] as Mode[]).map((m) => (
          <button
            key={m}
            className={`mode-btn ${m === value.mode ? "active" : ""}`}
            onClick={() => onChange({ ...value, mode: m })}
          >
            {m}
          </button>
        ))}
      </div>
      <p className="hint">
        Playing in <strong>{value.root} {value.mode}</strong>
      </p>
    </section>
  );
}
