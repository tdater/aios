import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf-8");

describe("form control sizing in the real stylesheet", () => {
  it("never stretches a radio button or checkbox to the full width of its row", () => {
    // The generic text-field rule once matched radios too, so the tour's "How much should AIOS show?" choices were a huge circle with
    // the words squeezed into a one-letter column. Only fields that hold text may be 100% wide.
    const rule = css.split("\n").find((l) => l.startsWith("input:not(") && l.includes("width: 100%"));
    expect(rule, "the generic input rule").toBeTruthy();
    const selector = rule!.slice(0, rule!.indexOf("{"));
    expect(selector).toContain(':not([type="checkbox"])');
    expect(selector).toContain(':not([type="radio"])');
  });
});
