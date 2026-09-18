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

const parameterFor = (state: ModulePreviewSessionSnapshot, name: string) =>
  [...state.ancestorContexts, state.parameters].flatMap((group) => group.parameters).find((parameter) => parameter.name === name);

describe("createModulePreviewSession direct Preview value ownership", () => {
  it("creates definition-order value sites with omission and required-missing semantics", () => {
    const source = modulePreviewAggregateSource;
    const compiled = compileWithIds(source);
    const target = targetAt(source, compiled, "module PreviewTarget");
    if (!target) throw new Error("expected PreviewTarget");
    const state = createModulePreviewSession().activate({
      source: { normalizedSource: source, sourceRevision: 41 },
      semantic: { sourceRevision: 41, compiled },
      target
    });
    expect(state?.parameters.parameters.map((parameter) => parameter.name)).toEqual([
      "width", "anchor", "edge", "guide", "label", "note"
    ]);
    expect(state?.parameters.parameters.slice(0, 4).every((parameter) => parameter.active)).toBe(true);
    expect(state?.parameters.parameters.slice(4).every((parameter) => !parameter.active)).toBe(true);
    expect(state?.preview.kind).toBe("noValidPreview");
    expect(state?.inputDiagnostics.map((diagnostic) => diagnostic.parameterIndex)).toEqual([0, 1, 2, 3]);
  });

  it("updates one direct expression at a time and preserves last-good/no-valid behavior", () => {
    const source = modulePreviewAggregateSource;
    const compiled = compileWithIds(source);
    const target = targetAt(source, compiled, "module PreviewTarget");
    if (!target) throw new Error("expected PreviewTarget");
    const session = createModulePreviewSession();
    session.activate({ source: { normalizedSource: source, sourceRevision: 41 }, semantic: { sourceRevision: 41, compiled }, target });
    session.setParameterValue(target.definitionStatementId, 0, "45");
    session.setParameterValue(target.definitionStatementId, 1, "@RootA");
    session.setParameterValue(target.definitionStatementId, 2, "@RootLine");
    let state = session.setParameterValue(target.definitionStatementId, 3, "@RootCurve");
    expect(state?.preview.kind).toBe("current");
    expect(parameterFor(state!, "width")).toMatchObject({ value: "45", active: true });
    expect(parameterFor(state!, "label")).toMatchObject({ value: "", active: false });

    state = session.setParameterValue(target.definitionStatementId, 0, "(");
    expect(state?.preview.kind).toBe("lastGood");
    expect(state?.inputDiagnostics).toEqual([expect.objectContaining({ code: "invalid-expression", parameterIndex: 0 })]);
    state = session.setParameterValue(target.definitionStatementId, 0, null);
    expect(state?.preview.kind).toBe("lastGood");
    expect(state?.inputDiagnostics).toEqual([expect.objectContaining({ code: "required-value-missing", parameterIndex: 0 })]);
  });

  it("clears defaulted and optional values as ordinary omission", () => {
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
    session.activate({ source: { normalizedSource: source, sourceRevision: 41 }, semantic: { sourceRevision: 41, compiled }, target });
    session.setParameterValue(target.definitionStatementId, 0, "3");
    let state = session.setParameterValue(target.definitionStatementId, 1, "@base * 2");
    expect(parameterFor(state!, "width")).toMatchObject({ value: "@base * 2", active: true });
    state = session.setParameterValue(target.definitionStatementId, 1, null);
    expect(parameterFor(state!, "width")).toMatchObject({ value: "", active: false });
    session.setParameterValue(target.definitionStatementId, 2, "\"note\"");
    state = session.setParameterValue(target.definitionStatementId, 2, null);
    expect(parameterFor(state!, "note")).toMatchObject({ value: "", active: false });
  });

  it("keeps nested groups outermost-to-innermost and restores exact state per target", () => {
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
    const session = createModulePreviewSession();
    const state = session.activate({ source: { normalizedSource: source, sourceRevision: 41 }, semantic: { sourceRevision: 41, compiled }, target });
    expect([...state!.ancestorContexts.map((group) => group.name), state!.parameters.name]).toEqual(["Outer", "Middle", "Inner"]);
    expect(state!.ancestorContexts.flatMap((group) => group.parameters).map((parameter) => parameter.name)).toEqual(["scale", "offset"]);
  });

  it("restores per-target values and keeps a cleared required site invalid", () => {
    const source = [
      "nui 1",
      "module A(width: number) {",
      "  point PA = coordinate(x: @width, y: 0)",
      "}",
      "module B(width: number) {",
      "  point PB = coordinate(x: @width, y: 0)",
      "}"
    ].join("\n");
    const compiled = compileWithIds(source, 31);
    const targetA = targetAt(source, compiled, "point PA", 31);
    const targetB = targetAt(source, compiled, "point PB", 31);
    if (!targetA || !targetB) throw new Error("expected sibling targets");
    const session = createModulePreviewSession();
    session.activate({ source: { normalizedSource: source, sourceRevision: 31 }, semantic: { sourceRevision: 31, compiled }, target: targetA });
    session.setParameterValue(targetA.definitionStatementId, 0, "3");
    let state = session.activate({ source: { normalizedSource: source, sourceRevision: 31 }, semantic: { sourceRevision: 31, compiled }, target: targetB });
    expect(state?.parameters.parameters[0]?.value).toBe("");
    state = session.activate({ source: { normalizedSource: source, sourceRevision: 31 }, semantic: { sourceRevision: 31, compiled }, target: targetA });
    expect(state?.parameters.parameters[0]?.value).toBe("3");
    state = session.setParameterValue(targetA.definitionStatementId, 0, null);
    expect(state?.preview.kind).toBe("lastGood");
    expect(state?.inputDiagnostics).toEqual([expect.objectContaining({ code: "required-value-missing", parameterIndex: 0 })]);
  });
});
