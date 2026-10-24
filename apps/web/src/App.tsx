import { useCallback, useEffect, useState } from "react";
import { api, ApiError, Approval, Health, Project, Provider, Run, RunDetail, Task } from "./api";

type View = "health" | "projects" | "tasks" | "runs" | "approvals" | "providers" | "planned";
const PLANNED: Record<string, string> = {
  workflows: "Workflow registry (Phase 2/3)",
  skills: "Skills registry and candidates (Phase 2/3)",
  memory: "Memory browser/editor (Phase 2)",
  research: "Research handoffs (Phase 2)",
  proposals: "Improvement proposals (Phase 3)",
};

// Storage can be missing or throw (private mode, blocked site data); preferences are optional.
function readPref(key: string, fallback: string): string {
  try {
    return window.localStorage?.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function writePref(key: string, value: string): void {
  try {
    window.localStorage?.setItem(key, value);
  } catch {
    /* preference simply isn't remembered */
  }
}

function useData<T>(path: string, pollMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    setLoading(true);
    void load();
    if (!pollMs) return;
    const t = setInterval(() => void load(), pollMs);
    return () => clearInterval(t);
  }, [load, pollMs]);
  return { data, error, loading, reload: load };
}

const Badge = ({ s }: { s: string }) => <span className={`badge ${s}`}>{s.replace("_", " ")}</span>;
const ErrorBox = ({ msg }: { msg: string | null }) =>
  msg ? <div className="err" role="alert">Error: {msg}</div> : null;
const Empty = ({ children }: { children: React.ReactNode }) => <div className="empty">{children}</div>;
const Loading = () => <p className="muted">Loading…</p>;

function Health_() {
  const { data: h, error, loading } = useData<Health>("/health", 4000);
  if (loading) return <Loading />;
  if (error || !h) return <ErrorBox msg={error ?? "backend unreachable"} />;
  const billable = Object.entries(h.billable_env);
  return (
    <>
      <h2>Health &amp; backups</h2>
      {billable.length > 0 && (
        <div className="warn" role="status">
          Metered-billing credentials detected in the environment (names only): {billable.map(([p, v]) => `${p}: ${v.join(", ")}`).join("; ")}. AIOS never uses them without explicit opt-in.
        </div>
      )}
      <div className="grid2">
        <div className="card">
          <h3>Service</h3>
          <p>Database <Badge s={h.db === "ok" ? "ok" : "error"} /> · schema {h.schema.join(", ")}</p>
          <p>Bound to <code>{h.host}:{h.port}</code> (loopback only)</p>
          <p>Private state: <code>{h.state_dir}</code></p>
          <p>Disk free: {h.disk_free_gb} GB</p>
          {h.startup.reconcile && (
            <p className="muted">Startup reconcile: {h.startup.reconcile.interrupted.length} interrupted run(s), {h.startup.reconcile.uncertain_steps} uncertain step(s)</p>
          )}
        </div>
        <div className="card">
          <h3>Runs by state</h3>
          {Object.keys(h.run_counts).length === 0 ? (
            <Empty>No runs yet.</Empty>
          ) : (
            <table><tbody>{Object.entries(h.run_counts).map(([k, v]) => (<tr key={k}><td><Badge s={k} /></td><td>{v}</td></tr>))}</tbody></table>
          )}
        </div>
      </div>
      <BackupCard h={h} />
    </>
  );
}

function BackupCard({ h }: { h: Health }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    setErr(null);
    try {
      const r = await api<{ path: string; bytes: number }>("/backup", { method: "POST", body: {} });
      setMsg(`Created ${r.path} (${r.bytes} bytes)`);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    }
  };
  return (
    <div className="card">
      <h3>Backup</h3>
      <p>Status: <Badge s={h.backup_status === "ok" ? "ok" : "pending"} /> {h.last_backup ? <code>{h.last_backup.path}</code> : "no backup has been taken"}</p>
      <ErrorBox msg={err} />
      {msg && <p>{msg}</p>}
      <button className="btn" onClick={run}>Back up now</button>
    </div>
  );
}

