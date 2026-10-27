import { useEffect, useMemo, useState } from "react";
import { habitsDue, topThree } from "../core/dispatch";
import { NoteRow, fetchAllNotes } from "../core/vault";
import { Widget, missionProgress, targetText } from "../core/widgets";
import { listWidgets } from "../core/widgets";
import { useApp } from "../ui/Context";
import { go } from "../ui/hooks";

export const AMBIENT_VIEWS = ["Today", "Missions", "Remember"] as const;
export const ROTATE_MS = 30_000;

/** The next view when stepping left or right through the three, wrapping at the ends. */
export const stepView = (i: number, dir: 1 | -1, n: number = AMBIENT_VIEWS.length) => (i + dir + n) % n;

/** A calm, large-type display for a wall screen or TV: today's priorities, missions, and one thing from your notes. It only reads;
 *  Left and Right (or the remote's arrows) change the view, Enter pauses the rotation, Back or Escape returns. */
export function Ambient() {
  const { client } = useApp();
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [view, setView] = useState(0);
  const [paused, setPaused] = useState(false);
  const [now, setNow] = useState(new Date());

  useEffect(() => { listWidgets(client).then(setWidgets).catch(() => setWidgets([])); fetchAllNotes(client, "approved").then(setNotes).catch(() => setNotes([])); }, [client]);
  useEffect(() => {
    const clock = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(clock);
  }, []);
  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => setView((v) => stepView(v, 1)), ROTATE_MS);
    return () => clearInterval(t);
  }, [paused]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") setView((v) => stepView(v, 1));
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") setView((v) => stepView(v, -1));
      else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setPaused((p) => !p); }
      else if (e.key === "Escape" || e.key === "Backspace" || e.key === "BrowserBack") go({ tab: "home" });
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const missions = widgets.filter((x): x is Extract<Widget, { kind: "mission" }> => x.kind === "mission");
  const spotlight = useMemo(() => (notes.length ? notes[Math.floor(now.getTime() / ROTATE_MS / 20) % notes.length] : null), [notes, now]);
  const top = topThree(widgets), due = habitsDue(widgets, now);

  return (
    <div className="ambient" role="region" aria-label="Ambient display" tabIndex={0} autoFocus>
      <header className="ambient-head">
        <span className="ambient-clock">{now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
        <span className="ambient-date">{now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</span>
      </header>
      <main aria-live="polite">
        {view === 0 && (
          <section aria-label="Today"><h1>Today</h1>
            {top.length ? <ol>{top.map((i, n) => <li key={n}>{i.text}</li>)}</ol> : <p>No priorities listed yet.</p>}
            {due.length > 0 && <p className="ambient-sub">Still to do: {due.map((h) => h.title).join(", ")}</p>}
          </section>)}
        {view === 1 && (
          <section aria-label="Missions"><h1>Missions</h1>
            {missions.length ? <ul>{missions.slice(0, 4).map((m) => <li key={m.id}><strong>{m.title}</strong> <span>{missionProgress(m.config).percent}%</span> <span className="ambient-sub">{targetText(m.config.target)}</span></li>)}</ul> : <p>No missions yet.</p>}
          </section>)}
        {view === 2 && (
          <section aria-label="Remember"><h1>Remember</h1>
            {spotlight ? <p className="ambient-quote">{spotlight.title}</p> : <p>Your notes will show up here.</p>}
          </section>)}
      </main>
      <footer className="ambient-foot" aria-hidden="true">{AMBIENT_VIEWS.map((v, i) => <span key={v} className={i === view ? "on" : ""}>{v}</span>)}<span>{paused ? "Paused. Press OK to resume." : "◀ ▶ to change · OK to pause · Back to leave"}</span></footer>
    </div>
  );
}
