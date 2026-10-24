import { useEffect, useState } from "react";
import { ApiError, newKey } from "../core/client";
import { Paged, Project, Run, Task } from "../core/types";
import { useApp } from "../ui/Context";
import { go, useLoad } from "../ui/hooks";
import { Badge, Btn, Empty, ErrorBox, Loading, Notice, ago, useOnce } from "../ui/kit";

export function Projects({ id }: { id?: string }) {
  return id ? <ProjectDetail id={id} /> : <ProjectList />;
}

function ProjectList() {
  const { client, cache, partition, connected } = useApp();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Project[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const first = useLoad(async () => {
    const r = await client.get<Paged<Project>>("/projects", { query: { q, limit: 20 } });
    setItems(r.items);
    setCursor(r.next_cursor);
    if (!q) cache.put(partition, "projects", r.items.map((p) => ({ id: p.id, name: p.name })));
    return r;
  }, [client, q]);
  const more = useOnce(async () => {
    if (!cursor) return;
    const r = await client.get<Paged<Project>>("/projects", { query: { q, limit: 20, cursor } });
    setItems((x) => [...x, ...r.items]);
    setCursor(r.next_cursor);
  });
  const cached = cache.get<{ id: string; name: string }[]>(partition, "projects");
  return (
    <div className="screen">
      <h2>Projects</h2>
      <label className="field"><span>Search projects</span><input type="search" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      <ErrorBox msg={first.error} code={first.errorCode} />
      {first.error && cached && (
        <Notice tone="info">Offline list from {ago(cached.at)} (names only; status is not shown because it may be stale):
          <ul>{cached.value.map((p) => <li key={p.id}>{p.name}</li>)}</ul></Notice>
      )}
      {first.loading && !items.length ? <Loading /> : !items.length && !first.error ? (
        <Empty>{q ? "No projects match." : "No projects registered yet."}</Empty>
      ) : (
        <ul className="cards">
          {items.map((p) => (
            <li key={p.id}><button className="card-btn" onClick={() => go({ tab: "projects", id: p.id })}>
              <strong>{p.name}</strong><span className="muted small">{p.path}</span></button></li>
          ))}
        </ul>
      )}
      {cursor && <Btn kind="ghost" busy={more.busy} onClick={() => void more.run()}>Load more</Btn>}
      <RegisterProject disabled={!connected} onDone={() => void first.reload()} />
    </div>
  );
}

function RegisterProject({ disabled, onDone }: { disabled: boolean; onDone: () => void }) {
  const { client } = useApp();
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const reg = useOnce(async () => {
    setErr(null);
    try {
      await client.post("/projects", { name, path });
      setName(""); setPath(""); onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  });
  return (
    <details className="card">
      <summary>Register a workspace</summary>
      <p className="muted small">The path is a folder on the <strong>server</strong> machine. AIOS only ever reads registered folders.</p>
      <ErrorBox msg={err} />
      <label className="field"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label className="field"><span>Server folder path</span><input value={path} onChange={(e) => setPath(e.target.value)} /></label>
      <Btn busy={reg.busy} disabled={disabled || !name || !path} onClick={() => void reg.run()}>Register</Btn>
    </details>
  );
}

interface Detail { project: Project; tasks: Task[]; recent_runs: Run[] }

function ProjectDetail({ id }: { id: string }) {
  const { client } = useApp();
  const d = useLoad(() => client.get<Detail>(`/projects/${id}`), [client, id], 5000);
  return (
    <div className="screen">
      <Btn kind="ghost" onClick={() => history.back()}>← Projects</Btn>
      <ErrorBox msg={d.error} code={d.errorCode} />
      {d.loading && !d.data && <Loading />}
      {d.data && (
        <>
          <h2>{d.data.project.name}</h2>
          <p className="muted small">{d.data.project.path}</p>
          <h3>Recent runs</h3>
          {d.data.recent_runs.length === 0 ? <Empty>No runs yet.</Empty> : (
            <ul className="cards">{d.data.recent_runs.map((r) => (
              <li key={r.id}><button className="card-btn" onClick={() => go({ tab: "runs", id: r.id })}>
                <span className="row"><strong>{r.task_title}</strong><Badge s={r.display_state} /></span>
                <span className="muted small">{ago(r.created_at)}</span></button></li>))}</ul>
          )}
          <h3>Tasks</h3>
          {d.data.tasks.length === 0 ? <Empty>No tasks yet.</Empty> : (
            <ul className="cards">{d.data.tasks.map((t) => (
              <li key={t.id} className="card-static"><span className="row"><strong>{t.title}</strong><Badge s={t.status === "done" ? "completed" : t.status} /></span>
                <span className="muted small">{t.kind}{t.status_reason ? ` · ${t.status_reason}` : ""}</span></li>))}</ul>
          )}
          <NewTask projectId={id} onDone={() => void d.reload()} />
        </>
      )}
    </div>
  );
}

const KINDS = [
  { kind: "audit.workspace", label: "Audit workspace (read-only)", acceptance: [{ type: "artifact_kind", kind: "audit_report" }] },
  { kind: "capture.note", label: "Note for this project", acceptance: [{ type: "artifact_kind", kind: "note" }] },
];

function NewTask({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const { client, connected } = useApp();
  const [kind, setKind] = useState(KINDS[0].kind);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  // One idempotency key per *submission attempt*; reused on retry, replaced only after success.
  const [key, setKey] = useState(() => `task-${newKey()}`);
  const submit = useOnce(async () => {
    setErr(null);
    const k = KINDS.find((x) => x.kind === kind)!;
    try {
      const r = await client.post<{ run: { id: string } | null }>("/tasks", {
        title: title || k.label, kind, project_id: projectId, spec: kind === "capture.note" ? { text } : {},
        acceptance: k.acceptance, start_run: true }, { idempotencyKey: key });
      setKey(`task-${newKey()}`); setTitle(""); setText(""); onDone();
      if (r.data.run) go({ tab: "runs", id: r.data.run.id });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : `${(e as Error).message} The request may have been received; retrying is safe (same key).`);
    }
  });
  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); void submit.run(); }}>
      <h3>New task</h3>
      <ErrorBox msg={err} />
      <label className="field"><span>Type</span><select value={kind} onChange={(e) => setKind(e.target.value)}>{KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}</select></label>
      <label className="field"><span>Title</span><input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      {kind === "capture.note" && <label className="field"><span>Note</span><textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} /></label>}
      <Btn type="submit" busy={submit.busy} disabled={!connected || (kind === "capture.note" && !text.trim())}>Submit and run</Btn>
      {!connected && <p className="muted small">Tasks can only be submitted while connected.</p>}
    </form>
  );
}
