import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  defaultVisibilityProfile,
  emptyDocument,
  queryDslCanvasSourceDefinition,
  queryDslDocumentSymbols
} from "@nuinuicad/nui-language";
import { applyLineSplices, compileCanonicalText, compileFreshCanonicalText, regenerateCanonicalFromModel } from "@nuinuicad/nui-language/document";
import { evaluateElements } from "../geometry/evaluate";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import { evaluationPayloadToResult } from "../geometry/evaluationPayload";
import { createRustStdioParityClient } from "../../test/evaluationParitySupport";
import { useCadDocumentStore, initialCadDocumentState } from "../state/cadDocumentStore";
import { useCadUiStore, initialCadUiState } from "../state/cadUiStore";
import type { CadElement, EvaluationResult } from "../types/geometry";
import { dispatchCommand } from "./commands";
import { dslReferenceCompletionOptions } from "../dsl/dslCompletionCandidates";
import { referencePickCandidates } from "../model/referencePickCandidates";
import {
  planDuplicateAsSnapshot,
  type DuplicateAsSnapshotPlan
} from "./duplicateAsSnapshot";

const sourceFixture = [
  "nui 1",
  "group {",
  "  point = coordinate(x: 11, y: 22)",
  "  line = segment(start: (30, 5), end: (55, 5))",
  "}",
  "group {",
  "  arc = arc(center: (100, 20), radius: 13, start: 230, end: 20, direction: clockwise)",
  "  curve = bezier(start: (0, 0), end: (10, 0), startAngle: 0, startLength: 3, endAngle: 180, endLength: 4, intermediates: [knot(point: (5, 4), angle: 90, incoming: 2, outgoing: 1)])",
  "  line Poly = polyline(points: [(70, 10), (75, 10), (75, 15)], closed: false)",
  "  line Base = segment(start: (80, 0), end: (90, 0))",
  "  line Offset = offset(sources: [@Base], distance: 2, side: right, closed: false, suppressTrimWarnings: false)",
  "  line JoinA = segment(start: (0, 30), end: (5, 30))",
  "  line JoinB = segment(start: (5, 30), end: (10, 33))",
  "  line Joined = join(paths: [@JoinA, @JoinB], closed: false)",
  "}"
].join("\n");

const compile = (source: string) => {
  const result = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), source);
  if (result.status === "fatal") throw new Error(JSON.stringify(result.diagnostics));
  expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  expect(result.bindingIssueDiagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  return result;
};

const optionsFor = (compiled: ReturnType<typeof compile>) => buildEvaluationOptions({
  compiledDocument: compiled.doc,
  evaluationLimitIndex: compiled.doc.document.evaluationLimitIndex
});

let rust: ReturnType<typeof createRustStdioParityClient>;
beforeAll(() => { rust = createRustStdioParityClient(process.cwd()); }, 30_000);
afterAll(() => rust?.dispose());
afterEach(() => {
  useCadDocumentStore.setState(initialCadDocumentState());
  useCadUiStore.setState(initialCadUiState());
});

const elementAtSourceLine = (compiled: { sourceText: string; doc: ReturnType<typeof compile>["doc"] }, startsWith: string) => {
  const lineIndex = compiled.sourceText.split("\n").findIndex((line) => line.trimStart().startsWith(startsWith));
  if (lineIndex < 0) throw new Error(`missing fixture line: ${startsWith}`);
  const statement = compiled.doc.statementMap.statements.find((item) => item.line === lineIndex + 1);
  if (!statement) throw new Error(`missing element statement at line ${lineIndex + 1}`);
  const elementId = compiled.doc.statementMap.elementIdByStatementIndex.get(statement.statementIndex);
  if (!elementId) throw new Error(`missing element ID at line ${lineIndex + 1}`);
  return elementId;
};

const selectedLines = [
  "point =",
  "line =",
  "arc =",
  "curve =",
  "line Poly",
  "line Offset",
  "line Joined"
];

