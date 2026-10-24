import { useState } from "react";
import { ApiError } from "../../core/client";
import { useApp } from "../../ui/Context";
import { useLoad } from "../../ui/hooks";
import { Badge, Btn, Collapsible, Empty, ErrorBox, Loading, Notice, Untrusted, ago } from "../../ui/kit";

interface Cand { id: string; name: string; status: string; eval_status: string; content_sha256: string; created_at: string; decided_at: string | null; decision_note: string | null }
interface Version { name: string; version: number; status: string; sha256: string; parent_version: number | null; deployed_at: string | null; note: string | null }
interface Overview { candidates: Cand[]; versions: Version[] }
interface Detail { id: string; name: string; status: string; eval_status: string; rationale: string; content: string; sha256: string; results: { case: string; passed: boolean; detail: string }[]; active_version: number | null }
interface EvalOut { eval_status: string; failed_cases: string[]; regression_failures: string[]; not_executed: number; note: string }

const EVAL_TONE: Record<string, string> = { passed: "approved", failed: "rejected", not_run: "pending" };
const msg = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e));

/** Review skill changes: see the exact text, run the checks, then deploy (explicit confirmation), reject, or roll back. */
export function Improvements() {
  const { client, connected } = useApp();
  const ov = useLoad(() => client.get<Overview>("/skills"), [client]);
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<string | void>) => {
    if (busy) return;
    setBusy(true); setErr(null); setInfo(null);
    try { const m = await fn(); if (m) setInfo(m); ov.reload(); }
    catch (e) { setErr(msg(e)); }
    finally { setBusy(false); }
  };

  if (ov.error && !ov.data) return <ErrorBox msg={ov.error} code={ov.errorCode} />;
  if (!ov.data) return <Loading what="Loading skill changes" />;
  const waiting = ov.data.candidates.filter((c) => c.status === "candidate" || c.status === "evaluating");
  const decided = ov.data.candidates.filter((c) => c.status === "approved" || c.status === "rejected");
  const names = [...new Set(ov.data.versions.map((v) => v.name))];

  return (
    <>
      <p className="muted small">Skills are instructions Claude follows. A change only goes live after its checks pass and you confirm it. Checks verify structure and safety rules; the behavioural examples inside a skill are <strong>not</strong> run.</p>
      {err && <ErrorBox msg={err} />}
      {info && <Notice tone="ok">{info}</Notice>}
      {!connected && <Notice tone="warn">Offline: reviewing and deploying need a connection.</Notice>}

      <h3>Waiting for review</h3>
      {waiting.length === 0 ? <Empty>No skill changes are waiting. They appear here when a change is proposed.</Empty> : (
        <ul className="cards">
          {waiting.map((c) => (
            <li key={c.id}>
              <div className="card-static">
                <button className="card-btn" style={{ width: "100%" }} aria-expanded={open === c.id} onClick={() => setOpen(open === c.id ? null : c.id)}>
                  <div className="row" style={{ justifyContent: "space-between" }}><strong>{c.name}</strong><Badge s={EVAL_TONE[c.eval_status] ?? "pending"} label={c.eval_status === "not_run" ? "not checked" : `checks ${c.eval_status}`} /></div>
                  <div className="muted small">proposed {ago(c.created_at)}</div>
                </button>
                {open === c.id && <CandidateReview id={c.id} busy={busy} connected={connected} act={act} onChanged={ov.reload} />}
              </div>
            </li>
          ))}
        </ul>
      )}

      <h3>Deployed skills</h3>
      {names.length === 0 ? <Empty>No skill has been deployed through this review loop yet.</Empty> : (
        <ul className="cards">
          {names.map((n) => {
            const vs = ov.data!.versions.filter((v) => v.name === n);
            const active = vs.find((v) => v.status === "active");
            return (
              <li key={n}>
                <div className="card-static">
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <strong>{n}</strong><span className="muted small">{active ? `version ${active.version} active` : "none active"}</span>
                  </div>
                  <Collapsible title="Version history" count={vs.length}>
                    <ul className="linklist">{vs.map((v) => <li key={v.version}>v{v.version} · {v.status.replace(/_/g, " ")}{v.deployed_at ? ` · ${ago(v.deployed_at)}` : ""}{v.note ? ` · ${v.note}` : ""} <code className="small">{v.sha256.slice(0, 10)}</code></li>)}</ul>
                  </Collapsible>
                  {active && <RollbackButton name={n} version={active.version} disabled={!connected} busy={busy} act={act} />}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {decided.length > 0 && (
        <Collapsible title="Decided" count={decided.length}>
          <ul className="linklist">{decided.map((c) => <li key={c.id}>{c.name} · {c.status === "approved" ? "deployed" : "rejected"}{c.decided_at ? ` ${ago(c.decided_at)}` : ""}{c.decision_note ? ` · ${c.decision_note}` : ""}</li>)}</ul>
        </Collapsible>
      )}
    </>
  );
}

function CandidateReview({ id, busy, connected, act, onChanged }: { id: string; busy: boolean; connected: boolean; act: (fn: () => Promise<string | void>) => Promise<void>; onChanged: () => void }) {
  const { client } = useApp();
  const d = useLoad(() => client.get<Detail>(`/skills/candidates/${encodeURIComponent(id)}`), [client, id]);
  const [note, setNote] = useState("");
  const [sure, setSure] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [ran, setRan] = useState<EvalOut | null>(null);
  if (d.error && !d.data) return <ErrorBox msg={d.error} code={d.errorCode} />;
  if (!d.data) return <Loading what="Loading the proposed change" />;
  const c = d.data;
  const passed = c.eval_status === "passed";
  const refresh = () => { d.reload(); onChanged(); };
  return (
    <div style={{ marginTop: 10 }}>
      <h4>Why</h4>
      <Untrusted text={c.rationale} max={2000} />
      <h4>Exact text that would be deployed {c.active_version ? `(replaces version ${c.active_version})` : "(new skill)"}</h4>
      <p className="muted small">Fingerprint <code>{c.sha256.slice(0, 16)}</code></p>
      <Untrusted text={c.content} max={20000} />
      <h4>Checks</h4>
      {c.results.length === 0 ? <p className="muted small">Not run yet.</p> : (
        <ul className="linklist" aria-label="Check results">{c.results.map((r) => <li key={r.case}>{r.passed ? "✓" : "✗"} {r.case} <span className="muted small">{r.detail}</span></li>)}</ul>
      )}
      {ran && (ran.failed_cases.length > 0 || ran.regression_failures.length > 0) && (
        <Notice tone="bad">Failed: {[...ran.failed_cases, ...ran.regression_failures.map((r) => `regression: ${r}`)].join(", ")}</Notice>
      )}
      {ran && ran.not_executed > 0 && <p className="muted small">{ran.not_executed} behavioural case{ran.not_executed === 1 ? " was" : "s were"} written down but not executed.</p>}
      <div className="row" style={{ justifyContent: "flex-start", marginTop: 8 }}>
        <Btn kind="ghost" busy={busy} disabled={!connected} onClick={() => void act(async () => { setRan((await client.post<EvalOut>(`/skills/candidates/${encodeURIComponent(id)}/evaluate`, {})).data); refresh(); })}>
          {c.eval_status === "not_run" ? "Run checks" : "Re-run checks"}
        </Btn>
      </div>

      <h4>Decision</h4>
      <label className="field"><span>Note (required to reject, optional to deploy)</span>
        <input value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} aria-label="Decision note" /></label>
      {passed ? (
        <label className="check"><input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} /> I read the exact text above and want it deployed as a live skill</label>
      ) : <p className="muted small">Deploying is unavailable until the checks pass.</p>}
      <div className="row" style={{ justifyContent: "flex-start", marginTop: 6 }}>
        <Btn busy={busy} disabled={!connected || !passed || !sure}
          onClick={() => void act(async () => { const r = (await client.post<{ skill: string; version: number }>(`/skills/candidates/${encodeURIComponent(id)}/promote`, { confirm: true, note })).data; return `Deployed ${r.skill} as version ${r.version}.`; })}>Deploy skill</Btn>
        {rejecting ? (
          <>
            <Btn kind="danger" busy={busy} disabled={!connected || !note.trim()}
              onClick={() => void act(async () => { await client.post(`/skills/candidates/${encodeURIComponent(id)}/reject`, { note: note.trim() }); return "Rejected. It will not be proposed again unless new evidence appears."; })}>Confirm reject</Btn>
            <Btn kind="ghost" onClick={() => setRejecting(false)}>Keep</Btn>
          </>
        ) : <Btn kind="ghost" disabled={!connected} onClick={() => setRejecting(true)}>Reject…</Btn>}
      </div>
      {rejecting && !note.trim() && <p className="muted small">Write a short reason in the note first.</p>}
    </div>
  );
}

function RollbackButton({ name, version, disabled, busy, act }: { name: string; version: number; disabled: boolean; busy: boolean; act: (fn: () => Promise<string | void>) => Promise<void> }) {
  const { client } = useApp();
  const [ask, setAsk] = useState(false);
  if (!ask) return <Btn kind="ghost" disabled={disabled} onClick={() => setAsk(true)}>Roll back…</Btn>;
  return (
    <Notice tone="bad">
      Roll back <strong>{name}</strong> from version {version}? The previous version’s exact text is restored (or the skill is removed if there was none).
      <div className="row" style={{ marginTop: 8 }}>
        <Btn kind="danger" busy={busy} disabled={disabled}
          onClick={() => void act(async () => { const r = (await client.post<{ restored_version: number | null; removed?: boolean }>(`/skills/${encodeURIComponent(name)}/rollback`, {})).data; setAsk(false); return r.removed ? `${name} removed.` : `${name} restored to version ${r.restored_version}.`; })}>Yes, roll back</Btn>
        <Btn kind="ghost" onClick={() => setAsk(false)}>Keep</Btn>
      </div>
    </Notice>
  );
}
