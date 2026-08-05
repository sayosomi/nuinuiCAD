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

  it("classifies a zero-length choice value as its own choice context, not a fallen-through attribute-key or -state", () => {
    // Real repro (Task 51 manual E2E rerun): select an existing choice value
    // and delete it, landing the cursor right where the deleted text used to
    // start - inside the raw whitespace gap left behind, not at its far
    // edge. dslArgScanner's trimSpan always collapses an empty valueSpan
    // toward the gap's far edge (the next key, or the closing paren), which
    // sits past the cursor whenever the gap is wider than the one mandatory
    // separating space - exactly what happens here, since "right" itself
    // had its own leading and trailing space.
    const before = "line Off = offset(sources: [AB] distance: 3 side: right closed: false)";
    const deleteStart = before.indexOf("right");
    const deleteEnd = deleteStart + "right".length;
    const after = before.slice(0, deleteStart) + before.slice(deleteEnd);
    expect(after).toBe("line Off = offset(sources: [AB] distance: 3 side:  closed: false)");
    const gapStart = after.indexOf("side:") + "side:".length;
    const gapEnd = after.indexOf("closed:");
    expect(gapEnd - gapStart).toBe(2);

    // Every position inside the raw gap - its very first character (right
    // after the colon), the real-deletion cursor position (one char in),
    // and its far edge - must resolve to the same choice context, insert-only
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

    it("does not treat @ alone or non-number initializers as geometry properties", () => {
      expect(dslCompletionContextAt("const length: number = @", "const length: number = @".length)).toMatchObject({ kind: "typedInitializer" });
      expect(dslCompletionContextAt("const label: string = @AB.", "const label: string = @AB.".length)).toBeNull();
    });

    it("retains an unfinished geometry-property token for set RHS type resolution", () => {
      const line = "set length = @AB.";
      expect(dslCompletionContextAt(line, line.length)).toMatchObject({
        kind: "setRhs",
        geometryProperty: { elementToken: "AB", from: line.length, to: line.length }
      });
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

  describe("place/printLayout block attributes", () => {
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

    describe("nui 3 sigil form @Element.property (Task 51)", () => {
      it("narrows @直線AB. to elementParameter with elementToken excluding the sigil (fixes the pre-migration @AB. leak)", () => {
        const line = "point P = offset(from: A dx: @直線AB.st)";
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
        const line = "point P = offset(from: A dx: @直線AB.)";
        const context = dslCompletionContextAt(line, at(line, "@直線AB."));
        expect(context).toMatchObject({ kind: "elementParameter", elementToken: "直線AB", sigil: true });
      });

      it("still narrows the bare (pre-migration) form with sigil: false", () => {
        const line = "point P = offset(from: A dx: 直線AB.st)";
        const context = dslCompletionContextAt(line, at(line, "直線AB.st"));
        expect(context).toMatchObject({ kind: "elementParameter", elementToken: "直線AB", sigil: false });
      });

      it("offers the sigil form's elementParameter narrowing inside vars=[...] too", () => {
        const line = "point P = coordinate(x: 0 y: 0 vars: [Width: @直線AB.length])";
        const context = dslCompletionContextAt(line, at(line, "@直線AB.length"));
        expect(context).toMatchObject({ kind: "elementParameter", elementToken: "直線AB", sigil: true });
      });

      it("suppresses the bare form's elementParameter narrowing when majorVersion is 3 (checklist item 7)", () => {
        const line = "point P = offset(from: A dx: 直線AB.st)";
        expect(dslCompletionContextAt(line, at(line, "直線AB.st"), 3)).toBeNull();
      });

      it("keeps offering the bare form when majorVersion is omitted or 2", () => {
        const line = "point P = offset(from: A dx: 直線AB.st)";
        expect(dslCompletionContextAt(line, at(line, "直線AB.st"))).toMatchObject({ kind: "elementParameter", elementToken: "直線AB", sigil: false });
        expect(dslCompletionContextAt(line, at(line, "直線AB.st"), 2)).toMatchObject({ kind: "elementParameter", elementToken: "直線AB", sigil: false });
      });

      it("still offers the sigil form's elementParameter narrowing when majorVersion is 3", () => {
        const line = "point P = offset(from: A dx: @直線AB.st)";
        expect(dslCompletionContextAt(line, at(line, "@直線AB.st"), 3)).toMatchObject({ kind: "elementParameter", elementToken: "直線AB", sigil: true });
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
