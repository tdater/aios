import { useState } from "react";
import { ApiError } from "../../core/client";
import { useApp } from "../../ui/Context";
import { go, useLoad } from "../../ui/hooks";
import { Badge, Btn, Empty, ErrorBox, Loading, Notice, ago } from "../../ui/kit";

interface Totals { discovered: number; parsed: number; quarantined: number; duplicate: number; unsupported: number; failed: number; deleted: number }
interface Summary { totals: Totals; approved_dir: string; last_review: { id: string; status: string; started_at: string; finished_at: string | null } | null; candidate_counts: Record<string, number>; note: string }
interface Source { id: string; rel_path: string; kind: string; provider: string | null; imported_at: string; status: string; status_detail: string; message_count: number; date_start: string | null; date_end: string | null; secret_kinds: string[] }
interface ReviewResult { id: string; status: string; analysis?: unknown; totals?: Totals }
interface Removal { candidates_recomputed: number; orphaned: string[]; memories_needing_review: unknown[]; file_removed: boolean; backup_note: string }

const STATUS_TONE: Record<string, string> = { parsed: "approved", quarantined: "pending", duplicate: "info", unsupported: "info", failed: "rejected", deleted: "info" };
const REVIEW_TEXT: Record<string, string> = { succeeded: "Review finished.", no_change: "Nothing new to review.", limit_reached: "Review stopped at its limit; run it again to continue.", failed: "Review failed." };

