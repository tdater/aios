import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, newKey } from "../core/client";
import { AssistPlan, AssistView, EXAMPLES, greeting, KIND_SHORT, PICKABLE } from "../core/assist";
import { useApp } from "./Context";
import { go, useLoad } from "./hooks";
import { Icon } from "./icons";
import { Btn } from "./kit";
import { PlanView } from "./PlanView";
import { VoiceButton } from "./VoiceButton";

interface ProjectRow { id: string; name: string }
const msg = (e: unknown) => (e instanceof ApiError ? e.message : (e as Error).message);

/** The single prompt: one box for any task. As you type it shows what AIOS would do (and what it would leave out). */
export function AskBox() {
  const { client, connected } = useApp();
  const [text, setText] = useState("");
  const [projectId, setProjectId] = useState("");
  const [kind, setKind] = useState("");
  const [plan, setPlan] = useState<AssistPlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [err, setErr] = useState<{ message: string; code?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const keyRef = useRef(newKey());
  const dictated = useRef("");                       // what was already typed when the microphone was pressed
  const area = useRef<HTMLTextAreaElement>(null);
  const projects = useLoad(() => client.get<{ items: ProjectRow[] }>("/projects", { query: { limit: 50 } }), [client]);
  const list = (projects.data?.items ?? []).filter((p) => p.name !== "Everyday");
  const prompt = text.trim();

  useEffect(() => { keyRef.current = newKey(); setErr(null); }, [text, projectId, kind]);           // a changed request is a new request
  useEffect(() => {
    if (!connected || prompt.length < 3) { setPlan(null); setPlanning(false); return; }
    const mine = ++seq.current;
    setPlanning(true);
    const t = setTimeout(() => {
      client.post<AssistPlan>("/assist/plan", { prompt, ...(projectId ? { project_id: projectId } : {}), ...(kind ? { kind } : {}) })
        .then((r) => { if (mine === seq.current) { setPlan(r.data); setPlanning(false); } })
        .catch(() => { if (mine === seq.current) { setPlan(null); setPlanning(false); } });
    }, 350);
    return () => clearTimeout(t);
  }, [client, connected, prompt, projectId, kind]);

  const example = useMemo(() => EXAMPLES, []);
  const start = async (override?: string) => {
    if (busy || !prompt) return;
    setBusy(true); setErr(null);
    try {
      const body = { prompt, ...(projectId ? { project_id: projectId } : {}), ...((override ?? kind) ? { kind: override ?? kind } : {}) };
      const r = await client.post<AssistView>("/assist", body, { idempotencyKey: `ask-${keyRef.current}` });
      setText(""); setKind("");
      go({ tab: "home", id: r.data.id });
    } catch (e) { setErr({ message: msg(e), code: e instanceof ApiError ? e.code : undefined }); } finally { setBusy(false); }
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void start(); }
  };
  const blocker = plan?.blocker ?? null;
  const code = err?.code ?? blocker?.code;

  return (
    <section className="ask" aria-label="Ask AIOS">
      <h1 className="ask-title">{greeting()}. What do you want done?</h1>
      <p className="ask-sub">Ask anything or hand over a task. AIOS works out the steps it needs and leaves out the ones it does not.</p>
      <form className="ask-box" onSubmit={(e) => { e.preventDefault(); void start(); }}>
        <label className="sr" htmlFor="ask-input">Your request</label>
        <textarea id="ask-input" ref={area} rows={3} value={text} maxLength={8000} placeholder="Type a question, a task, or something you need written…"
          onChange={(e) => setText(e.target.value)} onKeyDown={onKey} />
        <div className="ask-bar">
          <label className="ask-pick"><Icon name="folder" size={15} /><span className="sr">Project</span>
            <select aria-label="Project" value={projectId} onChange={(e) => { setProjectId(e.target.value); setKind(""); }}>
              <option value="">Not about a project</option>
              {list.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></label>
          <label className="ask-pick"><Icon name="sparkle" size={15} /><span className="sr">How AIOS handles it</span>
            <select aria-label="How should AIOS handle this?" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">AIOS decides</option>
              {PICKABLE.filter((k) => projectId || (k !== "project_question" && k !== "build")).map((k) => <option key={k} value={k}>{KIND_SHORT[k]}</option>)}
            </select></label>
          <VoiceButton onBegin={() => { dictated.current = text.trim(); }} onText={(phrase) => setText(dictated.current ? `${dictated.current} ${phrase}` : phrase)} />
          <span className="grow" />
          <span className="ask-hint">Enter to send · Shift+Enter for a new line</span>
          <Btn type="submit" busy={busy} disabled={!connected || !prompt || (!!blocker && blocker.code === "claude_not_ready")} label="Send request">
            <Icon name="send" size={16} /><span>Go</span>
          </Btn>
        </div>
      </form>

      {!prompt && (
        <div className="ask-examples" role="group" aria-label="Examples">
          {example.map((x) => <button key={x.text} type="button" className="example" onClick={() => { setText(x.text); area.current?.focus(); }}>{x.text}</button>)}
        </div>)}

      {prompt.length >= 3 && (plan ? <PlanView kind={plan.kind} label={plan.label} reasons={plan.reasons} steps={plan.steps} confidence={plan.confidence} />
        : planning ? <p className="muted small plan-wait" aria-live="polite">Working out the steps…</p> : null)}

      {(blocker || err) && (
        <div className="note warn ask-block" role="alert">
          <strong>{blocker && !err ? "Before this can start" : "Could not start"}</strong>
          <p>{err?.message ?? blocker?.message}</p>
          <div className="row">
            {code === "needs_project" && <Btn kind="ghost" onClick={() => document.querySelector<HTMLSelectElement>('select[aria-label="Project"]')?.focus()}>Choose a project</Btn>}
            {(code === "needs_project" || code === "no_verify_command") && <Btn kind="ghost" busy={busy} onClick={() => void start("answer")}>Just answer in chat</Btn>}
            {code === "no_verify_command" && <Btn kind="ghost" onClick={() => go({ tab: "work" })}>Open the project</Btn>}
          </div>
        </div>)}
    </section>
  );
}
