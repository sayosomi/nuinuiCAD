import { describe, expect, it } from "vitest";
import {
  compileDslDocument,
  createDslSemanticOccurrenceIndex,
  createModuleRuntimeContext,
  dslSemanticIdentityKey,
  parseDslSnapshot,
  planDslRenameEditsResult,
  queryDslDefinition,
  queryDslGeometryHoverTarget,
  queryDslReferences,
  queryDslRenameTarget,
  queryDslTransformationHoverTarget
} from "@nuinuicad/nui-language";
import { moduleSemanticStableFingerprint } from "@nuinuicad/nui-language/document";

import {
  analyzeMultiDocumentModuleSemantics,
  buildMultiDocumentImportGraph,
  buildMultiDocumentSemanticOccurrenceIndex,
  documentIdFromHost,
  moduleDeclarationContributor,
  projectMultiDocumentModuleSemanticDocumentView,
  queryMultiDocumentDefinition,
  SavedDocumentArtifactCache,
  savedSourceFingerprintFromHost
} from "@nuinuicad/nui-language/workspace";

const compile = (normalizedSource: string, sourceRevision = 17) => {
  const source = { normalizedSource, sourceRevision };
  const parsed = parseDslSnapshot(source);
  const compiled = compileDslDocument(normalizedSource, {
    preparsed: parsed,
    sourceRevision,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `issue1697-services:${index}`]))
  });
  return { source, semantic: { compiled, sourceRevision } };
};

const errors = ({ semantic: { compiled } }: ReturnType<typeof compile>) =>
  [...compiled.diagnostics, ...(compiled.bindingIssueDiagnostics ?? [])]
    .filter((diagnostic) => diagnostic.severity === "error");

const range = (source: string, context: string, name: string) => {
  const offset = source.indexOf(context);
  const inside = context.lastIndexOf(name);
  if (offset < 0 || inside < 0) throw new Error(`Missing ${name} in ${context}`);
  return { from: offset + inside, to: offset + inside + name.length };
};

const position = ({ from }: { from: number }) => from;

const simpleSource = `nui 1
/// @en "😀 left"
const left: number = 4
const side: choice(left, right) = @left
const message: string = "😀 @left"
group front {
  point A = coordinate(x: left, y: 0)
  line edge = segment(start: A, end: (10, 0))
}
const length: number = front::edge.length
const absolute: number = ::front::edge.length
reverse ::front::edge()`;

const shorthandSource = `nui 1
const width: number = 4
module Foo(width: number) {
  const copied: number = width
}
instance Use = Foo(width)`;

