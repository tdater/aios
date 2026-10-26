import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../../core/client";
import { LinkState, monitorRun } from "../../core/monitor";
import { Approval, Artifact, ConvMessage, ConversationView, Finding, RunDetail, TurnInfo } from "../../core/types";
import {
  ACTIVE_RUN_STATES, MODEL_CHOICES, UDiffFile, argvToText, commandToArgv, diffTotals, locationText, parseUnifiedDiff, quotaBars,
  sevTone, shortRev, showCommand, sortFindings,
} from "../../core/work";
import { useApp } from "../../ui/Context";
import { useLoad } from "../../ui/hooks";
import { Badge, Btn, Collapsible, Empty, ErrorBox, Loading, Notice, Untrusted, ago, fmtDuration, fmtLocal, useOnce } from "../../ui/kit";
import { CancelPanel, ResumeButton } from "../Runs";
import { ContextUsed } from "./Thread";

type M = Record<string, unknown> | null;
const mget = <T,>(m: ConvMessage | null | undefined, key: string): T | undefined => (m?.meta as M)?.[key] as T | undefined;

// ================================================================== Activity
const LINK_TEXT: Record<LinkState, string> = { live: "Live", reconnecting: "Reconnecting… showing the last data received", ended: "Finished", unauthenticated: "Signed out", error: "Monitoring stopped" };

export function ActivityPanel({ v, reload }: { v: ConversationView; reload: () => Promise<void> }) {
  const { client, connected } = useApp();
  const run = v.status.run;
  const [events, setEvents] = useState<RunDetail["events"]>([]);
  const [link, setLink] = useState<LinkState>("live");
  const [err, setErr] = useState<string | null>(null);
  const box = useRef<HTMLOListElement>(null);
  const runId = run?.id;
  useEffect(() => {
    setEvents([]);
    if (!runId) return;
    return monitorRun(client, runId, {
      onSnapshot: (s) => setEvents(s.events),
      onEvents: (items) => setEvents((cur) => { const seen = new Set(cur.map((e) => e.id)); return [...cur, ...items.filter((e) => !seen.has(e.id))]; }),
      onLink: (s) => setLink(s),
    });
  }, [client, runId]);
  useEffect(() => { const b = box.current; if (b) b.scrollTop = b.scrollHeight; }, [events.length]);
  if (!run) return <Empty>Nothing has run yet. Send a message and you will see what Claude does here, step by step.</Empty>;
  const open = ACTIVE_RUN_STATES.has(run.state);
  const shown = events.filter((e) => e.kind !== "lock").slice(-300);
  return (
    <div>
      <div className="row"><strong>{run.task_title}</strong><Badge s={run.display_state} /></div>
      <p className="muted small" role="status">{LINK_TEXT[link]}{run.state_reason ? ` · ${run.state_reason}` : ""}</p>
      {link === "reconnecting" && <Notice tone="warn">Connection lost. What you see may be out of date; it will catch up by itself.</Notice>}
      <ErrorBox msg={err} />
      <CancelPanel run={run} open={open} connected={connected} onError={setErr} onDone={() => void reload()} />
      {run.state === "blocked" && ["provider_unavailable", "repo_not_ready"].includes(run.block_code ?? "") && (
        <Notice tone="warn">{run.state_reason} Fix that, then resume. <ResumeButton runId={run.id} connected={connected} onError={setErr} /></Notice>
      )}
      {run.state === "interrupted" && <Notice tone="warn">The run was interrupted. <ResumeButton runId={run.id} connected={connected} onError={setErr} /></Notice>}
      {run.block_code === "uncertain_side_effect" && <Notice tone="bad">A step with side effects was interrupted and its outcome is unknown, so AIOS will not repeat it. Check the Changes and Tests tabs before deciding what to do.</Notice>}
      <ol className="timeline activity" ref={box} aria-label="What happened, in order" tabIndex={0}>
        {shown.map((e) => (
          <li key={e.id} className={`ev ${e.kind}`}>
            <span className="muted small">{new Date(e.ts).toLocaleTimeString()}</span>{" "}
            {e.kind === "claude" ? <strong>Claude</strong> : <code>{e.kind}</code>} {e.message}
          </li>))}
      </ol>
      <ContextUsed items={v.context[run.id]} />
    </div>
  );
}

