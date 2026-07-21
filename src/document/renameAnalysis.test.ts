import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { compileDslDocument, serializeDocumentToDsl, type CompiledDslDocument, type DslDocumentData } from "../dsl/dslDocument";
import { parseDsl } from "../dsl/dslParser";
import { dslFlatTextForElements, dslTextForElements, emptyDocument } from "../dsl/dslDocumentTestUtils";
import { reconcileStatements } from "./statementReconciler";
import { applyLineSplices, buildTextPatch } from "./textPatch";
import { analyzeRename, validateRenameReferenceStability } from "./renameAnalysis";

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

const touchedLines = (compiled: CompiledDslDocument, document: DslDocumentData) =>
  [...new Set(buildTextPatch({ old: compiled, newDocument: document }).flatMap((splice) =>
    Array.from({ length: Math.max(0, splice.endLine - splice.startLine + 1) }, (_, index) => splice.startLine + index)
  ))].sort((a, b) => a - b);

const compileWithInheritedIds = (before: ReturnType<typeof complete>, source: string) => {
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

// 手段: シャドーイング・限定参照・ダングリング参照が密集した文書を生成するだけの
// ヘルパ。参照密度をfast-checkで振るプロパティテスト用の入力生成であり、
// v1構文自体は検証対象ではない。
const referenceDenseElements = (generatedReferenceCount: number, includeDangling: boolean): DslDocumentData["elements"] => [
  { id: "target", name: "Target", type: "freePoint", visible: true, enabled: true, x: 0, y: 0 },
  { id: "front", name: "Front", type: "group", visible: true, enabled: true },
  { id: "front-shared", name: "Shared", type: "freePoint", visible: true, enabled: true, x: 1, y: 0, parentGroupId: "front" },
  {
    id: "front-user",
    name: "FrontUser",
    type: "offsetPoint",
    visible: true,
    enabled: true,
    fromPoint: { mode: "reference", pointId: "target" },
    dx: 1,
    dy: 0,
    parentGroupId: "front"
  },
  { id: "back", name: "Back", type: "group", visible: true, enabled: true },
  { id: "back-shared", name: "Shared", type: "freePoint", visible: true, enabled: true, x: 2, y: 0, parentGroupId: "back" },
  {
    id: "qualified",
    name: "Qualified",
    type: "offsetPoint",
    visible: true,
    enabled: true,
    fromPoint: { mode: "reference", pointId: "front-shared" },
    dx: 1,
    dy: 0,
    parentGroupId: "back"
  },
  {
    id: "target-user",
    name: "TargetUser",
    type: "offsetPoint",
    visible: true,
    enabled: true,
    fromPoint: { mode: "reference", pointId: "target" },
    dx: 1,
    dy: 0,
    parentGroupId: "back"
  },
  ...(includeDangling ? [{
    id: "dangling",
    name: "Dangling",
    type: "offsetPoint" as const,
    visible: true,
    enabled: true,
    fromPoint: { mode: "reference" as const, pointId: "missing-element" },
    dx: 1,
    dy: 0,
    parentGroupId: "back"
  }] : []),
  ...Array.from({ length: generatedReferenceCount }, (_, index) => ({
    id: `p${index}`,
    name: `P${index}`,
    type: "offsetPoint" as const,
    visible: true,
    enabled: true,
    fromPoint: { mode: "reference" as const, pointId: "target" },
    dx: index + 1,
    dy: 0
  }))
];

const referenceDenseSource = (generatedReferenceCount: number, includeDangling: boolean) =>
  dslTextForElements(referenceDenseElements(generatedReferenceCount, includeDangling));

describe("renameAnalysis", () => {
  it("classifies direct, derived, and expression references to the target", () => {
    const source = dslTextForElements([
      { id: "a", name: "A", type: "freePoint", visible: true, enabled: true, x: 0, y: 0 },
      { id: "b", name: "B", type: "freePoint", visible: true, enabled: true, x: 10, y: 0 },
      { id: "l", name: "L", type: "line", visible: true, enabled: true, startPoint: { mode: "reference", pointId: "a" }, endPoint: { mode: "reference", pointId: "b" } },
      {
        id: "derived",
        name: "Derived",
        type: "offsetPoint",
        visible: true,
        enabled: true,
        fromPoint: { mode: "derived", elementId: "l", pointKey: "start" },
        dx: 1,
        dy: 0
      },
      {
        id: "length",
        name: "Length",
        type: "variable",
        visible: true,
        enabled: true,
        scope: "global",
        valueMode: "expression",
        expression: { kind: "expression", expression: "L.length" },
        point1: { mode: "coordinate", x: 0, y: 0 },
        point2: { mode: "coordinate", x: 0, y: 0 },
        point: { mode: "coordinate", x: 0, y: 0 },
        lineId: ""
      },
      { id: "extended", name: "Extended", type: "extendTrim", visible: true, enabled: true, endpoint: { lineId: "l", endpointKey: "end" }, point: { mode: "reference", pointId: "a" } }
    ]);
    const compiled = complete(source);
    const target = compiled.document.elements.find((element) => element.name === "L")!;
    const analysis = analyzeRename({ sourceText: source, compiled, targetElementId: target.id, newName: "Line 2" });

    expect(analysis).toMatchObject({ verdict: "ok" });
    if (analysis.verdict !== "ok") return;
    expect(analysis.occurrences.map((occurrence) => occurrence.form)).toEqual(expect.arrayContaining([
      "direct",
      "derived",
      "expression"
    ]));
  });

  it("lists direct, derived, expression, qualified, and print-layout references", () => {
    const elements: DslDocumentData["elements"] = [
      { id: "a", name: "A", type: "freePoint", visible: true, enabled: true, x: 0, y: 0 },
      { id: "b", name: "B", type: "offsetPoint", visible: true, enabled: true, fromPoint: { mode: "reference", pointId: "a" }, dx: 1, dy: 0 },
      { id: "l", name: "L", type: "line", visible: true, enabled: true, startPoint: { mode: "reference", pointId: "a" }, endPoint: { mode: "reference", pointId: "b" } },
      {
        id: "length",
        name: "Length",
        type: "variable",
        visible: true,
        enabled: true,
        scope: "global",
        valueMode: "expression",
        expression: { kind: "expression", expression: "L.length" },
        point1: { mode: "coordinate", x: 0, y: 0 },
        point2: { mode: "coordinate", x: 0, y: 0 },
        point: { mode: "coordinate", x: 0, y: 0 },
        lineId: ""
      },
      { id: "g", name: "G", type: "group", visible: true, enabled: true },
      { id: "p", name: "P", type: "freePoint", visible: true, enabled: true, x: 2, y: 0, parentGroupId: "g" },
      { id: "qualifieduser", name: "QualifiedUser", type: "offsetPoint", visible: true, enabled: true, fromPoint: { mode: "reference", pointId: "p" }, dx: 1, dy: 0 }
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
        placements: [{ id: "place-g", groupId: "g", x: 0, y: 0, angleDeg: 0, mirrorX: false }]
      }],
      activePrintLayoutId: "layout"
    }, 2);
    const compiled = complete(source);
    const group = compiled.document.elements.find((element) => element.name === "G")!;
    const analysis = analyzeRename({ sourceText: source, compiled, targetElementId: group.id, newName: "H" });

    expect(analysis).toMatchObject({ verdict: "ok", newName: "H" });
    if (analysis.verdict !== "ok") return;
    expect(analysis.occurrences).toEqual(expect.arrayContaining([
      expect.objectContaining({ referencedElementId: group.id, form: "print-layout-place" }),
      expect.objectContaining({ form: "direct" })
    ]));
    const after = renameDocument(compiled.document, group.id, "H");
    expect(analysis.expectedPatchedLines).toEqual(touchedLines(compiled, after));
  });

  it("accepts quoted Japanese names and follows the existing trim rule", () => {
    const source = dslTextForElements([
      { id: "a", name: "A", type: "freePoint", visible: true, enabled: true, x: 0, y: 0 }
    ]);
    const compiled = complete(source);
    const target = compiled.document.elements[0];
    expect(analyzeRename({
      sourceText: source,
      compiled,
      targetElementId: target.id,
      newName: "  新しい 名前  "
    })).toMatchObject({ verdict: "ok", newName: "新しい 名前" });
  });

  it("rejects a same-scope conflict", () => {
    const source = dslTextForElements([
      { id: "a", name: "A", type: "freePoint", visible: true, enabled: true, x: 0, y: 0 },
      { id: "b", name: "B", type: "freePoint", visible: true, enabled: true, x: 1, y: 0 }
    ]);
    const compiled = complete(source);
    const target = compiled.document.elements.find((element) => element.name === "A")!;
    expect(analyzeRename({ sourceText: source, compiled, targetElementId: target.id, newName: "B" }))
      .toMatchObject({ verdict: "rejected", reason: "same-scope-conflict" });
  });

  it("rejects capture of an existing dangling token", () => {
    const source = dslTextForElements([
      { id: "a", name: "A", type: "freePoint", visible: true, enabled: true, x: 0, y: 0 },
      { id: "user", name: "User", type: "offsetPoint", visible: true, enabled: true, fromPoint: { mode: "reference", pointId: "NewName" }, dx: 1, dy: 0 }
    ]);
    const compiled = complete(source);
    const target = compiled.document.elements.find((element) => element.name === "A")!;
    expect(analyzeRename({ sourceText: source, compiled, targetElementId: target.id, newName: "NewName" }))
      .toMatchObject({ verdict: "rejected", reason: "resolution-change" });
  });

  it("rejects capture of a dangling @variable token", () => {
    const source = dslTextForElements([
      {
        id: "old",
        name: "Old",
        type: "variable",
        visible: true,
        enabled: true,
        scope: "global",
        valueMode: "expression",
        expression: 1,
        point1: { mode: "coordinate", x: 0, y: 0 },
        point2: { mode: "coordinate", x: 0, y: 0 },
        point: { mode: "coordinate", x: 0, y: 0 },
        lineId: ""
      },
      {
        id: "user",
        name: "User",
        type: "variable",
        visible: true,
        enabled: true,
        scope: "global",
        valueMode: "expression",
        expression: { kind: "expression", expression: "@NewName + 1" },
        point1: { mode: "coordinate", x: 0, y: 0 },
        point2: { mode: "coordinate", x: 0, y: 0 },
        point: { mode: "coordinate", x: 0, y: 0 },
        lineId: ""
      }
    ]);
    const compiled = complete(source);
    const target = compiled.document.elements.find((element) => element.name === "Old")!;
    expect(analyzeRename({ sourceText: source, compiled, targetElementId: target.id, newName: "NewName" }))
      .toMatchObject({ verdict: "rejected", reason: "resolution-change" });
  });

  it("detects a shadowing resolution change using inherited element IDs", () => {
    const beforeSource = dslTextForElements([
      { id: "outer", name: "Outer", type: "freePoint", visible: true, enabled: true, x: 0, y: 0 },
      { id: "g", name: "G", type: "group", visible: true, enabled: true },
      { id: "inner", name: "Inner", type: "freePoint", visible: true, enabled: true, x: 1, y: 0, parentGroupId: "g" },
      { id: "user", name: "User", type: "offsetPoint", visible: true, enabled: true, fromPoint: { mode: "reference", pointId: "outer" }, dx: 1, dy: 0, parentGroupId: "g" }
    ]);
    const before = complete(beforeSource);
    const local = before.document.elements.find((element) => element.name === "Inner")!;
    const after = compileWithInheritedIds(before, beforeSource.replace("point Inner", "point Outer"));
    expect(validateRenameReferenceStability({ before, after }))
      .toMatchObject({ verdict: "rejected", reason: "resolution-change" });
    expect(analyzeRename({ sourceText: beforeSource, compiled: before, targetElementId: local.id, newName: "Outer" }))
      .toMatchObject({ verdict: "rejected", reason: "resolution-change" });
  });

  it("fails closed when the after catalog introduces an unmatched reference slot", () => {
    const before = complete(dslFlatTextForElements([
      { id: "a", name: "A", type: "freePoint", visible: true, enabled: true, x: 0, y: 0 },
      { id: "user", name: "User", type: "offsetPoint", visible: true, enabled: true, fromPoint: { mode: "reference", pointId: "a" }, dx: 1, dy: 0 }
    ]));
    const after = complete(dslFlatTextForElements([
      { id: "a", name: "A", type: "freePoint", visible: true, enabled: true, x: 0, y: 0 },
      { id: "user", name: "User", type: "offsetPoint", visible: true, enabled: true, fromPoint: { mode: "reference", pointId: "a" }, dx: 1, dy: 0 },
      { id: "added", name: "Added", type: "offsetPoint", visible: true, enabled: true, fromPoint: { mode: "reference", pointId: "a" }, dx: 2, dy: 0 }
    ]));

    expect(validateRenameReferenceStability({ before, after }))
      .toMatchObject({ verdict: "rejected", reason: "analysis-incomplete" });

    const afterWithDifferentKey = complete(dslFlatTextForElements([
      { id: "a", name: "A", type: "freePoint", visible: true, enabled: true, x: 0, y: 0 },
      { id: "replaced", name: "Replaced", type: "offsetPoint", visible: true, enabled: true, fromPoint: { mode: "reference", pointId: "a" }, dx: 1, dy: 0 }
    ]));
    expect(validateRenameReferenceStability({ before, after: afterWithDifferentKey }))
      .toMatchObject({ verdict: "rejected", reason: "analysis-incomplete" });
  });

  it.each(["", "::", "A::B"])("rejects invalid name %j", (newName) => {
    const source = dslTextForElements([
      { id: "a", name: "A", type: "freePoint", visible: true, enabled: true, x: 0, y: 0 }
    ]);
    const compiled = complete(source);
    expect(analyzeRename({ sourceText: source, compiled, targetElementId: compiled.document.elements[0].id, newName }))
      .toMatchObject({ verdict: "rejected", reason: "invalid-name" });
  });

  it("keeps all reference resolutions stable for dense generated rename cases with shadowing, qualified, and dangling references", () => {
    fc.assert(fc.property(fc.integer({ min: 2, max: 30 }), fc.integer(), (count, seed) => {
      const source = referenceDenseSource(count, true);
      const compiled = complete(source);
      const target = compiled.document.elements.find((element) => element.name === "Target")!;
      const newName = `Renamed${Math.abs(seed)}`;
      const analysis = analyzeRename({ sourceText: source, compiled, targetElementId: target.id, newName });
      expect(analysis.verdict).toBe("ok");
      if (analysis.verdict !== "ok") return;
      const afterDocument = renameDocument(compiled.document, target.id, analysis.newName);
      const patched = applyLineSplices(source, buildTextPatch({ old: compiled, newDocument: afterDocument }));
      const after = compileWithInheritedIds(compiled, patched);
      expect(validateRenameReferenceStability({ before: compiled, after })).toEqual({ verdict: "ok" });
    }), { numRuns: 40 });
  });

  it("handles a clean, reference-dense 1,000 element rename within a loose pure-module guard", () => {
    const source = referenceDenseSource(992, false);
    const compiled = complete(source);
    expect(compiled.document.elements).toHaveLength(1000);
    const target = compiled.document.elements.find((element) => element.name === "Target")!;
    const startedAt = performance.now();
    const analysis = analyzeRename({ sourceText: source, compiled, targetElementId: target.id, newName: "Renamed" });
    const elapsed = performance.now() - startedAt;
    expect(analysis.verdict).toBe("ok");
    expect(elapsed).toBeLessThan(5000);
  });
});
