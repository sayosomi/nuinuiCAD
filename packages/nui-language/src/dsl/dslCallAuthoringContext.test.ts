import { describe, expect, it, vi } from "vitest";
import * as logicalStatementSourceMap from "./logicalStatementSourceMap";
import { dslCallAuthoringContextAt } from "./dslCallAuthoringContext";
import { compileDslDocument } from "./dslDocument";
import { queryDslReferencePickTargetResolution } from "./dslReferencePickQuery";

describe("call authoring physical label spans", () => {
  it("keeps the exact D1 reduced label before whitespace and a colon", () => {
    // Same frozen D1 source as the public query matrix; no additional exploration unit.
    const source = "nui 1\nconst a: number = spreadAngle(spread : 1, length: 1)";
    const from = source.indexOf("spread :");
    const context = dslCallAuthoringContextAt(
      { normalizedSource: source, sourceRevision: 7 },
      source.indexOf("1, length")
    );
    expect(context?.argument.label).toEqual({ from, to: from + 6 });
    expect(source.slice(context!.argument.label!.from, context!.argument.label!.to)).toBe("spread");
    expect(context?.sourceRevision).toBe(7);
  });

  it("consumes a caller-validated canonical map and keeps standalone lookup available", () => {
    const source = "nui 1\nconst a: number = spreadAngle(spread: 1, length: 1)";
    const snapshot = { normalizedSource: source, sourceRevision: 8 };
    const map = logicalStatementSourceMap.createLogicalStatementSourceMap(snapshot);
    const createMap = vi.spyOn(logicalStatementSourceMap, "createLogicalStatementSourceMap");
    const position = source.indexOf("1, length");
    const mapped = dslCallAuthoringContextAt(snapshot, position, {
      sourceMap: map,
      statement: map.statements[1],
      statementIndex: 1
    });

    expect(mapped).toMatchObject({
      kind: "builtin",
      callee: { name: "spreadAngle" },
      argument: { index: 0 },
      sourceOrderAnchor: { statementIndex: 1 },
      sourceRevision: 8
    });
    expect(createMap).not.toHaveBeenCalled();

    const standalone = dslCallAuthoringContextAt(snapshot, position);
    expect(standalone).toMatchObject({
      kind: "builtin",
      callee: { name: "spreadAngle" },
      argument: { index: 0 },
      sourceOrderAnchor: { statementIndex: 1 },
      sourceRevision: 8
    });
    expect(createMap).toHaveBeenCalledTimes(1);
    createMap.mockRestore();
  });

  it("builds one canonical map per Reference Pick query regardless of physical-line length", () => {
    const shortTargetLine = "point P = offset(from: @A, dx: 10 + 5, dy: 0)";
    const longTargetLine = "point P = offset(from: @A, dx: " + " ".repeat(128) + "10 + 5, dy: 0)";
    const sourceFor = (targetLine: string): string => [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 20, y: 0)",
      "line Base = segment(start: @A, end: @B)",
      targetLine,
      ...Array.from({ length: 1000 }, (_, index) => `// filler ${index}`)
    ].join("\n");
    const queries = [shortTargetLine, longTargetLine].map((targetLine) => {
      const source = sourceFor(targetLine);
      const compiled = compileDslDocument(source, { sourceRevision: 17 });
      return {
        source: { normalizedSource: source, sourceRevision: 17 },
        position: source.indexOf(targetLine),
        semantic: { sourceRevision: 17, compiled }
      };
    });
    const createMap = vi.spyOn(logicalStatementSourceMap, "createLogicalStatementSourceMap");

    for (const query of queries) {
      const result = queryDslReferencePickTargetResolution(query);
      expect(result.kind).toBe("ambiguous");
    }

    expect(createMap).toHaveBeenCalledTimes(2);
    createMap.mockRestore();
  });
});