// ================================================================== Changes
function DiffFile({ f, startOpen }: { f: UDiffFile; startOpen: boolean }) {
  const [all, setAll] = useState(false);
  const cap = 600;
  const lines = all ? f.lines : f.lines.slice(0, cap);
  const label = { modified: "changed", added: "new file", deleted: "deleted", renamed: `renamed from ${f.oldPath}`, binary: "binary file" }[f.status];
  return (
    <Collapsible title={`${f.path} — ${label}, +${f.added} −${f.removed}`} startOpen={startOpen}>
      {f.status === "binary" ? <p className="muted small">Binary files are not shown.</p> : (
        <div className="udiff" role="group" aria-label={`Changes in ${f.path}`}>
          {lines.map((l, i) => (
            <div key={i} className={`u-line u-${l.kind}`}>
              <span className="u-no" aria-hidden="true">{l.oldNo ?? ""}</span><span className="u-no" aria-hidden="true">{l.newNo ?? ""}</span>
              <span className="u-sign" aria-label={l.kind === "add" ? "added" : l.kind === "del" ? "removed" : undefined}>{l.kind === "add" ? "+" : l.kind === "del" ? "−" : l.kind === "ctx" ? " " : ""}</span>
              <span className="u-text">{l.text}</span>
            </div>))}
        </div>
      )}
      {f.lines.length > cap && !all && <Btn kind="ghost" onClick={() => setAll(true)}>Show all {f.lines.length} lines</Btn>}
    </Collapsible>
  );
}

export function ChangesPanel({ v }: { v: ConversationView }) {
  const { client } = useApp();
  const patch = v.changes.patch;
  const artifactId = mget<string>(patch, "artifact_id");
  const art = useLoad(() => (artifactId ? client.get<Artifact>(`/artifacts/${artifactId}`) : Promise.resolve(null)), [client, artifactId]);
  const files = useMemo(() => (art.data ? parseUnifiedDiff(art.data.content) : []), [art.data]);
  const c = v.conversation;
  if (!patch) return <Empty>No changes yet. Choose <strong>Make changes</strong> when you message Claude and the proposed change appears here.</Empty>;
  if (!mget<boolean>(patch, "changed")) return <Empty>Claude made no file changes{c.branch ? ` on branch ${c.branch}` : ""}.</Empty>;
  const sens = mget<string[]>(patch, "sensitive_paths") ?? [];
  const secrets = mget<string[]>(patch, "possible_secret_kinds") ?? [];
  const tot = diffTotals(files);
  return (
    <div>
      <p><strong>{mget<{ path: string }[]>(patch, "files")?.length ?? 0} file(s)</strong> changed · <span className="add">+{String(mget<number>(patch, "added"))}</span> <span className="del">−{String(mget<number>(patch, "removed"))}</span> · revision {shortRev(mget<string>(patch, "base_revision"))} → {shortRev(mget<string>(patch, "head_revision"))}</p>
      <Notice tone="info">
        <strong>Your project folder has not been changed.</strong> This change lives on branch <code>{c.branch}</code> in a separate copy. AIOS does not yet apply
        changes to your project for you; when you are happy with one, merge that branch with your normal git tools.
      </Notice>
      {sens.length > 0 && <Notice tone="warn"><strong>Look closely at these files.</strong> They run code or change how tools behave: {sens.join(", ")}</Notice>}
      {secrets.length > 0 && <Notice tone="bad">The change may contain secret-like values ({secrets.join(", ")}). Check before you share it anywhere.</Notice>}
      {mget<boolean>(patch, "truncated") && <Notice tone="warn">This change is very large and the stored copy was cut off.</Notice>}
      <ErrorBox msg={art.error} code={art.errorCode} />
      {art.loading && !art.data && <Loading what="Loading the change" />}
      {art.data && files.length === 0 && <Untrusted text={art.data.content} />}
      {files.map((f, i) => <DiffFile key={f.path + i} f={f} startOpen={i === 0 && files.length <= 3} />)}
      {art.data && <p className="muted small">{tot.files} file(s) parsed · stored patch sha256 {String(mget<string>(patch, "sha256") ?? "").slice(0, 16)}… · secrets are redacted in what is shown here.</p>}
    </div>
  );
}

