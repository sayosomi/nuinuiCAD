import { describe, expect, it } from "vitest";
import {
  barePropertyReferenceIssues,
  expressionReferenceTokenEndingAt,
  scanExpressionReferences,
  stripElementPropertySigils
} from "./expressionReferenceToken";

describe("expressionReferenceTokenEndingAt", () => {
  it("classifies @AB as a binding token, from includes the @", () => {
    expect(expressionReferenceTokenEndingAt("@AB", 3)).toEqual({
      kind: "binding",
      tokenStart: 0,
      tokenEnd: 3,
      from: 0,
      to: 3,
      sigil: true,
      query: "AB"
    });
  });

  it("classifies @AB. as an elementProperty token with elementToken AB (not @AB - the pre-migration bug)", () => {
    expect(expressionReferenceTokenEndingAt("@AB.", 4)).toEqual({
      kind: "elementProperty",
      tokenStart: 0,
      tokenEnd: 4,
      from: 4,
      to: 4,
      sigil: true,
      elementToken: "AB",
      elementFrom: 1,
      elementTo: 3,
      query: ""
    });
  });

  it("narrows @AB.len as more characters are typed", () => {
    const match = expressionReferenceTokenEndingAt("@AB.len", 7);
    expect(match).toMatchObject({ kind: "elementProperty", sigil: true, elementToken: "AB", query: "len" });
  });

  it("keeps a scoped element path together while completing its property", () => {
    const text = "@G::H::AB.len";
    const match = expressionReferenceTokenEndingAt(text, text.length);
    expect(match).toMatchObject({ kind: "elementProperty", sigil: true, elementToken: "G::H::AB", query: "len" });
  });

  it("classifies a qualified path without a property as a frontend reference", () => {
    expect(expressionReferenceTokenEndingAt("@foo::実高さ", "@foo::実高さ".length)).toMatchObject({
      kind: "binding",
      query: "foo::実高さ",
      from: 0,
      to: "@foo::実高さ".length
    });
    expect(expressionReferenceTokenEndingAt('@"foo bar"::実高さ', '@"foo bar"::実高さ'.length)).toMatchObject({
      kind: "binding",
      query: '"foo bar"::実高さ'
    });
    const matches = scanExpressionReferences("@foo::実高さ + @foo::line.length + @name");
    expect(matches.filter((match) => match.kind === "binding").map((match) => match.query)).toEqual(["foo::実高さ", "name"]);
    expect(matches.filter((match) => match.kind === "elementProperty").map((match) => match.elementToken)).toEqual(["foo::line"]);
  });

  it("classifies bare AB.length as elementProperty with sigil:false", () => {
    expect(expressionReferenceTokenEndingAt("AB.length", 9)).toEqual({
      kind: "elementProperty",
      tokenStart: 0,
      tokenEnd: 9,
      from: 3,
      to: 9,
      sigil: false,
      elementToken: "AB",
      elementFrom: 0,
      elementTo: 2,
      query: "length"
    });
  });

  it("allows a nested dotted path in the query", () => {
    expect(expressionReferenceTokenEndingAt("@AB.startPoint.", 15)).toMatchObject({
      kind: "elementProperty",
      sigil: true,
      elementToken: "AB",
      query: "startPoint."
    });
  });

  it("excludes a purely-numeric elementToken (decimal literal)", () => {
    expect(expressionReferenceTokenEndingAt("10.5", 4)).toBeNull();
    expect(expressionReferenceTokenEndingAt("a + 10.5", 8)).toBeNull();
  });

  it("returns null for a bare identifier with no @ and no dot", () => {
    expect(expressionReferenceTokenEndingAt("AB", 2)).toBeNull();
  });

  it("returns null for @.x and .x (empty element head)", () => {
    expect(expressionReferenceTokenEndingAt("@.x", 3)).toBeNull();
    expect(expressionReferenceTokenEndingAt(".x", 2)).toBeNull();
  });

  it("matches @ alone as a binding token with an empty query", () => {
    expect(expressionReferenceTokenEndingAt("@", 1)).toEqual({
      kind: "binding",
      tokenStart: 0,
      tokenEnd: 1,
      from: 0,
      to: 1,
      sigil: true,
      query: ""
    });
  });

  it("respects boundaryStart to avoid matching across a record separator", () => {
    const text = "a:直線A.x;b:直線B.le";
    expect(expressionReferenceTokenEndingAt(text, 16, { boundaryStart: 10 })).toEqual({
      kind: "elementProperty",
      tokenStart: 10,
      tokenEnd: 16,
      from: 14,
      to: 16,
      sigil: false,
      elementToken: "直線B",
      elementFrom: 10,
      elementTo: 13,
      query: "le"
    });
  });

  it("without a correct boundaryStart, over-matches across the record separator", () => {
    const text = "a:直線A.x;b:直線B.le";
    expect(expressionReferenceTokenEndingAt(text, 16, { boundaryStart: 0 })).toEqual({
      kind: "elementProperty",
      tokenStart: 0,
      tokenEnd: 16,
      from: 6,
      to: 16,
      sigil: false,
      elementToken: "a:直線A",
      elementFrom: 0,
      elementTo: 5,
      query: "x;b:直線B.le"
    });
  });

  it("returns null past the text length or before boundaryStart", () => {
    expect(expressionReferenceTokenEndingAt("直線AB.x", 100)).toBeNull();
    expect(expressionReferenceTokenEndingAt("直線AB.x", 0, { boundaryStart: 5 })).toBeNull();
  });

  it("various boundary characters each start a fresh token", () => {
    // Only characters actually excluded from HEAD_CHAR_CLASS reliably stop a
    // greedy leftmost match mid-string; `,` and `-` are boundary-alternation
    // members but not excluded from the head/query content class itself, so
    // (matching the pre-migration dslElementParameterToken.ts behavior) they
    // only act as boundaries when a caller-supplied boundaryStart lands right
    // after them - see the "without a correct boundaryStart" test below.
    for (const prefix of ["(", "+", "*", "/", "a && ", "a || ", "a >= ", " "]) {
      const text = `${prefix}@AB.length`;
      const match = expressionReferenceTokenEndingAt(text, text.length);
      expect(match).toMatchObject({ kind: "elementProperty", sigil: true, elementToken: "AB", query: "length" });
    }
  });
});

