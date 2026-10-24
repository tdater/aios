import type { CapacitorConfig } from "@capacitor/cli";

// AIOS_ANDROID_DEBUG=1 is set ONLY by scripts/android-build.ps1 -Variant debug. It enables an http scheme
// (so the emulator can reach a local dev server through `adb reverse`) and WebView debugging.
// Release builds never set it: https scheme, no debugging, no cleartext, no dev server URL.
const dev = process.env.AIOS_ANDROID_DEBUG === "1";

const config: CapacitorConfig = {
  appId: "app.aios.companion",
  appName: "AIOS",
  webDir: "dist",                       // the production-built bundle ships inside the APK
  server: {
    androidScheme: dev ? "http" : "https",
    cleartext: false,
    allowNavigation: [],                // the WebView may not navigate to any other host
    // intentionally NO `url`: never ship a dev-server URL
  },
  android: {
    allowMixedContent: false,
    webContentsDebuggingEnabled: dev,
    loggingBehavior: dev ? "debug" : "none",
    backgroundColor: "#0f1216",
  },
};
export default config;
