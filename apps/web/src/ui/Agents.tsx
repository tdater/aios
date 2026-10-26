import { AgentCardData } from "../core/assist";
import { COMPANION_SITES, openCompanion } from "../core/companion";
import { Btn } from "./kit";
import { AgentAvatar } from "./PlanView";

const STATUS: Record<AgentCardData["status"], string> = { working: "Working", needs_you: "Waiting for you", idle: "Ready", offline: "Not signed in", on_call: "On call", manual: "Manual" };

/** The AIs you have, what each is for, and what it is doing right now. Honest about which ones need copy and paste. */
export function Agents({ agents }: { agents: AgentCardData[] }) {
  return (
    <section className="agents" aria-label="Your agents">
      <h2 className="sect">Your agents</h2>
      <ul className="agent-grid">
        {agents.map((a) => {
          const five = a.quota?.five_hour?.utilization;
          return (
            <li key={a.id} className={`agent ag-${a.id} st-${a.status}`}>
              <div className="agent-top">
                <AgentAvatar agent={a.id} size={38} />
                <div className="agent-id"><strong>{a.name}</strong><span className="muted small">{a.role}</span></div>
                <span className={`status ${a.status}`}><span className="dotmark" aria-hidden="true" />{STATUS[a.status]}</span>
              </div>
              <p className="agent-doing">{a.doing ? <>Now: {a.doing}</> : a.status === "offline" ? <>Sign in once by running <code>claude</code> in a terminal.</> : <span className="muted">{a.how}</span>}</p>
              {typeof five === "number" && <div className="meter" role="img" aria-label={`${Math.round(five * 100)} percent of your 5-hour Claude usage`}><span style={{ width: `${Math.min(100, Math.round(five * 100))}%` }} /><em>5-hour usage {Math.round(five * 100)}%</em></div>}
              {COMPANION_SITES[a.id] && <Btn kind="ghost" onClick={() => openCompanion(a.id)}>{`Open ${a.name}`}</Btn>}
            </li>);
        })}
      </ul>
    </section>
  );
}
