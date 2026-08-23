import { describe, expect, it } from "vitest";
import { compileDslDocument, type CompiledDslDocument } from "../dsl/dslDocument";
import { parseDslSnapshot } from "../dsl/dslParser";
import { queryModulePreviewTarget } from "../dsl/modulePreviewTarget";
import type { StatementIdentity } from "../document/statementIdentity";
import { currentModulePreviewTargetByIdentity } from "./modulePreviewLifecycle";

const compileWithIds = (
  source: string,
  ids: readonly string[],
  sourceRevision: number
): CompiledDslDocument => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision });
  return compileDslDocument(source, {
    preparsed: parsed,
    sourceRevision,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, ids[index] ?? `preview-life:${index}`]))
  });
};

const sourceSnapshot = (source: string, sourceRevision: number) => ({
  normalizedSource: source,
  sourceRevision
});

const semanticSnapshot = (source: string, compiled: CompiledDslDocument, sourceRevision: number) => ({
  sourceRevision,
  sourceText: source,
  compiled
});

describe("currentModulePreviewTargetByIdentity", () => {
  it("keeps the same definition across a valid rename and reports the current source offset", () => {
    const initial = [
      "nui 4",
      "module Pocket() {",
      "  point P = coordinate(x: 0, y: 0)",
      "}"
    ].join("\n");
    const ids = ["version", "module-pocket", "point-p", "end-pocket"];
    const initialCompiled = compileWithIds(initial, ids, 5);
    const initialTarget = queryModulePreviewTarget({
      source: sourceSnapshot(initial, 5),
      position: initial.indexOf("point P"),
      semantic: semanticSnapshot(initial, initialCompiled, 5)
    });
    expect(initialTarget?.definitionStatementId).toBe("module-pocket");

    const renamed = initial.replace("module Pocket", "module Renamed");
    const renamedCompiled = compileWithIds(renamed, ids, 6);
    const refreshed = currentModulePreviewTargetByIdentity({
      source: sourceSnapshot(renamed, 6),
      semantic: semanticSnapshot(renamed, renamedCompiled, 6),
      definitionStatementId: "module-pocket" as StatementIdentity
    });

    expect(refreshed?.target).toMatchObject({
      definitionStatementId: "module-pocket",
      name: "Renamed"
    });
    expect(refreshed?.normalizedSourceOffset).toBe(renamed.indexOf("module Renamed"));
  });

  it("keeps innermost nested Module identity rather than rebinding to an ancestor", () => {
    const source = [
      "nui 4",
      "module Outer() {",
      "  module Inner() {",
      "    point P = coordinate(x: 0, y: 0)",
      "  }",
      "}"
    ].join("\n");
    const compiled = compileWithIds(
      source,
      ["version", "outer", "inner", "point", "inner-end", "outer-end"],
      9
    );
    const refreshed = currentModulePreviewTargetByIdentity({
      source: sourceSnapshot(source, 9),
      semantic: semanticSnapshot(source, compiled, 9),
      definitionStatementId: "inner" as StatementIdentity
    });

    expect(refreshed?.target).toMatchObject({ definitionStatementId: "inner", name: "Inner" });
  });

  it("fails closed when the target identity disappears or the semantic snapshot is stale", () => {
    const source = [
      "nui 4",
      "module Pocket() {",
      "  point P = coordinate(x: 0, y: 0)",
      "}"
    ].join("\n");
    const compiled = compileWithIds(source, ["version", "other", "point", "end"], 12);

    expect(currentModulePreviewTargetByIdentity({
      source: sourceSnapshot(source, 12),
      semantic: semanticSnapshot(source, compiled, 12),
      definitionStatementId: "missing" as StatementIdentity
    })).toBeNull();

    expect(currentModulePreviewTargetByIdentity({
      source: sourceSnapshot(source, 13),
      semantic: semanticSnapshot(source, compiled, 12),
      definitionStatementId: "other" as StatementIdentity
    })).toBeNull();
  });
});
