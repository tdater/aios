import { UObject } from "./scene";

// What the server says about an object's card: plain text, then settings in three tiers.
export type FieldKind = "toggle" | "choice" | "text" | "number" | "info" | "action";
export interface Field {
  key: string; kind: FieldKind; label: string; value: unknown; help: string;
  options?: { value: string; label: string; preview?: string }[]; confirm?: boolean; to?: { tab: string; id?: string; sub?: string }; action?: string; client?: string;
}
export interface CardLink { label: string; to?: { tab: string; id?: string; sub?: string }; client?: string }
export interface ObjectCardData { object: UObject; explain: string; panels: { basics: Field[]; more: Field[]; expert: Field[] }; links: CardLink[] }
export interface ObjectList { items: UObject[]; version: number }

export const TIERS: { id: "basics" | "more" | "expert"; label: string }[] = [
  { id: "basics", label: "Basics" }, { id: "more", label: "More" }, { id: "expert", label: "Expert" },
];

/** The id goes in the URL path; ids contain ":" which is fine, but never "/" or "?". */
export const objectPath = (id: string) => `/universe/objects/${id.split("/").map((s) => encodeURIComponent(s).replace(/%3A/gi, ":")).join("/")}`;

import type { Settings } from "./settings";

/** A setting that lives on this device (not on the server). Each one has a home on an object and a tier. */
export interface LocalDef { key: keyof Settings; object: string; tier: "basics" | "more" | "expert"; label: string; help: string; control: "choice" | "toggle" | "number" | "hidden"; options?: { value: string; label: string }[]; min?: number; max?: number }

export const LOCAL_DEFS: LocalDef[] = [
  { key: "theme", object: "sun", tier: "basics", label: "Light or dark", help: "Follow your computer, or pick one.", control: "choice", options: [{ value: "system", label: "Match my computer" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }] },
  { key: "mode", object: "sun", tier: "basics", label: "How much AIOS shows", help: "Simple hides the technical parts. Nothing is removed.", control: "choice", options: [{ value: "simple", label: "Simple" }, { value: "standard", label: "Standard" }, { value: "power", label: "Everything" }] },
  { key: "universeView", object: "sun", tier: "basics", label: "How the universe is drawn", help: "3D space you fly through, or a flat picture.", control: "choice", options: [{ value: "3d", label: "3D space" }, { value: "flat", label: "Flat picture" }] },
  { key: "reduceMotion", object: "sun", tier: "basics", label: "Motion", help: "Calm mode turns off drifting and arrival animations.", control: "choice", options: [{ value: "system", label: "Follow my computer" }, { value: "on", label: "Keep things calm" }] },
  { key: "accent", object: "sun", tier: "more", label: "Accent colour", help: "Type a colour like #4f8cff, or default.", control: "hidden" },
  { key: "fontSize", object: "sun", tier: "more", label: "Text size", help: "From 14 to 20.", control: "number", min: 14, max: 20 },
  { key: "density", object: "sun", tier: "more", label: "Spacing", help: "Compact fits more on screen.", control: "choice", options: [{ value: "comfortable", label: "Comfortable" }, { value: "compact", label: "Compact" }] },
  { key: "readableLine", object: "sun", tier: "more", label: "Short lines for reading", help: "Keeps notes at a comfortable width.", control: "toggle" },
  { key: "noteFont", object: "sun", tier: "more", label: "Note font", help: "How notes are written on screen.", control: "choice", options: [{ value: "sans", label: "Plain" }, { value: "serif", label: "Book-like" }] },
  { key: "tabs", object: "sun", tier: "more", label: "Show open-page tabs", help: "On wide screens.", control: "toggle" },
  { key: "statusBar", object: "sun", tier: "more", label: "Show the status bar", help: "The thin bar at the bottom of wide screens.", control: "toggle" },
  { key: "hiddenNav", object: "sun", tier: "expert", label: "Hidden sections", help: "Sections you switched off in Settings.", control: "hidden" },
  { key: "hiddenCards", object: "sun", tier: "expert", label: "Hidden cards", help: "Cards you switched off on Today.", control: "hidden" },
  { key: "tourSeen", object: "sun", tier: "expert", label: "First-run tour", help: "Whether the tour has been finished or skipped.", control: "hidden" },
  { key: "cacheEnabled", object: "home:port", tier: "more", label: "Keep a copy for offline viewing", help: "Saves summaries (never secrets) on this device.", control: "toggle" },
  { key: "draftPolicy", object: "home:port", tier: "more", label: "When you reconnect", help: "AIOS never sends drafts by itself.", control: "choice", options: [{ value: "ask_on_reconnect", label: "Ask me" }, { value: "manual", label: "Only when I choose" }] },
];

/** Every setting on this device has a home. Typed so a new setting cannot be added without choosing one. */
export const SETTING_HOME: Record<keyof Settings, { object: string; label: string }> = Object.fromEntries(LOCAL_DEFS.map((d) => [d.key, { object: d.object, label: d.label }])) as Record<keyof Settings, { object: string; label: string }>;
