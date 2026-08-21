import { describe, expect, it } from "vitest";
import { compileFreshCanonicalText } from "../document/canonicalDocument";
import { applyLineSplices } from "../document/textPatch";
import { evaluateElements } from "../geometry/evaluate";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import type { ComputedGeometry, EvaluationResult } from "../types/geometry";
import { planBakeGeometry } from "./bakeGeometry";

const compile = (source: string) => {
  const result = compileFreshCanonicalText(source);
  if (result.status === "fatal") throw new Error(result.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
  return result;
};

const evaluate = (compiled: ReturnType<typeof compile>) => evaluateElements(
  compiled.doc.document.elements,
  buildEvaluationOptions({
    compiledDocument: compiled.doc,
    evaluationLimitIndex: undefined
  })
);

const planFor = (
  compiled: ReturnType<typeof compile>,
  evaluation: EvaluationResult,
  selectedElementIds: readonly string[],
  emitSkippedComments = true
) => planBakeGeometry({
  mode: "current",
  elements: compiled.doc.document.elements,
  evaluation,
  compiled: compiled.doc,
  selectedElementIds,
  emitSkippedComments
});

describe("Bake structured failure results", () => {
  it("classifies unsupported text and image geometry kinds", () => {
    const compiled = compile([
      "nui 4",
      "text Memo = label(text: \"memo\", anchor: none, size: 3)"
    ].join("\n"));
    const memo = compiled.doc.document.elements.find((element) => element.name === "Memo")!;
    const evaluation = evaluate(compiled);

    const textPlan = planFor(compiled, evaluation, [memo.id]);
    expect(textPlan?.successfulTargetCount).toBe(0);
    expect(textPlan?.skippedTargets).toEqual([
      expect.objectContaining({
        targetId: memo.id,
        sourceElementId: memo.id,
        sourceLabel: "text Memo",
        reason: { code: "unsupported-geometry-kind", geometryKind: "text" }
      })
    ]);
    expect(textPlan?.skippedTargetCount).toBe(textPlan?.skippedTargets.length);
    expect(applyLineSplices(compiled.sourceText, textPlan!.splices)).toContain(
      "// Bake skipped: text Memo — unsupported geometry kind"
    );

    const imageGeometry: ComputedGeometry = {
      kind: "image",
      elementId: memo.id,
      name: "Memo",
      sourcePath: "fixture.png",
      origin: { kind: "point", elementId: memo.id, name: "Memo", x: 0, y: 0 },
      naturalWidthPx: 100,
      naturalHeightPx: 50,
      sourceDpi: 100,
      targetPixelsPerMm: 4,
      scale: 1,
      angleDeg: 0,
      mirrorX: false,
      widthMm: 25,
      heightMm: 12.5
    };
    const imageEvaluation: EvaluationResult = {
      ...evaluation,
      computedGeometry: new Map(evaluation.computedGeometry).set(memo.id, imageGeometry)
    };
    const imagePlan = planFor(compiled, imageEvaluation, [memo.id], false);
    expect(imagePlan?.skippedTargets[0]?.reason).toEqual({
      code: "unsupported-geometry-kind",
      geometryKind: "image"
    });
    expect(imagePlan?.splices).toEqual([]);
  });

  it("classifies evaluation failure before unevaluated or missing geometry", () => {
    const compiled = compile([
      "nui 4",
      "line L = segment(start: (0, 0), end: (10, 0))"
    ].join("\n"));
    const line = compiled.doc.document.elements.find((element) => element.name === "L")!;
    const evaluation = evaluate(compiled);
    const diagnostic = {
      elementId: line.id,
      elementName: line.name,
      missingDependencyId: line.id,
      message: "synthetic failure"
    };
    const failedEvaluation: EvaluationResult = {
      ...evaluation,
      errors: [diagnostic],
      evaluatedElementIds: new Set(),
      computedGeometry: new Map()
    };

    const plan = planFor(compiled, failedEvaluation, [line.id], false);
    expect(plan?.skippedTargets).toEqual([
      expect.objectContaining({
        targetId: line.id,
        reason: { code: "evaluation-failed", diagnostics: [diagnostic] }
      })
    ]);
  });

  it("distinguishes unevaluated from geometry unavailable", () => {
    const compiled = compile([
      "nui 4",
      "line L = segment(start: (0, 0), end: (10, 0))"
    ].join("\n"));
    const line = compiled.doc.document.elements.find((element) => element.name === "L")!;
    const evaluation = evaluate(compiled);

    const unevaluated: EvaluationResult = {
      ...evaluation,
      evaluatedElementIds: new Set(
        [...(evaluation.evaluatedElementIds ?? [])].filter((id) => id !== line.id)
      )
    };
    expect(planFor(compiled, unevaluated, [line.id], false)?.skippedTargets[0]?.reason).toEqual({
      code: "unevaluated"
    });

    const missingGeometry: EvaluationResult = {
      ...evaluation,
      computedGeometry: new Map(
        [...evaluation.computedGeometry].filter(([id]) => id !== line.id)
      )
    };
    expect(planFor(compiled, missingGeometry, [line.id], false)?.skippedTargets[0]?.reason).toEqual({
      code: "geometry-unavailable"
    });
  });

  it("classifies exactness failures separately from unsupported geometry", () => {
    const compiled = compile([
      "nui 4",
      "point C = coordinate(x: 0, y: 0)",
      "arc A = arc(center: @C, radius: 10, start: 0, end: 90)",
      "reverse(target: @A)"
    ].join("\n"));
    const arc = compiled.doc.document.elements.find((element) => element.name === "A")!;
    const plan = planFor(compiled, evaluate(compiled), [arc.id]);

    expect(plan?.skippedTargets[0]?.reason).toMatchObject({
      code: "not-losslessly-representable",
      geometryKind: "arcLine"
    });
    expect(applyLineSplices(compiled.sourceText, plan!.splices)).toContain(
      "// Bake skipped: arc A — not losslessly representable"
    );
  });

  it("keeps structured failures when skipped source comments are disabled", () => {
    const compiled = compile([
      "nui 4",
      "text Memo = label(text: \"memo\", anchor: none, size: 3)"
    ].join("\n"));
    const memo = compiled.doc.document.elements.find((element) => element.name === "Memo")!;
    const plan = planFor(compiled, evaluate(compiled), [memo.id], false);

    expect(plan?.splices).toEqual([]);
    expect(plan?.skippedComments).toBe(0);
    expect(plan?.skippedTargets).toHaveLength(1);
    expect(plan?.skippedTargets[0].reason.code).toBe("unsupported-geometry-kind");
  });

  it("counts successful targets instead of generated primitives and preserves source-order failures", () => {
    const compiled = compile([
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point M = coordinate(x: 5, y: 5)",
      "point B = coordinate(x: 10, y: 0)",
      "curve C = bezier(start: @A, end: @B, startAngle: 0, startLength: 2, endAngle: 180, endLength: 2, intermediates: [@M:90:1:1])",
      "text First = label(text: \"first\", anchor: none, size: 3)",
      "text Second = label(text: \"second\", anchor: none, size: 3)"
    ].join("\n"));
    const curve = compiled.doc.document.elements.find((element) => element.name === "C")!;
    const first = compiled.doc.document.elements.find((element) => element.name === "First")!;
    const second = compiled.doc.document.elements.find((element) => element.name === "Second")!;
    const plan = planFor(compiled, evaluate(compiled), [second.id, curve.id, first.id], false);

    expect(plan?.generatedElementIds).toHaveLength(2);
    expect(plan?.successfulTargetCount).toBe(1);
    expect(plan?.skippedTargets.map((target) => target.targetId)).toEqual([first.id, second.id]);
    expect(plan?.skippedTargetCount).toBe(2);
  });

  it("does not report intentional hidden or disabled filtering as failures", () => {
    const compiled = compile([
      "nui 4",
      "point Hidden = coordinate(x: 1, y: 2, state: hidden)",
      "point Disabled = coordinate(x: 3, y: 4, state: disabled)"
    ].join("\n"));
    const hidden = compiled.doc.document.elements.find((element) => element.name === "Hidden")!;
    const disabled = compiled.doc.document.elements.find((element) => element.name === "Disabled")!;
    const plan = planFor(compiled, evaluate(compiled), [disabled.id, hidden.id], false);

    expect(plan?.successfulTargetCount).toBe(0);
    expect(plan?.skippedTargets).toEqual([]);
    expect(plan?.skippedTargetCount).toBe(0);
    expect(plan?.splices).toEqual([]);
  });
});
