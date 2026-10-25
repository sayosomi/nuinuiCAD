import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyLineSplices, compileFreshCanonicalText } from "@nuinuicad/nui-language/document";
import { evaluateElements, type EvaluateElementsOptions } from "../geometry/evaluate";
import { evaluationPayloadToResult, type EvaluationPayload } from "../geometry/evaluationPayload";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import { canUseRustEvaluationForElements } from "../geometry/rustEvaluationEligibility";
import { buildRustEvaluationInput } from "../geometry/rustEvaluationInput";
import { compileModulePreviewRoot } from "../dsl/modulePreviewRoot";
import { buildModulePreviewEvaluationOptions } from "../vscode/modulePreviewEvaluation";
import type { CadElement, ComputedGeometry, EvaluationResult } from "../types/geometry";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { applyBakePlan, planBakeGeometry, resolveModulePreviewBakeTargets } from "./bakeGeometry";

type Shape = { kind: string; [key: string]: unknown };
type FrozenCase = {
  id: string; source: string; select: string[]; expected: Shape[]; revision: number;
  insertionStartLines: number[]; baseExpected?: Shape[]; preview?: string; lifecycle?: boolean; existingBakeNames?: string[];
  includeHiddenGeometry?: boolean; includeDisabledGeometry?: boolean;
};
const cases = JSON.parse(readFileSync(resolve("test/fixtures/issue-1462/cases.json"), "utf8")) as FrozenCase[];
const compile = (source: string) => {
  const result = compileFreshCanonicalText(source);
  if (result.status === "fatal") throw new Error(JSON.stringify(result.diagnostics));
  expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  expect(result.bindingIssueDiagnostics.filter((d) => d.severity === "error")).toEqual([]);
  return result;
};
const rust = (elements: CadElement[], options: EvaluateElementsOptions): EvaluationResult => {
  expect(canUseRustEvaluationForElements(elements, options)).toBe(true);
  const response = JSON.parse(execFileSync(resolve("rust-evaluator/target/debug/evaluation_stdio"), [], {
    encoding: "utf8", timeout: 15_000, maxBuffer: 8 * 1024 * 1024,
    input: `${JSON.stringify({ id: 1, input: buildRustEvaluationInput(elements, options) })}\n`
  })) as { payload: EvaluationPayload };
  return evaluationPayloadToResult(response.payload);
};
const optionsFor = (compiled: ReturnType<typeof compile>, allowed: string[] = []) => ({
  ...buildEvaluationOptions({ compiledDocument: compiled.doc, evaluationLimitIndex: undefined }),
  ...(allowed.length ? { allowDisabledElementIds: new Set(allowed) } : {})
});
// Only compare frozen geometric fields; metadata/IDs and approximated path lengths are not an oracle.
const assertFields = (actual: unknown, expected: unknown, key = "") => {
  if (typeof expected === "number") {
    expect(typeof actual, key).toBe("number");
    const delta = Number(actual) - expected;
    const error = key === "startAngleDeg" || key === "endAngleDeg"
      ? ((delta + 180) % 360 + 360) % 360 - 180 : delta;
    expect(Math.abs(error), key).toBeLessThan(1e-8);
  } else if (Array.isArray(expected)) {
    expect(Array.isArray(actual), key).toBe(true);
    expect(actual, key).toHaveLength(expected.length);
    expected.forEach((v, i) => assertFields((actual as unknown[])[i], v, key));
  } else if (expected && typeof expected === "object") {
    expect(actual, key).toBeTruthy();
    for (const [k, v] of Object.entries(expected)) assertFields((actual as Record<string, unknown>)[k], v, k);
  } else expect(actual, key).toEqual(expected);
};
const geometric = (g: ComputedGeometry | undefined): unknown => {
  if (!g) return null;
  const clean = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
      .filter(([k]) => !k.endsWith("Id") && !k.endsWith("Ids") && k !== "name").map(([k, v]) => [k, clean(v)]));
    return value;
  };
  return clean(g);
};

