import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { parseDsl } from "../dsl/dslParser";
import type { BindingId } from "./bindingCatalog";
import { runtimeScalarDiagnostics, type RuntimeScalarDiagnosticsInput } from "./runtimeScalarDiagnostics";
import type { CadElement } from "../types/geometry";
import type { ScalarEvaluation } from "./types";

const compile = (source: string) => {
  const parsed = parseDsl(source);
  const assignedStatementIds = new Map(parsed.statements.map((_, index) => [index, `statement:test:${index}`]));
  const compiled = compileDslDocument(source, { assignedStatementIds, preparsed: parsed });
  expect(compiled.document, `must compile:\n${source}`).not.toBeNull();
  return compiled;
};

const bindingIdFor = (compiled: ReturnType<typeof compile>, name: string): BindingId => {
  const binding = compiled.bindingAnalysis!.catalog.bindings.find((item) => item.kind === "typed" && item.name === name);
  if (!binding) throw new Error(`no typed binding named ${name}`);
  return binding.id;
};

const FRESH = { isSourceDirty: false, isEvaluationStale: false };

const baseInput = (
  compiled: ReturnType<typeof compile>,
  computedScalarBindings: RuntimeScalarDiagnosticsInput["computedScalarBindings"],
  freshness = FRESH,
  elements: readonly CadElement[] = []
): RuntimeScalarDiagnosticsInput => ({
  computedScalarBindings,
  bindingAnalysis: compiled.bindingAnalysis!,
  statements: compiled.statements,
  spans: compiled.spans,
  elementIdByStatementIndex: compiled.statementMap!.elementIdByStatementIndex,
  propertySourcesByOccurrenceKey: compiled.propertyBindings ?? new Map(),
  occurrenceKeysByBindingId: compiled.occurrenceKeysByBindingId ?? new Map(),
  numericConsumerReferencesByBindingId: compiled.numericConsumerReferencesByBindingId ?? new Map(),
  elements,
  freshness
});

const errorEvaluation = (issueCode: string): ScalarEvaluation => ({ status: "error", type: { kind: "number" }, issueCode });
const okEvaluation: ScalarEvaluation = { status: "ok", type: { kind: "number" }, value: { kind: "number", value: 1 } };

