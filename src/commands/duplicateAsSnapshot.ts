import {
  effectiveElementActivity,
  effectiveElementActivityById,
  elementTypesWithoutOwnDrawableGeometry,
  isContainerElement,
  sourceOwnerForRuntimeElementId
} from "@nuinuicad/nui-language";
import type { LastGoodDslDocument } from "@nuinuicad/nui-language/document";
import type { SourceSnapshot } from "@nuinuicad/nui-language";
import { createCadElementId } from "@nuinuicad/nui-language";
import { applyLineSplices, type LineSplice } from "@nuinuicad/nui-language/document";
import { effectiveCanvasVisibleElementIds } from "../geometry/canvasDrawingBounds";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import type { DocumentMutationResult } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import type { CadElement, ComputedGeometry, ElementId, EvaluationResult } from "../types/geometry";
import { getSelectedElementIds } from "./commandRuntime";
import type { Command, CommandContext } from "./commandTypes";
import {
  primitivesForGeometry,
  primitiveToElement,
  serializedPrimitiveLines,
  type BakePrimitive
} from "./bakeGeometry";

type SnapshotPresentation = NonNullable<CommandContext["duplicateSnapshotCanvasPresentation"]>;

export type DuplicateAsSnapshotFailure = {
  targetId: ElementId | null;
  reason: string;
};

export type DuplicateAsSnapshotPlan = {
  sourceSnapshot: SourceSnapshot;
  exactSourceText: string;
  compiledDocumentRevision: number;
  selectedElementIds: ElementId[];
  splices: [LineSplice];
  createdElementIds: ElementId[];
  generatedElementIds: ElementId[];
};

export type DuplicateAsSnapshotPlanningResult =
  | { status: "planned"; plan: DuplicateAsSnapshotPlan }
  | { status: "rejected"; failure: DuplicateAsSnapshotFailure };

const sameIds = (left: readonly ElementId[], right: readonly ElementId[]) =>
  left.length === right.length && left.every((id, index) => id === right[index]);

const reject = (targetId: ElementId | null, reason: string): DuplicateAsSnapshotPlanningResult => ({
  status: "rejected",
  failure: { targetId, reason }
});

const finitePoint = (point: { x: number; y: number }) =>
  Number.isFinite(point.x) && Number.isFinite(point.y);
const finiteCoordinateAnchor = (anchor: { mode: string; x?: unknown; y?: unknown }) =>
  anchor.mode === "coordinate" && typeof anchor.x === "number" && Number.isFinite(anchor.x) &&
  typeof anchor.y === "number" && Number.isFinite(anchor.y);

const finitePrimitive = (primitive: BakePrimitive) => {
  switch (primitive.kind) {
    case "point": return finitePoint(primitive.point);
    case "line": return finitePoint(primitive.start) && finitePoint(primitive.end);
    case "arc": return finitePoint(primitive.center) && Number.isFinite(primitive.radius) &&
      primitive.radius > 0 && Number.isFinite(primitive.startAngleDeg) && Number.isFinite(primitive.endAngleDeg);
    case "bezier": return finitePoint(primitive.start) && finitePoint(primitive.control1) &&
      finitePoint(primitive.control2) && finitePoint(primitive.end);
  }
};

const exactSourceOwner = (compiled: LastGoodDslDocument, elementId: ElementId) => {
  const owner = sourceOwnerForRuntimeElementId(compiled, elementId);
  if (!owner || owner.runtimeElementId !== elementId || owner.statement.statementIndex !== owner.sourceStatementIndex ||
      owner.statement.range.startLine < 1 || owner.statement.range.endLine < owner.statement.range.startLine) return false;
  if (owner.kind === "ordinary" || owner.kind === "moduleInstance") {
    const currentStatement = compiled.statementMap.byElementId.get(elementId);
    return currentStatement === owner.statement && currentStatement.sourceRevision === compiled.statementMap.sourceRevision;
  }
  // sourceOwnerForRuntimeElementId validates document identity, saved/current revision,
  // statement range, and sourceLocation for materialized module-body drawables.
  return Boolean(owner.sourceDocumentId && owner.sourceIdentity && owner.source && owner.sourceLocation);
};