describe("Issue #1697 canonical language services", () => {
  it("resolves bare references at exact UTF-16 ranges and keeps choice, strings and metadata outside the binding identity", () => {
    const snapshot = compile(simpleSource);
    expect(errors(snapshot)).toEqual([]);
    const declarationRange = range(simpleSource, "const left", "left");
    const use = range(simpleSource, "x: left", "left");
    const pointDeclaration = range(simpleSource, "point A", "A");
    const pointUse = range(simpleSource, "start: A", "A");
    const binding = snapshot.semantic.compiled.bindingAnalysis?.catalog.bindings.find((candidate) => candidate.name === "left");
    expect(binding?.id).toBeDefined();
    expect(createDslSemanticOccurrenceIndex(snapshot.semantic.compiled).occurrences).toContainEqual({
      ...use, kind: "reference", identity: { kind: "typed", bindingId: binding?.id }
    });
    expect(queryDslDefinition({ ...snapshot, position: position(use) })).toEqual({ declarationRange, referenceRange: use });
    expect(queryDslDefinition({ ...snapshot, position: position(pointUse) })).toEqual({
      declarationRange: pointDeclaration, referenceRange: pointUse
    });
    expect(queryDslReferences({ ...snapshot, position: position(use) })).toEqual({ declarationRange, referenceRanges: [use] });
    for (const context of ["= @left", '"😀 @left"', '@en "😀 left"']) {
      const cursor = position(range(simpleSource, context, "left"));
      expect(queryDslDefinition({ ...snapshot, position: cursor })).toBeNull();
      expect(queryDslReferences({ ...snapshot, position: cursor })).toBeNull();
      expect(queryDslGeometryHoverTarget({ ...snapshot, position: cursor })).toBeNull();
      expect(queryDslRenameTarget(snapshot, cursor)).toBeNull();
    }
    verifyRename(simpleSource, declarationRange.from, "outer", simpleSource
      .replace("const left:", "const outer:")
      .replace("x: left", "x: outer"), [
      { ...declarationRange, expectedText: "left", newText: "outer" },
      { ...use, expectedText: "left", newText: "outer" }
    ]);
  });

  it("uses exact member ranges across relative and absolute geometry paths, numeric properties and transformation targets", () => {
    const snapshot = compile(simpleSource);
    expect(errors(snapshot)).toEqual([]);
    const declarationRange = range(simpleSource, "line edge", "edge");
    const relative = range(simpleSource, "= front::edge.length", "edge");
    const absolute = range(simpleSource, "= ::front::edge.length", "edge");
    const transform = range(simpleSource, "reverse ::front::edge", "edge");
    const property = range(simpleSource, "= ::front::edge.length", "length");
    const elementId = [...snapshot.semantic.compiled.sourceElementsByStatementIndex.values()].find((entry) => entry.name === "edge")?.id;
    expect(elementId).toBeDefined();
    for (const use of [relative, absolute, transform, property]) {
      expect(queryDslDefinition({ ...snapshot, position: position(use) })).toEqual({ declarationRange, referenceRange: use });
    }
    expect(queryDslReferences({ ...snapshot, position: declarationRange.from })).toEqual({
      declarationRange, referenceRanges: [relative, absolute, transform]
    });
    expect(queryDslGeometryHoverTarget({ ...snapshot, position: absolute.from })).toEqual({ range: absolute, elementId });
    expect(queryDslTransformationHoverTarget({ ...snapshot, position: transform.from })).toMatchObject({
      kind: "transformationTarget", range: transform
    });
    verifyRename(simpleSource, relative.from, "seam", simpleSource
      .replace("line edge", "line seam")
      .replaceAll("::edge", "::seam"), [declarationRange, relative, absolute, transform]
      .map((entry) => ({ ...entry, expectedText: "edge", newText: "seam" })));
  });

  it("keeps selectors and endpoints outside the generated declaration token", () => {
    const source = `nui 1
for i in range(min: 0, max: 2, step: 1) {
  line Mark = segment(start: (0, 0), end: (10, 0))
  point Tip = offset(from: Mark[1].start, dx: 1, dy: 0)
  const distance: number = Mark[1].length
  reverse Mark[1]()
}`;
    const snapshot = compile(source);
    expect(errors(snapshot)).toEqual([]);
    const declarationRange = range(source, "line Mark", "Mark");
    const endpoint = range(source, "Mark[1].start", "Mark");
    const property = range(source, "Mark[1].length", "Mark");
    const transform = range(source, "reverse Mark", "Mark");
    expect(queryDslDefinition({ ...snapshot, position: endpoint.from })).toEqual({ declarationRange, referenceRange: endpoint });
    expect(queryDslReferences({ ...snapshot, position: declarationRange.from })).toEqual({
      declarationRange, referenceRanges: [endpoint, property, transform]
    });
    expect(queryDslGeometryHoverTarget({ ...snapshot, position: property.from })).toBeNull();
    expect(queryDslTransformationHoverTarget({ ...snapshot, position: transform.from })).toMatchObject({
      kind: "transformationTarget", range: transform
    });
  });

  it("uses the caller declaration for F12 and preserves both shorthand identities in Find References", () => {
    const snapshot = compile(shorthandSource);
    expect(errors(snapshot)).toEqual([]);
    const caller = range(shorthandSource, "const width", "width");
    const parameter = range(shorthandSource, "module Foo(width", "width");
    const internal = range(shorthandSource, "= width", "width");
    const shorthand = range(shorthandSource, "= Foo(width", "width");
    expect(queryDslDefinition({ ...snapshot, position: shorthand.from })).toEqual({
      referenceRange: shorthand, declarationRange: caller
    });
    expect(queryDslReferences({ ...snapshot, position: caller.from })).toEqual({
      declarationRange: caller, referenceRanges: [shorthand]
    });
    expect(queryDslReferences({ ...snapshot, position: parameter.from })).toEqual({
      declarationRange: parameter, referenceRanges: [internal, shorthand]
    });
    expect(queryDslReferences({ ...snapshot, position: shorthand.from })).toEqual({
      declarationRange: caller, referenceRanges: [shorthand]
    });
    const identities = createDslSemanticOccurrenceIndex(snapshot.semantic.compiled).occurrences
      .filter((occurrence) => occurrence.kind === "reference" && occurrence.from === shorthand.from && occurrence.to === shorthand.to)
      .map((occurrence) => dslSemanticIdentityKey(occurrence.identity));
    expect(new Set(identities).size).toBe(2);
  });

  it("expands caller-side shorthand rename with the original label", () => {
    const declaration = range(shorthandSource, "const width", "width");
    const shorthand = range(shorthandSource, "= Foo(width", "width");
    verifyRename(shorthandSource, declaration.from, "outerWidth", shorthandSource
      .replace("const width:", "const outerWidth:")
      .replace("= Foo(width)", "= Foo(width: outerWidth)"), [
      { ...declaration, expectedText: "width", newText: "outerWidth" },
      { ...shorthand, expectedText: "width", newText: "width: outerWidth" }
    ]);
  });

  it("expands callee-parameter shorthand rename with the original caller binding", () => {
    const declaration = range(shorthandSource, "module Foo(width", "width");
    const internal = range(shorthandSource, "= width", "width");
    const shorthand = range(shorthandSource, "= Foo(width", "width");
    verifyRename(shorthandSource, declaration.from, "size", shorthandSource
      .replace("module Foo(width:", "module Foo(size:")
      .replace("= width", "= size")
      .replace("= Foo(width)", "= Foo(size: width)"), [
      { ...declaration, expectedText: "width", newText: "size" },
      { ...internal, expectedText: "width", newText: "size" },
      { ...shorthand, expectedText: "width", newText: "size: width" }
    ]);
  });

  it("indexes scoped carry, collection alias, record receiver and field references at the full identifier", () => {
    const source = `nui 1
record Piece(width: number)
const piece: Piece = Piece(width: 7)
const width: number = piece.width
const values: number[] = [1, 2]
const copy: number[] = values
const doubled: number[] = for item in values { item * 2 }
for i in range(min: 0, max: 0, step: 1) carry total: number = 0 {
  next total = i
}
const result: number = total`;
    const snapshot = compile(source);
    expect(errors(snapshot)).toEqual([]);
    for (const [declaration, use, name] of [
      ["const piece", "= piece.width", "piece"],
      ["record Piece(width", "piece.width", "width"],
      ["const values", "= values", "values"],
      ["const values", "for item in values", "values"],
      ["for item", "{ item *", "item"],
      ["carry total", "= total", "total"],
      ["for i ", "next total = i", "i"]
    ] as const) {
      const declarationRange = range(source, declaration, name);
      const referenceRange = range(source, use, name);
      expect.soft(queryDslDefinition({ ...snapshot, position: referenceRange.from }), use).toEqual({ declarationRange, referenceRange });
      expect.soft(queryDslReferences({ ...snapshot, position: declarationRange.from })?.referenceRanges ?? [], use).toContainEqual(referenceRange);
    }
    const values = range(source, "const values", "values");
    expect(queryDslReferences({ ...snapshot, position: values.from })).toEqual({
      declarationRange: values, referenceRanges: [range(source, "= values", "values"), range(source, "for item in values", "values")]
    });
  });

  it("fails closed on unresolved paths, removed sigils, quoted identifiers, and stale semantic authority", () => {
    const invalid = `${simpleSource}
const invalidPath: number = front::missing.length
point Legacy = coordinate(x: 0, y: 0)
point Invalid = offset(from: @Legacy, dx: 1, dy: 0)
const invalidMember: number = @front::edge.length
const invalidQuoted: number = front::"edge".length`;
    const snapshot = compile(invalid);
    expect(errors(snapshot).length).toBeGreaterThan(0);
    for (const [context, token] of [
      ["front::missing", "front"], ["front::missing", "missing"], ["from: @Legacy", "Legacy"],
      ["@front::edge", "edge"], ['front::"edge"', "edge"]
    ] as const) {
      const cursor = range(invalid, context, token).from;
      expect(queryDslDefinition({ ...snapshot, position: cursor }), context).toBeNull();
      expect(queryDslGeometryHoverTarget({ ...snapshot, position: cursor }), context).toBeNull();
      expect(queryDslReferences({ ...snapshot, position: cursor }), context).toBeNull();
      expect(queryDslRenameTarget(snapshot, cursor)).toBeNull();
    }
    const exact = compile(simpleSource);
    for (const semantic of [undefined, { ...exact.semantic, sourceRevision: 18 }, {
      ...compile(simpleSource + "\n").semantic, sourceText: simpleSource
    }]) {
      const stale = { source: exact.source, semantic };
      const cursor = range(simpleSource, "= front::edge", "edge").from;
      expect(queryDslDefinition({ ...stale, position: cursor })).toBeNull();
      expect(queryDslGeometryHoverTarget({ ...stale, position: cursor })).toBeNull();
      expect(queryDslReferences({ ...stale, position: cursor })).toBeNull();
      expect(planDslRenameEditsResult(stale, cursor, "seam")).toMatchObject({ status: "rejected" });
    }
  });

  it("uses a geometry caller for bare Module shorthand and can rename either identity", () => {
    const source = `nui 1
point base = coordinate(x: 0, y: 0)
module Marker(base: point) {
  export point P = coordinate(x: base.x, y: 0)
}
instance marker = Marker(base)`;
    const snapshot = compile(source);
    expect(errors(snapshot)).toEqual([]);
    const caller = range(source, "point base", "base");
    const parameter = range(source, "module Marker(base", "base");
    const internal = range(source, "x: base.x", "base");
    const shorthand = range(source, "= Marker(base", "base");
    expect(queryDslDefinition({ ...snapshot, position: shorthand.from })).toEqual({
      referenceRange: shorthand, declarationRange: caller
    });
    expect(queryDslReferences({ ...snapshot, position: caller.from })).toEqual({
      declarationRange: caller, referenceRanges: [shorthand]
    });
    const elementId = [...snapshot.semantic.compiled.sourceElementsByStatementIndex.values()].find((entry) => entry.name === "base")?.id;
    expect(queryDslGeometryHoverTarget({ ...snapshot, position: shorthand.from })).toEqual({ range: shorthand, elementId });
    verifyRename(source, caller.from, "origin", source
      .replace("point base", "point origin")
      .replace("= Marker(base)", "= Marker(base: origin)"), [
      { ...caller, expectedText: "base", newText: "origin" },
      { ...shorthand, expectedText: "base", newText: "base: origin" }
    ]);
    verifyRename(source, parameter.from, "anchor", source
      .replace("module Marker(base:", "module Marker(anchor:")
      .replace("x: base.x", "x: anchor.x")
      .replace("= Marker(base)", "= Marker(anchor: base)"), [
      { ...parameter, expectedText: "base", newText: "anchor" },
      { ...internal, expectedText: "base", newText: "anchor" },
      { ...shorthand, expectedText: "base", newText: "anchor: base" }
    ]);
  });

  it("indexes whole record aliases and Module record arguments", () => {
    const source = `nui 1
record Shape(width: number)
const piece: Shape = Shape(width: 7)
const copied: Shape = piece
module Foo(piece: Shape) {
  const inner: Shape = piece
}
instance Use = Foo(piece)`;
    const snapshot = compile(source);
    expect(errors(snapshot)).toEqual([]);
    const caller = range(source, "const piece", "piece");
    const alias = range(source, "const copied: Shape = piece", "piece");
    const parameter = range(source, "module Foo(piece", "piece");
    const internal = range(source, "const inner: Shape = piece", "piece");
    const shorthand = range(source, "= Foo(piece)", "piece");
    for (const [referenceRange, declarationRange] of [[alias, caller], [internal, parameter], [shorthand, caller]]) {
      expect.soft(queryDslDefinition({ ...snapshot, position: referenceRange!.from })).toEqual({
        referenceRange, declarationRange
      });
    }
    verifyRename(source, parameter.from, "shape", source
      .replace("module Foo(piece:", "module Foo(shape:")
      .replace("const inner: Shape = piece", "const inner: Shape = shape")
      .replace("= Foo(piece)", "= Foo(shape: piece)"), [
      { ...parameter, expectedText: "piece", newText: "shape" },
      { ...internal, expectedText: "piece", newText: "shape" },
      { ...shorthand, expectedText: "piece", newText: "shape: piece" }
    ]);
  });

  it("keeps a geometry carry reference tied to its loop declaration", () => {
    const source = `nui 1
point Start = coordinate(x: 0, y: 0)
for i in range(min: 0, max: 0, step: 1) carry cursor: point = Start {
  point Step = offset(from: cursor, dx: 1, dy: 0)
  next cursor = Step
}
point End = offset(from: cursor, dx: 0, dy: 0)`;
    const snapshot = compile(source);
    expect(errors(snapshot)).toEqual([]);
    const declarationRange = range(source, "carry cursor", "cursor");
    const beforeNext = range(source, "from: cursor, dx: 1", "cursor");
    const next = range(source, "next cursor", "cursor");
    const afterLoop = range(source, "from: cursor, dx: 0", "cursor");
    for (const referenceRange of [beforeNext, next, afterLoop]) {
      expect.soft(queryDslDefinition({ ...snapshot, position: referenceRange.from })).toEqual({ declarationRange, referenceRange });
    }
    expect(queryDslReferences({ ...snapshot, position: declarationRange.from })).toEqual({
      declarationRange, referenceRanges: [beforeNext, next, afterLoop]
    });
  });

  it("uses exact geometry tokens inside bare transformation arguments", () => {
    const source = `nui 1
line A = segment(start: (0, 0), end: (10, 0))
line B = segment(start: (10, 0), end: (20, 0))
move A(from: B.start, to: (0, 0))`;
    const snapshot = compile(source);
    expect(errors(snapshot)).toEqual([]);
    const declarationRange = range(source, "line B", "B");
    const referenceRange = range(source, "from: B.start", "B");
    expect(queryDslDefinition({ ...snapshot, position: referenceRange.from })).toEqual({ declarationRange, referenceRange });
    expect(queryDslReferences({ ...snapshot, position: declarationRange.from })).toEqual({
      declarationRange, referenceRanges: [referenceRange]
    });
  });

  it("proves imported Module ownership while retaining the local caller shorthand identity", async () => {
    const libraryText = `nui 1
export module Pocket(幅: number) {
  export const measure: number = 幅
}`;
    const source = `nui 1
import "./@library.nui" as library
/// @en "😀"
const 幅: number = 6
instance Use = library::Pocket(幅)
const copied: number = Use::measure`;
    const root = {
      kind: "root-current" as const,
      documentId: documentIdFromHost("file:///workspace/root.nui"),
      normalizedSource: source,
      sourceRevision: 17
    };
    const library = {
      kind: "dependency-saved" as const,
      documentId: documentIdFromHost("file:///workspace/@library.nui"),
      normalizedSource: libraryText,
      savedSourceFingerprint: savedSourceFingerprintFromHost("issue1697:library")
    };
    const cache = new SavedDocumentArtifactCache();
    const compileImported = async (current: typeof root, ids?: ReadonlyMap<number, string>) => {
      const graph = await buildMultiDocumentImportGraph({
        root: current,
        loader: {
          async loadSavedDependency(importerDocumentId, relativePath) {
            return importerDocumentId === current.documentId && relativePath === "./@library.nui"
              ? { status: "loaded", snapshot: library }
              : { status: "failed", reason: "missing" };
          }
        },
        declarationContributors: [moduleDeclarationContributor],
        cache,
        rootStatementIdByStatementIndex: ids
      });
      const analysis = analyzeMultiDocumentModuleSemantics(graph);
      const artifact = graph.nodes.get(current.documentId)!.artifact;
      const compiled = compileDslDocument(current.normalizedSource, {
        preparsed: artifact.parsed, sourceRevision: current.sourceRevision,
        assignedStatementIds: artifact.statementIdByStatementIndex,
        moduleRuntimeContext: createModuleRuntimeContext(graph, analysis)
      });
      return { graph, compiled, artifact };
    };
    const { graph, compiled, artifact } = await compileImported(root);
    const snapshot = { source: root, semantic: { compiled, sourceRevision: root.sourceRevision } };
    expect(errors(snapshot)).toEqual([]);
    const index = buildMultiDocumentSemanticOccurrenceIndex({
      graph,
      documentViews: [projectMultiDocumentModuleSemanticDocumentView({ source: root, compiled })]
    });
    const callee = range(source, "library::Pocket", "Pocket");
    const result = queryMultiDocumentDefinition({ index, documentId: root.documentId, position: callee.from });
    expect(result).toMatchObject({
      reference: { range: callee },
      target: { source: { documentId: library.documentId }, range: range(libraryText, "module Pocket", "Pocket") }
    });

    const caller = range(source, "const 幅", "幅");
    const shorthand = range(source, "Pocket(幅", "幅");
    expect(queryDslDefinition({ ...snapshot, position: shorthand.from })).toEqual({
      referenceRange: shorthand, declarationRange: caller
    });
    expect(queryDslReferences({ ...snapshot, position: caller.from })).toEqual({
      declarationRange: caller, referenceRanges: [shorthand]
    });
    const renamed = planDslRenameEditsResult(snapshot, shorthand.from, "外幅");
    expect(renamed, JSON.stringify(renamed)).toMatchObject({
      status: "ok",
      plan: { edits: [
        { ...caller, expectedText: "幅", newText: "外幅" },
        { ...shorthand, expectedText: "幅", newText: "幅: 外幅" }
      ] }
    });
    if (renamed.status !== "ok") return;
    const updated = applyRenameEdits(source, renamed.plan.edits);
    expect(updated).toBe(source.replace("const 幅:", "const 外幅:").replace("Pocket(幅)", "Pocket(幅: 外幅)"));
    const updatedRoot = { ...root, normalizedSource: updated, sourceRevision: 18 };
    const after = await compileImported(updatedRoot, artifact.statementIdByStatementIndex);
    expect(errors({ source: updatedRoot, semantic: { compiled: after.compiled, sourceRevision: updatedRoot.sourceRevision } })).toEqual([]);
    expect(after.compiled.statementMap?.statementIdByStatementIndex).toEqual(compiled.statementMap?.statementIdByStatementIndex);
    expect(moduleSemanticStableFingerprint(after.compiled)).toBe(moduleSemanticStableFingerprint(compiled));
  });

  it("does not navigate an unresolved shorthand to the callee parameter", () => {
    const source = shorthandSource.replace("const width: number = 4\n", "");
    const snapshot = compile(source);
    expect(errors(snapshot).length).toBeGreaterThan(0);
    const shorthand = range(source, "= Foo(width", "width");
    expect(queryDslDefinition({ ...snapshot, position: shorthand.from })).toBeNull();
    expect(queryDslReferences({ ...snapshot, position: shorthand.from })).toBeNull();
  });

  it("keeps a local Module export separate from an explicitly spelled same-name argument", () => {
    const source = shorthandSource
      .replace("const copied:", "export const copied:")
      .replace("Foo(width)", "Foo(width: width)") + "\nconst result: number = Use::copied";
    const snapshot = compile(source);
    expect(errors(snapshot)).toEqual([]);
    const declarationRange = range(source, "export const copied", "copied");
    const referenceRange = range(source, "Use::copied", "copied");
    expect(queryDslDefinition({ ...snapshot, position: referenceRange.from })).toEqual({ declarationRange, referenceRange });
    expect(queryDslReferences({ ...snapshot, position: declarationRange.from })).toEqual({
      declarationRange, referenceRanges: [referenceRange]
    });
    const caller = range(source, "const width", "width");
    const explicitValue = range(source, "Foo(width: width)", "width");
    verifyRename(source, caller.from, "outerWidth", source
      .replace("const width:", "const outerWidth:")
      .replace("Foo(width: width)", "Foo(width: outerWidth)"), [
      { ...caller, expectedText: "width", newText: "outerWidth" },
      { ...explicitValue, expectedText: "width", newText: "outerWidth" }
    ]);
  });

  it("rejects a quoted geometry Rename and resolves a bare property on a simple line", () => {
    const source = `nui 1
line AB = segment(start: (0, 0), end: (10, 0))
const length: number = AB.length`;
    const snapshot = compile(source);
    expect(errors(snapshot)).toEqual([]);
    const declarationRange = range(source, "line AB", "AB");
    const referenceRange = range(source, "AB.length", "length");
    expect(queryDslDefinition({ ...snapshot, position: referenceRange.from })).toEqual({ declarationRange, referenceRange });
    expect(planDslRenameEditsResult(snapshot, declarationRange.from, '"quoted name"')).toMatchObject({
      status: "rejected", rejection: { reason: "invalid-name" }
    });
  });

  it("starts F2 on the compiler-proven shorthand caller", () => {
    const snapshot = compile(shorthandSource);
    expect(errors(snapshot)).toEqual([]);
    const caller = range(shorthandSource, "const width", "width");
    const shorthand = range(shorthandSource, "= Foo(width", "width");
    expect.soft(queryDslRenameTarget(snapshot, shorthand.from)).toEqual({
      oldName: "width", sourceRevision: snapshot.source.sourceRevision, range: shorthand
    });
    verifyRename(shorthandSource, shorthand.from, "outerWidth", shorthandSource
      .replace("const width:", "const outerWidth:")
      .replace("= Foo(width)", "= Foo(width: outerWidth)"), [
      { ...caller, expectedText: "width", newText: "outerWidth" },
      { ...shorthand, expectedText: "width", newText: "width: outerWidth" }
    ]);
  });

  it("keeps F2 unavailable for competing non-shorthand declarations", () => {
    const source = `nui 1
const width: number = 1
const width: number = 2
const selected: number = width`;
    const snapshot = compile(source);
    const use = range(source, "= width", "width");
    expect(queryDslRenameTarget(snapshot, use.from)).toBeNull();
    expect(planDslRenameEditsResult(snapshot, use.from, "outerWidth")).toEqual({
      status: "rejected", rejection: { reason: "unavailable" }
    });
  });

  it("uses the selected F12 identity in relative and absolute geometry paths", () => {
    const snapshot = compile(simpleSource);
    expect(errors(snapshot)).toEqual([]);
    const group = range(simpleSource, "group front", "front");
    const edge = range(simpleSource, "line edge", "edge");
    for (const context of ["= front::edge.length", "= ::front::edge.length"]) {
      for (const [name, declarationRange] of [["front", group], ["edge", edge], ["length", edge]] as const) {
        const referenceRange = range(simpleSource, context, name);
        expect.soft(queryDslDefinition({ ...snapshot, position: referenceRange.from }), context + " / " + name)
          .toEqual({ declarationRange, referenceRange });
      }
    }
  });

  it("renames a value-for binder to 項目 and preserves its lexical identity", () => {
    const source = `nui 1
/// @en "😀"
const values: number[] = [1, 2]
const factor: number = 2
const result: number[] = for item in values { item * factor }`;
    const declaration = range(source, "for item", "item");
    const use = range(source, "{ item *", "item");
    const snapshot = compile(source);
    expect(errors(snapshot)).toEqual([]);
    expect(queryDslRenameTarget(snapshot, use.from)?.range).toEqual(use);
    expect(planDslRenameEditsResult(snapshot, use.from, "factor")).toMatchObject({
      status: "rejected", rejection: { reason: "reference-resolution-change", referencedName: "factor" }
    });
    const expected = source.replace("for item", "for 項目").replace("{ item *", "{ 項目 *");
    const after = verifyRename(source, use.from, "項目", expected, [declaration, use]
      .map((entry) => ({ ...entry, expectedText: "item", newText: "項目" })));
    if (!after) return;
    const renamedDeclaration = range(expected, "for 項目", "項目");
    const renamedUse = range(expected, "{ 項目 *", "項目");
    expect(queryDslReferences({ ...after, position: renamedUse.from })).toEqual({
      declarationRange: renamedDeclaration, referenceRanges: [renamedUse]
    });
    const bindingAt = (state: typeof snapshot, from: number) =>
      createDslSemanticOccurrenceIndex(state.semantic.compiled).occurrences
        .find((entry) => entry.kind === "declaration" && entry.from === from)?.identity;
    expect(bindingAt(after, renamedDeclaration.from)).toEqual(bindingAt(snapshot, declaration.from));
  });

  const carrySource = `nui 1
/// @en "😀"
for i in range(min: 0, max: 1, step: 1) carry total: number = 0 carry occupied: number = 0 {
  next total = total + i
  next occupied = occupied + i
}
const result: number = total`;
  const japaneseCarrySource = carrySource
    .replace("carry total", "carry 合計").replace("next total = total", "next 合計 = 合計").replace("= total", "= 合計");

  it("compiles a bare Japanese carry declaration, next target and reference", () => {
    expect(errors(compile(japaneseCarrySource))).toEqual([]);
  });

  it("renames a carry to 合計 with exact declaration, next and value edits", () => {
    const declaration = range(carrySource, "carry total", "total");
    const references = [
      range(carrySource, "next total =", "total"),
      range(carrySource, "= total +", "total"),
      range(carrySource, "number = total", "total")
    ];
    const snapshot = compile(carrySource);
    expect(errors(snapshot)).toEqual([]);
    expect(queryDslRenameTarget(snapshot, references[2]!.from)?.range).toEqual(references[2]);
    expect(planDslRenameEditsResult(snapshot, references[2]!.from, "occupied")).toMatchObject({
      status: "rejected", rejection: { reason: "same-scope-collision", conflictingName: "occupied" }
    });
    const after = verifyRename(carrySource, references[2]!.from, "合計", japaneseCarrySource,
      [declaration, ...references].map((entry) => ({ ...entry, expectedText: "total", newText: "合計" })));
    if (!after) return;
    const renamed = range(japaneseCarrySource, "carry 合計", "合計");
    const renamedReferences = [
      range(japaneseCarrySource, "next 合計 =", "合計"),
      range(japaneseCarrySource, "= 合計 +", "合計"),
      range(japaneseCarrySource, "number = 合計", "合計")
    ];
    for (const referenceRange of renamedReferences) {
      expect(queryDslDefinition({ ...after, position: referenceRange.from })).toEqual({
        declarationRange: renamed, referenceRange
      });
    }
    expect(queryDslReferences({ ...after, position: renamed.from })).toEqual({
      declarationRange: renamed, referenceRanges: renamedReferences
    });
  });

  it.each(["wrong-name", "two words", '"quoted"', " leading", "true", "none", "pi"])(
    "rejects invalid binder and carry rename name %s",
    (newName) => {
      const binderSource = "nui 1\nconst values: number[] = [1, 2]\nconst doubled: number[] = for item in values { item * 2 }";
      for (const [source, context, name] of [
        [binderSource, "for item", "item"], [carrySource, "carry total", "total"]
      ] as const) {
        expect.soft(planDslRenameEditsResult(compile(source), range(source, context, name).from, newName)).toMatchObject({
          status: "rejected", rejection: { reason: "invalid-name" }
        });
      }
    }
  );

  it.each([
    {
      valid: "nui 1\npoint A = coordinate(x: 0, y: 0)\npoint B = offset(from: A, dx: 1, dy: 0)",
      invalidToken: "@A", validToken: "from: A", replacement: "from: @A",
      code: "invalid-source-reference", highlight: "@"
    },
    {
      valid: "nui 1\nconst 幅: number = 4",
      invalidToken: '"幅"', validToken: "const 幅", replacement: 'const "幅"',
      code: "quoted-identifier-not-allowed", highlight: '"幅"'
    }
  ])("reports $code at the exact authored token", ({ valid, validToken, replacement, invalidToken, code, highlight }) => {
    expect(errors(compile(valid))).toEqual([]);
    const invalid = valid.replace(validToken, replacement);
    const expectedRange = range(invalid, invalidToken, highlight);
    const snapshot = compile(invalid);
    expect(errors(snapshot).map((diagnostic) => ({
      code: diagnostic.code, ranges: diagnostic.physicalSpan?.segments
    }))).toEqual([{ code, ranges: [expectedRange] }]);
  });

  it("rejects a binding collision, lexical capture and invalid rename names", () => {
    const source = `nui 1
const width: number = 4
const occupied: number = 5
group Inner {
  const size: number = 7
  const copied: number = width
}`;
    const snapshot = compile(source);
    expect(errors(snapshot)).toEqual([]);
    const cursor = range(source, "const width", "width").from;
    for (const [newName, reason] of [
      ["occupied", "same-scope-collision"], ["size", "reference-resolution-change"], ['"width two"', "invalid-name"]
    ]) {
      expect(planDslRenameEditsResult(snapshot, cursor, newName)).toMatchObject({
        status: "rejected", rejection: { reason }
      });
    }
  });
});

