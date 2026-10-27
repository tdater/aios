import { describe, expect, it } from "vitest";
import { checkMessage, linkWarning, linksIn } from "./scam";

describe("scam second opinion", () => {
  it("says a classic text looks like a scam, and names the reasons", () => {
    const r = checkMessage("USPS: your package could not be delivered. Pay a redelivery fee within 24 hours at http://usps-tracking.help-pay.com or your parcel will be returned. Call +1 555 123 4567.");
    expect(r.verdict).toBe("scam");
    expect(r.headline).toBe("This looks like a scam.");
    const ids = r.signals.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(["urgent", "package"]));
    expect(r.signals.some((s) => s.label.startsWith("A link looks wrong"))).toBe(true);
    expect(r.steps.join(" ")).toContain("Do not tap links");
  });
  it("flags requests for gift cards and one-time codes", () => {
    expect(checkMessage("Buy 4 Google Play gift cards and read me the codes. Do not tell anyone, this is urgent.").verdict).toBe("scam");
    expect(checkMessage("Your verification code is 123456. Never share it.").signals.map((s) => s.id)).toContain("credentials");
  });
  it("never calls anything safe: the best result is no common signs found, with a reminder", () => {
    const r = checkMessage("Hi, dinner at 7 on Friday? I booked the usual place.");
    expect(r.verdict).toBe("none");
    expect(r.headline).toContain("does not make it safe");
    expect(r.headline.toLowerCase()).not.toMatch(/\b(is|it is|this is) safe\b/);
    expect(r.steps[0]).toContain("check with the company");
  });
  it("treats a single mild sign as something to check, not an accusation", () => {
    const r = checkMessage("Dear customer, your order has shipped.");
    expect(r.verdict).toBe("some");
    expect(r.headline).toBe("This has a warning sign worth checking.");
  });
  it("finds links and judges them by where they go", () => {
    expect(linksIn("See https://example.com/a, or www.bit.ly/x.")).toEqual(["https://example.com/a", "www.bit.ly/x"]);
    expect(linkWarning("http://192.168.4.5/login")).toContain("is a number");
    expect(linkWarning("https://bit.ly/abc")).toContain("hides where the link really goes");
    expect(linkWarning("https://paypal-security-check.com/login")).toContain("not paypal's own website");
    expect(linkWarning("https://paypa1.com")).toContain("not paypal's own website");
    expect(linkWarning("https://www.paypal.com/signin")).toBeNull();
    expect(linkWarning("https://www.amazon.co.uk/orders")).toBeNull();
    expect(linkWarning("https://groups.example.com")).toBeNull();                      // a short brand name inside another word is not a match
  });
});
