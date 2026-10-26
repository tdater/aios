import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AbilitiesSection } from "../screens/settings/Abilities";
import { WidgetStrip } from "../ui/Widgets";
import { fakeServer } from "./fakeServer";
import { ctxFor, resetRoute, setWidth, Wrap } from "./helpers";

beforeEach(() => { resetRoute(""); setWidth(1200, 900); });
afterEach(cleanup);

const ABILITY = { name: "system_scan", title: "Check this PC and suggest improvements", can_see: ["memory and disk usage"], can_do: ["read those numbers"], cannot: ["change or delete anything"], enabled: false };
const status = (o = {}) => ({ paused: false, abilities: [ABILITY, { ...ABILITY, name: "widgets", title: "Small panels on Today", enabled: false }], planned: [{ name: "app_control", title: "Control other apps (not built yet)" }], ...o });

describe("abilities: off until you say yes, in words you can read", () => {
  it("turning one on shows what it can see, do and never do, and sends the confirmation only after you agree", async () => {
    let st = status();
    const srv = fakeServer({
      "GET /abilities": () => ({ body: st }), "GET /receipts": () => ({ body: { items: [] } }), "GET /widgets": () => ({ body: { items: [] } }),
      "PUT /abilities/system_scan": () => { st = status({ abilities: [{ ...ABILITY, enabled: true }, st.abilities[1]] }); return { body: st }; },
    });
    render(<Wrap ctx={ctxFor().ctx}><AbilitiesSection /></Wrap>);
    const group = await screen.findByRole("group", { name: "Check this PC and suggest improvements" });
    fireEvent.click(within(group).getByRole("button", { name: /Turn on/ }));
    expect(group.textContent).toContain("It can look at: memory and disk usage");
    expect(group.textContent).toContain("It will never: change or delete anything");
    expect(srv.calls.some((c: { method: string }) => c.method === "PUT")).toBe(false);          // nothing sent yet
    fireEvent.click(within(group).getByRole("button", { name: "Yes, turn it on" }));
    await waitFor(() => expect(within(screen.getByRole("group", { name: ABILITY.title })).getByText("On")).toBeTruthy());
    expect(srv.calls.find((c: { method: string }) => c.method === "PUT")!.body).toEqual({ enabled: true, confirm: true });
  });

  it("pausing is one button, and planned abilities are listed as not built", async () => {
    let paused = false;
    const srv = fakeServer({
      "GET /abilities": () => ({ body: status({ paused }) }), "GET /receipts": () => ({ body: { items: [{ id: "r1", ts: "2026-10-25T00:00:00+00:00", actor: "owner", kind: "pause", summary: "Paused everything.", changed: 1 }] } }),
      "GET /widgets": () => ({ body: { items: [] } }), "POST /pause": () => { paused = true; return { body: { paused: true } }; },
    });
    render(<Wrap ctx={ctxFor().ctx}><AbilitiesSection /></Wrap>);
    fireEvent.click(await screen.findByRole("button", { name: "Pause everything" }));
    expect(await screen.findByText("AIOS is paused")).toBeTruthy();
    expect(srv.calls.some((c: { path: string }) => c.path.endsWith("/pause"))).toBe(true);
    expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Not built yet/ }));
    expect(screen.getByText("Control other apps (not built yet)")).toBeTruthy();
  });

  it("the scan shows plain suggestions and says nothing was changed; no accessibility violations", async () => {
    fakeServer({
      "GET /abilities": () => ({ body: status({ abilities: [{ ...ABILITY, enabled: true }, status().abilities[1]] }) }), "GET /receipts": () => ({ body: { items: [] } }), "GET /widgets": () => ({ body: { items: [] } }),
      "POST /system-scan": () => ({ body: { facts: {}, suggestions: [{ id: "disk", level: "attention", text: "Only 4.0 GB is free." }], changed_anything: false } }),
    });
    const { container } = render(<Wrap ctx={ctxFor().ctx}><AbilitiesSection /></Wrap>);
    fireEvent.click(await screen.findByRole("button", { name: "Check this PC now" }));
    const found = await screen.findByRole("list", { name: "What the check found" });
    expect(found.textContent).toContain("Only 4.0 GB is free.");
    expect(found.textContent).toContain("Nothing was changed.");
    const r = await axe.run(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join("|")}`)).toEqual([]);
  });

  it("shows the server's reason when an ability is refused", async () => {
    fakeServer({
      "GET /abilities": () => ({ body: status() }), "GET /receipts": () => ({ body: { items: [] } }), "GET /widgets": () => ({ body: { items: [] } }),
      "PUT /abilities/system_scan": () => ({ status: 422, body: { error: { code: "confirmation_required", message: "Turning this on needs your explicit confirmation." } } }),
    });
    render(<Wrap ctx={ctxFor().ctx}><AbilitiesSection /></Wrap>);
    const g = await screen.findByRole("group", { name: ABILITY.title });
    fireEvent.click(within(g).getByRole("button", { name: /Turn on/ }));
    fireEvent.click(within(g).getByRole("button", { name: "Yes, turn it on" }));
    expect((await screen.findByRole("alert")).textContent).toContain("explicit confirmation");
  });
});

describe("widgets on Today render as plain text and save through the server", () => {
  it("a note is text, a checklist toggles through PUT, and markup is never interpreted", async () => {
    const srv = fakeServer({
      "GET /widgets": () => ({ body: { items: [
        { id: "w1", kind: "note", title: "Reminder", config: { text: "<img src=x onerror=alert(1)>" } },
        { id: "w2", kind: "checklist", title: "Groceries", config: { items: [{ text: "Milk", done: false }] } },
        { id: "w3", kind: "counter", title: "Glasses of water", config: { value: 2, step: 1 } }] } }),
      "PUT /widgets/w2": () => ({ body: {} }), "PUT /widgets/w3": () => ({ body: {} }),
    });
    const { container } = render(<Wrap ctx={ctxFor().ctx}><WidgetStrip /></Wrap>);
    expect((await screen.findByText("<img src=x onerror=alert(1)>")).tagName).toBe("P");
    expect(container.querySelector("img")).toBeNull();
    fireEvent.click(screen.getByLabelText("Milk"));
    fireEvent.click(screen.getByRole("button", { name: "Add 1 to Glasses of water" }));
    await waitFor(() => expect(srv.calls.filter((c: { method: string }) => c.method === "PUT").map((c: { body: unknown }) => c.body)).toEqual([
      { config: { items: [{ text: "Milk", done: true }] } }, { config: { value: 3, step: 1 } }]));
  });
  it("renders nothing when there are no panels", async () => {
    fakeServer({ "GET /widgets": () => ({ body: { items: [] } }) });
    const { container } = render(<Wrap ctx={ctxFor().ctx}><WidgetStrip /></Wrap>);
    await waitFor(() => expect(container.querySelector(".today")).toBeNull());
  });
});
