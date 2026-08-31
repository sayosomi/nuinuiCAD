import { describe, expect, it } from "vitest";
import { parseDslSnapshot } from "../dsl/dslParser";
import type { SourceSnapshot } from "../dsl/logicalStatementSourceMap";
import type { LineSplice } from "./textPatch";
import {
  planDrawingModifierBatchAssignment,
  type DrawingModifierSourceTarget
} from "./drawingModifierBatchAssignment";

const sourceLines = (...lines: string[]) => lines.join("\n");

const applyLineSplices = (source: string, splices: readonly LineSplice[]) => {
  const lines = source.split("\n");
  for (const splice of [...splices].sort((left, right) => right.startLine - left.startLine)) {
    const deleteCount = splice.endLine >= splice.startLine
      ? splice.endLine - splice.startLine + 1
      : 0;
    lines.splice(splice.startLine - 1, deleteCount, ...splice.replacementLines);
  }
  return lines.join("\n");
};

describe("drawing modifier batch assignment multi-target remove", () => {
  it("removes the requested direct modifier from multiple targets in one batch", () => {
    const sourceText = sourceLines(
      "nui 1",
      "modifier Guide {",
      "  state: visible,",
      "}",
      "modifier Keep {",
      "  state: visible,",
      "}",
      "point A [Guide, Keep] = coordinate(x: 0, y: 0)",
      "group G [Keep, Guide] {",
      "}"
    );
    const source: SourceSnapshot = { normalizedSource: sourceText, sourceRevision: 23 };
    const parsed = parseDslSnapshot(source);
    const target = (name: string): DrawingModifierSourceTarget => {
      const sourceStatementIndex = parsed.statements.findIndex((statement) => statement.name === name);
      if (sourceStatementIndex < 0) throw new Error(`missing statement ${name}`);
      return { sourceStatementIndex, sourceRevision: source.sourceRevision };
    };

    const result = planDrawingModifierBatchAssignment({
      source,
      parsed,
      targets: [target("A"), target("G")],
      operation: { kind: "remove", modifierName: "Guide" }
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`unexpected plan failure: ${result.reason}`);
    expect(result.plan.targetCount).toBe(2);
    expect(result.plan.changedTargetCount).toBe(2);

    const updatedSource = applyLineSplices(sourceText, result.plan.splices);
    const updated = parseDslSnapshot({ normalizedSource: updatedSource, sourceRevision: 24 });
    expect(updated.statements.find((statement) => statement.name === "A")?.modifierNames).toEqual(["Keep"]);
    expect(updated.statements.find((statement) => statement.name === "G")?.modifierNames).toEqual(["Keep"]);
  });
});
