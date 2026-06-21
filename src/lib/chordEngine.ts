// Combine the two hands' signatures into a single resolved chord (or silence).

import type {
  PoseVector,
  Key,
  QualityMode,
  Extension,
  ResolvedChord,
} from "../types";
import { buildChord } from "./musicTheory";
import { GestureConfig, resolveModifier, resolvePrimary } from "./gestureMap";

export interface EngineResult {
  chord: ResolvedChord | null;
  /** Labels describing what each hand contributed, for the UI. */
  primaryLabel: string | null;
  modifierLabel: string | null;
}

/**
 * Resolve the sounding chord from the current hand poses.
 * `primarySig` selects the degree; `modifierSig` adds an extension or a
 * major/minor override. A missing/fist primary hand yields silence.
 */
export function resolveChord(
  key: Key,
  primaryPose: PoseVector | null,
  modifierPose: PoseVector | null,
  config: GestureConfig,
): EngineResult {
  if (!primaryPose) {
    return { chord: null, primaryLabel: null, modifierLabel: null };
  }

  const primary = resolvePrimary(primaryPose, config);
  if (!primary) {
    return { chord: null, primaryLabel: null, modifierLabel: null };
  }

  let extension: Extension = "none";
  let qualityMode: QualityMode = "diatonic";
  let modifierLabel: string | null = null;

  if (modifierPose) {
    const mod = resolveModifier(modifierPose, config);
    if (mod) {
      modifierLabel = mod.label;
      if (mod.value.kind === "extension") {
        extension = mod.value.extension;
      } else {
        qualityMode =
          mod.value.override === "major" ? "majorOverride" : "minorOverride";
      }
    }
  }

  const chord = buildChord(key, primary.degree, qualityMode, extension);
  return { chord, primaryLabel: primary.label, modifierLabel };
}

/** Stable identity for a resolved chord, used to detect changes. */
export function chordId(chord: ResolvedChord | null): string {
  if (!chord) return "silence";
  return `${chord.name}:${chord.notes.join(",")}`;
}
