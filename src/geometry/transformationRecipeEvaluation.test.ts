import { describe, expect, it } from "vitest";
import { compileDslDocument, compileDslToElements, parseDslSnapshot } from "@nuinuicad/nui-language";
import { emptyDocument } from "@nuinuicad/nui-language";
import { compileCanonicalText, regenerateCanonicalFromModel } from "@nuinuicad/nui-language/document";
import { transformationStageKey } from "@nuinuicad/nui-language";
import type { ComputedGeometry, ComputedLine } from "../types/geometry";
import { evaluateElements } from "./evaluate";
import { buildEvaluationOptions } from "./productionEvaluationContext";

const compileAndEvaluate = (source: string) => {
  const compiled = compileDslToElements(source, { elements: [], mode: "document" });
  const statementInfoByElementId = new Map(
    [...(compiled.elementIdsByStatementIndex ?? new Map())].map(([statementIndex, elementId]) => [elementId, { statementIndex }])
  );
  return {
    compiled,
    evaluation: evaluateElements(compiled.elements, {
      transformationRecipes: compiled.transformationRecipes,
      statementInfoByElementId
    })
  };
};

const lineOf = (geometry: ComputedGeometry | undefined): ComputedLine => {
  if (!geometry || !("start" in geometry) || !("end" in geometry)) throw new Error("expected line-like geometry");
  return geometry as ComputedLine;
};

const compileCanonicalAndEvaluate = (source: string) => {
  const baseline = regenerateCanonicalFromModel(emptyDocument(), 1);
  const result = compileCanonicalText(baseline, source);
  if (result.status === "fatal") throw new Error(JSON.stringify(result.diagnostics));
  const compiled = result.doc;
  return {
    compiled,
    evaluation: evaluateElements(
      compiled.document.elements,
      buildEvaluationOptions({ compiledDocument: compiled, evaluationLimitIndex: undefined })
    )
  };
};

const scalarByName = (compiled: ReturnType<typeof compileCanonicalAndEvaluate>["compiled"], name: string) => {
  const binding = compiled.bindingAnalysis?.catalog.bindings.find((candidate) => candidate.name === name);
  if (!binding) throw new Error(`missing scalar binding ${name}`);
  return binding.id;
};

