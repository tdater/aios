// Real-browser check of the WebGL universe renderer (dev harness at /dev/gl.html, served by Vite).
// Checks: the render is not blank, the WebGL camera lines up with project() (labels) within 2 px, reduced motion holds a
// still frame, a lost WebGL context recovers, and there are no console errors. Prints the measured frame time (reported,
// not enforced). Usage: node e2e/gl.e2e.mjs   (uses Edge, headless, real GPU through ANGLE)
import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { chromium } from "playwright-core";

const web = resolve(fileURLToPath(import.meta.url), "..", "..");
const PORT = 5198, BASE = `http://127.0.0.1:${PORT}/dev/gl.html`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Minimal PNG decoder (8-bit RGB/RGBA, all five filter types): enough for screenshots. */
function decodePng(buf) {
  let i = 8, w = 0, h = 0, ct = 0;
  const idat = [];
  while (i < buf.length) {
    const len = buf.readUInt32BE(i), type = buf.toString("ascii", i + 4, i + 8), data = buf.subarray(i + 8, i + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; if (data[8] !== 8) throw new Error("16-bit PNG not supported"); }
    if (type === "IDAT") idat.push(data);
    i += 12 + len;
  }
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : (() => { throw new Error(`PNG colour type ${ct}`); })();
  const raw = inflateSync(Buffer.concat(idat)), stride = w * bpp, out = Buffer.alloc(w * h * 4);
  const prev = Buffer.alloc(stride), cur = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      cur[x] = (row[x] + pred) & 255;
    }
    for (let x = 0; x < w; x++) { out[(y * w + x) * 4] = cur[x * bpp]; out[(y * w + x) * 4 + 1] = cur[x * bpp + 1]; out[(y * w + x) * 4 + 2] = cur[x * bpp + 2]; out[(y * w + x) * 4 + 3] = 255; }
    prev.set(cur);
  }
  return { w, h, px: out };
}