const elementTypeForPrimitive = (primitive: BakePrimitive): CadElement["type"] =>
  primitive.kind === "point" ? "freePoint" : primitive.kind === "line" ? "line" :
    primitive.kind === "arc" ? "arcLine" : "bezierCurve";

const finiteSnapshotElement = (element: CadElement) => {
  if (element.type === "freePoint") return Number.isFinite(element.x) && Number.isFinite(element.y);
  if (element.type === "line") return finiteCoordinateAnchor(element.startPoint) && finiteCoordinateAnchor(element.endPoint);
  if (element.type === "arcLine") return finiteCoordinateAnchor(element.centerPoint) &&
    Number.isFinite(element.radius) && Number.isFinite(element.startAngleDeg) && Number.isFinite(element.endAngleDeg);
  if (element.type === "bezierCurve") return finiteCoordinateAnchor(element.startPoint) && finiteCoordinateAnchor(element.endPoint) &&
    Number.isFinite(element.startHandleAngleDeg) && Number.isFinite(element.startHandleLength) &&
    Number.isFinite(element.endHandleAngleDeg) && Number.isFinite(element.endHandleLength);
  return false;
};

const rootAppendSplice = (sourceText: string, lines: string[]): LineSplice => {
  const sourceLines = sourceText.replace(/\r\n/g, "\n").split("\n");
  const trailingEmptyLine = sourceText.endsWith("\n") || sourceText.endsWith("\r");
  const insertionLine = trailingEmptyLine ? sourceLines.length : sourceLines.length + 1;
  const replacementLines = sourceText.trim().length === 0 ? lines : ["", ...lines];
  return { startLine: insertionLine, endLine: insertionLine - 1, replacementLines };
};

const allocatedId = (type: CadElement["type"], usedIds: Set<ElementId>): ElementId => {
  let id = createCadElementId(type);
  while (usedIds.has(id)) id = createCadElementId(type);
  usedIds.add(id);
  return id;
};

const targetLocationFailure = (element: CadElement) => `要素 ${element.id} のSource位置を現在の文書で特定できません。`;

