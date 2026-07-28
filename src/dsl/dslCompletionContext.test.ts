import { describe, expect, it } from "vitest";
import { dslCompletionContextAt } from "./dslCompletionContext";

const at = (line: string, token: string) => line.indexOf(token) + token.length;

describe("dslCompletionContextAt", () => {
  it("uses parser-owned statement keywords only at a line head", () => {
    const context = dslCompletionContextAt("  poi", 5);
    expect(context).toMatchObject({ kind: "keyword", from: 2, to: 5 });
    expect(context?.kind === "keyword" && context.options).toContain("point");
    expect(dslCompletionContextAt("# point", 7)).toBeNull();
    const line = "point P = coordinate(x: 0 y: 0)";
    expect(dslCompletionContextAt(line, at(line, "="))).toBeNull();
  });

  it("resolves reference and choice contexts through live line reparsing", () => {
    const line = "line L = segment(start: A end: B)";
    expect(dslCompletionContextAt(line, at(line, "A"))).toMatchObject({
      kind: "parameter",
      parameter: { definition: { kind: "reference" } }
    });

    const choice = "line Seam = offset(sources: [AB] distance: 4 side: left)";
    expect(dslCompletionContextAt(choice, at(choice, "left"))).toMatchObject({
      kind: "parameter",
      parameter: { definition: { kind: "choice" } }
    });

    // F2's partial-call scanner owns construction and named-argument positions;
    // valid values continue through the parser-derived branches below.
  });

  it("preserves short-var value completion after the equals sign", () => {
    const line = "var Copy = @Wi";
    expect(dslCompletionContextAt(line, at(line, "@Wi"))).toMatchObject({
      kind: "parameter",
      parameter: { definition: { kind: "number" } }
    });
    expect(dslCompletionContextAt("var Copy = ", "var Copy = ".length)).toBeNull();
  });

  it("narrows line-list completion to the current item for safe re-editing", () => {
    const line = "line O = offset(sources: [First, Sec] distance: 4 side: left)";
    const context = dslCompletionContextAt(line, at(line, "Sec"));
    expect(context).toMatchObject({
      kind: "parameter",
      from: line.indexOf("Sec"),
      to: at(line, "Sec"),
      parameter: { definition: { kind: "lineReferenceList" } }
    });
  });

  it("keeps group-opening attributes eligible through the shared synthetic-close reparse", () => {
    const line = "group Draft (printEnabled: true) {";
    // `printEnabled` is one of Task 39's opt-in scalar boolean properties, so
    // this now resolves to "propertyScalarValue" (offering true/false literal
    // completion) rather than the inert generic "parameter" shape - the
    // synthetic-close reparse eligibility this test guards is still exercised
    // by getting any non-null, correctly-kinded completion context at all.
    expect(dslCompletionContextAt(line, line.indexOf("true") + 2)).toMatchObject({
      kind: "propertyScalarValue",
      propertyContext: { kind: "booleanLiteral" }
    });
  });

  describe("number-kind @-token narrowing", () => {
    it("narrows a number-kind value span to just the trailing @token, not the whole expression", () => {
      const line = "point P = offset(from: A dx: 10+@Wi)";
      const context = dslCompletionContextAt(line, at(line, "@Wi"));
      expect(context).toMatchObject({
        kind: "parameter",
        from: line.indexOf("@Wi"),
        to: at(line, "@Wi"),
        parameter: { definition: { kind: "number" } }
      });
    });

    it("returns null for a number-kind span when the cursor isn't right after @", () => {
      const line = "point P = offset(from: A dx: 10)";
      expect(dslCompletionContextAt(line, at(line, "10"))).toBeNull();
    });

    it("preserves text before the @ token outside the returned span", () => {
      const line = "point P = offset(from: A dx: 10+@Wi)";
      const context = dslCompletionContextAt(line, at(line, "@Wi"));
      expect(context?.kind === "parameter" && line.slice(0, context.from)).toBe("point P = offset(from: A dx: 10+");
    });
  });

  describe("reference-kind coordinate literal x/y sub-spans", () => {
    it("narrows to just the @token inside a coordinate literal's y component", () => {
      const line = "line L = segment(start: A end: (10, @Wi))";
      const context = dslCompletionContextAt(line, at(line, "@Wi"));
      expect(context).toMatchObject({
        kind: "parameter",
        from: line.indexOf("@Wi"),
        to: at(line, "@Wi"),
        parameter: { definition: { kind: "number" } }
      });
    });

    it("narrows to just the @token inside a coordinate literal's x component", () => {
      const line = "line L = segment(start: A end: (@Wi, 10))";
      const context = dslCompletionContextAt(line, at(line, "@Wi"));
      expect(context).toMatchObject({
        kind: "parameter",
        from: line.indexOf("@Wi"),
        to: at(line, "@Wi"),
        parameter: { definition: { kind: "number" } }
      });
    });

    it("returns null inside a coordinate sub-span when the cursor isn't right after @ (no point-name fallback)", () => {
      const line = "line L = segment(start: A end: (10, 20))";
      expect(dslCompletionContextAt(line, at(line, "20"))).toBeNull();
    });

    it("keeps normal reference-name completion for a non-coordinate reference value", () => {
      const line = "line L = segment(start: A end: B)";
      expect(dslCompletionContextAt(line, at(line, "A"))).toMatchObject({
        kind: "parameter",
        parameter: { definition: { kind: "reference" } }
      });
    });
  });

  describe("vars=[...] local variable record narrowing", () => {
    it("narrows to the @token inside a later record's expression field", () => {
      const line = "point P = coordinate(x: 0 y: 0 vars: [Width: 10; Height: @Wi])";
      const context = dslCompletionContextAt(line, at(line, "@Wi"));
      expect(context).toMatchObject({
        kind: "parameter",
        from: line.indexOf("@Wi"),
        to: at(line, "@Wi"),
        parameter: { key: "vars" }
      });
    });

    it("returns null when the cursor is in a record's name field, not its expression", () => {
      const line = "point P = coordinate(x: 0 y: 0 vars: [Width: 10; Height: 5])";
      expect(dslCompletionContextAt(line, at(line, "Height"))).toBeNull();
    });
  });

  describe("place/layoutVar/printLayout block attributes", () => {
    it("offers number-kind @-completion for place's angle=", () => {
      const line = "place Group1 (at: (10, 20) angle: 15+@Wi)";
      const context = dslCompletionContextAt(line, at(line, "@Wi"));
      expect(context).toMatchObject({
        kind: "parameter",
        from: line.indexOf("@Wi"),
        to: at(line, "@Wi"),
        parameter: { source: "printLayoutBlock", key: "angle" }
      });
    });

    it("offers coordinate sub-span @-completion for place's at=", () => {
      const line = "place Group1 (at: (10, @Wi) angle: 15)";
      const context = dslCompletionContextAt(line, at(line, "@Wi"));
      expect(context).toMatchObject({
        kind: "parameter",
        from: line.indexOf("@Wi"),
        to: at(line, "@Wi"),
        parameter: { source: "printLayoutBlock", key: "at" }
      });
    });

    it("offers number-kind @-completion for printLayout's columns=/rows=/overlap=/scale=", () => {
      const line = "printLayout Layout1 (columns: 2+@Wi) {";
      const context = dslCompletionContextAt(line, at(line, "@Wi"));
      expect(context).toMatchObject({
        kind: "parameter",
        from: line.indexOf("@Wi"),
        parameter: { source: "printLayoutBlock", key: "columns" }
      });
    });

    it("offers coordinate sub-span @-completion for printLayout's canvas=", () => {
      const line = "printLayout Layout1 (canvas: (210, @Wi)) {";
      const context = dslCompletionContextAt(line, at(line, "@Wi"));
      expect(context).toMatchObject({
        kind: "parameter",
        from: line.indexOf("@Wi"),
        parameter: { source: "printLayoutBlock", key: "canvas" }
      });
    });

    it("offers number-kind @-completion for layoutVar's own expression", () => {
      const line = "layoutVar Margin = 20+@Wi";
      const context = dslCompletionContextAt(line, at(line, "@Wi"));
      expect(context).toMatchObject({
        kind: "parameter",
        from: line.indexOf("@Wi"),
        parameter: { source: "printLayoutBlock", key: "expression" }
      });
    });

    it("returns null for an unrelated place/printLayout attribute (mirrorX=, paper=)", () => {
      const line = "place Group1 (at: (0, 0) mirrorX: true)";
      expect(dslCompletionContextAt(line, at(line, "true"))).toBeNull();
      const layoutLine = "printLayout Layout1 (paper: a4) {";
      expect(dslCompletionContextAt(layoutLine, at(layoutLine, "a4"))).toBeNull();
    });
  });

  describe("elementParameter (ElementName.parameterKey) narrowing", () => {
    it("falls back to an elementParameter context for a number-kind field once the @ check finds nothing", () => {
      const line = "point P = offset(from: A dx: 10+直線AB.st)";
      const context = dslCompletionContextAt(line, at(line, "直線AB.st"));
      expect(context).toMatchObject({
        kind: "elementParameter",
        from: line.indexOf(".st") + 1,
        to: at(line, "直線AB.st"),
        elementToken: "直線AB"
      });
    });

    it("prefers the @ context over elementParameter when both could plausibly apply", () => {
      // "@Wi" alone never contains a dot, so this only demonstrates that the
      // existing @ branch still runs first/unmodified - not a real conflict.
      const line = "point P = offset(from: A dx: 10+@Wi)";
      const context = dslCompletionContextAt(line, at(line, "@Wi"));
      expect(context?.kind).toBe("parameter");
    });

    it("does not trigger for a decimal literal (10.5), only for a non-numeric elementToken", () => {
      const line = "point P = offset(from: A dx: 10.5)";
      expect(dslCompletionContextAt(line, at(line, "10.5"))).toBeNull();
    });

    it("offers elementParameter narrowing inside a coordinate literal's x/y sub-span", () => {
      const line = "line L = segment(start: A end: (直線AB.startPoint.x, 10))";
      const context = dslCompletionContextAt(line, at(line, "直線AB.startPoint.x"));
      expect(context).toMatchObject({
        kind: "elementParameter",
        elementToken: "直線AB"
      });
    });

    it("offers elementParameter narrowing inside a vars=[...] record expression field", () => {
      const line = "point P = coordinate(x: 0 y: 0 vars: [Width: 直線AB.length])";
      const context = dslCompletionContextAt(line, at(line, "直線AB.length"));
      expect(context).toMatchObject({
        kind: "elementParameter",
        elementToken: "直線AB"
      });
    });

    it("offers elementParameter narrowing inside an intermediates=[...] numeric field", () => {
      const line = "curve C = bezier(start: A end: B intermediates: [pt1:直線AB.startTangentAngleDeg:5:5:id1])";
      const context = dslCompletionContextAt(line, at(line, "直線AB.startTangentAngleDeg"));
      expect(context).toMatchObject({
        kind: "elementParameter",
        elementToken: "直線AB"
      });
    });

    it("offers elementParameter narrowing for place/printLayout numeric attribute values", () => {
      const line = "place Group1 (at: (10, 20) angle: 直線AB.startAngleDeg)";
      const context = dslCompletionContextAt(line, at(line, "直線AB.startAngleDeg"));
      expect(context).toMatchObject({
        kind: "elementParameter",
        elementToken: "直線AB"
      });
    });
  });

  describe("intermediates=[...] field-position discrimination", () => {
    const line = "curve C = bezier(start: A end: B intermediates: [@pt:15+@Wi:5:5:id1])";

    it("offers @-completion for the numeric angle field (field 1)", () => {
      const context = dslCompletionContextAt(line, at(line, "@Wi"));
      expect(context).toMatchObject({
        kind: "parameter",
        from: line.indexOf("@Wi"),
        to: at(line, "@Wi"),
        parameter: { key: "intermediates" }
      });
    });

    it("never offers completion inside the point field (field 0)", () => {
      expect(dslCompletionContextAt(line, at(line, "@pt"))).toBeNull();
    });

    it("never offers completion inside the id field (field 4)", () => {
      const idLine = "curve C = bezier(start: A end: B intermediates: [pt1:15:5:5:@id1])";
      expect(dslCompletionContextAt(idLine, at(idLine, "@id1"))).toBeNull();
    });
  });
});
