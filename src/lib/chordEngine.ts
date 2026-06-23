// Combine the two hands into a single resolved chord (or silence).

import type {
  PoseVector,
  Key,
  QualityMode,
  Extension,
  ResolvedChord,
} from "../types";
import { buildChord } from "./musicTheory";
import { GestureConfig, resolveExtension, resolvePrimary } from "./gestureMap";

export interface EngineResult {
  chord: ResolvedChord | null;
  /** Labels describing what each hand contributed, for the UI. */
  primaryLabel: string | null;
  modifierLabel: string | null;
}

/**
 * Resolve the sounding chord from the current hand poses.
 *
 * `primaryPose` selects the degree; the chord hand's `facing` (palm vs back of
 * hand) flips the quality to its opposite when "back". The modifier hand's shape
 * (`modifierPose`) adds an extension. A missing/fist primary hand yields silence.
 */
export function resolveChord(
  key: Key,
  primaryPose: PoseVector | null,
  modifierPose: PoseVector | null,
  config: GestureConfig,
  inversion = 0,
  facing: "palm" | "back" = "palm",
): EngineResult {
  if (!primaryPose) {
    return { chord: null, primaryLabel: null, modifierLabel: null };
  }

  const primary = resolvePrimary(primaryPose, config);
  if (!primary) {
    return { chord: null, primaryLabel: null, modifierLabel: null };
  }

  // Back of the chord hand → flip the diatonic quality to its opposite.
  const qualityMode: QualityMode = facing === "back" ? "flip" : "diatonic";

  let extension: Extension = "none";
  const labelParts: string[] = [];
  // The modifier hand only contributes the extension now.
  if (modifierPose) {
    const ext = resolveExtension(modifierPose, config);
    if (ext) {
      extension = ext.extension;
      labelParts.push(ext.label);
    }
  }

  const chord = buildChord(key, primary.degree, qualityMode, extension, inversion);
  return {
    chord,
    primaryLabel: primary.label,
    modifierLabel: labelParts.length ? labelParts.join(" · ") : null,
  };
}

/** Stable identity for a resolved chord, used to detect changes. */
export function chordId(chord: ResolvedChord | null): string {
  if (!chord) return "silence";
  return `${chord.name}:${chord.notes.join(",")}`;
}
