import { useEffect, useRef, useState } from "react";
import { go } from "./hooks";
import { Icon } from "./icons";

/** The one "+" in the ribbon: start the three things people do most, without finding the right screen first. */
export function QuickAdd() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const pick = (fn: () => void) => () => { setOpen(false); fn(); };
  const ask = () => { go({ tab: "home" }); setTimeout(() => (document.getElementById("ask-input") as HTMLElement | null)?.focus(), 120); };
  return (
    <div className="quickadd" ref={box}>
      <button type="button" className="quickadd-btn" aria-haspopup="menu" aria-expanded={open} aria-label="Quick add" title="Quick add" onClick={() => setOpen((v) => !v)}>
        <Icon name="plus" size={22} /><span className="navlabel">Add</span>
      </button>
      {open && (
        <ul className="quickadd-menu" role="menu" aria-label="Quick add">
          <li role="none"><button type="button" role="menuitem" onClick={pick(ask)}>Ask AIOS anything</button></li>
          <li role="none"><button type="button" role="menuitem" onClick={pick(() => go({ tab: "knowledge", id: "new" }))}>Quick note</button></li>
          <li role="none"><button type="button" role="menuitem" onClick={pick(() => go({ tab: "projects" }))}>New mission or project</button></li>
          <li role="none"><button type="button" role="menuitem" onClick={pick(() => go({ tab: "home", sub: "tools" }))}>Check a message or document</button></li>
        </ul>)}
    </div>
  );
}