describe("transformation recipe evaluation", () => {
  it("waits for forward recipe arguments and keeps base reads non-cyclic", () => {
    const { compiled, evaluation } = compileAndEvaluate([
      "line A = segment(start: (0, 0), end: (1, 0))",
      "move A (from: @B.start, to: (10, 0))",
      "line B = segment(start: (5, 0), end: (6, 0))"
    ].join("\n"));
    expect(evaluation.errors).toEqual([]);
    expect(lineOf(evaluation.computedGeometry.get(compiled.elements[0]!.id)).start.x).toBe(5);

    const baseRead = compileDslDocument([
      "nui 1",
      "line A = segment(start: (0, 0), end: (1, 0))",
      "move A (from: @A.base.start, to: (2, 0))"
    ].join("\n"));
    expect(baseRead.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(baseRead.typedDependencyGraph?.transformationPlans[0]?.argumentDependencies[0]?.stagePath).toEqual(["base"]);
  });

  it("keeps recipe/stage dependencies in the canonical graph and diagnoses final self reads", () => {
    const valid = compileDslDocument([
      "nui 1",
      "line A = segment(start: (0, 0), end: (1, 0))",
      "move A as moved (from: (0, 0), to: (1, 0))",
      "reverse A ()",
      "move A (from: @A.moved.start, to: (2, 0))"
    ].join("\n"));
    const plans = valid.typedDependencyGraph?.transformationPlans ?? [];
    expect(plans).toHaveLength(3);
    expect(plans[2]?.predecessorRecipeIndices).toEqual([0, 1]);
    expect(plans[2]?.argumentDependencies[0]?.stagePath).toEqual(["moved"]);
    expect(valid.typedDependencyGraph?.edges.some((edge) => edge.from.kind === "transformation-recipe" && edge.to.kind === "geometry-stage")).toBe(true);

    const cycle = compileDslDocument([
      "nui 1",
      "line A = segment(start: (0, 0), end: (1, 0))",
      "move A (from: @A.start, to: (2, 0))"
    ].join("\n"));
    expect(cycle.diagnostics.map((diagnostic) => diagnostic.code)).toContain("dependency-cycle");
  });

  it("materializes canonical scalar references in transformation arguments", () => {
    const { compiled, evaluation } = compileCanonicalAndEvaluate([
      "nui 1",
      "const dx: number = 3",
      "line L = segment(start: (0, 0), end: (20, 0))",
      "move L (from: (0, 0), to: (@dx, 10))"
    ].join("\n"));
    const recipe = compiled.runtimeTransformationRecipes?.find((candidate) => candidate.construction === "move");
    const bindingId = scalarByName(compiled, "dx");
    const scalarInput = compiled.transformationNumericBindings?.find((candidate) =>
      candidate.recipeId === recipe?.id && candidate.parameterPath === "endPoint.x"
    );
    const plan = compiled.typedDependencyGraph?.transformationPlans.find((candidate) => candidate.recipeId === recipe?.id);
    const line = compiled.document.elements.find((element) => element.name === "L")!;

    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(scalarInput?.binding.references.map((reference) => reference.bindingId)).toEqual([bindingId]);
    expect(plan?.scalarPrerequisites).toContain(bindingId);
    expect(plan?.argumentDependencies).toEqual([]);
    expect(compiled.typedDependencyGraph?.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "numeric-expression",
        from: expect.objectContaining({ kind: "transformation-recipe" }),
        to: expect.objectContaining({ kind: "binding", id: bindingId })
      })
    ]));
    expect(evaluation.errors).toEqual([]);
    expect(lineOf(evaluation.computedGeometry.get(line.id))).toMatchObject({
      start: { x: 3, y: 10 },
      end: { x: 23, y: 10 }
    });
  });

  it("uses scalar scale arguments, preserves literals, and matches point anchors", () => {
    const direct = compileCanonicalAndEvaluate([
      "nui 1",
      "const factor: number = 2",
      "const dx: number = 3",
      "line Direct = segment(start: (0, 0), end: (2, 0))",
      "move Direct (from: (0, 0), to: (3, 0), scale: @factor)",
      "line Anchored = segment(start: (0, 0), end: (20, 0))",
      "point Anchor = coordinate(x: @dx, y: 10)",
      "move Anchored (from: (0, 0), to: @Anchor)",
      "line Literal = segment(start: (0, 0), end: (2, 0))",
      "move Literal (from: (0, 0), to: (3, 0), scale: 2)"
    ].join("\n"));
    const geometryFor = (name: string) => {
      const element = direct.compiled.document.elements.find((candidate) => candidate.name === name)!;
      return lineOf(direct.evaluation.computedGeometry.get(element.id));
    };

    expect(direct.compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(direct.evaluation.errors).toEqual([]);
    expect(geometryFor("Direct")).toMatchObject({ start: { x: 3, y: 0 }, end: { x: 7, y: 0 } });
    expect(geometryFor("Anchored")).toMatchObject({ start: { x: 3, y: 10 }, end: { x: 23, y: 10 } });
    expect(geometryFor("Literal")).toMatchObject({ start: { x: 3, y: 0 }, end: { x: 7, y: 0 } });
  });

  it("keeps unresolved transformation scalar references on the compiler diagnostic path", () => {
    const source = [
      "nui 1",
      "const available: number = 1",
      "line L = segment(start: (0, 0), end: (20, 0))",
      "move L (from: (0, 0), to: (@missing, 10))"
    ].join("\n");
    const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: 0 });
    const missing = compileDslDocument(source, {
      preparsed: parsed,
      assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `missing-scalar:${index}`]))
    });
    expect(missing.diagnostics.some((diagnostic) =>
      diagnostic.severity === "error" && diagnostic.code === "numeric-binding-unresolved"
    )).toBe(true);
    expect(missing.transformationNumericBindings ?? []).toEqual([]);
  });

  it("reads final, base, and named immutable stages through the compiled scalar geometry IR", () => {
    const { compiled, evaluation } = compileCanonicalAndEvaluate([
      "nui 1",
      "line A = segment(start: (0, 0), end: (10, 0))",
      "move A as moved (from: (0, 0), to: (10, 0))",
      "move A (from: (0, 0), to: (20, 0))",
      "line StageStart = segment(start: @A.moved.start, end: (20, 0))",
      "line MovedOffset = offset(sources: [@A.moved], distance: 1, side: left, closed: false, suppressTrimWarnings: false)",
      "const finalLength: number = @A.length",
      "const explicitFinalLength: number = @A.final.length",
      "const baseLength: number = @A.base.length",
      "const movedLength: number = @A.moved.length"
    ].join("\n"));
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(evaluation.errors).toEqual([]);
    expect(evaluation.computedScalarBindings?.get(scalarByName(compiled, "finalLength"))).toMatchObject({ status: "ok", value: { value: 10 } });
    expect(evaluation.computedScalarBindings?.get(scalarByName(compiled, "explicitFinalLength"))).toMatchObject({ status: "ok", value: { value: 10 } });
    expect(evaluation.computedScalarBindings?.get(scalarByName(compiled, "baseLength"))).toMatchObject({ status: "ok", value: { value: 10 } });
    expect(evaluation.computedScalarBindings?.get(scalarByName(compiled, "movedLength"))).toMatchObject({ status: "ok", value: { value: 10 } });
    expect((evaluation.computedGeometry.get(compiled.document.elements.find((element) => element.name === "StageStart")!.id) as ComputedLine).start.x).toBe(10);
    const aId = compiled.document.elements.find((element) => element.name === "A")!.id;
    const movedOffset = compiled.document.elements.find((element) => element.name === "MovedOffset")!;
    const movedOffsetTargets = compiled.geometryInputTargetsByElementId?.get(movedOffset.id);
    expect([...((movedOffsetTargets?.values() ?? []) as Iterable<unknown>)].flatMap((target) => Array.isArray(target) ? target : [target]))
      .toEqual(expect.arrayContaining([expect.objectContaining({ stagePath: ["moved"] })]));
    expect(lineOf(evaluation.computedGeometry.get(movedOffset.id)).start.x).toBe(10);
    expect(evaluation.transformationStageGeometry?.get(transformationStageKey(aId, undefined, ["moved"]))).toBeDefined();
  });

  it("publishes a named root recipe through final and delays final consumers", () => {
    const { compiled, evaluation } = compileCanonicalAndEvaluate([
      "nui 1",
      "line A = segment(start: (0, 0), end: (10, 0))",
      "line Consumer = segment(start: @A.start, end: (30, 0))",
      "move A as moved (from: (0, 0), to: (10, 0))"
    ].join("\n"));
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(evaluation.errors).toEqual([]);

    const owner = compiled.document.elements.find((element) => element.name === "A")!;
    const consumer = compiled.document.elements.find((element) => element.name === "Consumer")!;
    expect(lineOf(evaluation.computedGeometry.get(owner.id))).toMatchObject({
      start: { x: 10, y: 0 },
      end: { x: 20, y: 0 }
    });
    expect(lineOf(evaluation.computedGeometry.get(consumer.id)).start).toMatchObject({ x: 10, y: 0 });
  });

  it("evaluates a selected lazy forward geometry dependency after its target is scheduled", () => {
    const { compiled, evaluation } = compileCanonicalAndEvaluate([
      "nui 1",
      "const chooseLater: boolean = true",
      "const selectedLength: number = if (@chooseLater) { @Later.length } else { 0 }",
      "line Later = segment(start: (0, 0), end: (10, 0))"
    ].join("\n"));
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(evaluation.errors).toEqual([]);
    expect(evaluation.computedScalarBindings?.get(scalarByName(compiled, "selectedLength"))).toMatchObject({
      status: "ok",
      value: { value: 10 }
    });
  });

  it("bypasses disabled clauses and keeps immutable checkpoints plus branch finals", () => {
    const { compiled, evaluation } = compileAndEvaluate([
      "line A = segment(start: (0, 0), end: (10, 0))",
      "move A as moved (from: (0, 0), to: (10, 0))",
      "reverse A ()",
      "move A.moved as branch (from: (0, 0), to: (100, 0), enabled: false)"
    ].join("\n"));
    expect(evaluation.errors).toEqual([]);
    const ownerId = compiled.elements[0]!.id;
    const moved = evaluation.transformationStageGeometry!.get(transformationStageKey(ownerId, undefined, ["moved"]));
    const branch = evaluation.transformationStageGeometry!.get(transformationStageKey(ownerId, undefined, ["moved", "branch", "final"]));
    const movedLine = lineOf(moved);
    const branchLine = lineOf(branch);
    const finalLine = lineOf(evaluation.computedGeometry.get(ownerId));
    expect(movedLine.start.x).toBe(10);
    expect(movedLine.end.x).toBe(20);
    expect(branchLine.start.x).toBe(10);
    expect(branchLine.end.x).toBe(20);
    expect(finalLine.start.x).toBe(20);
    expect(finalLine.end.x).toBe(10);
  });

  it("applies bulk and indexed generated targets with authored order", () => {
    const { compiled, evaluation } = compileAndEvaluate([
      "for i in range(min: 0, max: 2, step: 1) {",
      "  line Mark = segment(start: (0, 0), end: (10, 0))",
      "  move Mark (from: (0, 0), to: (1, 0))",
      "  reverse Mark[2] ()",
      "}"
    ].join("\n"));
    expect(evaluation.errors).toEqual([]);
    const rows = evaluation.forGroupGeneratedRows!.filter((row) => row.templateElementId === compiled.elements[1]!.id);
    expect(rows).toHaveLength(3);
    const geometries = rows.map((row) => evaluation.computedGeometry.get(row.generatedElementId)!);
    expect(geometries.slice(0, 2).every((geometry) => lineOf(geometry).start.x === 1 && lineOf(geometry).end.x === 11)).toBe(true);
    expect(lineOf(geometries[2]).start.x).toBe(11);
    expect(lineOf(geometries[2]).end.x).toBe(1);
  });

  it("keeps empty stage finals and evaluates base branches plus coupled edge targets", () => {
    const { compiled, evaluation } = compileAndEvaluate([
      "line A = segment(start: (0, 0), end: (100, 0))",
      "line B = segment(start: (50, -50), end: (50, 50))",
      "move A as moved (from: (0, 0), to: (10, 0))",
      "reverse A.base ()",
      "edge [A.moved.end, B.start] as joined (index: 0)"
    ].join("\n"));
    expect(evaluation.errors).toEqual([]);
    const aId = compiled.elements.find((element) => element.name === "A")!.id;
    const bId = compiled.elements.find((element) => element.name === "B")!.id;
    const moved = evaluation.transformationStageGeometry!.get(transformationStageKey(aId, undefined, ["moved"]));
    const movedFinal = evaluation.transformationStageGeometry!.get(transformationStageKey(aId, undefined, ["moved", "final"]));
    const baseFinal = evaluation.transformationStageGeometry!.get(transformationStageKey(aId, undefined, ["base", "final"]));
    expect(movedFinal).toEqual(moved);
    expect(lineOf(baseFinal).start.x).toBe(100);
    expect(lineOf(baseFinal).end.x).toBe(0);
    expect(lineOf(evaluation.transformationStageGeometry!.get(
      transformationStageKey(aId, undefined, ["moved", "joined"])
    )).end.x).toBe(50);
    expect(lineOf(evaluation.transformationStageGeometry!.get(
      transformationStageKey(bId, undefined, ["joined"])
    )).start.x).toBe(50);
    expect(lineOf(evaluation.transformationStageGeometry!.get(
      transformationStageKey(bId, undefined, ["joined"])
    )).start.y).toBe(0);
  });

  it("orders a later recipe after a coupled recipe for a non-first target", () => {
    const source = [
      "nui 1",
      "line A = segment(start: (0, 0), end: (100, 0))",
      "line B = segment(start: (50, -50), end: (50, 50))",
      "edge [A.end, B.start] as joined (index: 0)",
      "reverse B ()"
    ].join("\n");
    const compiledDocument = compileDslDocument(source);
    expect(compiledDocument.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(compiledDocument.typedDependencyGraph?.transformationPlans[1]?.predecessorRecipeIndices).toContain(0);

    const { compiled, evaluation } = compileAndEvaluate(source.replace(/^nui 1\n/, ""));
    expect(evaluation.errors).toEqual([]);
    const bId = compiled.elements.find((element) => element.name === "B")!.id;
    expect(lineOf(evaluation.computedGeometry.get(bId))).toMatchObject({
      start: { x: 50, y: 50 },
      end: { x: 50, y: 0 }
    });
  });
});
