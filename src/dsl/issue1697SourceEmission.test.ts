import { describe, expect, it } from "vitest";
import {
  compileDslDocument,
  formatNumericValueForDsl,
  parseDsl,
  parseDslSnapshot,
  serializeDocumentToDsl,
  serializeExtractDeclaration
} from "@nuinuicad/nui-language";
import type { LastGoodDslDocument } from "@nuinuicad/nui-language/document";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import { evaluateElementsReference } from "../geometry/evaluationEngine";

const compileWithStableElementIds = (source: string) => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: 0 });
  const occurrencesByName = new Map<string, number>();
  const assignedStatementIds = new Map<number, string>();
  parsed.statements.forEach((statement, statementIndex) => {
    if (
      (statement.kind !== "element" && statement.kind !== "group" && statement.kind !== "typedDeclaration") ||
      !("name" in statement)
    ) return;
    const identityKey = `${statement.kind}-${statement.name}`;
    const occurrence = occurrencesByName.get(identityKey) ?? 0;
    occurrencesByName.set(identityKey, occurrence + 1);
    assignedStatementIds.set(statementIndex, `issue1697-${identityKey}-${occurrence}`);
  });
  return compileDslDocument(source, { preparsed: parsed, assignedStatementIds });
};

const errors = (compiled: ReturnType<typeof compileDslDocument>) =>
  compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error");

const asLastGood = (compiled: ReturnType<typeof compileDslDocument>): LastGoodDslDocument => {
  if (!compiled.document || !compiled.statementMap || compiled.majorVersion === null) {
    throw new Error("Expected a successfully compiled document");
  }
  return compiled as LastGoodDslDocument;
};

const evaluate = (compiled: ReturnType<typeof compileDslDocument>) =>
  evaluateElementsReference(
    asLastGood(compiled).document.elements,
    buildEvaluationOptions({ compiledDocument: asLastGood(compiled), evaluationLimitIndex: undefined })
  );

it.each(["A B", "@A", '"A"'])("rejects model name %s before source emission", (name) => {
  const document = asLastGood(compileWithStableElementIds("nui 1\npoint A = coordinate(x: 1, y: 2)")).document;
  const elements = document.elements.map(element => ({ ...element, name }));
  expect(() => serializeDocumentToDsl({ ...document, elements }, 1)).toThrow(TypeError);
});

const sourceOutputSemantics = (document: NonNullable<ReturnType<typeof compileDslDocument>["document"]>) => {
  const layoutNameById = new Map(document.layouts.map((layout) => [layout.id, layout.name]));
  const semanticLayers = (layers: readonly { reference: string; name: string; scopeId: string }[]) =>
    layers.map(({ reference, name, scopeId }) => ({ reference, name, scopeId }));
  return {
    layouts: document.layouts.map(({ name, scale, placements }) => ({
      name,
      scale,
      placements: placements.map(({ groupId, origin, at, scale: placementScale, angleDeg, mirror }) => ({
        groupId,
        origin,
        at,
        scale: placementScale,
        angleDeg,
        mirror
      }))
    })),
    printOutputs: document.printOutputs.map(({ name, layoutId, layers, paper, orientation, overlap }) => ({
      name,
      layout: layoutNameById.get(layoutId),
      layers: semanticLayers(layers),
      paper,
      orientation,
      overlap
    })),
    svgOutputs: document.svgOutputs.map(({ name, layoutId, layers, margin }) => ({
      name,
      layout: layoutNameById.get(layoutId),
      layers: semanticLayers(layers),
      margin
    }))
  };
};

const roundTripSource = [
  "nui 1",
  "layer Pattern",
  "point A = coordinate(x: 0, y: 0)",
  "point B = coordinate(x: 40, y: 20)",
  "line AB = segment(start: A, end: B)",
  "point Derived = onLine(from: AB.end, distance: AB.length / 2)",
  "group front {",
  "  point A = coordinate(x: 5, y: 5)",
  "  line edge = segment(start: ::A, end: ::A)",
  "}",
  "line Use in Pattern = offset(sources: [front::edge], distance: AB.length / 2, side: @left)",
  "point Tangent = tangentOffset(line: AB, base: B, curveSide: @convex, distance: 2)",
  "text Tag = label(text: \"literal @left\", anchor: A, size: 4)",
  "image Reference = image(source: \"assets/underlay@front.png\", origin: A, scale: 1)",
  "layout Layout {",
  "  place front(origin: front::A, at: (0, 0))",
  "}",
  "print Sheet(layout: Layout, layers: [Pattern], paper: a4, orientation: portrait, overlap: 0)",
  "svg Preview(layout: Layout, layers: [Pattern], margin: 0)"
].join("\n");

