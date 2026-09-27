import { describe, expect, test } from "bun:test";
import { err, warn } from "../src/findings.js";

describe("findings", () => {
  test("err and warn build a finding with its code, message, and file", () => {
    expect(err("stale-registry", "a.md broke", "a.md")).toEqual({ code: "stale-registry", message: "a.md broke", file: "a.md" });
    expect(warn("todo-markers", "no file")).toEqual({ code: "todo-markers", message: "no file", file: null });
  });
});
