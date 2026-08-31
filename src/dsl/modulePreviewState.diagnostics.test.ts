import { describe, expect, it } from "vitest";
import { compileDslDocument } from "./dslDocument";
import { parseDslSnapshot } from "./dslParser";
import { createModulePreviewSession } from "./modulePreviewState";
import { queryModulePreviewTarget } from "./modulePreviewTarget";

const pairFixture = () => {
  const source = [
    "nui 1",
    "module Pair(a: number, b: number) {",
    "  point P = coordinate(x: @a, y: @b)",
    "}"
  ].join("\n");
  const sourceRevision = 23;
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision });
  const compiled = compileDslDocument(source, {
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

describe("Module Preview input diagnostics", () => {
  it("does not blame a valid edited field for another field's existing invalid expression", () => {
    const { source, sourceRevision, compiled, target } = pairFixture();
    const session = createModulePreviewSession();
    session.activate({
      source: { normalizedSource: source, sourceRevision },
      semantic: { sourceRevision, compiled },
      target
    });
    session.setValue(target.definitionStatementId, 0, "1");
    let state = session.setValue(target.definitionStatementId, 1, "2");
    expect(state?.preview.kind).toBe("current");

    state = session.setValue(target.definitionStatementId, 0, "(");
    expect(state?.preview.kind).toBe("lastGood");
    expect(state?.inputDiagnostics.map((diagnostic) => diagnostic.parameterIndex)).toEqual([0]);

    state = session.setValue(target.definitionStatementId, 1, "3");
    expect(state?.preview.kind).toBe("lastGood");
    expect(state?.inputDiagnostics.map((diagnostic) => diagnostic.parameterIndex)).toEqual([0]);
    expect(state?.parameters.parameters[1]?.diagnostic).toBeNull();

    state = session.setValue(target.definitionStatementId, 1, "(");
    expect(state?.inputDiagnostics.map((diagnostic) => diagnostic.parameterIndex)).toEqual([0, 1]);

    state = session.setValue(target.definitionStatementId, 0, "4");
    expect(state?.inputDiagnostics.map((diagnostic) => diagnostic.parameterIndex)).toEqual([1]);
    state = session.setValue(target.definitionStatementId, 1, "5");
    expect(state?.preview.kind).toBe("current");
    expect(state?.inputDiagnostics).toEqual([]);
  });

  it("keeps diagnostic ownership when an invalid edit was initially masked by another required empty field", () => {
    const { source, sourceRevision, compiled, target } = pairFixture();
    const session = createModulePreviewSession();
    session.activate({
      source: { normalizedSource: source, sourceRevision },
      semantic: { sourceRevision, compiled },
      target
    });

    let state = session.setValue(target.definitionStatementId, 0, "(");
    expect(state?.preview.kind).toBe("noValidPreview");
    expect(state?.inputDiagnostics.map((diagnostic) => [diagnostic.parameterIndex, diagnostic.code])).toEqual([
      [1, "required-value-missing"],
      [0, "invalid-expression"]
    ]);

    state = session.setValue(target.definitionStatementId, 1, "2");
    expect(state?.preview.kind).toBe("noValidPreview");
    expect(state?.inputDiagnostics.map((diagnostic) => [diagnostic.parameterIndex, diagnostic.code])).toEqual([
      [0, "invalid-expression"]
    ]);
    expect(state?.parameters.parameters[1]?.diagnostic).toBeNull();

    state = session.setValue(target.definitionStatementId, 0, "1");
    expect(state?.preview.kind).toBe("current");
    expect(state?.inputDiagnostics).toEqual([]);
  });
});
