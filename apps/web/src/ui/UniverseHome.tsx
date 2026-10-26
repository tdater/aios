import { useState } from "react";
import { Universe } from "../core/types";
import { useApp } from "./Context";
import { useLoad } from "./hooks";
import { Loading } from "./kit";
import { Selection, UniverseLegend, UniverseMap, UniversePanel } from "./Universe";

/** The first thing on Home: your universe, what each part means, and details for whatever you pick. */
export function UniverseHome() {
  const { client } = useApp();
  const uni = useLoad(() => client.get<Universe>("/universe"), [client], 15000);
  const [sel, setSel] = useState<Selection>(null);
  if (uni.loading && !uni.data) return <Loading what="Loading your universe" />;
  if (!uni.data) return <p className="muted small">The map is not available right now{uni.error ? ` (${uni.error})` : ""}. Everything below still works.</p>;
  const u = uni.data;
  return (
    <section className="universe-home" aria-label="Your universe">
      <div className="universe-grid">
        <UniverseMap u={u} sel={sel} onSelect={setSel} />
        <div className="universe-side" aria-live="polite">
          <UniversePanel u={u} sel={sel} reload={uni.reload} onClose={() => setSel(null)} />
        </div>
      </div>
      <UniverseLegend />
    </section>
  );
}
