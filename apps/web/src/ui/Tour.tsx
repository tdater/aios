import { useEffect, useRef, useState } from "react";
import { ApiError } from "../core/client";
import { MODES } from "../core/modes";
import { TOUR_STEPS, TourStep, clampStep, lastStep, progressText } from "../core/tour";
import { Universe } from "../core/types";
import { useApp } from "./Context";
import { go, useLoad, useStore } from "./hooks";
import { Btn, ErrorBox, Notice } from "./kit";
import { closeTour, tourStore } from "./uiState";

/** Step 3: checks, for real, whether Claude is connected, and says what to do if it is not. */
function ClaudeCheck() {
  const { client } = useApp();
  const uni = useLoad(() => client.get<Universe>("/universe"), [client]);
  const claude = uni.data?.ais.find((a) => a.provider === "claude");
  if (uni.loading && !uni.data) return <p className="muted">Checking Claude&hellip;</p>;
  if (!claude) return <Notice tone="warn">AIOS could not check Claude right now. You can carry on and check later from the map.</Notice>;
  return claude.mode === "interactive"
    ? <Notice tone="info"><strong>Claude is connected.</strong> It will answer when you chat.</Notice>
    : (
      <div>
        <Notice tone="warn"><strong>Claude is not connected yet.</strong> Claude Code is not signed in on this PC.</Notice>
        <ol><li>Install Claude Code from claude.com/claude-code if you have not.</li><li>Open PowerShell and type <code>claude</code>.</li><li>Sign in with your Claude account when it asks.</li><li>Come back here and press <strong>Check again</strong>.</li></ol>
        <Btn kind="ghost" onClick={() => void uni.reload()}>Check again</Btn>
      </div>
    );
}

/** Step 4: the one setting that makes AIOS calm or complete. Changes apply immediately. */
function LevelChoice() {
  const { settings, updateSettings } = useApp();
  return (
    <fieldset className="field"><legend>How much should AIOS show?</legend>
      {MODES.map((m) => (
        <label key={m.id} className="check"><input type="radio" name="tour-mode" checked={settings.mode === m.id} onChange={() => updateSettings({ mode: m.id })} /> <strong>{m.label}</strong> <span className="muted small">{m.hint}</span></label>))}
      <p className="muted small">If you are not sure, choose Simple. You can switch any time in Settings.</p>
    </fieldset>
  );
}

/** Step 7: makes the Everyday chat space on request (never silently), then opens the chat. */
function EverydaySetup() {
  const { client, connected } = useApp();
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [err, setErr] = useState<string | null>(null);
  const make = async () => {
    setState("busy"); setErr(null);
    try { await client.post("/everyday"); setState("done"); } catch (e) { setState("idle"); setErr(e instanceof ApiError ? e.message : (e as Error).message); }
  };
  return (
    <div>
      <ErrorBox msg={err} />
      {state === "done"
        ? <Notice tone="info"><strong>Your Everyday space is ready.</strong> Open the chat and say hello.</Notice>
        : <Btn busy={state === "busy"} disabled={!connected} onClick={() => void make()}>Make my Everyday space</Btn>}
      {state === "done" && <Btn onClick={() => { go({ tab: "work" }); tourStore.set({ ...tourStore.get(), waiting: true }); }}>Open the chat</Btn>}
    </div>
  );
}

const FOCUSABLE = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

export function Tour() {
  const t = useStore(tourStore);
  const { updateSettings } = useApp();
  const box = useRef<HTMLDivElement>(null);
  const idx = clampStep(t.step);
  const step: TourStep = TOUR_STEPS[idx];
  const finish = () => { updateSettings({ tourSeen: true }); closeTour(); };
  useEffect(() => { if (t.open && !t.waiting) box.current?.querySelector<HTMLElement>("h2")?.focus(); }, [t.open, t.waiting, idx]);
  if (!t.open) return null;
  if (t.waiting) {
    return (
      <div className="tour-pill" role="region" aria-label="Tour paused">
        <Btn onClick={() => tourStore.set({ ...t, waiting: false })}>Continue the tour ({progressText(idx)})</Btn>
        <Btn kind="ghost" onClick={finish}>Stop the tour</Btn>
      </div>
    );
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); finish(); return; }
    if (e.key !== "Tab" || !box.current) return;
    const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (items.length === 0) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  const move = (d: number) => tourStore.set({ ...t, step: clampStep(idx + d) });
  return (
    <div className="tour-backdrop">
      <div ref={box} className="tour card" role="dialog" aria-modal="true" aria-labelledby="tour-title" onKeyDown={onKey}>
        <div className="row tour-head">
          <span className="muted small" aria-live="polite">{progressText(idx)}</span>
          <progress max={lastStep + 1} value={idx + 1} aria-label={progressText(idx)} />
          <button type="button" className="link" onClick={finish}>{idx === lastStep ? "Close" : "Skip the tour"}</button>
        </div>
        <h2 id="tour-title" tabIndex={-1}>{step.title}</h2>
        <p className="lead">{step.lead}</p>
        {step.points.length > 0 && <ul>{step.points.map((p) => <li key={p}>{p}</li>)}</ul>}
        {step.id === "claude" && <ClaudeCheck />}
        {step.id === "level" && <LevelChoice />}
        {step.id === "chat" && <EverydaySetup />}
        {step.action && (
          <Btn kind="ghost" onClick={() => { go(step.action!.to); tourStore.set({ ...t, waiting: true }); }}>{step.action.label}</Btn>)}
        <div className="row tour-nav">
          <Btn kind="ghost" disabled={idx === 0} onClick={() => move(-1)}>Back</Btn>
          {idx < lastStep ? <Btn onClick={() => move(1)}>Next</Btn> : <Btn onClick={finish}>Finish</Btn>}
        </div>
      </div>
    </div>
  );
}
