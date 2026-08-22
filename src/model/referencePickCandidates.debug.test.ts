import { expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { moduleGeometryInterfaceTypeOfElement } from "../dsl/moduleGeometryInterfaces";
import { parseDslSnapshot } from "../dsl/dslParser";
import { queryDslReferencePickTarget } from "../dsl/dslReferencePickQuery";
import { resolveSourceLexicalPath } from "../dsl/sourceLexicalNamespaceIndex";
import { evaluateElements } from "../geometry/evaluate";

it("debugs standalone point candidate prerequisites", () => {
  const source = [
    "nui 4",
    "point A = coordinate(x: 0, y: 0)",
    "point B = coordinate(x: 20, y: 0)",
    "line Base = segment(start: @A, end: @B)",
    "point Offset = offset(from: @A, dx: 2, dy: 0)",
    "point On = onLine(from: @Base.start, distance: 5)"
  ].join("\n");
  const sourceRevision = 41;
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision });
  const compiled = compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `reference-pick:${index}`]))
  });
  expect(compiled.document).not.toBeNull();
  expect(compiled.statementMap).not.toBeNull();
  const evaluation = evaluateElements(compiled.document!.elements, {
    evaluationLimitIndex: compiled.document!.evaluationLimitIndex,
    statementInfoByElementId: compiled.statementMap!.byElementId,
    statementIdByStatementIndex: compiled.statementMap!.statementIdByStatementIndex,
    sourceExecutionPositionByElementId: compiled.moduleMaterialization?.sourceExecutionPositionByRuntimeElementId
  });
  const fragment = "from: @A";
  const fragmentStart = source.indexOf(fragment);
  const target = queryDslReferencePickTarget({
    source: { normalizedSource: source, sourceRevision },
    position: fragmentStart + fragment.indexOf("@") + 2,
    semantic: { sourceRevision, compiled }
  });
  expect(target).not.toBeNull();
  const element = compiled.document!.elements.find((candidate) => candidate.name === "A")!;
  const entry = compiled.moduleMaterialization?.executionStatements.find(
    (candidate) => candidate.runtimeElementId === element.id
  );
  const declaration = entry
    ? compiled.sourceLexicalNamespace?.allDeclarations.find(
        (candidate) => candidate.statementId === entry.sourceStatementId
      )
    : undefined;
  const resolution = compiled.sourceLexicalNamespace && target
    ? resolveSourceLexicalPath(
        compiled.sourceLexicalNamespace,
        target.sourceAnchor.statementIndex,
        { absolute: false, segments: ["A"] }
      )
    : null;

  throw new Error(JSON.stringify({
    element: { id: element.id, type: element.type, activity: element.activity },
    computedKind: evaluation.computedGeometry.get(element.id)?.kind ?? null,
    enabled: evaluation.effectiveEnabledElementIds?.has(element.id) ?? null,
    visible: evaluation.effectiveVisibleElementIds?.has(element.id) ?? null,
    evaluated: evaluation.evaluatedElementIds?.has(element.id) ?? null,
    entry: entry ? {
      sourceStatementId: entry.sourceStatementId,
      sourceStatementIndex: entry.sourceStatementIndex,
      statementKind: entry.statement.kind,
      statementCategory: entry.statement.kind === "element" ? entry.statement.category : null,
      interface: moduleGeometryInterfaceTypeOfElement(entry.statement),
      instancePathLength: entry.instancePath.length
    } : null,
    declaration: declaration ? {
      kind: declaration.kind,
      name: declaration.name,
      statementIndex: declaration.statementIndex,
      statementId: declaration.statementId
    } : null,
    resolution: resolution?.kind === "resolved" ? {
      kind: resolution.kind,
      name: resolution.declaration.name,
      statementIndex: resolution.declaration.statementIndex,
      statementId: resolution.declaration.statementId
    } : resolution ? { kind: resolution.kind } : null,
    target: target ? {
      statementIndex: target.sourceAnchor.statementIndex,
      scopeId: target.sourceAnchor.scopeId,
      expectedGeometryInterface: target.expectedGeometryInterface,
      role: target.role
    } : null
  }));
});
