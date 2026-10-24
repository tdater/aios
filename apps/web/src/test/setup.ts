import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Node 26 ships an experimental global localStorage that shadows jsdom's; give tests a plain in-memory one.
class Mem implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
}
Object.defineProperty(globalThis, "localStorage", { value: new Mem(), configurable: true });
Object.defineProperty(window, "localStorage", { value: globalThis.localStorage, configurable: true });

afterEach(() => {
  cleanup();
  localStorage.clear();
});