const presentation = {
  visibilityProfiles: [defaultVisibilityProfile()],
  activeVisibilityProfileId: defaultVisibilityProfile().id,
  showCanvasPoints: true
};

const setupSelectedDocument = (source: string, selectedSourceLines: readonly string[]) => {
  useCadDocumentStore.getState().replaceTextDocument(source, { currentFilePath: "/tmp/duplicate-as-snapshot.nui", dirtySinceSave: false });
  const state = useCadDocumentStore.getState();
  const selectedElementIds = selectedSourceLines.map((line) => elementAtSourceLine(state, line));
  useCadUiStore.getState().setCanvasSelectionEligibility(state.elements, new Set(state.elements.map(({ id }) => id)));
  useCadUiStore.getState().setSelectedElementIds([...selectedElementIds], selectedElementIds[0]);
  return { state: useCadDocumentStore.getState(), selectedElementIds };
};

const dispatchSnapshot = (evaluation: ReturnType<typeof evaluateElements>, selectedElementIds: readonly string[], authority = vi.fn(() => true)) =>
  dispatchCommand("duplicateAsSnapshot", {
    evaluation,
    evaluationIsCurrent: true,
    duplicateSnapshotSelectedElementIds: selectedElementIds,
    duplicateSnapshotAuthorityIsCurrent: authority,
    duplicateSnapshotCanvasPresentation: presentation
  });

const snapshotGroupFor = (compiled: ReturnType<typeof compile>, plan: DuplicateAsSnapshotPlan) => {
  const groupId = plan.createdElementIds[0]!;
  const group = compiled.doc.document.elements.find(({ id }) => id === groupId);
  if (!group || group.type !== "group") throw new Error("snapshot root group was not compiled");
  return {
    group,
    children: compiled.doc.document.elements.filter(({ parentGroupId }) => parentGroupId === groupId)
  };
};

const assertClose = (actual: number, expected: number) => expect(actual).toBeCloseTo(expected, 9);
const assertPoint = (actual: { x: number; y: number }, expected: { x: number; y: number }) => {
  assertClose(actual.x, expected.x);
  assertClose(actual.y, expected.y);
};
const assertLine = (actual: unknown, start: { x: number; y: number }, end: { x: number; y: number }) => {
  expect(actual).toMatchObject({ kind: "line" });
  const line = actual as { start: { x: number; y: number }; end: { x: number; y: number } };
  assertPoint(line.start, start);
  assertPoint(line.end, end);
};

