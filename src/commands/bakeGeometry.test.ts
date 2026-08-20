import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { compileFreshCanonicalText } from "../document/canonicalDocument";
import { applyLineSplices } from "../document/textPatch";
import { evaluateElements } from "../geometry/evaluate";
import { evaluationPayloadToResult, type EvaluationPayload } from "../geometry/evaluationPayload";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import { buildRustEvaluationInput } from "../geometry/rustEvaluationInput";
import { planBakeGeometry, resolveDisabledBakeTargetIds, resolveSourceBakeTargets } from "./bakeGeometry";

const compile = (source: string) => {
  const result = compileFreshCanonicalText(source);
  if (result.status === "fatal") throw new Error(result.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
  return result;
};

const evaluate = (
  compiled: ReturnType<typeof compile>,
  allowDisabledElementIds: readonly string[] = []
) => evaluateElements(
  compiled.doc.document.elements,
  {
    ...buildEvaluationOptions({
      compiledDocument: compiled.doc,
      evaluationLimitIndex: undefined
    }),
    ...(allowDisabledElementIds.length
      ? { allowDisabledElementIds: new Set(allowDisabledElementIds) }
      : {})
  }
);

const productionRustBinary = process.env.NUINUICAD_RUST_EVALUATION_BINARY ?? resolve(
  process.cwd(),
  "src-tauri/target/debug/evaluation_stdio"
);

const evaluateWithProductionRust = (compiled: ReturnType<typeof compile>) => {
  const input = buildRustEvaluationInput(
    compiled.doc.document.elements,
    buildEvaluationOptions({
      compiledDocument: compiled.doc,
      evaluationLimitIndex: undefined
    })
  );
  const response = JSON.parse(execFileSync(productionRustBinary, [], {
    encoding: "utf8",
    input: `${JSON.stringify({ id: 1, input })}\n`
  })) as { payload: EvaluationPayload };
  return evaluationPayloadToResult(response.payload);
};

describe("Bake geometry", () => {
  it.skipIf(!existsSync(productionRustBinary))("bakes a division point through the production Rust evaluation path", () => {
    const compiled = compile([
      "nui 4",
      "modifier Guide {",
      "  state: visible,",
      "}",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 100, y: 0)",
      "point Derived [Guide] = between(",
      "  start: @A,",
      "  end: @B,",
      "  ratio: 0.25,",
      ")"
    ].join("\n"));
    const derived = compiled.doc.document.elements.find((element) => element.name === "Derived")!;
    const evaluation = evaluateWithProductionRust(compiled);

    expect(evaluation.evaluatedElementIds).toContain(derived.id);
    expect(evaluation.effectiveEnabledElementIds).toContain(derived.id);
    expect(evaluation.computedGeometry.get(derived.id)).toMatchObject({
      kind: "point",
      x: 25,
      y: 0
    });

    const sourceStatementIndex = compiled.doc.statementMap.byElementId.get(derived.id)!.statementIndex;
    expect(resolveSourceBakeTargets(
      compiled.doc,
      compiled.doc.document.elements,
      sourceStatementIndex
    )).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetId: derived.id })
    ]));

    const plan = planBakeGeometry({
      mode: "current",
      elements: compiled.doc.document.elements,
      evaluation,
      compiled: compiled.doc,
      selectedElementIds: [derived.id]
    });
    expect(plan?.generatedElementIds).toHaveLength(1);
    expect(applyLineSplices(compiled.sourceText, plan!.splices)).toContain(
      "point Derived_baked [Guide] = coordinate(x: 25, y: 0)"
    );
  }, 30_000);

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

  it("silently filters hidden geometry when hidden inclusion is off", () => {
    const compiled = compile([
      "nui 4",
      "point Hidden = coordinate(x: 1, y: 2, state: hidden)"
    ].join("\n"));
    const evaluation = evaluate(compiled);
    const hidden = compiled.doc.document.elements.find((element) => element.name === "Hidden")!;
    const plan = planBakeGeometry({
      mode: "current",
      elements: compiled.doc.document.elements,
      evaluation,
      compiled: compiled.doc,
      selectedElementIds: [hidden.id]
    });
    expect(plan?.generatedElementIds).toEqual([]);
    expect(plan?.skippedComments).toBe(0);
    expect(plan?.splices).toEqual([]);
  });

  it("bakes hidden geometry when enabled and preserves its modifier/activity semantics", () => {
    const compiled = compile([
      "nui 4",
      "modifier Hide {",
      "  state: hidden,",
      "}",
      "point Hidden [Hide] = coordinate(x: 1, y: 2, state: hidden)"
    ].join("\n"));
    const evaluation = evaluate(compiled);
    const hidden = compiled.doc.document.elements.find((element) => element.name === "Hidden")!;
    const plan = planBakeGeometry({
      mode: "current",
      elements: compiled.doc.document.elements,
      evaluation,
      compiled: compiled.doc,
      selectedElementIds: [hidden.id],
      includeHiddenGeometry: true
    });
    expect(plan?.generatedElementIds).toHaveLength(1);
    const patched = applyLineSplices(compiled.sourceText, plan!.splices);
    expect(patched).toContain("point Hidden_baked [Hide] = coordinate(x: 1, y: 2, state: hidden)");
  });

  it("silently filters disabled geometry by default and bakes it only through the sandbox", () => {
    const compiled = compile([
      "nui 4",
      "point Disabled = coordinate(x: 3, y: 4, state: disabled)"
    ].join("\n"));
    const disabled = compiled.doc.document.elements.find((element) => element.name === "Disabled")!;
    const evaluation = evaluate(compiled);
    const sandbox = evaluate(compiled, [disabled.id]);
    expect(evaluation.computedGeometry.has(disabled.id)).toBe(false);
    expect(evaluation.effectiveEnabledElementIds?.has(disabled.id)).toBe(false);
    expect(sandbox.computedGeometry.has(disabled.id)).toBe(true);
    const filtered = planBakeGeometry({
      mode: "current",
      elements: compiled.doc.document.elements,
      evaluation,
      bakeDisabledEvaluation: sandbox,
      compiled: compiled.doc,
      selectedElementIds: [disabled.id]
    });
    expect(filtered?.generatedElementIds).toEqual([]);
    expect(filtered?.skippedComments).toBe(0);
    expect(filtered?.splices).toEqual([]);

    const baked = planBakeGeometry({
      mode: "current",
      elements: compiled.doc.document.elements,
      evaluation,
      bakeDisabledEvaluation: sandbox,
      compiled: compiled.doc,
      selectedElementIds: [disabled.id],
      includeDisabledGeometry: true
    });
    expect(baked?.generatedElementIds).toHaveLength(1);
    expect(baked?.skippedComments).toBe(0);
    expect(applyLineSplices(compiled.sourceText, baked!.splices)).toContain(
      "point Disabled_baked = coordinate(x: 3, y: 4, state: disabled)"
    );
    expect(evaluation.computedGeometry.has(disabled.id)).toBe(false);
    expect(evaluation.effectiveEnabledElementIds?.has(disabled.id)).toBe(false);
  });

  it("emits or suppresses a skip when disabled sandbox evaluation genuinely fails", () => {
    const compiled = compile([
      "nui 4",
      "point Dependency = coordinate(x: 0, y: 0, state: disabled)",
      "line Broken = segment(start: @Dependency, end: (10, 0), state: disabled)"
    ].join("\n"));
    const evaluation = evaluate(compiled);
    const broken = compiled.doc.document.elements.find((element) => element.name === "Broken")!;
    const sandbox = evaluate(compiled, [broken.id]);
    const withComment = planBakeGeometry({
      mode: "current",
      elements: compiled.doc.document.elements,
      evaluation,
      bakeDisabledEvaluation: sandbox,
      compiled: compiled.doc,
      selectedElementIds: [broken.id],
      includeDisabledGeometry: true,
      emitSkippedComments: true
    });
    expect(withComment?.generatedElementIds).toEqual([]);
    expect(withComment?.skippedComments).toBe(1);
    expect(applyLineSplices(compiled.sourceText, withComment!.splices)).toContain(
      "// Bake skipped: line Broken — unsupported"
    );
    const withoutComment = planBakeGeometry({
      mode: "current",
      elements: compiled.doc.document.elements,
      evaluation,
      bakeDisabledEvaluation: sandbox,
      compiled: compiled.doc,
      selectedElementIds: [broken.id],
      includeDisabledGeometry: true,
      emitSkippedComments: false
    });
    expect(withoutComment?.splices).toEqual([]);
  });

  it("resolves only attempted disabled targets and fails closed without their sandbox", () => {
    const compiled = compile([
      "nui 4",
      "point Dependency = coordinate(x: 0, y: 0, state: disabled)",
      "line Broken = segment(start: @Dependency, end: (10, 0), state: disabled)"
    ].join("\n"));
    const dependency = compiled.doc.document.elements.find((element) => element.name === "Dependency")!;
    const broken = compiled.doc.document.elements.find((element) => element.name === "Broken")!;
    expect(resolveDisabledBakeTargetIds({
      compiled: compiled.doc,
      elements: compiled.doc.document.elements,
      selectedElementIds: [broken.id]
    })).toEqual([broken.id]);

    const normalEvaluation = evaluate(compiled);
    const plan = planBakeGeometry({
      mode: "current",
      elements: compiled.doc.document.elements,
      evaluation: normalEvaluation,
      compiled: compiled.doc,
      selectedElementIds: [broken.id],
      includeDisabledGeometry: true,
      emitSkippedComments: true
    });
    expect(plan).toBeNull();
    expect(dependency.id).not.toBe(broken.id);
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

  it("bakes materialized geometry descendants, applies activity per descendant, and includes internal moves in Instance Base", () => {
    const compiled = compile([
      "nui 4",
      "modifier Hide {",
      "  state: hidden,",
      "}",
      "modifier Disable {",
      "  state: disabled,",
      "}",
      "module M() {",
      "  point P0 = coordinate(x: 0, y: 0)",
      "  point Shift = coordinate(x: 10, y: 10)",
      "  export line L = segment(start: (0, 0), end: (3, 0))",
      "  line Private = segment(start: (0, 0), end: (0, 3))",
      "  line Hidden [Hide] = segment(start: (0, 0), end: (3, 0), state: hidden)",
      "  line Disabled [Disable] = segment(start: (0, 0), end: (0, 3), state: disabled)",
      "  text Memo = label(text: \"memo\", anchor: none, size: 3)",
      "  move(targets: [@L], from: @P0, to: @Shift)",
      "}",
      "instance Call = M()",
      "move(targets: [@Call::L], from: (10, 10), to: (20, 10))"
    ].join("\n"));
    const evaluation = evaluate(compiled);
    const disabledIds = compiled.doc.document.elements
      .filter((element) => element.activity === "disabled")
      .map((element) => element.id);
    const sandbox = evaluate(compiled, disabledIds);
    const instance = compiled.doc.document.elements.find((element) => element.name === "Call")!;
    const basePlan = planBakeGeometry({
      mode: "base",
      elements: compiled.doc.document.elements,
      evaluation,
      bakeDisabledEvaluation: sandbox,
      compiled: compiled.doc,
      selectedElementIds: [instance.id]
    });
    const currentPlan = planBakeGeometry({
      mode: "current",
      elements: compiled.doc.document.elements,
      evaluation,
      bakeDisabledEvaluation: sandbox,
      compiled: compiled.doc,
      selectedElementIds: [instance.id]
    });
    expect(basePlan?.generatedElementIds).toHaveLength(4);
    expect(basePlan?.skippedComments).toBe(1);
    expect(currentPlan?.generatedElementIds).toHaveLength(4);
    expect(currentPlan?.skippedComments).toBe(1);
    const basePatched = applyLineSplices(compiled.sourceText, basePlan!.splices);
    const currentPatched = applyLineSplices(compiled.sourceText, currentPlan!.splices);
    expect(basePatched).toContain("line L_baked = segment(start: (10, 10), end: (13, 10))");
    expect(currentPatched).toContain("line L_baked = segment(start: (20, 10), end: (23, 10))");
    expect(basePatched).toContain("line Private_baked = segment(start: (0, 0), end: (0, 3))");
    expect(basePatched).toContain("// Bake skipped: text Memo — unsupported");
    expect(basePatched).not.toContain("Bake skipped: move");
    expect(basePatched).not.toContain("module M() {\n  point P0_baked");

    const included = planBakeGeometry({
      mode: "current",
      elements: compiled.doc.document.elements,
      evaluation,
      bakeDisabledEvaluation: sandbox,
      compiled: compiled.doc,
      selectedElementIds: [instance.id],
      includeHiddenGeometry: true,
      includeDisabledGeometry: true
    });
    expect(included?.generatedElementIds).toHaveLength(6);
    expect(included?.skippedComments).toBe(1);
    const includedPatched = applyLineSplices(compiled.sourceText, included!.splices);
    expect(includedPatched).toContain("line Hidden_baked [Hide]");
    expect(includedPatched).toContain("state: hidden");
    expect(includedPatched).toContain("line Disabled_baked [Disable]");
    expect(includedPatched).toContain("state: disabled");
    expect(includedPatched).not.toContain("Bake skipped: move");
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
