import { describe, expect, it } from "vitest";
import { quoteDslString, splitDslTerms, unquoteDslString } from "./dslTokens";

describe("DSL string escaping", () => {
  it("round-trips newlines and other escaped control characters", () => {
    const value = "first\\second\nthird\rfourth\tfifth\"sixth";
    expect(quoteDslString(value)).toBe('"first\\\\second\\nthird\\rfourth\\tfifth\\"sixth"');
    expect(unquoteDslString(quoteDslString(value))).toBe(value);
  });

  it("does not strip quotes from a qualified reference with quoted segments", () => {
    expect(unquoteDslString('"Outer name"::"Inner name"')).toBe('"Outer name"::"Inner name"');
  });
});

describe("splitDslTerms", () => {
  it("splits whitespace-separated terms with spans", () => {
    const line = "point A = (0, 0)";
    expect(splitDslTerms(line)).toEqual([
      { text: "point", start: 0, end: 5 },
      { text: "A", start: 6, end: 7 },
      { text: "=", start: 8, end: 9 },
      { text: "(0, 0)", start: 10, end: 16 }
    ]);
  });

  it("keeps quoted terms with spaces as one term", () => {
    const line = "var 'バスト 寸法' = 840";
    const terms = splitDslTerms(line);
    expect(terms.map((term) => term.text)).toEqual(["var", "'バスト 寸法'", "=", "840"]);
    expect(terms[1]).toMatchObject({ start: 4, end: 12 });
  });

  it("keeps bracketed lists and parenthesized expressions as one term", () => {
    const terms = splitDslTerms("line seam = offset [AB, BC] distance=-(bust / 4)");
    expect(terms.map((term) => term.text)).toEqual([
      "line",
      "seam",
      "=",
      "offset",
      "[AB, BC]",
      "distance=-(bust / 4)"
    ]);
  });

  it("splits bare braces into standalone structural terms", () => {
    expect(splitDslTerms("group 前身頃 roles=[外周] {").map((term) => term.text)).toEqual([
      "group",
      "前身頃",
      "roles=[外周]",
      "{"
    ]);
    expect(splitDslTerms("} else {")).toEqual([
      { text: "}", start: 0, end: 1 },
      { text: "else", start: 2, end: 6 },
      { text: "{", start: 7, end: 8 }
    ]);
    expect(splitDslTerms("}").map((term) => term.text)).toEqual(["}"]);
  });

  it("splits braces adjacent to other terms", () => {
    expect(splitDslTerms("group A{").map((term) => term.text)).toEqual(["group", "A", "{"]);
  });

  it("keeps braces inside quotes as part of the term", () => {
    expect(splitDslTerms("text label = \"a { b }\" at=A").map((term) => term.text)).toEqual([
      "text",
      "label",
      "=",
      "\"a { b }\"",
      "at=A"
    ]);
  });

  it("keeps attribute values with quoted strings intact", () => {
    const terms = splitDslTerms("color main \"#ff0000\" name=\"本体 色\" default");
    expect(terms.map((term) => term.text)).toEqual([
      "color",
      "main",
      "\"#ff0000\"",
      "name=\"本体 色\"",
      "default"
    ]);
  });

  it("records spans for terms separated by repeated whitespace", () => {
    const terms = splitDslTerms("var   x  =  5");
    expect(terms).toEqual([
      { text: "var", start: 0, end: 3 },
      { text: "x", start: 6, end: 7 },
      { text: "=", start: 9, end: 10 },
      { text: "5", start: 12, end: 13 }
    ]);
  });
});