const roundtrip = (f: FrozenCase, mode: "current" | "base" = "current") => {
  const original = compile(f.source);
  const expected = mode === "base" ? f.baseExpected! : f.expected;
  let elements = original.doc.document.elements;
  let options = optionsFor(original);
  let resolvedTargets;
  let previewIds: readonly string[] | undefined;
  if (f.preview) {
    const def = original.doc.moduleSemanticAnalysis!.definitions.find((d) => d.name === f.preview)!;
    const root = compileModulePreviewRoot({
      source: { normalizedSource: original.sourceText, sourceRevision: original.doc.statementMap.sourceRevision },
      semantic: { sourceRevision: original.doc.statementMap.sourceRevision, sourceText: original.sourceText, compiled: original.doc },
      target: { definitionStatementId: def.statementId, definitionStatementIndex: def.statementIndex, name: def.name }
    })!;
    elements = root.compileResult.elements;
    previewIds = root.targetRuntimeElementIds;
    options = buildModulePreviewEvaluationOptions(root);
    resolvedTargets = resolveModulePreviewBakeTargets({ authoredCompiled: original.doc,
      previewMaterialization: root.moduleMaterialization, elements,
      selectedElementIds: elements.filter((e) => f.select.includes(e.name) && (!previewIds || previewIds.includes(e.id))).map((e) => e.id) });
    expect(resolveModulePreviewBakeTargets({ authoredCompiled: original.doc,
      previewMaterialization: root.moduleMaterialization, elements, selectedElementIds: [root.targetRuntimeElementId] })).toEqual([]);
  }
  const selected = elements.filter((e) => f.select.includes(e.name) && (!previewIds || previewIds.includes(e.id)));
  expect(selected).toHaveLength(f.select.length);
  const before = rust(elements, options);
  expect(before.errors).toEqual([]);
  const originalEvaluation = rust(original.doc.document.elements, optionsFor(original));
  const allowed = f.includeDisabledGeometry ? selected.map((e) => e.id) : [];
  const sandboxOptions = { ...options, allowDisabledElementIds: new Set(allowed) };
  const sandbox = allowed.length ? rust(elements, sandboxOptions) : undefined;
  const referenceBefore = evaluateElements(elements, allowed.length ? sandboxOptions : options);
  const planOptions = { mode, compiled: original.doc, elements, evaluation: before, baseEvaluation: before,
    selectedElementIds: selected.map((e) => e.id), resolvedTargets,
    includeHiddenGeometry: f.includeHiddenGeometry, includeDisabledGeometry: f.includeDisabledGeometry,
    bakeDisabledEvaluation: sandbox };
  if (f.includeHiddenGeometry || f.includeDisabledGeometry) {
    const filtered = planBakeGeometry({ ...planOptions, includeHiddenGeometry: false, includeDisabledGeometry: false });
    expect(filtered?.splices).toEqual([]);
  }
  const plan = planBakeGeometry(planOptions)!;
  expect(plan).toBeTruthy();
  expect(plan.skippedTargets).toEqual([]);
  expect(plan.generatedElementIds).toHaveLength(expected.length);
  expect(plan.splices.map((s) => s.startLine)).toEqual(f.insertionStartLines);
  expect(plan.splices.every((s) => s.startLine === s.endLine + 1)).toBe(true);
  expect(plan.splices.map((s) => s.startLine)).toEqual(plan.splices.map((s) => s.startLine).sort((a, b) => a - b));
  // Replaying a frozen invocation must make identical names/text despite fresh generated IDs.
  expect(planBakeGeometry(planOptions)?.splices).toEqual(plan.splices);
  const patched = applyLineSplices(original.sourceText, plan.splices);
  // Removing precisely the insertion footprint restores every original line/comment.
  const restored = patched.split("\n");
  let added = 0;
  const insertedIndices: number[] = [];
  for (const s of plan.splices) {
    for (let i = 0; i < s.replacementLines.length; i++) insertedIndices.push(s.startLine - 1 + added + i);
    added += s.replacementLines.length;
  }
  expect(restored.filter((_, i) => !insertedIndices.includes(i)).join("\n")).toBe(original.sourceText);
  if (process.env.ISSUE1462_EVIDENCE === "1" && f.id === "B12") console.info(JSON.stringify({
    id: f.id, phase: "before canonical recompile", source: original.sourceText,
    revision: original.doc.statementMap.sourceRevision, patched, expected
  }));
  const after = compile(patched);
  const newElements = after.doc.document.elements.filter((e) => e.name.includes("_bake") && !f.existingBakeNames?.includes(e.name));
  expect(newElements).toHaveLength(expected.length);
  if (f.includeHiddenGeometry || f.includeDisabledGeometry) newElements.forEach((e) => {
    expect(e.modifierNames).toEqual(selected[0].modifierNames);
    expect(e.activity).toEqual(selected[0].activity);
    expect(e.enabled).toEqual(selected[0].enabled);
    expect(e.visible).toEqual(selected[0].visible);
  });
  const afterOptions = optionsFor(after, f.includeDisabledGeometry ? newElements.map((e) => e.id) : []);
  const observed = rust(after.doc.document.elements, afterOptions);
  expect(observed.errors).toEqual([]);
  const actual = newElements.map((e) => observed.computedGeometry.get(e.id));
  if (process.env.ISSUE1462_EVIDENCE === "1") console.info(JSON.stringify({
    id: f.id, mode, source: original.sourceText, revision: original.doc.statementMap.sourceRevision,
    selected: selected.map((e) => ({ name: e.name, id: e.id })),
    originalSelected: selected.map((e) => geometric(before.computedGeometry.get(e.id))),
    secondaryTsSelected: selected.map((e) => geometric(referenceBefore.computedGeometry.get(e.id))),
    patched, expected, actual: actual.map(geometric)
  }));
  if (f.id === "R01") {
    const control = original.doc.document.elements.find((e) => e.name === "Control")!;
    assertFields(originalEvaluation.computedGeometry.get(control.id), {
      kind: "offsetLine", segments: [{ kind: "line", start: { x: 0, y: 1 }, end: { x: 10, y: 1 } }]
    });
    // Direction/radius fault sensitivity is independent of the known producer failure.
    expect(() => assertFields({ ...expected[0], radius: 6 }, expected[0])).toThrow();
  }
  actual.forEach((g, i) => assertFields(g, expected[i]));
  // Secondary TS reference is never the independent oracle.
  const reference = evaluateElements(after.doc.document.elements, afterOptions);
  newElements.forEach((e, i) => assertFields(reference.computedGeometry.get(e.id), expected[i]));
  const originalElements = after.doc.document.elements.filter((e) => !newElements.includes(e));
  expect(originalElements.map((e) => e.name)).toEqual(original.doc.document.elements.map((e) => e.name));
  originalElements.forEach((e, i) => {
    const prior = original.doc.document.elements[i];
    assertFields(geometric(observed.computedGeometry.get(e.id)), geometric(originalEvaluation.computedGeometry.get(prior.id)));
    expect(e.modifierNames).toEqual(prior.modifierNames);
    expect(e.activity).toEqual(prior.activity);
  });
  // A source-level dropped declaration must be detected after canonical recompilation/evaluation.
  const faultyLines = patched.split("\n");
  faultyLines.splice(insertedIndices[insertedIndices.length - 1], 1);
  const faulty = compile(faultyLines.join("\n"));
  const faultyEvaluation = rust(faulty.doc.document.elements, optionsFor(faulty));
  const faultyNew = faulty.doc.document.elements.filter((e) => e.name.includes("_bake") && !f.existingBakeNames?.includes(e.name));
  expect(() => {
    expect(faultyNew).toHaveLength(expected.length);
    faultyNew.forEach((e, i) => assertFields(faultyEvaluation.computedGeometry.get(e.id), expected[i]));
  }).toThrow();
  return { original, plan, patched, after, before };
};

