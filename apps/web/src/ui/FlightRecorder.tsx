import { useEffect, useMemo, useState } from "react";
import { fileStateAt, parseTranscript } from "../core/flight";

const GLYPH: Record<string, string> = { start: "▶", read: "👁", list: "☰", search: "🔍", edit: "✎", write: "✚", say: "💬", schema: "📋", tool_error: "⚠", refused: "⛔", unexpected: "⛔", other: "•", finish: "■" };
const STATE_TEXT = { idle: "untouched", read: "read", edited: "edited", written: "written" } as const;
export const STEP_MS = 700;

/** Replays a finished run from its saved transcript: files light up as they are read or changed, refusals show red. */
export function FlightRecorder({ transcript }: { transcript: string }) {
  const flight = useMemo(() => parseTranscript(transcript), [transcript]);
  const last = flight.frames.length - 1;
  const [k, setK] = useState(last);
  const [playing, setPlaying] = useState(false);
  useEffect(() => { setK(last); setPlaying(false); }, [last, transcript]);
  useEffect(() => {
    if (!playing) return;
    if (k >= last) { setPlaying(false); return; }
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const t = setTimeout(() => setK((x) => Math.min(last, x + 1)), reduce ? 0 : STEP_MS);
    return () => clearTimeout(t);
  }, [playing, k, last]);
  if (flight.frames.length === 0) return <p className="muted small">There is nothing to replay for this run.</p>;
  const frame = flight.frames[k];
  const play = () => { if (k >= last) setK(0); setPlaying((p) => !p); };
  return (
    <section className="flight" aria-label="Flight recorder replay">
      <div className="row">
        <button type="button" className="btn ghost" onClick={play}>{playing ? "Pause" : k >= last ? "Replay" : "Play"}</button>
        <input type="range" min={0} max={last} value={k} aria-label="Replay position" aria-valuetext={`Step ${k + 1} of ${last + 1}: ${frame.label}`}
          onChange={(e) => { setPlaying(false); setK(Number(e.target.value)); }} />
        <span className="muted small">{k + 1} / {last + 1}</span>
      </div>
      <p className={`flightnow fk-${frame.kind}`} role="status"><span aria-hidden="true">{GLYPH[frame.kind]}</span> {frame.label}</p>
      {flight.files.length > 0 && (
        <ul className="flightfiles" aria-label="Files touched">
          {flight.files.map((t) => {
            const s = fileStateAt(t, k);
            return <li key={t.path} className={`ff-${s.state}${s.flash ? " flash" : ""}`}><code>{t.path}</code> <span className="muted small">{STATE_TEXT[s.state]}</span></li>;
          })}
        </ul>
      )}
      {flight.truncated && <p className="muted small">Long run: only the first {flight.frames.length} steps are shown.</p>}
    </section>
  );
}
