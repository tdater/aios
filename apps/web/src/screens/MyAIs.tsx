import { useState } from "react";
import { ApiError } from "../core/client";
import { COMPANIONS } from "../core/companion";
import { ImportResult, SharingRow, ShareLevel } from "../core/types";
import { Companion } from "../ui/Companion";
import { LEVEL_TEXT } from "../core/universe";
import { useApp } from "../ui/Context";
import { go, useLoad } from "../ui/hooks";
import { Badge, Btn, Empty, ErrorBox, Loading, Notice } from "../ui/kit";
import { useTabTitle } from "../ui/useTabTitle";

type TabId = "knows" | "import" | "share" | "subs";
const TABS: [TabId, string][] = [["knows", "What AIOS knows"], ["import", "Bring in memories"], ["share", "What each AI may be told"], ["subs", "Gemini and Perplexity"]];
const TYPE_NAME: Record<string, string> = { preference: "Preferences", fact: "Facts about you and your life", decision: "Decisions", lesson: "Lessons learned", procedure: "Ways of doing things" };
const msg = (e: unknown) => (e instanceof ApiError ? e.message : (e as Error).message);

interface MemoryRow { id: string; title: string; type: string; status: string; sensitivity: string; version: number; tags: string[]; basis: string }
const origin = (m: MemoryRow) => (m.tags.includes("imported") ? "brought in from another AI" : m.tags.includes("captured") ? "noticed in your chat" : m.tags.includes("verified") ? "a check AIOS ran itself" : "you wrote it");

export function MyAIs({ section }: { section?: string }) {
  useTabTitle("My AIs");
  const tab: TabId = (TABS.find(([id]) => id === section)?.[0]) ?? "knows";
  return (
    <div className="screen">
      <h1>My AIs</h1>
      <p className="muted">Your AIs share one memory of you. Here you see it, correct it, add to it, and decide what each AI may be told.</p>
      <div className="tabs" role="tablist" aria-label="My AIs">
        {TABS.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={`tab ${tab === id ? "on" : ""}`} onClick={() => go({ tab: "ais", id })}>{label}</button>)}
      </div>
      {tab === "knows" && <Knows />}
      {tab === "import" && <Import />}
      {tab === "share" && <Share />}
      {tab === "subs" && <Subscriptions />}
    </div>
  );
}