export const planDuplicateAsSnapshot = ({
  sourceText,
  compiled,
  compiledDocumentRevision,
  elements,
  evaluation,
  selectedElementIds,
  presentation
}: {
  sourceText: string;
  compiled: LastGoodDslDocument;
  compiledDocumentRevision: number;
  elements: readonly CadElement[];
  evaluation: EvaluationResult;
  selectedElementIds: readonly ElementId[];
  presentation: SnapshotPresentation;
}): DuplicateAsSnapshotPlanningResult => {
  const normalizedSource = sourceText.replace(/\r\n/g, "\n");
  const sourceRevision = compiled.statementMap.sourceRevision;
  if (compiled.majorVersion !== 1 || compiled.spans.sourceMap.source !== normalizedSource ||
      compiled.spans.sourceMap.sourceRevision !== sourceRevision || compiledDocumentRevision < 0) {
    return reject(null, "現在のnui 1 Sourceとコンパイル結果が一致しません。");
  }
  if (selectedElementIds.length === 0) return reject(null, "Canvasで複製するジオメトリを選択してください。");
  if (new Set(selectedElementIds).size !== selectedElementIds.length) {
    return reject(null, "Canvas選択に重複した要素IDがあります。");
  }
  if (!evaluation.evaluatedElementIds || !evaluation.effectiveEnabledElementIds) {
    return reject(null, "現在の評価結果が不完全なため、スナップショットを作成できません。");
  }

  const elementIds = new Map<ElementId, CadElement[]>();
  for (const element of elements) {
    const current = elementIds.get(element.id) ?? [];
    current.push(element);
    elementIds.set(element.id, current);
  }
  const drawingModifiers = compiled.document.modifiers ?? [];
  const activities = effectiveElementActivityById(elements, drawingModifiers);
  const visibleIds = effectiveCanvasVisibleElementIds({
    elements,
    evaluation,
    visibilityProfiles: presentation.visibilityProfiles,
    activeVisibilityProfileId: presentation.activeVisibilityProfileId,
    canvasLayerPresentation: presentation.canvasLayerPresentation
  });
  const usedIds = new Set<ElementId>([
    ...elements.map(({ id }) => id),
    ...compiled.document.elements.map(({ id }) => id),
    ...compiled.statementMap.elementIdByStatementIndex.values()
  ]);

  const primitives: BakePrimitive[] = [];
  for (const targetId of selectedElementIds) {
    const matches = elementIds.get(targetId) ?? [];
    if (matches.length !== 1) {
      return reject(targetId, matches.length === 0
        ? `選択要素 ${targetId} は現在のCanvas文書にありません。`
        : `選択要素 ${targetId} のIDが曖昧です。`);
    }
    const element = matches[0]!;
    if (isContainerElement(element)) return reject(targetId, `選択要素 ${targetId} は図形コンテナです。描画ジオメトリを選択してください。`);
    if (elementTypesWithoutOwnDrawableGeometry.has(element.type)) {
      return reject(targetId, `選択要素 ${targetId} は複製可能な描画ジオメトリを持ちません。`);
    }
    if (!exactSourceOwner(compiled, targetId)) return reject(targetId, targetLocationFailure(element));
    if (evaluation.errors.some((error) => error.elementId === targetId)) {
      return reject(targetId, `選択要素 ${targetId} の評価にエラーがあります。`);
    }
    const activity = effectiveElementActivity(element, activities).activity;
    if (activity === "hidden" || !visibleIds.has(targetId)) {
      return reject(targetId, `選択要素 ${targetId} はCanvasで非表示です。`);
    }
    if (activity === "disabled" || !evaluation.effectiveEnabledElementIds.has(targetId) ||
        evaluation.conditionInactiveElementIds?.has(targetId)) {
      return reject(targetId, `選択要素 ${targetId} は無効か、現在の条件で停止しています。`);
    }
    if (!evaluation.evaluatedElementIds.has(targetId)) {
      return reject(targetId, `選択要素 ${targetId} は現在の評価に含まれていません。`);
    }
    const geometry: ComputedGeometry | undefined = evaluation.computedGeometry.get(targetId);
    if (!geometry) return reject(targetId, `選択要素 ${targetId} の現在のジオメトリがありません。`);
    if (geometry.kind === "point" && !presentation.showCanvasPoints) {
      return reject(targetId, `選択要素 ${targetId} はCanvasで非表示です。`);
    }
    const conversion = primitivesForGeometry(geometry);
    if (conversion.status === "failed") {
      return reject(targetId, `選択要素 ${targetId} はスナップショットに対応しないジオメトリです (${conversion.reason.code})。`);
    }
    if (conversion.primitives.some((primitive) => !finitePrimitive(primitive))) {
      return reject(targetId, `選択要素 ${targetId} に有限でない座標があります。`);
    }
    primitives.push(...conversion.primitives);
  }

  const groupId = allocatedId("group", usedIds);
  const generated: CadElement[] = [];
  const sourceLines = ["group {"];
  for (const primitive of primitives) {
    const id = allocatedId(elementTypeForPrimitive(primitive), usedIds);
    const element = primitiveToElement(primitive, id, "", undefined, undefined);
    if (!finiteSnapshotElement(element)) {
      return reject(null, "スナップショットの数値表現に有限でない値が含まれます。");
    }
    generated.push(element);
    sourceLines.push(...serializedPrimitiveLines(element, "  "));
  }
  if (generated.length === 0) return reject(null, "選択要素から描画プリミティブを作成できませんでした。");
  sourceLines.push("}");

  const splice = rootAppendSplice(sourceText, sourceLines);
  try {
    applyLineSplices(sourceText, [splice]);
  } catch {
    return reject(null, "Source末尾の安全な挿入位置を特定できません。");
  }
  return {
    status: "planned",
    plan: {
      sourceSnapshot: { normalizedSource, sourceRevision },
      exactSourceText: sourceText,
      compiledDocumentRevision,
      selectedElementIds: [...selectedElementIds],
      splices: [splice],
      createdElementIds: [groupId, ...generated.map(({ id }) => id)],
      generatedElementIds: generated.map(({ id }) => id)
    }
  };
};