// ================================================================== Tests
const EXAMPLES: [string, string[]][] = [
  ["Python unittest", ["python", "-m", "unittest", "discover"]],
  ["Python pytest", ["python", "-m", "pytest", "-q"]],
  ["Node (npm test)", ["npm", "test"]],
];

export function VerifyCommandForm({ v, onSaved }: { v: ConversationView; onSaved: () => void }) {
  const { client, connected } = useApp();
  const [text, setText] = useState(argvToText(v.verify_command));
  const [editing, setEditing] = useState(!v.verify_command);
  const [err, setErr] = useState<string | null>(null);
  const argv = commandToArgv(text);
  const save = useOnce(async (clear: boolean) => {
    setErr(null);
    try {
      await client.put(`/projects/${v.project.id}/verify-command`, { argv: clear ? null : argv });
      setEditing(false); onSaved();
    } catch (e) { setErr(e instanceof ApiError ? e.message : (e as Error).message); }
  });
  if (!editing && v.verify_command) {
    return (
      <div className="card-static">
        <div className="row"><span>How AIOS checks changes: <code>{showCommand(v.verify_command)}</code></span><Btn kind="ghost" onClick={() => setEditing(true)}>Change…</Btn></div>
      </div>
    );
  }
  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); void save.run(false); }} aria-label="How AIOS checks changes">
      <h3>How should AIOS check changes?</h3>
      <p className="muted small">Give the command that runs this project&apos;s tests. AIOS runs it on every change Claude makes, but only after you approve each run. Put one part of the command on each line, for example <code>python</code> on the first line, <code>-m</code> on the second, and <code>unittest</code> on the third.</p>
      <div className="chips">{EXAMPLES.map(([label, a]) => <button key={label} type="button" className="chip btnchip" onClick={() => setText(argvToText(a))}>{label}</button>)}</div>
      <ErrorBox msg={err} />
      <label className="field"><span>Command (one part per line)</span><textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} /></label>
      {argv.length > 0 && <p className="small">AIOS will run: <code>{showCommand(argv)}</code></p>}
      <div className="row">
        <Btn type="submit" busy={save.busy} disabled={!connected || argv.length === 0}>Save</Btn>
        {v.verify_command && <Btn kind="ghost" onClick={() => { setText(argvToText(v.verify_command)); setEditing(false); }}>Cancel</Btn>}
        {v.verify_command && <Btn kind="danger" busy={save.busy} disabled={!connected} onClick={() => void save.run(true)}>Remove</Btn>}
      </div>
    </form>
  );
}

export function InlineApproval({ id, onDone }: { id: string; onDone: () => void }) {
  const { client, connected } = useApp();
  const a = useLoad(() => client.get<Approval>(`/approvals/${id}`), [client, id], 4000);
  const [ack, setAck] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const decide = useOnce(async (approve: boolean) => {
    if (!a.data) return;
    setErr(null);
    try {   // bound to exactly what is on screen: the action hash and record version the user reviewed
      await client.post(`/approvals/${id}/decide`, { approve, expected_version: a.data.version, action_hash: a.data.action_hash, confirm_destructive: ack });
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? `${e.code.replace(/_/g, " ")}: ${e.message}` : `${(e as Error).message} Nothing was assumed: check the status before deciding again.`);
      await a.reload();
    }
  });
  const d = a.data;
  if (!d) return a.error ? <ErrorBox msg={a.error} code={a.errorCode} /> : <Loading what="Loading the approval" />;
  if (d.status !== "pending") return <Notice tone="info">This approval is {d.status}.</Notice>;
  return (
    <div className="card approval-inline" role="group" aria-label="Approval needed">
      <h3>Your approval is needed</h3>
      <p>{d.summary}</p>
      <ul>{d.review.side_effects.map((s) => <li key={s}>{s}</li>)}</ul>
      <Untrusted text={d.review.content_preview || "(empty)"} />
      <p className="muted small">expires in {fmtDuration(d.expires_in_s)} · applies only to this exact command and revision; if either changes, a new request is made.</p>
      <ErrorBox msg={err} />
      {d.destructive && <label className="check"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I understand this runs code that Claude just wrote, on my computer, with my account&apos;s permissions.</label>}
      {!connected && <Notice tone="warn">You are offline. Approvals are never queued: reconnect to decide.</Notice>}
      <div className="row">
        <Btn busy={decide.busy} disabled={!connected || (d.destructive && !ack)} onClick={() => void decide.run(true)}>Approve and run the tests</Btn>
        <Btn kind="danger" busy={decide.busy} disabled={!connected} onClick={() => void decide.run(false)}>Reject</Btn>
      </div>
    </div>
  );
}