function Projects() {
  const { data, error, loading, reload } = useData<Project[]>("/projects");
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const add = async () => {
    setErr(null);
    try {
      await api("/projects", { method: "POST", body: { name, path } });
      setName(""); setPath(""); void reload();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    }
  };
  return (
    <>
      <h2>Projects</h2>
      <ErrorBox msg={error} />
      {loading ? <Loading /> : !data?.length ? <Empty>No projects registered. AIOS only reads folders you register here.</Empty> : (
        <div className="card"><table><thead><tr><th>Name</th><th>Workspace</th><th>Registered</th></tr></thead>
          <tbody>{data.map((p) => (<tr key={p.id}><td>{p.name}<div className="muted"><code>{p.id}</code></div></td><td><code>{p.path}</code></td><td>{p.created_at.slice(0, 19)}</td></tr>))}</tbody></table></div>
      )}
      <div className="card">
        <h3>Register a workspace</h3>
        <ErrorBox msg={err} />
        <label className="field"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span>Absolute folder path (must exist; broad system folders are refused)</span><input value={path} onChange={(e) => setPath(e.target.value)} placeholder="C:\aios-workspaces\sample-project" /></label>
        <button className="btn" disabled={!name || !path} onClick={add}>Register</button>
      </div>
    </>
  );
}

function Tasks({ onRun }: { onRun: (id: string) => void }) {
  const { data, error, loading, reload } = useData<Task[]>("/tasks", 3000);
  const projects = useData<Project[]>("/projects");
  const health = useData<Health>("/health");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("audit.workspace");
  const [project, setProject] = useState("");
  const [prompt, setPrompt] = useState("");
  const [provider, setProvider] = useState("claude");
  const [err, setErr] = useState<string | null>(null);
  const create = async () => {
    setErr(null);
    try {
      const spec = kind === "provider.task" ? { provider, prompt } : {};
      const acceptance = kind === "audit.workspace" ? [{ type: "artifact_kind", kind: "audit_report" }]
        : kind === "provider.task" ? [{ type: "artifact_kind", kind: provider === "mock" ? "provider_result" : "imported_result" }] : [];
      await api("/tasks", { method: "POST", body: { title, kind, project_id: project || null, spec, acceptance } });
      setTitle(""); void reload();
    } catch (e) { setErr(String(e instanceof Error ? e.message : e)); }
  };
  const start = async (id: string) => {
    setErr(null);
    try { const r = await api<Run>("/runs", { method: "POST", body: { task_id: id } }); onRun(r.id); }
    catch (e) { setErr(String(e instanceof Error ? e.message : e)); }
  };
  return (
    <>
      <h2>Tasks</h2>
      <ErrorBox msg={error ?? err} />
      {loading ? <Loading /> : !data?.length ? <Empty>No tasks yet.</Empty> : (
        <div className="card"><table><thead><tr><th>Task</th><th>Kind</th><th>Status</th><th /></tr></thead>
          <tbody>{data.map((t) => (<tr key={t.id}><td>{t.title}<div className="muted">{t.project_name ?? "no project"}</div></td><td><code>{t.kind}</code></td>
            <td><Badge s={t.status} />{t.status_reason && <div className="muted">{t.status_reason}</div>}</td>
            <td><button className="btn secondary" onClick={() => start(t.id)}>Run</button></td></tr>))}</tbody></table></div>
      )}
      <div className="card">
        <h3>New task</h3>
        <label className="field"><span>Title</span><input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <div className="grid2">
          <label className="field"><span>Kind</span><select value={kind} onChange={(e) => setKind(e.target.value)}>
            {(health.data?.executors ?? ["audit.workspace"]).filter((k) => !k.startsWith("demo.")).map((k) => <option key={k}>{k}</option>)}
          </select></label>
          <label className="field"><span>Project</span><select value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="">(none)</option>{projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></label>
        </div>
        {kind === "provider.task" && (<>
          <label className="field"><span>Provider</span><select value={provider} onChange={(e) => setProvider(e.target.value)}>
            {["claude", "gemini", "perplexity", "mock"].map((p) => <option key={p}>{p}</option>)}</select></label>
          <label className="field"><span>Prompt</span><textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} /></label>
        </>)}
        <button className="btn" disabled={!title} onClick={create}>Create task</button>
      </div>
    </>
  );
}