describe("Issue 1462 committed Bake source roundtrips", () => {
  afterEach(() => useCadDocumentStore.setState(initialCadDocumentState()));
  for (const f of cases.filter((f) => !f.lifecycle)) {
    it(`${f.id}: ${f.select.join(", ")}`, () => {
      roundtrip(f);
      if (f.baseExpected) roundtrip(f, "base");
    }, 30_000);
  }
  it("B16: stale plan rejection, current retry and atomic host-neutral undo/redo", () => {
    const f = cases.find((f) => f.id === "B16")!;
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadDocumentStore.getState().replaceTextDocument(f.source, { currentFilePath: null, dirtySinceSave: false });
    const state = useCadDocumentStore.getState();
    const p = state.elements.find((e) => e.name === "P")!;
    const evaluation = rust(state.elements, buildEvaluationOptions({ compiledDocument: state.doc, evaluationLimitIndex: undefined }));
    const plan = planBakeGeometry({ mode: "current", compiled: state.doc, elements: state.elements, evaluation, selectedElementIds: [p.id] })!;
    useCadDocumentStore.getState().commitText(`${f.source}// newer source revision\n`, "editor");
    const changed = useCadDocumentStore.getState().sourceText;
    const history = useCadDocumentStore.getState().past.length;
    const staleResult = applyBakePlan(plan);
    if (process.env.ISSUE1462_EVIDENCE === "1") console.info(JSON.stringify({
      id: "B16", phase: "stale apply", plannedSource: state.sourceText,
      plannedRevision: state.sourceRevision, currentSource: changed,
      currentRevision: useCadDocumentStore.getState().sourceRevision,
      expected: "rejected with source/history unchanged", actual: staleResult,
      actualSource: useCadDocumentStore.getState().sourceText,
      historyBefore: history, historyAfter: useCadDocumentStore.getState().past.length
    }));
    expect(staleResult.status).toBe("rejected");
    expect(useCadDocumentStore.getState().sourceText).toBe(changed);
    expect(useCadDocumentStore.getState().past).toHaveLength(history);
    const now = useCadDocumentStore.getState();
    const current = rust(now.elements, buildEvaluationOptions({ compiledDocument: now.doc, evaluationLimitIndex: undefined }));
    const retry = planBakeGeometry({ mode: "current", compiled: now.doc, elements: now.elements, evaluation: current, selectedElementIds: [p.id] })!;
    expect(applyBakePlan(retry).status).toBe("applied");
    const baked = useCadDocumentStore.getState().sourceText;
    const compiled = compile(baked);
    const observed = rust(compiled.doc.document.elements, optionsFor(compiled));
    const generated = compiled.doc.document.elements.find((e) => e.name === "P_bake")!;
    assertFields(observed.computedGeometry.get(generated.id), f.expected[0]);
    useCadDocumentStore.getState().undo();
    expect(useCadDocumentStore.getState().sourceText).toBe(changed);
    useCadDocumentStore.getState().redo();
    expect(useCadDocumentStore.getState().sourceText).toBe(baked);
    roundtrip(f);
    useCadDocumentStore.setState(initialCadDocumentState());
  }, 30_000);
});
