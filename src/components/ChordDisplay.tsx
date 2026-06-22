import type { ResolvedChord } from "../types";
import { noteToMidi, romanNumeral } from "../lib/musicTheory";

interface Props {
  chord: ResolvedChord | null;
  primaryLabel: string | null;
  modifierLabel: string | null;
  /** Live sung note name (vocal mode), or null when not singing. */
  sungNote: string | null;
  /** Live harmony note names being formed around the sung lead. */
  harmonyNotes: string[];
}

export function ChordDisplay({
  chord,
  primaryLabel,
  modifierLabel,
  sungNote,
  harmonyNotes,
}: Props) {
  // Pitch classes in the current chord, to flag harmony notes "apart from" it.
  const chordPcs = new Set(
    (chord?.notes ?? []).map((n) => ((noteToMidi(n) % 12) + 12) % 12),
  );

  return (
    <section className="panel chord-display">
      <h2>Now Playing</h2>
      {chord ? (
        <>
          <div className="chord-name">{chord.name}</div>
          <div className="chord-roman">
            {romanNumeral(chord.degree, chord.quality)}
            {chord.qualityMode !== "diatonic" && (
              <span className="borrowed"> (borrowed)</span>
            )}
          </div>
          <div className="chord-notes">{chord.notes.join(" · ")}</div>
        </>
      ) : (
        <div className="chord-name muted">—</div>
      )}

      {sungNote && (
        <div className="vocal-readout">
          <div className="singing">
            <span className="vr-label">Singing</span>
            <span className="vr-note">{sungNote}</span>
          </div>
          <div className="harmony">
            <span className="vr-label">Harmony</span>
            <span className="vr-notes">
              {harmonyNotes.length
                ? harmonyNotes.map((n, i) => {
                    const pc = ((noteToMidi(n) % 12) + 12) % 12;
                    const added = !chordPcs.has(pc);
                    return (
                      <span key={`${n}-${i}`} className={added ? "added" : ""}>
                        {n}
                        {i < harmonyNotes.length - 1 ? " · " : ""}
                      </span>
                    );
                  })
                : "—"}
            </span>
          </div>
        </div>
      )}

      <div className="hand-labels">
        <span>Chord hand: {primaryLabel ?? "—"}</span>
        <span>Modifier hand: {modifierLabel ?? "—"}</span>
      </div>
    </section>
  );
}
