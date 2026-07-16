import { describe, expect, it } from "vitest";
import { compileDslDocument, type CompiledDslDocument, type DslDocumentData } from "../dsl/dslDocument";
import { parseDsl } from "../dsl/dslParser";
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

describe("renameAnalysis contract", () => {
  it("includes an unnamed target statement even when no reference text changes", () => {
    const source = "nui 1\npoint = (0, 0)";
    const compiled = complete(source);
    const analysis = analyzeRename({
      sourceText: source,
      compiled,
      targetElementId: compiled.document.elements[0].id,
      newName: "Named"
    });

    expect(analysis).toMatchObject({ verdict: "ok", expectedPatchedLines: [2], occurrences: [] });
  });

  it("preserves an explicit id and its reference resolution", () => {
    const source = [
      "nui 1",
      "point A = (0, 0) id=persisted-a",
      "point User = offset persisted-a dx=1 dy=0"
    ].join("\n");
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
    const source = [
      "nui 1",
      "point P = (0, 0)",
      "group G {",
      "  point P = (1, 0)",
      "}",
      "point User = offset G::P dx=1 dy=0"
    ].join("\n");
    const compiled = complete(source);
    const target = compiled.document.elements.find((element) => element.name === "P" && element.parentGroupId)!;
    const analysis = analyzeRename({ sourceText: source, compiled, targetElementId: target.id, newName: "Q" });

    expect(analysis).toMatchObject({ verdict: "ok" });
    if (analysis.verdict !== "ok") return;
    expect(analysis.occurrences).toEqual(expect.arrayContaining([
      expect.objectContaining({ line: 6, referencedElementId: target.id })
    ]));
    const after = recompileWithInheritedIds(compiled, renamedText(source, compiled, target.id, analysis.newName));
    const user = after.document.elements.find((element) => element.name === "User")!;
    expect(getDirectParentIds(user)).toContain(target.id);
  });

  it("rejects an element rename that lets an inner scope capture its target reference", () => {
    const source = [
      "nui 1",
      "point Target = (0, 0)",
      "group G {",
      "  point NewName = (1, 0)",
      "  point User = offset Target dx=1 dy=0",
      "}"
    ].join("\n");
    const compiled = complete(source);
    const target = compiled.document.elements.find((element) => element.name === "Target")!;

    expect(analyzeRename({ sourceText: source, compiled, targetElementId: target.id, newName: "NewName" }))
      .toMatchObject({ verdict: "rejected", reason: "resolution-change" });
  });

  it("rejects a group rename that lets an inner scope capture its descendant reference", () => {
    const source = [
      "nui 1",
      "group Target {",
      "  point Child = (0, 0)",
      "}",
      "group Consumer {",
      "  group NewName {",
      "    point Child = (1, 0)",
      "  }",
      "  point User = offset Target::Child dx=1 dy=0",
      "}"
    ].join("\n");
    const compiled = complete(source);
    const target = compiled.document.elements.find((element) => element.name === "Target")!;

    expect(analyzeRename({ sourceText: source, compiled, targetElementId: target.id, newName: "NewName" }))
      .toMatchObject({ verdict: "rejected", reason: "resolution-change" });
  });

  it("does not count a text-invariant descendant reference as an occurrence", () => {
    const source = [
      "nui 1",
      "group G {",
      "  point P = (0, 0)",
      "  point S = offset P dx=1 dy=0",
      "}"
    ].join("\n");
    const compiled = complete(source);
    const target = compiled.document.elements.find((element) => element.name === "G")!;
    const analysis = analyzeRename({ sourceText: source, compiled, targetElementId: target.id, newName: "H" });

    expect(analysis).toMatchObject({ verdict: "ok" });
    if (analysis.verdict !== "ok") return;
    expect(analysis.expectedPatchedLines).toContain(2);
    expect(analysis.expectedPatchedLines).not.toContain(4);
    expect(analysis.occurrences.some((occurrence) => occurrence.line === 4)).toBe(false);
  });

  it("only includes target-resolving slots from a changed print-layout block", () => {
    const source = [
      "nui 1",
      "group G {",
      "  point P = (0, 0)",
      "}",
      "group X {",
      "  point P = (1, 0)",
      "}",
      "printLayout Layout output=pdf paper=a4 orientation=portrait columns=1 rows=1 overlap=0 scale=1 canvas=(100, 100) {",
      "  place G at=(0, 0) angle=0 mirrorX=false",
      "  place X at=(20, 0) angle=0 mirrorX=false",
      "}"
    ].join("\n");
    const compiled = complete(source);
    const target = compiled.document.elements.find((element) => element.name === "G")!;
    const analysis = analyzeRename({ sourceText: source, compiled, targetElementId: target.id, newName: "H" });

    expect(analysis).toMatchObject({ verdict: "ok" });
    if (analysis.verdict !== "ok") return;
    expect(analysis.occurrences).toEqual(expect.arrayContaining([
      expect.objectContaining({ line: 9, referencedElementId: target.id, form: "print-layout-place" })
    ]));
    expect(analysis.occurrences.some((occurrence) => occurrence.line === 10)).toBe(false);
  });

  it("excludes an unchanged raw-id descendant place when print-layout line mapping is exact", () => {
    const source = [
      "nui 1",
      "group Parent {",
      "  group id=child {",
      "  }",
      "}",
      "printLayout L output=pdf paper=a4 orientation=portrait columns=1 rows=1 overlap=0 scale=1 canvas=(100, 100) {",
      "  place Parent at=(0, 0) angle=0 mirrorX=false",
      "  place child at=(20, 0) angle=0 mirrorX=false",
      "}"
    ].join("\n");
    const compiled = complete(source);
    const target = compiled.document.elements.find((element) => element.name === "Parent")!;
    const analysis = analyzeRename({ sourceText: source, compiled, targetElementId: target.id, newName: "Renamed" });

    expect(analysis).toMatchObject({ verdict: "ok", expectedPatchedLines: [2, 6, 7, 8, 9] });
    if (analysis.verdict !== "ok") return;
    expect(analysis.occurrences).toEqual([
      expect.objectContaining({ line: 7, referencedElementId: target.id, form: "print-layout-place" })
    ]);
  });

  it("keeps block-granularity occurrences when source-only print-layout lines prevent an exact mapping", () => {
    const source = [
      "nui 1",
      "group Parent {",
      "  group id=child {",
      "  }",
      "}",
      "printLayout L output=pdf paper=a4 orientation=portrait columns=1 rows=1 overlap=0 scale=1 canvas=(100, 100) {",
      "  place Parent at=(0, 0) angle=0 mirrorX=false",
      "  # source-only comment prevents a line-for-line plan proof",
      "  place child at=(20, 0) angle=0 mirrorX=false",
      "}"
    ].join("\n");
    const compiled = complete(source);
    const target = compiled.document.elements.find((element) => element.name === "Parent")!;
    const analysis = analyzeRename({ sourceText: source, compiled, targetElementId: target.id, newName: "Renamed" });

    expect(analysis).toMatchObject({ verdict: "ok" });
    if (analysis.verdict !== "ok") return;
    expect(analysis.occurrences).toEqual(expect.arrayContaining([
      expect.objectContaining({ line: 7, referencedElementId: target.id }),
      expect.objectContaining({ line: 9, referencedElementId: "child" })
    ]));
  });

  it("exposes reason-specific rejected detail types", () => {
    const source = "nui 1\npoint A = (0, 0)\npoint B = (1, 0)";
    const compiled = complete(source);
    const target = compiled.document.elements.find((element) => element.name === "A")!;
    const analysis = analyzeRename({ sourceText: source, compiled, targetElementId: target.id, newName: "B" });

    expect(analysis.verdict).toBe("rejected");
    if (analysis.verdict !== "rejected") return;
    expect(rejectedDetailLabel(analysis)).toMatch(/:/);
  });
});
