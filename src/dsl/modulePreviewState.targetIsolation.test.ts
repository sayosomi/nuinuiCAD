import { describe, expect, it } from "vitest";
import { compileDslDocument, parseDslSnapshot } from "@nuinuicad/nui-language";
import { createModulePreviewSession } from "./modulePreviewState";
import { queryModulePreviewTarget } from "./modulePreviewTarget";

describe("Module Preview target-scoped invocation state", () => {
  it("restores sibling targets with their own ancestor-context text", () => {
    const source = [
      "nui 1",
      "module Outer(scale: number) {",
      "  module A(width: number) {",
      "    point PA = coordinate(x: @width, y: 0)",
      "  }",
      "  module B(width: number) {",
      "    point PB = coordinate(x: @width, y: 0)",
      "  }",
      "}"
    ].join("\n");
    const sourceRevision = 31;
    const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision });
    const compiled = compileDslDocument(source, { preparsed: parsed, sourceRevision, assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `target-state:${index}`])) });
    const targetAt = (needle: string) => queryModulePreviewTarget({ source: { normalizedSource: source, sourceRevision }, position: source.indexOf(needle) + 3, semantic: { sourceRevision, compiled } });
    const targetA = targetAt("point PA");
    const targetB = targetAt("point PB");
    if (!targetA || !targetB) throw new Error("expected sibling preview targets");
    const outer = compiled.moduleSemanticAnalysis?.definitions.find((definition) => definition.name === "Outer");
    if (!outer) throw new Error("expected Outer definition");
    const session = createModulePreviewSession();
    let state = session.activate({ source: { normalizedSource: source, sourceRevision }, semantic: { sourceRevision, compiled }, target: targetA });
    const outerBlock = state!.invocation.blocks.find((block) => block.definitionStatementId === outer.statementId)!;
    const targetABlock = state!.invocation.blocks.at(-1)!;
    state = session.setInvocationText(outer.statementId, outerBlock.text.replace("scale: ", "scale: 2"));
    state = session.setInvocationText(targetA.definitionStatementId, state!.invocation.blocks.at(-1)!.text.replace("width: ", "width: 3"));
    expect(state?.preview.kind).toBe("current");
    state = session.activate({ source: { normalizedSource: source, sourceRevision }, semantic: { sourceRevision, compiled }, target: targetB });
    expect(state?.ancestorContexts[0]?.parameters[0]?.value).toBe("");
    state = session.activate({ source: { normalizedSource: source, sourceRevision }, semantic: { sourceRevision, compiled }, target: targetA });
    expect(state?.ancestorContexts[0]?.parameters[0]?.value).toBe("2");
    expect(state?.parameters.parameters[0]?.value).toBe("3");
    expect(targetABlock.definitionStatementId).toBe(targetA.definitionStatementId);
  });
});
