import { useState } from "react";
import { ApiError } from "../../core/client";
import { MissionConfig, Widget, daysToTarget, listWidgets, missionProgress, saveWidget } from "../../core/widgets";
import { useApp } from "../../ui/Context";
import { useLoad } from "../../ui/hooks";
import { Btn, Empty, ErrorBox, Loading, Notice } from "../../ui/kit";
import { MissionCard, MissionWidget } from "../../ui/Mission";

const msg = (e: unknown) => (e instanceof ApiError ? e.message : (e as Error).message);
const isMission = (w: Widget): w is MissionWidget => w.kind === "mission";

/** Life missions: goals for everyday life with a target date and steps. The same panels that show up in My Day and as probes in the universe. */
export function MissionBoard() {
  const { client, connected } = useApp();
  const all = useLoad(() => listWidgets(client), [client]);
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [needsAbility, setNeedsAbility] = useState(false);
  const [busy, setBusy] = useState(false);
  const missions = (all.data ?? []).filter(isMission).sort((a, b) => (daysToTarget(a.config.target) ?? 1e9) - (daysToTarget(b.config.target) ?? 1e9));

  const create = async () => {
    if (busy || !title.trim()) return;
    setBusy(true); setErr(null);
    try {
      await client.post("/widgets", { kind: "mission", title: title.trim(), config: { target, steps: [], note: "" } });
      setTitle(""); setTarget(""); setNeedsAbility(false);
      await all.reload();
    } catch (e) {
      if (e instanceof ApiError && e.code === "ability_off") setNeedsAbility(true); else setErr(msg(e));
    } finally { setBusy(false); }
  };
  const turnOn = async () => {
    setErr(null);
    try { await client.put("/abilities/widgets", { enabled: true, confirm: true }); setNeedsAbility(false); await create(); } catch (e) { setErr(msg(e)); }
  };
  const save = async (w: MissionWidget, config: MissionConfig) => {
    setErr(null);
    try { await saveWidget(client, w.id, config); await all.reload(); } catch (e) { setErr(msg(e)); }
  };

  return (
    <section aria-label="Life missions">
      <p className="muted small">Goals for everyday life, like planning a trip or sorting the taxes. Each one has steps you tick off and an optional date. Nothing here touches code or files.</p>
      <ErrorBox msg={err ?? all.error} />
      {needsAbility && (
        <Notice tone="info">Missions live in your small panels, which are switched off. Turning them on lets AIOS keep these on Today and in your universe, and you can switch them off again in Settings.
          <Btn kind="ghost" onClick={() => void turnOn()}>Turn on small panels</Btn></Notice>)}
      <form className="card row" onSubmit={(e) => { e.preventDefault(); void create(); }}>
        <label className="field grow"><span>New mission</span><input value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} placeholder="Plan the summer trip" /></label>
        <label className="field"><span>Target date (optional)</span><input type="date" value={target} onChange={(e) => setTarget(e.target.value)} /></label>
        <Btn type="submit" busy={busy} disabled={!connected || !title.trim()}>Start mission</Btn>
      </form>
      {all.loading && !all.data ? <Loading /> : missions.length === 0 ? <Empty>No missions yet. Start one above.</Empty> : (
        <ul className="cards missions">{missions.map((w) => (
          <li key={w.id} className="card" aria-label={w.title}>
            <h3>{w.title} <span className="muted small">{missionProgress(w.config).percent}%</span></h3>
            <MissionCard w={w} connected={connected} save={save} />
          </li>))}</ul>)}
    </section>
  );
}
