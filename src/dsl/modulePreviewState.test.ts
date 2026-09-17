import { describe, expect, it } from "vitest";
import { compileDslDocument, parseDslSnapshot, type CompiledDslDocument } from "@nuinuicad/nui-language";
import { createModulePreviewSession, type ModulePreviewSessionSnapshot } from "./modulePreviewState";
import { queryModulePreviewTarget } from "./modulePreviewTarget";
import { modulePreviewAggregateSource } from "./__fixtures__/modulePreviewAggregate";

const compileWithIds = (source: string, sourceRevision = 41): CompiledDslDocument => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision });
  return compileDslDocument(source, {
    preparsed: parsed,
    sourceRevision,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `preview-state:${index}`]))
  });
};

const targetAt = (source: string, compiled: CompiledDslDocument, needle: string, sourceRevision = 41) =>
  queryModulePreviewTarget({
    source: { normalizedSource: source, sourceRevision },
    position: source.indexOf(needle) + Math.max(1, needle.length - 1),
    semantic: { sourceRevision, compiled }
  });

const targetParameter = (state: ModulePreviewSessionSnapshot, name: string) =>
  state.parameters.parameters.find((parameter) => parameter.name === name);

const blockFor = (state: ModulePreviewSessionSnapshot, definitionStatementId: string) =>
  state.invocation.blocks.find((block) => block.definitionStatementId === definitionStatementId)!;

