import { useState } from "react";
import { ApiError } from "../core/client";
import { useApp } from "./Context";
import { useLoad } from "./hooks";
import { Btn, ErrorBox, Loading } from "./kit";

interface Level { level: number; name: string; available: boolean; reason?: string }
interface RoverTask { id: string; goal: string; level: number; target?: string; steps?: { instructions?: string[]; note?: string; at?: string }[] }
interface RoverState { status: string; ring: boolean; task: RoverTask | null; last_task: RoverTask | null; levels: Level[]; input_injection: boolean }
interface StepResult { outcome?: string; instructions?: string[] | string }

/** Must match EXPLAIN_GOAL in the server (rover.py): a goal that starts with it asks for a plain-words explanation instead of steps. */
export const EXPLAIN_GOAL = "Explain this window or popup in plain words";
const say = (e: unknown) => (e instanceof ApiError ? e.message : (e as Error).message);

/** The Rover bay: what it can do today (look at one window and guide you), a one-task opt-in form, and a Stop that is always there. */
export function RoverPanel({ onChanged }: { onChanged?: () => void }) {
  const { client, connected } = useApp();
  const st = useLoad(() => client.get<RoverState>("/rover"), [client], 3000);
  const [goal, setGoal] = useState(""), [target, setTarget] = useState(""), [level, setLevel] = useState(1), [optIn, setOptIn] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [last, setLast] = useState<StepResult | null>(null);
  const [busy, setBusy] = useState(false);
  if (st.loading && !st.data) return <Loading what="Checking the Rover" />;
  if (!st.data) return <ErrorBox msg={st.error ?? "The Rover is not available."} code={st.errorCode} />;
  const s = st.data, task = s.task;
  const run = async (fn: () => Promise<unknown>) => {
    setErr(null); setBusy(true);
    try { await fn(); await st.reload(); onChanged?.(); } catch (e) { setErr(say(e)); } finally { setBusy(false); }
  };

  return (
    <section className="rover" aria-label="Rover">
      <p><strong>Status:</strong> {s.status}. {s.ring ? "The Rover is active: the ring is on until you stop it." : "The Rover is not doing anything."}</p>
      <p className="muted small">It never clicks or types. {s.levels.filter((l) => !l.available).map((l) => `${l.name}: not available. ${l.reason ?? ""}`).join(" ")}</p>
      <Btn kind="ghost" onClick={() => void run(() => client.post("/rover/stop"))}>Stop</Btn>
      {task ? (
        <div className="rover-task">
          <h3>{task.goal}</h3>
          <p className="muted small">{task.goal.startsWith(EXPLAIN_GOAL) ? "Explain a popup" : task.level === 1 ? "Look" : "Guide"} · {task.target ?? "the front window"}</p>
          <Btn busy={busy} disabled={!connected} onClick={() => void run(async () => setLast((await client.post<StepResult>(`/rover/tasks/${task.id}/step`)).data))}>Take a look now</Btn>
          <Btn kind="ghost" onClick={() => void run(async () => { await client.post(`/rover/tasks/${task.id}/finish`); setLast(null); })}>Finish</Btn>
          {last && (
            <div role="status">
              {last.outcome === "stopped" && <p>Stopped.</p>}
              {Array.isArray(last.instructions) ? <ol>{last.instructions.map((i, k) => <li key={k}>{i}</li>)}</ol> : last.instructions ? <p>{last.instructions}</p> : null}
            </div>)}
        </div>
      ) : (
        <>
          <section className="rover-explain" aria-label="What does this popup mean?">
            <h3>What does this popup mean?</h3>
            <p className="muted small">Leave the popup open, type part of its title below, then press Start. AIOS looks at that one window and explains it in plain words, including whether it looks like a scam. It never clicks anything, and it will not look at banking, payment, password or settings windows.</p>
            <Btn kind="ghost" onClick={() => { setGoal(`${EXPLAIN_GOAL} (what it is, and whether it looks like a scam)`); setLevel(2); }}>Use this for my popup</Btn>
          </section>
        <form onSubmit={(e) => { e.preventDefault(); void run(async () => { await client.post("/rover/tasks", { goal: goal.trim(), level, target: target.trim(), opt_in: true }); setGoal(""); }); }}>
          <label className="field"><span>What do you need help with?</span><input value={goal} onChange={(e) => setGoal(e.target.value)} maxLength={300} /></label>
          <label className="field"><span>Which window? (part of its title)</span><input value={target} onChange={(e) => setTarget(e.target.value)} maxLength={120} /></label>
          <fieldset><legend>How much help</legend>
            {s.levels.map((l) => (
              <label key={l.level} className="row"><input type="radio" name="rover-level" disabled={!l.available} checked={level === l.level} onChange={() => setLevel(l.level)} />
                <span>{l.name}{!l.available && " (not available)"}</span></label>))}
          </fieldset>
          <label className="row"><input type="checkbox" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} /><span>Yes, let the Rover do this one task. It stops when I press Stop.</span></label>
          <Btn type="submit" busy={busy} disabled={!connected || !optIn || !goal.trim() || !target.trim()}>Start</Btn>
        </form>
        </>
      )}
      <ErrorBox msg={err} />
    </section>
  );
}
