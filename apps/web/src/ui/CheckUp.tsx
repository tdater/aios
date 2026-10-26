import { useState } from "react";
import { ApiError } from "../core/client";
import { useApp } from "./Context";
import { useLoad } from "./hooks";
import { ErrorBox } from "./kit";
import { ago } from "./kit";

interface CheckUp { enabled: boolean; last_run: string | null; due: boolean; every_days: number }

/** The optional weekly computer check-up. Off until turned on; it only reads, and only while the look-at-this-computer switch is on. */
export function CheckUpToggle() {
  const { client, connected } = useApp();
  const cu = useLoad(() => client.get<CheckUp>("/home/check-up"), [client], 15000);
  const [err, setErr] = useState<string | null>(null);
  if (!cu.data) return cu.error ? <ErrorBox msg={cu.error} code={cu.errorCode} /> : null;
  const set = async (enabled: boolean) => {
    setErr(null);
    try { await client.put("/home/check-up", { enabled }); await cu.reload(); } catch (e) { setErr(e instanceof ApiError ? e.message : (e as Error).message); }
  };
  return (
    <div className="field-row">
      <label className="row"><input type="checkbox" checked={cu.data.enabled} disabled={!connected} onChange={(e) => void set(e.target.checked)} /><span>Check this computer once a week</span></label>
      <p className="muted small">Reads the same things as "Check this computer now" and changes nothing. {cu.data.last_run ? `Last checked ${ago(cu.data.last_run)}.` : "Not checked yet."}{cu.data.due && cu.data.enabled ? " A check is due." : ""}</p>
      <ErrorBox msg={err} />
    </div>
  );
}
