import { useState } from "react";
import { ApiError } from "../core/client";
import { CompanionInfo, COMPANION_SITES, openCompanion } from "../core/companion";
import { useApp } from "./Context";
import { useLoad } from "./hooks";
import { Btn, Empty, ErrorBox, Loading, Notice } from "./kit";

const msg = (e: unknown) => (e instanceof ApiError ? e.message : (e as Error).message);

/** Shows the companion panel only after asking for it, so nothing is fetched for people who never use it. */
export function CompanionToggle({ provider, name, conversationId }: { provider: string; name: string; conversationId?: string }) {
  const [open, setOpen] = useState(false);
  if (!COMPANION_SITES[provider]) return null;
  return open ? <Companion provider={provider} name={name} conversationId={conversationId} nested /> : <Btn kind="ghost" onClick={() => setOpen(true)}>{`Use my ${name} subscription`}</Btn>;
}

/** Use a subscription AI you already pay for: open its own site in a window and copy prompts AIOS wrote for you.
 *  AIOS cannot see that window. Nothing leaves this computer until you paste it there yourself. */
export function Companion({ provider, name, conversationId, nested }: { provider: string; name: string; conversationId?: string; nested?: boolean }) {
  const Heading = nested ? "h4" : "h2";
  const { client, connected } = useApp();
  const info = useLoad(() => client.get<CompanionInfo>(`/companion/${provider}`, { query: conversationId ? { conversation_id: conversationId } : {} }), [client, provider, conversationId]);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (id: string, prompt: string) => {
    setErr(null);
    try { await navigator.clipboard.writeText(prompt); } catch { setErr("Could not copy automatically. Select the text and copy it."); return; }
    setCopied(id);
    try { await client.post(`/companion/${provider}/copied`, { suggestion_id: id, conversation_id: conversationId }); } catch (e) { setErr(msg(e)); }
  };
  return (
    <section className="card" aria-label={`Use ${name} with your own subscription`}>
      <Heading>Use your {name} subscription</Heading>
      <p className="muted small">{info.data?.blurb ?? `Use ${name} with the account you already pay for.`} AIOS opens {name}&apos;s own site in a separate window. You sign in there yourself, and AIOS never sees that window or your login.</p>
      <Btn kind="ghost" disabled={!COMPANION_SITES[provider]} onClick={() => openCompanion(provider)}>{`Open ${name} in a new window`}</Btn>
      <ErrorBox msg={err ?? info.error} />
      {info.loading && !info.data && <Loading />}
      {info.data && (
        <>
          <Notice tone="info">{info.data.notice}</Notice>
          {info.data.items.length === 0 ? <Empty>No suggested prompts yet. Open a conversation with some work in it, or approve a memory you are happy to share with {name}.</Empty> : (
            <ul className="plain">{info.data.items.map((i) => (
              <li key={i.id}>
                <strong>{i.title}</strong> <span className="muted small">{i.chars} characters</span>
                <p className="muted small">{i.why}</p>
                <label className="field"><span className="sr">Prompt: {i.title}</span><textarea readOnly rows={5} aria-label={`Prompt: ${i.title}`} value={i.prompt} /></label>
                <Btn kind="ghost" disabled={!connected} onClick={() => void copy(i.id, i.prompt)}>{copied === i.id ? "Copied" : "Copy this prompt"}</Btn>
              </li>))}</ul>)}
        </>)}
    </section>
  );
}