function Runs({ selected, select }: { selected: string | null; select: (id: string | null) => void }) {
  const { data, error, loading } = useData<Run[]>("/runs", 2000);
  return (
    <>
      <h2>Runs &amp; timeline</h2>
      <ErrorBox msg={error} />
      {loading ? <Loading /> : !data?.length ? <Empty>No runs yet. Start one from Tasks.</Empty> : (
        <div className="card"><table><thead><tr><th>Run</th><th>State</th><th>Attempts</th><th>Created</th></tr></thead>
          <tbody>{data.map((r) => (<tr key={r.id} className={`click ${selected === r.id ? "sel" : ""}`} tabIndex={0}
            onClick={() => select(r.id)} onKeyDown={(e) => e.key === "Enter" && select(r.id)}>
            <td>{r.task_title}<div className="muted"><code>{r.id}</code></div></td><td><Badge s={r.state} /></td>
            <td>{r.attempt}/{r.max_attempts}</td><td>{r.created_at.slice(0, 19)}</td></tr>))}</tbody></table></div>
      )}
      {selected && <RunPanel id={selected} />}
    </>
  );
}

function RunPanel({ id }: { id: string }) {
  const { data: d, error, reload } = useData<RunDetail>(`/runs/${id}`, 2000);
  const [text, setText] = useState("");
  const [source, setSource] = useState("");
  const [art, setArt] = useState<{ kind: string; content: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const op = async (path: string, body: unknown = {}) => {
    setErr(null);
    try { await api(path, { method: "POST", body }); setText(""); void reload(); }
    catch (e) { setErr(String(e instanceof Error ? e.message : e)); }
  };
  if (error && !d) return <ErrorBox msg={error} />;
  if (!d) return <Loading />;
  const r = d.run;
  const open = ["queued", "running", "awaiting_approval", "blocked", "interrupted"].includes(r.state);
  return (
    <div className="card">
      <div className="row"><h3 style={{ margin: 0 }}>{r.task_title}</h3><Badge s={r.state} />
        {open && <button className="btn danger" onClick={() => op(`/runs/${id}/cancel`)}>Cancel</button>}
        {(r.state === "blocked" || r.state === "interrupted") && <button className="btn secondary" onClick={() => op(`/runs/${id}/resume`)}>Resume</button>}</div>
      {r.state_reason && <p className="muted">{r.state_reason}</p>}
      <ErrorBox msg={err} />
      <p className="muted">iteration {r.iteration}/{r.max_iterations} · attempt {r.attempt}/{r.max_attempts}</p>
      {r.state === "blocked" && d.artifacts.some((a) => a.kind === "task_packet") && (
        <div className="card">
          <h3>Import result from your own session</h3>
          <p className="muted">Open the task packet below in a session you start yourself, then paste the result. It is stored as an UNVERIFIED claim.</p>
          <label className="field"><span>Source (e.g. "Claude Code session 2026-10-24")</span><input value={source} onChange={(e) => setSource(e.target.value)} /></label>
          <label className="field"><span>Result text</span><textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} /></label>
          <button className="btn" disabled={!text || !source} onClick={() => op(`/runs/${id}/import-result`, { text, source })}>Import</button>
        </div>
      )}
      <h3>Timeline</h3>
      <table><tbody>{d.events.map((e) => (<tr key={e.id}><td className="muted">{e.ts.slice(11, 23)}</td><td><code>{e.kind}</code></td><td>{e.message}</td></tr>))}</tbody></table>
      <h3>Steps</h3>
      {d.steps.length === 0 ? <Empty>No steps recorded.</Empty> : <table><tbody>{d.steps.map((s) => (<tr key={s.id}><td>{s.seq}</td><td>{s.name}{s.side_effect ? " (side effect)" : ""}</td><td><Badge s={s.state === "done" ? "ok" : s.state} /></td><td>{s.error}</td></tr>))}</tbody></table>}
      <h3>Evidence</h3>
      {d.evidence.length === 0 ? <Empty>No evidence recorded.</Empty> : <ul>{d.evidence.map((e) => <li key={e.id}><code>{e.kind}</code> {e.summary}</li>)}</ul>}
      <h3>Artifacts</h3>
      {d.artifacts.length === 0 ? <Empty>No artifacts.</Empty> : <table><tbody>{d.artifacts.map((a) => (<tr key={a.id}><td>{a.kind}</td><td className="muted">{a.provenance}</td><td><code>{a.sha256.slice(0, 12)}</code></td>
        <td><button className="btn secondary" onClick={async () => setArt(await api(`/artifacts/${a.id}`))}>View</button></td></tr>))}</tbody></table>}
      {art && <><h3>{art.kind}</h3><pre>{art.content}</pre></>}
    </div>
  );
}

