// Real end-to-end run: real AIOS server + SQLite + real (Edge) browser at phone size. No mocks.
// Uses an ISOLATED temp state dir; never touches your real AIOS state. Usage: node e2e/mobile.e2e.mjs
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const repo = resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..");
const py = join(repo, ".venv", "Scripts", "python.exe");
const tmp = join(tmpdir(), `aios-e2e-${Date.now()}`);
const state = join(tmp, "state"), ws = join(tmp, "ws", "sample"), shots = join(tmp, "shots");
const PORT = 8791, BASE = `http://127.0.0.1:${PORT}`;
for (const d of [state, ws, shots, join(ws, "src")]) mkdirSync(d, { recursive: true });
writeFileSync(join(ws, "src", "app.py"), "# TODO later\nprint('hi')\n");
writeFileSync(join(ws, "config.ini"), "api_key = e2e-fake-secret-value-123456\n");
writeFileSync(join(ws, "README.md"), "# e2e sample\n");

const env = { ...process.env, PYTHONPATH: join(repo, "apps", "api"), AIOS_STATE_DIR: state, AIOS_WORKSPACES_DIR: join(tmp, "ws"), AIOS_PORT: String(PORT), AIOS_HOST: "127.0.0.1" };
let server = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function startServer() {
  server = spawn(py, ["-m", "aios.main"], { env, cwd: repo, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  server.stderr.on("data", () => {}); server.stdout.on("data", () => {});
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/api/v1/meta`)).ok) return; } catch {} await sleep(250); }
  throw new Error("server did not start");
}
function stopServer() { if (server) { spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { windowsHide: true }); server = null; } }
const pairCode = () => /Pairing code: ([A-Z0-9-]+)/.exec(spawnSync(py, ["-m", "aios.pair"], { env, cwd: repo, encoding: "utf8" }).stdout)[1];

const results = [];
async function step(name, fn) {
  const t = Date.now();
  try { await fn(); results.push([true, name]); console.log(`PASS  ${name} (${Date.now() - t}ms)`); }
  catch (e) {
    results.push([false, name]);
    console.log(`FAIL  ${name}\n      ${String(e.message).split("\n")[0]}`);
    try { await dbgPage?.screenshot({ path: join(shots, `fail-${results.length}.png`) }); } catch {}
    try { console.log(`      page: ${await dbgPage.evaluate(() => `${location.hash} | ${document.body.innerText.replace(/\s+/g, " ").slice(0, 300)}`)}`); } catch {}
  }
}
let dbgPage = null;
/** Poll a page-side predicate with page.evaluate (no eval of strings, so the app's strict CSP is irrelevant). */
async function until(page, fn, arg, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    if (await page.evaluate(fn, arg)) return;
    if (Date.now() > end) throw new Error(`condition not met within ${ms}ms: ${fn}`);
    await sleep(150);
  }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

let browser;
try {
  if (await fetch(`${BASE}/api/v1/meta`).then(() => true, () => false)) throw new Error(`port ${PORT} is already serving something (stray server from an earlier run?). Stop it and retry.`);
  await startServer();
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  dbgPage = page;
  page.on("console", (m) => { if (m.type() === "error") console.log(`      [browser console] ${m.text().slice(0, 200)}`); });
  const api = (method, path, body, key) => page.evaluate(async ({ method, path, body, key }) => {
    const csrf = (document.cookie.split("; ").find((c) => c.startsWith("aios_csrf=")) || "").split("=")[1] || "";
    const r = await fetch(`/api/v1${path}`, { method, headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf, ...(key ? { "Idempotency-Key": key } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => null), replay: r.headers.get("idempotent-replay") };
  }, { method, path, body, key });
  const shot = (n) => page.screenshot({ path: join(shots, `${n}.png`) });
  const badge = (t) => page.locator(".badge", { hasText: t }).first();

  await step("unauthenticated: sign-in screen shown, API refuses data", async () => {
    await page.goto(BASE);
    await page.getByText("Sign in to this device").waitFor();
    const r = await page.evaluate(async () => (await fetch("/api/v1/home")).status);
    expect(r === 401, `expected 401 got ${r}`);
  });
  await step("wrong code rejected, real code pairs, Home shows connected", async () => {
    await page.getByLabel("Pairing code").fill("AAAA-BBBB");
    await page.getByRole("button", { name: "Pair" }).click();
    await page.getByText(/wrong, expired, or already used/).waitFor();
    await page.getByLabel("Pairing code").fill(pairCode());
    await page.getByRole("button", { name: "Pair" }).click();
    await page.getByRole("heading", { name: "Home" }).waitFor();
    await page.getByText("Connected").first().waitFor();
    const cookies = await ctx.cookies();
    const sess = cookies.find((c) => c.name === "aios_session");
    expect(sess && sess.httpOnly && sess.sameSite === "Strict", "session cookie must be HttpOnly + SameSite=Strict");
    expect(!(await page.evaluate(() => document.cookie)).includes("aios_session"), "JS must not see the session cookie");
    await shot("01-home-phone");
  });
  await step("first run: the tour opens, explains the map, checks Claude, and can be skipped", async () => {
    const dlg = page.getByRole("dialog");
    await dlg.getByRole("heading", { name: "Welcome to AIOS" }).waitFor();
    await dlg.getByRole("button", { name: "Next" }).click();
    await dlg.getByRole("heading", { name: "This is your universe" }).waitFor();
    await dlg.getByRole("button", { name: "Next" }).click();
    await dlg.getByRole("heading", { name: "Connect Claude" }).waitFor();
    await dlg.getByText(/Claude is (connected|not connected yet)\./).waitFor();         // a real check against the real server
    await shot("01b-tour-claude");
    await dlg.getByRole("button", { name: "Skip the tour" }).click();
    await dlg.waitFor({ state: "detached" });
    await page.getByRole("group", { name: /Your universe/ }).waitFor();                    // the map is the first thing on Home
    await page.getByRole("region", { name: "What am I looking at?" }).waitFor();
    await shot("01c-universe-phone");
  });
  await step("register the sample workspace (server path) and see it listed", async () => {
    await page.getByRole("button", { name: /Projects/ }).click();
    await page.getByText("Register a workspace").click();
    await page.getByLabel("Name").fill("E2E Sample");
    await page.getByLabel("Server folder path").fill(ws);
    await page.getByRole("button", { name: "Register" }).click();
    await page.getByRole("button", { name: /E2E Sample/ }).waitFor();
  });
  let auditRunId;
  await step("submit a task; response lost in transit; retry reuses the key => exactly one task", async () => {
    await page.getByRole("button", { name: /E2E Sample/ }).click();
    await page.getByRole("heading", { name: "New task" }).waitFor();
    await page.getByLabel("Title").fill("Audit via phone");
    let dropped = false;
    await page.route("**/api/v1/tasks", async (route) => {
      if (!dropped && route.request().method() === "POST") { dropped = true; await route.fetch(); await route.abort("failed"); } else await route.continue();
    });
    await page.getByRole("button", { name: "Submit and run" }).click();
    await page.getByText(/retrying is safe/).waitFor();
    await page.getByRole("button", { name: "Submit and run" }).click();
    await page.waitForURL(/#\/runs\/run_/);
    auditRunId = page.url().split("/").pop();
    await page.unroute("**/api/v1/tasks");
    const list = await api("GET", "/tasks?q=Audit%20via%20phone");
    expect(list.body.items.length === 1, `expected 1 task, found ${list.body.items.length}`);
    const runs = await api("GET", "/runs?q=Audit%20via%20phone");
    expect(runs.body.items.length === 1, `expected 1 run, found ${runs.body.items.length}`);
  });
  await step("run completes with real evidence; artifact is redacted and inert text", async () => {
    await badge("completed").waitFor();
    await page.getByText(/PASS: artifact:audit_report/).waitFor();
    await page.getByRole("button", { name: /Artifacts/ }).click();
    await page.getByRole("button", { name: "Show content" }).first().click();
    await page.locator("pre.untrusted").first().waitFor();
    const text = await page.locator("pre.untrusted").first().innerText();
    expect(!text.includes("e2e-fake-secret-value"), "secret value leaked into artifact");
    await shot("02-run-completed");
  });
  await step("cancel a running run: REQUESTED first, CONFIRMED later, UI says so honestly", async () => {
    // Long steps keep the "requested" state alive for seconds, so a slow runner can't skip straight to "confirmed" between polls.
    const made = await api("POST", "/tasks", { title: "slow cancel", kind: "demo.slow_steps", spec: { steps: 4, pause: 6 }, start_run: true });
    const id = made.body.run.id;
    await page.goto(`${BASE}/#/runs/${id}`);
    await badge("running").waitFor();
    await page.getByRole("button", { name: "Request cancellation…" }).click();
    await page.getByRole("button", { name: /Yes, request cancellation/ }).click();
    await page.getByText(/Cancellation requested — not yet complete/).waitFor();
    await shot("03-cancel-requested");
    await page.locator(".note strong", { hasText: /^Cancellation confirmed$/ }).waitFor();
    await badge("cancelled").waitFor();
  });
  await step("server goes away and comes back: UI shows stale data honestly, then resyncs (run is interrupted, never faked)", async () => {
    const made = await api("POST", "/tasks", { title: "slow reconnect", kind: "demo.slow_steps", spec: { steps: 14, pause: 0.5 }, start_run: true });
    const id = made.body.run.id;
    await page.goto(`${BASE}/#/runs/${id}`);
    await badge("running").waitFor();
    stopServer();
    await page.getByText(/Connection lost/).waitFor({ timeout: 30000 });
    await page.locator(".pill.disconnected").waitFor({ timeout: 40000 });
    await shot("04-disconnected");
    await startServer();
    await badge("interrupted").waitFor({ timeout: 30000 });
    await page.locator(".pill.connected").waitFor({ timeout: 30000 });
    expect(await page.getByText(/Connection lost/).count() === 0, "banner should clear after resync");
    await page.getByRole("button", { name: "Resume run" }).click();
    await badge("completed").waitFor({ timeout: 40000 });
  });
  let approvalFile = join(state, "artifacts", "guarded", "e2e.txt");
  await step("approval: exact action shown; approve once; effect happens only after approval", async () => {
    const made = await api("POST", "/tasks", { title: "guarded", kind: "demo.guarded_write", spec: { filename: "e2e.txt", content: "approved from the phone" }, start_run: true });
    await page.goto(`${BASE}/#/inbox`);
    await page.getByRole("button", { name: /Write 23 chars/ }).waitFor();
    expect(!existsSync(approvalFile), "effect happened before approval");
    await page.getByRole("button", { name: /Write 23 chars/ }).click();
    await page.getByText("Exact target").waitFor();
    await page.getByText("approved from the phone", { exact: true }).waitFor();
    await shot("05-approval-detail");
    const btn = page.getByRole("button", { name: "Approve this exact action" });
    await btn.dblclick();
    await page.getByText(/This request is (approved|consumed)/).waitFor();
    for (let i = 0; i < 40 && !existsSync(approvalFile); i++) await sleep(250);
    expect(existsSync(approvalFile) && readFileSync(approvalFile, "utf8") === "approved from the phone", "approved effect did not occur exactly");
    // the file appears a moment before the run records its last step and acceptance checks: poll, don't race
    let state = "";
    for (let i = 0; i < 40 && state !== "completed"; i++) {
      state = (await api("GET", `/runs/${made.body.run.id}`)).body.run.display_state;
      if (state !== "completed") await sleep(250);
    }
    expect(state === "completed", `run should complete after approval (last state: ${state})`);
  });
  await step("approval rejection: nothing is written and the run is cancelled", async () => {
    await api("POST", "/tasks", { title: "guarded no", kind: "demo.guarded_write", spec: { filename: "never.txt", content: "do not write" }, start_run: true });
    await page.goto(`${BASE}/#/inbox`);
    await page.getByRole("button", { name: /Write 12 chars/ }).click();
    await page.getByRole("button", { name: "Reject" }).click();
    await page.getByText(/This request is rejected/).waitFor();
    await sleep(1500);
    expect(!existsSync(join(state, "artifacts", "guarded", "never.txt")), "rejected action was executed");
  });
  await step("knowledge: edit with a stale version is refused and says nothing was saved", async () => {
    const m = await api("POST", "/memories", { scope: "global", type: "fact", title: "Build command", body: "use gradlew assembleDebug" });
    await page.goto(`${BASE}/#/knowledge/${m.body.id}`);
    await page.getByRole("button", { name: "Edit" }).click();
    await api("PATCH", `/memories/${m.body.id}`, { title: "Changed elsewhere", expected_version: m.body.version });   // another device wins
    await page.getByLabel("Title").fill("My phone edit");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByText(/were NOT saved/).waitFor();
    expect((await api("GET", `/memories/${m.body.id}`)).body.title === "Changed elsewhere", "stale edit must not overwrite the newer version");
  });
  await step("vault: wiki links resolve and navigate, backlinks show, palette (Ctrl+K) opens a note, graph renders", async () => {
    const a = await api("POST", "/memories", { scope: "global", type: "fact", title: "Zeta alpha note", body: "Points at [[Zeta beta note]] and [[Zeta ghost]] #zeta" });
    const b = await api("POST", "/memories", { scope: "global", type: "fact", title: "Zeta beta note", body: "Plain body" });
    await page.goto(`${BASE}/#/knowledge/${a.body.id}`);
    await page.reload();                                                              // the vault index polls every 25 s; notes made behind the UI's back need a fresh load
    await page.locator(".md button.wikilink:not(.ghost)", { hasText: "Zeta beta note" }).click();
    await page.waitForFunction((id) => location.hash.endsWith(id), b.body.id);
    await page.getByText(/Points at/).first().waitFor({ state: "visible" });         // backlink excerpt from the first note
    await page.keyboard.press("Control+k");
    const box = page.getByRole("combobox", { name: "Search" });
    await box.waitFor();
    await box.fill("zeta alpha");
    await page.getByRole("option").first().waitFor();
    await page.keyboard.press("Enter");
    await page.waitForFunction((id) => location.hash.endsWith(id), a.body.id);
    await page.goto(`${BASE}/#/graph`);
    await page.locator("canvas").first().waitFor();
    await page.getByRole("img", { name: /Knowledge graph\. \d+ nodes/ }).waitFor();
  });
  await step("daily note via Ctrl+Alt+D is created once and reused; pinned tab survives; settings shows history and publishing", async () => {
    await page.goto(`${BASE}/#/home`);
    await page.getByText("Quick capture").waitFor();
    await page.keyboard.press("Control+Alt+d");
    await until(page, (p) => location.hash.startsWith(p), "#/knowledge/mem_");
    const first = await page.evaluate(() => location.hash);
    await page.goto(`${BASE}/#/home`);
    await page.keyboard.press("Control+Alt+d");
    await until(page, (h) => location.hash === h, first);
    const today = (await api("GET", "/memories?tag=daily&limit=50")).body.items;
    expect(today.length === 1, `expected exactly one daily note, got ${today.length}`);
    await page.keyboard.press("Alt+p");                                               // pin the open note's tab
    await until(page, (w) => JSON.stringify(Object.entries(localStorage)).includes(w), "pinned");
    await page.goto(`${BASE}/#/settings/history`);
    await page.getByRole("heading", { name: "Imported history" }).waitFor();
    await page.getByRole("heading", { name: "Publishing" }).waitFor();
  });
  await step("offline: capture becomes a local draft; reconnect does not auto-send; explicit send creates exactly one task", async () => {
    await page.goto(`${BASE}/#/home`);
    await page.getByText("Quick capture").waitFor();
    await ctx.setOffline(true);
    await page.locator(".pill.disconnected, .pill.stale").first().waitFor({ timeout: 40000 });
    await page.locator("textarea").first().fill("buy oat milk");
    await page.getByRole("button", { name: /Save draft|Capture/ }).click();
    await page.getByText(/Saved as a local draft|Could not|No answer/).first().waitFor();
    const before = (await ctx.request.get(`${BASE}/api/v1/meta`)).ok();   // server still up; browser was offline
    await ctx.setOffline(false);
    await page.locator(".pill.connected").waitFor({ timeout: 40000 });
    await page.getByText("Local drafts").waitFor();
    await page.getByText(/You are back online with 1 unsent draft/).waitFor();
    const n0 = (await api("GET", "/tasks?q=oat")).body.items.length;
    expect(n0 === 0, "draft must not auto-upload on reconnect");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await page.getByText("sent", { exact: true }).first().waitFor();
    const n1 = (await api("GET", "/tasks?q=oat")).body.items.length;
    expect(n1 === 1, `expected exactly 1 task after explicit send, got ${n1}`);
  });
  await step("service worker caches the app shell only, never /api", async () => {
    await page.goto(BASE);
    await page.waitForFunction(() => navigator.serviceWorker.getRegistration().then((r) => !!r && !!r.active), null, { timeout: 20000 });
    const info = await page.evaluate(async () => {
      const names = (await caches.keys()).filter((n) => n.startsWith("aios-shell-"));
      const urls = [];
      for (const n of names) for (const r of await (await caches.open(n)).keys()) urls.push(new URL(r.url).pathname);
      return { names, urls };
    });
    expect(info.names.length >= 1, "no shell cache");
    expect(!info.urls.some((u) => u.startsWith("/api/")), `API response cached: ${info.urls}`);
  });
  await step("responsive screenshots: phone landscape, tablet two-pane, desktop", async () => {
    for (const [n, w, h, hash] of [["06-phone-landscape-runs", 844, 390, "#/runs"], ["07-tablet-inbox", 820, 1180, "#/inbox"], ["08-desktop-home", 1280, 800, "#/home"]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(`${BASE}/${hash}`);
      await page.getByRole("navigation", { name: "Main" }).waitFor();
      await sleep(600);
      await shot(n);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      expect(!overflow, `horizontal overflow at ${w}x${h}`);
    }
    // the safety-critical screen with a very long path must wrap, not clip (checked inside the scroll container)
    await page.setViewportSize({ width: 360, height: 740 });
    await api("POST", "/tasks", { title: "long path", kind: "demo.guarded_write", spec: { filename: "a-very-long-file-name-that-keeps-going-and-going-and-going-and-going-forever.txt", content: "x" }, start_run: true });
    await page.goto(`${BASE}/#/inbox`);
    await page.getByRole("button", { name: /Write 1 chars/ }).click();
    await page.getByText("Exact target").waitFor();
    await sleep(400);
    const clipped = await page.evaluate(() => { const c = document.querySelector(".content"); return c.scrollWidth > c.clientWidth + 1; });
    expect(!clipped, "approval screen content is clipped horizontally at 360px");
    await shot("09-approval-long-path-360");
    await page.setViewportSize({ width: 390, height: 844 });
  });
  await step("sign out revokes the session server-side", async () => {
    await page.goto(`${BASE}/#/settings`);
    await page.getByRole("button", { name: "Sign out this device" }).click();
    await page.getByText("Sign in to this device").waitFor();
    const r = await page.evaluate(async () => (await fetch("/api/v1/home")).status);
    expect(r === 401, `expected 401 after logout, got ${r}`);
  });
} catch (e) {
  console.log("FATAL", e.message);
  results.push([false, "fatal: " + e.message]);
} finally {
  await browser?.close();
  stopServer();
}
const failed = results.filter(([ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} e2e steps passed. Screenshots: ${shots}`);
writeFileSync(join(tmp, "e2e-summary.txt"), results.map(([ok, n]) => `${ok ? "PASS" : "FAIL"} ${n}`).join("\n"));
process.exit(failed.length ? 1 : 0);
