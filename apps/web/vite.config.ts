/// <reference types="vitest" />
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react";

/** Emits /sw.js from src/pwa/sw.template.js with the hashed asset list and a build id. */
function serviceWorker(): Plugin {
  return {
    name: "aios-sw",
    apply: "build",
    generateBundle(_, bundle) {
      const assets = Object.keys(bundle).filter((f) => f !== "sw.js").map((f) => `/${f}`);
      const shell = ["/", "/index.html", "/manifest.webmanifest", "/icon-192.png", ...assets.filter((a) => a.startsWith("/assets/"))];
      const id = createHash("sha256").update(assets.sort().join("|")).digest("hex").slice(0, 12);
      const src = readFileSync(resolve(__dirname, "src/pwa/sw.template.js"), "utf8")
        .replace("__BUILD_ID__", id).replace("__SHELL_ASSETS__", JSON.stringify([...new Set(shell)]));
      this.emitFile({ type: "asset", fileName: "sw.js", source: src });
    },
  };
}

/** Production-only Content-Security-Policy (dev server needs inline preamble scripts). Scripts: self only. */
function csp(): Plugin {
  const devLoopback = process.env.VITE_ALLOW_DEV_LOOPBACK === "1";   // debug APK only (emulator via adb reverse)
  const policy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
    `connect-src 'self' https:${devLoopback ? " http://localhost:8765 http://127.0.0.1:8765" : ""}; ` +
    "base-uri 'none'; form-action 'self'; object-src 'none'";
  return {
    name: "aios-csp",
    apply: "build",
    transformIndexHtml: () => [{ tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: policy }, injectTo: "head-prepend" }],
  };
}

export default defineConfig({
  plugins: [react(), serviceWorker(), csp()],
  server: { host: "127.0.0.1", port: 5173, proxy: { "/api": "http://127.0.0.1:8765" } },
  test: { environment: "jsdom", globals: true, setupFiles: ["./src/test/setup.ts"] },
});
