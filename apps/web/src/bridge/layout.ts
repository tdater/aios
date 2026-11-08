// The bridge's layout rules. Pure, so phone, desktop and TV behaviour can be tested without a screen.

export type BridgeLayout = "phone" | "desktop" | "tv";
export type Area = "ops" | "holo" | "alerts" | "today";
export type Dir = "left" | "right" | "up" | "down";

export const PHONE_MAX = 600;

/** Phone under 600 px; TV or car screens when the device says so; otherwise desktop. */
export function bridgeLayout(width: number, tv: boolean): BridgeLayout {
  if (tv) return "tv";
  return width < PHONE_MAX ? "phone" : "desktop";
}

/** TV browsers announce themselves; this is a best guess and is not verified on real hardware. */
export const looksLikeTv = (ua: string): boolean => /\b(TV|Tizen|WebOS|SmartTV|AFT\w+|CrKey)\b/i.test(ua);

// Desktop and TV: ops | holo | alerts across the middle, today along the bottom. Phone: one column, top to bottom.
const ROW: Area[] = ["ops", "holo", "alerts"];
const COLUMN: Area[] = ["alerts", "holo", "ops", "today"];

/** Where the arrow keys / D-pad move between panels. Returns the same area at an edge. */
export function nextArea(cur: Area, dir: Dir, layout: BridgeLayout): Area {
  if (layout === "phone") {
    const i = COLUMN.indexOf(cur);
    if (dir === "down") return COLUMN[Math.min(COLUMN.length - 1, i + 1)];
    if (dir === "up") return COLUMN[Math.max(0, i - 1)];
    return cur;
  }
  if (cur === "today") return dir === "up" ? "holo" : cur;
  const i = ROW.indexOf(cur);
  if (dir === "down") return "today";
  if (dir === "left") return ROW[Math.max(0, i - 1)];
  if (dir === "right") return ROW[Math.min(ROW.length - 1, i + 1)];
  return cur;
}
