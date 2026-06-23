import type { ResolvedChord } from "../types";
import { romanNumeral } from "../lib/musicTheory";

interface Props {
  chord: ResolvedChord | null;
  primaryLabel: string | null;
  modifierLabel: string | null;
}

export function ChordDisplay({ chord, primaryLabel, modifierLabel }: Props) {
  return (
    <section className="panel chord-display">
      <h2>Now Playing</h2>
      {chord ? (
        <>
          <div className="chord-name">{chord.name}</div>
          <div className="chord-roman">
            {romanNumeral(chord.degree, chord.quality)}
            {chord.qualityMode === "flip" && (
              <span className="borrowed"> (flipped)</span>
            )}
            {chord.inversion > 0 && (
              <span className="inversion">
                {" "}
                · {chord.inversion === 1 ? "1st" : "2nd"} inv
              </span>
            )}
          </div>
          <div className="chord-notes">{chord.notes.join(" · ")}</div>
        </>
      ) : (
        <div className="chord-name muted">—</div>
      )}

      <div className="hand-labels">
        <span>Chord hand: {primaryLabel ?? "—"}</span>
        <span>Modifier hand: {modifierLabel ?? "—"}</span>
      </div>
    </section>
  );
}
