import { useApp } from "./Context";
import { TodayInput, todayCards } from "../core/today";
import { go } from "./hooks";

/** A few calm cards at the top of Home. Hidden cards are chosen in Settings. */
export function Today({ input }: { input: TodayInput }) {
  const { settings } = useApp();
  const cards = todayCards(input, settings.hiddenCards);
  if (cards.length === 0) return null;
  return (
    <section className="today" aria-label="Today">
      {cards.map((c) => (
        <article key={c.id} className="todaycard" aria-labelledby={`today-${c.id}`}>
          <h3 id={`today-${c.id}`}>{c.title}</h3>
          <p>{c.body}</p>
          {c.action && <button type="button" className="btn ghost" onClick={() => go(c.action!.to)}>{c.action.label}</button>}
        </article>))}
    </section>
  );
}
