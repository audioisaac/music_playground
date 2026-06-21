// The configurable layer that turns a whole-hand shape into musical intent.
//
// Primary hand  -> scale degree (1..7)         [shape]
// Modifier hand -> extension ("special chord")  [shape]
//               +  major/minor/diatonic quality [orientation, stacks on top]
//
// Shape recognition is holistic: a hand resolves to the nearest pose template
// within MATCH_THRESHOLD, so a mis-tucked thumb only nudges the distance. Shape
// matching is orientation-invariant, so hand orientation is a free orthogonal
// channel used for the quality override.

import type {
  Degree,
  Extension,
  Orientation,
  PoseVector,
  QualityMode,
} from "../types";
import { poseDistance } from "./handShape";
import {
  DEFAULT_MODIFIER,
  DEFAULT_PRIMARY,
  REST_TEMPLATES,
  makeTemplate,
} from "./defaultTemplates";

/** Max mean-landmark distance for a shape to count as a match. */
export const MATCH_THRESHOLD = 0.5;

export interface PrimaryEntry {
  id: string;
  template: PoseVector;
  degree: Degree;
  label: string;
}
export interface ModifierEntry {
  id: string;
  template: PoseVector;
  extension: Extension;
  label: string;
}
export interface GestureConfig {
  primary: PrimaryEntry[];
  modifier: ModifierEntry[];
}

/**
 * Modifier-hand orientation -> quality override. Fixed mapping:
 * point up = force major, down = force minor, sideways = diatonic (no borrow).
 */
export const ORIENTATION_QUALITY: Record<Orientation, QualityMode> = {
  up: "majorOverride",
  down: "minorOverride",
  side: "diatonic",
};

export function resolveOverride(orientation: Orientation): QualityMode {
  return ORIENTATION_QUALITY[orientation];
}

export function makeDefaultConfig(): GestureConfig {
  return {
    primary: DEFAULT_PRIMARY.map((d) => ({
      id: `degree-${d.degree}`,
      template: makeTemplate(d.extended),
      degree: d.degree,
      label: d.label,
    })),
    modifier: DEFAULT_MODIFIER.map((m) => ({
      id: m.extension,
      template: makeTemplate(m.extended),
      extension: m.extension,
      label: m.label,
    })),
  };
}

export const DEFAULT_CONFIG: GestureConfig = makeDefaultConfig();

function nearest<T extends { template: PoseVector }>(
  pose: PoseVector,
  entries: T[],
): T | null {
  let best: T | null = null;
  let bestDist = MATCH_THRESHOLD;
  for (const entry of entries) {
    const d = poseDistance(pose, entry.template);
    if (d < bestDist) {
      bestDist = d;
      best = entry;
    }
  }
  // A relaxed/clenched hand (closest to a rest shape) means "no gesture".
  if (best) {
    const restDist = Math.min(...REST_TEMPLATES.map((t) => poseDistance(pose, t)));
    if (restDist <= bestDist) return null;
  }
  return best;
}

/** Resolve the primary hand to a scale degree (nearest template, else null). */
export function resolvePrimary(
  pose: PoseVector,
  config: GestureConfig,
): { degree: Degree; label: string } | null {
  const e = nearest(pose, config.primary);
  return e ? { degree: e.degree, label: e.label } : null;
}

/** Resolve the modifier hand's shape to an extension (nearest, else null). */
export function resolveExtension(
  pose: PoseVector,
  config: GestureConfig,
): { extension: Extension; label: string } | null {
  const e = nearest(pose, config.modifier);
  return e ? { extension: e.extension, label: e.label } : null;
}

/** Re-capture the template for a degree (upsert by degree). */
export function bindPrimary(
  config: GestureConfig,
  template: PoseVector,
  degree: Degree,
  label: string,
): GestureConfig {
  const primary = config.primary.filter((e) => e.degree !== degree);
  primary.push({ id: `degree-${degree}`, template, degree, label });
  primary.sort((a, b) => a.degree - b.degree);
  return { ...config, primary };
}

/** Re-capture the template for an extension (upsert by extension). */
export function bindExtension(
  config: GestureConfig,
  template: PoseVector,
  extension: Extension,
  label: string,
): GestureConfig {
  const modifier = config.modifier.filter((e) => e.extension !== extension);
  modifier.push({ id: extension, template, extension, label });
  return { ...config, modifier };
}
