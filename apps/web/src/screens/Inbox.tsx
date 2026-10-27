import { useState } from "react";
import { ApiError } from "../core/client";
import { plainApproval } from "../core/approvals";
import { Approval, Candidate, Paged } from "../core/types";
import { useApp } from "../ui/Context";
import { go, useLoad, useViewport } from "../ui/hooks";
import { Improvements } from "./inbox/Improvements";
import { Badge, Btn, Collapsible, Empty, ErrorBox, Loading, Notice, Untrusted, ago, fmtDuration, fmtLocal, useOnce } from "../ui/kit";

type Seg = "approvals" | "proposals" | "improvements";

export function Inbox({ sub, id }: { sub?: string; id?: string }) {
  const { twoPane } = useViewport();
  const seg: Seg = sub === "candidate" ? "proposals" : sub === "improvements" ? "improvements" : "approvals";
  const list = (
    <div className="screen">
      <h2>Inbox</h2>
      <div className="tabs" role="tablist" aria-label="Inbox sections">
        {([["approvals", "Approvals", "/approval"], ["proposals", "Proposals", "/candidate"], ["improvements", "Improvements", "/improvements"]] as const).map(([s, l]) => (
          <button key={s} role="tab" aria-selected={seg === s} className={`tab ${seg === s ? "on" : ""}`}
            onClick={() => go({ tab: "inbox", sub: s === "approvals" ? undefined : s === "proposals" ? "candidate" : "improvements", id: undefined })}>{l}</button>))}
      </div>
      {seg === "approvals" && <ApprovalList selected={sub === "approval" ? id : undefined} />}
      {seg === "proposals" && <CandidateList selected={sub === "candidate" ? id : undefined} />}
      {seg === "improvements" && <Improvements />}
    </div>
  );
  const detail = sub === "approval" && id ? <ApprovalDetail id={id} /> : sub === "candidate" && id ? <CandidateDetail id={id} /> : null;
  if (twoPane) return <div className="panes"><div className="pane-list">{list}</div><div className="pane-detail">{detail ?? <Empty>Select an item to review.</Empty>}</div></div>;
  return detail ?? list;
}

// ------------------------------------------------------------------ approvals
function ApprovalList({ selected }: { selected?: string }) {
  const { client } = useApp();
  const [showResolved, setShowResolved] = useState(false);
  const l = useLoad(() => client.get<Paged<Approval>>("/approvals", { query: { status: showResolved ? undefined : "pending", limit: 50 } }), [client, showResolved], 5000);
  return (
    <>
      <label className="check"><input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} /> Show resolved/expired</label>
      <ErrorBox msg={l.error} code={l.errorCode} />
      {l.loading && !l.data ? <Loading /> : !l.data?.items.length && !l.error ? <Empty>No {showResolved ? "" : "pending "}approval requests.</Empty> : (
        <ul className="cards">{l.data?.items.map((a) => (
          <li key={a.id}><button className={`card-btn ${selected === a.id ? "sel" : ""}`} onClick={() => go({ tab: "inbox", sub: "approval", id: a.id })}>
            <span className="row"><strong>{a.summary}</strong><Badge s={a.status} /></span>
            <span className="muted small">{a.destructive ? "⚠ destructive · " : ""}requested {ago(a.requested_at)} · {a.status === "pending" ? `expires in ${fmtDuration(a.expires_in_s)}` : a.status}</span>
          </button></li>))}</ul>
      )}
    </>
  );
}

