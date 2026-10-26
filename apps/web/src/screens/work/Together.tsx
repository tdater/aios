import { useState } from "react";
import { ApiError, newKey } from "../../core/client";
import { ConversationView, ConvMessage } from "../../core/types";
import { ACTIVE_RUN_STATES } from "../../core/work";
import { useApp } from "../../ui/Context";
import { CompanionToggle } from "../../ui/Companion";
import { Btn, ErrorBox, Notice, Untrusted } from "../../ui/kit";

const MANUAL: [string, string][] = [["gemini", "Gemini"], ["perplexity", "Perplexity"], ["antigravity", "Antigravity"]];
type Meta = { handoff?: { provider?: string; step?: string } } | null;
const hand = (m: ConvMessage) => (m.meta as Meta)?.handoff;
const msg = (e: unknown) => (e instanceof ApiError ? e.message : (e as Error).message);

/** One question, several AIs, answers side by side. Claude answers for real; the others by copy and paste, marked unverified. */
export function Together({ v, reload }: { v: ConversationView; reload: () => Promise<void> }) {
  const { client, connected } = useApp();
  const claudeReady = v.status.provider.logged_in !== false;
  const busy = !!v.status.run && ACTIVE_RUN_STATES.has(v.status.run.state);
  const [question, setQuestion] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set(["claude", "gemini", "perplexity"]));
  const [asked, setAsked] = useState<{ q: string; at: string; ais: string[] } | null>(null);
  const [prompts, setPrompts] = useState<Record<string, string>>({});
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const usable = [...picked].filter((p) => p !== "claude" || claudeReady);          // an AI that cannot answer is never included
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const ask = async () => {
    if (working) return;
    setWorking(true); setErr(null);
    const q = question.trim(), ais = usable;
    const found: Record<string, string> = {}, problems: string[] = [];
    try {
      for (const p of ais.filter((x) => x !== "claude")) {
        try { found[p] = (await client.post<{ prompt: string }>(`/conversations/${v.conversation.id}/handoff`, { provider: p, question: q })).data.prompt; }
        catch (e) { problems.push(`${MANUAL.find(([k]) => k === p)?.[1] ?? p}: ${msg(e)}`); }
      }
      if (ais.includes("claude")) {
        try { await client.post(`/conversations/${v.conversation.id}/messages`, { content: q, mode: "read" }, { idempotencyKey: `tog-${newKey()}` }); }
        catch (e) { problems.push(`Claude: ${msg(e)}`); }
      }
      setPrompts(found); setReplies({}); setAsked({ q, at: new Date(Date.now() - 2000).toISOString(), ais });
      if (problems.length) setErr(problems.join(" · "));
      setQuestion("");
      await reload();
    } finally { setWorking(false); }
  };
  const saveReply = async (p: string) => {
    setErr(null);
    try { await client.post(`/conversations/${v.conversation.id}/handoff/reply`, { provider: p, reply: replies[p] }); setReplies((r) => ({ ...r, [p]: "" })); await reload(); } catch (e) { setErr(msg(e)); }
  };
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); } catch { setErr("Could not copy automatically. Select the text and copy it."); } };
  const answerFor = (p: string): ConvMessage | undefined => {
    if (!asked) return undefined;
    const after = v.messages.filter((m) => m.created_at >= asked.at);
    return p === "claude"
      ? [...after].reverse().find((m) => m.author_kind === "provider" && !hand(m))
      : [...after].reverse().find((m) => hand(m)?.step === "reply" && hand(m)?.provider === p);
  };

  return (
    <div>
      <p className="muted small">Ask one question and see what each AI says side by side. Claude answers directly. The others work by copy and paste, because AIOS never contacts them: you paste the question into their app and bring the answer back.</p>
      <ErrorBox msg={err} />
      <div className="card">
        <fieldset className="field"><legend>Ask which AIs?</legend>
          <label className="check"><input type="checkbox" checked={picked.has("claude")} disabled={!claudeReady} onChange={() => toggle("claude")} /> Claude {claudeReady ? "(answers here)" : "(not signed in)"}</label>
          {MANUAL.map(([k, l]) => <label key={k} className="check"><input type="checkbox" checked={picked.has(k)} onChange={() => toggle(k)} /> {l} (copy and paste)</label>)}
        </fieldset>
        <label className="field"><span>Your question</span><textarea rows={3} value={question} onChange={(e) => setQuestion(e.target.value)} /></label>
        <Btn busy={working} disabled={!connected || !question.trim() || usable.length === 0 || (usable.includes("claude") && busy)} onClick={() => void ask()}>Ask together</Btn>
        {usable.includes("claude") && busy && <p className="muted small">Claude is still working on something. Wait for it to finish first.</p>}
      </div>

      {asked && (
        <section aria-label="Answers" className="together">
          <h2>Answers to &ldquo;{asked.q.length > 80 ? asked.q.slice(0, 77) + "…" : asked.q}&rdquo;</h2>
          <div className="together-grid">
            {asked.ais.map((p) => {
              const name = p === "claude" ? "Claude" : MANUAL.find(([k]) => k === p)![1], a = answerFor(p);
              return (
                <article key={p} className="card" aria-label={`${name}'s answer`}>
                  <h3>{name}</h3>
                  {a ? <><Untrusted text={a.content} max={6000} />{p !== "claude" && <p className="muted small">Pasted by you. AIOS did not run or check this.</p>}</>
                    : p === "claude" ? <p className="muted">{busy ? "Claude is working…" : "No answer yet."}</p>
                    : (
                      <div>
                        <label className="field"><span>Paste this into {name}</span><textarea rows={4} readOnly value={prompts[p] ?? ""} /></label>
                        <Btn kind="ghost" disabled={!prompts[p]} onClick={() => void copy(prompts[p])}>Copy</Btn>
                        <label className="field"><span>{name}&apos;s answer</span><textarea rows={4} value={replies[p] ?? ""} onChange={(e) => setReplies((r) => ({ ...r, [p]: e.target.value }))} /></label>
                        <Btn disabled={!connected || !(replies[p] ?? "").trim()} onClick={() => void saveReply(p)}>{`Save ${name}'s answer`}</Btn>
                        <CompanionToggle provider={p} name={name} conversationId={v.conversation.id} />
                      </div>)}
                </article>);
            })}
          </div>
          <Notice tone="info">Every answer is kept in this conversation, labelled with who wrote it. Only things you say yourself are ever suggested as memories, never what an AI says.</Notice>
        </section>)}
    </div>
  );
}
