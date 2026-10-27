import { useState } from "react";
import { celebrate } from "../core/celebrate";
import { MAX_STEPS, MissionConfig, MissionStep, Widget, missionProgress, targetText } from "../core/widgets";

export type MissionWidget = Extract<Widget, { kind: "mission" }>;

/** One life mission: how far along, the next step, every step you can tick, and a place to add more. No code, no repositories. */
export function MissionCard({ w, save, connected }: { w: MissionWidget; save: (w: MissionWidget, config: MissionConfig) => Promise<unknown> | void; connected: boolean }) {
  const [text, setText] = useState("");
  const c = w.config, p = missionProgress(c);
  const put = (steps: MissionStep[], extra: Partial<MissionConfig> = {}) => save(w, { ...c, ...extra, steps });
  const add = async () => {
    const t = text.trim();
    if (!t || c.steps.length >= MAX_STEPS) return;
    await put([...c.steps, { text: t, done: false }]);
    setText("");
  };
  return (
    <div className="mission">
      <p className="muted small">{targetText(c.target)}</p>
      <div className="meter" role="progressbar" aria-label={`Progress on ${w.title}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.percent}><span style={{ width: `${p.percent}%` }} /></div>
      <p className="small" aria-live="polite">{p.total === 0 ? "No steps yet. Add the first one." : p.next ? `${p.percent}% done. Next: ${p.next}` : `All ${p.total} steps done. Well done!`}</p>
      <ul className="plain">
        {c.steps.map((st, i) => (
          <li key={i} className="row">
            <label className="check"><input type="checkbox" checked={st.done} disabled={!connected}
              onChange={() => { if (!st.done) celebrate(w.id); void put(c.steps.map((x, j) => (j === i ? { ...x, done: !x.done } : x))); }} /> {st.text}</label>
            <button type="button" className="btn ghost" aria-label={`Remove step ${st.text}`} disabled={!connected} onClick={() => void put(c.steps.filter((_, j) => j !== i))}>×</button>
          </li>))}
      </ul>
      {c.steps.length < MAX_STEPS
        ? (
          <form className="row" onSubmit={(e) => { e.preventDefault(); void add(); }}>
            <input aria-label={`New step for ${w.title}`} value={text} maxLength={120} onChange={(e) => setText(e.target.value)} placeholder="Add a step" />
            <button type="submit" className="btn ghost" disabled={!connected || !text.trim()}>Add step</button>
          </form>)
        : <p className="muted small">A mission holds up to {MAX_STEPS} steps.</p>}
      <label className="field"><span>Target date (optional)</span>
        <input type="date" aria-label={`Target date for ${w.title}`} value={c.target} disabled={!connected} onChange={(e) => void put(c.steps, { target: e.target.value })} /></label>
    </div>
  );
}
