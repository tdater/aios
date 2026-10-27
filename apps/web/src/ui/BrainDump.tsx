import { useState } from "react";
import { DumpItem, sortBrainDump } from "../core/braindump";
import { topChecklist } from "../core/dispatch";
import { ApiError } from "../core/client";
import { MAX_ITEMS, Widget } from "../core/widgets";
import { useApp } from "./Context";
import { VoiceButton } from "./VoiceButton";

type ChecklistWidget = Extract<Widget, { kind: "checklist" }>;
const LABEL = { todo: "To do", shopping: "To buy", note: "To remember" } as const;
const msg = (e: unknown) => (e instanceof ApiError ? e.message : (e as Error).message);

/** Say or type everything on your mind. AIOS sorts it into to-dos, shopping and notes on this computer, shows you the list, and saves only what you accept. */
export function BrainDump({ widgets, saveChecklist, connected }: { widgets: Widget[]; saveChecklist: (w: ChecklistWidget, items: ChecklistWidget["config"]["items"]) => Promise<void>; connected: boolean }) {
  const { client } = useApp();
  const [text, setText] = useState("");
  const [items, setItems] = useState<(DumpItem & { on: boolean })[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const shoppingList = widgets.find((w): w is ChecklistWidget => w.kind === "checklist" && /shopping/i.test(w.title)) ?? null;
  const todoList = topChecklist(widgets);

  const sort = () => { setDone(null); setErr(null); setItems(sortBrainDump(text).map((i) => ({ ...i, on: true }))); };
  const edit = (id: number, patch: Partial<DumpItem & { on: boolean }>) => setItems((l) => (l ?? []).map((i) => (i.id === id ? { ...i, ...patch } : i)));

  const save = async () => {
    if (!items || busy) return;
    const chosen = items.filter((i) => i.on && i.text.trim());
    setBusy(true); setErr(null);
    try {
      const add = async (list: ChecklistWidget | null, what: DumpItem[]) => {
        if (!what.length) return;
        if (!list) throw new Error("There is no checklist to put these on yet. Add a top 3 or shopping list panel first.");
        if (list.config.items.length + what.length > MAX_ITEMS) throw new Error(`"${list.title}" holds up to ${MAX_ITEMS} items. Tick some off first.`);
        await saveChecklist(list, [...list.config.items, ...what.map((i) => ({ text: i.text.trim().slice(0, 120), done: false }))]);
      };
      await add(todoList, chosen.filter((i) => i.kind === "todo"));
      await add(shoppingList ?? todoList, chosen.filter((i) => i.kind === "shopping"));
      for (const n of chosen.filter((i) => i.kind === "note")) {
        await client.post("/memories", { title: n.text.trim().slice(0, 200), body: `# ${n.text.trim().slice(0, 200)}\n\nFrom a brain dump.`, type: "fact", scope: "global", tags: ["brain-dump"] });
      }
      setDone(`Saved ${chosen.length} item${chosen.length === 1 ? "" : "s"}.`);
      setItems(null); setText("");
    } catch (e) { setErr(msg(e)); } finally { setBusy(false); }
  };

  return (
    <section className="braindump" aria-label="Brain dump">
      <h4>Brain dump</h4>
      <p className="muted small">Say or type whatever is on your mind. AIOS sorts it here on this computer, and nothing is saved until you accept it.</p>
      <div className="row">
        <label className="field grow"><span>What is on your mind?</span><textarea rows={3} value={text} onChange={(e) => { setText(e.target.value); setItems(null); }} /></label>
        <VoiceButton label="Speak your brain dump" onText={(t) => { setText(t); setItems(null); }} />
      </div>
      <button type="button" className="btn ghost" disabled={!text.trim()} onClick={sort}>Sort it</button>
      {done && <p role="status">{done}</p>}
      {err && <p role="alert" className="note bad">{err}</p>}
      {items && (items.length === 0 ? <p className="muted small">I did not find anything to do, buy or remember in that. Try saying it as &ldquo;remember to…&rdquo;, &ldquo;we need…&rdquo; or &ldquo;write down that…&rdquo;.</p> : (
        <>
          <ul className="plain">{items.map((i) => (
            <li key={i.id} className="row">
              <label className="check"><input type="checkbox" checked={i.on} onChange={(e) => edit(i.id, { on: e.target.checked })} aria-label={`Keep: ${i.text}`} /> <span className="chip">{LABEL[i.kind]}</span></label>
              <input aria-label={`Text for item ${i.id}`} value={i.text} maxLength={200} onChange={(e) => edit(i.id, { text: e.target.value })} />
            </li>))}</ul>
          <button type="button" className="btn primary" disabled={!connected || busy || !items.some((i) => i.on)} onClick={() => void save()}>Save {items.filter((i) => i.on).length} selected</button>
        </>))}
    </section>
  );
}