export function TestsPanel({ v, reload }: { v: ConversationView; reload: () => Promise<void> }) {
  const ver = v.changes.verification;
  const patchHead = mget<string>(v.changes.patch, "head_revision");
  const stale = !!ver && !!patchHead && mget<string>(ver, "head_revision") !== patchHead;
  const passed = mget<boolean>(ver, "passed");
  return (
    <div>
      <VerifyCommandForm key={String(v.verify_command)} v={v} onSaved={() => void reload()} />
      {v.status.pending_approvals.map((p) => <InlineApproval key={p.id} id={p.id} onDone={() => void reload()} />)}
      {!ver ? <Empty>{v.changes.patch && mget<boolean>(v.changes.patch, "changed") ? (v.verify_command ? "The tests have not run on this change yet." : "Set a test command above so AIOS can check changes.") : "Nothing to check yet."}</Empty> : (
        <div className="card-static">
          <div className="row">
            <Badge s={passed ? "completed" : "failed"} label={passed ? "tests passed" : "tests failed"} />
            <span className="muted small">exit code {String(mget(ver, "exit_code"))} · {String(mget(ver, "duration_s"))}s · revision {shortRev(mget<string>(ver, "head_revision"))} · run by AIOS, not by Claude</span>
          </div>
          {stale && <Notice tone="warn">This result is for an older revision ({shortRev(mget<string>(ver, "head_revision"))}). The current change is {shortRev(patchHead)} and has not been checked.</Notice>}
          {mget<boolean>(ver, "timed_out") && <Notice tone="bad">The tests ran out of time and were stopped.</Notice>}
          <Untrusted text={ver.content} max={9000} />
        </div>
      )}
    </div>
  );
}

