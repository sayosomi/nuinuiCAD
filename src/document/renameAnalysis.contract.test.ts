import { describe, expect, it } from "vitest";
import { compileDslDocument, type CompiledDslDocument, type DslDocumentData } from "../dsl/dslDocument";
import { parseDsl } from "../dsl/dslParser";
import { dslFlatTextForElements, dslTextForElements } from "../dsl/dslDocumentTestUtils";
import { getDirectParentIds } from "../model/dependencies";
import type { RenameAnalysis } from "./renameAnalysis";
import { analyzeRename } from "./renameAnalysis";
import { reconcileStatements } from "./statementReconciler";
import { applyLineSplices, buildTextPatch } from "./textPatch";

const complete = (source: string) => {
  const compiled = compileDslDocument(source);
  expect(compiled.document).not.toBeNull();
  expect(compiled.statementMap).not.toBeNull();
  return compiled as CompiledDslDocument & {
    document: DslDocumentData;
    statementMap: NonNullable<CompiledDslDocument["statementMap"]>;
  };
};

const renameDocument = (document: DslDocumentData, id: string, name: string): DslDocumentData => ({
  ...document,
  elements: document.elements.map((element) => element.id === id ? { ...element, name } : element)
});

const recompileWithInheritedIds = (before: ReturnType<typeof complete>, source: string) => {
  const parsed = parseDsl(source);
  const reconciled = reconcileStatements({
    oldStatements: before.statements,
    oldLines: before.sourceLines,
    oldElementIds: before.statementMap.elementIdByStatementIndex,
    newStatements: parsed.statements,
    newLines: source.split("\n")
  }, { createId: () => "unexpected-new-id" });
  const after = compileDslDocument(source, { preparsed: parsed, assignedElementIds: reconciled.assignedIds });
  expect(after.document).not.toBeNull();
  expect(after.statementMap).not.toBeNull();
  return after as ReturnType<typeof complete>;
};

const renamedText = (source: string, compiled: ReturnType<typeof complete>, targetId: string, newName: string) =>
  applyLineSplices(source, buildTextPatch({
    old: compiled,
    newDocument: renameDocument(compiled.document, targetId, newName)
  }));

const rejectedDetailLabel = (analysis: Extract<RenameAnalysis, { verdict: "rejected" }>): string => {
  switch (analysis.reason) {
    case "invalid-source":
      return analysis.detail.message;
    case "target-not-found":
      return analysis.detail.targetElementId;
    case "invalid-name":
      return `${analysis.detail.input}:${analysis.detail.message}`;
    case "same-scope-conflict":
      return `${analysis.detail.conflictingElementId}:${analysis.detail.conflictingLine}`;
    case "analysis-incomplete":
      return analysis.detail.message;
    case "resolution-change":
      return String(analysis.detail.changes[0]?.line ?? 0);
    default: {
      const exhaustive: never = analysis;
      return exhaustive;
    }
  }
};

const lineOf = (source: string, needle: string): number => {
  const index = source.split("\n").findIndex((line) => line.includes(needle));
  expect(index).toBeGreaterThanOrEqual(0);
  return index + 1;
};

