import { describe, expect, it } from "vitest";
import { compileDslDocument, parseDslSnapshot, type CompiledDslDocument } from "@nuinuicad/nui-language";
import { createModulePreviewSession } from "./modulePreviewState";
import { queryModulePreviewTarget } from "./modulePreviewTarget";

const compileWithIds = (source: string, sourceRevision: number, idPrefix: string): CompiledDslDocument => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision });
  return compileDslDocument(source, {
    preparsed: parsed,
    sourceRevision,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `${idPrefix}:${index}`]))
  });
};

const targetAtPoint = (source: string, compiled: CompiledDslDocument, sourceRevision: number) =>
  queryModulePreviewTarget({
    source: { normalizedSource: source, sourceRevision },
    position: source.indexOf("point P") + 3,
    semantic: { sourceRevision, compiled }
  });

describe("Module Preview value freshness", () => {
  it("retains last-good state across fresh source revisions while identity survives", () => {
    const validSource = [
      "nui 1",
      "module M(width: number) {",
      "  point P = coordinate(x: @width, y: 0)",
      "}"
    ].join("\n");
    const invalidSource = validSource.replace("@width,", "@width + @missing,");
    const compiled1 = compileWithIds(validSource, 1, "stable");
    const target1 = targetAtPoint(validSource, compiled1, 1);
    if (!target1) throw new Error("expected initial target");
    const session = createModulePreviewSession();
    session.activate({ source: { normalizedSource: validSource, sourceRevision: 1 }, semantic: { sourceRevision: 1, compiled: compiled1 }, target: target1 });
    const first = session.setParameterValue(target1.definitionStatementId, 0, "4 + 1");
    expect(first?.preview.kind).toBe("current");

    const compiled2 = compileWithIds(invalidSource, 2, "stable");
    const target2 = targetAtPoint(invalidSource, compiled2, 2);
    if (!target2) throw new Error("expected fresh target");
    const state = session.activate({ source: { normalizedSource: invalidSource, sourceRevision: 2 }, semantic: { sourceRevision: 2, compiled: compiled2 }, target: target2 });
    expect(state?.parameters.parameters[0]?.value).toBe("4 + 1");
    expect(state?.preview.kind).toBe("lastGood");

    const replacement = compileWithIds(validSource, 3, "replacement");
    const target3 = targetAtPoint(validSource, replacement, 3);
    if (!target3) throw new Error("expected replacement target");
    const replaced = session.activate({ source: { normalizedSource: validSource, sourceRevision: 3 }, semantic: { sourceRevision: 3, compiled: replacement }, target: target3 });
    expect(replaced?.parameters.parameters[0]?.value).toBe("");
    expect(replaced?.preview.kind).toBe("noValidPreview");
  });
});
