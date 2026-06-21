// Records the master output (synth or vocals) to an audio blob AND captures a
// replayable timeline of chord events. Sessions persist to localStorage.

import { useCallback, useEffect, useRef, useState } from "react";
import * as Tone from "tone";
import type { ChordEvent, RecordedSession, ResolvedChord } from "../types";
import { loadSessions, saveSessions } from "../lib/storage";
import type { InstrumentApi } from "./useInstrument";

export interface RecorderApi {
  isRecording: boolean;
  isReplaying: boolean;
  sessions: RecordedSession[];
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  logEvent: (action: "on" | "off", chord: ResolvedChord | null) => void;
  replaySession: (session: RecordedSession) => void;
  stopReplay: () => void;
  deleteSession: (id: string) => void;
}

export function useRecorder(instrument: InstrumentApi): RecorderApi {
  const [isRecording, setIsRecording] = useState(false);
  const [isReplaying, setIsReplaying] = useState(false);
  const [sessions, setSessions] = useState<RecordedSession[]>([]);

  const recorderRef = useRef<Tone.Recorder | null>(null);
  const timelineRef = useRef<ChordEvent[]>([]);
  const startTsRef = useRef(0);
  const recordingRef = useRef(false);
  const replayTimersRef = useRef<number[]>([]);

  useEffect(() => {
    loadSessions().then(setSessions);
  }, []);

  const persist = useCallback(async (next: RecordedSession[]) => {
    setSessions(next);
    await saveSessions(next);
  }, []);

  const startRecording = useCallback(async () => {
    await instrument.start();
    const node = instrument.getRecordNode();
    if (!node) return;
    if (!recorderRef.current) recorderRef.current = new Tone.Recorder();
    node.connect(recorderRef.current);
    timelineRef.current = [];
    startTsRef.current = performance.now();
    recordingRef.current = true;
    recorderRef.current.start();
    setIsRecording(true);
  }, [instrument]);

  const stopRecording = useCallback(async () => {
    const rec = recorderRef.current;
    if (!rec) return;
    const blob = await rec.stop();
    const node = instrument.getRecordNode();
    if (node) node.disconnect(rec);
    recordingRef.current = false;
    setIsRecording(false);
    const durationMs = performance.now() - startTsRef.current;
    const session: RecordedSession = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      durationMs,
      audioBlob: blob,
      timeline: timelineRef.current,
    };
    await persist([session, ...sessions]);
  }, [instrument, sessions, persist]);

  const logEvent = useCallback(
    (action: "on" | "off", chord: ResolvedChord | null) => {
      if (!recordingRef.current) return;
      timelineRef.current.push({
        t: performance.now() - startTsRef.current,
        action,
        chord: chord ?? undefined,
      });
    },
    [],
  );

  const stopReplay = useCallback(() => {
    replayTimersRef.current.forEach((id) => clearTimeout(id));
    replayTimersRef.current = [];
    instrument.previewRelease();
    setIsReplaying(false);
  }, [instrument]);

  const replaySession = useCallback(
    (session: RecordedSession) => {
      stopReplay();
      instrument.start();
      setIsReplaying(true);
      for (const ev of session.timeline) {
        const id = window.setTimeout(() => {
          if (ev.action === "on" && ev.chord) instrument.previewAttack(ev.chord.notes);
          else instrument.previewRelease();
        }, ev.t);
        replayTimersRef.current.push(id);
      }
      const end = window.setTimeout(() => {
        instrument.previewRelease();
        setIsReplaying(false);
      }, session.durationMs + 200);
      replayTimersRef.current.push(end);
    },
    [instrument, stopReplay],
  );

  const deleteSession = useCallback(
    (id: string) => {
      persist(sessions.filter((s) => s.id !== id));
    },
    [sessions, persist],
  );

  return {
    isRecording,
    isReplaying,
    sessions,
    startRecording,
    stopRecording,
    logEvent,
    replaySession,
    stopReplay,
    deleteSession,
  };
}
