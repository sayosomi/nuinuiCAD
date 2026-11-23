import { describe, expect, it } from "vitest";
import { dslVariableTokenEndingAt } from "@nuinuicad/nui-language";

describe("dslVariableTokenEndingAt", () => {
  it("finds a bare name ending exactly at pos", () => {
    expect(dslVariableTokenEndingAt("10 + Wid", 8)).toEqual({ from: 5, to: 8, query: "Wid" });
  });

  it("returns null after whitespace following a name", () => {
    expect(dslVariableTokenEndingAt("10 + Wid ", 9)).toBeNull();
  });

  it("returns null for a numeric operand", () => {
    expect(dslVariableTokenEndingAt("10 + 5", 6)).toBeNull();
  });

  it("respects boundaryStart to avoid matching across a span boundary", () => {
    expect(dslVariableTokenEndingAt("Prev Wid", 8, 5)).toEqual({ from: 5, to: 8, query: "Wid" });
    expect(dslVariableTokenEndingAt("Prev", 4, 4)).toBeNull();
  });

  it("keeps `from` fixed and advances `to` as more characters are typed", () => {
    const first = dslVariableTokenEndingAt("W", 1);
    const second = dslVariableTokenEndingAt("Wi", 2);
    const third = dslVariableTokenEndingAt("Wid", 3);
    expect(first?.from).toBe(0);
    expect(second?.from).toBe(0);
    expect(third?.from).toBe(0);
    expect([first?.to, second?.to, third?.to]).toEqual([1, 2, 3]);
    expect([first?.query, second?.query, third?.query]).toEqual(["W", "Wi", "Wid"]);
  });

  it("reserves the choice marker for the choice completion branch", () => {
    expect(dslVariableTokenEndingAt("@", 1)).toBeNull();
    expect(dslVariableTokenEndingAt("@Wid", 4)).toBeNull();
  });
});
