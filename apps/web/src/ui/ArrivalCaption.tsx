import { useState } from "react";
import { pingEnabled, setPingEnabled } from "../core/ping";

/** The one-line caption while something arrives, with Skip. Spoken to screen readers, never traps focus. */
export function ArrivalCaption({ caption, onSkip }: { caption: string | null; onSkip: () => void }) {
  return (
    <div className="arrival-caption" role="status" aria-live="polite" data-testid="arrival-caption">
      {caption && (
        <>
          <span>{caption}</span>
          <button type="button" className="btn btn-quiet" onClick={onSkip}>Skip</button>
        </>
      )}
    </div>
  );
}

/** A way to see an arrival again from an object's card. */
export function ReplayArrival({ onReplay }: { onReplay: () => void }) {
  return <button type="button" className="btn btn-quiet" onClick={onReplay}>Replay arrival</button>;
}

/** Off unless turned on; kept on this device only. */
export function PingToggle() {
  const [on, setOn] = useState(pingEnabled());
  return (
    <label className="row">
      <input type="checkbox" checked={on} onChange={(e) => { setOn(e.target.checked); setPingEnabled(e.target.checked); }} />
      <span>Play a soft sound when something new arrives</span>
    </label>
  );
}