const results = [];
async function step(name, fn) {
  const t = Date.now();
  try { const note = await fn(); results.push(true); console.log(`PASS  ${name} (${Date.now() - t}ms)${note ? `  ${note}` : ""}`); }
  catch (e) { results.push(false); console.log(`FAIL  ${name}\n      ${String(e.message).split("\n")[0]}`); }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

const vite = spawn(process.execPath, [resolve(web, "node_modules", "vite", "bin", "vite.js"), "--port", String(PORT), "--host", "127.0.0.1", "--strictPort"], { cwd: web, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let browser;
try {
  for (let i = 0; ; i++) { try { if ((await fetch(BASE)).ok) break; } catch {} if (i > 120) throw new Error("vite did not start"); await sleep(250); }
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const errors = [];
  const open = async (query, w = 1280, h = 720) => {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); });
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    await page.goto(`${BASE}?ui=0&${query}`);
    await page.waitForFunction(() => window.__gl?.ready === true, null, { timeout: 30000 });
    return page;
  };
  const shot = async (page) => decodePng(await page.screenshot());

  await step("renders the sample universe (not blank)", async () => {
    const page = await open("t=40");
    await sleep(1500);
    const { w, h, px } = await shot(page);
    let sum = 0, sum2 = 0, lit = 0;
    for (let i = 0; i < w * h; i++) { const l = (px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2]) / 3; sum += l; sum2 += l * l; if (l > 40) lit++; }
    const mean = sum / (w * h), variance = sum2 / (w * h) - mean * mean;
    await page.close();
    expect(variance > 40, `pixel variance too low (${variance.toFixed(1)}): blank render?`);
    expect(lit > 2000, `too few lit pixels (${lit})`);
    return `mean ${mean.toFixed(1)}, variance ${variance.toFixed(0)}, lit px ${lit}`;
  });

  await step("WebGL camera lines up with project() within 2 px", async () => {
    let worst = 0;
    for (const [q, w, h] of [["align=1&t=0&yaw=0.9&pitch=0.35&dist=900&tx=40&ty=10&tz=-30", 1280, 720], ["align=1&t=0&yaw=-2.1&pitch=-0.5&dist=650", 390, 844]]) {
      const page = await open(q, w, h);
      await sleep(400);
      const expected = await page.evaluate(() => window.__gl.expected);
      const img = await shot(page);
      for (const e of expected) {
        if (!Number.isFinite(e.x) || e.x < 8 || e.y < 8 || e.x > img.w - 8 || e.y > img.h - 8) continue;
        let sx = 0, sy = 0, n = 0;
        for (let y = Math.floor(e.y) - 10; y <= Math.ceil(e.y) + 10; y++) for (let x = Math.floor(e.x) - 10; x <= Math.ceil(e.x) + 10; x++) {
          if (x < 0 || y < 0 || x >= img.w || y >= img.h) continue;
          const k = (y * img.w + x) * 4, r = img.px[k], g = img.px[k + 1], b = img.px[k + 2];
          if (g > 150 && g > r + 60 && g > b + 60) { sx += x + 0.5; sy += y + 0.5; n++; }
        }
        expect(n > 0, `no marker found near (${e.x}, ${e.y}) at ${w}x${h}`);
        const d = Math.hypot(sx / n - e.x, sy / n - e.y);
        worst = Math.max(worst, d);
        expect(d <= 2, `marker off by ${d.toFixed(2)} px at ${w}x${h}`);
      }
      await page.close();
    }
    return `worst offset ${worst.toFixed(2)} px`;
  });

  let frameReport = "";
  await step("measures frame time at 1920x1080 for 3 s", async () => {
    const page = await open("", 1920, 1080);
    await sleep(2500);                                      // let shaders compile and the governor settle
    const r = await page.evaluate(async () => {
      const start = window.__gl.frames.length;
      await new Promise((res) => setTimeout(res, 3000));
      const f = window.__gl.frames.slice(start);
      const sorted = [...f].sort((a, b) => a - b);
      return { n: f.length, mean: f.reduce((a, b) => a + b, 0) / f.length, p95: sorted[Math.floor(sorted.length * 0.95)], tier: window.__gl.tier, calls: window.__gl.engine?.lastDrawCalls };
    });
    await page.close();
    expect(r.n > 10, `only ${r.n} frames in 3 s`);
    frameReport = `mean ${r.mean.toFixed(2)} ms (${(1000 / r.mean).toFixed(0)} fps), p95 ${r.p95.toFixed(1)} ms, ${r.n} frames, tier ${r.tier}, ${r.calls} draw calls (incl. post passes)`;
    return frameReport;
  });

  await step("reduced motion holds a still frame", async () => {
    const page = await open("rm=1");
    await sleep(800);
    const a = await page.screenshot();
    await sleep(1200);
    const b = await page.screenshot();
    await page.close();
    expect(a.equals(b), "frame changed while reduced motion is on");
  });

  await step("recovers from a lost WebGL context", async () => {
    const page = await open("t=40");
    await page.evaluate(async () => {
      const gl = window.__gl.engine.renderer.getContext();
      const ext = gl.getExtension("WEBGL_lose_context");
      window.__gl.ready = false;
      ext.loseContext();
      await new Promise((r) => setTimeout(r, 300));
      ext.restoreContext();
    });
    await page.waitForFunction(() => window.__gl?.ready === true, null, { timeout: 20000 });
    await sleep(600);
    const { w, h, px } = await shot(page);
    let lit = 0;
    for (let i = 0; i < w * h; i++) if (px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2] > 120) lit++;
    await page.close();
    expect(lit > 2000, `blank after context restore (${lit} lit px)`);
  });

  await step("rebuilding the world releases GPU resources (no leaks)", async () => {
    const page = await open("t=40");
    await sleep(500);
    const r = await page.evaluate(async () => {
      const e = window.__gl.engine, mem = () => ({ ...e.renderer.info.memory, programs: e.renderer.info.programs?.length ?? 0 });
      const before = mem();
      for (let i = 0; i < 3; i++) { e.rebuild(); e.render(0); await new Promise((r) => setTimeout(r, 50)); }
      return { before, after: mem() };
    });
    await page.close();
    expect(r.after.geometries <= r.before.geometries && r.after.textures <= r.before.textures, `before ${JSON.stringify(r.before)} after ${JSON.stringify(r.after)}`);
    return `geometries ${r.before.geometries} -> ${r.after.geometries}, textures ${r.before.textures} -> ${r.after.textures}`;
  });

  await step("quality governor steps down when frames stay slow", async () => {
    const page = await open("slow=30");
    const seen = [];
    const t0 = Date.now();
    while (Date.now() - t0 < 12000) { const t = await page.evaluate(() => window.__gl.tier); if (seen.at(-1) !== t) seen.push(t); if (t === "low") break; await sleep(250); }
    const level = await page.evaluate(() => window.__gl.engine?.qualityLevel);
    await page.close();
    expect(seen.includes("medium") && seen.at(-1) === "low", `tiers seen: ${seen.join(" > ")}`);
    return `${seen.join(" > ")} (level ${level}) in ${((Date.now() - t0) / 1000).toFixed(1)} s`;
  });

  await step("no console errors", async () => { expect(errors.length === 0, errors.slice(0, 3).join(" | ")); });
} finally {
  await browser?.close();
  spawnSync("taskkill", ["/pid", String(vite.pid), "/T", "/F"], { windowsHide: true });
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