describe("createModulePreviewSession invocation ownership", () => {
  it("creates the complete definition-order scaffold with omission and active-state semantics", () => {
    const source = modulePreviewAggregateSource;
    const compiled = compileWithIds(source);
    const target = targetAt(source, compiled, "module PreviewTarget");
    expect(target).not.toBeNull();
    if (!target) throw new Error("expected PreviewTarget");

    const state = createModulePreviewSession().activate({
      source: { normalizedSource: source, sourceRevision: 41 },
      semantic: { sourceRevision: 41, compiled },
      target
    });
    expect(state).not.toBeNull();
    const block = blockFor(state!, target.definitionStatementId);
    expect(block.parameters.map((parameter) => parameter.name)).toEqual([
      "width", "anchor", "edge", "guide", "label", "note"
    ]);
    expect(block.text).toContain("  width: ,");
    expect(block.text).toContain("  anchor: ,");
    expect(block.text).toContain("  edge: ,");
    expect(block.text).toContain("  guide: ,");
    expect(block.text).toContain('  // label: "default"');
    expect(block.text).toContain("  // note:");
    expect(block.parameters.slice(0, 4).every((parameter) => parameter.active)).toBe(true);
    expect(block.parameters.slice(4).every((parameter) => parameter.omitted)).toBe(true);
    expect(state?.preview.kind).toBe("noValidPreview");
    expect(state?.inputDiagnostics.map((diagnostic) => diagnostic.parameterIndex)).toEqual([0, 1, 2, 3]);
  });

  it("derives one coherent Module Preview update from active invocation text", () => {
    const source = modulePreviewAggregateSource;
    const compiled = compileWithIds(source);
    const target = targetAt(source, compiled, "module PreviewTarget");
    if (!target) throw new Error("expected PreviewTarget");
    const session = createModulePreviewSession();
    let state = session.activate({
      source: { normalizedSource: source, sourceRevision: 41 },
      semantic: { sourceRevision: 41, compiled },
      target
    });
    const block = blockFor(state!, target.definitionStatementId);
    const completeText = block.text
      .replace("width: ,", "width: 45,")
      .replace("anchor: ,", "anchor: @RootA,")
      .replace("edge: ,", "edge: @RootLine,")
      .replace("guide: ,", "guide: @RootCurve,");
    state = session.setInvocationText(target.definitionStatementId, completeText);
    expect(state?.preview.kind).toBe("current");
    expect(targetParameter(state!, "width")).toMatchObject({ value: "45", active: true });
    expect(targetParameter(state!, "label")).toMatchObject({ value: "", active: false });
    expect(targetParameter(state!, "note")).toMatchObject({ value: "", active: false });
    expect(state?.preview.kind === "current" &&
      state.preview.result.moduleSemanticAnalysis.instances.some((instance) =>
        instance.parameterBindings.some((binding) => binding.parameterName === "label" && binding.state === "defaulted")
      )).toBe(true);

    const withInvalidExpression = completeText.replace("width: 45", "width: (");
    state = session.setInvocationText(target.definitionStatementId, withInvalidExpression);
    expect(state?.preview.kind).toBe("lastGood");
    expect(state?.inputDiagnostics).toEqual([expect.objectContaining({ code: "invalid-expression", parameterIndex: 0 })]);

    const omittedRequired = completeText.replace("  width: 45,", "  // width: 45,");
    state = session.setInvocationText(target.definitionStatementId, omittedRequired);
    expect(state?.preview.kind).toBe("lastGood");
    expect(state?.inputDiagnostics).toEqual([expect.objectContaining({ code: "required-value-missing", parameterIndex: 0 })]);
  });

  it("treats uncommented authored default text as caller text and commenting it restores omission", () => {
    const source = [
      "nui 1",
      "module Pocket(base: number, width: number = @base * 2, note: string?) {",
      "  point P = coordinate(x: @width, y: 0)",
      "}"
    ].join("\n");
    const compiled = compileWithIds(source);
    const target = targetAt(source, compiled, "module Pocket");
    if (!target) throw new Error("expected Pocket");
    const session = createModulePreviewSession();
    let state = session.activate({
      source: { normalizedSource: source, sourceRevision: 41 },
      semantic: { sourceRevision: 41, compiled },
      target
    });
    const block = blockFor(state!, target.definitionStatementId);
    const explicit = block.text.replace("base: ,", "base: 3,").replace("// width: @base * 2", "width: @base * 2");
    state = session.setInvocationText(target.definitionStatementId, explicit);
    expect(state?.preview.kind).toBe("noValidPreview");
    expect(targetParameter(state!, "width")).toMatchObject({ value: "@base * 2", active: true });
    const omitted = explicit.replace("  width: @base * 2,", "  // width: @base * 2,");
    state = session.setInvocationText(target.definitionStatementId, omitted);
    expect(state?.preview.kind).toBe("current");
    expect(targetParameter(state!, "width")).toMatchObject({ value: "", active: false });
  });

  it("keeps nested context blocks outermost-to-innermost and restores exact state per target", () => {
    const source = modulePreviewAggregateSource;
    const compiled = compileWithIds(source);
    const alternate = targetAt(source, compiled, "module Alternate");
    const target = targetAt(source, compiled, "module PreviewTarget");
    if (!alternate || !target) throw new Error("expected two targets");
    const session = createModulePreviewSession();
    let state = session.activate({ source: { normalizedSource: source, sourceRevision: 41 }, semantic: { sourceRevision: 41, compiled }, target });
    const targetBlock = blockFor(state!, target.definitionStatementId);
    const edited = targetBlock.text
      .replace("width: ,", "width: 45,")
      .replace("anchor: ,", "anchor: @RootA,")
      .replace("edge: ,", "edge: @RootLine,")
      .replace("guide: ,", "guide: @RootCurve,");
    state = session.setInvocationText(target.definitionStatementId, edited);
    expect(state?.invocation.blocks.at(-1)?.kind).toBe("target");
    expect(state?.invocation.blocks.map((block) => block.kind)).toEqual(["target"]);
    state = session.activate({ source: { normalizedSource: source, sourceRevision: 41 }, semantic: { sourceRevision: 41, compiled }, target: alternate });
    expect(state?.invocation.blocks.at(-1)?.definitionStatementId).toBe(alternate.definitionStatementId);
    state = session.activate({ source: { normalizedSource: source, sourceRevision: 41 }, semantic: { sourceRevision: 41, compiled }, target });
    expect(blockFor(state!, target.definitionStatementId).text).toBe(edited);
  });

  it("represents actual nested module ownership as Context blocks", () => {
    const source = [
      "nui 1",
      "module Outer(scale: number) {",
      "  module Middle(offset: number) {",
      "    module Inner(width: number) {",
      "      point P = coordinate(x: @width, y: 0)",
      "    }",
      "  }",
      "}"
    ].join("\n");
    const compiled = compileWithIds(source);
    const target = targetAt(source, compiled, "point P");
    if (!target) throw new Error("expected nested target");
    const state = createModulePreviewSession().activate({
      source: { normalizedSource: source, sourceRevision: 41 },
      semantic: { sourceRevision: 41, compiled },
      target
    });
    expect(state?.invocation.blocks.map((block) => block.kind)).toEqual(["ancestor", "ancestor", "target"]);
    expect(state?.invocation.blocks.map((block) => block.name)).toEqual(["Outer", "Middle", "Inner"]);
    expect(state?.ancestorContexts.map((group) => group.name)).toEqual(["Outer", "Middle"]);
  });

  it("keeps removed required arguments invalid and restores the exact empty buffer", () => {
    const source = [
      "nui 1",
      "module Required(width: number) {",
      "  point P = coordinate(x: @width, y: 0)",
      "}"
    ].join("\n");
    const sourceRevision = 41;
    const compiled = compileWithIds(source, sourceRevision);
    const target = targetAt(source, compiled, "point P", sourceRevision);
    if (!target) throw new Error("expected Required target");
    const session = createModulePreviewSession();
    session.activate({
      source: { normalizedSource: source, sourceRevision },
      semantic: { sourceRevision, compiled },
      target
    });
    let state = session.setInvocationText(target.definitionStatementId, "");
    expect(state?.invocation.blocks[0]?.text).toBe("");
    expect(state?.preview.kind).toBe("noValidPreview");
    expect(state?.inputDiagnostics).toEqual([expect.objectContaining({
      code: "required-value-missing",
      parameterIndex: 0
    })]);
    state = session.activate({
      source: { normalizedSource: source, sourceRevision },
      semantic: { sourceRevision, compiled },
      target
    });
    expect(state?.invocation.blocks[0]?.text).toBe("");
    expect(state?.preview.kind).toBe("noValidPreview");
  });
});
