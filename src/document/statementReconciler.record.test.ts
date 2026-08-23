import { describe, expect, it } from "vitest";
import { parseDsl } from "../dsl/dslParser";
import { reconcileStatements } from "./statementReconciler";

const recordIndex = (source: string) => {
  const parsed = parseDsl(source);
  const index = parsed.statements.findIndex((statement) => statement.kind === "recordDefinition");
  if (index < 0) throw new Error("record definition not parsed");
  return { parsed, index };
};

describe("statement reconciler record identity", () => {
  it("inherits a record definition identity across field edits", () => {
    const oldSource = ["nui 4", "record Pair(x: number)"].join("\n");
    const newSource = ["nui 4", "record Pair(x: number, label: string)"].join("\n");
    const oldRecord = recordIndex(oldSource);
    const newRecord = recordIndex(newSource);
    const result = reconcileStatements({
      oldStatements: oldRecord.parsed.statements,
      oldLines: oldSource.split("\n"),
      oldElementIds: new Map(),
      oldStatementIds: new Map([[oldRecord.index, "record:stable"]]),
      newStatements: newRecord.parsed.statements,
      newLines: newSource.split("\n")
    }, {
      createStatementId: (kind) => `created:${kind}`
    });

    expect(result.assignedIds.get(newRecord.index)).toBe("record:stable");
    expect(result.createdIds.has(newRecord.index)).toBe(false);
  });
});