describe("scanExpressionReferences", () => {
  it("finds every occurrence with correct offsets in a mixed expression", () => {
    const text = "@length + AB.length";
    const matches = scanExpressionReferences(text);
    expect(matches).toEqual([
      { kind: "binding", tokenStart: 0, tokenEnd: 7, from: 0, to: 7, sigil: true, query: "length" },
      {
        kind: "elementProperty",
        tokenStart: 10,
        tokenEnd: 19,
        from: 13,
        to: 19,
        sigil: false,
        elementToken: "AB",
        elementFrom: 10,
        elementTo: 12,
        query: "length"
      }
    ]);
  });

  it("does not misclassify a scoped geometry property as a binding", () => {
    expect(scanExpressionReferences("@G::AB.length + @amount")).toEqual([
      {
        kind: "elementProperty",
        tokenStart: 0,
        tokenEnd: 13,
        from: 7,
        to: 13,
        sigil: true,
        elementToken: "G::AB",
        elementFrom: 1,
        elementTo: 6,
        query: "length"
      },
      { kind: "binding", tokenStart: 16, tokenEnd: 23, from: 16, to: 23, sigil: true, query: "amount" }
    ]);
  });

  it("applies the offset to every returned span", () => {
    const matches = scanExpressionReferences("AB.length", 100);
    expect(matches).toEqual([
      {
        kind: "elementProperty",
        tokenStart: 100,
        tokenEnd: 109,
        from: 103,
        to: 109,
        sigil: false,
        elementToken: "AB",
        elementFrom: 100,
        elementTo: 102,
        query: "length"
      }
    ]);
  });
});

describe("stripElementPropertySigils", () => {
  it("removes the @ from an @Element.property occurrence, leaving the rest untouched", () => {
    expect(stripElementPropertySigils("@AB.length + 5")).toBe("AB.length + 5");
  });

  it("leaves a plain @name binding reference untouched", () => {
    expect(stripElementPropertySigils("@length + 5")).toBe("@length + 5");
  });

  it("leaves a bare Element.property occurrence untouched (no sigil to strip)", () => {
    expect(stripElementPropertySigils("AB.length + 5")).toBe("AB.length + 5");
  });

  it("strips multiple sigils and preserves surrounding text exactly", () => {
    expect(stripElementPropertySigils("@AB.length + @CD.length")).toBe("AB.length + CD.length");
  });

  it("returns the input unchanged when there is nothing to strip", () => {
    expect(stripElementPropertySigils("2 + 3")).toBe("2 + 3");
  });
});

describe("barePropertyReferenceIssues", () => {
  it("flags a bare Element.property occurrence", () => {
    const issues = barePropertyReferenceIssues("AB.length + 1");
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      start: 0,
      end: 9,
      elementToken: "AB",
      query: "length",
      code: "property-reference-requires-sigil"
    });
    expect(issues[0].message).toContain("@AB.length");
  });

  it("does not flag a sigil-prefixed occurrence", () => {
    expect(barePropertyReferenceIssues("@AB.length + 1")).toEqual([]);
  });

  it("does not flag a plain binding reference", () => {
    expect(barePropertyReferenceIssues("@length + 1")).toEqual([]);
  });

  it("flags every bare occurrence in a multi-reference expression", () => {
    const issues = barePropertyReferenceIssues("AB.length + CD.length");
    expect(issues.map((issue) => issue.elementToken)).toEqual(["AB", "CD"]);
  });
});
