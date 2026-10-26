import { useEffect, useState } from "react";
import { ConversationView, Finding } from "../../core/types";
import { sealOfChanges } from "../../core/seal";
import { ACTIVE_RUN_STATES, findingsPrompt } from "../../core/work";
import { ProofSeal } from "../../ui/Seal";
import { useApp } from "../../ui/Context";
import { go, useLoad, useViewport } from "../../ui/hooks";
import { Badge, Btn, ErrorBox, Loading, Notice } from "../../ui/kit";
import { useTabTitle } from "../../ui/useTabTitle";
import { Handoff } from "./Handoff";
import { Together } from "./Together";
import { ActivityPanel, ChangesPanel, OutcomePanel, StatusPanel, TestsPanel } from "./Panels";
import { Busy, Composer, MessageList, PanelId } from "./Thread";

const TAB_LABEL: Record<PanelId, string> = { chat: "Chat", activity: "Activity", together: "Together", changes: "Changes", tests: "Tests", outcome: "Outcome", status: "Status" };

export function ConversationScreen({ id }: { id: string }) {
  const { client, settings } = useApp();
  const { twoPane } = useViewport();
  const view = useLoad(() => client.get<ConversationView>(`/conversations/${id}`), [client, id]);
  const v = view.data;
  const run = v?.status.run ?? null;
  const active = !!run && ACTIVE_RUN_STATES.has(run.state);
  const busy: Busy = !active ? null : run!.state === "awaiting_approval" ? "approval" : ["blocked", "interrupted"].includes(run!.state) ? "stopped" : "working";
  useEffect(() => {      // quick while Claude is working, relaxed otherwise
    const t = setInterval(() => void view.reload(), active ? 2000 : 10000);
    return () => clearInterval(t);
  }, [active, view.reload]);                                // eslint-disable-line react-hooks/exhaustive-deps
  useTabTitle(v?.conversation.title);
  const [panel, setPanel] = useState<PanelId>(twoPane ? "activity" : "chat");
  const [seed, setSeed] = useState<{ text: string; mode: "read" | "edit"; n: number } | null>(null);

  if (!v) {
    return (
      <div className="screen"><Btn kind="ghost" onClick={() => go({ tab: "work" })}>← Workspace</Btn>
        <ErrorBox msg={view.error} code={view.errorCode} />{view.loading && <Loading what="Loading the conversation" />}</div>
    );
  }
  const r = v.changes.readiness;
  const seal = sealOfChanges(v.changes);
  const pending = v.status.pending_approvals.length;
  // Simple mode with no code changes in this conversation: hide the code-review tabs and keep chat, together and status.
  const codeFree = settings.mode === "simple" && !v.changes.patch && !v.conversation.worktree_path;
  const right: PanelId[] = codeFree ? ["together", "status"] : ["activity", "together", "changes", "tests", "outcome", "status"];
  const tabs: PanelId[] = twoPane ? right : ["chat", ...right];
  const shown: PanelId = tabs.includes(panel) ? panel : tabs[0];
  const mark = (p: PanelId) =>
    p === "activity" && active ? " ●" : p === "tests" && pending ? " !" : p === "outcome" && r.head_revision ? (r.ready ? " ✓" : " ✗") : "";
  const draftFix = (fs: Finding[], rev: string | null) => { setSeed({ text: findingsPrompt(fs, rev), mode: "edit", n: Date.now() }); if (!twoPane) setPanel("chat"); };
  const chat = (
    <div className="chatcol">
      <MessageList messages={v.messages} open={setPanel} />
      <Composer conversationId={id} busy={busy} seed={seed} onSent={() => { setPanel("activity"); void view.reload(); }} />
    </div>
  );
  const body = shown === "chat" ? chat : shown === "activity" ? <ActivityPanel v={v} reload={view.reload} />
    : shown === "together" ? <Together v={v} reload={view.reload} />
    : shown === "changes" ? <ChangesPanel v={v} /> : shown === "tests" ? <TestsPanel v={v} reload={view.reload} />
    : shown === "outcome" ? <OutcomePanel v={v} reload={view.reload} sendFindings={draftFix} /> : <><StatusPanel v={v} /><Handoff conversationId={id} onChanged={() => void view.reload()} /></>;
  return (
    <div className="screen work">
      <Btn kind="ghost" onClick={() => go({ tab: "work" })}>← Workspace</Btn>
      <div className="row">
        {seal.show && <ProofSeal hash={seal.hash} view={seal.view} size={38} />}
        <h2>{v.conversation.title}</h2>
        {run && <Badge s={run.display_state} />}
        {r.head_revision && <Badge s={r.ready ? "completed" : "failed"} label={r.ready ? "ready" : "not ready"} />}
      </div>
      <p className="muted small">{v.project.name} · {v.conversation.model ?? "account default model"}{v.conversation.branch ? ` · branch ${v.conversation.branch}` : ""}</p>
      <ErrorBox msg={view.error && v ? `Could not refresh (${view.error}). Showing the last data received.` : null} />
      {pending > 0 && (
        v.status.pending_approvals.some((p) => p.type === "apply_revision")
          ? <Notice tone="warn">Your approval is needed before this change is added to your real project. <Btn kind="ghost" onClick={() => setPanel("outcome")}>Review and decide</Btn></Notice>
          : <Notice tone="warn">Your approval is needed before AIOS runs the tests on Claude&apos;s change. <Btn kind="ghost" onClick={() => setPanel("tests")}>Review and decide</Btn></Notice>
      )}
      <div className="tabs" role="tablist" aria-label="Conversation sections">
        {tabs.map((p) => (
          <button key={p} role="tab" aria-selected={shown === p} className={`tab ${shown === p ? "on" : ""}`} onClick={() => setPanel(p)}>{TAB_LABEL[p]}{mark(p)}</button>))}
      </div>
      {twoPane ? (
        <div className="work-grid">
          <section className="work-left" aria-label="Conversation">{chat}</section>
          <section className="work-right" aria-label={TAB_LABEL[shown]}>{body}</section>
        </div>
      ) : body}
    </div>
  );
}
