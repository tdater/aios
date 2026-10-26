import { useState } from "react";
import { Universe } from "../core/types";
import { useApp } from "./Context";
import { useLoad } from "./hooks";
import { Loading } from "./kit";
import { Selection, UniverseLegend, UniverseMap, UniversePanel } from "./Universe";
import { UniverseSpace } from "./Space3D";

/** The first thing on Home: your universe, what each part means, and details for whatever you pick. */
export function UniverseHome() {
  const { client, settings, updateSettings } = useApp();
  const uni = useLoad(() => client.get<Universe>("/universe"), [client], 15000);
  const [sel, setSel] = useState<Selection>(null);
  if (uni.loading && !uni.data) return <Loading what="Loading your universe" />;
  if (!uni.data) return <p className="muted small">The map is not available right now{uni.error ? ` (${uni.error})` : ""}. Everything below still works.</p>;
  const u = uni.data;
  return (
    <section className="universe-home" aria-label="Your universe">
      <div className="universe-grid">
        {settings.universeView === "flat"
          ? <div className="space3d"><div className="space-bar"><button type="button" onClick={() => updateSettings({ universeView: "3d" })}>3D space</button></div><UniverseMap u={u} sel={sel} onSelect={setSel} /></div>
          : <UniverseSpace u={u} sel={sel} onSelect={setSel} onFlat={() => updateSettings({ universeView: "flat" })} />}
        <div className="universe-side" aria-live="polite">
          <UniversePanel u={u} sel={sel} reload={uni.reload} onClose={() => setSel(null)} />
        </div>
      </div>
      <UniverseLegend />
    </section>
  );
}
