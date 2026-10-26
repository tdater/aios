import { describe, expect, it } from "vitest";
import { nextStep, todayCards } from "./today";

const I = (o = {}) => ({ approvals: 0, blocked: 0, running: 0, toReview: 0, verifiedOutcomes: 0, projects: 2, ...o });

describe("nextStep: a fixed priority, always with a reason", () => {
  it("approvals beat blocked work beat suggestions beat everything else", () => {
    expect(nextStep(I({ approvals: 1, blocked: 2, toReview: 3 })).to).toEqual({ tab: "inbox" });
    expect(nextStep(I({ blocked: 2, toReview: 3 })).to).toEqual({ tab: "runs" });
    expect(nextStep(I({ toReview: 3 })).why).toBe("3 suggested memories waiting for a yes or no.");
    expect(nextStep(I({ projects: 0 })).to).toEqual({ tab: "projects" });
    expect(nextStep(I()).to).toEqual({ tab: "work" });
  });
  it("uses singular and plural correctly, and tolerates unknown project count", () => {
    expect(nextStep(I({ approvals: 1 })).why).toBe("1 action cannot go ahead until you decide.");
    expect(nextStep(I({ projects: null })).to).toEqual({ tab: "work" });
  });
});

describe("todayCards", () => {
  it("at most four calm cards, in a fixed order", () => {
    expect(todayCards(I()).map((c) => c.id)).toEqual(["needs", "done", "next", "ask"]);
  });
  it("says nothing is waiting when nothing is, and offers no empty action", () => {
    const needs = todayCards(I())[0];
    expect([needs.body, needs.action]).toEqual(["Nothing is waiting for you.", undefined]);
    expect(todayCards(I({ approvals: 2, blocked: 1 }))[0].body).toBe("2 approvals and 1 blocked run.");
  });
  it("only claims what AIOS itself saw pass", () => {
    expect(todayCards(I())[1].body).toBe("No change has passed its tests yet.");
    expect(todayCards(I({ verifiedOutcomes: 3 }))[1].body).toBe("3 changes passed tests that AIOS ran itself.");
  });
  it("hidden cards are left out", () => {
    expect(todayCards(I(), ["done", "ask"]).map((c) => c.id)).toEqual(["needs", "next"]);
  });
});