describe("Issue #1697 canonical source emission", () => {
  it("round-trips bare geometry references, choices, layers and source outputs by identity", () => {
    const first = compileWithStableElementIds(roundTripSource);
    expect(errors(first)).toEqual([]);
    expect(first.diagnostics.some((diagnostic) => diagnostic.code === "property-reference-requires-sigil")).toBe(false);
    expect(first.document).not.toBeNull();

    // Clearing source-target text models generated output from the compiled
    // semantic model, so the numeric formatter path is exercised as well.
    const generatedDocument = {
      ...first.document!,
      geometryInputTargetsByElementId: new Map()
    };
    const emitted = serializeDocumentToDsl(generatedDocument, 1);

    expect(emitted).toContain("line AB = segment(");
    expect(emitted).toContain("start: A,");
    expect(emitted).toContain("end: B,");
    expect(emitted).toContain("from: AB.end,");
    expect(emitted).toContain("distance: AB.length / 2,");
    expect(emitted).toContain("line edge = segment(");
    expect(emitted).toContain("start: ::A,");
    expect(emitted).toContain("end: ::A,");
    expect(emitted).toContain("in Pattern = offset(");
    expect(emitted).toContain("sources: [front::edge],");
    expect(emitted).toContain("side: @left,");
    expect(emitted).toContain("curveSide: @convex,");
    expect(emitted).toContain("place front(");
    expect(emitted).toContain("origin: front::A,");
    expect(emitted).toContain("print Sheet(");
    expect(emitted).toContain("layout: Layout,");
    expect(emitted).toContain("layers: [Pattern],");
    expect(emitted).toContain("svg Preview(");
    expect(emitted).toContain('text: "literal @left"');
    expect(emitted).toContain('source: "assets/underlay@front.png"');
    expect(emitted).not.toMatch(/(?:start|end|from|sources|origin|layout|layers):\s*@/);

    const second = compileWithStableElementIds(emitted);
    expect(errors(second)).toEqual([]);
    expect(second.document).not.toBeNull();
    expect(second.document!.elements.map(({ id, name, type, parentGroupId }) => ({ id, name, type, parentGroupId })))
      .toEqual(first.document!.elements.map(({ id, name, type, parentGroupId }) => ({ id, name, type, parentGroupId })));
    expect(second.document!.elements.map((element) => ({
      id: element.id,
      x: "x" in element ? element.x : undefined,
      y: "y" in element ? element.y : undefined,
      startPoint: "startPoint" in element ? element.startPoint : undefined,
      endPoint: "endPoint" in element ? element.endPoint : undefined,
      curveSide: "curveSide" in element ? element.curveSide : undefined,
      distance: "distance" in element ? element.distance : undefined,
      offset: "offset" in element ? element.offset : undefined,
      sourcePath: "sourcePath" in element ? element.sourcePath : undefined,
      text: "text" in element ? element.text : undefined
    }))).toEqual(first.document!.elements.map((element) => ({
      id: element.id,
      x: "x" in element ? element.x : undefined,
      y: "y" in element ? element.y : undefined,
      startPoint: "startPoint" in element ? element.startPoint : undefined,
      endPoint: "endPoint" in element ? element.endPoint : undefined,
      curveSide: "curveSide" in element ? element.curveSide : undefined,
      distance: "distance" in element ? element.distance : undefined,
      offset: "offset" in element ? element.offset : undefined,
      sourcePath: "sourcePath" in element ? element.sourcePath : undefined,
      text: "text" in element ? element.text : undefined
    })));
    expect([...evaluate(second).computedGeometry]).toEqual([...evaluate(first).computedGeometry]);
    expect(sourceOutputSemantics(second.document!)).toEqual(sourceOutputSemantics(first.document!));
  });

  it("rejects the removed @geometry-property spelling while accepting bare AB.length", () => {
    const valid = compileWithStableElementIds(roundTripSource);
    expect(errors(valid)).toEqual([]);
    expect(valid.diagnostics.some((diagnostic) => diagnostic.code === "property-reference-requires-sigil")).toBe(false);

    const formerSource = roundTripSource.replaceAll("AB.length", "@AB.length");
    const formerSyntax = compileWithStableElementIds(formerSource);
    expect(errors(formerSyntax).length).toBeGreaterThan(0);
    const diagnostic = errors(formerSyntax).find((item) => item.code === "invalid-source-reference");
    expect(diagnostic).toBeDefined();
    const span = diagnostic?.physicalSpan?.segments[0];
    expect(span && formerSource.slice(span.from, span.to)).toBe("@AB.length");
  });

  it("rejects a quoted receiver in a numeric construction instead of resolving it as geometry", () => {
    const source = 'nui 1\npoint A = coordinate(x: 1, y: 0)\npoint B = coordinate(x: "A".x, y: 0)';
    const diagnostic = errors(compileWithStableElementIds(source)).find((item) =>
      item.code === "quoted-identifier-not-allowed"
    );
    const span = diagnostic?.physicalSpan?.segments[0];
    expect(span && source.slice(span.from, span.to)).toBe('"A"');
  });

  it.each([
    "point P = coordinate(x: VALUE, y: 0)",
    "line P = segment(start: (VALUE, 0), end: (3, 5))",
    "layout L(scale: VALUE) {\n  place G(at: (0, 0))\n}",
    "layout L {\n  place G(at: (VALUE, 0))\n}",
    "move G::A(from: (0, 0), to: (1, 2), scale: VALUE)"
  ])("validates numeric reference spelling at %s", (body) => {
    const prelude = [
      "nui 1",
      "group G {",
      "  line A = segment(start: (0, 0), end: (10, 0))",
      "}",
      "for i in range(min: 0, max: 1, step: 1) {",
      "  line Mark = segment(start: (0, 0), end: (10, 0))",
      "}"
    ].join("\n");
    for (const [reference, code, expectedText] of [
      ["@Mark[0].length", "invalid-source-reference", "@Mark[0].length"],
      ["@G::A.length", "invalid-source-reference", "@G::A.length"],
      ['G::"A".length', "quoted-identifier-not-allowed", '"A"']
    ]) {
      const source = `${prelude}\n${body.replace("VALUE", reference)}`;
      const diagnostic = errors(compileWithStableElementIds(source)).find(item => item.code === code);
      const span = diagnostic?.physicalSpan?.segments[0];
      expect(span && source.slice(span.from, span.to)).toBe(expectedText);
    }
    const source = `${prelude}\n${body.replace("VALUE", "Mark[0].length")}`;
    expect(errors(compileWithStableElementIds(source))).toEqual([]);
  });

  it.each(["@A", "'A'"])("refuses %s as a geometry receiver in a label hole", (receiver) => {
    const source = "nui 1\nline A = segment(start: (0, 0), end: (10, 0))\n" +
      'text T = label(text: "${' + receiver + '.length}", anchor: none, size: 3)';
    const diagnostic = errors(compileWithStableElementIds(source)).find((item) =>
      item.code === "text-template-hole-invalid"
    );
    const span = diagnostic?.physicalSpan?.segments[0];
    expect(span && source.slice(span.from, span.to)).toBe(receiver);
  });

  it("retains unknown geometry-property diagnostics and their exact source ranges", () => {
    const source = [
      "nui 1",
      "line AB = segment(start: (0, 0), end: (10, 0))",
      "const invalid: number = AB.notAProperty",
      "const unresolved: number = Missing.length",
      "const wrongType: string = AB.length"
    ].join("\n");
    const compiled = compileWithStableElementIds(source);
    const propertyDiagnostic = errors(compiled).find((diagnostic) => diagnostic.code === "geometry-property-invalid");
    expect(propertyDiagnostic).toBeDefined();
    const propertySpan = propertyDiagnostic?.physicalSpan?.segments[0];
    expect(propertySpan && source.slice(propertySpan.from, propertySpan.to)).toBe("notAProperty");

    const unresolvedDiagnostic = errors(compiled).find((diagnostic) =>
      diagnostic.code === "geometry-property-invalid" && diagnostic !== propertyDiagnostic
    );
    expect(unresolvedDiagnostic).toBeDefined();
    const unresolvedSpan = unresolvedDiagnostic?.physicalSpan?.segments[0];
    expect(unresolvedSpan && source.slice(unresolvedSpan.from, unresolvedSpan.to)).toBe("Missing");

    const wrongTypeDiagnostic = errors(compiled).find((diagnostic) => diagnostic.line === 5);
    expect(wrongTypeDiagnostic).toBeDefined();
    const wrongTypeSpan = wrongTypeDiagnostic?.physicalSpan?.segments[0];
    expect(wrongTypeSpan && source.slice(wrongTypeSpan.from, wrongTypeSpan.to)).toBe("AB.length");
  });

  it("preserves literal text and import path contents while formatting generated numeric references", () => {
    const compiled = compileWithStableElementIds(roundTripSource);
    expect(errors(compiled)).toEqual([]);
    const line = compiled.document!.elements.find((element) => element.name === "AB")!;
    const consumer = compiled.document!.elements.find((element) => element.name === "Derived")!;
    const value = {
      kind: "expression" as const,
      expression: `${line.id}.length + "literal @${line.id}.length"`
    };

    expect(formatNumericValueForDsl(value, compiled.document!.elements, consumer))
      .toBe(`AB.length + "literal @${line.id}.length"`);

    const importSource = 'nui 1\nimport "patterns/@front.nui" as PatternLibrary';
    const importStatement = parseDsl(importSource).statements.find((statement) => statement.kind === "import");
    expect(importStatement).toMatchObject({ kind: "import", importPath: "patterns/@front.nui" });
  });

  it("serializes extract layer references without changing the source declaration shape", () => {
    const parsed = parseDsl(
      "extract Extract in Pattern(source: Base, parts: [outline in Detail: start..end])"
    );
    expect(parsed.diagnostics).toEqual([]);
    const statement = parsed.statements.find((candidate) => candidate.kind === "extract");
    expect(statement?.kind).toBe("extract");
    if (statement?.kind !== "extract") throw new Error("Expected extract declaration");

    const emitted = serializeExtractDeclaration(statement);
    expect(emitted).toContain("extract Extract in Pattern(");
    expect(emitted).toContain("outline in Detail: start..end,");
    expect(parseDsl(emitted).diagnostics).toEqual([]);
  });
});
