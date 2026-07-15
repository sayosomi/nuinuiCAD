import { describe, expect, it } from "vitest";
import { dslVariableTokenEndingAt } from "./dslVariableToken";

describe("dslVariableTokenEndingAt", () => {
  it("finds the @query token ending exactly at pos", () => {
    expect(dslVariableTokenEndingAt("10 + @Wid", 9)).toEqual({ from: 5, to: 9, query: "Wid" });
  });

  it("returns null when the cursor isn't immediately after an @token", () => {
    expect(dslVariableTokenEndingAt("10 + @Wid ", 10)).toBeNull();
  });

  it("returns null when there is no @ at all before the cursor", () => {
    expect(dslVariableTokenEndingAt("10 + 5", 6)).toBeNull();
  });

  it("respects boundaryStart to avoid matching across a span boundary", () => {
    // "@Prev" belongs to an earlier span; boundaryStart excludes it from the match.
    expect(dslVariableTokenEndingAt("@Prev @Wid", 10, 6)).toEqual({ from: 6, to: 10, query: "Wid" });
    expect(dslVariableTokenEndingAt("@Prev", 5, 5)).toBeNull();
  });

  it("keeps `from` fixed and advances `to` as more characters are typed", () => {
    const first = dslVariableTokenEndingAt("@W", 2);
    const second = dslVariableTokenEndingAt("@Wi", 3);
    const third = dslVariableTokenEndingAt("@Wid", 4);
    expect(first?.from).toBe(0);
    expect(second?.from).toBe(0);
    expect(third?.from).toBe(0);
    expect([first?.to, second?.to, third?.to]).toEqual([2, 3, 4]);
    expect([first?.query, second?.query, third?.query]).toEqual(["W", "Wi", "Wid"]);
  });

  it("matches an empty query right after a bare @", () => {
    expect(dslVariableTokenEndingAt("@", 1)).toEqual({ from: 0, to: 1, query: "" });
  });
});