const reportFailure = (failure: DuplicateAsSnapshotFailure) => {
  useCadUiStore.getState().setCommandErrorMessage(failure.reason);
  return { status: "rejected", reason: "invalid-change" } as const;
};

const runDuplicateAsSnapshot = (context?: CommandContext): DocumentMutationResult | false => {
  const document = useCadDocumentStore.getState();
  const ui = useCadUiStore.getState();
  const evaluation = context?.evaluation;
  const selectedElementIds = context?.duplicateSnapshotSelectedElementIds;
  if (!evaluation || context?.evaluationIsCurrent !== true || document.docText !== document.sourceText ||
      !context.duplicateSnapshotAuthorityIsCurrent?.()) {
    return reportFailure({ targetId: null, reason: "現在のSource、Canvas選択、評価結果を確認できないため、スナップショットを中止しました。" });
  }
  const liveSelection = getSelectedElementIds();
  if (!selectedElementIds || !sameIds(liveSelection, selectedElementIds)) {
    return reportFailure({ targetId: null, reason: "Canvas選択が古くなったため、スナップショットを中止しました。" });
  }
  const presentation = context.duplicateSnapshotCanvasPresentation ?? {
    visibilityProfiles: document.visibilityProfiles,
    activeVisibilityProfileId: document.activeVisibilityProfileId,
    showCanvasPoints: ui.showCanvasPoints
  };
  const result = planDuplicateAsSnapshot({
    sourceText: document.sourceText,
    compiled: document.doc,
    compiledDocumentRevision: document.compiledDocumentRevision,
    elements: document.elements,
    evaluation,
    selectedElementIds,
    presentation
  });
  if (result.status === "rejected") return reportFailure(result.failure);

  const currentDocument = useCadDocumentStore.getState();
  if (currentDocument.docText !== currentDocument.sourceText ||
      currentDocument.sourceText !== result.plan.exactSourceText ||
      currentDocument.doc.statementMap.sourceRevision !== result.plan.sourceSnapshot.sourceRevision ||
      currentDocument.compiledDocumentRevision !== result.plan.compiledDocumentRevision ||
      !sameIds(getSelectedElementIds(), result.plan.selectedElementIds) ||
      context.evaluationIsCurrent !== true || !context.duplicateSnapshotAuthorityIsCurrent?.()) {
    return reportFailure({ targetId: null, reason: "Source、評価結果、Canvas選択またはVS Code文書の状態が変わったため、スナップショットを中止しました。" });
  }

  const mutation = useCadDocumentStore.getState().commitLineSplices(result.plan.splices, {
    createdElementIds: result.plan.createdElementIds
  });
  if (mutation.status !== "applied") return mutation;
  useCadUiStore.getState().setCommandErrorMessage(null);
  return mutation;
};

export const duplicateAsSnapshotCommandDefinitions: Record<"duplicateAsSnapshot", Command> = {
  duplicateAsSnapshot: {
    id: "duplicateAsSnapshot",
    label: "Duplicate as Snapshot",
    palette: {
      order: 42,
      keywords: ["duplicate", "snapshot", "複製", "スナップショット"],
      isAvailable: () => getSelectedElementIds().length > 0
    },
    run: runDuplicateAsSnapshot
  }
};
