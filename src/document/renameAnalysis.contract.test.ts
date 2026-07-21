import { describe, expect, it } from "vitest";
import { compileDslDocument, serializeDocumentToDsl, type CompiledDslDocument, type DslDocumentData } from "../dsl/dslDocument";
import { parseDsl } from "../dsl/dslParser";
import { dslFlatTextForElements, dslTextForElements, emptyDocument } from "../dsl/dslDocumentTestUtils";
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
      { id: "p", name: "", type: "freePoint", visible: true, enabled: true, x: 0, y: 0 }
    ]);
    const compiled = complete(source);
    const analysis = analyzeRename({
      sourceText: source,
      compiled,
      targetElementId: compiled.document.elements[0].id,
      newName: "Named"
    });

    // The unnamed point's construction call spans every physical line after
    // "nui 2" (a v2 vertical call, unlike v1's always-one-line statement), and
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
      { id: "persisted-a", name: "A", type: "freePoint", visible: true, enabled: true, x: 0, y: 0 },
      {
        id: "user-1",
        name: "User",
        type: "offsetPoint",
        visible: true,
        enabled: true,
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
      { id: "p1", name: "P", type: "freePoint", visible: true, enabled: true, x: 0, y: 0 },
      { id: "g", name: "G", type: "group", visible: true, enabled: true },
      { id: "p2", name: "P", type: "freePoint", visible: true, enabled: true, x: 1, y: 0, parentGroupId: "g" },
      {
        id: "user",
        name: "User",
        type: "offsetPoint",
        visible: true,
        enabled: true,
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
      { id: "target", name: "Target", type: "freePoint", visible: true, enabled: true, x: 0, y: 0 },
      { id: "g", name: "G", type: "group", visible: true, enabled: true },
      { id: "newname", name: "NewName", type: "freePoint", visible: true, enabled: true, x: 1, y: 0, parentGroupId: "g" },
      {
        id: "user",
        name: "User",
        type: "offsetPoint",
        visible: true,
        enabled: true,
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
      { id: "target", name: "Target", type: "group", visible: true, enabled: true },
      { id: "child1", name: "Child", type: "freePoint", visible: true, enabled: true, x: 0, y: 0, parentGroupId: "target" },
      { id: "consumer", name: "Consumer", type: "group", visible: true, enabled: true },
      { id: "newname", name: "NewName", type: "group", visible: true, enabled: true, parentGroupId: "consumer" },
      { id: "child2", name: "Child", type: "freePoint", visible: true, enabled: true, x: 1, y: 0, parentGroupId: "newname" },
      {
        id: "user",
        name: "User",
        type: "offsetPoint",
        visible: true,
        enabled: true,
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
      { id: "g", name: "G", type: "group", visible: true, enabled: true },
      { id: "p", name: "P", type: "freePoint", visible: true, enabled: true, x: 0, y: 0, parentGroupId: "g" },
      {
        id: "s",
        name: "S",
        type: "offsetPoint",
        visible: true,
        enabled: true,
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

  it("only includes target-resolving slots from a changed print-layout block", () => {
    const elements: DslDocumentData["elements"] = [
      { id: "g", name: "G", type: "group", visible: true, enabled: true },
      { id: "gp", name: "P", type: "freePoint", visible: true, enabled: true, x: 0, y: 0, parentGroupId: "g" },
      { id: "x", name: "X", type: "group", visible: true, enabled: true },
      { id: "xp", name: "P", type: "freePoint", visible: true, enabled: true, x: 1, y: 0, parentGroupId: "x" }
    ];
    const source = serializeDocumentToDsl({
      ...emptyDocument(),
      elements,
      palette: { colors: [], defaultColorId: "" },
      printLayouts: [{
        id: "layout",
        name: "Layout",
        outputKind: "pdf",
        paperSizeId: "a4",
        orientation: "portrait",
        columns: 1,
        rows: 1,
        overlapMm: 0,
        scale: 1,
        svgCanvasWidthMm: 100,
        svgCanvasHeightMm: 100,
        placements: [
          { id: "place-g", groupId: "g", x: 0, y: 0, angleDeg: 0, mirrorX: false },
          { id: "place-x", groupId: "x", x: 20, y: 0, angleDeg: 0, mirrorX: false }
        ]
      }],
      activePrintLayoutId: "layout"
    }, 2);
    const compiled = complete(source);
    const target = compiled.document.elements.find((element) => element.name === "G")!;
    const analysis = analyzeRename({ sourceText: source, compiled, targetElementId: target.id, newName: "H" });

    expect(analysis).toMatchObject({ verdict: "ok" });
    if (analysis.verdict !== "ok") return;
    const placeGLine = lineOf(source, "place G");
    const placeXLine = lineOf(source, "place X");
    expect(analysis.occurrences).toEqual(expect.arrayContaining([
      expect.objectContaining({ line: placeGLine, referencedElementId: target.id, form: "print-layout-place" })
    ]));
    expect(analysis.occurrences.some((occurrence) => occurrence.line === placeXLine)).toBe(false);
  });

  // The printLayout header's exact canonical line shape (one arg per physical
  // line, matching dslDocument.ts's printLayoutBlockLines) is load-bearing
  // here: serializerChangedStatementLines's "exact mapping" proof requires the
  // source range's physical line count to equal the generated plan's line
  // count, so a single-line header would always fall back to block granularity.
  const printLayoutHeaderLines = [
    "printLayout L (",
    "  output: pdf",
    "  paper: a4",
    "  orientation: portrait",
    "  columns: 1",
    "  rows: 1",
    "  overlap: 0",
    "  scale: 1",
    "  canvas: (100, 100)",
    ") {"
  ];

  it("excludes an unchanged raw-id descendant place when print-layout line mapping is exact", () => {
    const source = [
      "nui 2",
      "group Parent {",
      "  group (id: child) {",
      "  }",
      "}",
      ...printLayoutHeaderLines,
      "  place Parent (at: (0, 0) angle: 0 mirrorX: false)",
      "  place child (at: (20, 0) angle: 0 mirrorX: false)",
      "}"
    ].join("\n");
    const compiled = complete(source);
    const target = compiled.document.elements.find((element) => element.name === "Parent")!;
    const analysis = analyzeRename({ sourceText: source, compiled, targetElementId: target.id, newName: "Renamed" });

    const placeParentLine = lineOf(source, "place Parent");
    expect(analysis).toMatchObject({ verdict: "ok" });
    if (analysis.verdict !== "ok") return;
    expect(analysis.occurrences).toEqual([
      expect.objectContaining({ line: placeParentLine, referencedElementId: target.id, form: "print-layout-place" })
    ]);
  });

  it("keeps block-granularity occurrences when source-only print-layout lines prevent an exact mapping", () => {
    const source = [
      "nui 2",
      "group Parent {",
      "  group (id: child) {",
      "  }",
      "}",
      ...printLayoutHeaderLines,
      "  place Parent (at: (0, 0) angle: 0 mirrorX: false)",
      "  # source-only comment prevents a line-for-line plan proof",
      "  place child (at: (20, 0) angle: 0 mirrorX: false)",
      "}"
    ].join("\n");
    const compiled = complete(source);
    const target = compiled.document.elements.find((element) => element.name === "Parent")!;
    const analysis = analyzeRename({ sourceText: source, compiled, targetElementId: target.id, newName: "Renamed" });

    const placeParentLine = lineOf(source, "place Parent");
    const placeChildLine = lineOf(source, "place child");
    expect(analysis).toMatchObject({ verdict: "ok" });
    if (analysis.verdict !== "ok") return;
    expect(analysis.occurrences).toEqual(expect.arrayContaining([
      expect.objectContaining({ line: placeParentLine, referencedElementId: target.id }),
      expect.objectContaining({ line: placeChildLine, referencedElementId: "child" })
    ]));
  });

  it("exposes reason-specific rejected detail types", () => {
    const source = dslTextForElements([
      { id: "a", name: "A", type: "freePoint", visible: true, enabled: true, x: 0, y: 0 },
      { id: "b", name: "B", type: "freePoint", visible: true, enabled: true, x: 1, y: 0 }
    ]);
    const compiled = complete(source);
    const target = compiled.document.elements.find((element) => element.name === "A")!;
    const analysis = analyzeRename({ sourceText: source, compiled, targetElementId: target.id, newName: "B" });

    expect(analysis.verdict).toBe("rejected");
    if (analysis.verdict !== "rejected") return;
    expect(rejectedDetailLabel(analysis)).toMatch(/:/);
  });
});
