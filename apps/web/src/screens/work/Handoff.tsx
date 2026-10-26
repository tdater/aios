import { useState } from "react";
import { ApiError } from "../../core/client";
import { useApp } from "../../ui/Context";
import { Btn, Collapsible, ErrorBox, Notice, useOnce } from "../../ui/kit";

const AIS: [string, string][] = [["gemini", "Gemini"], ["perplexity", "Perplexity"], ["antigravity", "Antigravity"]];

/** Other AIs by copy and paste. AIOS never contacts them: it writes the prompt and files the pasted answer, labelled unverified. */
export function Handoff({ conversationId, onChanged }: { conversationId: string; onChanged: () => void }) {
  const { client, connected } = useApp();
  const [ai, setAi] = useState("gemini");
  const [q, setQ] = useState("");
  const [prompt, setPrompt] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const label = AIS.find(([k]) => k === ai)![1];
  const fail = (e: unknown) => setErr(e instanceof ApiError ? e.message : (e as Error).message);
  const make = useOnce(async () => {
    setErr(null); setDone(null);
    try { const r = await client.post<{ prompt: string }>(`/conversations/${conversationId}/handoff`, { provider: ai, question: q }); setPrompt(r.data.prompt); onChanged(); } catch (e) { fail(e); }
  });
  const save = useOnce(async () => {
    setErr(null);
    try { await client.post(`/conversations/${conversationId}/handoff/reply`, { provider: ai, reply }); setReply(""); setPrompt(null); setQ(""); setDone(`${label}'s answer was added to this conversation.`); onChanged(); } catch (e) { fail(e); }
  });
  const copy = async () => { try { await navigator.clipboard.writeText(prompt ?? ""); setDone("Copied."); } catch { setDone("Could not copy automatically. Select the text and copy it."); } };
  return (
    <Collapsible title="Ask another AI (copy and paste)">
      <p className="muted small">AIOS does not connect to {label}. It writes a prompt you paste into {label}'s own app, then keeps the answer here, marked as not checked by AIOS.</p>
      <ErrorBox msg={err} />
      {done && <Notice tone="info">{done}</Notice>}
      <label className="field"><span>Which AI</span>
        <select value={ai} onChange={(e) => { setAi(e.target.value); setPrompt(null); }}>{AIS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      <label className="field"><span>Your question</span><textarea rows={3} value={q} onChange={(e) => setQ(e.target.value)} /></label>
      <Btn busy={make.busy} disabled={!connected || !q.trim()} onClick={() => void make.run()}>Write the prompt</Btn>
      {prompt && (
        <>
          <label className="field"><span>Prompt to paste into {label}</span><textarea rows={6} readOnly value={prompt} /></label>
          <Btn kind="ghost" onClick={() => void copy()}>Copy prompt</Btn>
          <label className="field"><span>Paste {label}'s answer here</span><textarea rows={5} value={reply} onChange={(e) => setReply(e.target.value)} /></label>
          <Btn busy={save.busy} disabled={!connected || !reply.trim()} onClick={() => void save.run()}>Save the answer</Btn>
        </>)}
    </Collapsible>
  );
}
