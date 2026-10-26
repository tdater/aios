// Makes the pictures used on the GitHub page. Isolated server, invented sample data only, nothing from a real AIOS.
// Usage: node e2e/readme-shots.mjs [outDir]   (default: ../../docs/assets). Needs `npm run build` first and a machine with WebGL.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const repo = resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..");
const py = join(repo, ".venv", "Scripts", "python.exe");
const tmp = join(tmpdir(), `aios-readme-${Date.now()}`);
const state = join(tmp, "state"), wsRoot = join(tmp, "ws"), ws = join(wsRoot, "sample");
const out = process.argv[2] ? resolve(process.argv[2]) : join(repo, "docs", "assets");
for (const d of [state, ws, out]) mkdirSync(d, { recursive: true });
writeFileSync(join(ws, "README.md"), "# sample\n");
const PORT = 8794, BASE = `http://127.0.0.1:${PORT}`, API = `${BASE}/api/v1`;
const env = { ...process.env, PYTHONPATH: join(repo, "apps", "api"), AIOS_STATE_DIR: state, AIOS_WORKSPACES_DIR: wsRoot, AIOS_PORT: String(PORT) };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let server, token;
const start = async () => {
  server = spawn(py, ["-m", "aios.main"], { env, cwd: repo, stdio: "ignore", windowsHide: true });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`${API}/meta`)).ok) return; } catch { /* not up yet */ } await sleep(250); }
  throw new Error("server did not start");
};
const stop = () => { if (server) spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { windowsHide: true }); };
const code = () => /Pairing code: ([A-Z0-9-]+)/.exec(spawnSync(py, ["-m", "aios.pair"], { env, cwd: repo, encoding: "utf8" }).stdout)[1];
const api = async (m, p, b) => { const r = await fetch(`${API}${p}`, { method: m, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: b ? JSON.stringify(b) : undefined }); return r.status === 204 ? {} : r.json(); };

const MEMORIES = [
  ["I prefer short answers with a plain-words summary first", "preference"], ["Never run anything on my banking sites", "preference"], ["My tax papers live in the Taxes project", "fact"],
  ["The calculator app is written in Python", "fact"], ["Check changes with the unit tests before merging", "procedure"], ["Back up before big clean-ups", "lesson"],
  ["Weekly review happens on Sunday evening", "fact"], ["Keep newsletters under 300 words", "preference"], ["Use metric units", "preference"], ["Recipes go in the Recipes project", "fact"],
];
async function seed() {
  token = (await (await fetch(`${API}/auth/pair`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: code(), device_name: "seed", kind: "native" }) })).json()).token;
  await api("POST", "/projects", { name: "Calculator app", path: ws });
  for (const [title, type] of MEMORIES) {
    const m = await api("POST", "/memories", { scope: "global", type, title, body: title, tags: [] });
    await api("PATCH", `/memories/${m.id}`, { status: "approved", expected_version: m.version });
  }
  await api("PUT", "/abilities/widgets", { enabled: true, confirm: true });
  await api("PUT", "/abilities/system_scan", { enabled: true, confirm: true });
  for (const t of ["top3", "water", "move", "focus", "briefing", "shopping"]) await api("POST", "/widgets/from-catalog", { template: t });
  await api("GET", "/system-scan").catch(() => {});
  await sleep(1500);
}

const SHOTS = [
  ["universe", 1440, 900, "#/home", async () => {}],
  ["planet-card", 1440, 900, "#/home/o/planet%3Aclaude", async () => {}],
  ["my-day", 1440, 900, "#/home", async (p) => { await p.getByRole("button", { name: "My Day" }).click(); }],
  ["widget-gallery", 1440, 900, "#/home", async (p) => { await p.getByRole("button", { name: "My Day" }).click(); await p.getByRole("button", { name: "Add a widget" }).click(); }],
  ["home-base", 1440, 900, "#/home/o/home", async () => {}],
  ["phone", 390, 844, "#/home", async () => {}],
  ["list-view", 1440, 900, "#/home", async (p) => { await p.getByRole("button", { name: "List view" }).click(); }],
];

try {
  await start();
  await seed();
  const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  for (const [name, w, h, target, act] of SHOTS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: w < 500 ? 2 : 1, isMobile: w < 500, hasTouch: w < 500, colorScheme: "dark" });
    await ctx.addInitScript(() => { try { localStorage.setItem("aios.settings.v1", JSON.stringify({ tourSeen: true })); localStorage.setItem("aios.widgets.firstLaunchSeen", "1"); } catch { /* storage unavailable */ } });
    const page = await ctx.newPage();
    page.setDefaultTimeout(20000);
    try {
      await page.goto(BASE);
      await page.getByLabel("Pairing code").fill(code());
      await page.getByRole("button", { name: "Pair" }).click();
      await page.locator(".shell").waitFor();
      await page.evaluate((h2) => { location.hash = h2; }, target);
      await page.locator(".cockpit").waitFor();
      await sleep(4500);                                   // let the renderer settle
      await act(page);
      await sleep(1200);
      await page.screenshot({ path: join(out, `${name}.png`) });
      console.log("shot", name);
    } catch (e) { console.log("FAILED", name, String(e.message).split("\n")[0]); try { await page.screenshot({ path: join(out, `${name}-FAILED.png`) }); } catch { /* ignore */ } }
    await ctx.close();
  }
  await browser.close();
} finally { stop(); }
console.log("OUT:", out);