describe("renameAnalysis contract", () => {
  it("includes an unnamed target statement even when no reference text changes", () => {
    const source = dslTextForElements([
      { id: "p", name: "", type: "freePoint", activity: "visible", x: 0, y: 0 }
    ]);
    const compiled = complete(source);
    const analysis = analyzeRename({
      sourceText: source,
      compiled,
      targetElementId: compiled.document.elements[0].id,
      newName: "Named"
    });

    // The unnamed point's construction call spans every physical line after
    // "nui 4" (a canonical vertical call), and
    // expectedPatchedLines now covers a changed statement's full line range
    // (renameAnalysisCandidate.ts) rather than just a diffed line.
    const statementLineCount = source.split("\n").length - 1;
    expect(analysis).toMatchObject({
      verdict: "ok",
      expectedPatchedLines: Array.from({ length: statementLineCount }, (_, index) => index + 2),
      occurrences: []
    });
  });

  it("preserves an explicit id and its reference resolution", () => {
    const source = dslFlatTextForElements([
      { id: "persisted-a", name: "A", type: "freePoint", activity: "visible", x: 0, y: 0 },
      {
        id: "user-1",
        name: "User",
        type: "offsetPoint",
        activity: "visible",
        fromPoint: { mode: "reference", pointId: "persisted-a" },
        dx: 1,
        dy: 0
      }
    ]);
    const compiled = complete(source);
    const target = compiled.document.elements.find((element) => element.id === "persisted-a")!;
    const analysis = analyzeRename({ sourceText: source, compiled, targetElementId: target.id, newName: "B" });

    expect(analysis.verdict).toBe("ok");
    if (analysis.verdict !== "ok") return;
    const after = recompileWithInheritedIds(compiled, renamedText(source, compiled, target.id, analysis.newName));
    const renamed = after.document.elements.find((element) => element.name === "B")!;
    const user = after.document.elements.find((element) => element.name === "User")!;
    expect(renamed.id).toBe("persisted-a");
    expect(getDirectParentIds(user)).toContain("persisted-a");
  });

  it("tracks a qualified reference in another scope", () => {
    const source = dslTextForElements([
      { id: "p1", name: "P", type: "freePoint", activity: "visible", x: 0, y: 0 },
      { id: "g", name: "G", type: "group", activity: "visible" },
      { id: "p2", name: "P", type: "freePoint", activity: "visible", x: 1, y: 0, parentGroupId: "g" },
      {
        id: "user",
        name: "User",
        type: "offsetPoint",
        activity: "visible",
        fromPoint: { mode: "reference", pointId: "p2" },
        dx: 1,
        dy: 0
      }
    ]);
    const compiled = complete(source);
    const target = compiled.document.elements.find((element) => element.name === "P" && element.parentGroupId)!;
    const analysis = analyzeRename({ sourceText: source, compiled, targetElementId: target.id, newName: "Q" });

    expect(analysis).toMatchObject({ verdict: "ok" });
    if (analysis.verdict !== "ok") return;
    expect(analysis.occurrences).toEqual(expect.arrayContaining([
      expect.objectContaining({ line: lineOf(source, "point User"), referencedElementId: target.id })
    ]));
    const after = recompileWithInheritedIds(compiled, renamedText(source, compiled, target.id, analysis.newName));
    const user = after.document.elements.find((element) => element.name === "User")!;
    expect(getDirectParentIds(user)).toContain(target.id);
  });

  it("rejects an element rename that lets an inner scope capture its target reference", () => {
    const source = dslTextForElements([
      { id: "target", name: "Target", type: "freePoint", activity: "visible", x: 0, y: 0 },
      { id: "g", name: "G", type: "group", activity: "visible" },
      { id: "newname", name: "NewName", type: "freePoint", activity: "visible", x: 1, y: 0, parentGroupId: "g" },
      {
        id: "user",
        name: "User",
        type: "offsetPoint",
        activity: "visible",
        fromPoint: { mode: "reference", pointId: "target" },
        dx: 1,
        dy: 0,
        parentGroupId: "g"
      }
    ]);
    const compiled = complete(source);
    const target = compiled.document.elements.find((element) => element.name === "Target")!;

    expect(analyzeRename({ sourceText: source, compiled, targetElementId: target.id, newName: "NewName" }))
      .toMatchObject({ verdict: "rejected", reason: "resolution-change" });
  });

  it("rejects a group rename that lets an inner scope capture its descendant reference", () => {
    const source = dslTextForElements([
      { id: "target", name: "Target", type: "group", activity: "visible" },
      { id: "child1", name: "Child", type: "freePoint", activity: "visible", x: 0, y: 0, parentGroupId: "target" },
      { id: "consumer", name: "Consumer", type: "group", activity: "visible" },
      { id: "newname", name: "NewName", type: "group", activity: "visible", parentGroupId: "consumer" },
      { id: "child2", name: "Child", type: "freePoint", activity: "visible", x: 1, y: 0, parentGroupId: "newname" },
      {
        id: "user",
        name: "User",
        type: "offsetPoint",
        activity: "visible",
        fromPoint: { mode: "reference", pointId: "child1" },
        dx: 1,
        dy: 0,
        parentGroupId: "consumer"
      }
    ]);
    const compiled = complete(source);
    const target = compiled.document.elements.find((element) => element.name === "Target")!;

    expect(analyzeRename({ sourceText: source, compiled, targetElementId: target.id, newName: "NewName" }))
      .toMatchObject({ verdict: "rejected", reason: "resolution-change" });
  });

  it("does not count a text-invariant descendant reference as an occurrence", () => {
    const source = dslTextForElements([
      { id: "g", name: "G", type: "group", activity: "visible" },
      { id: "p", name: "P", type: "freePoint", activity: "visible", x: 0, y: 0, parentGroupId: "g" },
      {
        id: "s",
        name: "S",
        type: "offsetPoint",
        activity: "visible",
        fromPoint: { mode: "reference", pointId: "p" },
        dx: 1,
        dy: 0,
        parentGroupId: "g"
      }
    ]);
    const compiled = complete(source);
    const target = compiled.document.elements.find((element) => element.name === "G")!;
    const analysis = analyzeRename({ sourceText: source, compiled, targetElementId: target.id, newName: "H" });

    expect(analysis).toMatchObject({ verdict: "ok" });
    if (analysis.verdict !== "ok") return;
    const groupLine = lineOf(source, "group G");
    const sLine = lineOf(source, "point S");
    expect(analysis.expectedPatchedLines).toContain(groupLine);
    expect(analysis.expectedPatchedLines).not.toContain(sLine);
    expect(analysis.occurrences.some((occurrence) => occurrence.line === sLine)).toBe(false);
  });

  it("exposes reason-specific rejected detail types", () => {
    const source = dslTextForElements([
      { id: "a", name: "A", type: "freePoint", activity: "visible", x: 0, y: 0 },
      { id: "b", name: "B", type: "freePoint", activity: "visible", x: 1, y: 0 }
    ]);
    const compiled = complete(source);
    const target = compiled.document.elements.find((element) => element.name === "A")!;
    const analysis = analyzeRename({ sourceText: source, compiled, targetElementId: target.id, newName: "B" });

    expect(analysis.verdict).toBe("rejected");
    if (analysis.verdict !== "rejected") return;
    expect(rejectedDetailLabel(analysis)).toMatch(/:/);
  });
});