describe("runtimeScalarDiagnostics", () => {
  it("reports a declaration-level diagnostic for a binding with no property consumer", () => {
    const source = ["nui 4", "const x: number = 1"].join("\n");
    const compiled = compile(source);
    const bindingId = bindingIdFor(compiled, "x");
    const diagnostics = runtimeScalarDiagnostics(
      baseInput(compiled, new Map([[bindingId, errorEvaluation("poisoned-binding")]]))
    );
    expect(diagnostics).toHaveLength(1);
    const [diagnostic] = diagnostics;
    expect(diagnostic.code).toBe("poisoned-binding");
    expect(diagnostic.origin).toBe("runtime");
    expect(diagnostic.exactSpanOnly).toBe(true);
    expect(diagnostic.bindingId).toBe(bindingId);
    expect(diagnostic.navigationTarget).toEqual({ kind: "binding", bindingId });
    expect(diagnostic.runtimeContext).toBeUndefined();
    expect(diagnostic.physicalSpan).toBeDefined();
    const [segment] = diagnostic.physicalSpan!.segments;
    expect(source.slice(segment.from, segment.to)).toBe("x");
  });

  it("reports at the exact property value span instead of the declaration when a live property consumer exists", () => {
    const source = ['nui 4', 'const label: string = "A"', "text T = label(text: @label, anchor: none, size: 3)"].join("\n");
    const compiled = compile(source);
    const bindingId = bindingIdFor(compiled, "label");
    const diagnostics = runtimeScalarDiagnostics(
      baseInput(compiled, new Map([[bindingId, errorEvaluation("evaluation-binding-unavailable")]]))
    );
    expect(diagnostics).toHaveLength(1);
    const [diagnostic] = diagnostics;
    expect(diagnostic.navigationTarget?.kind).toBe("property");
    expect(diagnostic.elementId).toBeDefined();
    expect(diagnostic.propertyKey).toBe("text");
    expect(diagnostic.bindingId).toBe(bindingId);
    const [segment] = diagnostic.physicalSpan!.segments;
    expect(source.slice(segment.from, segment.to)).toBe("@label");
    // Never both: no declaration-level diagnostic for this same binding.
    expect(diagnostics.some((item) => item.navigationTarget?.kind === "binding")).toBe(false);
  });

  it("reports at the exact numeric property consumer span instead of the declaration", () => {
    const source = [
      "nui 4",
      "const broken: number = 1",
      "point P = coordinate(x: @broken, y: 0)"
    ].join("\n");
    const compiled = compile(source);
    const bindingId = bindingIdFor(compiled, "broken");
    const diagnostics = runtimeScalarDiagnostics(
      baseInput(compiled, new Map([[bindingId, errorEvaluation("evaluation-divide-by-zero")]]))
    );
    expect(diagnostics).toHaveLength(1);
    const [diagnostic] = diagnostics;
    expect(diagnostic.navigationTarget?.kind).toBe("property");
    expect(diagnostic.propertyKey).toBe("x");
    expect(diagnostic.line).toBe(3);
    const [segment] = diagnostic.physicalSpan!.segments;
    expect(source.slice(segment.from, segment.to)).toBe("@broken");
    expect(diagnostics.some((item) => item.navigationTarget?.kind === "binding")).toBe(false);
  });

  it("reports one diagnostic per consumer, in source order, when multiple properties reference the same binding", () => {
    const source = [
      "nui 4",
      'const label: string = "A"',
      "text T1 = label(text: @label, anchor: none, size: 3)",
      "text T2 = label(text: @label, anchor: none, size: 3)"
    ].join("\n");
    const compiled = compile(source);
    const bindingId = bindingIdFor(compiled, "label");
    const diagnostics = runtimeScalarDiagnostics(
      baseInput(compiled, new Map([[bindingId, errorEvaluation("poisoned-binding")]]))
    );
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.every((diagnostic) => diagnostic.navigationTarget?.kind === "property")).toBe(true);
    expect(diagnostics[0].line).toBeLessThan(diagnostics[1].line);
  });

  it("reports nothing for a binding whose final evaluation is ok", () => {
    const compiled = compile(["nui 4", "const x: number = 1"].join("\n"));
    const bindingId = bindingIdFor(compiled, "x");
    const diagnostics = runtimeScalarDiagnostics(baseInput(compiled, new Map([[bindingId, okEvaluation]])));
    expect(diagnostics).toEqual([]);
  });

  it.each([
    ["dirty source", { isSourceDirty: true, isEvaluationStale: false }],
    ["stale evaluation", { isSourceDirty: false, isEvaluationStale: true }],
    ["both dirty and stale", { isSourceDirty: true, isEvaluationStale: true }]
  ])("returns nothing while %s, even though a fresh error would otherwise be reported", (_label, freshness) => {
    const compiled = compile(["nui 4", "const x: number = 1"].join("\n"));
    const bindingId = bindingIdFor(compiled, "x");
    const diagnostics = runtimeScalarDiagnostics(
      baseInput(compiled, new Map([[bindingId, errorEvaluation("poisoned-binding")]]), freshness)
    );
    expect(diagnostics).toEqual([]);
  });

  it("recovery: an error becomes ok on a later evaluation and leaves no stale diagnostic", () => {
    const compiled = compile(["nui 4", "let x: number = 1", "set x = 2"].join("\n"));
    const bindingId = bindingIdFor(compiled, "x");
    const poisoned = runtimeScalarDiagnostics(baseInput(compiled, new Map([[bindingId, errorEvaluation("poisoned-binding")]])));
    expect(poisoned).toHaveLength(1);
    const recovered = runtimeScalarDiagnostics(baseInput(compiled, new Map([[bindingId, okEvaluation]])));
    expect(recovered).toEqual([]);
  });

  it("returns nothing when computedScalarBindings is absent entirely", () => {
    const compiled = compile(["nui 4", "const x: number = 1"].join("\n"));
    expect(runtimeScalarDiagnostics(baseInput(compiled, undefined))).toEqual([]);
  });

  it("skips (fail-closed) a bindingId that no longer resolves against the current statements, without mis-positioning", () => {
    const compiled = compile(["nui 4", "const x: number = 1"].join("\n"));
    const diagnostics = runtimeScalarDiagnostics(
      baseInput(compiled, new Map([["binding:stale-removed" as BindingId, errorEvaluation("poisoned-binding")]]))
    );
    expect(diagnostics).toEqual([]);
  });

  it("preserves geometry builtin runtime context as clone-safe structured data independent of localized wording", () => {
    const compiled = compile(["nui 4", "const x: number = 1"].join("\n"));
    const bindingId = bindingIdFor(compiled, "x");
    const evaluation: ScalarEvaluation = {
      status: "error",
      type: { kind: "number" },
      issueCode: "evaluation-geometry-builtin-disabled",
      context: { kind: "geometryBuiltinTarget", targetElementId: "target-id", pointKey: "center" }
    };
    const namedDiagnostics = runtimeScalarDiagnostics(
      baseInput(compiled, new Map([[bindingId, evaluation]]), FRESH, [{ id: "target-id", name: "Shoulder" } as CadElement])
    );
    const fallbackDiagnostics = runtimeScalarDiagnostics(
      baseInput(compiled, new Map([[bindingId, evaluation]]))
    );
    expect(namedDiagnostics[0]?.message).not.toBe(fallbackDiagnostics[0]?.message);
    expect(namedDiagnostics[0]?.runtimeContext).toEqual({
      kind: "geometryBuiltinTarget",
      targetElementId: "target-id",
      pointKey: "center"
    });
    expect(fallbackDiagnostics[0]?.runtimeContext).toEqual(namedDiagnostics[0]?.runtimeContext);
    expect(structuredClone(namedDiagnostics[0])).toEqual(namedDiagnostics[0]);
  });
});
