import { describe, expect, it } from "vitest";
import { compileDslDocument, parseDslSnapshot, type CompiledDslDocument } from "@nuinuicad/nui-language";
import { createModulePreviewSession } from "./modulePreviewState";
import { queryModulePreviewTarget } from "./modulePreviewTarget";

const fixture = () => {
  const source = [
    "nui 1",
    "module Pair(a: number, b: number) {",
    "  point P = coordinate(x: @a, y: @b)",
    "}"
  ].join("\n");
  const sourceRevision = 23;
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision });
  const compiled: CompiledDslDocument = compileDslDocument(source, {
    preparsed: parsed,
    sourceRevision,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `diagnostic:${index}`]))
  });
  const target = queryModulePreviewTarget({
    source: { normalizedSource: source, sourceRevision },
    position: source.indexOf("point P") + 3,
    semantic: { sourceRevision, compiled }
  });
  if (!target) throw new Error("expected preview target");
  return { source, sourceRevision, compiled, target };
};

describe("Module Preview direct value diagnostics", () => {
  it("retains diagnostic ownership while other value sites change", () => {
    const { source, sourceRevision, compiled, target } = fixture();
    const session = createModulePreviewSession();
    session.activate({
      source: { normalizedSource: source, sourceRevision },
      semantic: { sourceRevision, compiled },
      target
    });
    session.setParameterValue(target.definitionStatementId, 0, "1");
    let state = session.setParameterValue(target.definitionStatementId, 1, "2");
    expect(state?.preview.kind).toBe("current");

    state = session.setParameterValue(target.definitionStatementId, 0, "(");
    expect(state?.preview.kind).toBe("lastGood");
    expect(state?.inputDiagnostics.map((diagnostic) => diagnostic.parameterIndex)).toEqual([0]);

    state = session.setParameterValue(target.definitionStatementId, 1, "3");
    expect(state?.preview.kind).toBe("lastGood");
    expect(state?.inputDiagnostics.map((diagnostic) => diagnostic.parameterIndex)).toEqual([0]);
    expect(state?.parameters.parameters[1]?.diagnostic).toBeNull();

    state = session.setParameterValue(target.definitionStatementId, 1, "(");
    expect(state?.inputDiagnostics.map((diagnostic) => diagnostic.parameterIndex)).toEqual([0, 1]);

    state = session.setParameterValue(target.definitionStatementId, 0, "4");
    expect(state?.inputDiagnostics.map((diagnostic) => diagnostic.parameterIndex)).toEqual([1]);
    state = session.setParameterValue(target.definitionStatementId, 1, "5");
    expect(state?.preview.kind).toBe("current");
    expect(state?.inputDiagnostics).toEqual([]);
  });
});
