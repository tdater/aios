// Real Android EMULATOR run (not a physical phone): installs the debug APK, drives the real WebView over
// DevTools, against a real AIOS server on an isolated temp state dir reached through `adb reverse`.
// Prereqs: emulator booted, debug APK built (scripts\android-build.ps1 -Variant debug).
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const repo = resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..");
const py = join(repo, ".venv", "Scripts", "python.exe");
const adbExe = join(process.env.ANDROID_HOME, "platform-tools", "adb.exe");
const apk = join(repo, "apps", "web", "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk");
const APP = "app.aios.companion.debug", ACTIVITY = `${APP}/app.aios.companion.MainActivity`;
const tmp = join(tmpdir(), `aios-droid-${Date.now()}`);
const state = join(tmp, "state"), ws = join(tmp, "ws", "sample"), shots = join(tmp, "shots");
for (const d of [state, ws, shots]) mkdirSync(d, { recursive: true });
writeFileSync(join(ws, "README.md"), "# android e2e\n");
const PORT = 8765, API = `http://127.0.0.1:${PORT}/api/v1`;
const env = { ...process.env, PYTHONPATH: join(repo, "apps", "api"), AIOS_STATE_DIR: state, AIOS_WORKSPACES_DIR: join(tmp, "ws"), AIOS_PORT: String(PORT) };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const adb = (...a) => spawnSync(adbExe, a, { encoding: "utf8" });
const sh = (cmd) => adb("shell", cmd).stdout.trim();
let server = null;
async function startServer() {
  server = spawn(py, ["-m", "aios.main"], { env, cwd: repo, stdio: "ignore", windowsHide: true });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${API}/meta`)).ok) return; } catch {} await sleep(250); }
  throw new Error("server did not start");
}
const stopServer = () => { if (server) { spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { windowsHide: true }); server = null; } };
const pairCode = () => /Pairing code: ([A-Z0-9-]+)/.exec(spawnSync(py, ["-m", "aios.pair"], { env, cwd: repo, encoding: "utf8" }).stdout)[1];

// A second, native-style session used ONLY by this script to inspect/create server-side state.
let adminToken;
async function admin(method, path, body) {
  const r = await fetch(`${API}${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const results = [];
async function step(name, fn) {
  const t = Date.now();
  try { await fn(); results.push([true, name]); console.log(`PASS  ${name} (${Date.now() - t}ms)`); }
  catch (e) { results.push([false, name]); console.log(`FAIL  ${name}\n      ${String(e.message).split("\n")[0]}`); }
}
const expect = (c, m) => { if (!c) throw new Error(m); };
const screencap = (n) => { const r = spawnSync(adbExe, ["exec-out", "screencap", "-p"], { maxBuffer: 1 << 26 }); writeFileSync(join(shots, `${n}.png`), r.stdout); };

let browser, page, port = 9333;
async function attach() {
  let pid = "";
  for (let i = 0; i < 40 && !pid; i++) { pid = sh(`pidof ${APP}`); if (!pid) await sleep(500); }
  expect(pid, "app process not running");
  adb("forward", `tcp:${port}`, `localabstract:webview_devtools_remote_${pid.split(" ")[0]}`);
  for (let i = 0; i < 40; i++) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith("http://localhost"));
      if (page) { page.setDefaultTimeout(25000); return; }
      await browser.close();
    } catch {}
    await sleep(1000);
  }
  throw new Error("could not attach to the app WebView over DevTools");
}
const launch = async () => { adb("shell", "am", "force-stop", APP); await sleep(500); adb("shell", "am", "start", "-n", ACTIVITY); await sleep(2500); await attach(); };
const prefs = () => { const ls = adb("shell", `run-as ${APP} ls shared_prefs`).stdout; return ls.split(/\s+/).filter((f) => f.endsWith(".xml")).map((f) => adb("shell", `run-as ${APP} cat shared_prefs/${f}`).stdout).join("\n"); };

