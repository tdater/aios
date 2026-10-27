import { describe, expect, it } from "vitest";
import { plainApproval } from "./approvals";

const a = (type: string, target: string, side_effects: string[], destructive = false) => ({ destructive, review: { type, target, side_effects, content_preview: "", destructive } });

describe("plain-English approvals", () => {
  it("says creating or replacing a file, by its name, and warns about overwriting", () => {
    const make = plainApproval(a("write_file", "C:\\notes\\plan.txt", ["Creates the file at C:\\notes\\plan.txt"]));
    expect(make.headline).toBe("AIOS wants to create the file plan.txt.");
    expect(make.tone).toBe("info");
    const over = plainApproval(a("write_file", "/home/me/plan.txt", ["Overwrites the file at /home/me/plan.txt"], true));
    expect(over.headline).toBe("AIOS wants to replace the file plan.txt.");
    expect(over.tone).toBe("warn");
    expect(over.safety).toContain("overwrites a file that already exists");
  });
  it("is honest that a check command runs on your computer and is not a sandbox", () => {
    const v = plainApproval(a("run_verification", "C:\proj", ["Runs this command on your computer: python -m unittest"]));
    expect(v.safety).toContain("not a sandbox");
    expect(v.approveLabel).toBe("Approve running the check");
  });
  it("explains a merge using the recorded side effects, and treats an unknown action as unsafe", () => {
    expect(plainApproval(a("apply_revision", "C:\proj", ["Merges branch aios/x into main"])).safety).toBe("Merges branch aios/x into main");
    const u = plainApproval(a("mystery", "", ["Unknown action type: assume it changes state and cannot be undone"]));
    expect(u.tone).toBe("bad");
    expect(u.safety).toContain("cannot be undone");
  });
});
