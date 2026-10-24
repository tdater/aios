import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { SecureStorage } from "@aparajita/capacitor-secure-storage";
import { Platform } from "./index";

export const isNativeShell = () => Capacitor.isNativePlatform();

/** Android shell. The bridge is deliberately narrow: Keystore-backed secret storage, back button, nothing else.
 *  Tokens live only in SecureStorage (AES-GCM key held in the Android Keystore); never in localStorage. */
export function nativePlatform(): Platform {
  let handler: (() => boolean) | null = null;
  void App.addListener("backButton", () => {
    if (!(handler?.() ?? false)) void App.exitApp();
  });
  return {
    isNative: true,
    allowDevLoopback: import.meta.env.VITE_ALLOW_DEV_LOOPBACK === "1",   // debug builds only; refused in release by the build script
    secure: {
      get: async (k) => {
        try {
          const v = await SecureStorage.get(k);
          return typeof v === "string" ? v : null;
        } catch {
          return null;               // corrupted/unreadable => treat as signed out, re-pair
        }
      },
      set: async (k, v) => void (await SecureStorage.set(k, v)),
      remove: async (k) => void (await SecureStorage.remove(k).catch(() => false)),
    },
    onBack: (h) => {
      handler = h;
      return () => { if (handler === h) handler = null; };
    },
    openExternal: (url) => { if (/^https:\/\//i.test(url)) window.open(url, "_blank", "noopener,noreferrer"); },
    deviceLabel: () => "Android app",
  };
}