try {
  expect(existsSync(apk), "debug APK not built");
  expect(/\bdevice\b/.test(adb("devices").stdout.split("\n").slice(1).join("\n")), "no emulator attached");
  expect(sh("getprop sys.boot_completed") === "1", "emulator not booted");
  console.log(`Emulator: API ${sh("getprop ro.build.version.sdk")}, ${sh("getprop ro.product.model")} (this is an EMULATOR, not a physical phone)`);
  await startServer();
  const adminPair = await (await fetch(`${API}/auth/pair`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: pairCode(), device_name: "e2e-admin", kind: "native" }) })).json();
  adminToken = adminPair.token;

  await step("install fresh debug APK; app starts in the real WebView", async () => {
    const r = adb("install", "-r", "-t", apk);
    expect(/Success/.test(r.stdout), `install failed: ${r.stdout}${r.stderr}`);
    adb("shell", "pm", "clear", APP);
    adb("reverse", `tcp:${PORT}`, `tcp:${PORT}`);
    adb("shell", "settings", "put", "system", "accelerometer_rotation", "0");
    adb("shell", "settings", "put", "system", "user_rotation", "0");
    await launch();
    await page.getByText("Connect to your AIOS server").waitFor();
    screencap("a01-setup");
  });

  let issuedToken = null;
  await step("server address: cleartext and credentialed URLs refused; dev loopback accepted (debug only)", async () => {
    for (const [bad, msg] of [["http://example.com", /HTTPS is required/], ["https://user:pw@host.example", /credentials/i], ["http://192.168.1.50:8765", /HTTPS is required/]]) {
      await page.getByLabel("Server address").fill(bad);
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByText(msg).waitFor();
    }
    await page.getByLabel("Server address").fill("http://localhost:8765");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByText("Sign in to this device").waitFor();
  });

  await step("pair; Home shows connected; token reached the app once and is NOT in localStorage or plaintext prefs", async () => {
    page.on("response", async (r) => { if (r.url().endsWith("/auth/pair") && r.request().method() === "POST") { try { issuedToken = (await r.json()).token; } catch {} } });
    await page.getByLabel("Pairing code").fill(pairCode());
    await page.getByRole("button", { name: "Pair" }).click();
    await page.getByRole("heading", { name: "Home" }).waitFor();
    await page.locator(".pill.connected").waitFor();
    for (let i = 0; i < 20 && !issuedToken; i++) await sleep(250);
    expect(issuedToken && issuedToken.length >= 40, "did not observe the issued token");
    const ls = await page.evaluate(() => JSON.stringify(Object.assign({}, localStorage)));
    expect(!ls.includes(issuedToken), "token found in localStorage");
    expect(!/token/i.test(ls.replace(/aios\.settings|aios\.servers/g, "")), "token-like key in localStorage");
    const p = prefs();
    expect(/aios\.token/.test(p), "no secure-storage entry found in app prefs");
    expect(!p.includes(issuedToken), "token stored in PLAINTEXT in SharedPreferences");
    screencap("a02-home");
  });

  await step("quick capture online creates a real server task (verified server-side)", async () => {
    await page.locator("textarea").first().fill("buy oat milk (from the emulator)");
    await page.getByRole("button", { name: "Capture" }).click();
    await page.getByText("Captured on the server.").waitFor();
    const l = await admin("GET", "/tasks?q=oat%20milk");
    expect(l.body.items.length === 1, `expected 1 task, got ${l.body.items.length}`);
  });

  let runId;
  await step("server disappears and returns while watching a run: honest banner, then resync to interrupted", async () => {
    await admin("POST", "/projects", { name: "Emu project", path: ws });
    const made = await admin("POST", "/tasks", { title: "emu slow", kind: "demo.slow_steps", spec: { steps: 14, pause: 0.5 }, start_run: true });
    runId = made.body.run.id;
    await page.evaluate((id) => { location.hash = `#/runs/${id}`; }, runId);
    await page.locator(".badge", { hasText: "running" }).first().waitFor();
    stopServer();
    await page.getByText(/Connection lost/).waitFor({ timeout: 40000 });
    screencap("a03-disconnected");
    await startServer();
    await page.locator(".badge", { hasText: "interrupted" }).first().waitFor({ timeout: 40000 });
    await page.locator(".pill.connected").waitFor({ timeout: 40000 });
    expect((await page.getByText(/Connection lost/).count()) === 0, "banner should clear");
  });

  await step("approval in the real app: exact action shown, approve once, effect only after approval", async () => {
    const file = join(state, "artifacts", "guarded", "emu.txt");
    await admin("POST", "/tasks", { title: "guarded emu", kind: "demo.guarded_write", spec: { filename: "emu.txt", content: "approved on emulator" }, start_run: true });
    await page.evaluate(() => { location.hash = "#/inbox"; });
    const row = page.getByRole("button", { name: /Write 20 chars/ });
    await row.waitFor();
    expect(!existsSync(file), "effect happened before approval");
    await row.click();
    await page.getByText("approved on emulator", { exact: true }).waitFor();
    screencap("a04-approval");
    await page.getByRole("button", { name: "Approve this exact action" }).click();
    await page.getByText(/This request is (approved|consumed)/).waitFor();
    for (let i = 0; i < 40 && !existsSync(file); i++) await sleep(250);
    expect(existsSync(file) && readFileSync(file, "utf8") === "approved on emulator", "approved effect did not happen exactly once");
  });

  await step("Android back key: detail -> list -> Home -> leaves the app", async () => {
    await page.evaluate(() => { location.hash = "#/home"; });
    await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: /Runs/ }).click();
    await page.getByRole("heading", { name: "Runs" }).waitFor();
    await page.getByRole("button", { name: /emu slow/ }).first().click();
    await page.getByRole("button", { name: "← Runs" }).waitFor();
    adb("shell", "input", "keyevent", "4");
    await page.waitForFunction(() => location.hash === "#/runs");
    adb("shell", "input", "keyevent", "4");
    await page.waitForFunction(() => location.hash === "#/home");
    adb("shell", "input", "keyevent", "4");
    await sleep(2000);
    const top = sh("dumpsys activity activities | grep -E 'mResumedActivity|topResumedActivity' | head -3");
    expect(!top.includes(APP), `app still resumed after back at Home: ${top}`);
  });

  await step("relaunch: still signed in via the Keystore-backed token (no re-pairing)", async () => {
    await launch();
    await page.getByRole("heading", { name: "Home" }).waitFor();
    await page.locator(".pill.connected").waitFor();
  });

  await step("rotation: landscape layout, safe areas, nothing clipped", async () => {
    adb("shell", "settings", "put", "system", "user_rotation", "1");
    await sleep(2000);
    await page.waitForFunction(() => innerWidth > innerHeight);
    await page.waitForSelector(".shell.landscape");
    const clipped = await page.evaluate(() => { const c = document.querySelector(".content"); return c.scrollWidth > c.clientWidth + 1; });
    expect(!clipped, "content clipped in landscape");
    screencap("a05-landscape");
    adb("shell", "settings", "put", "system", "user_rotation", "0");
    await sleep(1500);
    screencap("a06-portrait");
  });

  await step("WebView cannot be navigated away from the app (restricted navigation)", async () => {
    await page.evaluate(() => { window.location.href = "https://example.com/"; });
    await sleep(3500);
    const url = page.url();
    expect(url.startsWith("http://localhost"), `WebView navigated away to ${url}`);
    expect((await page.title()) === "AIOS", "page title changed");
    adb("shell", "input", "keyevent", "3");   // home, in case a system browser opened
    adb("shell", "am", "start", "-n", ACTIVITY);
    await sleep(1500);
  });

  await step("sign out: pairing screen returns, secret removed from the device, token revoked on the server", async () => {
    await attach().catch(() => {});
    await page.evaluate(() => { location.hash = "#/settings"; });
    await page.getByRole("button", { name: "Sign out this device" }).click();
    await page.getByText("Sign in to this device").waitFor();
    const p = prefs();
    expect(!/aios\.token\.[^<]*>[^<]{10,}/.test(p) || !p.includes("aios.token"), "token entry still present after sign-out");
    const r = await fetch(`${API}/home`, { headers: { Authorization: `Bearer ${issuedToken}` } });
    expect(r.status === 401, `old token still valid (${r.status})`);
  });
} catch (e) {
  console.log("FATAL", e.message);
  results.push([false, "fatal: " + e.message]);
} finally {
  try { await browser?.close(); } catch {}
  stopServer();
  adb("reverse", "--remove", `tcp:${PORT}`);
}
const failed = results.filter(([ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} emulator steps passed. Screenshots: ${shots}`);
process.exit(failed.length ? 1 : 0);
