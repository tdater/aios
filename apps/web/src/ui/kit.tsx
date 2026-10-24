import { ReactNode, useId, useState } from "react";

// Everything below renders server/imported content as TEXT nodes only. This app never injects raw HTML
// and never auto-creates links from untrusted text (a unit test asserts hostile markup stays inert).

export const fmtLocal = (iso?: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};
export function ago(iso?: string | null, now = Date.now()): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
export const fmtDuration = (s: number) => (s <= 0 ? "expired" : s < 90 ? `${s}s` : s < 5400 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`);

const STATE_LABEL: Record<string, string> = {
  awaiting_provider_session: "awaiting your provider session", awaiting_approval: "awaiting approval",
  blocked_quota: "blocked: quota", completed: "completed", succeeded: "completed",
};
const STATE_TONE: Record<string, string> = {
  completed: "ok", succeeded: "ok", approved: "ok", running: "info", queued: "info", awaiting_approval: "warn",
  awaiting_provider_session: "warn", blocked: "warn", blocked_quota: "warn", interrupted: "warn", pending: "warn",
  failed: "bad", cancelled: "bad", rejected: "bad", expired: "bad", superseded: "muted",
};
export const Badge = ({ s, label }: { s: string; label?: string }) => (
  <span className={`badge ${STATE_TONE[s] ?? "muted"}`}>{label ?? STATE_LABEL[s] ?? s.replace(/_/g, " ")}</span>
);

export const ErrorBox = ({ msg, code }: { msg: string | null; code?: string | null }) =>
  msg ? <div className="note bad" role="alert"><strong>Error{code ? ` (${code})` : ""}:</strong> {msg}</div> : null;
export const Notice = ({ tone = "warn", children }: { tone?: "warn" | "info" | "bad" | "ok"; children: ReactNode }) => (
  <div className={`note ${tone}`} role="status">{children}</div>
);
export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>;
export const Loading = ({ what = "Loading" }: { what?: string }) => <p className="muted" aria-busy="true">{what}…</p>;

export function Collapsible({ title, children, startOpen = false, count }: { title: string; children: ReactNode; startOpen?: boolean; count?: number }) {
  const [open, setOpen] = useState(startOpen);
  const id = useId();
  return (
    <section className="collapsible">
      <button className="collapse-head" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <span aria-hidden="true">{open ? "▾" : "▸"}</span> {title}{count !== undefined ? ` (${count})` : ""}
      </button>
      {open && <div id={id} className="collapse-body">{children}</div>}
    </section>
  );
}

/** Untrusted text (logs, artifacts, imported results). Always a text node inside <pre>. */
export const Untrusted = ({ text, max = 6000 }: { text: string; max?: number }) => {
  const [full, setFull] = useState(false);
  const long = text.length > max;
  return (
    <>
      <pre className="untrusted" tabIndex={0}>{full || !long ? text : text.slice(0, max) + "\n… (truncated)"}</pre>
      {long && <button className="btn ghost" onClick={() => setFull(!full)}>{full ? "Show less" : `Show all (${text.length} chars)`}</button>}
    </>
  );
};

export function Btn({ children, onClick, kind = "primary", disabled, busy, type = "button", label }: {
  children: ReactNode; onClick?: () => void; kind?: "primary" | "ghost" | "danger"; disabled?: boolean; busy?: boolean; type?: "button" | "submit"; label?: string;
}) {
  return (
    <button type={type} className={`btn ${kind}`} onClick={onClick} disabled={disabled || busy} aria-busy={busy} aria-label={label}>
      {busy ? "Working…" : children}
    </button>
  );
}

/** Prevents double-tap: the action runs once until it settles. */
export function useOnce<A extends unknown[]>(fn: (...a: A) => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const run = async (...a: A) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn(...a);
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}
