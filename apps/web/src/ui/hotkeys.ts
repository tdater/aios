import { useEffect, useRef } from "react";

/** Combos look like "mod+k", "alt+w", "shift+?", "escape". `mod` = Ctrl on Windows/Linux, Cmd on macOS. */
export interface KeyLike { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }

export function matchCombo(e: KeyLike, combo: string): boolean {
  const parts = combo.toLowerCase().split("+");
  const key = parts[parts.length - 1];
  const want = { mod: parts.includes("mod"), alt: parts.includes("alt"), shift: parts.includes("shift") };
  const mod = e.ctrlKey || e.metaKey;
  if (want.mod !== mod || want.alt !== e.altKey) return false;
  // Shift is implied by symbols like "?"; only enforce it for letters/named keys.
  if (key.length === 1 && !/[a-z0-9]/.test(key)) return e.key === key && (want.shift ? e.shiftKey : true);
  if (want.shift !== e.shiftKey) return false;
  return e.key.toLowerCase() === key;
}

export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

export type Bindings = Record<string, (e: KeyboardEvent) => void>;

/** Global shortcuts. Combos without Ctrl/Cmd/Alt are ignored while the user is typing in a field. */
export function useHotkeys(bindings: Bindings, enabled = true): void {
  const ref = useRef(bindings);
  ref.current = bindings;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      for (const [combo, fn] of Object.entries(ref.current)) {
        if (!matchCombo(e, combo)) continue;
        const bare = !/(mod|alt)\+/.test(combo);
        if (bare && combo !== "escape" && isTypingTarget(e.target)) continue;
        e.preventDefault();
        fn(e);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}

export const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const modLabel = () => (isMac() ? "⌘" : "Ctrl");
