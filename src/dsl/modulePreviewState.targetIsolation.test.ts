import { describe, expect, it } from "vitest";
import { compileDslDocument, parseDslSnapshot } from "@nuinuicad/nui-language";
import { createModulePreviewSession } from "./modulePreviewState";
import { queryModulePreviewTarget } from "./modulePreviewTarget";

describe("Module Preview target-scoped value state", () => {
  it("restores sibling targets with their own ancestor-context values", () => {
    const source = [
      "nui 1",
      "module A(width: number) {",
      "  point PA = coordinate(x: @width, y: 0)",
      "}",
      "module B(width: number) {",
      "  point PB = coordinate(x: @width, y: 0)",
      "}"
    ].join("\n");
    const sourceRevision = 31;
    const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision });
    const compiled = compileDslDocument(source, { preparsed: parsed, sourceRevision, assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `target-state:${index}`])) });
    const targetAt = (needle: string) => queryModulePreviewTarget({ source: { normalizedSource: source, sourceRevision }, position: source.indexOf(needle) + 4, semantic: { sourceRevision, compiled } });
    const targetA = targetAt("module A");
    const targetB = targetAt("module B");
    if (!targetA || !targetB) throw new Error("expected sibling preview targets");
    const session = createModulePreviewSession();
    session.activate({ source: { normalizedSource: source, sourceRevision }, semantic: { sourceRevision, compiled }, target: targetA });
    let state = session.setParameterValue(targetA.definitionStatementId, 0, "3");
    expect(state?.preview.kind).toBe("current");
    state = session.activate({ source: { normalizedSource: source, sourceRevision }, semantic: { sourceRevision, compiled }, target: targetB });
    expect(state?.parameters.parameters[0]?.value).toBe("");
    state = session.activate({ source: { normalizedSource: source, sourceRevision }, semantic: { sourceRevision, compiled }, target: targetA });
    expect(state?.parameters.parameters[0]?.value).toBe("3");
  });
});
