import { describe, expect, it } from "vitest";
import { compileFreshCanonicalText } from "../document/canonicalDocument";
import { applyLineSplices } from "../document/textPatch";
import { evaluateElements } from "../geometry/evaluate";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
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

describe("Bake geometry", () => {
  it("creates independent coordinate primitives in source order", () => {
    const current = compile([
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 100, y: 0)",
      "line AB = segment(start: @A, end: @B)"
    ].join("\n"));
    const evaluation = evaluate(current);
    const line = current.doc.document.elements.find((element) => element.name === "AB")!;
    const plan = planBakeGeometry({
      mode: "current",
      elements: current.doc.document.elements,
      evaluation,
      compiled: current.doc,
      selectedElementIds: [line.id],
      emitSkippedComments: true
    });
    expect(plan?.generatedElementIds).toHaveLength(1);
    const patched = applyLineSplices(current.sourceText, plan!.splices);
    expect(patched).toContain("line AB_baked = segment(start: (0, 0), end: (100, 0))");
    expect(patched).toContain("start: (0, 0), end: (100, 0)");
  });

  it("rejects reversed arcs without inserting an approximation", () => {
    const current = compile([
      "nui 4",
      "point C = coordinate(x: 0, y: 0)",
      "arc A = arc(center: @C, radius: 10, start: 0, end: 90)",
      "reverse(target: @A)"
    ].join("\n"));
    const evaluation = evaluate(current);
    const arc = current.doc.document.elements.find((element) => element.name === "A")!;
    const plan = planBakeGeometry({
      mode: "current",
      elements: current.doc.document.elements,
      evaluation,
      compiled: current.doc,
      selectedElementIds: [arc.id],
      emitSkippedComments: true
    });
    expect(plan?.generatedElementIds).toEqual([]);
    expect(applyLineSplices(current.sourceText, plan!.splices)).toContain("// Bake skipped: arc A — unsupported");
  });

  it("bakes a representable positive arc exactly", () => {
    const compiled = compile([
      "nui 4",
      "arc A = arc(center: (0, 0), radius: 12, start: 30, end: 150)"
    ].join("\n"));
    const evaluation = evaluate(compiled);
    const arc = compiled.doc.document.elements.find((element) => element.name === "A")!;
    const plan = planBakeGeometry({
      mode: "current",
      elements: compiled.doc.document.elements,
      evaluation,
      compiled: compiled.doc,
      selectedElementIds: [arc.id]
    });
    expect(applyLineSplices(compiled.sourceText, plan!.splices)).toContain(
      "arc A_baked = arc(center: (0, 0), radius: 12, start: 30, end: 150)"
    );
  });

  it("uses the pre-mutation snapshot for Base and final geometry for Current", () => {
    const compiled = compile([
      "nui 4",
      "line L = segment(start: (0, 0), end: (10, 0))",
      "reverse(target: @L)"
    ].join("\n"));
    const evaluation = evaluate(compiled);
    const line = compiled.doc.document.elements.find((element) => element.name === "L")!;
    const basePlan = planBakeGeometry({
      mode: "base",
      elements: compiled.doc.document.elements,
      evaluation,
      compiled: compiled.doc,
      selectedElementIds: [line.id]
    });
    const currentPlan = planBakeGeometry({
      mode: "current",
      elements: compiled.doc.document.elements,
      evaluation,
      compiled: compiled.doc,
      selectedElementIds: [line.id]
    });
    expect(applyLineSplices(compiled.sourceText, basePlan!.splices)).toContain(
      "line L_baked = segment(start: (0, 0), end: (10, 0))"
    );
    expect(applyLineSplices(compiled.sourceText, currentPlan!.splices)).toContain(
      "line L_baked = segment(start: (10, 0), end: (0, 0))"
    );
  });

  it("decomposes a multi-segment Bezier into independent curves", () => {
    const compiled = compile([
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point M = coordinate(x: 5, y: 5)",
      "point B = coordinate(x: 10, y: 0)",
      "curve C = bezier(start: @A, end: @B, startAngle: 0, startLength: 2, endAngle: 180, endLength: 2, intermediates: [@M:90:1:1])"
    ].join("\n"));
    const evaluation = evaluate(compiled);
    const curve = compiled.doc.document.elements.find((element) => element.name === "C")!;
    const plan = planBakeGeometry({
      mode: "current",
      elements: compiled.doc.document.elements,
      evaluation,
      compiled: compiled.doc,
      selectedElementIds: [curve.id]
    });
    expect(plan?.generatedElementIds).toHaveLength(2);
    const patched = applyLineSplices(compiled.sourceText, plan!.splices);
    expect(patched).toContain("curve C_baked_1 = bezier(");
    expect(patched).toContain("curve C_baked_2 = bezier(");
    expect(patched).toContain("curve C_baked_1 = bezier(start: (0, 0)");
  });

  it("preserves the exact primitive order of an open offset path", () => {
    const compiled = compile([
      "nui 4",
      "line A = segment(start: (0, 0), end: (10, 0))",
      "arc B = arc(center: (10, 5), radius: 5, start: -90, end: 0)",
      "line O = offset(sources: [@A, @B], distance: 1, side: left, closed: false, suppressTrimWarnings: false)"
    ].join("\n"));
    const evaluation = evaluate(compiled);
    const offset = compiled.doc.document.elements.find((element) => element.name === "O")!;
    const offsetGeometry = evaluation.computedGeometry.get(offset.id);
    expect(offsetGeometry?.kind).toBe("offsetLine");
    if (offsetGeometry?.kind !== "offsetLine") throw new Error("expected offset geometry");
    expect(offsetGeometry.segments.length).toBeGreaterThanOrEqual(2);
    const plan = planBakeGeometry({
      mode: "current",
      elements: compiled.doc.document.elements,
      evaluation,
      compiled: compiled.doc,
      selectedElementIds: [offset.id]
    });
    expect(plan?.generatedElementIds.length).toBe(offsetGeometry.segments.length);
    const patched = applyLineSplices(compiled.sourceText, plan!.splices);
    expect(patched.indexOf("line O_baked_1 = ")).toBeLessThan(patched.indexOf("arc O_baked_2 = "));
  });

  it("keeps multiple insertion sites in source order", () => {
    const compiled = compile([
      "nui 4",
      "point A = coordinate(x: 1, y: 2)",
      "text Memo = label(text: \"memo\", anchor: none, size: 3)",
      "point B = coordinate(x: 3, y: 4)"
    ].join("\n"));
    const evaluation = evaluate(compiled);
    const selected = compiled.doc.document.elements.filter((element) => element.name === "A" || element.name === "B");
    const plan = planBakeGeometry({
      mode: "current",
      elements: compiled.doc.document.elements,
      evaluation,
      compiled: compiled.doc,
      selectedElementIds: selected.map((element) => element.id).reverse()
    });
    expect(plan?.splices).toHaveLength(2);
    expect(plan!.splices[0].startLine).toBeLessThan(plan!.splices[1].startLine);
  });

  it("copies modifier references to every generated declaration", () => {
    const compiled = compile([
      "nui 4",
      "modifier Basic {",
      "  state: visible,",
      "}",
      "point A [Basic] = coordinate(x: 1, y: 2)"
    ].join("\n"));
    const evaluation = evaluate(compiled);
    const point = compiled.doc.document.elements.find((element) => element.name === "A")!;
    const plan = planBakeGeometry({
      mode: "current",
      elements: compiled.doc.document.elements,
      evaluation,
      compiled: compiled.doc,
      selectedElementIds: [point.id]
    });
    const patched = applyLineSplices(compiled.sourceText, plan!.splices);
    expect(patched).toContain("point A_baked [Basic] = coordinate(x: 1, y: 2)");
    expect(patched).not.toContain("modifier Basic_baked");
  });

  it("supports hidden geometry but skips disabled geometry", () => {
    const compiled = compile([
      "nui 4",
      "point Hidden = coordinate(x: 1, y: 2, state: hidden)",
      "point Disabled = coordinate(x: 3, y: 4, state: disabled)"
    ].join("\n"));
    const evaluation = evaluate(compiled);
    const hidden = compiled.doc.document.elements.find((element) => element.name === "Hidden")!;
    const disabled = compiled.doc.document.elements.find((element) => element.name === "Disabled")!;
    const plan = planBakeGeometry({
      mode: "current",
      elements: compiled.doc.document.elements,
      evaluation,
      compiled: compiled.doc,
      selectedElementIds: [hidden.id, disabled.id]
    });
    expect(plan?.generatedElementIds).toHaveLength(1);
    expect(plan?.skippedComments).toBe(1);
    const patched = applyLineSplices(compiled.sourceText, plan!.splices);
    expect(patched).toContain("point Hidden_baked = coordinate(x: 1, y: 2, state: hidden)");
    expect(patched).toContain("// Bake skipped: point Disabled — unsupported");
  });

  it("can succeed with skipped comments only, and leaves source unchanged when disabled", () => {
    const compiled = compile([
      "nui 4",
      "text Memo = label(text: \"Memo\", anchor: none, size: 3)"
    ].join("\n"));
    const evaluation = evaluate(compiled);
    const memo = compiled.doc.document.elements.find((element) => element.name === "Memo")!;
    const withComment = planBakeGeometry({
      mode: "current",
      elements: compiled.doc.document.elements,
      evaluation,
      compiled: compiled.doc,
      selectedElementIds: [memo.id],
      emitSkippedComments: true
    });
    const withoutComment = planBakeGeometry({
      mode: "current",
      elements: compiled.doc.document.elements,
      evaluation,
      compiled: compiled.doc,
      selectedElementIds: [memo.id],
      emitSkippedComments: false
    });
    expect(withComment?.generatedElementIds).toEqual([]);
    expect(applyLineSplices(compiled.sourceText, withComment!.splices)).toContain(
      "// Bake skipped: text Memo — unsupported"
    );
    expect(withoutComment?.splices).toEqual([]);
  });

  it("bakes every materialized module descendant while keeping module definitions untouched", () => {
    const compiled = compile([
      "nui 4",
      "module M() {",
      "  point P = coordinate(x: 1, y: 2)",
      "  export line L = segment(start: (0, 0), end: (3, 0))",
      "  text Memo = label(text: \"memo\", anchor: none, size: 3)",
      "}",
      "instance Call = M()"
    ].join("\n"));
    const evaluation = evaluate(compiled);
    const instance = compiled.doc.document.elements.find((element) => element.name === "Call")!;
    const plan = planBakeGeometry({
      mode: "current",
      elements: compiled.doc.document.elements,
      evaluation,
      compiled: compiled.doc,
      selectedElementIds: [instance.id]
    });
    expect(plan?.generatedElementIds).toHaveLength(2);
    expect(plan?.skippedComments).toBe(1);
    const patched = applyLineSplices(compiled.sourceText, plan!.splices);
    expect(patched).toContain("point P_baked = coordinate(x: 1, y: 2)");
    expect(patched).toContain("line L_baked = segment(start: (0, 0), end: (3, 0))");
    expect(patched).toContain("// Bake skipped: text Memo — unsupported");
    expect(patched).not.toContain("module M() {\n  point P_baked");
    expect(plan!.splices).toHaveLength(1);
  });

  it("uses the instance Base boundary before caller-side mutations", () => {
    const compiled = compile([
      "nui 4",
      "module M() {",
      "  export line L = segment(start: (0, 0), end: (10, 0))",
      "}",
      "instance Call = M()",
      "reverse(target: @Call::L)"
    ].join("\n"));
    const evaluation = evaluate(compiled);
    const instance = compiled.doc.document.elements.find((element) => element.name === "Call")!;
    const basePlan = planBakeGeometry({
      mode: "base",
      elements: compiled.doc.document.elements,
      evaluation,
      compiled: compiled.doc,
      selectedElementIds: [instance.id]
    });
    const currentPlan = planBakeGeometry({
      mode: "current",
      elements: compiled.doc.document.elements,
      evaluation,
      compiled: compiled.doc,
      selectedElementIds: [instance.id]
    });
    expect(applyLineSplices(compiled.sourceText, basePlan!.splices)).toContain(
      "line L_baked = segment(start: (0, 0), end: (10, 0))"
    );
    expect(applyLineSplices(compiled.sourceText, currentPlan!.splices)).toContain(
      "line L_baked = segment(start: (10, 0), end: (0, 0))"
    );
  });
});
