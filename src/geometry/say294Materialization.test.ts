import { describe, expect, it } from "vitest";
import { compileDslDocument, serializeDocumentToDsl } from "@nuinuicad/nui-language";
import { parseDslSnapshot } from "@nuinuicad/nui-language";
import { buildEvaluationOptions } from "./productionEvaluationContext";
import { evaluateElements } from "./evaluate";
import type { LastGoodDslDocument } from "@nuinuicad/nui-language/document";

const compile = (source: string) => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: 0 });
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `say294:${index}`]))
  });
};

describe("SAY-294 geometry value drawable materialization", () => {
  it("parses, lowers, evaluates, and preserves independent point/line/path identities", () => {
    const compiled = compile([
      "nui 1",
      "point P = coordinate(x: 1, y: 2)",
      "point P2 = from(source: @P)",
      "line L = segment(start: @P, end: (11, 2))",
      "line L2 = from(source: @L)",
      "path B = from(source: @L)",
      "const source:path = @L",
      "path C = from(source: @source)"
    ].join("\n"));

    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(compiled.document?.elements.map((element) => element.type)).toEqual([
      "freePoint", "materializedPoint", "line", "materializedLine", "materializedPath", "materializedPath"
    ]);
    const serialized = serializeDocumentToDsl(compiled.document!, 1);
    expect(serialized).toContain("point P2 = from(");
    expect(serialized).toContain("source: @P");
    expect(serialized).toContain("path C = from(");
    expect(serialized).toContain("source: @source");
    // The model serializer owns drawable/materialized statements. Immutable
    // value declarations remain source-only, so the canonical source keeps
    // the original const declaration alongside this serialized element slice.
    expect(compile([
      "nui 1",
      "const source:path = @L",
      ...serialized.split("\n").slice(1)
    ].join("\n")).diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const sourceTargets = compiled.geometryInputTargetsByElementId;
    expect(sourceTargets?.get(compiled.document!.elements[1]!.id)?.get("source")).toMatchObject({
      kind: "drawable",
      elementId: compiled.document!.elements[0]!.id,
      geometryType: "point"
    });
    expect(sourceTargets?.get(compiled.document!.elements[5]!.id)?.get("source")).toMatchObject({
      kind: "geometryValue",
      geometryType: "path"
    });

    const options = buildEvaluationOptions({ compiledDocument: compiled as LastGoodDslDocument, evaluationLimitIndex: undefined });
    const result = evaluateElements(compiled.document!.elements, options);
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get(compiled.document!.elements[1]!.id)).toMatchObject({
      kind: "point", elementId: compiled.document!.elements[1]!.id, x: 1, y: 2
    });
    expect(result.computedGeometry.get(compiled.document!.elements[3]!.id)).toMatchObject({
      kind: "line", elementId: compiled.document!.elements[3]!.id, start: { x: 1, y: 2 }, end: { x: 11, y: 2 }
    });
    expect(result.computedGeometry.get(compiled.document!.elements[4]!.id)).toMatchObject({
      kind: "line", elementId: compiled.document!.elements[4]!.id, start: { x: 1, y: 2 }, end: { x: 11, y: 2 }
    });
  });

  it("enforces directional interfaces and rejects optional geometry at the source slot", () => {
    const compiled = compile([
      "nui 1",
      "point P = coordinate(x: 1, y: 2)",
      "line L = segment(start: @P, end: (11, 2))",
      "path Wide = from(source: @L)",
      "line Narrow = from(source: @Wide)",
      "const maybe: point? = @P",
      "point Invalid = from(source: @maybe)"
    ].join("\n"));
    expect(compiled.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining([
      "module-geometry-type-mismatch",
      "module-optional-value-required"
    ]));
  });

  it("resolves base, named, final, and shorthand stages without sharing recipe identity", () => {
    const compiled = compile([
      "nui 1",
      "line A = segment(start: (0, 0), end: (10, 0))",
      "move A as moved (from: (0, 0), to: (10, 0))",
      "line BaseCopy = from(source: @A.base)",
      "line NamedCopy = from(source: @A.moved)",
      "line ExplicitFinal = from(source: @A.moved.final)",
      "line FinalCopy = from(source: @A)",
      "move NamedCopy (from: (10, 0), to: (30, 0))"
    ].join("\n"));
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const evaluation = evaluateElements(
      compiled.document!.elements,
      buildEvaluationOptions({ compiledDocument: compiled as LastGoodDslDocument, evaluationLimitIndex: undefined })
    );
    expect(evaluation.errors).toEqual([]);
    const geometry = (name: string) => {
      const element = compiled.document!.elements.find((candidate) => candidate.name === name)!;
      return evaluation.computedGeometry.get(element.id)!;
    };
    expect(geometry("BaseCopy")).toMatchObject({ start: { x: 0 }, end: { x: 10 } });
    expect(geometry("NamedCopy")).toMatchObject({ start: { x: 30 }, end: { x: 40 } });
    expect(geometry("ExplicitFinal")).toMatchObject({ start: { x: 10 }, end: { x: 20 } });
    expect(geometry("FinalCopy")).toMatchObject({ start: { x: 10 }, end: { x: 20 } });
    expect(geometry("A")).toMatchObject({ start: { x: 10 }, end: { x: 20 } });
  });

  it("reevaluates live sources and preserves concrete broad-path families", () => {
    const compileAndEvaluate = (source: string) => {
      const compiled = compile(source);
      const evaluation = evaluateElements(
        compiled.document!.elements,
        buildEvaluationOptions({ compiledDocument: compiled as LastGoodDslDocument, evaluationLimitIndex: undefined })
      );
      return { compiled, evaluation };
    };
    const first = compileAndEvaluate([
      "nui 1",
      "point P = coordinate(x: 1, y: 2)",
      "point Copy = from(source: @P)",
      "arc Arc = arc(center: (0, 0), radius: 10, start: 0, end: 90)",
      "const arcSource:path = @Arc",
      "path ArcCopy = from(source: @Arc)",
      "path ArcValueCopy = from(source: @arcSource)"
    ].join("\n"));
    const second = compileAndEvaluate([
      "nui 1",
      "point P = coordinate(x: 7, y: 8)",
      "point Copy = from(source: @P)",
      "arc Arc = arc(center: (0, 0), radius: 10, start: 0, end: 90)",
      "path ArcCopy = from(source: @Arc)"
    ].join("\n"));
    expect(first.compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(second.compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const firstCopy = first.compiled.document!.elements.find((element) => element.name === "Copy")!;
    const secondCopy = second.compiled.document!.elements.find((element) => element.name === "Copy")!;
    expect(first.evaluation.computedGeometry.get(firstCopy.id)).toMatchObject({ x: 1, y: 2, elementId: firstCopy.id });
    expect(second.evaluation.computedGeometry.get(secondCopy.id)).toMatchObject({ x: 7, y: 8, elementId: secondCopy.id });
    const firstArcCopy = first.compiled.document!.elements.find((element) => element.name === "ArcCopy")!;
    const arcGeometry = first.evaluation.computedGeometry.get(firstArcCopy.id)!;
    expect(arcGeometry).toMatchObject({ kind: "arcLine", elementId: firstArcCopy.id, radius: 10 });
    expect((arcGeometry as Extract<typeof arcGeometry, { kind: "arcLine" }>).center.elementId).toBe(`${firstArcCopy.id}:center`);
    const firstArcValueCopy = first.compiled.document!.elements.find((element) => element.name === "ArcValueCopy")!;
    expect(first.evaluation.computedGeometry.get(firstArcValueCopy.id)).toMatchObject({
      kind: "arcLine",
      elementId: firstArcValueCopy.id,
      radius: 10
    });
  });

  it("keeps disabled materialization unavailable while hidden materialization evaluates", () => {
    const compiled = compile([
      "nui 1",
      "point P = coordinate(x: 1, y: 2)",
      "point Disabled = from(source: @P, enabled: false)",
      "point Hidden = from(source: @P, visible: false)"
    ].join("\n"));
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const evaluation = evaluateElements(
      compiled.document!.elements,
      buildEvaluationOptions({ compiledDocument: compiled as LastGoodDslDocument, evaluationLimitIndex: undefined })
    );
    const disabled = compiled.document!.elements.find((element) => element.name === "Disabled")!;
    const hidden = compiled.document!.elements.find((element) => element.name === "Hidden")!;
    expect(evaluation.computedGeometry.has(disabled.id)).toBe(false);
    expect(evaluation.computedGeometry.get(hidden.id)).toMatchObject({ elementId: hidden.id, x: 1, y: 2 });
    expect(evaluation.effectiveVisibleElementIds).not.toContain(hidden.id);
  });
});
