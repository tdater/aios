import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Widget } from "../core/widgets";
import { BrainDump } from "../ui/BrainDump";
import { fakeServer } from "./fakeServer";
import { ctxFor, resetRoute, setWidth, Wrap } from "./helpers";

const w = (id: string, title: string, items: { text: string; done: boolean }[]) => ({ id, kind: "checklist", title, config: { items } }) as Widget;
const WIDGETS = [w("t", "Today's top 3", [{ text: "Existing", done: false }]), w("s", "Shopping list", [{ text: "Milk", done: false }])];
const SPOKEN = "Remember to order air filters. We're out of almond milk. Write down that the trim is Chantilly Lace.";

beforeEach(() => { resetRoute(""); setWidth(1200, 900); });
afterEach(() => cleanup());

function show(over: { save?: ReturnType<typeof vi.fn>; widgets?: Widget[]; routes?: object } = {}) {
  const save = over.save ?? vi.fn().mockResolvedValue(undefined);
  const srv = fakeServer({ "POST /memories": () => ({ status: 201, body: { id: "mem_9" } }), ...(over.routes ?? {}) } as never);
  render(<Wrap ctx={ctxFor().ctx}><BrainDump widgets={over.widgets ?? WIDGETS} saveChecklist={save} connected /></Wrap>);
  return { save, srv };
}
const dump = (t: string) => { fireEvent.change(screen.getByLabelText("What is on your mind?"), { target: { value: t } }); fireEvent.click(screen.getByRole("button", { name: "Sort it" })); };

describe("brain dump", () => {
  it("sorts what you said into to do, to buy and to remember, and saves nothing until you accept", () => {
    const { save, srv } = show();
    dump(SPOKEN);
    expect(screen.getByDisplayValue("Order air filters")).toBeTruthy();
    expect(screen.getByDisplayValue("Almond milk")).toBeTruthy();
    expect(screen.getByDisplayValue("The trim is Chantilly Lace")).toBeTruthy();
    expect(screen.getByText("To do")).toBeTruthy(); expect(screen.getByText("To buy")).toBeTruthy(); expect(screen.getByText("To remember")).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
    expect(srv.calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("saves to-dos and shopping to the right lists and notes as notes, with your edits", async () => {
    const { save, srv } = show();
    dump(SPOKEN);
    fireEvent.change(screen.getByDisplayValue("Almond milk"), { target: { value: "Oat milk" } });
    fireEvent.click(screen.getByRole("button", { name: "Save 3 selected" }));
    await waitFor(() => expect(srv.calls.filter((c) => c.path === "/memories")).toHaveLength(1));
    const lists = save.mock.calls.map((c) => [(c[0] as Widget).id, (c[1] as { text: string }[]).map((i) => i.text)]);
    expect(lists).toEqual([["t", ["Existing", "Order air filters"]], ["s", ["Milk", "Oat milk"]]]);
    const note = srv.calls.find((c) => c.path === "/memories")!.body as { title: string; type: string; tags: string[] };
    expect(note).toMatchObject({ title: "The trim is Chantilly Lace", type: "fact", tags: ["brain-dump"] });
    expect(await screen.findByText("Saved 3 items.")).toBeTruthy();
  });

  it("leaves out anything you untick", async () => {
    const { save, srv } = show();
    dump(SPOKEN);
    fireEvent.click(screen.getByLabelText("Keep: Order air filters"));
    fireEvent.click(screen.getByLabelText("Keep: The trim is Chantilly Lace"));
    fireEvent.click(screen.getByRole("button", { name: "Save 1 selected" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect((save.mock.calls[0][0] as Widget).id).toBe("s");
    expect(srv.calls.filter((c) => c.path === "/memories")).toHaveLength(0);
  });

  it("explains when it found nothing, and when there is no list to put things on", async () => {
    show();
    dump("It was a nice day and I felt good.");
    expect(screen.getByText(/did not find anything to do, buy or remember/)).toBeTruthy();
    cleanup();
    show({ widgets: [] });
    dump("Remember to call the plumber.");
    fireEvent.click(screen.getByRole("button", { name: "Save 1 selected" }));
    expect((await screen.findByRole("alert")).textContent).toContain("no checklist to put these on");
  });
});
