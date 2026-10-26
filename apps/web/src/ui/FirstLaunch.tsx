import { useEffect, useRef } from "react";

const KEY = "aios.widgets.firstLaunchSeen";

/** True until the owner has seen (or skipped) the showcase. Storage can be blocked, in which case it shows once per page load at most. */
export function firstLaunchPending(): boolean {
  try { return localStorage.getItem(KEY) !== "1"; } catch { return true; }
}
export function markFirstLaunchSeen(): void {
  try { localStorage.setItem(KEY, "1"); } catch { /* private mode or blocked storage: nothing to remember with */ }
}
const reducedMotion = () => {
  try { return !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
};

/** A short, one-time showcase shown after the first widget is added. Closing it (Skip, Got it, or Esc) remembers that it was seen. */
export function FirstLaunch({ onDone }: { onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const done = () => { markFirstLaunchSeen(); onDone(); };
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    btn.current?.focus();
    return () => before?.focus?.();
  }, []);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.stopPropagation(); done(); return; }
    if (e.key !== "Tab") return;
    const f = ref.current?.querySelectorAll<HTMLElement>("button");
    if (!f || f.length === 0) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  return (
    <div className="firstlaunch-backdrop">
      <div ref={ref} className={`firstlaunch${reducedMotion() ? "" : " animate"}`} role="dialog" aria-modal="true" aria-labelledby="firstlaunch-title" onKeyDown={onKey}>
        <h2 id="firstlaunch-title">Your day, in one place</h2>
        <p>My Day is a small panel over your universe that holds the tools you picked, like a checklist, a habit or a timer.</p>
        <p>Open it any time to tick things off, count, jot a note or run a saved request, and everything you change is saved for you.</p>
        <p>Add more from the gallery, rename or remove any of them, and nothing here runs unless you press it.</p>
        <div className="row">
          <button type="button" className="btn ghost" onClick={done}>Skip</button>
          <button ref={btn} type="button" className="btn primary" onClick={done}>Got it</button>
        </div>
      </div>
    </div>
  );
}
