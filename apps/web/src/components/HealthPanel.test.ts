import { describe, expect, test } from "bun:test";
import { formatAction } from "./HealthPanel";

describe("HealthPanel", () => {
  test("formats structured next actions", () => {
    expect(formatAction({ priority: "P2", title: "Draft chapter 2", detail: "Outline scenes first." })).toBe("P2: Draft chapter 2 — Outline scenes first.");
  });

  test("formats string and unknown actions", () => {
    expect(formatAction("Run validate")).toBe("Run validate");
    expect(formatAction(null)).toBe("null");
  });
});
