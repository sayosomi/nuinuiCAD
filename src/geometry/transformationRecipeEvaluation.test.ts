import { describe, expect, it } from "vitest";
import { compileDslToElements } from "../../packages/nui-language/src/dsl/dslCompiler";
import { transformationStageKey } from "../../packages/nui-language/src/dsl/transformationRecipes";
import type { ComputedGeometry, ComputedLine } from "../types/geometry";
import { evaluateElements } from "./evaluate";

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

describe("transformation recipe evaluation", () => {
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
});
