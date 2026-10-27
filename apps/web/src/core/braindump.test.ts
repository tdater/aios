import { describe, expect, it } from "vitest";
import { itemTitle, sortBrainDump } from "./braindump";

const sorted = (t: string) => sortBrainDump(t).map((i) => [i.kind, i.text]);

describe("brain dump sorting", () => {
  it("sorts a spoken evening dump into notes, to-dos and shopping", () => {
    const text = "Today was productive, finished the kitchen paint job. Need to remember that the living room trim is Benjamin Moore Chantilly Lace. Also, need to call the dentist tomorrow morning, and we're out of almond milk.";
    expect(sorted(text)).toEqual([
      ["note", "The living room trim is Benjamin Moore Chantilly Lace"],
      ["todo", "Call the dentist tomorrow morning"],
      ["shopping", "Almond milk"],
    ]);
  });
  it("handles the example from the proposal: a to-do with a day, a to-do, and a note", () => {
    const text = "Remember to order replacement air filters for the HVAC, pay the quarterly car insurance by Friday, and write down a note that Dr. Smith recommended 500mg vitamin C.";
    const got = sortBrainDump(text);
    expect(got.map((i) => i.kind)).toEqual(["todo", "todo", "note"]);
    expect(got[0].text).toBe("Order replacement air filters for the HVAC");
    expect(got[1].due).toBe("Friday");
    expect(itemTitle(got[1])).toBe("Pay the quarterly car insurance by Friday");
    expect(got[2].text).toBe("Dr. Smith recommended 500mg vitamin C");
  });
  it("leaves out chatter that is not a task, a purchase or a thing to remember", () => {
    expect(sorted("It was a nice day. The weather was great and I felt good.")).toEqual([]);
    expect(sorted("")).toEqual([]);
  });
  it("numbers the items so each can be reviewed on its own", () => {
    expect(sortBrainDump("Call mom. Pay the rent. We need eggs.").map((i) => i.id)).toEqual([1, 2, 3]);
  });
});