function verifyRename(
  source: string,
  cursor: number,
  newName: string,
  expected: string,
  expectedEdits: { from: number; to: number; expectedText: string; newText: string }[]
) {
  const before = compile(source);
  const result = planDslRenameEditsResult(before, cursor, newName);
  expect(result).toMatchObject({ status: "ok" });
  if (result.status !== "ok") return;
  expect(result.plan.sourceRevision).toBe(before.source.sourceRevision);
  const edits = [...result.plan.edits];
  expect(edits).toEqual(expectedEdits);
  const updated = applyRenameEdits(source, edits);
  expect(updated).toBe(expected);
  const after = compile(updated, 18);
  expect(errors(after)).toEqual([]);
  expect(after.semantic.compiled.statementMap?.statementIdByStatementIndex)
    .toEqual(before.semantic.compiled.statementMap?.statementIdByStatementIndex);
  expect(moduleSemanticStableFingerprint(after.semantic.compiled))
    .toBe(moduleSemanticStableFingerprint(before.semantic.compiled));
  return after;
}


function applyRenameEdits(
  source: string,
  edits: readonly { from: number; to: number; expectedText: string; newText: string }[]
): string {
  return [...edits].reverse().reduce((text, { from, to, expectedText, newText }) => {
    expect(text.slice(from, to)).toBe(expectedText);
    return text.slice(0, from) + newText + text.slice(to);
  }, source);
}
