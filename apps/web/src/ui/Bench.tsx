import { VERDICT_TEXT, benchModel } from "../core/bench";
import { ConversationView } from "../core/types";
import { shortRev } from "../core/work";

const SEAT_TEXT = { empty: "Not asked yet", idle: "Waiting", working: "Working now", done: "Finished" } as const;
const STAGE_TEXT = {
  none: "No change exists yet.", writer: "The change is with the writer, not yet reviewed.",
  travelling: "The change is on its way to the reviewer.", reviewer: "The reviewer has looked at this exact revision.",
} as const;

/** Writer and reviewer at two seats; the change sits with whoever last handled it. Purely a view of existing facts. */
export function Bench({ v }: { v: ConversationView }) {
  const b = benchModel(v);
  const [w, r] = b.seats;
  return (
    <section className={`bench stage-${b.stage}`} aria-label="The bench: writer and reviewer">
      <div className="benchrow">
        {[w, r].map((s) => (
          <div key={s.role} className={`seat s-${s.state}`}>
            <strong>{s.role === "writer" ? "Writer" : "Reviewer"}</strong>
            <span className="muted small">{s.model ?? "model not recorded"}</span>
            <span className="small">{SEAT_TEXT[s.state]}</span>
          </div>))}
        <div className="patchmark" aria-hidden="true" data-stage={b.stage}>▤</div>
      </div>
      <p className="muted small">{STAGE_TEXT[b.stage]} {shortRev(v.changes.readiness.head_revision) !== "—" && `Revision ${shortRev(v.changes.readiness.head_revision)}.`}</p>
      {b.sameModel && <p className="small">The reviewer used the same model as the writer, so this is a weaker second opinion.</p>}
      {b.pinned.length > 0 && (
        <ul className="pinned" aria-label="Findings pinned to the bench">
          {b.pinned.map((f) => <li key={f.id} className={`pin sev-${f.severity}`}><strong>{f.severity}</strong> {f.title}</li>)}
          {b.hidden > 0 && <li className="muted small">…and {b.hidden} more below.</li>}
        </ul>
      )}
      <div className={`stamp v-${b.verdict}`} role="status" aria-label={`Verdict: ${VERDICT_TEXT[b.verdict]}`}>{VERDICT_TEXT[b.verdict]}</div>
    </section>
  );
}
