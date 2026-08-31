import { describe, expect, it } from "vitest";
import { evaluateElements } from "../geometry/evaluate";
import { compileDslDocument, type CompiledDslDocument } from "../dsl/dslDocument";
import { parseDslSnapshot } from "../dsl/dslParser";
import { compileModulePreviewRoot } from "../dsl/modulePreviewRoot";
import { queryModulePreviewTarget } from "../dsl/modulePreviewTarget";
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
});