/** What AIOS has (and has not) read from your approved history folder, with review and per-source removal. */
export function HistorySection() {
  const { client, connected } = useApp();
  const summary = useLoad(() => client.get<Summary>("/history/summary"), [client]);
  const sources = useLoad(() => client.get<{ items: Source[] }>("/history/sources", { query: { limit: 200 } }).then((r) => r.items), [client]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [removal, setRemoval] = useState<{ title: string; r: Removal } | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; deleteFile: boolean } | null>(null);

  const reload = () => { summary.reload(); sources.reload(); };
  const review = async () => {
    if (busy) return;
    setBusy(true); setErr(null); setResult(null);
    try {
      const r = (await client.post<ReviewResult>("/history/review-new", {})).data;
      setResult(REVIEW_TEXT[r.status] ?? `Review ${r.status}.`);
      reload();
    } catch (e) { setErr(e instanceof ApiError && e.code === "conflict" ? "A review is already running." : e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const remove = async (s: Source, deleteFile: boolean) => {
    if (busy) return;
    setBusy(true); setErr(null); setRemoval(null);
    try {
      const r = (await client.post<Removal>(`/history/sources/${encodeURIComponent(s.id)}/delete${deleteFile ? "?delete_file=true" : ""}`, {})).data;
      setRemoval({ title: s.rel_path, r }); setConfirm(null); reload();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const t = summary.data?.totals;
  const live = (sources.data ?? []).filter((s) => s.status !== "deleted");
  return (
    <section className="card" id="history" aria-labelledby="history-h">
      <h3 id="history-h" style={{ marginTop: 0 }}>Imported history</h3>
      <p className="muted small">AIOS only reads files you place in its approved folder. It never scans your other folders or logs in anywhere, and imported text is treated as data, never as instructions.</p>
      {summary.data && (
        <p className="small">Approved folder: <code>{summary.data.approved_dir}</code></p>
      )}
      {summary.error && !summary.data ? <ErrorBox msg={summary.error} code={summary.errorCode} /> : !summary.data ? <Loading what="Loading history status" /> : (
        <>
          <p className="small">
            {t!.discovered} file{t!.discovered === 1 ? "" : "s"} seen · {t!.parsed} read · {t!.quarantined} held back for secrets · {t!.duplicate} duplicate · {t!.unsupported} unsupported · {t!.failed} failed
            {summary.data.last_review ? ` · last review ${ago(summary.data.last_review.finished_at ?? summary.data.last_review.started_at)} (${summary.data.last_review.status.replace(/_/g, " ")})` : " · never reviewed"}
          </p>
          <div className="row" style={{ justifyContent: "flex-start" }}>
            <Btn busy={busy} disabled={!connected} onClick={() => void review()}>Review new sessions</Btn>
            <Btn kind="ghost" onClick={() => go({ tab: "inbox" })}>Open proposals{summary.data.candidate_counts.candidate ? ` (${summary.data.candidate_counts.candidate})` : ""}</Btn>
          </div>
          {!connected && <p className="muted small">Reviewing needs a connection.</p>}
          {result && <Notice tone={result.startsWith("Review failed") ? "bad" : "ok"}>{result}</Notice>}
        </>
      )}
      {err && <ErrorBox msg={err} />}
      {removal && (
        <Notice tone="info">
          Removed <code>{removal.title}</code>: {removal.r.candidates_recomputed} proposal{removal.r.candidates_recomputed === 1 ? "" : "s"} re-checked
          {removal.r.orphaned.length ? `, ${removal.r.orphaned.length} left without evidence` : ""}
          {removal.r.memories_needing_review.length ? `, ${removal.r.memories_needing_review.length} note${removal.r.memories_needing_review.length === 1 ? "" : "s"} need another look` : ""}
          {removal.r.file_removed ? ", file deleted from the approved folder" : ""}. {removal.r.backup_note}
        </Notice>
      )}

      <h3>Sources</h3>
      {sources.error && !sources.data ? <ErrorBox msg={sources.error} code={sources.errorCode} /> : !sources.data ? <Loading what="Loading sources" />
        : live.length === 0 ? <Empty>Nothing imported yet. Copy the sessions you want reviewed into the approved folder above (see the helper below), then press “Review new sessions”.</Empty> : (
          <ul className="cards">
            {live.map((s) => (
              <li key={s.id}>
                <div className="card-static">
                  <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                    <strong style={{ overflowWrap: "anywhere" }}>{s.rel_path}</strong>
                    <Badge s={STATUS_TONE[s.status] ?? "info"} label={s.status} />
                  </div>
                  <div className="muted small">
                    {s.provider ?? s.kind} · {s.message_count} message{s.message_count === 1 ? "" : "s"}
                    {s.date_start ? ` · ${s.date_start.slice(0, 10)}${s.date_end && s.date_end.slice(0, 10) !== s.date_start.slice(0, 10) ? ` to ${s.date_end.slice(0, 10)}` : ""}` : ""} · imported {ago(s.imported_at)}
                  </div>
                  {s.secret_kinds.length > 0 && <p className="small" style={{ margin: "4px 0" }}>Possible secrets found (kinds only, never shown): {s.secret_kinds.join(", ")}</p>}
                  {s.status_detail && s.status !== "parsed" && <p className="muted small" style={{ margin: "4px 0" }}>{s.status_detail}</p>}
                  {confirm?.id === s.id ? (
                    <Notice tone="bad">
                      Remove this source from AIOS? Its extracted messages are deleted and proposals that relied on it are re-checked.
                      <label className="check"><input type="checkbox" checked={confirm.deleteFile} onChange={(e) => setConfirm({ id: s.id, deleteFile: e.target.checked })} /> Also delete the copied file from the approved folder</label>
                      <div className="row" style={{ marginTop: 8 }}>
                        <Btn kind="danger" busy={busy} disabled={!connected} onClick={() => void remove(s, confirm.deleteFile)}>Yes, remove</Btn>
                        <Btn kind="ghost" onClick={() => setConfirm(null)}>Keep</Btn>
                      </div>
                    </Notice>
                  ) : <Btn kind="ghost" disabled={!connected} onClick={() => setConfirm({ id: s.id, deleteFile: false })}>Remove…</Btn>}
                </div>
              </li>
            ))}
          </ul>
        )}

      <h3>Choosing which sessions to import</h3>
      <p className="small">You decide, by copying files into the approved folder. For Claude Code sessions, the helper below lists your projects (names and counts only) and copies the newest sessions of one project you pick:</p>
      <pre className="codeblock" tabIndex={0}>{`.venv\\Scripts\\python.exe scripts\\stage_claude_sessions.py --list\n.venv\\Scripts\\python.exe scripts\\stage_claude_sessions.py --project <name> --limit 5`}</pre>
      <p className="muted small">Sessions can contain secrets. AIOS redacts what it recognises and holds those files back, but start small and check the results here before adding more.</p>
    </section>
  );
}
