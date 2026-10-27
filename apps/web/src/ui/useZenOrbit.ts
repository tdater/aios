import { useEffect, useRef } from "react";

export const ZEN_IDLE_MS = 90_000;
export const ZEN_TICK_MS = 33;
/** Radians per second of the slow drift. */
export const ZEN_SPEED = 0.05;

/** After a quiet spell (no pointer, key or wheel input), slowly turns the view around the Sun. Any input stops it at once and the
 *  person has control again. Never runs when motion is reduced, or while `paused` (for example a card is open). */
export function useZenOrbit(el: React.RefObject<HTMLElement | null>, opts: { enabled: boolean; paused: boolean; onDrift: (radians: number) => void; idleMs?: number }) {
  const last = useRef(Date.now());
  const drifting = useRef(false);
  const cb = useRef(opts.onDrift);
  cb.current = opts.onDrift;
  const { enabled, paused, idleMs = ZEN_IDLE_MS } = opts;

  useEffect(() => {
    const node = el.current;
    if (!node || !enabled) return;
    const touch = () => { last.current = Date.now(); drifting.current = false; };
    const events = ["pointerdown", "pointermove", "wheel", "keydown", "touchstart"] as const;
    events.forEach((e) => node.addEventListener(e, touch, { passive: true }));
    last.current = Date.now();
    let prev = Date.now();
    const timer = setInterval(() => {
      const now = Date.now(), dt = now - prev;
      prev = now;
      if (paused || document.hidden) { last.current = now; drifting.current = false; return; }
      if (!drifting.current && now - last.current >= idleMs) drifting.current = true;
      if (drifting.current) cb.current((ZEN_SPEED * dt) / 1000);
    }, ZEN_TICK_MS);
    return () => { clearInterval(timer); events.forEach((e) => node.removeEventListener(e, touch)); drifting.current = false; };
  }, [el, enabled, paused, idleMs]);
}
