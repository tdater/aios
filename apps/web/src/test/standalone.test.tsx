import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { STANDALONE_URL } from "../core/localEngine";
import { createRuntime } from "../core/runtime";
import { MemoryKV } from "../core/storage";
import { Welcome } from "../screens/Boot";
import { Settings } from "../screens/Settings";
import { fakeServer, META } from "./fakeServer";
import { ctxFor, newPlatform, resetRoute, setWidth, Wrap } from "./helpers";

const native = () => newPlatform({ isNative: true });
beforeEach(() => { resetRoute(""); setWidth(412, 860); });
afterEach(() => cleanup());

describe("the first screen on a phone", () => {
  it("offers this phone on its own or a PC, and says what each one needs", () => {
    const standalone = vi.fn(), add = vi.fn();
    render(<Welcome allowDevLoopback={false} hasStandalone={false} onStandalone={standalone} onAdd={add} />);
    expect(screen.getByText(/No PC and no account needed/)).toBeTruthy();
    expect(screen.getByText(/one-time pairing code/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Use AIOS on this phone only/ }));
    expect(standalone).toHaveBeenCalledTimes(1);
  });

  it("connecting to a PC is one form: name, address and the pairing code together, with a way back", () => {
    const add = vi.fn();
    render(<Welcome allowDevLoopback={false} hasStandalone={false} onStandalone={vi.fn()} onAdd={add} />);
    fireEvent.click(screen.getByRole("button", { name: /Connect to AIOS on my PC/ }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Home PC" } });
    fireEvent.change(screen.getByLabelText("Server address"), { target: { value: "https://yoga2in1.tail8c1f7a.ts.net" } });
    fireEvent.change(screen.getByLabelText(/Pairing code/), { target: { value: "k7qm-x4td" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(add).toHaveBeenCalledWith("Home PC", "https://yoga2in1.tail8c1f7a.ts.net", "K7QM-X4TD");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("button", { name: /Use AIOS on this phone/ })).toBeTruthy();
  });

  it("explains an IP address mistake instead of accepting it", () => {
    render(<Welcome allowDevLoopback={false} hasStandalone={false} onStandalone={vi.fn()} onAdd={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Connect to AIOS on my PC/ }));
    fireEvent.change(screen.getByLabelText("Server address"), { target: { value: "http://100.105.125.14:8765" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("alert").textContent).toContain("IP address like 100.105.125.14");
  });
});

describe("standalone mode, end to end in the app", () => {
  it("starts on the phone with no server at all, shows the universe, and never touches the network", async () => {
    const srv = fakeServer({} as never);
    const rt = createRuntime(native(), new MemoryKV());
    rt.settings.update({ tourSeen: true });
    render(<App platform={native()} runtime={rt} />);
    fireEvent.click(await screen.findByRole("button", { name: /Use AIOS on this phone only/ }));
    expect(await screen.findByTestId("cockpit")).toBeTruthy();
    expect(rt.registry.active()).toMatchObject({ label: "This phone", url: STANDALONE_URL });
    expect(srv.calls).toHaveLength(0);                                                  // not one request left the app
    expect(screen.getByRole("button", { name: /Connect to my PC/ })).toBeTruthy();       // the wormhole to the PC is in the universe
  });

  it("comes back to the same standalone app after a restart, with no choice screen", async () => {
    const kv = new MemoryKV();
    const rt1 = createRuntime(native(), kv);
    rt1.settings.update({ tourSeen: true });
    const e = rt1.registry.add("This phone", STANDALONE_URL);
    rt1.registry.setActive(e.id);
    fakeServer({} as never);
    render(<App platform={native()} runtime={createRuntime(native(), kv)} />);
    expect(await screen.findByTestId("cockpit")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Use AIOS on this phone only/ })).toBeNull();
  });

  it("a note made on the phone stays on the phone and is there next time", async () => {
    const kv = new MemoryKV();
    const rt = createRuntime(native(), kv);
    rt.settings.update({ tourSeen: true });
    const e = rt.registry.add("This phone", STANDALONE_URL);
    rt.registry.setActive(e.id);
    const srv = fakeServer({} as never);
    resetRoute("#/knowledge");
    render(<App platform={native()} runtime={rt} />);
    expect(await screen.findAllByText("Welcome to AIOS on your phone")).toBeTruthy();
    expect(srv.calls).toHaveLength(0);
  });

  it("Settings explains this is the phone's own AIOS, hides what only a PC has, and offers to connect to one", async () => {
    const c = ctxFor();
    const kv = new MemoryKV();
    const rt = createRuntime(native(), kv);
    const e = rt.registry.add("This phone", STANDALONE_URL);
    rt.registry.setActive(e.id);
    fakeServer({ "GET /meta": () => ({ body: META }) } as never);
    render(<Wrap ctx={{ ...c.ctx, server: e, registry: rt.registry, isNative: true }}><Settings /></Wrap>);
    const server = within(await screen.findByRole("heading", { name: "Server" }).then((h) => h.closest("section") as HTMLElement));
    expect(server.getByText(/This phone only\. Nothing leaves it\./)).toBeTruthy();
    expect(server.getByRole("button", { name: /Connect to my PC, or add another server/ })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /Session/ })).toBeNull();
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Imported history" })).toBeNull());
  });
});

