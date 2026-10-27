import { playSound } from "./sound";

/** Fired when a habit or checklist item is completed in My Day. The cockpit listens and makes that panel's probe sparkle. */
export const CELEBRATE_EVENT = "aios:celebrate";

export function celebrate(widgetId: string, win: Pick<Window, "dispatchEvent"> = window): void {
  playSound("chime");
  win.dispatchEvent(new CustomEvent(CELEBRATE_EVENT, { detail: { widgetId } }));
}
