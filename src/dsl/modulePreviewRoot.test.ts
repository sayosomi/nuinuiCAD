import { describe, expect, it } from "vitest";
import { evaluateElements } from "../geometry/evaluate";
import { buildNumericBindingRuntimeEntries } from "../geometry/numericBindingRuntime";
import { buildBindingVersionGraph } from "../scalars/bindingVersions";
import { compileDslDocument, type CompiledDslDocument } from "./dslDocument";
import { parseDslSnapshot } from "./dslParser";
import { compileModulePreviewRoot, modulePreviewSyntheticCallSource } from "./modulePreviewRoot";
import { queryModulePreviewTarget } from "./modulePreviewTarget";

const compileWithIds = (source: string, sourceRevision = 41): CompiledDslDocument => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision });
  return compileDslDocument(source, {
    preparsed: parsed,
    sourceRevision,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `preview-root:${index}`]))
  });
};

const targetAt = (source: string, compiled: CompiledDslDocument, needle: string, sourceRevision = 41) =>
  queryModulePreviewTarget({
    source: { normalizedSource: source, sourceRevision },
    position: source.indexOf(needle) + Math.max(1, needle.length - 1),
    semantic: { sourceRevision, compiled }
  });

const evaluatePreview = (result: NonNullable<ReturnType<typeof compileModulePreviewRoot>>) => {
  const runtime = result.moduleScalarRuntime;
  const bindingVersions = buildBindingVersionGraph({
    scalarProgram: runtime.scalarProgram,
    bindingAnalysis: runtime.bindingAnalysis,
    setStatements: new Map(runtime.moduleSetStatements.map((set, index) => [-(index + 1), set] as const)),
    controlByScopeId: runtime.controlByScopeId,
    requiresExecutionOrdering: true
  });
  return evaluateElements(result.compileResult.elements, {
    scalarProgram: runtime.scalarProgram,
    bindingVersions,
    sourceExecutionPositionByElementId: result.moduleMaterialization.sourceExecutionPositionByRuntimeElementId,
    scalarExecutionPositionByElementId: runtime.scalarExecutionPositionByRuntimeElementId,
    numericBindingEntries: buildNumericBindingRuntimeEntries({
      numericBindings: new Map(),
      elementIdByStatementIndex: result.moduleMaterialization.elementIdBySourceStatementIndex,
      materializedNumericBindings: runtime.materializedNumericBindings
    }, result.compileResult.elements),
    moduleMaterialization: result.moduleMaterialization
  });
};

