// Visual harness: isolated server + realistic seeded data + screenshots at several viewports.
// Usage: node e2e/shots.mjs [filter]   (filter = substring of a shot name). Prints the output folder.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const repo = resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..");
const py = join(repo, ".venv", "Scripts", "python.exe");
const tmp = join(tmpdir(), `aios-shots-${Date.now()}`);
const state = join(tmp, "state"), ws = join(tmp, "ws", "sample"), out = join(tmp, "shots");
for (const d of [state, ws, out]) mkdirSync(d, { recursive: true });
writeFileSync(join(ws, "README.md"), "# sample\n");
writeFileSync(join(ws, "app.py"), "# TODO\nprint('hi')\n");
const PORT = 8792, BASE = `http://127.0.0.1:${PORT}`, API = `${BASE}/api/v1`;
const env = { ...process.env, PYTHONPATH: join(repo, "apps", "api"), AIOS_STATE_DIR: state, AIOS_WORKSPACES_DIR: join(tmp, "ws"), AIOS_PORT: String(PORT) };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const filter = process.argv[2] ?? "";
let server;
async function start() {
  server = spawn(py, ["-m", "aios.main"], { env, cwd: repo, stdio: "ignore", windowsHide: true });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${API}/meta`)).ok) return; } catch {} await sleep(250); }
  throw new Error("server did not start");
}
const stop = () => { if (server) spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { windowsHide: true }); };
const code = () => /Pairing code: ([A-Z0-9-]+)/.exec(spawnSync(py, ["-m", "aios.pair"], { env, cwd: repo, encoding: "utf8" }).stdout)[1];

const NOTES = [
  ["Gradle caching", "fact", ["build", "android"], "The Gradle **build cache** and configuration cache cut incremental builds from minutes to seconds.\n\n> [!tip] Keep it on\n> Enable `org.gradle.caching=true` in `gradle.properties`.\n\nSee also [[Android build checklist]] and [[ANR dialogs on low RAM]].\n\n```properties\norg.gradle.caching=true\norg.gradle.parallel=true\n```\n\n| Setting | Effect |\n|---|---|\n| caching | reuse task outputs |\n| parallel | run projects concurrently |\n\n#build/gradle"],
  ["Android build checklist", "procedure", ["android", "checklist"], "## Before a release build\n\n- [x] Run the unit tests\n- [x] Run [[Emulator setup]] smoke test\n- [ ] Verify permissions: INTERNET only\n- [ ] Sign with the release key\n\n> [!warning] Never commit signing keys\n> `keystore.properties` is git-ignored for a reason.\n\nRelated: [[Gradle caching]], [[Approval binding]]."],
  ["Emulator setup", "lesson", ["android", "testing"], "Use `-memory 2560 -cores 3` on a 16 GB host.\n\n> [!note]- Why this matters\n> The software-rendered emulator shows system *not responding* dialogs when the host is out of RAM.\n\nCaused by: [[ANR dialogs on low RAM]]."],
  ["ANR dialogs on low RAM", "lesson", ["android", "testing"], "System UI ANR dialogs steal focus and break UI automation.\n\n1. Close heavy apps\n2. Lower emulator memory\n3. Dismiss with `CLOSE_SYSTEM_DIALOGS`\n\nFollow up in [[Emulator setup]]."],
  ["Approval binding", "decision", ["security"], "Approvals bind to the **exact action hash**, are single use, and expire.\n\n> [!danger] Destructive actions\n> Overwrites need explicit confirmation.\n\nSee [[Idempotency keys]] and [[Skill evaluation]]."],
  ["No force push", "preference", ["git", "security"], "Never `git push --force`. Enforced by the safety guard, not by good intentions."],
  ["Idempotency keys", "fact", ["api"], "A retry with the same key replays the stored response. See [[Cursor pagination]]."],
  ["Cursor pagination", "fact", ["api"], "Keyset pagination: stable under inserts. Linked from [[Idempotency keys]]."],
  ["Pairing codes", "decision", ["security", "auth"], "One-time, 10 minutes, hashed at rest, rate limited. Cookie sessions need CSRF; bearer tokens do not. Related: [[Approval binding]]."],
  ["Vault ownership rules", "decision", ["architecture"], "Markdown is canonical for knowledge; SQLite is a rebuildable index. #architecture"],
  ["Skill evaluation", "procedure", ["skills", "security"], "Candidate → evaluation → **human confirmation** → versioned deploy → exact rollback. The evaluator is protected: [[Approval binding]]."],
  ["Draft: unresolved link example", "fact", [], "This note links to [[A note that does not exist yet]] to show a ghost node."],
];
let token;
const api = async (m, p, b, h = {}) => (await fetch(`${API}${p}`, { method: m, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...h }, body: b ? JSON.stringify(b) : undefined })).json();
async function seed() {
  token = (await (await fetch(`${API}/auth/pair`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: code(), device_name: "seed", kind: "native" }) })).json()).token;
  const prj = await api("POST", "/projects", { name: "Android companion", path: ws });
  for (const [title, type, tags, body] of NOTES) {
    const m = await api("POST", "/memories", { scope: tags.includes("android") ? "project" : "global", type, title, body, tags, project_id: tags.includes("android") ? prj.id : undefined });
    if (type !== "lesson") await api("PATCH", `/memories/${m.id}`, { status: "approved", expected_version: m.version });
  }
  await api("POST", "/tasks", { title: "Audit workspace", kind: "audit.workspace", project_id: prj.id, acceptance: [{ type: "artifact_kind", kind: "audit_report" }], start_run: true });
  await api("POST", "/tasks", { title: "Ask Gemini", kind: "provider.task", project_id: prj.id, spec: { provider: "gemini", prompt: "x" }, start_run: true });
  await api("POST", "/tasks", { title: "Provider quota test", kind: "demo.quota", start_run: true });
  await api("POST", "/tasks", { title: "Write release notes", kind: "demo.guarded_write", spec: { filename: "release-notes.md", content: "# Release 0.2\n\n- new UI" }, start_run: true });
  await api("POST", "/tasks", { title: "Long running build", kind: "demo.slow_steps", spec: { steps: 60, pause: 2 }, start_run: true });
  await sleep(3500);
}

const SHOTS = [
  ["01-desktop-home", 1440, 900, "#/home"], ["02-desktop-knowledge", 1440, 900, "#/knowledge"], ["03-desktop-note", 1440, 900, "NOTE:Gradle caching"],
  ["04-desktop-graph", 1440, 900, "#/graph"], ["05-desktop-runs", 1440, 900, "#/runs"], ["06-desktop-inbox", 1440, 900, "#/inbox"],
  ["07-desktop-settings", 1440, 1200, "#/settings"], ["08-palette", 1440, 900, "PALETTE"], ["09-palette-query", 1440, 900, "PALETTE:grad"],
  ["10-tablet-note", 834, 1112, "NOTE:Android build checklist"], ["11-phone-home", 390, 844, "#/home"], ["12-phone-note", 390, 844, "NOTE:Emulator setup"],
  ["13-phone-graph", 390, 844, "#/graph"], ["14-phone-knowledge", 390, 844, "#/knowledge"], ["15-light-note", 1440, 900, "NOTE:Gradle caching", "light"], ["16-paper-note", 1440, 900, "NOTE:Gradle caching", "paper"],
];

try {
  await start();
  await seed();
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const pairCode = code();
  for (const [name, w, h, target, theme] of SHOTS) {
    if (filter && !name.includes(filter)) continue;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: w < 500 ? 2 : 1, isMobile: w < 500, hasTouch: w < 500, colorScheme: "dark" });
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    try {
      await page.goto(BASE);
      await page.getByLabel("Pairing code").fill(code());
      await page.getByRole("button", { name: "Pair" }).click();
      await page.locator(".shell").waitFor();
      if (theme) await page.evaluate((t) => { const s = JSON.parse(localStorage.getItem("aios.settings.v1") || "{}"); s.theme = t; localStorage.setItem("aios.settings.v1", JSON.stringify(s)); }, theme).then(() => page.reload()).then(() => page.locator(".shell").waitFor());
      if (target.startsWith("NOTE:")) {
        const title = target.slice(5);
        const list = await (await fetch(`${API}/memories?limit=100`, { headers: { Authorization: `Bearer ${token}` } })).json();
        const id = list.items.find((m) => m.title === title).id;
        await page.evaluate((i) => { location.hash = `#/knowledge/${i}`; }, id);
      } else if (target.startsWith("PALETTE")) {
        await page.evaluate(() => { location.hash = "#/home"; });
        await page.keyboard.press("Control+k");
        const q = target.split(":")[1];
        if (q) await page.keyboard.type(q);
      } else await page.evaluate((hsh) => { location.hash = hsh; }, target);
      await sleep(1600);
      await page.screenshot({ path: join(out, `${name}.png`) });
      console.log("shot", name);
    } catch (e) { console.log("FAILED", name, String(e.message).split("\n")[0]); try { await page.screenshot({ path: join(out, `${name}-FAILED.png`) }); } catch {} }
    await ctx.close();
  }
  await browser.close();
} finally { stop(); }
console.log("OUT:", out);
