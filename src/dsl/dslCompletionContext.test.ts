import { describe, expect, it } from "vitest";
import { dslCompletionContextAt } from "./dslCompletionContext";

const at = (line: string, token: string) => line.indexOf(token) + token.length;

describe("dslCompletionContextAt", () => {
  it("uses parser-owned statement keywords only at a line head", () => {
    const context = dslCompletionContextAt("  poi", 5);
    expect(context).toMatchObject({ kind: "keyword", from: 2, to: 5 });
    expect(context?.kind === "keyword" && context.options).toContain("point");
    expect(dslCompletionContextAt("// point", 7)).toBeNull();
    expect(dslCompletionContextAt("/* point */", 5)).toBeNull();
    expect(dslCompletionContextAt("still */ poi", 5, true)).toBeNull();
    expect(dslCompletionContextAt("still */ poi", 12, true)).toMatchObject({ kind: "keyword" });
    const line = "point P = coordinate(x: 0, y: 0)";
    expect(dslCompletionContextAt(line, at(line, "="))).toBeNull();
  });

  it("recognizes the formal nui1 instance spelling for module call completion", () => {
    const line = "instance foo = Foo(ba";
    const keywordContext = dslCompletionContextAt("inst", 4);
    expect(keywordContext).toMatchObject({ kind: "keyword" });
    expect(keywordContext?.kind === "keyword" && keywordContext.options).toContain("instance");
    expect(dslCompletionContextAt(line, line.length)).toMatchObject({
      kind: "moduleArgumentLabel",
      from: line.indexOf("ba"),
      to: line.length,
      argumentIndex: 1
    });
    const withState = "instance foo(state: hidden) = Foo(ba";
    expect(dslCompletionContextAt(withState, withState.length)).toMatchObject({
      kind: "moduleArgumentLabel",
      from: withState.indexOf("ba"),
      to: withState.length
    });
  });

  it("uses the typed scalar lane inside nested builtin calls in conditions", () => {
    const line = "if (isClose(1, ";
    expect(dslCompletionContextAt(line, line.length)).toMatchObject({
      kind: "conditionExpression",
      positionContext: { kind: "operand", expectedType: { kind: "number" } }
    });
  });

  it("resolves reference and choice contexts through live line reparsing", () => {
    const line = "line L = segment(start: A, end: B)";
    expect(dslCompletionContextAt(line, at(line, "A"))).toMatchObject({
      kind: "parameter",
      parameter: { definition: { kind: "reference" } }
    });

    const choice = "line Seam = offset(sources: [AB], distance: 4, side: left)";
    expect(dslCompletionContextAt(choice, at(choice, "left"))).toMatchObject({
      kind: "parameter",
      parameter: { definition: { kind: "choice" } }
    });

    const curveSide = "point P = tangentOffset(line: C, base: A, curveSide: convex)";
    expect(dslCompletionContextAt(curveSide, at(curveSide, "convex"))).toMatchObject({
      kind: "parameter",
      parameter: { key: "curveSide", definition: { kind: "choice", choiceOptions: ["convex", "concave"] } }
    });

    // F2's partial-call scanner owns construction && named-argument positions;
    // valid values continue through the parser-derived branches below.
  });

  it("classifies a zero-length choice value as its own choice context, not a fallen-through attribute-key or -state", () => {
    // Real repro (Task 51 manual E2E rerun): select an existing choice value
    // && delete it, landing the cursor right where the deleted text used to
    // start - inside the raw whitespace gap left behind, not at its far
    // edge. dslArgScanner's trimSpan always collapses an empty valueSpan
    // toward the gap's far edge (the next key, || the closing paren), which
    // sits past the cursor whenever the gap is wider than the one mandatory
    // separating space - exactly what happens here, since "right" itself
    // had its own leading && trailing space.
    const before = "line Off = offset(sources: [AB], distance: 3, side: right, closed: false)";
    const deleteStart = before.indexOf("right");
    const deleteEnd = deleteStart + "right".length;
    const after = before.slice(0, deleteStart) + before.slice(deleteEnd);
    expect(after).toBe("line Off = offset(sources: [AB], distance: 3, side: , closed: false)");
    const gapStart = after.indexOf("side:") + "side:".length;
    const gapEnd = after.indexOf("closed:");
    expect(gapEnd - gapStart).toBe(3);

    // Every position inside the raw gap - its very first character (right
    // after the colon), the real-deletion cursor position (one char in),
    // && its far edge - must resolve to the same choice context, insert-only
    // at that exact cursor (no phantom prefix to replace, per referenceCompletionSpan).
    for (const pos of [gapStart, deleteStart, gapEnd]) {
      const context = dslCompletionContextAt(after, pos);
      expect(context).toMatchObject({
        kind: "parameter",
        from: pos,
        to: pos,
        parameter: { key: "side", definition: { kind: "choice", choiceOptions: ["right", "left"] } }
      });
    }
  });

  it("narrows line-list completion to the current item for safe re-editing", () => {
    const line = "line O = offset(sources: [First, Sec], distance: 4, side: left)";
    const context = dslCompletionContextAt(line, at(line, "Sec"));
    expect(context).toMatchObject({
      kind: "parameter",
      from: line.indexOf("Sec"),
      to: at(line, "Sec"),
      parameter: { definition: { kind: "lineReferenceList" } }
    });
  });

  it("keeps for-opening boolean attributes eligible through the shared synthetic-close reparse", () => {
    const line = "for i in range(from: 0, count: 3, showGenerated: true) {";
    expect(dslCompletionContextAt(line, line.indexOf("true") + 2)).toMatchObject({
      kind: "propertyScalarValue",
      propertyContext: { kind: "expression" }
    });
  });

  describe("number-kind @-token narrowing", () => {
    it("narrows a number-kind value span to just the trailing @token, not the whole expression", () => {
      const line = "point P = offset(from: A, dx: 10+@Wi)";
      const context = dslCompletionContextAt(line, at(line, "@Wi"));
      expect(context).toMatchObject({
        kind: "parameter",
        from: line.indexOf("@Wi"),
        to: at(line, "@Wi"),
        parameter: { definition: { kind: "number" } }
      });
    });

    it("returns null for a number-kind span when the cursor isn't right after @", () => {
      const line = "point P = offset(from: A, dx: 10)";
      expect(dslCompletionContextAt(line, at(line, "10"))).toBeNull();
    });

    it("preserves text before the @ token outside the returned span", () => {
      const line = "point P = offset(from: A, dx: 10+@Wi)";
      const context = dslCompletionContextAt(line, at(line, "@Wi"));
      expect(context?.kind === "parameter" && line.slice(0, context.from)).toBe("point P = offset(from: A, dx: 10+");
    });
  });

  describe("typed number geometry-property narrowing", () => {
    it("narrows @Element. to its property segment in a number initializer", () => {
      const line = "const length: number = @AB.le";
      const context = dslCompletionContextAt(line, at(line, "@AB.le"));
      expect(context).toMatchObject({
        kind: "elementParameter",
        from: line.indexOf(".le") + 1,
        to: line.length,
        elementToken: "AB",
        sigil: true
      });
    });

    it("keeps a scoped element path in the elementToken completion context", () => {
      const line = "const length: number = @G::H::AB.le";
      const context = dslCompletionContextAt(line, line.length);
      expect(context).toMatchObject({
        kind: "elementParameter",
        elementToken: "G::H::AB",
        sigil: true,
        from: line.indexOf(".le") + 1,
        to: line.length
      });
    });

    it("does not treat @ alone as a geometry property and carries unsupported types without candidates", () => {
      expect(dslCompletionContextAt("const length: number = @", "const length: number = @".length)).toMatchObject({ kind: "typedInitializer" });
      expect(dslCompletionContextAt("const label: string = @AB.", "const label: string = @AB.".length)).toMatchObject({
        kind: "elementParameter",
        expectedScalarType: { kind: "string" }
      });
    });

    it("carries an exact choice type through a schema-typed element property", () => {
      const line = "arc B = arc(center: (0, 0), radius: 10, start: 0, end: 90, direction: @A.,)";
      const pos = line.indexOf("@A.") + "@A.".length;
      expect(dslCompletionContextAt(line, pos)).toMatchObject({
        kind: "elementParameter",
        elementToken: "A",
        expectedScalarType: { kind: "choice", options: ["counterclockwise", "clockwise"] }
      });
    });

    it("retains an unfinished geometry-property token for set RHS type resolution", () => {
      const line = "set length = @AB.";
      expect(dslCompletionContextAt(line, line.length)).toMatchObject({
        kind: "setRhs",
        geometryProperty: { elementToken: "AB", from: line.length, to: line.length }
      });
    });
  });

  describe("nominal record initializer narrowing", () => {
    it("distinguishes whole-record and constructor field positions", () => {
      const whole = "const value: Pair = @pa";
      expect(dslCompletionContextAt(whole, whole.length)).toMatchObject({
        kind: "recordInitializer",
        recordTypeName: "Pair",
        fieldLabel: false
      });

      const fields = "const value: Pair = Pair(x: 1, la)";
      expect(dslCompletionContextAt(fields, fields.length)).toMatchObject({
        kind: "recordInitializer",
        recordTypeName: "Pair",
        fieldLabel: true,
        providedFieldNames: ["x"]
      });
    });

    it("keeps a qualified record value in the generic Module member context with its expected type name", () => {
      const line = "const copy: Pair = @Use::";
      expect(dslCompletionContextAt(line, line.length)).toMatchObject({
        kind: "moduleQualifiedMember",
        qualifiedInstanceName: "Use",
        expectedRecordTypeName: "Pair"
      });
    });
  });

  describe("reference-kind coordinate literal x/y sub-spans", () => {
    it("narrows to just the @token inside a coordinate literal's y component", () => {
      const line = "line L = segment(start: A, end: (10, @Wi))";
      const context = dslCompletionContextAt(line, at(line, "@Wi"));
      expect(context).toMatchObject({
        kind: "parameter",
        from: line.indexOf("@Wi"),
        to: at(line, "@Wi"),
        parameter: { definition: { kind: "number" } }
      });
    });

    it("narrows to just the @token inside a coordinate literal's x component", () => {
      const line = "line L = segment(start: A, end: (@Wi, 10))";
      const context = dslCompletionContextAt(line, at(line, "@Wi"));
      expect(context).toMatchObject({
        kind: "parameter",
        from: line.indexOf("@Wi"),
        to: at(line, "@Wi"),
        parameter: { definition: { kind: "number" } }
      });
    });

    it("returns null inside a coordinate sub-span when the cursor isn't right after @ (no point-name fallback)", () => {
      const line = "line L = segment(start: A, end: (10, 20))";
      expect(dslCompletionContextAt(line, at(line, "20"))).toBeNull();
    });

    it("keeps normal reference-name completion for a non-coordinate reference value", () => {
      const line = "line L = segment(start: A, end: B)";
      expect(dslCompletionContextAt(line, at(line, "A"))).toMatchObject({
        kind: "parameter",
        parameter: { definition: { kind: "reference" } }
      });
    });
  });

  describe("place/layout/output attributes", () => {
    it("offers number-kind @-completion for place's angle=", () => {
      const line = "place @Group1(at: (10, 20), angle: 15+@Wi)";
      const context = dslCompletionContextAt(line, at(line, "@Wi"));
      expect(context).toMatchObject({
        kind: "parameter",
        from: line.indexOf("@Wi"),
        to: at(line, "@Wi"),
        parameter: { source: "printLayoutBlock", key: "angle" }
      });
    });

    it("offers coordinate sub-span @-completion for place's at=", () => {
      const line = "place @Group1(at: (10, @Wi), angle: 15)";
      const context = dslCompletionContextAt(line, at(line, "@Wi"));
      expect(context).toMatchObject({
        kind: "parameter",
        from: line.indexOf("@Wi"),
        to: at(line, "@Wi"),
        parameter: { source: "printLayoutBlock", key: "at" }
      });
    });

    it("offers number-kind @-completion for layout scale=", () => {
      const line = "layout Layout1 (scale: 2+@Wi) {";
      const context = dslCompletionContextAt(line, at(line, "@Wi"));
      expect(context).toMatchObject({
        kind: "parameter",
        from: line.indexOf("@Wi"),
        parameter: { source: "printLayoutBlock", key: "scale" }
      });
    });

    it("returns null for unrelated place/output attributes", () => {
      const line = "place @Group1(at: (0, 0), mirror: true)";
      expect(dslCompletionContextAt(line, at(line, "true"))).toBeNull();
      const layoutLine = "print Output(layout: @Layout1, paper: a4, overlap: 0)";
      expect(dslCompletionContextAt(layoutLine, at(layoutLine, "a4"))).toBeNull();
    });
  });

  describe("elementParameter (ElementName.parameterKey) narrowing", () => {
    it("narrows an elementParameter context in a number-kind field", () => {
      const line = "point P = offset(from: A, dx: 10+@直線AB.st)";
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
      const line = "point P = offset(from: A, dx: 10+@Wi)";
      const context = dslCompletionContextAt(line, at(line, "@Wi"));
      expect(context?.kind).toBe("parameter");
    });

    it("does not trigger for a decimal literal (10.5), only for a non-numeric elementToken", () => {
      const line = "point P = offset(from: A, dx: 10.5)";
      expect(dslCompletionContextAt(line, at(line, "10.5"))).toBeNull();
    });

    it("offers elementParameter narrowing inside a coordinate literal's x/y sub-span", () => {
      const line = "line L = segment(start: A, end: (@直線AB.startPoint.x, 10))";
      const context = dslCompletionContextAt(line, at(line, "直線AB.startPoint.x"));
      expect(context).toMatchObject({
        kind: "elementParameter",
        elementToken: "直線AB"
      });
    });

    it("offers elementParameter narrowing inside an intermediates=[...] numeric field", () => {
      const line = "curve C = bezier(start: A, end: B, intermediates: [pt1:@直線AB.startPoint.x:5:5:id1])";
      const context = dslCompletionContextAt(line, at(line, "直線AB.startPoint.x"));
      expect(context).toMatchObject({
        kind: "elementParameter",
        elementToken: "直線AB"
      });
    });

    it("offers elementParameter narrowing for place/printLayout numeric attribute values", () => {
      const line = "place @Group1 (at: (10, 20), angle: @直線AB.startAngleDeg)";
      const context = dslCompletionContextAt(line, at(line, "直線AB.startAngleDeg"));
      expect(context).toMatchObject({
        kind: "elementParameter",
        elementToken: "直線AB"
      });
    });

    describe("nui 1 sigil form @Element.property (Task 51)", () => {
      it("narrows @直線AB. to elementParameter with elementToken excluding the sigil (fixes the pre-migration @AB. leak)", () => {
        const line = "point P = offset(from: A, dx: @直線AB.st)";
        const context = dslCompletionContextAt(line, at(line, "@直線AB.st"));
        expect(context).toMatchObject({
          kind: "elementParameter",
          from: line.indexOf(".st") + 1,
          to: at(line, "@直線AB.st"),
          elementToken: "直線AB",
          sigil: true
        });
      });

      it("narrows an empty query right after the dot", () => {
        const line = "point P = offset(from: A, dx: @直線AB.)";
        const context = dslCompletionContextAt(line, at(line, "@直線AB."));
        expect(context).toMatchObject({ kind: "elementParameter", elementToken: "直線AB", sigil: true });
      });

      it("does not narrow the removed bare form", () => {
        const line = "point P = offset(from: A, dx: 直線AB.st)";
        expect(dslCompletionContextAt(line, at(line, "直線AB.st"))).toBeNull();
      });

      it("suppresses the bare form's elementParameter narrowing", () => {
        const line = "point P = offset(from: A, dx: 直線AB.st)";
        expect(dslCompletionContextAt(line, at(line, "直線AB.st"))).toBeNull();
      });

      it("does not offer the bare form", () => {
        const line = "point P = offset(from: A, dx: 直線AB.st)";
        expect(dslCompletionContextAt(line, at(line, "直線AB.st"))).toBeNull();
      });

      it("offers the sigil form's elementParameter narrowing", () => {
        const line = "point P = offset(from: A, dx: @直線AB.st)";
        expect(dslCompletionContextAt(line, at(line, "@直線AB.st"))).toMatchObject({ kind: "elementParameter", elementToken: "直線AB", sigil: true });
      });
    });
  });

  describe("intermediates=[...] field-position discrimination", () => {
    const line = "curve C = bezier(start: A, end: B, intermediates: [@pt:15+@Wi:5:5:id1])";

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
      const idLine = "curve C = bezier(start: A, end: B, intermediates: [pt1:15:5:5:@id1])";
      expect(dslCompletionContextAt(idLine, at(idLine, "@id1"))).toBeNull();
    });
  });
});
