import { useState } from "react";
import { ApiError } from "../../core/client";
import { proposalQuestion, quickCheck } from "../../core/proposals";
import { Candidate, Paged } from "../../core/types";
import { useApp } from "../../ui/Context";
import { go, useLoad } from "../../ui/hooks";
import { Badge, Btn, Empty, ErrorBox, Loading, Notice } from "../../ui/kit";

/** One suggestion at a time. Remember it, not now, or never: the same approve, defer and reject the full review uses, with the same version check. */
export function ProposalCarousel() {
  const { client, connected } = useApp();
  const l = useLoad(() => client.get<Paged<Candidate>>("/candidates", { query: { status: "candidate", limit: 30 } }), [client]);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [done, setDone] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const left = (l.data?.items ?? []).filter((c) => !skipped.has(c.id));
  const c = left[0];
  const act = async (action: "approve" | "defer" | "reject") => {
    if (!c || busy) return;
    setBusy(true); setErr(null);
    try {
      await client.post(`/candidates/${c.id}/${action}`, { note: "", expected_version: c.version, confirm_global: false, override_injection: false });
      setSkipped((s) => new Set(s).add(c.id));
      setDone((n) => n + 1);
    } catch (e) { setErr(e instanceof ApiError ? e.message : (e as Error).message); } finally { setBusy(false); }
  };
  if (l.loading && !l.data) return <Loading />;
  if (!c) return <Empty>{done > 0 ? `All caught up. You went through ${done}.` : "Nothing waiting for you."}</Empty>;
  const q = quickCheck(c);
  return (
    <section className="carousel" aria-label="Suggestions to review">
      <p className="muted small" aria-live="polite">{left.length} waiting{done > 0 ? `, ${done} done` : ""}</p>
      <ErrorBox msg={l.error ?? err} />
      <article className="card swipe-card">
        <Badge s="pending" label={c.type.replace(/_/g, " ")} />
        <h3>{proposalQuestion(c)}</h3>
        <p className="muted small">Confidence {Math.round(c.confidence * 100)}% · seen {c.distinct_occurrences} time{c.distinct_occurrences === 1 ? "" : "s"}. Nothing is used until you say yes.</p>
        {!q.quick && <Notice tone="info">{q.why}</Notice>}
        {!connected && <Notice tone="warn">Offline: reviewing needs a connection.</Notice>}
        <div className="row">
          <Btn busy={busy} disabled={!connected || !q.quick} onClick={() => void act("approve")}>Remember this</Btn>
          <Btn kind="ghost" busy={busy} disabled={!connected || !q.quick} onClick={() => void act("defer")}>Not now</Btn>
          <Btn kind="danger" busy={busy} disabled={!connected || !q.quick} onClick={() => void act("reject")}>Ignore</Btn>
          <Btn kind="ghost" onClick={() => go({ tab: "inbox", sub: "candidate", id: c.id })}>Look closer</Btn>
          <Btn kind="ghost" onClick={() => setSkipped((s) => new Set(s).add(c.id))}>Skip</Btn>
        </div>
      </article>
    </section>
  );
}
