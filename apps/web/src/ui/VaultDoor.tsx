import { useEffect, useId, useRef, useState } from "react";

export const HOLD_MS = 1200;       // how long a destructive approval must be held
export const ARM_MS = 5000;        // keyboard / screen-reader path: second press must follow within this time

/** An approval control that makes "AIOS asks before acting" physical.
 *  - A light action opens with a normal press.
 *  - A heavy (destructive) action is a heavier door: hold the lock until the ring fills.
 *  - Keyboard and screen-reader users cannot "hold" a pointer, so a press with no pointer or key-hold behind it
 *    arms the lock and a second press within a few seconds opens it. Same deliberate extra step, same result.
 *  Nothing here decides anything: it only calls onOpen once the person has clearly meant it. */
export function VaultDoor({ heavy, label, hint, disabled, busy, onOpen }: {
  heavy: boolean; label: string; hint?: string; disabled?: boolean; busy?: boolean; onOpen: () => void;
}) {
  const [progress, setProgress] = useState(0);        // 0..1 while holding
  const [armed, setArmed] = useState(false);          // keyboard / assistive-technology path
  const [opened, setOpened] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holding = useRef(false);
  const sawHold = useRef(false);                      // a pointer or key hold produced this click: do not also arm
  const off = !!disabled || !!busy;
  const hintId = useId();

  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null; holding.current = false; setProgress(0);
    // the click that ends a hold arrives within a moment; after that a lone click is a keyboard or screen-reader press again
    if (sawHold.current) setTimeout(() => { sawHold.current = false; }, 400);
  };
  const open = () => { stop(); setArmed(false); setOpened(true); onOpen(); };
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); if (armTimer.current) clearTimeout(armTimer.current); }, []);
  useEffect(() => { if (off) { stop(); setArmed(false); } }, [off]);                 // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!busy) setOpened(false); }, [busy]);

  const begin = () => {
    if (off || holding.current) return;
    holding.current = true; sawHold.current = true;
    const start = Date.now();
    timer.current = setInterval(() => {
      const p = Math.min(1, (Date.now() - start) / HOLD_MS);
      setProgress(p);
      if (p >= 1) open();
    }, 40);
  };

  const onClick = () => {
    if (off) return;
    if (!heavy) { open(); return; }
    if (sawHold.current) { sawHold.current = false; return; }       // the hold already handled this press
    if (armed) { open(); return; }
    setArmed(true);
    armTimer.current = setTimeout(() => setArmed(false), ARM_MS);
  };

  const C = 2 * Math.PI * 20;
  return (
    <div className={`vault ${heavy ? "heavy" : "light"} ${opened ? "opened" : ""} ${armed ? "armed" : ""}`}>
      <button type="button" className="vaultbtn" aria-label={label} aria-describedby={hint ? hintId : undefined} disabled={off}
        aria-busy={busy}
        onPointerDown={heavy ? begin : undefined} onPointerUp={heavy ? stop : undefined} onPointerLeave={heavy ? stop : undefined} onPointerCancel={heavy ? stop : undefined}
        onKeyDown={heavy ? (e) => { if ((e.key === "Enter" || e.key === " ") && !e.repeat) begin(); } : undefined}
        onKeyUp={heavy ? (e) => { if (e.key === "Enter" || e.key === " ") stop(); } : undefined}
        onBlur={heavy ? stop : undefined}
        onClick={onClick}>
        <svg viewBox="-28 -28 56 56" width="52" height="52" aria-hidden="true">
          <rect className="frame" x="-22" y="-24" width="44" height="48" rx={heavy ? 6 : 12} />
          <g className="door"><rect x="-17" y="-19" width="34" height="38" rx={heavy ? 3 : 8} /></g>
          <circle className="dial" r="9" />
          <path className="spoke" d="M0 -9 V9 M-9 0 H9" />
          {heavy && <circle className="progress" r="20" strokeDasharray={C} strokeDashoffset={C * (1 - progress)} transform="rotate(-90)" />}
        </svg>
        <span className="vaulttext">{busy ? "Working…" : opened ? "Opened" : heavy ? (armed ? "Press again to open" : "Hold to open") : "Open"}</span>
      </button>
      <span className="vaultlabel">{label}</span>
      {hint && <span id={hintId} className="sr-only">{hint}</span>}
      <span className="sr-only" role="status" aria-live="polite">{armed ? "Armed. Press again within five seconds to confirm." : opened ? "Opened." : ""}</span>
    </div>
  );
}
