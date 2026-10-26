import { useState } from "react";
import { starSummary } from "../core/sky";
import { Constellation, Skyline, Star, StarEvidence } from "../core/types";
import { useApp } from "../ui/Context";
import { go, useLoad } from "../ui/hooks";
import { Badge, Collapsible, Empty, ErrorBox, Loading, ago } from "../ui/kit";
import { ConstellationView, SkylineView } from "../ui/Sky";
import { useTabTitle } from "../ui/useTabTitle";

type Tab = "constellation" | "skyline";

function Evidence({ star, onClose }: { star: Star; onClose: () => void }) {
  const { client } = useApp();
  const ev = useLoad(() => client.get<StarEvidence>(`/constellation/${star.id}`), [client, star.id]);
  return (
    <div className="card" role="region" aria-label={`Evidence for ${star.title}`}>
      <div className="row"><h3>{star.title}</h3><button type="button" className="btn ghost" onClick={onClose}>Close</button></div>
      <p className="muted small">{starSummary(star)}</p>
      {star.state === "stale" && <p className="small">Not reviewed for a while. Open it in Knowledge to confirm it is still true.</p>}
      {ev.error && <ErrorBox msg={ev.error} />}
      {ev.loading && <Loading />}
      {ev.data && (ev.data.uses.length === 0 ? <Empty>No AI has been given this yet.</Empty> : (
        <ul className="plain">{ev.data.uses.map((u) => (
          <li key={u.run_id}>{u.conversation ?? "a conversation"} · {ago(u.at)} · {u.verified ? <Badge s="succeeded" label="tests passed afterwards" /> : <Badge s="pending" label="not verified" />}</li>))}</ul>))}
      <button type="button" className="btn" onClick={() => go({ tab: "knowledge", id: star.id })}>Open the memory</button>
    </div>
  );
}

export function InsightsScreen() {
  useTabTitle("Insights");
  const { client } = useApp();
  const [tab, setTab] = useState<Tab>("constellation");
  const [sel, setSel] = useState<string | null>(null);
  const con = useLoad(() => client.get<Constellation>("/constellation"), [client]);
  const sky = useLoad(() => client.get<Skyline>("/skyline"), [client]);
  const star = con.data?.stars.find((s) => s.id === sel) ?? null;
  return (
    <div className="screen">
      <h1>Insights</h1>
      <div className="tabs" role="tablist" aria-label="Insights">
        {(["constellation", "skyline"] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`tab ${tab === t ? "on" : ""}`} onClick={() => setTab(t)}>{t === "constellation" ? "What AIOS remembers" : "Your projects"}</button>))}
      </div>
      {tab === "constellation" && (
        <div>
          {con.error && <ErrorBox msg={con.error} />}
          {con.loading && !con.data && <Loading />}
          {con.data && (con.data.stars.length === 0 ? <Empty>Nothing is remembered yet. Approved memories appear here as stars.</Empty> : (
            <>
              <p className="muted small">{con.data.totals.stars} memories · {con.data.totals.verified} followed by passing tests · {con.data.totals.hollow} used but never verified · {con.data.totals.stale} due for review.
                Brighter means it was given to an AI and the tests then passed. A hollow outline means it was used but never verified.</p>
              <ConstellationView data={con.data} selected={sel} onSelect={setSel} />
              <ul className="legend small" aria-label="Shapes">
                <li>★ lesson</li><li>◆ decision</li><li>● preference</li><li>■ fact</li><li>▲ procedure</li>
              </ul>
              {star && <Evidence star={star} onClose={() => setSel(null)} />}
              <Collapsible title="Same thing as a list" count={con.data.stars.length}>
                <ul className="plain">{con.data.stars.map((s) => <li key={s.id}><button type="button" className="linklike" onClick={() => setSel(s.id)}>{starSummary(s)}</button></li>)}</ul>
              </Collapsible>
            </>))}
        </div>)}
      {tab === "skyline" && (
        <div>
          {sky.error && <ErrorBox msg={sky.error} />}
          {sky.loading && !sky.data && <Loading />}
          {sky.data && (sky.data.projects.length === 0 ? <Empty>No projects yet.</Empty> : (
            <>
              <p className="muted small">One building per project. Each floor is a change whose tests AIOS ran and saw pass. Lit windows: work running now. Scaffolding: waiting for you.</p>
              <SkylineView projects={sky.data.projects} onOpen={(id) => go({ tab: "projects", id })} />
            </>))}
        </div>)}
    </div>
  );
}
