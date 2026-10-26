import { useState } from "react";
import { ApiError } from "../../core/client";
import { Conversation, Paged, Project, Provider } from "../../core/types";
import { MODEL_CHOICES } from "../../core/work";
import { useApp } from "../../ui/Context";
import { go, useLoad } from "../../ui/hooks";
import { Badge, Btn, Empty, ErrorBox, Loading, Notice, ago, useOnce } from "../../ui/kit";

export function WorkPicker() {
  const { client, connected } = useApp();
  const provs = useLoad(() => client.get<{ items: Provider[] }>("/providers"), [client]);
  const convs = useLoad(() => client.get<Paged<Conversation>>("/conversations", { query: { limit: 50 } }), [client], 8000);
  const projects = useLoad(() => client.get<Paged<Project>>("/projects", { query: { limit: 200 } }), [client]);
  const claude = provs.data?.items.find((p) => p.provider === "claude");
  const unavailable = claude && claude.mode === "unavailable";
  return (
    <div className="screen">
      <h2>Workspace</h2>
      <p className="muted">
        Talk to Claude about one of your projects. When Claude changes code, the changes are made in a separate copy.
        You review them, AIOS checks them with your tests, and nothing touches your real files until you decide.
      </p>
      {unavailable && (
        <Notice tone="warn">
          <strong>Claude Code is not usable on this computer right now.</strong> {String((claude.detail as { reason?: string }).reason ?? "")}
          {" "}You can look around, but you cannot start a conversation until it works.
        </Notice>
      )}
      {claude && claude.billing === "metered_api_possible" && (
        <Notice tone="bad">An API key is set in this computer&apos;s environment, so Claude Code might bill it instead of your subscription. AIOS will refuse to run until that is removed.</Notice>
      )}
      <ErrorBox msg={convs.error} code={convs.errorCode} />
      <h3>Your conversations</h3>
      {convs.loading && !convs.data ? <Loading /> : !convs.data?.items.length && !convs.error ? (
        <Empty>No conversations yet. Start one below.</Empty>
      ) : (
        <ul className="cards">{convs.data?.items.map((c) => (
          <li key={c.id}>
            <button className="card-btn" onClick={() => go({ tab: "work", id: c.id })}>
              <span className="row"><strong>{c.title}</strong>{c.branch && <Badge s="running" label="has changes" />}</span>
              <span className="muted small">{c.project_name ?? "project"} · {c.model ?? "account default model"} · updated {ago(c.updated_at)}</span>
            </button>
          </li>))}
        </ul>
      )}
      <NewConversation projects={projects.data?.items ?? []} loading={projects.loading} disabled={!connected || !!unavailable} onProjectsChanged={() => void projects.reload()} />
    </div>
  );
}

function NewConversation({ projects, loading, disabled, onProjectsChanged }: { projects: Project[]; loading: boolean; disabled: boolean; onProjectsChanged: () => void }) {
  const { client } = useApp();
  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState("");
  const [model, setModel] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const chosen = projectId || projects[0]?.id || "";
  const everyday = useOnce(async () => {                  // a plain folder under the workspaces folder: chat without a code project
    setErr(null);
    try { await client.post("/everyday"); onProjectsChanged(); } catch (e) { setErr(e instanceof ApiError ? e.message : (e as Error).message); }
  });
  const start = useOnce(async () => {
    setErr(null);
    try {
      const r = await client.post<Conversation>("/conversations", { project_id: chosen, title: title.trim() || undefined, model: model || undefined });
      go({ tab: "work", id: r.data.id });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : (e as Error).message);
    }
  });
  if (!loading && projects.length === 0) {
    return (
      <div className="card">
        <h3>Start a conversation</h3>
        <Empty>Chat about anything with no setup, or point AIOS at a project folder when you want help with its files.</Empty>
        <ErrorBox msg={err} />
        <div className="row">
          <Btn busy={everyday.busy} disabled={disabled} onClick={() => void everyday.run()}>Start with an Everyday space</Btn>
          <Btn kind="ghost" onClick={() => go({ tab: "projects" })}>Register a project folder</Btn>
        </div>
      </div>
    );
  }
  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); void start.run(); }} aria-label="Start a conversation">
      <h3>Start a conversation</h3>
      <ErrorBox msg={err} />
      <label className="field"><span>Project</span>
        <select value={chosen} onChange={(e) => setProjectId(e.target.value)}>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <label className="field"><span>What is it about? (optional)</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Fix the login bug" maxLength={200} />
      </label>
      <label className="field"><span>Which Claude model</span>
        <select value={model} onChange={(e) => setModel(e.target.value)}>
          {MODEL_CHOICES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <p className="muted small">Runs use your own Claude subscription. Bigger models use more of your usage limits; the Status tab shows how much you have used.</p>
      <Btn type="submit" busy={start.busy} disabled={disabled || !chosen}>Start</Btn>
      {disabled && <p className="muted small">Starting a conversation needs a connection and a working Claude Code.</p>}
    </form>
  );
}
