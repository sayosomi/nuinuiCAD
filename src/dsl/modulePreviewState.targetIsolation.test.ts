import { describe, expect, it } from "vitest";
import { compileDslDocument } from "./dslDocument";
import { parseDslSnapshot } from "./dslParser";
import { createModulePreviewSession } from "./modulePreviewState";
import { queryModulePreviewTarget } from "./modulePreviewTarget";

describe("Module Preview target-scoped context state", () => {
  it("restores sibling targets with their own ancestor-context values", () => {
    const source = [
      "nui 4",
      "module Outer(scale: number) {",
      "  module A(width: number) {",
      "    point PA = coordinate(x: @scale, y: @width)",
      "  }",
      "  module B(width: number) {",
      "    point PB = coordinate(x: @scale, y: @width)",
      "  }",
      "}"
    ].join("\n");
    const sourceRevision = 31;
    const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision });
    const compiled = compileDslDocument(source, {
      preparsed: parsed,
      sourceRevision,
      assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `target-state:${index}`]))
    });
    const targetAt = (needle: string) => queryModulePreviewTarget({
      source: { normalizedSource: source, sourceRevision },
      position: source.indexOf(needle) + 3,
      semantic: { sourceRevision, compiled }
    });
    const targetA = targetAt("point PA");
    const targetB = targetAt("point PB");
    expect(targetA).not.toBeNull();
    expect(targetB).not.toBeNull();
    if (!targetA || !targetB) throw new Error("expected sibling preview targets");
    const outer = compiled.moduleSemanticAnalysis?.definitions.find((definition) => definition.name === "Outer");
    expect(outer).toBeDefined();
    if (!outer) throw new Error("expected Outer definition");

    const session = createModulePreviewSession();
    session.activate({
      source: { normalizedSource: source, sourceRevision },
      semantic: { sourceRevision, compiled },
      target: targetA
    });
    session.setValue(outer.statementId, 0, "2");
    let state = session.setValue(targetA.definitionStatementId, 0, "3");
    expect(state?.preview.kind).toBe("current");
    expect(state?.ancestorContexts[0]?.parameters[0]?.value).toBe("2");

    state = session.activate({
      source: { normalizedSource: source, sourceRevision },
      semantic: { sourceRevision, compiled },
      target: targetB
    });
    expect(state?.ancestorContexts[0]?.parameters[0]?.value).toBe("");
    expect(state?.parameters.parameters[0]?.value).toBe("");
    session.setValue(outer.statementId, 0, "7");
    state = session.setValue(targetB.definitionStatementId, 0, "8");
    expect(state?.preview.kind).toBe("current");

    state = session.activate({
      source: { normalizedSource: source, sourceRevision },
      semantic: { sourceRevision, compiled },
      target: targetA
    });
    expect(state?.ancestorContexts[0]?.parameters[0]?.value).toBe("2");
    expect(state?.parameters.parameters[0]?.value).toBe("3");
    expect(state?.preview.kind).toBe("current");
  });
});