// ------------------------------------------------------------------ what AIOS knows
function Knows() {
  const { client, connected } = useApp();
  const approved = useLoad(() => client.get<{ items: MemoryRow[] }>("/memories", { query: { status: "approved", limit: 200 } }), [client]);
  const suggested = useLoad(() => client.get<{ items: MemoryRow[] }>("/memories", { query: { status: "candidate", limit: 100 } }), [client]);
  const learn = useLoad(() => client.get<{ enabled: boolean }>("/learning"), [client]);
  const [err, setErr] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [type, setType] = useState("fact");
  const [confirmForget, setConfirmForget] = useState<string | null>(null);
  const refresh = () => Promise.all([approved.reload(), suggested.reload()]);
  const act = async (fn: () => Promise<unknown>) => { setErr(null); try { await fn(); await refresh(); } catch (e) { setErr(msg(e)); } };
  const decide = (m: MemoryRow, status: "approved" | "rejected") => act(() => client.patch(`/memories/${m.id}`, { status, expected_version: m.version }));
  const setVis = (m: MemoryRow, sensitivity: string) => act(() => client.patch(`/memories/${m.id}`, { sensitivity, expected_version: m.version }));
  const items = approved.data?.items ?? [], cands = suggested.data?.items ?? [];
  const groups = Object.keys(TYPE_NAME).map((t) => [t, items.filter((m) => m.type === t)] as const).filter(([, l]) => l.length);
  return (
    <div>
      <ErrorBox msg={err ?? approved.error} />
      <div className="card">
        <div className="row"><strong>Learning is {learn.data?.enabled === false ? "off" : "on"}</strong>
          <Btn kind="ghost" disabled={!connected || !learn.data} onClick={() => void act(async () => { await client.put("/learning", { enabled: !learn.data!.enabled }); await learn.reload(); })}>{learn.data?.enabled === false ? "Turn on" : "Turn off"}</Btn></div>
        <p className="muted small">When you say &ldquo;remember&hellip;&rdquo;, &ldquo;always&hellip;&rdquo; or &ldquo;never&hellip;&rdquo; in a chat, AIOS suggests a memory. It never uses one until you approve it, and it never learns from what an AI says.</p>
      </div>

      <div className="card">
        <h2>Waiting for your yes or no ({cands.length})</h2>
        {cands.length === 0 ? <Empty>Nothing is waiting. Suggestions from your chats, and memories you bring in, show up here.</Empty> : (
          <ul className="plain">{cands.map((m) => (
            <li key={m.id}><strong>{m.title}</strong> <span className="muted small">{TYPE_NAME[m.type] ?? m.type} · {origin(m)}</span>
              <div className="row"><Btn disabled={!connected} onClick={() => void decide(m, "approved")}>Yes, remember this</Btn><Btn kind="ghost" disabled={!connected} onClick={() => void decide(m, "rejected")}>No</Btn></div></li>))}</ul>)}
      </div>

      <div className="card">
        <h2>Add something yourself</h2>
        <label className="field"><span>What should every AI know?</span><input value={text} maxLength={200} onChange={(e) => setText(e.target.value)} placeholder="I like short answers with the conclusion first" /></label>
        <label className="field"><span>Kind</span><select value={type} onChange={(e) => setType(e.target.value)}>{Object.entries(TYPE_NAME).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <Btn disabled={!connected || !text.trim()} onClick={() => void act(async () => { await client.post("/memories", { scope: "global", type, title: text.trim(), body: text.trim(), status: "approved" }); setText(""); })}>Add it</Btn>
      </div>

      {approved.loading && !approved.data && <Loading />}
      {approved.data && groups.length === 0 && <Empty>AIOS does not know anything about you yet. Add something above, bring memories in from another AI, or just chat.</Empty>}
      {groups.map(([t, list]) => (
        <div className="card" key={t}>
          <h2>{TYPE_NAME[t]} ({list.length})</h2>
          <ul className="plain">{list.map((m) => (
            <li key={m.id}><strong>{m.title}</strong> <span className="muted small">{origin(m)}</span>
              <div className="row">
                <label className="field inline"><span className="sr">Who may be told: {m.title}</span>
                  <select aria-label={`Who may be told: ${m.title}`} value={m.sensitivity === "public" ? "public" : "private"} disabled={!connected} onChange={(e) => void setVis(m, e.target.value)}>
                    <option value="private">Private: only AIs you allow private memories</option><option value="public">Public: any AI that may be told public memories</option></select></label>
                {confirmForget === m.id
                  ? <><Btn kind="danger" disabled={!connected} onClick={() => { setConfirmForget(null); void act(() => client.post(`/memories/${m.id}/forget`, {})); }}>Yes, forget it</Btn><Btn kind="ghost" onClick={() => setConfirmForget(null)}>Keep it</Btn></>
                  : <Btn kind="ghost" disabled={!connected} onClick={() => setConfirmForget(m.id)}>Forget</Btn>}
              </div></li>))}</ul>
        </div>))}
    </div>
  );
}

// ------------------------------------------------------------------ bring in memories
const SOURCES: [string, string][] = [["chatgpt", "ChatGPT"], ["gemini", "Gemini"], ["claude", "Claude"], ["perplexity", "Perplexity"], ["other", "Another AI"]];

function Import() {
  const { client, connected } = useApp();
  const [source, setSource] = useState("chatgpt");
  const prompt = useLoad(() => client.get<{ prompt: string; name: string }>("/import/prompt", { query: { provider: source } }), [client, source]);
  const [text, setText] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const name = SOURCES.find(([k]) => k === source)![1];
  const copy = async () => { try { await navigator.clipboard.writeText(prompt.data?.prompt ?? ""); setCopied(true); } catch { setCopied(false); setErr("Could not copy automatically. Select the text and copy it."); } };
  const send = async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    try { setResult((await client.post<ImportResult>("/import/paste", { provider: source, text })).data); setText(""); } catch (e) { setErr(msg(e)); } finally { setBusy(false); }
  };
  return (
    <div>
      <Notice tone="info">Your other AIs already know things about you. Bring that over so you are not starting from scratch. Nothing you bring in is used until you approve it.</Notice>
      <div className="card">
        <h2>Option 1: ask the other AI to summarise you (works with any AI)</h2>
        <label className="field"><span>Which AI?</span><select value={source} onChange={(e) => { setSource(e.target.value); setCopied(false); setResult(null); }}>{SOURCES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <p><strong>Step 1.</strong> Copy this request and paste it into {name}, in its own app.</p>
        <label className="field"><span>Request to paste into {name}</span><textarea readOnly rows={7} value={prompt.data?.prompt ?? ""} /></label>
        <Btn kind="ghost" disabled={!prompt.data} onClick={() => void copy()}>{copied ? "Copied" : "Copy the request"}</Btn>
        <p><strong>Step 2.</strong> Copy {name}&apos;s answer and paste it here.</p>
        <ErrorBox msg={err} />
        <label className="field"><span>{name}&apos;s answer</span><textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} /></label>
        <Btn busy={busy} disabled={!connected || !text.trim()} onClick={() => void send()}>Add as suggestions</Btn>
        {result && (
          <div role="status">
            <Notice tone={result.created ? "info" : "warn"}>Added <strong>{result.created}</strong> suggestion{result.created === 1 ? "" : "s"} from {result.source}{result.duplicates ? `; ${result.duplicates} were already there` : ""}. <Btn kind="ghost" onClick={() => go({ tab: "ais", id: "knows" })}>Review them</Btn></Notice>
            {result.skipped.length > 0 && <details><summary>{result.skipped.length} line{result.skipped.length === 1 ? " was" : "s were"} left out</summary>
              <ul className="plain">{result.skipped.map((s, i) => <li key={i}><span className="muted small">{s.reason}:</span> {s.line}</li>)}</ul></details>}
          </div>)}
        <p className="muted small">AIOS leaves out anything that looks like a password or account number, and anything that reads like an instruction to an AI instead of a fact about you.</p>
      </div>
      <div className="card">
        <h2>Option 2: bring in saved chat history</h2>
        <p>Some apps let you export your chats as a file. AIOS can read exports from Claude and ChatGPT, and Claude Code logs.</p>
        <ol><li>Export your data from the app, if it offers that. If it does not, use Option 1.</li>
          <li>Save the file in the AIOS import folder. The <strong>AIOS import folder</strong> icon on your desktop opens it.</li>
          <li>Open <strong>Settings</strong> and find <strong>Imported history</strong>. AIOS reads the file, hides anything secret, and suggests memories for you to review.</li></ol>
        <Btn kind="ghost" onClick={() => go({ tab: "settings", id: "history" })}>Open Imported history</Btn>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ AIs you pay for yourself
function Subscriptions() {
  const [who, setWho] = useState("gemini");
  const name = COMPANIONS.find(([k]) => k === who)![1];
  return (
    <div>
      <Notice tone="info">Have a Gemini or Perplexity subscription? Use it from here, with prompts AIOS writes for you. It works when you have a question for them, or when Antigravity cannot be used. You do the copying and pasting; AIOS never contacts them or reads their windows.</Notice>
      <label className="field"><span>Which one?</span><select value={who} onChange={(e) => setWho(e.target.value)}>{COMPANIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      <Companion key={who} provider={who} name={name} />
    </div>
  );
}

// ------------------------------------------------------------------ what each AI may be told
function Share() {
  const { client, connected } = useApp();
  const rows = useLoad(() => client.get<{ items: SharingRow[] }>("/sharing"), [client]);
  const [err, setErr] = useState<string | null>(null);
  const [peek, setPeek] = useState<{ name: string; text: string; n: number } | null>(null);
  const set = async (p: string, level: ShareLevel) => { setErr(null); try { await client.put(`/sharing/${p}`, { level }); await rows.reload(); setPeek(null); } catch (e) { setErr(msg(e)); } };
  const look = async (r: SharingRow) => {
    setErr(null);
    try { const b = await client.get<{ text: string; items: unknown[] }>(`/briefing/${r.provider}`); setPeek({ name: r.name, text: b.text, n: b.items.length }); } catch (e) { setErr(msg(e)); }
  };
  return (
    <div>
      <p>Each AI only learns what you allow. AIs you reach by copy and paste start at <strong>public only</strong>, because what you paste leaves this computer. Claude, through your own sign-in, starts at <strong>public and private</strong>. Memories marked secret are never shared.</p>
      <ErrorBox msg={err ?? rows.error} />
      {rows.loading && !rows.data && <Loading />}
      <ul className="plain">{(rows.data?.items ?? []).map((r) => (
        <li className="card" key={r.provider}>
          <div className="row"><strong>{r.name}</strong><Badge s={r.level === "none" ? "pending" : "completed"} label={LEVEL_TEXT[r.level].short} /></div>
          <label className="field"><span>What {r.name} may be told</span>
            <select value={r.level} disabled={!connected} onChange={(e) => void set(r.provider, e.target.value as ShareLevel)}>
              <option value="private">Public and private memories</option><option value="public">Only memories I marked public</option><option value="none">Nothing</option></select></label>
          <p className="muted small">At this level it would be told {r.told_count} memor{r.told_count === 1 ? "y" : "ies"}.</p>
          <Btn kind="ghost" onClick={() => void look(r)}>Show exactly what {r.name} would be told</Btn>
        </li>))}</ul>
      {peek && <div className="card" role="region" aria-label={`What ${peek.name} would be told`}><h2>What {peek.name} would be told ({peek.n})</h2>{peek.n === 0 ? <Empty>Nothing at this level.</Empty> : <pre className="untrusted">{peek.text}</pre>}</div>}
    </div>
  );
}