describe("Duplicate as Snapshot planner and command", () => {
  it("snapshots mixed unconnected geometry across groups with independent world-coordinate oracles", async () => {
    const original = compile(sourceFixture);
    const originalElements = original.doc.document.elements;
    const originalOptions = optionsFor(original);
    const tsBefore = evaluateElements(originalElements, originalOptions);
    const rustBefore = evaluationPayloadToResult(await rust.evaluate(
      originalElements,
      originalOptions
    ));
    expect(tsBefore.errors).toEqual([]);
    expect(rustBefore.errors).toEqual([]);
    const selectedElementIds = selectedLines.map((line) => elementAtSourceLine(original, line));
    for (const id of selectedElementIds) expect(tsBefore.computedGeometry.get(id)?.kind).toBe(rustBefore.computedGeometry.get(id)?.kind);

    const planned = planDuplicateAsSnapshot({
      sourceText: original.sourceText,
      compiled: original.doc,
      compiledDocumentRevision: 1,
      elements: originalElements,
      evaluation: rustBefore,
      selectedElementIds,
      presentation
    });
    expect(planned.status).toBe("planned");
    if (planned.status !== "planned") return;
    const { plan } = planned;
    expect(plan.splices).toHaveLength(1);
    expect(plan.createdElementIds).toHaveLength(11); // one root group plus ten primitive declarations
    expect(plan.generatedElementIds).toHaveLength(10);
    const patched = applyLineSplices(original.sourceText, plan.splices);
    const groupStart = patched.lastIndexOf("group {");
    const generatedSource = patched.slice(groupStart);
    expect(generatedSource).toMatch(/^group \{\n(?: {2}(?:point|line|arc|curve) = .+\n)+\}$/);
    expect(generatedSource).not.toContain("@");
    expect(generatedSource).not.toContain("[Guide");
    expect(generatedSource).not.toContain(" in @");

    const snap = compileCanonicalText(original, patched, { createdElementIds: plan.createdElementIds });
    expect(snap.status).not.toBe("fatal");
    expect(snap.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const { group, children } = snapshotGroupFor(snap, plan);
    expect(group.name).toBe("");
    expect(new Set([group.id, ...children.map(({ id }) => id)]).size).toBe(11);
    expect(children).toHaveLength(10);
    expect(children.every((element) => element.name === "" && element.activity === "visible" &&
      element.parentGroupId === group.id && element.modifierNames === undefined)).toBe(true);
    const tsAfter = evaluateElements(snap.doc.document.elements, optionsFor(snap));
    const rustAfter = evaluationPayloadToResult(await rust.evaluate(
      snap.doc.document.elements,
      optionsFor(snap)
    ));
    expect(tsAfter.errors).toEqual([]);
    expect(rustAfter.errors).toEqual([]);

    const copied = plan.generatedElementIds.map((id) => {
      const element = snap.doc.document.elements.find((candidate) => candidate.id === id)!;
      return { element, ts: tsAfter.computedGeometry.get(id)!, rust: rustAfter.computedGeometry.get(id)! };
    });
    expect(copied.map(({ ts }) => ts.kind)).toEqual([
      "point", "line", "arcLine", "bezierCurve", "bezierCurve", "line", "line", "line", "line", "line"
    ]);
    copied.forEach(({ ts, rust: rustGeometry }) => expect(ts.kind).toBe(rustGeometry.kind));

    // Independent input-coordinate oracles, including the clockwise signed sweep.
    const oracleSets = copied.map(({ ts, rust: rustGeometry }) => [ts, rustGeometry]);
    for (const [point, line] of [[oracleSets[0]!, oracleSets[1]!] as const]) {
      expect(point[0]).toMatchObject({ kind: "point" });
      assertPoint(point[0] as { x: number; y: number }, { x: 11, y: 22 });
      assertLine(line[0], { x: 30, y: 5 }, { x: 55, y: 5 });
      assertPoint(point[1] as { x: number; y: number }, { x: 11, y: 22 });
      assertLine(line[1], { x: 30, y: 5 }, { x: 55, y: 5 });
    }
    for (const arc of oracleSets[2]!) {
      expect(arc).toMatchObject({ kind: "arcLine", center: { x: 100, y: 20 }, radius: 13, startAngleDeg: 230, endAngleDeg: 20, sweepAngleDeg: -210 });
      const arcGeometry = arc as Extract<typeof arc, { kind: "arcLine" }>;
      assertPoint(arcGeometry.start, { x: 100 + 13 * Math.cos(230 * Math.PI / 180), y: 20 + 13 * Math.sin(230 * Math.PI / 180) });
      assertPoint(arcGeometry.end, { x: 100 + 13 * Math.cos(20 * Math.PI / 180), y: 20 + 13 * Math.sin(20 * Math.PI / 180) });
    }
    const bezierOracles = [
      [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 5, y: 2 }, { x: 5, y: 4 }],
      [{ x: 5, y: 4 }, { x: 5, y: 5 }, { x: 14, y: 0 }, { x: 10, y: 0 }]
    ];
    for (const index of [3, 4]) for (const geometry of oracleSets[index]!) {
      expect(geometry).toMatchObject({ kind: "bezierCurve" });
      const segments = (geometry as { segments: Array<{ start: { x: number; y: number }; control1: { x: number; y: number }; control2: { x: number; y: number }; end: { x: number; y: number } }> }).segments;
      expect(segments).toHaveLength(1);
      [segments[0]!.start, segments[0]!.control1, segments[0]!.control2, segments[0]!.end]
        .forEach((point, pointIndex) => assertPoint(point, bezierOracles[index - 3]![pointIndex]!));
    }
    for (const line of oracleSets[5]!) assertLine(line, { x: 70, y: 10 }, { x: 75, y: 10 });
    for (const line of oracleSets[6]!) assertLine(line, { x: 75, y: 10 }, { x: 75, y: 15 });
    for (const line of oracleSets[7]!) assertLine(line, { x: 80, y: -2 }, { x: 90, y: -2 });
    for (const line of oracleSets[8]!) assertLine(line, { x: 0, y: 30 }, { x: 5, y: 30 });
    for (const line of oracleSets[9]!) assertLine(line, { x: 5, y: 30 }, { x: 10, y: 33 });

    // The anonymous declarations stay navigable and selectable but never become public references or symbols.
    expect(queryDslCanvasSourceDefinition({
      source: { normalizedSource: snap.sourceText, sourceRevision: snap.doc.statementMap.sourceRevision },
      compiled: snap.doc,
      runtimeElementId: plan.generatedElementIds[0]!
    })).not.toBeNull();
    const symbolQuery = queryDslDocumentSymbols({
      source: { normalizedSource: snap.sourceText, sourceRevision: snap.doc.statementMap.sourceRevision },
      statements: snap.doc.statements,
      sourceMap: snap.doc.spans.sourceMap
    });
    const flattenSymbols = (symbols: typeof symbolQuery): typeof symbolQuery => symbols.flatMap((symbol) => [symbol, ...flattenSymbols(symbol.children)]);
    expect(flattenSymbols(symbolQuery).some((symbol) => symbol.selectionRange.from >= groupStart)).toBe(false);
    const snapshotReferenceCandidates = referencePickCandidates({ compiled: snap.doc, evaluation: rustAfter, target: null })
      .filter((candidate) => plan.generatedElementIds.includes(candidate.elementId));
    expect(snapshotReferenceCandidates.every((candidate) => candidate.options.length === 0)).toBe(true);

    const completionSource = `${snap.sourceText}\npoint Next = from(source: @)`;
    const completionMap = new Map([...snap.doc.statementMap.byElementId].map(([id, info]) => [info.line, id]));
    const completionOptions = dslReferenceCompletionOptions({
      source: completionSource,
      cursorLine: completionSource.split("\n").length,
      kind: "reference",
      statementElementIds: completionMap,
      elements: snap.doc.document.elements
    });
    expect(completionOptions.every((option) => plan.generatedElementIds.every((id) => !option.label.includes(id)))).toBe(true);

    const persisted = compileFreshCanonicalText(patched);
    expect(persisted.status).not.toBe("fatal");
    const reopenedRust = evaluationPayloadToResult(await rust.evaluate(
      persisted.doc.document.elements,
      buildEvaluationOptions({ compiledDocument: persisted.doc, evaluationLimitIndex: undefined })
    ));
    expect(reopenedRust.errors).toEqual([]);
    const persistedGroup = [...persisted.doc.document.elements].reverse().find((element) =>
      element.type === "group" && element.name === "" && !element.parentGroupId
    )!;
    const persistedChildren = persisted.doc.document.elements.filter((element) => element.parentGroupId === persistedGroup.id);
    expect(persistedChildren).toHaveLength(10);
    assertPoint(reopenedRust.computedGeometry.get(persistedChildren[0]!.id) as { x: number; y: number }, { x: 11, y: 22 });
    assertLine(reopenedRust.computedGeometry.get(persistedChildren[1]!.id), { x: 30, y: 5 }, { x: 55, y: 5 });
    expect(reopenedRust.computedGeometry.get(persistedChildren[2]!.id)).toMatchObject({
      kind: "arcLine", center: { x: 100, y: 20 }, radius: 13,
      startAngleDeg: 230, endAngleDeg: 20, sweepAngleDeg: -210
    });
    for (const [index, oracle] of bezierOracles.entries()) {
      const geometry = reopenedRust.computedGeometry.get(persistedChildren[3 + index]!.id);
      expect(geometry).toMatchObject({ kind: "bezierCurve" });
      const segment = (geometry as { segments: Array<{ start: { x: number; y: number }; control1: { x: number; y: number }; control2: { x: number; y: number }; end: { x: number; y: number } }> }).segments[0]!;
      [segment.start, segment.control1, segment.control2, segment.end].forEach((point, pointIndex) => assertPoint(point, oracle[pointIndex]!));
    }
    assertLine(reopenedRust.computedGeometry.get(persistedChildren[5]!.id), { x: 70, y: 10 }, { x: 75, y: 10 });
    assertLine(reopenedRust.computedGeometry.get(persistedChildren[6]!.id), { x: 75, y: 10 }, { x: 75, y: 15 });
    assertLine(reopenedRust.computedGeometry.get(persistedChildren[7]!.id), { x: 80, y: -2 }, { x: 90, y: -2 });
    assertLine(reopenedRust.computedGeometry.get(persistedChildren[8]!.id), { x: 0, y: 30 }, { x: 5, y: 30 });
    assertLine(reopenedRust.computedGeometry.get(persistedChildren[9]!.id), { x: 5, y: 30 }, { x: 10, y: 33 });

    // The Canvas selection boundary can select anonymous children for F12 navigation.
    useCadDocumentStore.getState().replaceTextDocument(patched, { currentFilePath: "/tmp/duplicate-as-snapshot.nui", dirtySinceSave: false });
    const loaded = useCadDocumentStore.getState();
    const rootGroup = [...loaded.elements].reverse().find((element) => element.type === "group" && element.name === "")!;
    const childIds = loaded.elements.filter((element) => element.parentGroupId === rootGroup.id).map(({ id }) => id);
    useCadUiStore.getState().setCanvasSelectionEligibility(loaded.elements, new Set(childIds));
    useCadUiStore.getState().setSelectedElementIds([childIds[0]!], childIds[0]);
    expect(useCadUiStore.getState().selectedElementIds).toEqual([childIds[0]]);
    expect(queryDslCanvasSourceDefinition({
      source: { normalizedSource: loaded.sourceText, sourceRevision: loaded.doc.statementMap.sourceRevision },
      compiled: loaded.doc,
      runtimeElementId: childIds[0]!
    })).not.toBeNull();
  }, 30_000);

  it("commits one atomic source change with one-step Undo and Redo", () => {
    const compiled = compile(["nui 1", "point P = coordinate(x: 12, y: 7)"].join("\n"));
    const { state, selectedElementIds } = setupSelectedDocument(compiled.sourceText, ["point P"]);
    const evaluation = evaluateElements(state.elements, buildEvaluationOptions({ compiledDocument: state.doc, evaluationLimitIndex: undefined }));
    const selectionBefore = useCadUiStore.getState().selectedElementIds;
    const historyBefore = state.past.length;
    const result = dispatchSnapshot(evaluation, selectedElementIds);
    expect(result).toMatchObject({ status: "applied" });
    const after = useCadDocumentStore.getState();
    expect(after.past).toHaveLength(historyBefore + 1);
    expect(after.sourceUpdate.kind).toBe("model-patch");
    expect(after.sourceUpdate.kind === "model-patch" ? after.sourceUpdate.splices : []).toHaveLength(1);
    expect(useCadUiStore.getState().selectedElementIds).toEqual(selectionBefore);
    const snapshotText = after.sourceText;
    useCadDocumentStore.getState().undo();
    expect(useCadDocumentStore.getState().sourceText).toBe(state.sourceText);
    useCadDocumentStore.getState().redo();
    expect(useCadDocumentStore.getState().sourceText).toBe(snapshotText);
    expect(useCadDocumentStore.getState().past).toHaveLength(historyBefore + 1);
  });

  it("rejects the whole mixed selection before mutation and preserves Source, selection, and history", () => {
    const compiled = compile([
      "nui 1",
      "point P = coordinate(x: 1, y: 2)",
      "text T = label(text: \"label\", anchor: (4, 5), size: 3)"
    ].join("\n"));
    const { state, selectedElementIds: selected } = setupSelectedDocument(compiled.sourceText, ["point P", "text T"]);
    const evaluation = evaluateElements(state.elements, buildEvaluationOptions({ compiledDocument: state.doc, evaluationLimitIndex: undefined }));
    const selectionBefore = useCadUiStore.getState().selectedElementIds;
    const historyBefore = state.past;
    const result = dispatchSnapshot(evaluation, selected);
    expect(result).toMatchObject({ status: "rejected" });
    expect(useCadDocumentStore.getState().sourceText).toBe(state.sourceText);
    expect(useCadDocumentStore.getState().past).toEqual(historyBefore);
    expect(useCadUiStore.getState().selectedElementIds).toEqual(selectionBefore);
    expect(useCadUiStore.getState().commandErrorMessage).toContain(selected[1]);
  });

  it("rejects missing, ambiguous, container-only, hidden, disabled, invalid, and unevaluated targets by identity", () => {
    const compiled = compile([
      "nui 1",
      "point P = coordinate(x: 1, y: 2)",
      "point Hidden = coordinate(x: 3, y: 4, visible: false)",
      "point Disabled = coordinate(x: 5, y: 6, enabled: false)",
      "group Container {",
      "  point Child = coordinate(x: 7, y: 8)",
      "}"
    ].join("\n"));
    const { state } = setupSelectedDocument(compiled.sourceText, ["point P"]);
    const pointId = elementAtSourceLine(state, "point P");
    const hiddenId = elementAtSourceLine(state, "point Hidden");
    const disabledId = elementAtSourceLine(state, "point Disabled");
    const containerId = elementAtSourceLine(state, "group Container");
    const evaluation = evaluateElements(state.elements, buildEvaluationOptions({
      compiledDocument: state.doc,
      evaluationLimitIndex: state.doc.document.evaluationLimitIndex
    }));
    const plan = (selectedElementIds: readonly string[], overrides: {
      elements?: readonly CadElement[];
      evaluation?: EvaluationResult;
    } = {}) => planDuplicateAsSnapshot({
      sourceText: state.sourceText,
      compiled: state.doc,
      compiledDocumentRevision: state.compiledDocumentRevision,
      elements: overrides.elements ?? state.elements,
      evaluation: overrides.evaluation ?? evaluation,
      selectedElementIds,
      presentation
    });
    const assertTargetRejected = (targetId: string, overrides?: Parameters<typeof plan>[1]) => {
      expect(plan([pointId, targetId], overrides)).toMatchObject({ status: "rejected", failure: { targetId } });
    };

    assertTargetRejected("missing-current-element");
    assertTargetRejected(containerId);
    assertTargetRejected(hiddenId);
    assertTargetRejected(disabledId);
    expect(plan([pointId], {
      elements: [...state.elements, { ...state.elements.find(({ id }) => id === pointId)! }]
    })).toMatchObject({ status: "rejected", failure: { targetId: pointId } });
    const invalidEvaluation: EvaluationResult = {
      ...evaluation,
      errors: [...evaluation.errors, {
        elementId: pointId,
        elementName: "P",
        missingDependencyId: "missing-dependency",
        message: "invalid source geometry"
      }]
    };
    expect(plan([pointId], { evaluation: invalidEvaluation })).toMatchObject({
      status: "rejected", failure: { targetId: pointId }
    });
    const unevaluated: EvaluationResult = {
      ...evaluation,
      evaluatedElementIds: new Set([...evaluation.evaluatedElementIds ?? []].filter((id) => id !== pointId))
    };
    expect(plan([pointId], { evaluation: unevaluated })).toMatchObject({
      status: "rejected", failure: { targetId: pointId }
    });
    expect(useCadDocumentStore.getState().sourceText).toBe(state.sourceText);
    expect(useCadDocumentStore.getState().past).toEqual(state.past);
  });

  it("rejects stale host authority, changed selection, closed paths, and nonfinite values without writes", () => {
    const compiled = compile([
      "nui 1",
      "point P = coordinate(x: 1, y: 2)",
      "line Base = segment(start: (0, 0), end: (10, 0))",
      "line ClosedOffset = offset(sources: [@Base], distance: 2, side: right, closed: true, suppressTrimWarnings: false)",
      "line ClosedJoin = join(paths: [@Base], closed: true)"
    ].join("\n"));
    const { state, selectedElementIds } = setupSelectedDocument(compiled.sourceText, ["point P"]);
    const [pointId] = selectedElementIds;
    const options = buildEvaluationOptions({ compiledDocument: state.doc, evaluationLimitIndex: undefined });
    const evaluation = evaluateElements(state.elements, options);
    const sourceBefore = state.sourceText;
    const historyBefore = state.past;

    expect(dispatchSnapshot(evaluation, [pointId], vi.fn(() => false))).toMatchObject({ status: "rejected" });
    expect(useCadDocumentStore.getState().sourceText).toBe(sourceBefore);
    expect(useCadDocumentStore.getState().past).toEqual(historyBefore);

    const closedOffsetId = elementAtSourceLine(state, "line ClosedOffset");
    const offsetPlan = planDuplicateAsSnapshot({
      sourceText: state.sourceText,
      compiled: state.doc,
      compiledDocumentRevision: state.compiledDocumentRevision,
      elements: state.elements,
      evaluation,
      selectedElementIds: [closedOffsetId],
      presentation
    });
    expect(offsetPlan).toMatchObject({ status: "rejected", failure: { targetId: closedOffsetId } });
    const closedJoinId = elementAtSourceLine(state, "line ClosedJoin");
    const joinPlan = planDuplicateAsSnapshot({
      sourceText: state.sourceText,
      compiled: state.doc,
      compiledDocumentRevision: state.compiledDocumentRevision,
      elements: state.elements,
      evaluation,
      selectedElementIds: [closedJoinId],
      presentation
    });
    expect(joinPlan).toMatchObject({ status: "rejected", failure: { targetId: closedJoinId } });

    const nonfinite = {
      ...evaluation,
      computedGeometry: new Map(evaluation.computedGeometry)
    };
    nonfinite.computedGeometry.set(pointId, { kind: "point", elementId: pointId, name: "P", x: Number.POSITIVE_INFINITY, y: 2 });
    const nonfinitePlan = planDuplicateAsSnapshot({
      sourceText: state.sourceText,
      compiled: state.doc,
      compiledDocumentRevision: state.compiledDocumentRevision,
      elements: state.elements,
      evaluation: nonfinite,
      selectedElementIds: [pointId],
      presentation
    });
    expect(nonfinitePlan).toMatchObject({ status: "rejected", failure: { targetId: pointId } });
    expect(useCadDocumentStore.getState().sourceText).toBe(sourceBefore);
    expect(useCadDocumentStore.getState().past).toEqual(historyBefore);
  });

  it("keeps snapshot coordinates independent of source parameters, transforms, occurrence counts, and visibility", async () => {
    const source = [
      "nui 1",
      "const shift: number = 5",
      "group Moving (visible: true) {",
      "  line Rail = segment(start: (0, 0), end: (20, 0))",
      "  move @Rail (from: (0, 0), to: (@shift, 3))",
      "}",
      "for i in range(min: 0, max: 1, step: 1) {",
      "  point Occurrence = coordinate(x: @i * 10, y: 0)",
      "}"
    ].join("\n");
    const original = compile(source);
    const elements = original.doc.document.elements;
    const selected = [elementAtSourceLine(original, "line Rail")];
    const [railId] = selected;
    const beforeOptions = optionsFor(original);
    const beforeTs = evaluateElements(elements, beforeOptions);
    const beforeRust = evaluationPayloadToResult(await rust.evaluate(
      elements,
      beforeOptions
    ));
    expect(beforeRust.errors).toEqual([]);
    assertLine(beforeTs.computedGeometry.get(railId), { x: 5, y: 3 }, { x: 25, y: 3 });
    assertLine(beforeRust.computedGeometry.get(railId), { x: 5, y: 3 }, { x: 25, y: 3 });
    const planned = planDuplicateAsSnapshot({
      sourceText: original.sourceText,
      compiled: original.doc,
      compiledDocumentRevision: 1,
      elements,
      evaluation: beforeRust,
      selectedElementIds: selected,
      presentation
    });
    expect(planned.status).toBe("planned");
    if (planned.status !== "planned") return;
    const snapshotText = applyLineSplices(original.sourceText, planned.plan.splices);
    const snapshotState = compile(snapshotText);
    const generatedGroup = [...snapshotState.doc.document.elements].reverse().find((element) =>
      element.type === "group" && element.name === "" && !element.parentGroupId
    )!;
    const generatedGroupId = generatedGroup.id;
    const generatedChildren = snapshotState.doc.document.elements.filter((element) => element.parentGroupId === generatedGroupId);
    expect(generatedChildren).toHaveLength(1);
    const changedText = snapshotText
      .replace("const shift: number = 5", "const shift: number = 31")
      .replace("Moving (visible: true)", "Moving (visible: false)")
      .replace("max: 1", "max: 3");
    const changed = compile(changedText);
    const changedEvaluation = evaluationPayloadToResult(await rust.evaluate(
      changed.doc.document.elements,
      buildEvaluationOptions({ compiledDocument: changed.doc, evaluationLimitIndex: undefined })
    ));
    const changedOriginal = changed.doc.document.elements.find((element) => element.name === "Rail")!;
    const changedSnapshotGroup = [...changed.doc.document.elements].reverse().find((element) =>
      element.type === "group" && element.name === "" && !element.parentGroupId
    )!;
    const changedSnapshot = changed.doc.document.elements.filter((element) => element.parentGroupId === changedSnapshotGroup.id);
    const changedOriginalGeometry = changedEvaluation.computedGeometry.get(changedOriginal.id)!;
    assertLine(changedOriginalGeometry, { x: 31, y: 3 }, { x: 51, y: 3 });
    expect(changedSnapshot).toHaveLength(1);
    assertLine(changedEvaluation.computedGeometry.get(changedSnapshot[0]!.id), { x: 5, y: 3 }, { x: 25, y: 3 });
    expect(changedEvaluation.effectiveVisibleElementIds?.has(changedOriginal.id)).toBe(false);
    expect(changedEvaluation.effectiveVisibleElementIds?.has(changedSnapshot[0]!.id)).toBe(true);
    expect(changedEvaluation.effectiveEnabledElementIds?.has(changedSnapshot[0]!.id)).toBe(true);
    expect(changedSnapshot[0]).toMatchObject({ activity: "visible", parentGroupId: changedSnapshotGroup.id });
    expect(changedSnapshot[0]?.modifierNames).toBeUndefined();
    expect(changedEvaluation.errors).toEqual([]);
    assertLine(beforeTs.computedGeometry.get(railId), { x: 5, y: 3 }, { x: 25, y: 3 });
    assertLine(beforeRust.computedGeometry.get(railId), { x: 5, y: 3 }, { x: 25, y: 3 });
  }, 30_000);
});
