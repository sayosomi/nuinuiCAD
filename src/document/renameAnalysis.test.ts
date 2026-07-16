import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { compileDslDocument, type CompiledDslDocument, type DslDocumentData } from "../dsl/dslDocument";
import { parseDsl } from "../dsl/dslParser";
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

const referenceDenseSource = (generatedReferenceCount: number, includeDangling: boolean) => [
  "nui 1",
  "point Target = (0, 0)",
  "group Front {",
  "  point Shared = (1, 0)",
  "  point FrontUser = offset Target dx=1 dy=0",
  "}",
  "group Back {",
  "  point Shared = (2, 0)",
  "  point Qualified = offset Front::Shared dx=1 dy=0",
  "  point TargetUser = offset Target dx=1 dy=0",
  ...(includeDangling ? ["  point Dangling = offset Missing dx=1 dy=0"] : []),
  "}",
  ...Array.from({ length: generatedReferenceCount }, (_, index) =>
    `point P${index} = offset Target dx=${index + 1} dy=0`
  )
].join("\n");

describe("renameAnalysis", () => {
  it("classifies direct, derived, and expression references to the target", () => {
    const source = [
      "nui 1",
      "point A = (0, 0)",
      "point B = (10, 0)",
      "line L = A -> B",
      "point Derived = offset L.start dx=1 dy=0",
      "var Length = L.length",
      "line Extended = extend L.end to=A"
    ].join("\n");
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
    const source = [
      "nui 1",
      "point A = (0, 0)",
      "point B = offset A dx=1 dy=0",
      "line L = A -> B",
      "var Length = L.length",
      "group G {",
      "  point P = (2, 0)",
      "}",
      "point QualifiedUser = offset G::P dx=1 dy=0",
      "printLayout Layout output=pdf paper=a4 orientation=portrait columns=1 rows=1 overlap=0 scale=1 canvas=(100, 100) {",
      "  place G at=(0, 0) angle=0 mirrorX=false",
      "}"
    ].join("\n");
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
    const source = "nui 1\npoint A = (0, 0)";
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
    const source = "nui 1\npoint A = (0, 0)\npoint B = (1, 0)";
    const compiled = complete(source);
    const target = compiled.document.elements.find((element) => element.name === "A")!;
    expect(analyzeRename({ sourceText: source, compiled, targetElementId: target.id, newName: "B" }))
      .toMatchObject({ verdict: "rejected", reason: "same-scope-conflict" });
  });

  it("rejects capture of an existing dangling token", () => {
    const source = "nui 1\npoint A = (0, 0)\npoint User = offset NewName dx=1 dy=0";
    const compiled = complete(source);
    const target = compiled.document.elements.find((element) => element.name === "A")!;
    expect(analyzeRename({ sourceText: source, compiled, targetElementId: target.id, newName: "NewName" }))
      .toMatchObject({ verdict: "rejected", reason: "resolution-change" });
  });

  it("rejects capture of a dangling @variable token", () => {
    const source = "nui 1\nvar Old = 1\nvar User = @NewName + 1";
    const compiled = complete(source);
    const target = compiled.document.elements.find((element) => element.name === "Old")!;
    expect(analyzeRename({ sourceText: source, compiled, targetElementId: target.id, newName: "NewName" }))
      .toMatchObject({ verdict: "rejected", reason: "resolution-change" });
  });

  it("detects a shadowing resolution change using inherited element IDs", () => {
    const beforeSource = [
      "nui 1",
      "point Outer = (0, 0)",
      "group G {",
      "  point Inner = (1, 0)",
      "  point User = offset Outer dx=1 dy=0",
      "}"
    ].join("\n");
    const before = complete(beforeSource);
    const local = before.document.elements.find((element) => element.name === "Inner")!;
    const after = compileWithInheritedIds(before, beforeSource.replace("point Inner", "point Outer"));
    expect(validateRenameReferenceStability({ before, after }))
      .toMatchObject({ verdict: "rejected", reason: "resolution-change" });
    expect(analyzeRename({ sourceText: beforeSource, compiled: before, targetElementId: local.id, newName: "Outer" }))
      .toMatchObject({ verdict: "rejected", reason: "resolution-change" });
  });

  it("fails closed when the after catalog introduces an unmatched reference slot", () => {
    const before = complete([
      "nui 1",
      "point A = (0, 0) id=a",
      "point User = offset A dx=1 dy=0 id=user"
    ].join("\n"));
    const after = complete([
      "nui 1",
      "point A = (0, 0) id=a",
      "point User = offset A dx=1 dy=0 id=user",
      "point Added = offset A dx=2 dy=0 id=added"
    ].join("\n"));

    expect(validateRenameReferenceStability({ before, after }))
      .toMatchObject({ verdict: "rejected", reason: "analysis-incomplete" });

    const afterWithDifferentKey = complete([
      "nui 1",
      "point A = (0, 0) id=a",
      "point Replaced = offset A dx=1 dy=0 id=replaced"
    ].join("\n"));
    expect(validateRenameReferenceStability({ before, after: afterWithDifferentKey }))
      .toMatchObject({ verdict: "rejected", reason: "analysis-incomplete" });
  });

  it.each(["", "::", "A::B"])("rejects invalid name %j", (newName) => {
    const source = "nui 1\npoint A = (0, 0)";
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
