import { useState } from "react";
import { useApp } from "../../ui/Context";
import { go, useLoad } from "../../ui/hooks";
import { Btn, Empty, ErrorBox, Loading, Notice } from "../../ui/kit";
import { knowledgeQuery } from "../../ui/uiState";

interface Published { items: { id: string; slug: string; title: string; type: string; tags: string[] }[]; skipped: { id: string; title: string; reason: string }[]; rule: string }

/** Preview of what a website export would contain. Nothing here uploads anything. */
export function PublishSection() {
  const { client, connected } = useApp();
  const pub = useLoad(() => client.get<Published>("/published"), [client]);
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ count: number; path: string; skipped: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const write = async () => {
    if (busy) return;
    setBusy(true); setErr(null); setDone(null);
    try { setDone((await client.post<{ count: number; path: string; skipped: number }>("/published/export", {})).data); setAsk(false); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return (
    <section className="card" id="publish" aria-labelledby="publish-h">
      <h3 id="publish-h" style={{ marginTop: 0 }}>Publishing</h3>
      <p className="muted small">Only notes you tag <code>#publish</code> <em>and</em> approve are ever exported. Links to unpublished notes are flattened to plain text, and a note that looks like it contains a secret is held back. Nothing is uploaded or deployed.</p>
      <div className="row" style={{ justifyContent: "flex-start" }}>
        <Btn kind="ghost" onClick={() => { knowledgeQuery.set("#publish"); go({ tab: "knowledge" }); }}>Show notes tagged publish</Btn>
        <Btn kind="ghost" disabled={!connected} onClick={pub.reload}>Refresh preview</Btn>
      </div>
      {pub.error && !pub.data ? <ErrorBox msg={pub.error} code={pub.errorCode} /> : !pub.data ? <Loading what="Loading preview" /> : (
        <>
          {pub.data.items.length === 0 ? <Empty>No notes would be exported right now.</Empty> : (
            <ul className="cards" aria-label="Notes that would be exported">
              {pub.data.items.map((n) => (
                <li key={n.id}><div className="card-static row" style={{ justifyContent: "space-between" }}>
                  <span><strong>{n.title}</strong> <span className="muted small">{n.slug}.md · {n.type}{n.tags.length ? ` · ${n.tags.map((t) => `#${t}`).join(" ")}` : ""}</span></span>
                  <Btn kind="ghost" onClick={() => go({ tab: "knowledge", id: n.id })}>Open</Btn>
                </div></li>
              ))}
            </ul>
          )}
          {pub.data.skipped.length > 0 && (
            <>
              <h3>Held back</h3>
              <ul className="linklist">{pub.data.skipped.map((s) => <li key={s.id}>{s.title === "(withheld)" ? "A note" : s.title}: <span className="muted">{s.reason}</span></li>)}</ul>
            </>
          )}
        </>
      )}
      {err && <ErrorBox msg={err} />}
      {done && <Notice tone="ok">Wrote {done.count} note{done.count === 1 ? "" : "s"} to <code>{done.path}</code>{done.skipped ? ` (${done.skipped} held back)` : ""}. Nothing was uploaded or deployed.</Notice>}
      {ask ? (
        <Notice tone="warn">
          Write {pub.data?.items.length ?? 0} note{pub.data?.items.length === 1 ? "" : "s"} as files into AIOS&rsquo;s private export folder? Files from an earlier export that are no longer published are removed from that folder.
          <div className="row" style={{ marginTop: 8 }}>
            <Btn busy={busy} disabled={!connected} onClick={() => void write()}>Yes, write files</Btn>
            <Btn kind="ghost" onClick={() => setAsk(false)}>Cancel</Btn>
          </div>
        </Notice>
      ) : <div className="row" style={{ justifyContent: "flex-start" }}><Btn disabled={!connected || !pub.data || pub.data.items.length === 0} onClick={() => setAsk(true)}>Write export files…</Btn></div>}
      <p className="small">The same export from a terminal, to any folder outside the repository:</p>
      <pre className="codeblock" tabIndex={0}>{`.venv\\Scripts\\python.exe scripts\\export_published.py`}</pre>
    </section>
  );
}
