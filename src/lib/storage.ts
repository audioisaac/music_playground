// localStorage persistence for gesture mappings and recorded sessions.
// Audio blobs are stored as base64 data URLs so a session survives reloads.

import type { ChordEvent, RecordedSession } from "../types";
import { DEFAULT_CONFIG, GestureConfig } from "./gestureMap";

const CONFIG_KEY = "gcs.gestureConfig.v1";
const SESSIONS_KEY = "gcs.sessions.v1";

export function loadConfig(): GestureConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw) as GestureConfig;
    if (!parsed.primary || !parsed.modifier) return DEFAULT_CONFIG;
    return parsed;
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(config: GestureConfig): void {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

export function resetConfig(): GestureConfig {
  localStorage.removeItem(CONFIG_KEY);
  return DEFAULT_CONFIG;
}

interface StoredSession {
  id: string;
  createdAt: number;
  durationMs: number;
  audioDataUrl?: string;
  timeline: ChordEvent[];
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

export async function loadSessions(): Promise<RecordedSession[]> {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    if (!raw) return [];
    const stored = JSON.parse(raw) as StoredSession[];
    return Promise.all(
      stored.map(async (s) => ({
        id: s.id,
        createdAt: s.createdAt,
        durationMs: s.durationMs,
        timeline: s.timeline,
        audioBlob: s.audioDataUrl
          ? await dataUrlToBlob(s.audioDataUrl)
          : undefined,
      })),
    );
  } catch {
    return [];
  }
}

export async function saveSessions(sessions: RecordedSession[]): Promise<void> {
  const stored: StoredSession[] = await Promise.all(
    sessions.map(async (s) => ({
      id: s.id,
      createdAt: s.createdAt,
      durationMs: s.durationMs,
      timeline: s.timeline,
      audioDataUrl: s.audioBlob ? await blobToDataUrl(s.audioBlob) : undefined,
    })),
  );
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(stored));
  } catch (err) {
    // Audio data URLs can exceed the quota; degrade gracefully.
    console.warn("Could not persist sessions (storage quota?)", err);
  }
}
