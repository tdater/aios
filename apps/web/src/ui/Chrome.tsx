import { KeyboardEvent as RKeyboardEvent } from "react";
import { hrefFor } from "../core/workspace";
import { useApp } from "./Context";
import { go, useRoute, useStore } from "./hooks";
import { modLabel } from "./hotkeys";
import { Icon } from "./icons";
import { ago } from "./kit";
import { helpStore, noteStats, openPalette, summaryStore, toastStore } from "./uiState";

/** Obsidian-style document tabs (desktop/tablet). Only detail routes are tabs. */
export function TabStrip() {
  const { workspace, settings } = useApp();
  const tabs = useStore(workspace.store).tabs;
  const route = useRoute();
  const active = hrefFor(route);
  if (!settings.tabs || tabs.length === 0) return <div className="tabstrip" role="tablist" aria-label="Open documents" />;
  const close = (href: string) => {
    const next = workspace.close(href, active);
    if (href === active) {
      if (next) location.hash = next;
      else go({ tab: route.tab });                  // back to the section list
    }
  };
  const onKey = (e: RKeyboardEvent, href: string) => {
    if (e.key === "Delete" || (e.key === "w" && e.altKey)) { e.preventDefault(); close(href); }
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      const n = workspace.neighbour(href, e.key === "ArrowRight" ? 1 : -1);
      if (n) { e.preventDefault(); location.hash = n; }
    }
  };
  return (
    <div className="tabstrip" role="tablist" aria-label="Open documents">
      {tabs.map((t) => (
        <div key={t.href} role="presentation" style={{ display: "contents" }}>
          <button role="tab" aria-selected={t.href === active} tabIndex={t.href === active ? 0 : -1} className="tab-item" title={t.title}
            onClick={() => { location.hash = t.href; }} onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); close(t.href); } }}
            onKeyDown={(e) => onKey(e, t.href)}>
            <span className="tt">{t.title}</span>
            <span className="x" role="button" tabIndex={0} aria-label={`Close ${t.title}`} onClick={(e) => { e.stopPropagation(); close(t.href); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); close(t.href); } }}>
              <Icon name="x" size={13} />
            </span>
          </button>
        </div>
      ))}
    </div>
  );
}

const CONN_LABEL: Record<string, string> = { connected: "Connected", connecting: "Connecting", stale: "Stale", disconnected: "Offline", incompatible: "Incompatible", unauthenticated: "Signed out" };

/** Bottom status bar (desktop/tablet): connection, work waiting for you, note stats, quick actions. */
export function StatusBar({ pendingDrafts }: { pendingDrafts: number }) {
  const { conn, connected, settings, updateSettings } = useApp();
  const sum = useStore(summaryStore);
  const stats = useStore(noteStats);
  if (!settings.statusBar) return null;
  return (
    <footer className="statusbar" aria-label="Status bar">
      <button onClick={() => go({ tab: "settings" })} title={connected ? `Last contact ${ago(conn.lastOkAt)}` : "The server is not reachable; shown data may be out of date"}>
        <span className={`dot ${conn.state}`} aria-hidden="true" />{CONN_LABEL[conn.state]}{conn.meta ? ` · v${conn.meta.server_version}` : ""}
      </button>
      {sum && sum.approvals > 0 && <button onClick={() => go({ tab: "inbox" })}><Icon name="shield" size={13} />{sum.approvals} approval{sum.approvals === 1 ? "" : "s"} waiting</button>}
      {sum && sum.running > 0 && <button onClick={() => go({ tab: "runs" })}><Icon name="play" size={13} />{sum.running} running</button>}
      {sum && sum.blocked > 0 && <button onClick={() => go({ tab: "runs" })}><Icon name="alert" size={13} />{sum.blocked} blocked</button>}
      {pendingDrafts > 0 && <button onClick={() => go({ tab: "home" })} title="Local drafts are not sent until you send them"><Icon name="upload" size={13} />{pendingDrafts} pending sync</button>}
      <span className="grow" />
      {stats && <span className="si">{stats.words} words · {stats.links} links</span>}
      <button onClick={() => updateSettings({ tabs: !settings.tabs })} aria-pressed={settings.tabs} title="Toggle the tab strip"><Icon name="columns" size={13} />Tabs</button>
      <button onClick={() => helpStore.set(true)} title="Keyboard shortcuts (?)"><Icon name="keyboard" size={13} />?</button>
      <button onClick={() => openPalette()} title="Command palette"><Icon name="command" size={13} />{modLabel()} K</button>
    </footer>
  );
}

export function Toast() {
  const t = useStore(toastStore);
  return t ? <div className="toast" role="status" aria-live="polite">{t}</div> : null;
}

const SHORTCUTS: [string, string][] = [
  [`${modLabel()}+K`, "Quick switcher and command palette"], [`${modLabel()}+O`, "Quick switcher (notes, projects, runs)"], [`${modLabel()}+P`, "Command palette"],
  ["Alt+W", "Close the current tab"], ["Alt+→ / Alt+←", "Next / previous tab"], [`${modLabel()}+\\`, "Show or hide the vault explorer"],
  ["/", "Focus search in the Knowledge screen"], ["E", "Toggle reading / editing in a note"], ["G", "Open the graph view"], ["?", "This help"], ["Esc", "Close dialogs and palette"],
];
export function ShortcutsHelp() {
  const open = useStore(helpStore);
  if (!open) return null;
  return (
    <div className="backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) helpStore.set(false); }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" style={{ padding: 18 }}>
        <div className="row"><h2>Keyboard shortcuts</h2><button className="iconbtn" aria-label="Close" onClick={() => helpStore.set(false)}><Icon name="x" /></button></div>
        <div className="helpgrid">{SHORTCUTS.map(([k, d]) => (<><div key={k}><kbd>{k}</kbd></div><div key={d}>{d}</div></>))}</div>
        <p className="muted small">Shortcuts without Ctrl/Alt are ignored while you are typing in a field.</p>
      </div>
    </div>
  );
}
