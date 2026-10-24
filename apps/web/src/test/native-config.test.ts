import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { checkServerUrl } from "../core/servers";

// Static checks on the Android project so a careless edit cannot quietly weaken the shell.
const web = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(web, p), "utf8");
const manifest = read("android/app/src/main/AndroidManifest.xml");

describe("Android shell hardening (static)", () => {
  it("requests exactly one permission: INTERNET", () => {
    const perms = [...manifest.matchAll(/<uses-permission[^>]*android:name="([^"]+)"/g)].map((m) => m[1]);
    expect(perms).toEqual(["android.permission.INTERNET"]);
  });

  it("forbids cleartext and backups, uses a network security config, exports only the launcher", () => {
    expect(manifest).toMatch(/android:usesCleartextTraffic="false"/);
    expect(manifest).toMatch(/android:allowBackup="false"/);
    expect(manifest).toMatch(/android:networkSecurityConfig="@xml\/network_security_config"/);
    expect(manifest).toMatch(/android:dataExtractionRules=/);
    expect((manifest.match(/android:exported="true"/g) ?? []).length).toBe(1);
    expect(manifest).not.toMatch(/<provider/);                       // no FileProvider surface
    expect(manifest).not.toMatch(/debuggable/);
  });

  it("release network config is HTTPS-only with system CAs; cleartext appears ONLY in the debug override, only for loopback", () => {
    const main = read("android/app/src/main/res/xml/network_security_config.xml");
    expect(main).toMatch(/cleartextTrafficPermitted="false"/);
    expect(main).not.toMatch(/cleartextTrafficPermitted="true"/);
    expect(main).not.toMatch(/src="user"/);
    const dbg = read("android/app/src/debug/res/xml/network_security_config.xml");
    const domains = [...dbg.matchAll(/<domain\s[^>]*>([^<]+)</g)].map((m) => m[1]);   // <domain …>, not <domain-config>
    expect((dbg.match(/cleartextTrafficPermitted="true"/g) ?? []).length).toBe(1);   // one scoped domain-config only
    expect(domains.sort()).toEqual(["127.0.0.1", "localhost"]);
    expect(dbg.match(/<base-config cleartextTrafficPermitted="false"/)).toBeTruthy();
  });

  it("backup rules exclude everything from cloud backup and device transfer", () => {
    const r = read("android/app/src/main/res/xml/data_extraction_rules.xml");
    for (const section of ["cloud-backup", "device-transfer"]) {
      const body = r.match(new RegExp(`<${section}>([\\s\\S]*?)</${section}>`))![1];
      for (const d of ["root", "file", "database", "sharedpref", "external"]) expect(body).toContain(`domain="${d}"`);
      expect(body).not.toMatch(/<include/);
    }
  });

  it("release signing material is read from an untracked file and never defaulted to the debug key", () => {
    const g = read("android/app/build.gradle");
    expect(g).toMatch(/keystore\.properties/);
    expect(g).toMatch(/if \(keystoreFile\.exists\(\)\) \{ signingConfig signingConfigs\.release \}/);
    expect(g).not.toMatch(/signingConfigs\.debug/);
    expect(g).toMatch(/debuggable false/);
    const ignore = readFileSync(resolve(web, "../../.gitignore"), "utf8");
    for (const p of ["keystore.properties", "*.jks", "*.keystore"]) expect(ignore).toContain(p);
    expect(existsSync(resolve(web, "android/keystore.properties"))).toBe(false);
  });

  it("Capacitor config ships bundled assets only: no server.url, no navigation allowlist, https scheme in release", async () => {
    const src = read("capacitor.config.ts");
    expect(src).not.toMatch(/\burl:/);
    expect(src).toMatch(/allowNavigation:\s*\[\s*\]/);
    expect(src).toMatch(/cleartext:\s*false/);
    expect(src).toMatch(/allowMixedContent:\s*false/);
    const prev = process.env.AIOS_ANDROID_DEBUG;
    delete process.env.AIOS_ANDROID_DEBUG;
    const release = (await import("../../capacitor.config")).default;
    expect(release.server?.androidScheme).toBe("https");
    expect(release.android?.webContentsDebuggingEnabled).toBe(false);
    expect(release.server).not.toHaveProperty("url");
    if (prev !== undefined) process.env.AIOS_ANDROID_DEBUG = prev;
  });

  it("only the narrow plugin set is installed (secure storage + app back button)", () => {
    const deps = Object.keys(JSON.parse(read("package.json")).dependencies).filter((d) => d.startsWith("@capacitor/") || d.includes("capacitor"));
    expect(deps.sort()).toEqual(["@aparajita/capacitor-secure-storage", "@capacitor/android", "@capacitor/app", "@capacitor/core"]);
  });

  it("the app refuses cleartext server addresses in release behaviour, whatever the user types", () => {
    for (const bad of ["http://my-pc:8765", "http://100.64.1.2:8765", "http://localhost:8765", "http://10.0.2.2:8765"])
      expect(checkServerUrl(bad, false).ok).toBe(false);
  });
});

describe("PWA assets", () => {
  it("manifest is installable and icons exist", () => {
    const m = JSON.parse(read("public/manifest.webmanifest"));
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/");
    for (const i of m.icons) expect(existsSync(resolve(web, "public", i.src.slice(1)))).toBe(true);
    expect(m.icons.some((i: { purpose?: string }) => i.purpose === "maskable")).toBe(true);
  });
});
