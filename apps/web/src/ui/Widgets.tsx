import { useState } from "react";
import { ApiError } from "../core/client";
import { WidgetData } from "../core/types";
import { useApp } from "./Context";
import { useLoad } from "./hooks";
import { ErrorBox } from "./kit";

/** Panels the owner created. They are data rendered as plain text: there is no code in a widget. */
export function WidgetStrip() {
  const { client, connected } = useApp();
  const list = useLoad(() => client.get<{ items: WidgetData[] }>("/widgets"), [client]);
  const [err, setErr] = useState<string | null>(null);
  const save = async (w: WidgetData, config: unknown) => {
    setErr(null);
    try { await client.put(`/widgets/${w.id}`, { config }); await list.reload(); } catch (e) { setErr(e instanceof ApiError ? e.message : (e as Error).message); }
  };
  const items = list.data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <section className="today" aria-label="Your panels">
      <ErrorBox msg={err} />
      {items.map((w) => (
        <article key={w.id} className="todaycard" aria-labelledby={`wdg-${w.id}`}>
          <h3 id={`wdg-${w.id}`}>{w.title}</h3>
          {w.kind === "note" && <p>{w.config.text}</p>}
          {w.kind === "counter" && (
            <div className="row"><strong aria-live="polite">{w.config.value}</strong>
              <button type="button" className="btn ghost" disabled={!connected} aria-label={`Add ${w.config.step} to ${w.title}`} onClick={() => void save(w, { ...w.config, value: w.config.value + w.config.step })}>+{w.config.step}</button>
              <button type="button" className="btn ghost" disabled={!connected} aria-label={`Subtract ${w.config.step} from ${w.title}`} onClick={() => void save(w, { ...w.config, value: w.config.value - w.config.step })}>−{w.config.step}</button></div>)}
          {w.kind === "checklist" && (
            <ul className="plain">{w.config.items.map((it, i) => (
              <li key={i}><label className="check"><input type="checkbox" checked={it.done} disabled={!connected}
                onChange={() => void save(w, { items: w.config.items.map((x, j) => (j === i ? { ...x, done: !x.done } : x)) })} /> {it.text}</label></li>))}</ul>)}
        </article>))}
    </section>
  );
}
