import { describe, expect, it } from "vitest";
import {
  compileDslDocument,
  expressionReferenceTokenEndingAt,
  tokenizeScalarExpression
} from "@nuinuicad/nui-language";

describe("expressionReferenceTokenEndingAt", () => {
  it("classifies a bare binding and covers its exact name", () => {
    expect(expressionReferenceTokenEndingAt("AB", 2)).toEqual({
      kind: "binding",
      tokenStart: 0,
      tokenEnd: 2,
      from: 0,
      to: 2,
      sigil: false,
      query: "AB"
    });
  });

  it("opens property completion immediately after the member separator", () => {
    expect(expressionReferenceTokenEndingAt("AB.", 3)).toEqual({
      kind: "elementProperty",
      tokenStart: 0,
      tokenEnd: 3,
      from: 3,
      to: 3,
      sigil: false,
      elementToken: "AB",
      elementFrom: 0,
      elementTo: 2,
      query: ""
    });
  });

  it("narrows AB.len as more characters are typed", () => {
    const match = expressionReferenceTokenEndingAt("AB.len", 6);
    expect(match).toMatchObject({ kind: "elementProperty", sigil: false, elementToken: "AB", query: "len" });
  });

  it("keeps a scoped element path together while completing its property", () => {
    const text = "G::H::AB.len";
    const match = expressionReferenceTokenEndingAt(text, text.length);
    expect(match).toMatchObject({ kind: "elementProperty", sigil: false, elementToken: "G::H::AB", query: "len" });
  });

  it("classifies a bare qualified path and rejects a quoted segment", () => {
    const path = "foo::実高さ";
    expect(expressionReferenceTokenEndingAt(path, path.length)).toMatchObject({
      kind: "binding",
      qualifiedPath: true,
      query: path,
      from: 0,
      to: path.length
    });
    const quotedPath = '"foo bar"::実高さ';
    expect(expressionReferenceTokenEndingAt(quotedPath, quotedPath.length)).toBeNull();
    const tokens = tokenize("foo::実高さ + foo::edge.length + name");
    expect(tokens.flatMap(token => token.kind === "reference" ? [token.name] : [])).toEqual(["foo::実高さ", "name"]);
    expect(tokens.flatMap(token => token.kind === "geometryProperty" ? [token.elementName] : [])).toEqual(["foo::edge"]);
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
    expect(expressionReferenceTokenEndingAt("AB.startPoint.", 14)).toMatchObject({
      kind: "elementProperty",
      sigil: false,
      elementToken: "AB",
      query: "startPoint."
    });
  });

  it("excludes a purely-numeric elementToken (decimal literal)", () => {
    expect(expressionReferenceTokenEndingAt("10.5", 4)).toBeNull();
    expect(expressionReferenceTokenEndingAt("a + 10.5", 8)).toBeNull();
  });

  it.each(["@AB", "@", "@.x", ".x"])("offers no ordinary reference for %s", text => {
    expect(expressionReferenceTokenEndingAt(text, text.length)).toBeNull();
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

  it("does not absorb record separators into a reference when scanning from the start", () => {
    const text = "a:直線A.x;b:直線B.le";
    expect(expressionReferenceTokenEndingAt(text, text.length)).toBeNull();
  });

  it("returns null past the text length or before boundaryStart", () => {
    expect(expressionReferenceTokenEndingAt("直線AB.x", 100)).toBeNull();
    expect(expressionReferenceTokenEndingAt("直線AB.x", 0, { boundaryStart: 5 })).toBeNull();
  });

  it("various boundary characters each start a fresh token", () => {
    for (const prefix of ["(", "+", "*", "/", "a  and  ", "a  or  ", "a >= ", " "]) {
      const text = `${prefix}AB.length`;
      const match = expressionReferenceTokenEndingAt(text, text.length);
      expect(match).toMatchObject({ kind: "elementProperty", sigil: false, elementToken: "AB", query: "length" });
    }
  });
});

const tokenize = (text: string, start = 0) => {
  const result = tokenizeScalarExpression(text, { start, end: text.length });
  expect(result.error).toBeNull();
  return result.tokens;
};

describe("scalar reference token ranges", () => {
  it("finds every occurrence with correct offsets in a mixed expression", () => {
    expect(tokenize("length + AB.length")).toEqual([
      { kind: "reference", name: "length", nameSpan: { start: 0, end: 6 }, span: { start: 0, end: 6 } },
      { kind: "operator", value: "+", span: { start: 7, end: 8 } },
      {
        kind: "geometryProperty",
        elementName: "AB",
        elementNameSpan: { start: 9, end: 11 },
        property: "length",
        propertySpan: { start: 12, end: 18 },
        span: { start: 9, end: 18 }
      }
    ]);
  });

  it("does not misclassify a scoped geometry property as a binding", () => {
    expect(tokenize("G::AB.length + amount")).toEqual([
      {
        kind: "geometryProperty",
        elementName: "G::AB",
        elementNameSpan: { start: 0, end: 5 },
        property: "length",
        propertySpan: { start: 6, end: 12 },
        span: { start: 0, end: 12 }
      },
      { kind: "operator", value: "+", span: { start: 13, end: 14 } },
      { kind: "reference", name: "amount", nameSpan: { start: 15, end: 21 }, span: { start: 15, end: 21 } }
    ]);
  });

  it("scans an occurrence index expression independently from its geometry reference", () => {
    expect(tokenize("Mark[i + 1].length")).toEqual([
      { kind: "reference", name: "Mark", nameSpan: { start: 0, end: 4 }, span: { start: 0, end: 4 } },
      { kind: "leftBracket", span: { start: 4, end: 5 } },
      { kind: "reference", name: "i", nameSpan: { start: 5, end: 6 }, span: { start: 5, end: 6 } },
      { kind: "operator", value: "+", span: { start: 7, end: 8 } },
      { kind: "literal", literal: expect.objectContaining({ kind: "number", span: { start: 9, end: 10 } }) },
      { kind: "rightBracket", span: { start: 10, end: 11 } },
      { kind: "postfixProperty", property: "length", propertySpan: { start: 12, end: 18 }, span: { start: 11, end: 18 } }
    ]);
  });

  it("applies the offset to every returned span", () => {
    expect(tokenize(`${" ".repeat(100)}AB.length`, 100)).toEqual([
      {
        kind: "geometryProperty",
        elementName: "AB",
        elementNameSpan: { start: 100, end: 102 },
        property: "length",
        propertySpan: { start: 103, end: 109 },
        span: { start: 100, end: 109 }
      }
    ]);
  });
});

describe("reference spelling at the numeric source boundary", () => {
  const compile = (expression: string) => {
    const source = [
      "nui 1",
      "line AB = segment(start: (0, 0), end: (10, 0))",
      "line CD = segment(start: (0, 0), end: (20, 0))",
      "point P = coordinate(x: " + expression + ", y: 0)"
    ].join("\n");
    return { source, result: compileDslDocument(source) };
  };

  it.each(["AB.length + 5", "AB.length + CD.length", "2 + 3"])("accepts and retains canonical numeric source %s", expression => {
    const { source, result } = compile(expression);
    expect(result.diagnostics).toEqual([]);
    expect(result.document).not.toBeNull();
    expect(result.spans.sourceMap.source).toBe(source);
  });

  it.each([["@AB.length + 5", ["@AB.length"]], ["@AB.length + @CD.length", ["@AB.length", "@CD.length"]]])(
    "reports every removed geometry marker in %s",
    (expression, references) => {
      const { source, result } = compile(expression);
      expect(result.document).toBeNull();
      const diagnostics = result.diagnostics.filter(diagnostic => diagnostic.code === "invalid-source-reference");
      expect(diagnostics.map(diagnostic => {
        const segment = diagnostic.physicalSpan!.segments[0]!;
        return source.slice(segment.from, segment.to);
      })).toEqual(references);
    }
  );

  it("does not fall back to a binding lookup for a choice marker", () => {
    const { result } = compile("@length + 5");
    expect(result.document).toBeNull();
    expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "invalid-choice-literal" })]));
  });
});
