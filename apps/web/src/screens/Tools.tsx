import { useState } from "react";
import { ApiError, newKey } from "../core/client";
import { AssistView } from "../core/assist";
import { MAX_DOC, Found, squeezeLocally, squeezePrompt } from "../core/document";
import { ScamResult, checkMessage } from "../core/scam";
import { useApp } from "../ui/Context";
import { go } from "../ui/hooks";
import { Btn, ErrorBox, Notice } from "../ui/kit";
import { VoiceButton } from "../ui/VoiceButton";

const msg = (e: unknown) => (e instanceof ApiError ? e.message : (e as Error).message);

/** Two everyday helpers: a second opinion on a suspicious message, and a plain-words look at a confusing document. */
export function Tools() {
  return (
    <div className="screen">
      <h2>Check a message or document</h2>
      <p className="muted">Two helpers for the things that make people uneasy. The first works only on this computer. The second starts on this computer too, and only goes further if you ask.</p>
      <ScamCheck />
      <DocumentSqueezer />
    </div>
  );
}

function ScamCheck() {
  const [text, setText] = useState("");
  const [res, setRes] = useState<ScamResult | null>(null);
  return (
    <section className="card" aria-label="Is this a scam?">
      <h3>Is this a scam?</h3>
      <p className="muted small">Paste a text, email or voicemail transcript. AIOS looks for the habits scams share, right here on this computer. Nothing is sent anywhere.</p>
      <label className="field"><span>The message</span><textarea rows={5} value={text} maxLength={6000} onChange={(e) => { setText(e.target.value); setRes(null); }} /></label>
      <Btn disabled={!text.trim()} onClick={() => setRes(checkMessage(text))}>Check this message</Btn>
      {res && (
        <div role="status" className="scam-result">
          <Notice tone={res.verdict === "scam" ? "bad" : res.verdict === "none" ? "info" : "warn"}><strong>{res.headline}</strong></Notice>
          {res.signals.length > 0 && <><h4>What stood out</h4><ul>{res.signals.map((s) => <li key={s.id}>{s.label}</li>)}</ul></>}
          <h4>What to do</h4>
          <ul>{res.steps.map((s) => <li key={s}>{s}</li>)}</ul>
          <p className="muted small">This is a second opinion from fixed rules, not a guarantee. When in doubt, check with the company through an official website or phone number you already trust.</p>
        </div>)}
    </section>
  );
}

function FoundList({ title, items }: { title: string; items: Found[] }) {
  if (!items.length) return null;
  return (
    <>
      <h4>{title}</h4>
      <ul>{items.map((f, i) => <li key={`${f.text}-${i}`}><strong>{f.text}</strong> <span className="muted small">{f.context}</span></li>)}</ul>
    </>
  );
}

function DocumentSqueezer() {
  const { client, connected } = useApp();
  const [text, setText] = useState("");
  const [found, setFound] = useState<ReturnType<typeof squeezeLocally> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ask = async () => {
    if (busy || !text.trim()) return;
    setBusy(true); setErr(null);
    try {
      const r = await client.post<AssistView>("/assist", { prompt: squeezePrompt(text), kind: "answer" }, { idempotencyKey: `squeeze-${newKey()}` });
      go({ tab: "home", id: r.data.id });
    } catch (e) { setErr(msg(e)); } finally { setBusy(false); }
  };
  return (
    <section className="card" aria-label="Make a document simple">
      <h3>Make a confusing document simple</h3>
      <p className="muted small">Paste a lease, bill, insurance letter or medical statement. Step 1 finds the dates, amounts and tricky clauses on this computer. Step 2 is optional: Claude explains it in plain words.</p>
      <label className="field"><span>The document text</span><textarea rows={8} value={text} maxLength={30000} onChange={(e) => { setText(e.target.value); setFound(null); }} /></label>
      <div className="row">
        <Btn disabled={!text.trim()} onClick={() => setFound(squeezeLocally(text))}>Find dates, amounts and clauses</Btn>
        <VoiceButton label="Dictate the document" onText={setText} />
      </div>
      {found && (
        <div role="status">
          {found.dates.length + found.amounts.length + found.gotchas.length === 0 ? <p>Nothing obvious found. Claude can still read it for you below.</p> : (
            <><FoundList title="Dates and deadlines" items={found.dates} /><FoundList title="Money and rates" items={found.amounts} /><FoundList title="Clauses worth a second look" items={found.gotchas} /></>)}
          <h4>Want it in plain words?</h4>
          <Notice tone="info">This sends the first {MAX_DOC.toLocaleString()} characters of what you pasted to Claude, through your own Claude subscription, the same way a question in the Ask box does. Leave out anything you are not comfortable sharing, such as account numbers.</Notice>
          <ErrorBox msg={err} />
          <Btn busy={busy} disabled={!connected} onClick={() => void ask()}>Explain it in plain words with Claude</Btn>
        </div>)}
    </section>
  );
}
