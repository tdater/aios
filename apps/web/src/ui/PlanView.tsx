import { AGENT_GLYPH, AGENT_NAME, AssistKind, KIND_ICON, PlanStep, splitSteps, StepStatus, STATUS_TEXT, STEP_STATE_TEXT } from "../core/assist";
import { Icon, IconName } from "./icons";

export function AgentAvatar({ agent, size = 28 }: { agent: string; size?: number }) {
  return <span className={`avatar ag-${agent}`} style={{ width: size, height: size, fontSize: size * 0.42 }} aria-hidden="true" title={AGENT_NAME[agent] ?? agent}>{AGENT_GLYPH[agent] ?? "?"}</span>;
}

const STATUS_ICON: Record<StepStatus, IconName> = { pending: "clock", running: "loader", waiting: "alert", done: "check", failed: "x", skipped: "minus", offer: "sparkle" };

/** What AIOS will do with a request: the steps that apply, who does each, and the ones left out with the reason. Shown before anything starts. */
export function PlanView({ kind, label, reasons, steps, confidence }: { kind: AssistKind; label: string; reasons: string[]; steps: (PlanStep & { status?: StepStatus })[]; confidence?: string }) {
  const { active, skipped } = splitSteps(steps);
  return (
    <section className="plan" aria-label="How AIOS will handle this">
      <header className="plan-head">
        <span className="plan-kind"><Icon name={KIND_ICON[kind]} size={16} />{label}</span>
        {confidence === "chosen" && <span className="tag">your choice</span>}
        <span className="plan-why">{reasons[0]}</span>
      </header>
      <ol className="plan-steps">
        {active.map((s) => (
          <li key={s.id} className={`pstep ${s.state}`}>
            <AgentAvatar agent={s.agent} />
            <span className="pstep-body"><span className="pstep-label">{s.label}</span><span className={`tag ${s.state}`}>{STEP_STATE_TEXT[s.state]}</span>
              {s.state === "offer" && <span className="pstep-why">{s.why}</span>}</span>
          </li>))}
      </ol>
      {skipped.length > 0 && (
        <details className="plan-skipped">
          <summary>Left out: {skipped.map((s) => s.label.toLowerCase()).join(", ")}</summary>
          <ul>{skipped.map((s) => <li key={s.id}><strong>{s.label}.</strong> {s.why}</li>)}</ul>
        </details>)}
    </section>
  );
}

/** A step's live status as a timeline row, used on the task page. */
export function StatusIcon({ status }: { status: StepStatus }) {
  return <span className={`sicon ${status}`} role="img" aria-label={STATUS_TEXT[status]}><Icon name={STATUS_ICON[status]} size={14} /></span>;
}