function Approvals() {
  const { data, error, loading, reload } = useData<Approval[]>("/approvals", 2000);
  const [err, setErr] = useState<string | null>(null);
  const decide = async (id: string, approve: boolean) => {
    setErr(null);
    try { await api(`/approvals/${id}/decide`, { method: "POST", body: { approve } }); void reload(); }
    catch (e) { setErr(String(e instanceof Error ? e.message : e)); }
  };
  return (
    <>
      <h2>Approval inbox</h2>
      <ErrorBox msg={error ?? err} />
      {loading ? <Loading /> : !data?.length ? <Empty>No approval requests.</Empty> : data.map((a) => (
        <div className="card" key={a.id}>
          <div className="row"><Badge s={a.status} /><strong>{a.summary}</strong></div>
          <p className="muted">Bound to action hash <code>{a.action_hash.slice(0, 16)}</code> · single use · run <code>{a.run_id}</code></p>
          <pre>{JSON.stringify(a.action, null, 2)}</pre>
          {a.status === "pending" && <div className="row"><button className="btn" onClick={() => decide(a.id, true)}>Approve exactly this</button>
            <button className="btn danger" onClick={() => decide(a.id, false)}>Reject</button></div>}
        </div>))}
    </>
  );
}

function Providers() {
  const { data, error, loading, reload } = useData<Provider[]>("/providers");
  return (
    <>
      <h2>Providers</h2>
      <p className="muted">Mode shows what AIOS can really do; billing shows what it would cost. Usage is “unknown” unless a provider reports it.</p>
      <ErrorBox msg={error} />
      <button className="btn secondary" onClick={async () => { await api("/providers/refresh", { method: "POST", body: {} }); void reload(); }}>Re-check</button>
      {loading ? <Loading /> : !data?.length ? <Empty>Discovery has not finished yet; press Re-check.</Empty> : data.map((p) => (
        <div className="card" key={p.provider} style={{ marginTop: 14 }}>
          <div className="row"><h3 style={{ margin: 0 }}>{p.provider}</h3><Badge s={p.mode} /><span className="badge">billing: {p.billing}</span></div>
          {typeof p.detail.warning === "string" && <div className="warn">{p.detail.warning}</div>}
          <pre>{JSON.stringify(p.detail, null, 2)}</pre>
        </div>))}
    </>
  );
}

export default function App() {
  const [view, setView] = useState<View>("health");
  const [planned, setPlanned] = useState("workflows");
  const [run, setRun] = useState<string | null>(null);
  const [theme, setTheme] = useState(() => readPref("aios.theme", "dark"));
  const [density, setDensity] = useState(() => readPref("aios.density", "comfortable"));
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.density = density;
    writePref("aios.theme", theme);
    writePref("aios.density", density);
  }, [theme, density]);
  const nav = (v: View, label: string, extra?: string) => (
    <button key={extra ?? v} aria-current={view === v && (v !== "planned" || planned === extra) ? "page" : undefined}
      className={v === "planned" ? "soon" : ""} onClick={() => { setView(v); if (extra) setPlanned(extra); }}>{label}</button>
  );
  return (
    <div className="app">
      <nav aria-label="Main">
        <h1>AIOS</h1>
        {nav("health", "Health")}{nav("projects", "Projects")}{nav("tasks", "Tasks")}{nav("runs", "Runs")}
        {nav("approvals", "Approvals")}{nav("providers", "Providers")}
        {Object.entries(PLANNED).map(([k, v]) => nav("planned", v.split(" (")[0], k))}
        <div className="spacer" />
        <label>Theme<select value={theme} onChange={(e) => setTheme(e.target.value)}><option value="dark">Dark</option><option value="light">Light</option></select></label>
        <label>Density<select value={density} onChange={(e) => setDensity(e.target.value)}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label>
      </nav>
      <main>
        {view === "health" && <Health_ />}
        {view === "projects" && <Projects />}
        {view === "tasks" && <Tasks onRun={(id) => { setRun(id); setView("runs"); }} />}
        {view === "runs" && <Runs selected={run} select={setRun} />}
        {view === "approvals" && <Approvals />}
        {view === "providers" && <Providers />}
        {view === "planned" && (<><h2>{PLANNED[planned]}</h2><Empty>Not implemented yet. Nothing is shown because nothing exists; no placeholder data.</Empty></>)}
      </main>
    </div>
  );
}
