import { useEffect, useState } from "react";
import { ApiError } from "../../core/client";
import { ConversationView, WorkflowInfo, WorkflowResponse, WorkflowStep } from "../../core/types";
import { ACTIVE_RUN_STATES } from "../../core/work";
import { useApp } from "../../ui/Context";
import { useLoad } from "../../ui/hooks";
import { Badge, Btn, ErrorBox, Loading, Notice } from "../../ui/kit";
import { PanelId } from "./Thread";

const msg = (e: unknown) => (e instanceof ApiError ? e.message : (e as Error).message);
const STEP_NAME: Record<WorkflowStep["kind"], string> = { implement: "Build and check", review: "Independent review", correct: "Correction", capture: "Notes to remember" };
const stepLabel = (s: WorkflowStep) => (s.kind === "correct" ? `Correction ${s.round}` : STEP_NAME[s.kind]);
const stepNote = (s: WorkflowStep) => (s.summary ? s.summary.replace(/^high=0$/, "no high-severity problems").replace(/^high=(\d+)$/, (_, n) => `${n} high-severity problem${n === "1" ? "" : "s"}`) : s.status === "running" ? "in progress" : "");
const OUTCOME: Record<string, [string, "ok" | "warn" | "info" | "bad"]> = {
  ready: ["Ready", "ok"], needs_you: ["Needs you", "warn"], no_change: ["No change was made", "info"], failed: ["Stopped", "bad"], cancelled: ["Cancelled", "info"],
};

/** Start to finish: one request carried through build, your check, an independent review and corrections. */
export function Workflow({ v, reload, open }: { v: ConversationView; reload: () => Promise<void>; open: (p: PanelId) => void }) {
  const { client, connected } = useApp();
  const data = useLoad(() => client.get<WorkflowResponse>(`/conversations/${v.conversation.id}/workflow`), [client, v.conversation.id]);
  const w = data.data?.workflow ?? null, profiles = data.data?.profiles ?? {};
  const live = !!w && (w.state === "working" || w.state === "waiting_you");
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => { void data.reload(); void reload(); }, 2000);
    return () => clearInterval(t);
  }, [live]);                                              // eslint-disable-line react-hooks/exhaustive-deps
  const [request, setRequest] = useState("");
  const [profile, setProfile] = useState("build_and_check");
  const [rounds, setRounds] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const other = !!v.status.run && ACTIVE_RUN_STATES.has(v.status.run.state) && !live;
  const noCheck = !v.verify_command;
  const chosen = profiles[profile];

  const start = async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    try { await client.post(`/conversations/${v.conversation.id}/workflow`, { request: request.trim(), profile, ...(rounds === null ? {} : { max_rounds: rounds }) }); setRequest(""); await data.reload(); await reload(); }
    catch (e) { setErr(msg(e)); } finally { setBusy(false); }
  };
  const cancel = async (x: WorkflowInfo) => { setErr(null); try { await client.post(`/workflows/${x.id}/cancel`, {}); await data.reload(); await reload(); } catch (e) { setErr(msg(e)); } };

  return (
    <div>
      <p className="muted small">Give one request and AIOS carries it through: Claude builds it, AIOS runs your check, a separate Claude reviews it, and Claude fixes real problems, as many times as you allow. Nothing is merged into your project, and your check never runs without your yes.</p>
      <ErrorBox msg={err ?? data.error} />
      {data.loading && !data.data && <Loading />}
      {w && (
        <section className="card" aria-label="This run">
          <div className="row"><strong>{w.label}</strong>
            {w.outcome ? <span className={`badge ${OUTCOME[w.outcome][1] === "ok" ? "completed" : OUTCOME[w.outcome][1] === "bad" ? "failed" : "muted"}`}>{OUTCOME[w.outcome][0]}</span> : <Badge s={w.state === "waiting_you" ? "awaiting_approval" : "running"} label={w.state === "waiting_you" ? "waiting for you" : "working"} />}
            <span className="muted small">Corrections used: {w.round} of {w.max_rounds}</span></div>
          <p className="muted small">Request: {w.request.length > 200 ? `${w.request.slice(0, 197)}…` : w.request}</p>
          <ol className="plain steps" aria-label="Steps">{w.steps.map((s) => (
            <li key={s.id}><strong>{stepLabel(s)}</strong> <Badge s={s.status === "done" ? "completed" : s.status === "failed" ? "failed" : "running"} label={s.status === "done" ? "done" : s.status === "failed" ? "stopped" : "now"} /> <span className="muted small">{stepNote(s)}</span></li>))}</ol>
          {w.needs_you && <Notice tone="warn">{w.needs_you} <Btn kind="ghost" onClick={() => open("tests")}>Review and decide</Btn></Notice>}
          {w.outcome && <Notice tone={OUTCOME[w.outcome][1]}><strong>{OUTCOME[w.outcome][0]}.</strong> {w.outcome_reason} {w.outcome === "ready" && <Btn kind="ghost" onClick={() => open("outcome")}>See the result</Btn>}</Notice>}
          {live && <Btn kind="ghost" disabled={!connected} onClick={() => void cancel(w)}>Cancel this run</Btn>}
        </section>)}

      {!live && (
        <section className="card" aria-label="Start a run">
          <h2>Start a new run</h2>
          {noCheck && <Notice tone="warn">This project has no check command yet, so AIOS could not test what Claude builds. Set one in the Tests tab first. <Btn kind="ghost" onClick={() => open("tests")}>Open Tests</Btn></Notice>}
          {other && <Notice tone="info">Something else is running in this conversation. Wait for it to finish.</Notice>}
          <label className="field"><span>What should be built or fixed?</span><textarea rows={4} value={request} maxLength={8000} onChange={(e) => setRequest(e.target.value)} /></label>
          <label className="field"><span>How careful?</span>
            <select value={profile} onChange={(e) => { setProfile(e.target.value); setRounds(null); }}>{Object.entries(profiles).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}</select></label>
          {chosen && <p className="muted small">{chosen.summary}</p>}
          <label className="field"><span>Most corrections allowed</span>
            <select value={rounds ?? chosen?.max_rounds ?? 0} onChange={(e) => setRounds(Number(e.target.value))}>{[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
          {chosen && <details><summary>What this run may and may not do</summary><ul>{chosen.permissions.map((p) => <li key={p}>{p}</li>)}</ul></details>}
          <Btn busy={busy} disabled={!connected || !request.trim() || noCheck || other || !chosen} onClick={() => void start()}>Start</Btn>
        </section>)}
    </div>
  );
}
