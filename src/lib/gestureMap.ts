// The configurable layer that turns a whole-hand shape into musical intent.
//
// Primary hand  -> scale degree (1..7)
// Modifier hand -> an extension ("special chord") OR a major/minor override
//
// Each binding stores a normalized pose template (a captured "outline"). A live
// hand resolves to the nearest template within MATCH_THRESHOLD, so recognition
// is holistic — a mis-tucked thumb nudges the distance instead of flipping a
// per-finger boolean. The calibration UI re-captures templates to the user's hand.

import type { Degree, ModifierBinding, PoseVector } from "../types";
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
  value: ModifierBinding;
  label: string;
}
export interface GestureConfig {
  primary: PrimaryEntry[];
  modifier: ModifierEntry[];
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
      id: m.key,
      template: makeTemplate(m.extended),
      value: m.value,
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

/** Resolve the modifier hand to an extension or override (nearest, else null). */
export function resolveModifier(
  pose: PoseVector,
  config: GestureConfig,
): { value: ModifierBinding; label: string } | null {
  const e = nearest(pose, config.modifier);
  return e ? { value: e.value, label: e.label } : null;
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

/** Re-capture the template for a modifier (upsert by binding identity). */
export function bindModifier(
  config: GestureConfig,
  template: PoseVector,
  value: ModifierBinding,
  label: string,
): GestureConfig {
  const id = modifierId(value);
  const modifier = config.modifier.filter((e) => modifierId(e.value) !== id);
  modifier.push({ id, template, value, label });
  return { ...config, modifier };
}

export function modifierId(value: ModifierBinding): string {
  return value.kind === "extension"
    ? `ext-${value.extension}`
    : `ovr-${value.override}`;
}
