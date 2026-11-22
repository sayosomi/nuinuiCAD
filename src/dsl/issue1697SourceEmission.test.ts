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
    if (statement.kind !== "element") return;
    const occurrence = occurrencesByName.get(statement.name) ?? 0;
    occurrencesByName.set(statement.name, occurrence + 1);
    assignedStatementIds.set(statementIndex, `issue1697:${statement.name}:${occurrence}`);
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
      sourcePath: "sourcePath" in element ? element.sourcePath : undefined,
      text: "text" in element ? element.text : undefined
    }))).toEqual(first.document!.elements.map((element) => ({
      id: element.id,
      x: "x" in element ? element.x : undefined,
      y: "y" in element ? element.y : undefined,
      startPoint: "startPoint" in element ? element.startPoint : undefined,
      endPoint: "endPoint" in element ? element.endPoint : undefined,
      curveSide: "curveSide" in element ? element.curveSide : undefined,
      sourcePath: "sourcePath" in element ? element.sourcePath : undefined,
      text: "text" in element ? element.text : undefined
    })));
    expect([...evaluate(second).computedGeometry]).toEqual([...evaluate(first).computedGeometry]);
    expect(second.document!.layouts).toEqual(first.document!.layouts);
    expect(second.document!.printOutputs).toEqual(first.document!.printOutputs);
    expect(second.document!.svgOutputs).toEqual(first.document!.svgOutputs);
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
