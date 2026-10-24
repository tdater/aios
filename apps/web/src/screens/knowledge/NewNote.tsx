import { useEffect, useState } from "react";
import { ApiError } from "../../core/client";
import { Memory } from "../../core/types";
import { TYPE_LABEL } from "../../core/vault";
import { useApp } from "../../ui/Context";
import { go } from "../../ui/hooks";
import { Btn, ErrorBox, Notice, useOnce } from "../../ui/kit";
import { toast } from "../../ui/uiState";
import { useTabTitle } from "../../ui/useTabTitle";
import { TagEditor } from "./NoteView";
import { newNoteTitle, useVault } from "./vaultContext";

/** Create a note by hand. A note you write yourself is your own statement, so it is saved as approved. */
export function NewNote() {
  const { client, connected } = useApp();
  const vault = useVault();
  const [title, setTitle] = useState(newNoteTitle.get());
  const [type, setType] = useState("fact");
  const [scope, setScope] = useState("global");
  const [project, setProject] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [body, setBody] = useState("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { newNoteTitle.set(""); }, []);
  useTabTitle(title ? `New: ${title}` : "New note");
  const create = useOnce(async () => {
    setErr(null);
    try {
      const m = await client.post<Memory>("/memories", { title, body: body || `# ${title}\n`, type, scope: project ? "project" : scope, project_id: project || null, tags });
      await vault.reload();
      toast("Note created");
      go({ tab: "knowledge", id: m.data.id });
    } catch (e) { setErr(e instanceof ApiError ? e.message : (e as Error).message); }
  });
  return (
    <div className="screen" style={{ margin: 0 }}>
      <h2>New note</h2>
      {!connected && <Notice tone="warn">You are offline. Notes can only be created while connected.</Notice>}
      <ErrorBox msg={err} />
      <label className="field"><span>Title</span><input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} autoFocus /></label>
      <div className="row" style={{ alignItems: "flex-start" }}>
        <label className="field" style={{ flex: 1, minWidth: 140 }}><span>Type</span><select value={type} onChange={(e) => setType(e.target.value)}>
          {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v.replace(/s$/, "")}</option>)}</select></label>
        <label className="field" style={{ flex: 1, minWidth: 140 }}><span>Project (optional)</span><select value={project} onChange={(e) => { setProject(e.target.value); if (e.target.value) setScope("project"); }}>
          <option value="">None (global)</option>{vault.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      </div>
      <div className="field"><span>Tags</span><TagEditor tags={tags} onChange={setTags} /></div>
      <label className="field"><span>Body (markdown)</span><textarea rows={14} value={body} onChange={(e) => setBody(e.target.value)} style={{ fontFamily: "var(--mono)" }}
        placeholder="Link notes with [[Note title]], tag with #tags, callouts with > [!tip]" /></label>
      <div className="row"><Btn busy={create.busy} disabled={!connected || !title.trim()} onClick={() => void create.run()}>Create note</Btn><Btn kind="ghost" onClick={() => history.back()}>Cancel</Btn></div>
    </div>
  );
}
