import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { parseDslSnapshot } from "../dsl/dslParser";
import { createModulePreviewSession } from "../dsl/modulePreviewState";
import { queryModulePreviewTarget } from "../dsl/modulePreviewTarget";
import { modulePreviewParameterSnapshotFor } from "./modulePreviewParameterProjection";

const source = [
  "nui 1",
  "module Outer(scale: number(step: 2, min: 1, max: 9)) {",
  "  module Inner(width: number(step: 0.5, min: 0, max: 10), plain: number) {",
  "    point P = coordinate(x: @width, y: 0)",
  "  }",
  "}"
].join("\n");

const compiled = (() => {
  const sourceRevision = 12;
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision });
  return compileDslDocument(source, {
    preparsed: parsed,
    sourceRevision,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `module-preview-metadata:${index}`]))
  });
})();

describe("Module Preview parameter metadata projection", () => {
  it("preserves compiler-owned numeric options through semantic state and both Preview groups", () => {
    const analysis = compiled.moduleSemanticAnalysis;
    const outer = analysis?.definitions.find((definition) => definition.name === "Outer");
    const inner = analysis?.definitions.find((definition) => definition.name === "Inner");
    expect(outer?.parameters[0]?.numericTypeOptions).toEqual({ step: 2, min: 1, max: 9 });
    expect(inner?.parameters[0]?.numericTypeOptions).toEqual({ step: 0.5, min: 0, max: 10 });
    expect(inner?.parameters[1]?.numericTypeOptions).toBeUndefined();

    const target = queryModulePreviewTarget({
      source: { normalizedSource: source, sourceRevision: 12 },
      position: source.indexOf("point P") + 3,
      semantic: { sourceRevision: 12, compiled }
    });
    expect(target).not.toBeNull();
    if (!target || !outer || !inner) throw new Error("expected nested Module Preview target");

    const state = createModulePreviewSession().activate({
      source: { normalizedSource: source, sourceRevision: 12 },
      semantic: { sourceRevision: 12, compiled },
      target
    });
    expect(state?.ancestorContexts[0]?.parameters[0]?.numericTypeOptions).toEqual({ step: 2, min: 1, max: 9 });
    expect(state?.parameters.parameters[0]?.numericTypeOptions).toEqual({ step: 0.5, min: 0, max: 10 });
    expect(state?.parameters.parameters[1]?.numericTypeOptions).toBeUndefined();
  });

  it("serializes exact step, min, and max metadata without Preview defaults", () => {
    const target = queryModulePreviewTarget({
      source: { normalizedSource: source, sourceRevision: 12 },
      position: source.indexOf("point P") + 3,
      semantic: { sourceRevision: 12, compiled }
    });
    if (!target) throw new Error("expected nested Module Preview target");
    const state = createModulePreviewSession().activate({
      source: { normalizedSource: source, sourceRevision: 12 },
      semantic: { sourceRevision: 12, compiled },
      target
    });
    if (!state) throw new Error("expected Module Preview state");

    const projected = modulePreviewParameterSnapshotFor({
      snapshot: state,
      sessionId: "module-preview-session:metadata",
      documentUri: "file:///metadata.nui",
      documentVersion: 3,
      sessionRevision: 1
    });
    expect(projected.ancestorContexts[0]?.parameters[0]?.numericTypeOptions).toEqual({ step: 2, min: 1, max: 9 });
    expect(projected.parameters.parameters[0]?.numericTypeOptions).toEqual({ step: 0.5, min: 0, max: 10 });
    expect(projected.parameters.parameters[1]).not.toHaveProperty("numericTypeOptions");
  });
});
