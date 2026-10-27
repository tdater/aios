import { useState } from "react";
import { ApiError, newKey } from "../core/client";
import { AssistView } from "../core/assist";
import { MAX_DOC, Found, squeezeLocally, squeezePrompt } from "../core/document";
import { COMPANIONS, openCompanion } from "../core/companion";
import { Criterion, Matrix, Option, clampScore, decide, reviewPrompt } from "../core/decision";
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
      <h2>Check a message, a document, or a decision</h2>
      <p className="muted">Two helpers for the things that make people uneasy. The first works only on this computer. The second starts on this computer too, and only goes further if you ask.</p>
      <ScamCheck />
      <DocumentSqueezer />
      <DecisionHelper />
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

const nextId = (l: { id: number }[]) => l.reduce((n, x) => Math.max(n, x.id), 0) + 1;

/** A side-by-side comparison for big choices. You say what matters and how each option does; AIOS adds it up here and says plainly when it is close. */
function DecisionHelper() {
  const { client, connected } = useApp();
  const [question, setQuestion] = useState("");
  const [criteria, setCriteria] = useState<Criterion[]>([{ id: 1, name: "Cost", weight: 4 }, { id: 2, name: "", weight: 3 }]);
  const [options, setOptions] = useState<Option[]>([{ id: 1, name: "", scores: {} }, { id: 2, name: "", scores: {} }]);
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const matrix: Matrix = { question, criteria: criteria.filter((c) => c.name.trim()), options: options.filter((o) => o.name.trim()) };
  const out = shown ? decide(matrix) : null;
  const setCrit = (id: number, patch: Partial<Criterion>) => { setShown(false); setCriteria((l) => l.map((c) => (c.id === id ? { ...c, ...patch } : c))); };
  const setOpt = (id: number, patch: Partial<Option>) => { setShown(false); setOptions((l) => l.map((o) => (o.id === id ? { ...o, ...patch } : o))); };
  const setScore = (oid: number, cid: number, v: number) => setOpt(oid, { scores: { ...(options.find((o) => o.id === oid)?.scores ?? {}), [cid]: clampScore(v) } });

  const askClaude = async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await client.post<AssistView>("/assist", { prompt: reviewPrompt(matrix), kind: "answer" }, { idempotencyKey: `decide-${newKey()}` });
      go({ tab: "home", id: r.data.id });
    } catch (e) { setErr(msg(e)); } finally { setBusy(false); }
  };
  const relay = async (provider: string, name: string) => {
    setErr(null); setNote(null);
    try { await navigator.clipboard.writeText(reviewPrompt(matrix)); } catch { setErr("Could not copy automatically."); return; }
    openCompanion(provider);
    setNote(`Copied. Paste it into ${name} in the window that opened.`);
  };

  return (
    <section className="card" aria-label="Help me decide">
      <h3>Help me decide</h3>
      <p className="muted small">For a big choice like lease or buy, or which plan to pick. Say what matters and how each option does, 1 to 5. AIOS adds it up here on this computer. A second opinion is optional.</p>
      <label className="field"><span>What are you deciding?</span><input value={question} maxLength={200} onChange={(e) => { setQuestion(e.target.value); setShown(false); }} placeholder="Lease or buy my next car?" /></label>
      <h4>What matters (1 = a little, 5 = a lot)</h4>
      {criteria.map((c, i) => (
        <div key={c.id} className="row">
          <input aria-label={`What matters ${i + 1}`} value={c.name} maxLength={40} onChange={(e) => setCrit(c.id, { name: e.target.value })} placeholder="Something that matters" />
          <select aria-label={`Importance of ${c.name || `thing ${i + 1}`}`} value={c.weight} onChange={(e) => setCrit(c.id, { weight: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select>
        </div>))}
      {criteria.length < 6 && <Btn kind="ghost" onClick={() => setCriteria((l) => [...l, { id: nextId(l), name: "", weight: 3 }])}>Add something that matters</Btn>}
      <h4>The options and how each does (5 is best)</h4>
      {options.map((o, i) => (
        <fieldset key={o.id} className="field">
          <legend><input aria-label={`Option ${i + 1} name`} value={o.name} maxLength={40} onChange={(e) => setOpt(o.id, { name: e.target.value })} placeholder={`Option ${i + 1}`} /></legend>
          {criteria.filter((c) => c.name.trim()).map((c) => (
            <label key={c.id} className="row"><span>{c.name}</span>
              <select aria-label={`${o.name || `Option ${i + 1}`} on ${c.name}`} value={o.scores[c.id] ?? 3} onChange={(e) => setScore(o.id, c.id, Number(e.target.value))}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>))}
        </fieldset>))}
      {options.length < 4 && <Btn kind="ghost" onClick={() => setOptions((l) => [...l, { id: nextId(l), name: "", scores: {} }])}>Add an option</Btn>}
      <div><Btn onClick={() => setShown(true)}>Compare</Btn></div>
      {out && (
        <div className="decision-result" aria-label="Comparison">
          <Notice tone={out.verdict === "clear" ? "info" : "warn"}><strong>{out.headline}</strong></Notice>
          {out.ranked.length > 0 && (
            <table>
              <thead><tr><th>Option</th><th>Score</th></tr></thead>
              <tbody>{out.ranked.map((r) => <tr key={r.option.id}><td>{r.option.name}</td><td>{r.total} ({r.percent}%)</td></tr>)}</tbody>
            </table>)}
          {out.flips.length > 0 && <><h4>What could change the answer</h4><ul>{out.flips.map((f) => <li key={f}>{f}</li>)}</ul></>}
          {out.verdict !== "none" && (
            <>
              <h4>Want a second opinion?</h4>
              <p className="muted small">It argues against the front-runner and asks what you missed. Claude uses your own subscription. For Gemini or Perplexity, AIOS copies the question and opens their site; you paste it yourself.</p>
              <ErrorBox msg={err} />
              {note && <p role="status">{note}</p>}
              <div className="row">
                <Btn busy={busy} disabled={!connected} onClick={() => void askClaude()}>Ask Claude</Btn>
                {COMPANIONS.map(([k, name]) => <Btn key={k} kind="ghost" onClick={() => void relay(k, name)}>{`Copy for ${name}`}</Btn>)}
              </div>
            </>)}
          <p className="muted small">This is arithmetic on your own numbers, not advice. It cannot know what you did not tell it.</p>
        </div>)}
    </section>
  );
}
