import { describe, expect, it } from "vitest";
import { compileDslDocument } from "./dslDocument";
import { parseDslSnapshot } from "./dslParser";
import { createModulePreviewSession } from "./modulePreviewState";
import { queryModulePreviewTarget } from "./modulePreviewTarget";

describe("Module Preview explicit default serialization", () => {
  it("serializes string template braces, booleans, and choices as safe literals", () => {
    const source = [
      "nui 4",
      'module Defaults(label: string = "a\\{b\\}", enabled: boolean = true, side: choice(left, right) = left) {',
      "  point P = coordinate(x: 0, y: 0)",
      "}"
    ].join("\n");
    const sourceRevision = 19;
    const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision });
    const compiled = compileDslDocument(source, {
      preparsed: parsed,
      sourceRevision,
      assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `serialize:${index}`]))
    });
    const target = queryModulePreviewTarget({
      source: { normalizedSource: source, sourceRevision },
      position: source.indexOf("point P") + 3,
      semantic: { sourceRevision, compiled }
    });
    expect(target).not.toBeNull();
    if (!target) throw new Error("expected preview target");

    const session = createModulePreviewSession();
    let state = session.activate({
      source: { normalizedSource: source, sourceRevision },
      semantic: { sourceRevision, compiled },
      target
    });
    expect(state?.preview.kind).toBe("current");

    const stringDefault = session.useDefaultExplicitly(target.definitionStatementId, 0);
    expect(stringDefault.applied).toBe(true);
    state = stringDefault.state;
    expect(state?.parameters.parameters[0]?.value).toBe('"a\\{b\\}"');

    const booleanDefault = session.useDefaultExplicitly(target.definitionStatementId, 1);
    expect(booleanDefault.applied).toBe(true);
    state = booleanDefault.state;
    expect(state?.parameters.parameters[1]?.value).toBe("true");

    const choiceDefault = session.useDefaultExplicitly(target.definitionStatementId, 2);
    expect(choiceDefault.applied).toBe(true);
    state = choiceDefault.state;
    expect(state?.parameters.parameters[2]?.value).toBe("left");
    expect(state?.preview.kind).toBe("current");
  });
});