function ApprovalDetail({ id }: { id: string }) {
  const { client, connected } = useApp();
  const a = useLoad(() => client.get<Approval>(`/approvals/${id}`), [client, id], 5000);
  const [ack, setAck] = useState(false);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<{ code: string; msg: string } | null>(null);
  const decide = useOnce(async (approve: boolean) => {
    if (!a.data) return;
    setErr(null);
    try {
      // Bound to exactly what is on screen: the action hash and record version the user reviewed.
      await client.post(`/approvals/${id}/decide`, { approve, note, expected_version: a.data.version, action_hash: a.data.action_hash, confirm_destructive: ack });
    } catch (e) {
      if (e instanceof ApiError) setErr({ code: e.code, msg: e.message });
      else setErr({ code: "network", msg: `${(e as Error).message} Nothing was assumed: check the status below before deciding again.` });
    }
    await a.reload();
  });
  const d = a.data;
  const plain = d ? plainApproval(d) : null;
  return (
    <div className="screen">
      <Btn kind="ghost" onClick={() => history.back()}>← Inbox</Btn>
      <ErrorBox msg={a.error} code={a.errorCode} />
      {a.loading && !d && <Loading />}
      {d && (
        <>
          <div className="row"><h2>{plain!.headline}</h2><Badge s={d.status} /></div>
          <Notice tone={plain!.tone}>{plain!.safety}</Notice>
          <p className="muted small">{d.status === "pending" ? `Asked ${ago(d.requested_at)}. Expires in ${fmtDuration(d.expires_in_s)}.` : `Asked ${ago(d.requested_at)}.`}</p>
          {d.destructive && <Notice tone="bad"><strong>Destructive or unrecognised action.</strong> It can overwrite or change existing data.</Notice>}
          <Collapsible title="Technical details and proof">
          <p className="muted small">{d.summary}</p>
          <dl className="facts">
            <dt>Action</dt><dd><code>{d.review.type}</code></dd>
            <dt>Exact target</dt><dd><code className="wrap">{d.review.target || "(none given)"}</code></dd>
            <dt>Requested</dt><dd>{fmtLocal(d.requested_at)} ({ago(d.requested_at)})</dd>
            <dt>Expires</dt><dd>{d.status === "pending" ? `in ${fmtDuration(d.expires_in_s)} (${fmtLocal(d.expires_at)})` : fmtLocal(d.expires_at)}</dd>
            <dt>Action version</dt><dd>v{d.version} · hash <code>{d.action_hash.slice(0, 16)}…</code></dd>
          </dl>
          <h3>Content to be written</h3>
          <Untrusted text={d.review.content_preview || "(empty)"} />
          </Collapsible>
          <h3>What will happen</h3>
          <ul>{d.review.side_effects.map((s) => <li key={s}>{s}</li>)}</ul>
          <Collapsible title="Evidence and context" startOpen count={d.context?.evidence.length}>
            {d.context?.run && <p>Run: <button className="link" onClick={() => go({ tab: "runs", id: d.context!.run!.id })}>{d.context.run.task_title}</button> ({d.context.run.state})</p>}
            {d.context?.evidence.length ? <ul className="plain">{d.context.evidence.map((e, i) => <li key={i}><code>{e.kind}</code> {e.summary}</li>)}</ul> : <Empty>No evidence recorded for this run yet.</Empty>}
          </Collapsible>
          {err && <Notice tone="bad"><strong>{err.code.replace(/_/g, " ")}:</strong> {err.msg}</Notice>}
          {d.status === "pending" ? (
            <div className="card">
              <p className="small">Your decision applies only to the exact action above. If the action changes, this approval stops matching and a new request is made.</p>
              <label className="field"><span>Note (optional)</span><input value={note} onChange={(e) => setNote(e.target.value)} /></label>
              {d.destructive && <label className="check"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I understand this may overwrite or change existing data.</label>}
              {!connected && <Notice tone="warn">You are offline. Approvals are never queued: reconnect to decide.</Notice>}
              <div className="row">
                <Btn busy={decide.busy} disabled={!connected || (d.destructive && !ack)} onClick={() => void decide.run(true)}>{plain!.approveLabel}</Btn>
                <Btn kind="danger" busy={decide.busy} disabled={!connected} onClick={() => void decide.run(false)}>Reject</Btn>
              </div>
            </div>
          ) : <Notice tone="info">This request is {d.status}. {d.status === "approved" ? "It is single-use and expires." : "It can no longer be used."}</Notice>}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ candidates (memory / skill / automation proposals)
function CandidateList({ selected }: { selected?: string }) {
  const { client } = useApp();
  const l = useLoad(() => client.get<Paged<Candidate>>("/candidates", { query: { status: "candidate", limit: 30 } }), [client], 8000);
  return (
    <>
      <p className="muted small">Proposals extracted from approved history. Nothing here is active; approving a proposal never grants permissions or runs code.</p>
      <ErrorBox msg={l.error} code={l.errorCode} />
      {l.loading && !l.data ? <Loading /> : !l.data?.items.length && !l.error ? <Empty>Nothing to review.</Empty> : (
        <ul className="cards">{l.data?.items.map((c) => (
          <li key={c.id}><button className={`card-btn ${selected === c.id ? "sel" : ""}`} onClick={() => go({ tab: "inbox", sub: "candidate", id: c.id })}>
            <span className="row"><strong>{c.title}</strong><Badge s="pending" label={c.type.replace("_", " ")} /></span>
            <span className="muted small">{c.scope} · confidence {Math.round(c.confidence * 100)}% · {c.distinct_occurrences} occurrence(s) · {c.validation.replace(/_/g, " ")}</span>
            {c.flags.length > 0 && <span className="muted small">⚑ {c.flags.join(", ")}</span>}
          </button></li>))}</ul>
      )}
    </>
  );
}

function CandidateDetail({ id }: { id: string }) {
  const { client, connected } = useApp();
  const c = useLoad(() => client.get<Candidate>(`/candidates/${id}`), [client, id]);
  const [note, setNote] = useState("");
  const [global, setGlobal] = useState(false);
  const [inj, setInj] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const act = useOnce(async (action: "approve" | "reject" | "defer") => {
    if (!c.data) return;
    setErr(null);
    try {
      await client.post(`/candidates/${id}/${action}`, { note, expected_version: c.data.version, confirm_global: global, override_injection: inj });
    } catch (e) {
      setErr(e instanceof ApiError ? `${e.message}` : (e as Error).message);
    }
    await c.reload();
  });
  const d = c.data;
  const support = d?.evidence?.filter((e) => e.role === "support") ?? [];
  const counter = d?.evidence?.filter((e) => e.role === "counter") ?? [];
  return (
    <div className="screen">
      <Btn kind="ghost" onClick={() => history.back()}>← Inbox</Btn>
      <ErrorBox msg={c.error} code={c.errorCode} />
      {c.loading && !d && <Loading />}
      {d && (
        <>
          <div className="row"><h2>{d.title}</h2><Badge s={d.status === "approved" ? "approved" : d.status === "rejected" ? "rejected" : "pending"} label={d.status} /></div>
          <p className="muted small">{d.type.replace("_", " ")} · scope <strong>{d.scope}</strong> · confidence {Math.round(d.confidence * 100)}% · {d.distinct_occurrences} distinct occurrence(s) in {d.distinct_sources} source(s) · v{d.version}</p>
          <p>Validation: <strong>{d.validation.replace(/_/g, " ")}</strong>. {d.validation === "historically_reported" && "Based on someone saying it worked; no test evidence preserved."}</p>
          {d.uncertainty && <Notice tone="warn">{d.uncertainty}</Notice>}
          {d.flags.includes("injection_suspect") && <Notice tone="bad">Contains text that looks like an attempt to instruct the assistant. Treat as untrusted.</Notice>}
          <h3>Problem</h3><Untrusted text={d.problem ?? ""} />
          <h3>Outcome observed</h3><Untrusted text={d.outcome ?? ""} />
          <Collapsible title="Supporting evidence" startOpen count={support.length}>
            {support.map((e, i) => <div key={i} className="card-static"><span className="muted small">{e.speaker} · {e.kind} · {e.ref}</span><Untrusted text={e.excerpt} /></div>)}
          </Collapsible>
          <Collapsible title="Counter-evidence" startOpen={counter.length > 0} count={counter.length}>
            {counter.length === 0 ? <Empty>None recorded.</Empty> : counter.map((e, i) => <div key={i} className="card-static"><span className="muted small">{e.speaker} · {e.kind}</span><Untrusted text={e.excerpt} /></div>)}
          </Collapsible>
          {err && <ErrorBox msg={err} />}
          {["candidate", "deferred"].includes(d.status) && (
            <div className="card">
              <label className="field"><span>Note{d.flags.includes("conflict") ? " (required: contradicting evidence exists)" : ""}</span><input value={note} onChange={(e) => setNote(e.target.value)} /></label>
              {d.scope === "global" && <label className="check"><input type="checkbox" checked={global} onChange={(e) => setGlobal(e.target.checked)} /> I reviewed the evidence from multiple projects and want this to apply globally.</label>}
              {d.flags.includes("injection_suspect") && <label className="check"><input type="checkbox" checked={inj} onChange={(e) => setInj(e.target.checked)} /> I reviewed the suspicious text and still want to approve.</label>}
              {!connected && <Notice tone="warn">Offline: reviewing needs a connection.</Notice>}
              <div className="row">
                <Btn busy={act.busy} disabled={!connected} onClick={() => void act.run("approve")}>Approve</Btn>
                <Btn kind="ghost" busy={act.busy} disabled={!connected} onClick={() => void act.run("defer")}>Defer</Btn>
                <Btn kind="danger" busy={act.busy} disabled={!connected} onClick={() => void act.run("reject")}>Reject</Btn>
              </div>
              <p className="muted small">Editing, merging and superseding are desktop actions.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
