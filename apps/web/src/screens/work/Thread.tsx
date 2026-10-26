import { useEffect, useRef, useState } from "react";
import { ApiError, newKey } from "../../core/client";
import { ConvMessage } from "../../core/types";
import { useApp } from "../../ui/Context";
import { Badge, Btn, Collapsible, ErrorBox, Notice, ago, useOnce } from "../../ui/kit";

export type PanelId = "chat" | "activity" | "changes" | "tests" | "outcome" | "status";

const meta = <T,>(m: ConvMessage, key: string): T | undefined => (m.meta as Record<string, unknown> | null)?.[key] as T | undefined;

/** "claude-code 2.1.310 (claude-opus-5-5), independent reviewer" -> who + model, without hiding the original. */
export function whoIs(m: ConvMessage): { name: string; sub: string } {
  if (m.author_kind === "user") return { name: "You", sub: "" };
  if (m.author_kind === "aios") return { name: "AIOS", sub: m.kind === "status" ? "status" : `${m.kind} · computed by AIOS, not by the model` };
  const x = /^claude-code ([\d.]+) \((.+?)\)(, independent reviewer)?$/.exec(m.author);
  if (!x) return { name: m.author, sub: "" };
  return { name: x[3] ? "Claude (independent reviewer)" : "Claude", sub: `${x[2]} · Claude Code ${x[1]}` };
}

export function MessageView({ m, open }: { m: ConvMessage; open: (p: PanelId) => void }) {
  const who = whoIs(m);
  const lines = m.content.split("\n");
  return (
    <li className={`msg ${m.author_kind} ${m.kind}`} aria-label={`${who.name} at ${new Date(m.created_at).toLocaleTimeString()}`}>
      <div className="who" title={m.author}>
        <strong>{who.name}</strong>
        {who.sub && <span className="muted small"> · {who.sub}</span>}
        <span className="muted small grow-right">{ago(m.created_at)}</span>
      </div>
      {m.kind === "verification" ? (
        <>
          <div className="row"><Badge s={meta<boolean>(m, "passed") ? "completed" : "failed"} label={meta<boolean>(m, "passed") ? "tests passed" : "tests failed"} />
            <button className="link" onClick={() => open("tests")}>See the full result</button></div>
          <p className="msg-text">{lines[0]}</p>
        </>
      ) : m.kind === "patch" ? (
        <>
          <p className="msg-text">{lines.slice(0, 1).join("\n")}</p>
          {meta<boolean>(m, "changed") && <button className="link" onClick={() => open("changes")}>Review the change</button>}
        </>
      ) : m.kind === "review" ? (
        <>
          <p className="msg-text">{lines.slice(0, 2).join("\n")}</p>
          <button className="link" onClick={() => open("outcome")}>See the findings</button>
        </>
      ) : (
        <p className="msg-text">{m.content}</p>
      )}
    </li>
  );
}

export function MessageList({ messages, open }: { messages: ConvMessage[]; open: (p: PanelId) => void }) {
  const end = useRef<HTMLLIElement>(null);
  const last = messages[messages.length - 1]?.id;
  useEffect(() => { end.current?.scrollIntoView?.({ block: "nearest" }); }, [last]);
  if (!messages.length) return <p className="muted">Nothing here yet. Ask Claude something about this project below.</p>;
  return <ul className="thread" aria-label="Conversation">{messages.map((m) => <MessageView key={m.id} m={m} open={open} />)}<li ref={end} aria-hidden="true" /></ul>;
}

const ERR_HELP: Record<string, string> = {
  turn_in_progress: "Claude is still working on the previous message. Wait for it to finish, or cancel it in the Activity tab.",
  repo_not_ready: "",
  empty_message: "Write a message first.",
};

export type Busy = null | "working" | "approval" | "stopped";
const BUSY_TEXT: Record<Exclude<Busy, null>, string> = {
  working: "Claude is working. You can send the next message when it finishes.",
  approval: "This message is waiting for your approval to run the tests (see the Tests tab). You can send the next message after you decide.",
  stopped: "The last message stopped before it finished (see the Activity tab). Resume or cancel it before sending the next one.",
};

export function Composer({ conversationId, busy, onSent, seed }: { conversationId: string; busy: Busy; onSent: () => void; seed?: { text: string; mode: "read" | "edit"; n: number } | null }) {
  const { client, connected } = useApp();
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"read" | "edit">("read");
  const [err, setErr] = useState<string | null>(null);
  const [key, setKey] = useState(() => `msg-${newKey()}`);          // one key per attempt; a retry reuses it
  useEffect(() => { if (seed) { setText(seed.text); setMode(seed.mode); } }, [seed?.n]);   // eslint-disable-line react-hooks/exhaustive-deps
  const send = useOnce(async () => {
    setErr(null);
    try {
      await client.post(`/conversations/${conversationId}/messages`, { content: text, mode }, { idempotencyKey: key });
      setText(""); setKey(`msg-${newKey()}`); onSent();
    } catch (e) {
      if (e instanceof ApiError) setErr(ERR_HELP[e.code] || e.message);
      else setErr(`${(e as Error).message} The message may have arrived; check the conversation before sending it again.`);
    }
  });
  const can = connected && busy === null && text.trim().length > 0;
  return (
    <form className="composer card" onSubmit={(e) => { e.preventDefault(); if (can) void send.run(); }} aria-label="Message Claude">
      <ErrorBox msg={err} />
      <label className="field"><span>Your message</span>
        <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} disabled={busy !== null}
          placeholder={mode === "edit" ? "Describe the change you want…" : "Ask a question about this project…"}
          onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && can) { e.preventDefault(); void send.run(); } }} />
      </label>
      <div className="modepick" role="radiogroup" aria-label="What should Claude do">
        <label className={`mode ${mode === "read" ? "on" : ""}`}>
          <input type="radio" name="mode" checked={mode === "read"} onChange={() => setMode("read")} />
          <span><strong>Ask</strong><span className="muted small"> Claude reads your files and answers. Nothing changes.</span></span>
        </label>
        <label className={`mode ${mode === "edit" ? "on" : ""}`}>
          <input type="radio" name="mode" checked={mode === "edit"} onChange={() => setMode("edit")} />
          <span><strong>Make changes</strong><span className="muted small"> Claude edits a separate copy. You review it before anything touches your real files.</span></span>
        </label>
      </div>
      {busy && <Notice tone={busy === "working" ? "info" : "warn"}>{BUSY_TEXT[busy]}</Notice>}
      {!connected && <Notice tone="warn">You are offline, so messages cannot be sent.</Notice>}
      <Btn type="submit" busy={send.busy} disabled={!can}>{mode === "edit" ? "Send and make changes" : "Send"}</Btn>
      <span className="muted small"> Ctrl+Enter sends.</span>
    </form>
  );
}

export function ContextUsed({ items }: { items: { kind: string; ref: string; version: string | null }[] | undefined }) {
  if (!items?.length) return null;
  return (
    <Collapsible title="What AIOS told Claude for the latest message" count={items.length}>
      <ul className="plain small">{items.map((i, n) => <li key={n}><code>{i.kind}</code> {i.ref}{i.version ? ` (version ${i.version.slice(0, 12)})` : ""}</li>)}</ul>
      <p className="muted small">Only notes you approved are shared. Anything else Claude says comes from your files and its own knowledge.</p>
    </Collapsible>
  );
}