describe("compileModulePreviewRoot", () => {
  it("builds synthetic preview source with the current nui 1 header", () => {
    expect(modulePreviewSyntheticCallSource("Preview", "Pocket", [])).toBe(
      "nui 1\ninstance Preview = Pocket()"
    );
    expect(modulePreviewSyntheticCallSource("Preview", "Pocket", [])).not.toContain("nui 4");
  });

  it("materializes and evaluates a top-level preview through the existing runtime with omission semantics and provenance", () => {
    const source = [
      "nui 1",
      "module Pocket(base: number, width: number = @base * 2, note?: string) {",
      "  point P = coordinate(x: @width, y: 0)",
      "}",
      "point Outside = coordinate(x: 100, y: 100)"
    ].join("\n");
    const original = source;
    const compiled = compileWithIds(source);
    const target = targetAt(source, compiled, "point P");
    expect(target).not.toBeNull();

    const result = target && compileModulePreviewRoot({
      source: { normalizedSource: source, sourceRevision: 41 },
      semantic: { sourceRevision: 41, compiled },
      target,
      arguments: [{ name: "base", expression: "3" }]
    });

    expect(result).not.toBeNull();
    expect(source).toBe(original);
    if (!result || !target) throw new Error("expected preview result");
    expect(result.targetRuntimeElementIds).toContain(result.targetRuntimeElementId);
    expect(result.compileResult.elements.some((element) => element.id === result.targetRuntimeElementId)).toBe(true);
    expect(result.moduleScalarRuntime.scalarProgram).toBeDefined();

    const previewInstance = result.moduleSemanticAnalysis.instancesByStatementId.get(
      `module-preview-call:${target.definitionStatementId}:0`
    );
    expect(previewInstance?.parameterBindings.map((binding) => [binding.parameterName, binding.state])).toEqual([
      ["base", "requiredSupplied"],
      ["width", "defaultedOmitted"],
      ["note", "optionalOmitted"]
    ]);

    const bodyEntry = result.moduleMaterialization.executionStatements.find((entry) =>
      entry.origin?.kind === "moduleBody" && entry.sourceStatementIndex === 2 &&
      result.targetRuntimeElementIds.includes(entry.runtimeElementId)
    );
    expect(bodyEntry?.origin?.sourceStatementId).toBe("preview-root:2");

    const evaluation = evaluatePreview(result);
    expect(evaluation.errors).toEqual([]);
    const previewPoint = result.compileResult.elements.find((element) =>
      element.name === "P" && result.targetRuntimeElementIds.includes(element.id)
    );
    expect(previewPoint).toBeDefined();
    expect(evaluation.computedGeometry.get(previewPoint!.id)).toMatchObject({ kind: "point", x: 6, y: 0 });

    expect(compileModulePreviewRoot({
      source: { normalizedSource: source, sourceRevision: 41 },
      semantic: { sourceRevision: 41, compiled },
      target,
      arguments: []
    })).toBeNull();
  });

  it("evaluates an omitted default-only scalar parameter in Module geometry", () => {
    const source = [
      "nui 1",
      "module Alternate(size: number = 30) {",
      "  point AltStart = coordinate(x: 0, y: 0)",
      "  point AltEnd = coordinate(x: @size, y: @size)",
      "  line AltLine = segment(start: @AltStart, end: @AltEnd)",
      "}"
    ].join("\n");
    const compiled = compileWithIds(source);
    const target = targetAt(source, compiled, "point AltStart");
    expect(target).not.toBeNull();
    if (!target) throw new Error("expected preview target");

    const result = compileModulePreviewRoot({
      source: { normalizedSource: source, sourceRevision: 41 },
      semantic: { sourceRevision: 41, compiled },
      target
    });

    expect(result).not.toBeNull();
    if (!result) throw new Error("expected default-only preview result");
    const previewInstance = result.moduleSemanticAnalysis.instancesByStatementId.get(
      `module-preview-call:${target.definitionStatementId}:0`
    );
    expect(previewInstance?.parameterBindings).toEqual([
      expect.objectContaining({
        parameterName: "size",
        state: "defaultedOmitted",
        argumentIndex: null
      })
    ]);
    const previewEnd = result.compileResult.elements.find((element) =>
      element.name === "AltEnd" && result.targetRuntimeElementIds.includes(element.id)
    );
    expect(previewEnd).toBeDefined();
    expect(evaluatePreview(result).computedGeometry.get(previewEnd!.id)).toMatchObject({
      kind: "point",
      x: 30,
      y: 30
    });
  });

  it("materializes omitted scalar defaults through the existing Module runtime", () => {
    const source = [
      "nui 1",
      "module Alternate(size: number = 30, rise: number = 4) {",
      "  point AltStart = coordinate(x: 0, y: 0)",
      "  point AltEnd = coordinate(x: @size, y: @rise)",
      "  line AltLine = segment(start: @AltStart, end: @AltEnd)",
      "}"
    ].join("\n");
    const original = source;
    const compiled = compileWithIds(source);
    const target = targetAt(source, compiled, "point AltStart");
    expect(target).not.toBeNull();
    if (!target) throw new Error("expected preview target");

    const result = compileModulePreviewRoot({
      source: { normalizedSource: source, sourceRevision: 41 },
      semantic: { sourceRevision: 41, compiled },
      target,
      arguments: []
    });

    expect(result).not.toBeNull();
    expect(source).toBe(original);
    if (!result) throw new Error("expected default-only preview result");
    const previewInstance = result.moduleSemanticAnalysis.instancesByStatementId.get(
      `module-preview-call:${target.definitionStatementId}:0`
    );
    expect(previewInstance?.parameterBindings.map((binding) => [
      binding.parameterName,
      binding.state,
      binding.argumentIndex
    ])).toEqual([
      ["size", "defaultedOmitted", null],
      ["rise", "defaultedOmitted", null]
    ]);
    const syntheticCall = result.candidateCompiledDocument.statements.find(
      (statement) => statement.kind === "moduleInstance" && statement.name === "__module_preview_0"
    );
    expect(syntheticCall?.kind).toBe("moduleInstance");
    expect(syntheticCall?.kind === "moduleInstance" ? syntheticCall.arguments : []).toHaveLength(0);

    const evaluation = evaluatePreview(result);
    expect(evaluation.errors).toEqual([]);
    const previewEnd = result.compileResult.elements.find((element) =>
      element.name === "AltEnd" && result.targetRuntimeElementIds.includes(element.id)
    );
    expect(previewEnd).toBeDefined();
    expect(evaluation.computedGeometry.get(previewEnd!.id)).toMatchObject({
      kind: "point",
      x: 30,
      y: 4
    });
  });

  it("keeps default-only preview isolated from unrelated document errors", () => {
    const source = [
      "nui 1",
      "module Alternate(size: number = 30) {",
      "  point AltStart = coordinate(x: 0, y: 0)",
      "  point AltEnd = coordinate(x: @size, y: @size)",
      "  line AltLine = segment(start: @AltStart, end: @AltEnd)",
      "}",
      "module Broken(input: unknown) {",
      "}"
    ].join("\n");
    const compiled = compileWithIds(source);
    expect(compiled.document).toBeNull();
    const target = targetAt(source, compiled, "point AltStart");
    expect(target).not.toBeNull();
    if (!target) throw new Error("expected preview target");

    const result = compileModulePreviewRoot({
      source: { normalizedSource: source, sourceRevision: 41 },
      semantic: { sourceRevision: 41, compiled },
      target,
      arguments: []
    });
    expect(result).not.toBeNull();
    if (!result) throw new Error("expected isolated default-only preview result");
    const previewEnd = result.compileResult.elements.find((element) =>
      element.name === "AltEnd" && result.targetRuntimeElementIds.includes(element.id)
    );
    expect(previewEnd).toBeDefined();
    expect(evaluatePreview(result).computedGeometry.get(previewEnd!.id)).toMatchObject({
      kind: "point",
      x: 30,
      y: 30
    });
  });

  it("evaluates nested preview arguments in the ancestor parameter context without granting body outer capture", () => {
    const source = [
      "nui 1",
      "module Outer(scale: number) {",
      "  module Inner(width: number) {",
      "    point P = coordinate(x: @width, y: 0)",
      "  }",
      "}",
    ].join("\n");
    const compiled = compileWithIds(source);
    const target = targetAt(source, compiled, "point P");
    expect(target?.name).toBe("Inner");
    const outer = compiled.moduleSemanticAnalysis?.definitions.find((definition) => definition.name === "Outer");
    expect(outer).toBeDefined();

    const result = target && outer && compileModulePreviewRoot({
      source: { normalizedSource: source, sourceRevision: 41 },
      semantic: { sourceRevision: 41, compiled },
      target,
      ancestorContexts: [{
        definitionStatementId: outer.statementId,
        arguments: [{ name: "scale", expression: "2" }]
      }],
      arguments: [{ name: "width", expression: "@scale + 1" }]
    });
    expect(result).not.toBeNull();

    const innerPreview = result?.moduleSemanticAnalysis.instancesByStatementId.get(
      `module-preview-call:${target?.definitionStatementId}:1`
    );
    const width = innerPreview?.parameterBindings.find((binding) => binding.parameterName === "width");
    expect(width?.value?.kind).toBe("scalar");
    if (width?.value?.kind === "scalar") {
      expect(width.value.expression.references[0]?.target).toMatchObject({
        kind: "parameter",
        definitionStatementId: outer?.statementId,
        parameterIndex: 0
      });
    }

    const illegalSource = source.replace("@width", "@scale");
    const illegalCompiled = compileWithIds(illegalSource);
    const illegalTarget = targetAt(illegalSource, illegalCompiled, "point P");
    const illegalOuter = illegalCompiled.moduleSemanticAnalysis?.definitions.find((definition) => definition.name === "Outer");
    expect(illegalTarget && illegalOuter && compileModulePreviewRoot({
      source: { normalizedSource: illegalSource, sourceRevision: 41 },
      semantic: { sourceRevision: 41, compiled: illegalCompiled },
      target: illegalTarget,
      ancestorContexts: [{
        definitionStatementId: illegalOuter.statementId,
        arguments: [{ name: "scale", expression: "2" }]
      }],
      arguments: [{ name: "width", expression: "1" }]
    })).toBeNull();
  });

  it("evaluates a nested preview argument from the exact enclosing local scalar scope", () => {
    const source = [
      "nui 1",
      "module Outer(scale: number) {",
      "  group G {",
      "    const half: number = @scale * 0.5",
      "    module Inner(width: number) {",
      "      point P = coordinate(x: @width, y: 0)",
      "    }",
      "  }",
      "}"
    ].join("\n");
    const compiled = compileWithIds(source);
    const target = targetAt(source, compiled, "point P");
    const outer = compiled.moduleSemanticAnalysis?.definitions.find((definition) => definition.name === "Outer");
    expect(target?.name).toBe("Inner");
    expect(outer).toBeDefined();

    const result = target && outer && compileModulePreviewRoot({
      source: { normalizedSource: source, sourceRevision: 41 },
      semantic: { sourceRevision: 41, compiled },
      target,
      ancestorContexts: [{
        definitionStatementId: outer.statementId,
        arguments: [{ name: "scale", expression: "10" }]
      }],
      arguments: [{ name: "width", expression: "@half" }]
    });
    expect(result).not.toBeNull();
    if (!result) throw new Error("expected nested scalar-local preview result");

    const evaluation = evaluatePreview(result);
    expect(evaluation.errors).toEqual([]);
    const previewPoint = result.compileResult.elements.find((element) =>
      element.name === "P" && result.targetRuntimeElementIds.includes(element.id)
    );
    expect(previewPoint).toBeDefined();
    expect(evaluation.computedGeometry.get(previewPoint!.id)).toMatchObject({ kind: "point", x: 5, y: 0 });
  });

  it("evaluates a nested preview geometry argument from enclosing Module geometry", () => {
    const source = [
      "nui 1",
      "module Outer(dx: number) {",
      "  point Anchor = coordinate(x: @dx, y: 4)",
      "  module Inner(anchor: point) {",
      "    point P = offset(from: @anchor, dx: 1, dy: 0)",
      "  }",
      "}"
    ].join("\n");
    const compiled = compileWithIds(source);
    const target = targetAt(source, compiled, "point P");
    const outer = compiled.moduleSemanticAnalysis?.definitions.find((definition) => definition.name === "Outer");
    expect(target?.name).toBe("Inner");
    expect(outer).toBeDefined();

    const result = target && outer && compileModulePreviewRoot({
      source: { normalizedSource: source, sourceRevision: 41 },
      semantic: { sourceRevision: 41, compiled },
      target,
      ancestorContexts: [{
        definitionStatementId: outer.statementId,
        arguments: [{ name: "dx", expression: "3" }]
      }],
      arguments: [{ name: "anchor", expression: "@Anchor" }]
    });
    expect(result).not.toBeNull();
    if (!result) throw new Error("expected nested geometry-local preview result");

    const evaluation = evaluatePreview(result);
    expect(evaluation.errors).toEqual([]);
    const previewPoint = result.compileResult.elements.find((element) =>
      element.name === "P" && result.targetRuntimeElementIds.includes(element.id)
    );
    expect(previewPoint).toBeDefined();
    expect(evaluation.computedGeometry.get(previewPoint!.id)).toMatchObject({ kind: "point", x: 4, y: 4 });
  });

  it("rejects caller locals that are forward or outside the nested definition scope", () => {
    const forwardSource = [
      "nui 1",
      "module Outer() {",
      "  module Inner(width: number) {",
      "    point P = coordinate(x: @width, y: 0)",
      "  }",
      "  const later: number = 10",
      "}"
    ].join("\n");
    const forwardCompiled = compileWithIds(forwardSource);
    const forwardTarget = targetAt(forwardSource, forwardCompiled, "point P");
    const forwardOuter = forwardCompiled.moduleSemanticAnalysis?.definitions.find((definition) => definition.name === "Outer");
    expect(forwardTarget && forwardOuter && compileModulePreviewRoot({
      source: { normalizedSource: forwardSource, sourceRevision: 41 },
      semantic: { sourceRevision: 41, compiled: forwardCompiled },
      target: forwardTarget,
      ancestorContexts: [{ definitionStatementId: forwardOuter.statementId }],
      arguments: [{ name: "width", expression: "@later" }]
    })).toBeNull();

    const outOfScopeSource = [
      "nui 1",
      "module Outer() {",
      "  group G {",
      "    const local: number = 10",
      "  }",
      "  module Inner(width: number) {",
      "    point P = coordinate(x: @width, y: 0)",
      "  }",
      "}"
    ].join("\n");
    const outOfScopeCompiled = compileWithIds(outOfScopeSource);
    const outOfScopeTarget = targetAt(outOfScopeSource, outOfScopeCompiled, "point P");
    const outOfScopeOuter = outOfScopeCompiled.moduleSemanticAnalysis?.definitions.find((definition) => definition.name === "Outer");
    expect(outOfScopeTarget && outOfScopeOuter && compileModulePreviewRoot({
      source: { normalizedSource: outOfScopeSource, sourceRevision: 41 },
      semantic: { sourceRevision: 41, compiled: outOfScopeCompiled },
      target: outOfScopeTarget,
      ancestorContexts: [{ definitionStatementId: outOfScopeOuter.statementId }],
      arguments: [{ name: "width", expression: "@local" }]
    })).toBeNull();
  });

  it("still rejects direct nested Module-body capture of an enclosing local", () => {
    const source = [
      "nui 1",
      "module Outer() {",
      "  const half: number = 5",
      "  module Inner() {",
      "    point P = coordinate(x: @half, y: 0)",
      "  }",
      "}"
    ].join("\n");
    const compiled = compileWithIds(source);
    const target = targetAt(source, compiled, "point P");
    const outer = compiled.moduleSemanticAnalysis?.definitions.find((definition) => definition.name === "Outer");
    expect(target?.name).toBe("Inner");
    expect(outer).toBeDefined();
    expect(target && outer && compileModulePreviewRoot({
      source: { normalizedSource: source, sourceRevision: 41 },
      semantic: { sourceRevision: 41, compiled },
      target,
      ancestorContexts: [{ definitionStatementId: outer.statementId }]
    })).toBeNull();
  });

  it("does not let an unrelated fatal root diagnostic block a safe selected Module", () => {
    const source = [
      "nui 1",
      "module Safe(width: number) {",
      "  point P = coordinate(x: @width, y: 0)",
      "}",
      "module Broken(input: unknown) {",
      "}"
    ].join("\n");
    const compiled = compileWithIds(source);
    expect(compiled.document).toBeNull();
    const target = targetAt(source, compiled, "point P");
    expect(target).not.toBeNull();

    const result = target && compileModulePreviewRoot({
      source: { normalizedSource: source, sourceRevision: 41 },
      semantic: { sourceRevision: 41, compiled },
      target,
      arguments: [{ name: "width", expression: "5" }]
    });
    expect(result).not.toBeNull();
    expect(result?.targetRuntimeElementIds.length).toBeGreaterThan(1);
  });
});
