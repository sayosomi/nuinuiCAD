import { describe, expect, it } from "vitest";
import { compileFreshCanonicalText } from "../document/canonicalDocument";
import { constructionFor } from "../dsl/dslConstructions";
import { documentDslRefs } from "../dsl/dslSerializer";
import { serializeElementStatementLogical } from "../dsl/dslSerializeElement";
import type { ArcLineElement, EvaluationResult } from "../types/geometry";
import { evaluateElements } from "./evaluate";
import { geometryHoverPresentation } from "./geometryHoverPresentation";
import { buildEvaluationOptions } from "./productionEvaluationContext";

const compile = (source: string) => {
  const result = compileFreshCanonicalText(source);
  if (result.status === "fatal") throw new Error(result.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
  return result.doc;
};

const evaluate = (compiled: ReturnType<typeof compile>): EvaluationResult => evaluateElements(
  compiled.document.elements,
  buildEvaluationOptions({ compiledDocument: compiled, evaluationLimitIndex: undefined })
);

const arcByName = (compiled: ReturnType<typeof compile>, name: string): ArcLineElement => {
  const element = compiled.document.elements.find((candidate) => candidate.name === name);
  if (!element || element.type !== "arcLine") throw new Error(`expected arc ${name}`);
  return element;
};

const computedArc = (evaluation: EvaluationResult, id: string) => {
  const geometry = evaluation.computedGeometry.get(id);
  if (!geometry || geometry.kind !== "arcLine") throw new Error("expected computed arc");
  return geometry;
};

const hoverDirection = (evaluation: EvaluationResult, arc: ArcLineElement) => {
  const presentation = geometryHoverPresentation(arc, evaluation);
  if (presentation.availability.kind !== "geometry") throw new Error("expected geometry Hover rows");
  return presentation.availability.rows.find((row) => row.kind === "value" && row.label === "進行方向");
};

describe("nui1 concrete arc direction", () => {
  it("defaults omitted direction to counterclockwise and serializes it explicitly", () => {
    const compiled = compile("nui 1\narc A = arc(center: (0, 0), radius: 40, start: 15, end: 155)");
    const arc = arcByName(compiled, "A");
    const evaluation = evaluate(compiled);

    expect(arc.direction).toBe("counterclockwise");
    expect(serializeElementStatementLogical(arc, documentDslRefs(compiled.document.elements))).toBe(
      "arc A = arc(center: (0, 0), radius: 40, start: 15, end: 155, direction: counterclockwise)"
    );
    expect(computedArc(evaluation, arc.id)).toMatchObject({ sweepAngleDeg: 140 });
    expect(hoverDirection(evaluation, arc)).toMatchObject({ value: "反時計回り" });
  });

  it("evaluates clockwise as the negative complementary sweep with positive length", () => {
    const compiled = compile("nui 1\narc A = arc(center: (0, 0), radius: 40, start: 15, end: 155, direction: clockwise)");
    const arc = arcByName(compiled, "A");
    const evaluation = evaluate(compiled);
    const geometry = computedArc(evaluation, arc.id);

    expect(geometry.sweepAngleDeg).toBe(-220);
    expect(geometry.length).toBeGreaterThan(0);
    expect(hoverDirection(evaluation, arc)).toMatchObject({ value: "時計回り" });
  });

  it("uses the existing typed choice binding path", () => {
    const compiled = compile([
      "nui 1",
      "const 向き: choice(counterclockwise, clockwise) = clockwise",
      "arc A = arc(center: (0, 0), radius: 40, start: 15, end: 155, direction: @向き)"
    ].join("\n"));
    const arc = arcByName(compiled, "A");
    expect(computedArc(evaluate(compiled), arc.id).sweepAngleDeg).toBe(-220);
  });

  it("compiles and evaluates direction as a public choice geometry property", () => {
    const compiled = compile([
      "nui 1",
      "arc A = arc(center: (0, 0), radius: 40, start: 15, end: 155, direction: clockwise)",
      "const direction: choice(counterclockwise, clockwise) = @A.direction"
    ].join("\n"));
    const binding = compiled.bindingAnalysis?.catalog.bindings.find((candidate) => candidate.kind === "typed" && candidate.name === "direction");
    expect(binding).toBeDefined();
    expect(evaluate(compiled).computedScalarBindings?.get(binding!.id)).toEqual({
      status: "ok",
      type: { kind: "choice", options: ["counterclockwise", "clockwise"] },
      value: { kind: "choice", options: ["counterclockwise", "clockwise"], value: "clockwise" }
    });
  });

  it("keeps equal angles at canonical zero and Hover reports no direction", () => {
    const compiled = compile("nui 1\narc A = arc(center: (0, 0), radius: 40, start: 0, end: 0, direction: clockwise)");
    const arc = arcByName(compiled, "A");
    const evaluation = evaluate(compiled);
    const geometry = computedArc(evaluation, arc.id);

    expect(geometry.sweepAngleDeg).toBe(0);
    expect(Object.is(geometry.sweepAngleDeg, -0)).toBe(false);
    expect(hoverDirection(evaluation, arc)).toMatchObject({ value: "なし" });
  });

  it("preserves explicit whole turns with the requested sign", () => {
    const clockwise = compile("nui 1\narc A = arc(center: (0, 0), radius: 40, start: 0, end: 360, direction: clockwise)");
    const counterclockwise = compile("nui 1\narc A = arc(center: (0, 0), radius: 40, start: 0, end: 360, direction: counterclockwise)");
    const cwArc = arcByName(clockwise, "A");
    const ccwArc = arcByName(counterclockwise, "A");

    expect(computedArc(evaluate(clockwise), cwArc.id).sweepAngleDeg).toBe(-360);
    expect(computedArc(evaluate(counterclockwise), ccwArc.id).sweepAngleDeg).toBe(360);
  });

  it.each([0, -10])("rejects a direct arc with a non-positive radius and makes runtime properties unavailable", (radius) => {
    const compiled = compile([
      "nui 1",
      `arc A = arc(center: (0, 0), radius: ${radius}, start: 0, end: 90)`,
      "const radiusValue: number = @A.radius",
      "const lengthValue: number = @A.length",
      "const startX: number = @A.startPoint.x",
      "const centerX: number = @A.centerPoint.x"
    ].join("\n"));
    const arc = arcByName(compiled, "A");
    const evaluation = evaluate(compiled);

    expect(evaluation.computedGeometry.has(arc.id)).toBe(false);
    expect(evaluation.errors).toEqual([
      expect.objectContaining({
        elementId: arc.id,
        missingDependencyId: arc.id,
        message: "A の半径は0より大きい値で指定してください。"
      })
    ]);

    for (const name of ["radiusValue", "lengthValue", "startX", "centerX"]) {
      const binding = compiled.bindingAnalysis?.catalog.bindings.find(
        (candidate) => candidate.kind === "typed" && candidate.name === name
      );
      expect(binding, `missing binding ${name}`).toBeDefined();
      expect(evaluation.computedScalarBindings?.get(binding!.id)).toMatchObject({
        status: "error",
        issueCode: "evaluation-geometry-property-unavailable"
      });
    }
  });

  it("keeps direction exclusive to concrete arc(...) construction", () => {
    expect(constructionFor("arc", "arc")?.args.map((arg) => arg.arg)).toContain("direction");
    expect(constructionFor("arc", "through")?.args.map((arg) => arg.arg)).not.toContain("direction");
    expect(constructionFor("arc", "corner")?.args.map((arg) => arg.arg)).not.toContain("direction");
  });
});
