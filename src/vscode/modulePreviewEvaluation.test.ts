import { describe, expect, it } from "vitest";
import { evaluateElements } from "../geometry/evaluate";
import { compileDslDocument, type CompiledDslDocument } from "@nuinuicad/nui-language";
import { parseDslSnapshot } from "@nuinuicad/nui-language";
import { compileModulePreviewRoot } from "../dsl/modulePreviewRoot";
import { queryModulePreviewTarget } from "../dsl/modulePreviewTarget";
import { buildRustEvaluationInput } from "../geometry/rustEvaluationInput";
import { buildModulePreviewEvaluationOptions } from "./modulePreviewEvaluation";

const compileWithIds = (source: string, sourceRevision = 27): CompiledDslDocument => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision });
  return compileDslDocument(source, {
    preparsed: parsed,
    sourceRevision,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `module-preview-eval:${index}`]))
  });
};

const previewFor = (source: string, needle: string) => {
  const compiled = compileWithIds(source);
  const target = queryModulePreviewTarget({
    source: { normalizedSource: source, sourceRevision: 27 },
    position: source.indexOf(needle) + Math.max(1, needle.length - 1),
    semantic: { sourceRevision: 27, compiled }
  });
  if (!target) throw new Error("expected Module Preview target");
  const preview = compileModulePreviewRoot({
    source: { normalizedSource: source, sourceRevision: 27 },
    semantic: { sourceRevision: 27, compiled },
    target,
    arguments: []
  });
  if (!preview) throw new Error("expected Module Preview root");
  return preview;
};

describe("buildModulePreviewEvaluationOptions", () => {
  it("evaluates Module Preview scalar/default materialization through the shared evaluator", () => {
    const source = [
      "nui 1",
      "module Pocket(width: number = 12) {",
      "  point P = coordinate(x: @width, y: 0)",
      "}",
      "point Outside = coordinate(x: 99, y: 99)"
    ].join("\n");
    const preview = previewFor(source, "point P");
    const evaluation = evaluateElements(
      preview.compileResult.elements,
      buildModulePreviewEvaluationOptions(preview)
    );

    expect(evaluation.errors).toEqual([]);
    const point = preview.compileResult.elements.find((element) =>
      element.name === "P" && preview.targetRuntimeElementIds.includes(element.id)
    );
    expect(point).toBeDefined();
    expect(evaluation.computedGeometry.get(point!.id)).toMatchObject({ kind: "point", x: 12, y: 0 });
    const outside = preview.compileResult.elements.find((element) => element.name === "Outside");
    expect(outside).toBeDefined();
    expect(preview.targetRuntimeElementIds).not.toContain(outside!.id);
  });

  it("carries materialized text templates without a Preview-only evaluator", () => {
    const source = [
      "nui 1",
      "module Labelled(value: number = 4) {",
      "  text L = label(text: \"v=${@value}\", anchor: none, size: 3)",
      "}"
    ].join("\n");
    const preview = previewFor(source, "text L");
    const options = buildModulePreviewEvaluationOptions(preview);

    expect(options.scalarProgram).toBe(preview.moduleScalarRuntime.scalarProgram);
    expect(options.bindingVersions).toBeDefined();
    expect(options.moduleMaterialization).toBe(preview.moduleMaterialization);
    expect(options.textTemplateEntriesByElementId?.size ?? 0).toBeGreaterThan(0);
  });

  it("lowers mixed ordinary source and materialized Preview elements through the Rust input boundary", () => {
    const source = [
      "nui 1",
      "",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 60, y: 0)",
      "",
      "module Marker(origin: point) {",
      "  point P = coordinate(x: @origin.x, y: @origin.y)",
      "}",
      "instance Front = Marker(origin: @A)",
      "",
      "group OutputShape {",
      "  point O0 = coordinate(x: 0, y: 0)",
      "  point O1 = coordinate(x: 30, y: 0)",
      "  line OutLine = segment(start: @O0, end: @O1)",
      "}",
      "",
      "layout TestLayout {",
      "  place @OutputShape(at: (0, 0), angle: 0, mirror: false)",
      "}",
      "svg TestOutput(layout: @TestLayout, margin: 0)",
      "",
      "module PreviewFixture() {",
      "  point P0 = coordinate(x: 0, y: 0)",
      "  point P1 = coordinate(x: 40, y: 0)",
      "  line Edge = segment(start: @P0, end: @P1)",
      "}"
    ].join("\n");
    const preview = previewFor(source, "point P0");
    const statementMap = preview.candidateCompiledDocument.statementMap;
    if (!statementMap) throw new Error("expected candidate statement map");
    const options = buildModulePreviewEvaluationOptions(preview);
    expect(options.statementInfoByElementId).toBe(statementMap.byElementId);
    expect(options.statementIdByStatementIndex).toBe(statementMap.statementIdByStatementIndex);
    const input = buildRustEvaluationInput(preview.compileResult.elements, options);

    const ordinary = preview.compileResult.elements.find((element) => element.name === "A");
    expect(ordinary).toBeDefined();
    const ordinaryStatement = statementMap.byElementId.get(ordinary!.id);
    expect(ordinaryStatement).toBeDefined();
    expect(input.sourceStatementIndices).toContainEqual({
      elementId: ordinary!.id,
      statementIndex: ordinaryStatement!.statementIndex
    });

    const sourceOrderByElementId = new Map(
      input.bindingVersions!.elementSourceOrders.map((entry) => [entry.elementId, entry.sourceOrder])
    );
    expect(sourceOrderByElementId.get(ordinary!.id)).toBeDefined();

    const executionUnitByElementId = new Map(
      input.bindingVersions!.elementSourceExecutionUnits!.map((entry) => [entry.elementId, entry.executionUnit])
    );
    expect(executionUnitByElementId.get(ordinary!.id)).toBe(ordinaryStatement!.statementIndex);

    const materialized = preview.compileResult.elements.find((element) =>
      element.name === "P0" && preview.targetRuntimeElementIds.includes(element.id)
    );
    expect(materialized).toBeDefined();
    const materializedExecutionPosition = preview.moduleMaterialization.sourceExecutionPositionByRuntimeElementId.get(materialized!.id);
    expect(materializedExecutionPosition).toBeDefined();
    expect(options.sourceExecutionPositionByElementId?.get(materialized!.id)).toBe(materializedExecutionPosition);
    expect(executionUnitByElementId.get(materialized!.id)).toBe(materializedExecutionPosition);
    const materializedScalarExecutionPosition = options.scalarExecutionPositionByElementId?.get(materialized!.id);
    expect(sourceOrderByElementId.get(materialized!.id)).toBe(
      materializedScalarExecutionPosition ?? materializedExecutionPosition
    );
  });
});
