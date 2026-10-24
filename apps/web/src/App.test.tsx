import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

function mockFetch(routes: Record<string, { status?: number; body: unknown }>) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const r = routes[url.replace(/^\/api/, "")];
    if (!r) return new Response(JSON.stringify({ detail: "no route" }), { status: 404 });
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }));
}
afterEach(() => vi.unstubAllGlobals());

describe("App", () => {
  it("shows real health data", async () => {
    mockFetch({ "/health": { body: { version: "x", db: "ok", schema: ["0001_init"], state_dir: "S:\\state", host: "127.0.0.1", port: 8765, run_counts: {}, disk_free_gb: 10, backup_status: "never run", last_backup: null, executors: [], billable_env: {}, startup: {} } } });
    render(<App />);
    await waitFor(() => expect(screen.getByText(/loopback only/)).toBeTruthy());
    expect(screen.getByText("No runs yet.")).toBeTruthy();
    expect(screen.getByText(/no backup has been taken/)).toBeTruthy();
  });

  it("shows an honest error when the backend is down", async () => {
    mockFetch({ "/health": { status: 500, body: { detail: "boom" } } });
    render(<App />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("boom"));
  });
});
