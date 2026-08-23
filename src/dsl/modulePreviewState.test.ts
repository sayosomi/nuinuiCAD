import { describe, expect, it } from "vitest";
import { compileDslDocument, type CompiledDslDocument } from "./dslDocument";
import { parseDslSnapshot } from "./dslParser";
import { createModulePreviewSession } from "./modulePreviewState";
import { queryModulePreviewTarget } from "./modulePreviewTarget";

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

const targetParameter = (state: NonNullable<ReturnType<ReturnType<typeof createModulePreviewSession>["getState"]>>, name: string) =>
  state.parameters.parameters.find((parameter) => parameter.name === name);

describe("createModulePreviewSession", () => {
  it("restores expression text per exact Module definition and keeps last-good data across invalid input", () => {
    const source = [
      "nui 4",
      "module A(width: number, doubled: number = @width * 2, note?: string) {",
      "  point PA = coordinate(x: @doubled, y: 0)",
      "}",
      "module B(size: number) {",
      "  point PB = coordinate(x: @size, y: 0)",
      "}"
    ].join("\n");
    const original = source;
    const compiled = compileWithIds(source);
    const targetA = targetAt(source, compiled, "point PA");
    const targetB = targetAt(source, compiled, "point PB");
    expect(targetA).not.toBeNull();
    expect(targetB).not.toBeNull();
    if (!targetA || !targetB) throw new Error("expected preview targets");

    const session = createModulePreviewSession();
    let state = session.activate({
      source: { normalizedSource: source, sourceRevision: 41 },
      semantic: { sourceRevision: 41, compiled },
      target: targetA
    });
    expect(state?.preview.kind).toBe("noValidPreview");
    expect(state?.inputDiagnostics.map((diagnostic) => diagnostic.code)).toEqual(["required-value-missing"]);

    state = session.setValue(targetA.definitionStatementId, 0, "1 + 2");
    expect(state?.preview.kind).toBe("current");
    expect(targetParameter(state!, "width")?.value).toBe("1 + 2");
    expect(targetParameter(state!, "doubled")).toMatchObject({ value: "", defaultSourceText: "@width * 2" });
    expect(targetParameter(state!, "note")?.value).toBe("");

    state = session.activate({
      source: { normalizedSource: source, sourceRevision: 41 },
      semantic: { sourceRevision: 41, compiled },
      target: targetB
    });
    expect(state?.preview.kind).toBe("noValidPreview");
    state = session.setValue(targetB.definitionStatementId, 0, "9");
    expect(state?.preview.kind).toBe("current");

    state = session.activate({
      source: { normalizedSource: source, sourceRevision: 41 },
      semantic: { sourceRevision: 41, compiled },
      target: targetA
    });
    expect(targetParameter(state!, "width")?.value).toBe("1 + 2");
    expect(state?.preview.kind).toBe("current");

    state = session.setValue(targetA.definitionStatementId, 0, "(");
    expect(targetParameter(state!, "width")?.value).toBe("(");
    expect(state?.preview.kind).toBe("lastGood");
    expect(state?.inputDiagnostics).toHaveLength(1);
    expect(state?.inputDiagnostics[0]).toMatchObject({ code: "invalid-expression", parameterIndex: 0 });

    state = session.setValue(targetA.definitionStatementId, 0, "");
    expect(state?.preview.kind).toBe("lastGood");
    expect(state?.inputDiagnostics[0]?.code).toBe("required-value-missing");
    expect(source).toBe(original);
  });

  it("models nested ancestor contexts outer-to-inner and preserves caller-side expressions", () => {
    const source = [
      "nui 4",
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
    expect(target).not.toBeNull();
    if (!target) throw new Error("expected preview target");
    const analysis = compiled.moduleSemanticAnalysis;
    const outer = analysis?.definitions.find((definition) => definition.name === "Outer");
    const middle = analysis?.definitions.find((definition) => definition.name === "Middle");
    expect(outer).toBeDefined();
    expect(middle).toBeDefined();
    if (!outer || !middle) throw new Error("expected ancestors");

    const session = createModulePreviewSession();
    let state = session.activate({
      source: { normalizedSource: source, sourceRevision: 41 },
      semantic: { sourceRevision: 41, compiled },
      target
    });
    expect(state?.ancestorContexts.map((group) => group.name)).toEqual(["Outer", "Middle"]);
    expect(state?.parameters.name).toBe("Inner");

    state = session.setValue(outer.statementId, 0, "2");
    state = session.setValue(middle.statementId, 0, "@scale + 3");
    state = session.setValue(target.definitionStatementId, 0, "@offset * 4");
    expect(state?.preview.kind).toBe("current");
    expect(state?.ancestorContexts[1]?.parameters[0]?.value).toBe("@scale + 3");
    expect(state?.parameters.parameters[0]?.value).toBe("@offset * 4");
  });

  it("evaluates dependent defaults through the preview scalar runtime before making them explicit", () => {
    const source = [
      "nui 4",
      "module Pocket(base: number, width: number = @base * 2) {",
      "  point P = coordinate(x: @width, y: 0)",
      "}"
    ].join("\n");
    const compiled = compileWithIds(source);
    const target = targetAt(source, compiled, "point P");
    expect(target).not.toBeNull();
    if (!target) throw new Error("expected preview target");

    const session = createModulePreviewSession();
    session.activate({
      source: { normalizedSource: source, sourceRevision: 41 },
      semantic: { sourceRevision: 41, compiled },
      target
    });
    let state = session.setValue(target.definitionStatementId, 0, "3");
    expect(state?.preview.kind).toBe("current");
    expect(targetParameter(state!, "width")?.defaultSourceText).toBe("@base * 2");

    const action = session.useDefaultExplicitly(target.definitionStatementId, 1);
    expect(action.applied).toBe(true);
    state = action.state;
    expect(targetParameter(state!, "width")?.value).toBe("6");
    expect(state?.preview.kind).toBe("current");
  });

  it("fails closed when a default cannot be safely serialized and rejects stale semantic snapshots", () => {
    const source = [
      "nui 4",
      "point Origin = coordinate(x: 7, y: 0)",
      "module Project(p: point, x: number = @p.x) {",
      "  point P = coordinate(x: @x, y: 0)",
      "}"
    ].join("\n");
    const compiled = compileWithIds(source);
    const target = targetAt(source, compiled, "point P");
    expect(target).not.toBeNull();
    if (!target) throw new Error("expected preview target");

    const session = createModulePreviewSession();
    let state = session.activate({
      source: { normalizedSource: source, sourceRevision: 41 },
      semantic: { sourceRevision: 41, compiled },
      target
    });
    state = session.setValue(target.definitionStatementId, 0, "Origin");
    expect(state?.preview.kind).toBe("current");
    const action = session.useDefaultExplicitly(target.definitionStatementId, 1);
    expect(action.applied).toBe(false);
    expect(targetParameter(action.state!, "x")?.value).toBe("");

    expect(session.activate({
      source: { normalizedSource: source, sourceRevision: 42 },
      semantic: { sourceRevision: 41, compiled },
      target
    })).toBeNull();
    expect(session.getState()).toBe(action.state);
  });
});
