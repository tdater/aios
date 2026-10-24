import { MemorySecureStore, SecureStore } from "../core/secure";

/** Everything platform-specific lives behind this narrow interface. The web build uses the defaults;
 *  the Android build swaps in Keystore-backed storage and native back-button handling (platform/capacitor.ts). */
export interface Platform {
  isNative: boolean;
  /** true => cleartext loopback servers may be added (debug builds only; never in release). */
  allowDevLoopback: boolean;
  secure: SecureStore;
  /** Register the back-action handler (hardware button / gesture). It returns true if it consumed the
   *  action; otherwise the platform may exit the app. Returns an unsubscribe function. */
  onBack(handler: () => boolean): () => void;
  /** Open a URL outside the app (system browser). Never navigates the app's own WebView. */
  openExternal(url: string): void;
  deviceLabel(): string;
}

export const webPlatform: Platform = {
  isNative: false,
  allowDevLoopback: false,
  secure: new MemorySecureStore(),
  onBack: () => () => {},
  openExternal: (url) => {
    if (/^https:\/\//i.test(url)) window.open(url, "_blank", "noopener,noreferrer");
  },
  deviceLabel: () => (/Android/i.test(navigator.userAgent) ? "Android browser" : "Web browser"),
};

let current: Platform = webPlatform;
export const getPlatform = () => current;
export const setPlatform = (p: Platform) => {
  current = p;
};
