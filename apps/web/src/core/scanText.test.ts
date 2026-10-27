import { describe, expect, it } from "vitest";
import { factRows, plainValue } from "./scanText";

describe("computer check text", () => {
  it("never produces [object Object]", () => {
    const facts = { memory: { total_bytes: 17179869184, available_bytes: 2147483648 }, disk: { total_bytes: 512 * 1024 ** 3, free_bytes: 100 * 1024 ** 3 },
      temp: { bytes: 3 * 1024 ** 3, files: 120, complete: false }, startup_items: 9, top_memory: [{ name: "chrome", bytes: 2 * 1024 ** 3 }], battery: null, pending_reboot: true };
    const rows = factRows(facts);
    expect(rows.map((r) => r.label)).toEqual(["memory", "disk", "temp", "startup items", "top memory", "battery", "pending reboot"]);
    for (const r of rows) expect(r.value).not.toContain("[object");
    expect(rows[0].value).toBe("total 16.0 GB, available 2.0 GB");
    expect(rows[2].value).toBe("bytes 3.0 GB, files 120, complete no");
    expect(rows[4].value).toBe("name chrome, bytes 2.0 GB");
    expect(rows[5].value).toBe("not available");
    expect(rows[6].value).toBe("yes");
  });
  it("reads plain values as they are", () => {
    expect(plainValue("startup_items", 9)).toBe("9");
    expect(plainValue("note", "hello")).toBe("hello");
    expect(plainValue("list", [])).toBe("none");
  });
});