// ================================================================== Outcome
export function OutcomePanel({ v, reload, sendFindings }: { v: ConversationView; reload: () => Promise<void>; sendFindings: (fs: Finding[], rev: string | null) => void }) {
  const { client, connected } = useApp();
  const r = v.changes.readiness;
  const rev = v.changes.review;
  const reviewMeta = (rev?.meta as { review?: { findings: Finding[]; counts: Record<string, number>; summary: string; model: string; reviewed_revision: string; separate_session: boolean } } | null)?.review;
  const [model, setModel] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const busy = !!v.status.run && ACTIVE_RUN_STATES.has(v.status.run.state);
  const hasChange = !!r.head_revision;
  const ask = useOnce(async () => {
    setErr(null);
    try { await client.post(`/conversations/${v.conversation.id}/review`, { model: model || undefined }); await reload(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : (e as Error).message); }
  });
  const findings = sortFindings(reviewMeta?.findings ?? []);
  const current = !!reviewMeta && reviewMeta.reviewed_revision === r.head_revision;
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const chosen = findings.filter((f) => picked.has(f.id));
  return (
    <div>
      <div className={`verdict ${!hasChange ? "none" : r.ready ? "ready" : "notready"}`} role="status">
        <strong>{!hasChange ? "Nothing to check yet" : r.ready ? "READY" : "NOT READY"}</strong>
        <span className="muted small"> · decided by AIOS from the facts below, not by Claude</span>
      </div>
      <dl className="facts">
        <dt>Tests</dt><dd>{r.verified === true ? "passed on this revision" : r.verified === false ? "FAILED on this revision" : "not run on this revision"}</dd>
        <dt>Independent review</dt><dd>{!current ? "none for this revision" : `${reviewMeta!.counts.high ?? 0} high · ${reviewMeta!.counts.medium ?? 0} medium · ${reviewMeta!.counts.low ?? 0} low`}</dd>
        <dt>Revision</dt><dd>{shortRev(r.head_revision)}</dd>
      </dl>
      {r.reasons.length > 0 && <ul className="plain">{r.reasons.map((x) => <li key={x}>{x}</li>)}</ul>}
      <p className="muted small">Ready means the tests passed on exactly this revision and no high-severity problem was found in a review of it. A review is optional; passing tests are required.</p>

      <div className="card">
        <h3>Independent review</h3>
        <p className="muted small">A second Claude session, started fresh, reads the change in a read-only copy. It sees only your request, the changes and the test result, not Claude&apos;s own explanation. It uses a different model by default. It can only report findings; it cannot decide anything.</p>
        <ErrorBox msg={err} />
        <label className="field"><span>Reviewer model</span>
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="">Automatic (a different model from the writer)</option>
            {MODEL_CHOICES.filter(([k]) => k).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select></label>
        <Btn busy={ask.busy} disabled={!connected || !hasChange || busy} onClick={() => void ask.run()}>{reviewMeta ? "Review again" : "Ask for an independent review"}</Btn>
        {busy && <p className="muted small">Wait for the current run to finish first.</p>}
      </div>

      {reviewMeta && (
        <div className="card">
          <h3>Review of revision {shortRev(reviewMeta.reviewed_revision)} {!current && <Badge s="pending" label="out of date" />}</h3>
          <p className="muted small">{reviewMeta.model} · {reviewMeta.separate_session ? "separate session" : "same session (unexpected)"} · {ago(rev?.created_at)}</p>
          <p>{reviewMeta.summary || "(no summary)"}</p>
          {findings.length === 0 ? <Empty>The reviewer found no problems.</Empty> : (
            <ul className="findings">{findings.map((f) => (
              <li key={f.id} className={`finding ${f.severity}`}>
                <label className="check"><input type="checkbox" checked={picked.has(f.id)} onChange={() => toggle(f.id)} aria-label={`Select: ${f.title}`} />
                  <span><Badge s={sevTone(f.severity)} label={f.severity} /> <strong>{f.title}</strong></span></label>
                <div className="muted small">{locationText(f)}</div>
                {f.detail && <p>{f.detail}</p>}
                {f.suggestion && <p className="muted small">Suggestion: {f.suggestion}</p>}
              </li>))}
            </ul>
          )}
          {findings.length > 0 && (
            <div className="row">
              <Btn kind="ghost" onClick={() => setPicked(new Set(findings.filter((f) => f.severity !== "low").map((f) => f.id)))}>Select high and medium</Btn>
              <Btn disabled={!connected || chosen.length === 0 || busy} onClick={() => sendFindings(chosen, reviewMeta.reviewed_revision)}>Draft a fix request ({chosen.length} selected)</Btn>
            </div>
          )}
          <p className="muted small">Findings are the reviewer&apos;s opinion. AIOS checks that each cited file and line exists, but cannot check that the finding is right.</p>
        </div>
      )}
    </div>
  );
}

// ================================================================== Status
const PERM_LABEL: Record<string, string> = {
  tools_read_mode: "Tools when you Ask", tools_edit_mode: "Tools when Claude makes changes", shell: "Running commands", network: "Internet access",
  settings_files: "Your Claude settings files", claude_md_and_auto_memory: "Claude's own memory and CLAUDE.md files", edits: "Where edits happen",
  verification: "Running your tests", api_billing: "Billing",
};

function TurnFacts({ t, none }: { t: TurnInfo | null; none: string }) {
  if (!t) return <p className="muted small">{none}</p>;
  return (
    <dl className="facts">
      <dt>Model</dt><dd>{t.model ?? "not reported"} · {ago(t.at)}</dd>
      <dt>Tools it had</dt><dd>{t.tools.join(", ") || "none reported"}</dd>
      <dt>Tools you did not allow</dt><dd>{t.unexpected_tools.length ? <strong className="bad-text">{t.unexpected_tools.join(", ")}</strong> : "none"}</dd>
      <dt>API key in use</dt><dd>{t.api_key_source && t.api_key_source !== "none" ? <strong className="bad-text">{t.api_key_source}</strong> : "no (subscription login)"}</dd>
      <dt>Plugins</dt><dd>{t.external_plugins.length ? <strong className="bad-text">{t.external_plugins.join(", ")}</strong> : "none of yours"}{t.builtin_plugins.length ? ` · built into Claude Code: ${t.builtin_plugins.join(", ")}` : ""}</dd>
      <dt>Extra tool servers</dt><dd>{t.mcp_servers.length ? <strong className="bad-text">{t.mcp_servers.join(", ")}</strong> : "none"}</dd>
      <dt>Requests it was refused</dt><dd>{t.permission_denials.length}</dd>
      <dt>Cost</dt><dd>{t.cost_estimate_usd != null ? `about $${t.cost_estimate_usd.toFixed(2)} by Claude Code's own estimate (not billed to you on a subscription)` : "not reported"}</dd>
    </dl>
  );
}

export function StatusPanel({ v }: { v: ConversationView }) {
  const s = v.status;
  const bars = quotaBars(s.quota);
  const t = s.last_turn;
  return (
    <div>
      <h3>Provider</h3>
      <dl className="facts">
        <dt>Claude Code</dt><dd>{s.provider.client_version ?? "version unknown"} · {s.provider.mode}{s.provider.logged_in === false ? " · NOT signed in" : ""}</dd>
        <dt>Signed in with</dt><dd>{s.provider.auth_method ?? "unknown"}{s.provider.plan ? ` (${s.provider.plan} plan)` : ""}</dd>
        <dt>Billing</dt><dd>{s.provider.billing === "subscription" ? "your subscription (no API charges)" : s.provider.billing}</dd>
        <dt>Model you chose</dt><dd>{s.session.model}{t?.model ? ` · Claude's last turn used ${t.model}` : ""}</dd>
        <dt>Claude&apos;s session</dt><dd>{s.session.id ? `${s.session.id.slice(0, 8)}… (can continue; the reviewer always uses its own)` : "none yet"}</dd>
      </dl>

      <h3>Your usage limits</h3>
      {bars.length === 0 ? <p className="muted small">{s.quota_note}</p> : (
        <>
          {bars.map((b) => (
            <div key={b.label} className="quota">
              <div className="row"><span>{b.label}</span><span>{b.pct === null ? "unknown" : `${b.pct}% used`}</span></div>
              <div className="bar" role="progressbar" aria-label={`${b.label} usage`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={b.pct ?? undefined}><span style={{ width: `${b.pct ?? 0}%` }} className={b.pct !== null && b.pct >= 80 ? "hot" : ""} /></div>
              <div className="muted small">{b.resetsAt ? `resets ${fmtLocal(b.resetsAt.toISOString())}` : "reset time unknown"}{b.status && b.status !== "allowed" ? ` · ${b.status}` : ""}</div>
            </div>))}
          <p className="muted small">{s.quota_note}{s.quota?.overage === "rejected" ? " Extra paid usage is off for this account." : ""}</p>
        </>
      )}

      <h3>What Claude is allowed to do</h3>
      <ul className="plain">{Object.entries(s.permissions).map(([k, val]) => (
        <li key={k}><strong>{PERM_LABEL[k] ?? k}:</strong> {Array.isArray(val) ? val.join(", ") : val}</li>))}
      </ul>

      <h3>Claude&apos;s last turn, as Claude Code itself reported</h3>
      <TurnFacts t={s.last_turn} none="No turn has run yet." />
      <h3>The independent reviewer&apos;s last run, as Claude Code reported</h3>
      <TurnFacts t={s.last_review_turn} none="No review has run yet." />

      <h3>Where the work is</h3>
      <dl className="facts">
        <dt>Branch</dt><dd>{s.workspace.branch ?? "none yet (created on the first change)"}</dd>
        <dt>Started from</dt><dd>{shortRev(s.workspace.base_revision)}</dd>
        <dt>Latest</dt><dd>{shortRev(s.workspace.head_revision)}</dd>
        <dt>Separate copy</dt><dd><code className="wrap">{s.workspace.worktree ?? "none yet"}</code></dd>
      </dl>
    </div>
  );
}
