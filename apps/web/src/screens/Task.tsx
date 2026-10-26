import { useEffect, useState } from "react";
import { ApiError, newKey } from "../core/client";
import { AssistView, KIND_ICON, TASK_TEXT, STATUS_TEXT } from "../core/assist";
import { Markdown } from "../ui/Markdown";
import { Companion } from "../ui/Companion";
import { useApp } from "../ui/Context";
import { go, useLoad } from "../ui/hooks";
import { Icon } from "../ui/icons";
import { Btn, ErrorBox, Loading, ago } from "../ui/kit";
import { AgentAvatar, StatusIcon } from "../ui/PlanView";
import { useTabTitle } from "../ui/useTabTitle";

const msg = (e: unknown) => (e instanceof ApiError ? e.message : (e as Error).message);
const OFFER_PROVIDER: Record<string, { provider: string; name: string; only: string[] }> = {
  lookup: { provider: "perplexity", name: "Perplexity", only: ["research"] },
  second_look: { provider: "gemini", name: "Gemini", only: ["fact_check"] },
};

/** One task from start to finish: what AIOS decided, where it is now, and the result. Plain words first, details one click away. */
export function Task({ id }: { id: string }) {
  const { client, connected } = useApp();
  const task = useLoad(() => client.get<AssistView>(`/assist/${id}`), [client, id]);
  const v = task.data;
  const live = !!v && (v.state === "working" || v.state === "waiting_you");
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => void task.reload(), 1500);
    return () => clearInterval(t);
  }, [live]);                                                  // eslint-disable-line react-hooks/exhaustive-deps
  useTabTitle(v ? v.prompt.slice(0, 40) : "Task");
  const [open, setOpen] = useState<string | null>(null);
  const [follow, setFollow] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!v) return <div className="screen"><Btn kind="ghost" onClick={() => go({ tab: "home" })}>← Home</Btn><ErrorBox msg={task.error} code={task.errorCode} />{task.loading && <Loading what="Opening the task" />}</div>;
  const canFollowUp = !v.workflow_id && v.state === "done";
  const send = async () => {
    if (busy || !follow.trim()) return;
    setBusy(true); setErr(null);
    try { await client.post(`/conversations/${v.conversation_id}/messages`, { content: follow.trim(), mode: "read" }, { idempotencyKey: `fu-${newKey()}` }); setFollow(""); await task.reload(); }
    catch (e) { setErr(msg(e)); } finally { setBusy(false); }
  };
  return (
    <div className="screen task">
      <Btn kind="ghost" onClick={() => go({ tab: "home" })}>← Home</Btn>
      <header className="task-head">
        <div className="task-meta">
          <span className="task-kind"><Icon name={KIND_ICON[v.kind]} size={16} />{v.label}{v.project ? ` · ${v.project.name}` : ""}</span>
          <span className={`status big ${v.state}`}><span className="dotmark" aria-hidden="true" />{TASK_TEXT[v.state]}</span>
          <span className="muted small">{ago(v.created_at)}</span>
        </div>
        <h1 className="task-prompt">{v.prompt.length > 220 ? `${v.prompt.slice(0, 217)}…` : v.prompt}</h1>
      </header>

      {v.needs_you && v.state !== "done" && <div className="note warn" role="status"><strong>{v.state === "failed" ? "Stopped." : "Needs you."}</strong> {v.needs_you}{" "}
        {v.workflow_id && <Btn kind="ghost" onClick={() => go({ tab: "work", id: v.conversation_id })}>Open and decide</Btn>}</div>}

      <ol className="timeline" aria-label="Steps">
        {v.steps.filter((s) => s.status !== "skipped").map((s) => (
          <li key={s.id} className={`tl ${s.status}`}>
            <StatusIcon status={s.status} />
            <div className="tl-body">
              <div className="tl-main"><AgentAvatar agent={s.agent} size={22} /><strong>{s.label}</strong><span className="tl-status">{STATUS_TEXT[s.status]}</span></div>
              {s.status === "pending" && <p className="muted small">{s.why}</p>}
              {s.status === "offer" && OFFER_PROVIDER[s.id] && (
                <div className="tl-offer">
                  <p className="muted small">{s.why}</p>
                  {open === s.id ? <Companion provider={OFFER_PROVIDER[s.id].provider} name={OFFER_PROVIDER[s.id].name} conversationId={v.conversation_id} nested only={OFFER_PROVIDER[s.id].only} />
                    : <Btn kind="ghost" disabled={!connected || (!v.answer && s.id === "second_look")} onClick={() => setOpen(s.id)}>{s.id === "lookup" ? "Get the prompt for Perplexity" : "Get the prompt for Gemini"}</Btn>}
                </div>)}
            </div>
          </li>))}
      </ol>
      {v.steps.some((s) => s.status === "skipped") && (
        <details className="left-out">
          <summary>Left out: {v.steps.filter((s) => s.status === "skipped").map((s) => s.label.toLowerCase()).join(", ")}</summary>
          <ul>{v.steps.filter((s) => s.status === "skipped").map((s) => <li key={s.id}><strong>{s.label}.</strong> {s.why}</li>)}</ul>
        </details>)}

      {v.answer ? (
        <section className="result" aria-label="Result">
          <h2 className="sect">{v.workflow_id ? "Result" : "Answer"}</h2>
          <div className="result-card"><Markdown source={v.answer.text} /><p className="muted small">From {v.answer.author}. AI answers can be wrong; check anything that matters.</p></div>
        </section>
      ) : v.state === "working" ? <p className="muted" aria-live="polite" aria-busy="true">Working on it…</p> : null}

      <ErrorBox msg={err ?? task.error} />
      {canFollowUp && (
        <form className="followup" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <label className="sr" htmlFor="follow">Reply to Claude</label>
          <input id="follow" value={follow} onChange={(e) => setFollow(e.target.value)} placeholder="Ask a follow-up…" maxLength={4000} />
          <Btn type="submit" busy={busy} disabled={!connected || !follow.trim()} label="Send follow-up"><Icon name="send" size={16} /></Btn>
        </form>)}
      <div className="task-foot">
        <Btn kind="ghost" onClick={() => go({ tab: "work", id: v.conversation_id })}>{v.workflow_id ? "See the changes, checks and review" : "Open the full conversation"}</Btn>
      </div>
    </div>
  );
}
