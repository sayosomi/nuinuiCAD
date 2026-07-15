import { describe, expect, it } from "vitest";
import { dslElementParameterTokenEndingAt } from "./dslElementParameterToken";

describe("dslElementParameterTokenEndingAt", () => {
  it("finds the ElementName.query token, spanning only the member token after the dot", () => {
    expect(dslElementParameterTokenEndingAt("直線AB.st", 7)).toEqual({
      from: 5,
      to: 7,
      elementToken: "直線AB",
      query: "st"
    });
  });

  it("matches an empty query right after the dot", () => {
    expect(dslElementParameterTokenEndingAt("直線AB.", 5)).toEqual({
      from: 5,
      to: 5,
      elementToken: "直線AB",
      query: ""
    });
  });

  it("keeps `from` fixed at the dot and advances `to` as more characters are typed", () => {
    const first = dslElementParameterTokenEndingAt("直線AB.s", 6);
    const second = dslElementParameterTokenEndingAt("直線AB.st", 7);
    const third = dslElementParameterTokenEndingAt("直線AB.sta", 8);
    expect([first?.from, second?.from, third?.from]).toEqual([5, 5, 5]);
    expect([first?.to, second?.to, third?.to]).toEqual([6, 7, 8]);
    expect([first?.query, second?.query, third?.query]).toEqual(["s", "st", "sta"]);
  });

  it("allows a nested dotted path in the query (e.g. startPoint.)", () => {
    expect(dslElementParameterTokenEndingAt("直線AB.startPoint.", 16)).toEqual({
      from: 5,
      to: 16,
      elementToken: "直線AB",
      query: "startPoint."
    });
  });

  it("returns null when there is no dot at all before the cursor", () => {
    expect(dslElementParameterTokenEndingAt("直線AB", 3)).toBeNull();
  });

  it("excludes a purely-numeric elementToken (decimal literal, not a reference)", () => {
    expect(dslElementParameterTokenEndingAt("10.5", 4)).toBeNull();
    expect(dslElementParameterTokenEndingAt("a + 10.5", 8)).toBeNull();
  });

  it("still matches when elementToken starts with digits but isn't purely numeric", () => {
    expect(dslElementParameterTokenEndingAt("点2.x", 4)).toEqual({
      from: 3,
      to: 4,
      elementToken: "点2",
      query: "x"
    });
  });

  it("respects boundaryStart to avoid matching across a vars=[...] record boundary", () => {
    // Mimics dslVarsFieldCompletionContext's own record-field span: neither
    // ":" nor ";" are excluded from the character classes, so without the
    // caller-supplied boundaryStart (here, the start of the second record's
    // own expression field) the match would wrongly reach back across the
    // ";" separator into the first record's name/dot/value.
    const text = "a:直線A.x;b:直線B.le";
    expect(dslElementParameterTokenEndingAt(text, 16, 10)).toEqual({
      from: 14,
      to: 16,
      elementToken: "直線B",
      query: "le"
    });
  });

  it("without a correct boundaryStart, over-matches across the record separator", () => {
    const text = "a:直線A.x;b:直線B.le";
    expect(dslElementParameterTokenEndingAt(text, 16, 0)).toEqual({
      from: 6,
      to: 16,
      elementToken: "a:直線A",
      query: "x;b:直線B.le"
    });
  });

  it("requires a boundary character or start-of-string immediately before elementToken", () => {
    // No boundary char between "AB" and a hypothetical second token isn't
    // representable directly, but a bare mid-identifier case should still
    // resolve via a preceding operator/space/paren.
    expect(dslElementParameterTokenEndingAt("(直線AB.length", 12)).toEqual({
      from: 6,
      to: 12,
      elementToken: "直線AB",
      query: "length"
    });
  });

  it("returns null past the text length or before boundaryStart", () => {
    expect(dslElementParameterTokenEndingAt("直線AB.x", 100)).toBeNull();
    expect(dslElementParameterTokenEndingAt("直線AB.x", 0, 5)).toBeNull();
  });
});
