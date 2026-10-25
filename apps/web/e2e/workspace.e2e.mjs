// Real end-to-end through the UI with REAL Claude Code: real AIOS server (its own dispatcher and worker
// threads), real SQLite, real git, real Edge, and your own Claude subscription. No mocks anywhere.
//
// It spends a few short Claude turns of YOUR subscription, so it only runs when you ask for it:
//   $env:AIOS_E2E_REAL_CLAUDE = "1"; node e2e\workspace.e2e.mjs
// Uses an ISOLATED temp state dir and a disposable git repository; never touches your real AIOS state.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

if (process.env.AIOS_E2E_REAL_CLAUDE !== "1") {
  console.log("SKIPPED: this test uses your Claude subscription. Set AIOS_E2E_REAL_CLAUDE=1 to run it.");
  process.exit(0);
}

const repo = resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..");
const py = join(repo, ".venv", "Scripts", "python.exe");
const tmp = join(tmpdir(), `aios-e2e-ws-${Date.now()}`);
const state = join(tmp, "state"), wsRoot = join(tmp, "ws"), proj = join(wsRoot, "calc"), shots = join(tmp, "shots");
for (const d of [state, proj, shots]) mkdirSync(d, { recursive: true });
const CALC = "def add(a, b):\n    return a - b\n\n\ndef multiply(a, b):\n    return a * b\n";
writeFileSync(join(proj, "calc.py"), CALC);
writeFileSync(join(proj, "test_calc.py"), "import unittest\n\nfrom calc import add, multiply\n\n\nclass CalcTests(unittest.TestCase):\n    def test_add(self):\n        self.assertEqual(add(2, 3), 5)\n\n    def test_multiply(self):\n        self.assertEqual(multiply(4, 5), 20)\n");
writeFileSync(join(proj, ".gitignore"), "__pycache__/\n");
const git = (...a) => { const r = spawnSync("git", ["-C", proj, ...a], { encoding: "utf8" }); if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`); return r.stdout; };
git("init", "-q", "-b", "main"); git("add", "-A");
git("-c", "user.name=e2e", "-c", "user.email=e2e@localhost", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "seed");

const PORT = 8794, BASE = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, PYTHONPATH: join(repo, "apps", "api"), AIOS_STATE_DIR: state, AIOS_WORKSPACES_DIR: wsRoot, AIOS_PORT: String(PORT), AIOS_HOST: "127.0.0.1" };
let server = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function startServer() {
  server = spawn(py, ["-m", "aios.main"], { env, cwd: repo, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  server.stderr.on("data", () => {}); server.stdout.on("data", () => {});
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`${BASE}/api/v1/meta`)).ok) return; } catch {} await sleep(250); }
  throw new Error("server did not start");
}
const stopServer = () => { if (server) { spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { windowsHide: true }); server = null; } };
const pairCode = () => /Pairing code: ([A-Z0-9-]+)/.exec(spawnSync(py, ["-m", "aios.pair"], { env, cwd: repo, encoding: "utf8" }).stdout)[1];

const results = [];
let dbgPage = null;
async function step(name, fn) {
  const t = Date.now();
  try { await fn(); results.push([true, name]); console.log(`PASS  ${name} (${Math.round((Date.now() - t) / 1000)}s)`); }
  catch (e) {
    results.push([false, name]);
    console.log(`FAIL  ${name}\n      ${String(e.message).split("\n")[0]}`);
    try { await dbgPage?.screenshot({ path: join(shots, `fail-${results.length}.png`) }); } catch {}
    try { console.log(`      page: ${await dbgPage.evaluate(() => `${location.hash} | ${document.body.innerText.replace(/\s+/g, " ").slice(0, 400)}`)}`); } catch {}
  }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const LONG = 240000;

let browser;
try {
  if (await fetch(`${BASE}/api/v1/meta`).then(() => true, () => false)) throw new Error(`port ${PORT} is already serving something. Stop it and retry.`);
  await startServer();
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  dbgPage = page;
  page.on("console", (m) => { if (m.type() === "error" && !/401/.test(m.text())) console.log(`      [browser console] ${m.text().slice(0, 200)}`); });
  const api = (method, path, body) => page.evaluate(async ({ method, path, body }) => {
    const csrf = (document.cookie.split("; ").find((c) => c.startsWith("aios_csrf=")) || "").split("=")[1] || "";
    const r = await fetch(`/api/v1${path}`, { method, headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, { method, path, body });
  const shot = (n) => page.screenshot({ path: join(shots, `${n}.png`) });
  const tab = (re) => page.getByRole("tab", { name: re }).click();
  const panel = (name) => page.getByRole("region", { name });
  const say = async (text, mode) => {
    await page.getByLabel("Your message").fill(text);
    if (mode === "edit") await page.getByLabel(/Make changes/).check(); else await page.getByLabel(/^Ask/).check();
    await page.getByRole("button", { name: mode === "edit" ? "Send and make changes" : "Send" }).click();
  };

  await step("sign in with a real pairing code", async () => {
    await page.goto(BASE);
    await page.getByLabel("Pairing code").fill(pairCode());
    await page.getByRole("button", { name: "Pair" }).click();
    await page.getByRole("heading", { name: "Home" }).waitFor();
    await page.getByRole("button", { name: /Workspace/ }).first().waitFor();
  });

  let projectId;
  await step("register the disposable repo as a project and set how AIOS checks changes (owner-set command)", async () => {
    const r = await api("POST", "/projects", { name: "E2E Calc", path: proj });
    expect(r.status === 201, `register failed: ${JSON.stringify(r.body)}`);
    projectId = r.body.id;
    const v = await api("PUT", `/projects/${projectId}/verify-command`, { argv: [py, "-B", "-m", "unittest", "test_calc"] });
    expect(v.status === 200, `verify-command failed: ${JSON.stringify(v.body)}`);
  });

  await step("start a conversation from the Workspace screen", async () => {
    await page.getByRole("button", { name: /^Workspace/ }).first().click();
    await page.getByRole("heading", { name: "Workspace" }).waitFor();
    await page.getByLabel(/What is it about/).fill("Fix add");
    await page.getByLabel("Which Claude model").selectOption("sonnet");
    await shot("01-picker");
    await page.getByRole("button", { name: "Start" }).click();
    await page.getByRole("heading", { name: "Fix add" }).waitFor();
  });

  await step("Ask: a real Claude reply arrives, attributed to Claude with its model", async () => {
    await say("In one short sentence, what does calc.py do?", "read");
    await page.locator("li.msg.provider").first().waitFor({ timeout: LONG });
    const who = await page.locator("li.msg.provider .who").first().innerText();
    expect(/Claude/.test(who) && /claude-/.test(who), `attribution looks wrong: ${who}`);
    await shot("02-ask-reply");
  });

  await step("Make changes: edits go to a separate copy and AIOS asks before running anything", async () => {
    await say("The tests in test_calc.py fail. Fix the bug in calc.py so they pass. Do not modify test_calc.py. Reply in one short paragraph.", "edit");
    await page.getByText(/Your approval is needed before AIOS runs the tests/).waitFor({ timeout: LONG });
    expect(readFileSync(join(proj, "calc.py"), "utf8") === CALC, "the project folder was touched before approval");
    expect(git("status", "--porcelain").trim() === "", "project folder is not clean");
    await shot("03-awaiting-approval");
  });

  await step("the change is shown as a readable diff and the project folder is still untouched", async () => {
    await tab(/^Changes/);
    await panel("Changes").getByText(/Your project folder has not been changed/).waitFor();
    await panel("Changes").getByText(/return a \+ b/).waitFor();
    expect(readFileSync(join(proj, "calc.py"), "utf8") === CALC, "project folder changed");
    await shot("04-changes");
  });

  await step("approval needs an acknowledgement, then AIOS runs the tests and they pass", async () => {
    await tab(/^Tests/);
    await panel("Tests").getByText("Your approval is needed").waitFor();
    const approve = page.getByRole("button", { name: "Approve and run the tests" });
    expect(await approve.isDisabled(), "approve must be disabled until the risk is acknowledged");
    await page.getByLabel(/I understand this runs code that Claude just wrote/).check();
    await shot("05-approval");
    await approve.click();
    await panel("Tests").getByText("tests passed").waitFor({ timeout: 120000 });
    await panel("Tests").getByText(/run by AIOS, not by Claude/).waitFor();
    await shot("06-tests-passed");
  });

  await step("Outcome: AIOS says READY, and says it decided", async () => {
    await tab(/^Outcome/);
    await panel("Outcome").getByText("READY", { exact: true }).waitFor();
    await panel("Outcome").getByText(/decided by AIOS from the facts below, not by Claude/).waitFor();
  });

  await step("independent review: a separate Claude session reviews the exact revision", async () => {
    await panel("Outcome").getByLabel("Reviewer model").selectOption("sonnet");
    await panel("Outcome").getByRole("button", { name: "Ask for an independent review" }).click();
    await panel("Outcome").getByText(/^Review of revision/).waitFor({ timeout: LONG });
    await panel("Outcome").getByText(/separate session/).waitFor();
    const text = await panel("Outcome").innerText();
    expect(/Independent review\s+\d+ high/.test(text), `review counts missing: ${text.slice(0, 300)}`);
    await shot("07-review");
  });

  await step("Status: real provider facts, real quota, and nothing Claude was not allowed", async () => {
    await tab(/^Status/);
    const s = panel("Status");
    await s.getByText("your subscription (no API charges)").waitFor();
    await s.getByRole("progressbar", { name: "5-hour window usage" }).waitFor();
    const text = await s.innerText();
    expect(/Running commands:\s*denied/.test(text), "permissions panel should say commands are denied");
    expect(!/Tools you did not allow\s*(Bash|PowerShell)/.test(text), "unexpected tools reported");
    expect(/no \(subscription login\)/.test(text), "should say no API key is in use");
    await shot("08-status");
  });

  await step("everything persisted: a reload shows the same conversation; the project folder is still untouched", async () => {
    await page.reload();
    await page.getByRole("heading", { name: "Fix add" }).waitFor();
    expect(await page.locator("li.msg.provider").count() >= 3, "expected the Ask reply, the change reply and the review");
    expect(await page.locator("li.msg.aios.verification").count() >= 1, "verification message missing");
    expect(readFileSync(join(proj, "calc.py"), "utf8") === CALC, "project folder changed");
    expect(git("branch", "--list", "aios/*").trim().length > 0, "the conversation branch should exist");
  });

  await step("phone width: the same conversation is usable", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("tab", { name: "Chat" }).click();
    await page.getByLabel("Your message").waitFor();
    await shot("09-phone");
  });
} catch (e) {
  console.log(`ABORT ${e.message}`);
  results.push([false, "setup"]);
} finally {
  try { await browser?.close(); } catch {}
  stopServer();
}
const failed = results.filter((r) => !r[0]).length;
console.log(`\n${results.length - failed}/${results.length} steps passed. Screenshots: ${shots}`);
process.exit(failed ? 1 : 0);
