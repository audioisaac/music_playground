import { useMemo } from "react";
import type { RecorderApi } from "../hooks/useRecorder";
import type { RecordedSession } from "../types";

interface Props {
  recorder: RecorderApi;
}

function fmt(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function SessionRow({
  session,
  recorder,
}: {
  session: RecordedSession;
  recorder: RecorderApi;
}) {
  const url = useMemo(
    () => (session.audioBlob ? URL.createObjectURL(session.audioBlob) : null),
    [session.audioBlob],
  );
  return (
    <li className="session-row">
      <div className="session-meta">
        <strong>{new Date(session.createdAt).toLocaleTimeString()}</strong>
        <span>{fmt(session.durationMs)}</span>
        <span>{session.timeline.filter((e) => e.action === "on").length} chords</span>
      </div>
      <div className="session-actions">
        <button onClick={() => recorder.replaySession(session)}>▶ Replay</button>
        {url && (
          <a href={url} download={`session-${session.id}.webm`} className="btn-link">
            ⬇ Audio
          </a>
        )}
        <button className="link" onClick={() => recorder.deleteSession(session.id)}>
          delete
        </button>
      </div>
    </li>
  );
}

export function RecorderPanel({ recorder }: Props) {
  return (
    <section className="panel recorder-panel">
      <h2>Recorder</h2>
      <div className="recorder-controls">
        {!recorder.isRecording ? (
          <button className="record" onClick={recorder.startRecording}>
            ● Record
          </button>
        ) : (
          <button className="recording" onClick={recorder.stopRecording}>
            ■ Stop
          </button>
        )}
        {recorder.isReplaying && (
          <button onClick={recorder.stopReplay}>■ Stop replay</button>
        )}
      </div>

      {recorder.sessions.length === 0 ? (
        <p className="hint">No recordings yet. Hit Record and play some chords.</p>
      ) : (
        <ul className="session-list">
          {recorder.sessions.map((s) => (
            <SessionRow key={s.id} session={s} recorder={recorder} />
          ))}
        </ul>
      )}
    </section>
  );
}
