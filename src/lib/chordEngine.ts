// Combine the two hands into a single resolved chord (or silence).

import type {
  PoseVector,
  Key,
  Orientation,
  QualityMode,
  Extension,
  ResolvedChord,
} from "../types";
import { buildChord } from "./musicTheory";
import {
  GestureConfig,
  resolveExtension,
  resolveOverride,
  resolvePrimary,
} from "./gestureMap";

export interface EngineResult {
  chord: ResolvedChord | null;
  /** Labels describing what each hand contributed, for the UI. */
  primaryLabel: string | null;
  modifierLabel: string | null;
}

/**
 * Resolve the sounding chord from the current hand poses.
 *
 * `primaryPose` selects the degree. The modifier hand contributes two stacking
 * axes: its shape (`modifierPose`) adds an extension, and its orientation
 * (`modifierOrientation`) sets the major/minor/diatonic quality override.
 * A missing/fist primary hand yields silence.
 */
export function resolveChord(
  key: Key,
  primaryPose: PoseVector | null,
  modifierPose: PoseVector | null,
  modifierOrientation: Orientation | null,
  config: GestureConfig,
  inversion = 0,
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
  const labelParts: string[] = [];

  // The modifier hand is only active while it is present in frame.
  if (modifierPose) {
    if (modifierOrientation) {
      qualityMode = resolveOverride(modifierOrientation);
      if (qualityMode === "majorOverride") labelParts.push("force maj");
      else if (qualityMode === "minorOverride") labelParts.push("force min");
    }
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
