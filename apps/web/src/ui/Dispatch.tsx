import { useEffect, useMemo, useState } from "react";
import { carryOver, flashbacks, habitsDone, habitsDue, isEvening, morningText, topChecklist, topThree } from "../core/dispatch";
import { NoteRow, fetchAllNotes } from "../core/vault";
import { canSpeak, speak, stopAllVoice } from "../core/voice";
import { Widget } from "../core/widgets";
import { BrainDump } from "./BrainDump";
import { useApp } from "./Context";

type ChecklistWidget = Extract<Widget, { kind: "checklist" }>;

/** Morning dispatch and evening wrap-up, from your own panels and notes. Shows the one that fits the time of day; the other is one click away. */
export function Dispatch({ widgets, saveChecklist, connected }: { widgets: Widget[]; saveChecklist: (w: ChecklistWidget, items: ChecklistWidget["config"]["items"]) => Promise<void>; connected: boolean }) {
  const { client } = useApp();
  const [evening, setEvening] = useState(isEvening());
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [reading, setReading] = useState(false);
  useEffect(() => { fetchAllNotes(client, "approved").then(setNotes).catch(() => setNotes([])); }, [client]);

  const flash = useMemo(() => flashbacks(notes)[0] ?? null, [notes]);
  const list = topChecklist(widgets);
  const done = list ? list.config.items.filter((i) => i.done) : [];
  const left = list ? list.config.items.filter((i) => !i.done) : [];
  const read = () => {
    if (reading) { stopAllVoice(); setReading(false); return; }
    if (speak(morningText(widgets, flash), () => setReading(false))) setReading(true);
  };

  return (
    <section className="dispatch" aria-label={evening ? "Evening wrap-up" : "Morning dispatch"}>
      <div className="row">
        <h3>{evening ? "Evening wrap-up" : "Morning dispatch"}</h3>
        <button type="button" className="btn btn-quiet" onClick={() => { setEvening((v) => !v); setConfirm(false); }}>{evening ? "Show the morning dispatch" : "Show the evening wrap-up"}</button>
      </div>
      {!evening ? (
        <>
          {topThree(widgets).length > 0
            ? <><p className="small">Your top priorities</p><ol>{topThree(widgets).map((i, n) => <li key={n}>{i.text}</li>)}</ol></>
            : <p className="muted small">No priorities listed. Add some to your top 3 panel.</p>}
          {habitsDue(widgets).length > 0 && <p className="small">Habits still to do today: {habitsDue(widgets).map((h) => h.title).join(", ")}</p>}
          {flash && <p className="small">A year or more ago today: {flash.yearsAgo === 1 ? "a year" : `${flash.yearsAgo} years`} ago you wrote <strong>{flash.note.title}</strong></p>}
          {canSpeak() && <button type="button" className="btn ghost" onClick={read}>{reading ? "Stop reading" : "Read my dispatch aloud"}</button>}
        </>
      ) : (
        <>
          <p className="small">{done.length > 0 ? `You finished ${done.length} thing${done.length === 1 ? "" : "s"} today.` : "Nothing ticked off yet today. That is fine."}</p>
          {done.length > 0 && <ul className="plain">{done.map((i, n) => <li key={n}>✓ {i.text}</li>)}</ul>}
          {habitsDone(widgets).length > 0 && <p className="small">Habits done: {habitsDone(widgets).map((h) => h.title).join(", ")}</p>}
          {left.length > 0 && <p className="small">Still open: {left.map((i) => i.text).join(", ")}. These stay on your list for tomorrow.</p>}
          {list && done.length > 0 && (
            confirm ? (
              <div className="row">
                <button type="button" className="btn primary" disabled={!connected} onClick={() => { void saveChecklist(list, carryOver(list.config.items).next); setConfirm(false); }}>Yes, clear {done.length} done and keep {left.length}</button>
                <button type="button" className="btn ghost" onClick={() => setConfirm(false)}>Not now</button>
              </div>)
              : <button type="button" className="btn ghost" disabled={!connected} onClick={() => setConfirm(true)}>Start tomorrow fresh</button>)}
          <BrainDump widgets={widgets} saveChecklist={saveChecklist} connected={connected} />
        </>
      )}
    </section>
  );
}
