import { ObjectType, Region, Tone, UObject } from "./scene";
import { AiPlanet, ShareLevel, Star, Universe } from "./types";

// A believable universe for building, testing and screenshots without a server. It is test and demo data, not an integration.
const o = (id: string, type: ObjectType, region: Region, name: string, job: string, tone: Tone, text: string, meta: Record<string, unknown> = {}): UObject => ({ id, type, region, name, job, state: { tone, text }, meta });
const ai = (provider: string, name: string, level: ShareLevel, mode: string, told: string[]): AiPlanet => ({ provider, name, mode, level, default_level: level, told, told_count: told.length });
const KINDS = ["preference", "fact", "decision", "lesson", "procedure"] as const;
const star = (i: number, project: string | null): Star => ({ id: `mem_${String(i).padStart(3, "0")}`, title: `Memory ${i}`, type: KINDS[i % 5], scope: project ? "project" : "global", project_id: project, project, state: i % 17 === 0 ? "stale" : "fresh", uses: i % 4, verified_uses: i % 6 === 0 ? 3 : i % 3, hollow: i % 7 === 0, last_used: null, last_verified: null, brightness: ((i * 37) % 100) / 100 });

export function sampleUniverse(): Universe {
  const projects = [null, "Calc", "Blog", "Recipes", "Taxes"];
  const stars: Star[] = Array.from({ length: 70 }, (_, i) => star(i, projects[i % projects.length]));
  return {
    you: { approved: 70, suggested: 3, learning: true },
    ais: [ai("claude", "Claude", "private", "interactive", stars.slice(0, 40).map((s) => s.id)), ai("gemini", "Gemini", "public", "manual", stars.slice(0, 12).map((s) => s.id)),
      ai("perplexity", "Perplexity", "public", "manual", stars.slice(0, 12).map((s) => s.id)), ai("antigravity", "Antigravity", "none", "manual", [])],
    stars, links: [], clusters: ["Everywhere", "Blog", "Calc", "Recipes", "Taxes"], totals: { stars: 70, verified: 20, hollow: 10, stale: 4 },
    comets: { approvals: 2, blocked: 1, to_review: 3 }, paused: false,
  };
}

export function sampleObjects(): UObject[] {
  return [
    o("sun", "sun", "sun", "You", "Your preferences and privacy. Everything orbits you.", "ok", "Learning is on"),
    o("planet:claude", "planet", "fleet", "Claude", "Your main assistant. Does the work using your own Claude sign-in.", "ok", "Connected", { provider: "claude" }),
    o("planet:gemini", "planet", "fleet", "Gemini", "Second opinions, by copy and paste.", "info", "May be told 12 public memories", { provider: "gemini" }),
    o("planet:perplexity", "planet", "fleet", "Perplexity", "Finds sources, by copy and paste.", "info", "May be told 12 public memories", { provider: "perplexity" }),
    o("planet:antigravity", "planet", "fleet", "Antigravity", "Big coding jobs you hand over yourself.", "muted", "Told nothing", { provider: "antigravity" }),
    o("moon:review", "moon", "fleet", "Code review", "A ready-made way of checking changes.", "ok", "On", { parent: "planet:claude" }),
    o("moon:explain", "moon", "fleet", "Plain-words explainer", "Explains results without jargon.", "ok", "On", { parent: "planet:claude" }),
    o("moon:memory", "moon", "fleet", "Memory keeper", "Suggests things worth remembering.", "warn", "A better version is proposed", { parent: "planet:claude" }),
    o("moon:sources", "moon", "fleet", "Source finder", "Asks for links you can check.", "ok", "On", { parent: "planet:perplexity" }),
    o("nebula:history", "nebula", "stars", "Imported history", "Old chats and notes AIOS has not sorted yet.", "warn", "14 waiting", { size: 14 }),
    o("wormhole:import", "wormhole", "stars", "Bring in from another AI", "Bring in what ChatGPT already knows about you.", "info", "Ready"),
    o("beacon:publish", "beacon", "stars", "Shared notes", "Notes you chose to share outside AIOS.", "muted", "Nothing shared"),
    o("station:calc", "station", "yards", "Calculator app", "Your code, kept safe.", "ok", "Idle", { project: "Calc" }),
    o("station:blog", "station", "yards", "Blog", "Your writing project.", "info", "A job is running", { project: "Blog" }),
    o("station:taxes", "station", "yards", "Taxes 2026", "Papers and checklists.", "warn", "Waiting on you", { project: "Taxes" }),
    o("shuttle:1", "shuttle", "yards", "Fixing the add bug", "A job in flight. Step 2 of 4.", "info", "Working", { station: "station:blog" }),
    o("shuttle:2", "shuttle", "yards", "Draft the newsletter", "A job in flight. Step 1 of 3.", "info", "Working", { station: "station:blog" }),
    o("shuttle:3", "shuttle", "yards", "Check the calculator", "A job waiting for your approval.", "warn", "Waiting on you", { station: "station:calc" }),
    o("probe:list", "probe", "yards", "Shopping list", "A checklist on your Today screen.", "ok", "4 items"),
    o("probe:count", "probe", "yards", "Water counter", "A counter on your Today screen.", "ok", "5 today"),
    o("probe:note", "probe", "yards", "Reminder", "A note on your Today screen.", "ok", "1 note"),
    o("comet:approvals", "comet", "control", "2 waiting for your approval", "AIOS will not act until you decide.", "warn", "Waiting 6 minutes"),
    o("comet:blocked", "comet", "control", "1 stuck", "A job stopped and needs a decision.", "bad", "Stuck since this morning"),
    o("comet:review", "comet", "control", "3 to look over", "Memories AIOS noticed or imported.", "info", "Not used until you approve"),
    o("log", "log", "control", "Ship's log", "What AIOS did, in plain words.", "ok", "12 entries today"),
    o("allstop", "allstop", "control", "All Stop", "Stop everything now.", "ok", "Running normally"),
    o("home", "home", "home", "Home Base", "Your computer: health, space, start-up, and a helper for the mouse and browser.", "ok", "Looks healthy"),
    o("home:engine", "module", "home", "Engine room", "Speed: memory and heavy programs.", "ok", "Memory 61% in use"),
    o("home:cargo", "module", "home", "Cargo bay", "Space: disk and temporary files.", "warn", "Temp files 3.4 GB"),
    o("home:launch", "module", "home", "Launch bay", "Programs that start with Windows.", "info", "14 start with Windows"),
    o("home:rover", "module", "home", "Rover bay", "A helper that can use the mouse and browser, only when you allow it.", "muted", "Off"),
    o("home:port", "module", "home", "Docking port", "Connections, devices and backups.", "ok", "2 devices paired"),
    ...[["temp", 5], ["startup", 3], ["disk", 4], ["memory", 2], ["updates", 2]].map(([k, s]) => o(`rock:${k}`, "rock", "home", `Finding: ${k}`, `Something slowing your PC (${k}).`, "warn", "Open to see", { size: s })),
  ];
}
