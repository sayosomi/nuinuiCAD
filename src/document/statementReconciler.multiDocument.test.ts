import { describe, expect, it } from "vitest";
import { parseDsl } from "../dsl/dslParser";
import { reconcileStatements } from "./statementReconciler";

const linesOf = (source: string) => source.split("\n");

describe("statement reconciler multi-document identities", () => {
  it("allocates and preserves import and file re-export identities", () => {
    const originalSource = [
      "nui 1",
      "import \"./library.nui\" as library",
      "export @library::Pocket"
    ].join("\n");
    const original = parseDsl(originalSource);
    let nextId = 0;
    const createStatementId = (kind: string) => `statement:${kind}:${++nextId}`;
    const first = reconcileStatements({
      oldStatements: [],
      oldLines: [],
      oldElementIds: new Map(),
      oldStatementIds: new Map(),
      newStatements: original.statements,
      newLines: linesOf(originalSource)
    }, { createStatementId });

    const importIndex = original.statements.findIndex((statement) => statement.kind === "import");
    const reExportIndex = original.statements.findIndex((statement) => statement.kind === "fileReExport");
    expect(first.assignedIds.get(importIndex)).toMatch(/^statement:import:/);
    expect(first.assignedIds.get(reExportIndex)).toMatch(/^statement:fileReExport:/);

    const editedSource = [
      "nui 1",
      "const marker: number = 0",
      "import \"./library.nui\" as library",
      "export @library::Pocket"
    ].join("\n");
    const edited = parseDsl(editedSource);
    const second = reconcileStatements({
      oldStatements: original.statements,
      oldLines: linesOf(originalSource),
      oldElementIds: new Map(),
      oldStatementIds: first.assignedIds,
      newStatements: edited.statements,
      newLines: linesOf(editedSource)
    }, { createStatementId });
    const editedImportIndex = edited.statements.findIndex((statement) => statement.kind === "import");
    const editedReExportIndex = edited.statements.findIndex((statement) => statement.kind === "fileReExport");

    expect(second.assignedIds.get(editedImportIndex)).toBe(first.assignedIds.get(importIndex));
    expect(second.assignedIds.get(editedReExportIndex)).toBe(first.assignedIds.get(reExportIndex));
  });
});
