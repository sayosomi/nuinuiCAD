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

const edit = (text: string, name: string, expression: string): string =>
  text.replace(new RegExp(`  ${name}: [^\\n]*`), `  ${name}: ${expression},`);

describe("Module Preview invocation diagnostics", () => {
  it("retains diagnostic ownership while other invocation arguments change", () => {
    const { source, sourceRevision, compiled, target } = fixture();
    const session = createModulePreviewSession();
    let state = session.activate({
      source: { normalizedSource: source, sourceRevision },
      semantic: { sourceRevision, compiled },
      target
    });
    const initial = state!.invocation.blocks[0]!.text;
    state = session.setInvocationText(target.definitionStatementId, edit(edit(initial, "a", "1"), "b", "2"));
    expect(state?.preview.kind).toBe("current");

    const invalidA = edit(edit(initial, "a", "("), "b", "2");
    state = session.setInvocationText(target.definitionStatementId, invalidA);
    expect(state?.preview.kind).toBe("lastGood");
    expect(state?.inputDiagnostics.map((diagnostic) => diagnostic.parameterIndex)).toEqual([0]);

    state = session.setInvocationText(target.definitionStatementId, edit(invalidA, "b", "3"));
    expect(state?.preview.kind).toBe("lastGood");
    expect(state?.inputDiagnostics.map((diagnostic) => diagnostic.parameterIndex)).toEqual([0]);
    expect(state?.parameters.parameters[1]?.diagnostic).toBeNull();

    const invalidBoth = edit(invalidA, "b", "(");
    state = session.setInvocationText(target.definitionStatementId, invalidBoth);
    expect(state?.inputDiagnostics.map((diagnostic) => diagnostic.parameterIndex)).toEqual([0, 1]);

    state = session.setInvocationText(target.definitionStatementId, edit(invalidBoth, "a", "4"));
    expect(state?.inputDiagnostics.map((diagnostic) => diagnostic.parameterIndex)).toEqual([1]);
    state = session.setInvocationText(target.definitionStatementId, edit(invalidBoth, "a", "4").replace("b: (", "b: 5"));
    expect(state?.preview.kind).toBe("current");
    expect(state?.inputDiagnostics).toEqual([]);
  });
});
