import type { LastGoodDslDocument } from "../document/canonicalDocument";
import { sourceOwnerForRuntimeElementId } from "../dsl/sourceOwnership";
import { serializeElementStatementLogical } from "../dsl/dslSerializeElement";
import type { DslSerializerRefs } from "../dsl/dslSerializer";
import { createCadElementId } from "../model/cadIds";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import type { DocumentMutationResult } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import {
  effectiveElementActivity,
  effectiveElementActivityById,
  elementTypesWithoutOwnDrawableGeometry
} from "../model/elementActivity";
import type {
  CadElement,
  ComputedGeometry,
  ComputedOffsetLineSegment,
  ElementId,
  EvaluationResult,
  PointAnchor
} from "../types/geometry";
import type { LineSplice } from "../document/textPatch";
import { makeUniqueElementName as uniqueNameInNamespace } from "../model/elementNames";
import { constructionForElementType, MUTATION_CATEGORY } from "../dsl/dslConstructions";

export type BakeMode = "current" | "base";

type BakePrimitive =
  | { kind: "point"; point: { x: number; y: number } }
  | { kind: "line"; start: { x: number; y: number }; end: { x: number; y: number } }
  | { kind: "arc"; center: { x: number; y: number }; radius: number; startAngleDeg: number; endAngleDeg: number }
  | {
      kind: "bezier";
      start: { x: number; y: number };
      control1: { x: number; y: number };
      control2: { x: number; y: number };
      end: { x: number; y: number };
    };

type ResolvedBakeTarget = {
  targetId: ElementId;
  runtimeElementIds: ElementId[];
  sourceElementId: ElementId;
  instanceBaseId?: ElementId;
  insertionStatementIndex: number;
  insertionParentGroupId?: ElementId;
  sourceLabel: string;
  wholeInstance: boolean;
};

export type BakePlan = {
  splices: LineSplice[];
  createdElementIds: ElementId[];
  generatedElementIds: ElementId[];
  primaryGeneratedElementId: ElementId | null;
  skippedTargetCount: number;
  skippedComments: number;
};

const EPSILON = 1e-7;

const coordinateAnchor = (point: { x: number; y: number }): PointAnchor => ({
  mode: "coordinate",
  x: point.x,
  y: point.y
});

const directedPositiveSweep = (start: number, end: number) => {
  const value = ((end - start) % 360 + 360) % 360;
  return Math.abs(value) < EPSILON ? 360 : value;
};

const exactArc = (
  center: { x: number; y: number },
  radius: number,
  startAngleDeg: number,
  endAngleDeg: number,
  sweepAngleDeg: number
): BakePrimitive | null => {
  if (!Number.isFinite(radius) || radius <= 0 || !Number.isFinite(sweepAngleDeg) || sweepAngleDeg <= EPSILON) return null;
  if (Math.abs(directedPositiveSweep(startAngleDeg, endAngleDeg) - sweepAngleDeg) > EPSILON) return null;
  return { kind: "arc", center, radius, startAngleDeg, endAngleDeg };
};

const bezierPrimitive = (segment: {
  start: { x: number; y: number };
  control1: { x: number; y: number };
  control2: { x: number; y: number };
  end: { x: number; y: number };
}): BakePrimitive => ({ kind: "bezier", ...segment });

const primitivesForGeometry = (geometry: ComputedGeometry): BakePrimitive[] | null => {
  switch (geometry.kind) {
    case "point":
      return [{ kind: "point", point: { x: geometry.x, y: geometry.y } }];
    case "line":
      return [{ kind: "line", start: geometry.start, end: geometry.end }];
    case "arcLine": {
      const primitive = exactArc(
        geometry.center,
        geometry.radius,
        geometry.startAngleDeg,
        geometry.endAngleDeg,
        geometry.sweepAngleDeg
      );
      return primitive ? [primitive] : null;
    }
    case "bezierCurve":
      return geometry.segments.map(bezierPrimitive);
    case "offsetLine": {
      if (geometry.closed) return null;
      const result: BakePrimitive[] = [];
      for (const segment of geometry.segments) {
        const primitive = primitiveForOffsetSegment(segment);
        if (!primitive) return null;
        result.push(primitive);
      }
      return result;
    }
    default:
      return null;
  }
};

const primitiveForOffsetSegment = (segment: ComputedOffsetLineSegment): BakePrimitive | null => {
  if (segment.kind === "line") return { kind: "line", start: segment.start, end: segment.end };
  if (segment.kind === "bezier") return bezierPrimitive(segment);
  return exactArc(
    segment.center,
    segment.radius,
    segment.startAngleDeg,
    segment.startAngleDeg + segment.sweepAngleDeg,
    segment.sweepAngleDeg
  );
};

const sourceIndent = (compiled: LastGoodDslDocument, line: number) =>
  compiled.sourceLines[line - 1]?.match(/^\s*/)?.[0] ?? "";

const sourceTargetLabel = (element: CadElement | undefined) => {
  if (!element) return "要素";
  const category = element.type === "moduleInstance"
    ? "instance"
    : (() => {
        const spec = constructionForElementType(element.type);
        return spec.category === MUTATION_CATEGORY ? spec.construction : spec.category;
      })();
  return `${category}${element.name.trim() ? ` ${element.name.trim()}` : ""}`;
};

const sourceOwnerForTarget = (
  compiled: LastGoodDslDocument,
  runtimeElementId: ElementId
) => sourceOwnerForRuntimeElementId(compiled, runtimeElementId);

const rootInstanceOwner = (compiled: LastGoodDslDocument, runtimeElementId: ElementId) => {
  const origin = compiled.moduleMaterialization?.originByRuntimeElementId.get(runtimeElementId);
  const rootIdentity = origin?.instancePath[0];
  if (!rootIdentity) return null;
  const root = compiled.moduleMaterialization?.executionStatements.find(
    (entry) => entry.type === "moduleInstance" && entry.instancePath.length === 1 && entry.instancePath[0] === rootIdentity
  );
  return root ? sourceOwnerForTarget(compiled, root.runtimeElementId) : null;
};

const targetForRuntimeElement = (
  compiled: LastGoodDslDocument,
  elementsById: ReadonlyMap<ElementId, CadElement>,
  runtimeElementId: ElementId,
  wholeInstance: boolean
): ResolvedBakeTarget | null => {
  const owner = sourceOwnerForTarget(compiled, runtimeElementId);
  if (!owner) return null;
  const element = elementsById.get(runtimeElementId);
  if (!element || elementTypesWithoutOwnDrawableGeometry.has(element.type)) return null;
  const sourceOwner = owner.kind === "moduleBody" ? rootInstanceOwner(compiled, runtimeElementId) : owner;
  if (!sourceOwner) return null;
  const snapshot = compiled.moduleMaterialization?.instanceBaseGeometrySnapshots.find(
    (candidate) => candidate.instanceId === runtimeElementId
  );
  const runtimeElementIds = wholeInstance && snapshot
    ? [...snapshot.descendantIds]
    : [runtimeElementId];
  return {
    targetId: runtimeElementId,
    runtimeElementIds,
    sourceElementId: wholeInstance ? sourceOwner.runtimeElementId : runtimeElementId,
    ...(wholeInstance ? { instanceBaseId: runtimeElementId } : {}),
    insertionStatementIndex: sourceOwner.statement.statementIndex,
    insertionParentGroupId: element?.type === "moduleInstance" ? element.parentGroupId :
      compiled.moduleMaterialization?.executionStatements.find((entry) => entry.runtimeElementId === sourceOwner.runtimeElementId)?.parentGroupId ??
      elementsById.get(sourceOwner.runtimeElementId)?.parentGroupId,
    sourceLabel: sourceTargetLabel(element),
    wholeInstance
  };
};

const resolveCanvasTargets = (
  compiled: LastGoodDslDocument,
  elements: readonly CadElement[],
  selectedElementIds: readonly ElementId[]
): ResolvedBakeTarget[] => {
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const selected = new Set(selectedElementIds);
  const covered = new Set<ElementId>();
  const targets: ResolvedBakeTarget[] = [];
  for (const element of elements) {
    if (!selected.has(element.id) || covered.has(element.id)) continue;
    if (element.type === "moduleInstance") {
      const target = targetForRuntimeElement(compiled, elementsById, element.id, true);
      if (!target) continue;
      targets.push(target);
      for (const id of target.runtimeElementIds) covered.add(id);
      covered.add(element.id);
      continue;
    }
    const target = targetForRuntimeElement(compiled, elementsById, element.id, false);
    if (target) targets.push(target);
  }
  return targets;
};

export const resolveSourceBakeTargets = (
  compiled: LastGoodDslDocument,
  elements: readonly CadElement[],
  sourceStatementIndex: number
): ResolvedBakeTarget[] | null => {
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const entries = compiled.moduleMaterialization?.executionStatements.filter(
    (entry) => entry.sourceStatementIndex === sourceStatementIndex
  ) ?? [];
  if (entries.some((entry) => entry.origin?.kind === "moduleBody")) return null;
  const runtimeIds = entries.length
    ? entries.filter((entry) => entry.type === "moduleInstance" || entry.instancePath.length === 0).map((entry) => entry.runtimeElementId)
    : [...elementsById.values()]
        .filter((element) => compiled.statementMap.byElementId.get(element.id)?.statementIndex === sourceStatementIndex)
        .map((element) => element.id);
  if (runtimeIds.length === 0) return null;
  return runtimeIds.flatMap((id) => {
    const element = elementsById.get(id);
    if (!element) return [];
    const target = targetForRuntimeElement(compiled, elementsById, id, element.type === "moduleInstance");
    return target ? [target] : [];
  });
};

const resolveTargetsForInvocation = ({
  compiled,
  elements,
  selectedElementIds,
  sourceStatementIndex
}: {
  compiled: LastGoodDslDocument;
  elements: readonly CadElement[];
  selectedElementIds?: readonly ElementId[];
  sourceStatementIndex?: number;
}): ResolvedBakeTarget[] | null => sourceStatementIndex === undefined
  ? resolveCanvasTargets(compiled, elements, selectedElementIds ?? [])
  : resolveSourceBakeTargets(compiled, elements, sourceStatementIndex);

const bakeTargetsForResolvedTargets = (
  targets: readonly ResolvedBakeTarget[],
  elementsById: ReadonlyMap<ElementId, CadElement>
): ResolvedBakeTarget[] => targets.flatMap((target) => {
  if (!target.wholeInstance) return [target];
  return target.runtimeElementIds.flatMap((runtimeElementId) => {
    const element = elementsById.get(runtimeElementId);
    if (!element || elementTypesWithoutOwnDrawableGeometry.has(element.type)) return [];
    return [{
      ...target,
      targetId: runtimeElementId,
      runtimeElementIds: [runtimeElementId],
      sourceElementId: runtimeElementId,
      instanceBaseId: target.targetId,
      sourceLabel: sourceTargetLabel(element),
      wholeInstance: false
    }];
  });
});

const disabledTargetIdsFor = (
  targets: readonly ResolvedBakeTarget[],
  elementsById: ReadonlyMap<ElementId, CadElement>,
  effectiveActivities: ReadonlyMap<ElementId, ReturnType<typeof effectiveElementActivity>>
) => targets.flatMap((target) => {
  const element = elementsById.get(target.targetId);
  return element && effectiveElementActivity(element, effectiveActivities).activity === "disabled"
    ? [target.targetId]
    : [];
});

/** Resolve only the disabled runtime targets this Bake invocation will attempt. */
export const resolveDisabledBakeTargetIds = ({
  compiled,
  elements,
  selectedElementIds,
  sourceStatementIndex
}: {
  compiled: LastGoodDslDocument;
  elements: readonly CadElement[];
  selectedElementIds?: readonly ElementId[];
  sourceStatementIndex?: number;
}): ElementId[] => {
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const targets = resolveTargetsForInvocation({
    compiled,
    elements,
    selectedElementIds,
    sourceStatementIndex
  });
  if (!targets) return [];
  const effectiveActivities = effectiveElementActivityById(elements, compiled.document.modifiers ?? []);
  return disabledTargetIdsFor(
    bakeTargetsForResolvedTargets(targets, elementsById),
    elementsById,
    effectiveActivities
  );
};

const sourceElementForRuntimeId = (elementsById: ReadonlyMap<ElementId, CadElement>, id: ElementId) =>
  elementsById.get(id);

const angleForVector = (dx: number, dy: number) => Math.atan2(dy, dx) * 180 / Math.PI;

const primitiveToElement = (
  primitive: BakePrimitive,
  id: ElementId,
  name: string,
  source: CadElement | undefined,
  parentGroupId: ElementId | undefined
): CadElement => {
  const common = {
    id,
    name,
    activity: source?.activity ?? "visible",
    ...(source?.modifierNames ? { modifierNames: [...source.modifierNames] } : {}),
    ...(parentGroupId ? { parentGroupId } : {})
  };
  if (primitive.kind === "point") return { ...common, type: "freePoint", x: primitive.point.x, y: primitive.point.y };
  if (primitive.kind === "line") return {
    ...common,
    type: "line",
    startPoint: coordinateAnchor(primitive.start),
    endPoint: coordinateAnchor(primitive.end)
  };
  if (primitive.kind === "arc") return {
    ...common,
    type: "arcLine",
    centerPoint: coordinateAnchor(primitive.center),
    radius: primitive.radius,
    startAngleDeg: primitive.startAngleDeg,
    endAngleDeg: primitive.endAngleDeg
  };
  const startLength = Math.hypot(primitive.control1.x - primitive.start.x, primitive.control1.y - primitive.start.y);
  const endLength = Math.hypot(primitive.end.x - primitive.control2.x, primitive.end.y - primitive.control2.y);
  return {
    ...common,
    type: "bezierCurve",
    startPoint: coordinateAnchor(primitive.start),
    startHandleAngleDeg: startLength > EPSILON ? angleForVector(primitive.control1.x - primitive.start.x, primitive.control1.y - primitive.start.y) : 0,
    startHandleLength: startLength,
    intermediatePoints: [],
    endPoint: coordinateAnchor(primitive.end),
    endHandleAngleDeg: endLength > EPSILON ? angleForVector(primitive.end.x - primitive.control2.x, primitive.end.y - primitive.control2.y) : 0,
    endHandleLength: endLength
  };
};

const coordinateRefs: DslSerializerRefs = {
  token: (id) => `@${id}`,
  anchor: (value) => value?.mode === "coordinate" ? `(${String(value.x)}, ${String(value.y)})` : "none",
  endpoint: () => "none",
  numeric: (value) => typeof value === "number" && Object.is(value, -0) ? "0" : String(value),
  name: (element) => element.name.trim(),
  includeRecordIds: false
};

const serializedPrimitiveLines = (element: CadElement, indent: string): string[] => {
  const statement = serializeElementStatementLogical(element, coordinateRefs);
  return [`${indent}${statement}`];
};

const statementInfoForTarget = (compiled: LastGoodDslDocument, target: ResolvedBakeTarget) =>
  compiled.statementMap.statements[target.insertionStatementIndex];

const planInsertionSplices = (
  compiled: LastGoodDslDocument,
  entries: Map<number, string[]>
): LineSplice[] => [...entries.entries()]
  .sort(([left], [right]) => left - right)
  .map(([statementIndex, lines]) => {
    const statement = compiled.statementMap.statements[statementIndex];
    const endLine = statement?.range.endLine ?? statement?.endLine;
    if (!statement || endLine === undefined) throw new Error("Bakeの挿入位置を特定できません。");
    return { startLine: endLine + 1, endLine, replacementLines: lines };
  });

const makeComment = (target: ResolvedBakeTarget) => `// Bake skipped: ${target.sourceLabel} — unsupported`;

export const planBakeGeometry = ({
  mode,
  elements,
  evaluation,
  baseEvaluation,
  bakeDisabledEvaluation,
  compiled,
  selectedElementIds,
  sourceStatementIndex,
  emitSkippedComments = true,
  includeHiddenGeometry = false,
  includeDisabledGeometry = false
}: {
  mode: BakeMode;
  elements: readonly CadElement[];
  evaluation: EvaluationResult;
  baseEvaluation?: EvaluationResult;
  bakeDisabledEvaluation?: EvaluationResult;
  compiled: LastGoodDslDocument;
  selectedElementIds?: readonly ElementId[];
  sourceStatementIndex?: number;
  emitSkippedComments?: boolean;
  includeHiddenGeometry?: boolean;
  includeDisabledGeometry?: boolean;
}): BakePlan | null => {
  if (!evaluation.evaluatedElementIds || !evaluation.effectiveEnabledElementIds) return null;
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const effectiveActivities = effectiveElementActivityById(elements, compiled.document.modifiers ?? []);
  const targets = resolveTargetsForInvocation({
    compiled,
    elements,
    selectedElementIds,
    sourceStatementIndex
  });
  if (!targets || targets.length === 0) return null;

  const bakeTargets = bakeTargetsForResolvedTargets(targets, elementsById);
  const disabledTargetIds = disabledTargetIdsFor(bakeTargets, elementsById, effectiveActivities);
  if (includeDisabledGeometry && disabledTargetIds.length > 0 && !bakeDisabledEvaluation) return null;

  const linesByInsertion = new Map<number, string[]>();
  const plannedElements: CadElement[] = [...elements];
  const generatedElementIds: ElementId[] = [];
  let primaryGeneratedElementId: ElementId | null = null;
  let skippedTargetCount = 0;
  let skippedComments = 0;
  const emittedNameState = new Map<string, { nextSuffix: number; usedBaseName: boolean }>();

  for (const target of bakeTargets) {
    const sourceElement = sourceElementForRuntimeId(elementsById, target.targetId);
    const effectiveActivity = sourceElement
      ? effectiveElementActivity(sourceElement, effectiveActivities).activity
      : "visible";
    if (effectiveActivity === "hidden" && !includeHiddenGeometry) continue;
    if (effectiveActivity === "disabled" && !includeDisabledGeometry) continue;

    const sourceEvaluation = effectiveActivity === "disabled"
      ? bakeDisabledEvaluation
      : mode === "base" ? baseEvaluation ?? evaluation : evaluation;
    const runtimeGeometry = target.instanceBaseId && mode === "base"
      ? (sourceEvaluation?.instanceBaseGeometry?.get(target.instanceBaseId) ?? [])
          .filter((geometry) => geometry.elementId === target.targetId)
          .map((geometry) => ({ id: geometry.elementId, geometry }))
      : target.runtimeElementIds.flatMap((id) => {
          const geometry = (mode === "base" ? sourceEvaluation?.preMutationGeometry : sourceEvaluation?.computedGeometry)?.get(id);
          return geometry ? [{ id, geometry }] : [];
        });
    const targetElements = target.runtimeElementIds.map((id) => elementsById.get(id)).filter(Boolean) as CadElement[];
    const invalidRuntimeElement = targetElements.find((element) =>
      !sourceEvaluation ||
      !sourceEvaluation.evaluatedElementIds?.has(element.id) ||
      !sourceEvaluation.effectiveEnabledElementIds?.has(element.id) ||
      sourceEvaluation.errors.some((error) => error.elementId === element.id)
    );
    const missingGeometry = targetElements.some((element) =>
      element.type !== "group" && element.type !== "conditionalGroup" && element.type !== "forGroup" &&
      element.type !== "moduleInstance" && !elementTypesWithoutOwnDrawableGeometry.has(element.type) &&
      !runtimeGeometry.some(({ id }) => id === element.id)
    );
    const primitiveEntries = invalidRuntimeElement || runtimeGeometry.length === 0
      ? null
      : runtimeGeometry.flatMap(({ id, geometry }) => {
          const source = sourceElementForRuntimeId(elementsById, id);
          return (primitivesForGeometry(geometry) ?? []).map((primitive) => ({ primitive, source }));
        });
    const allRepresentable = !invalidRuntimeElement && !missingGeometry && runtimeGeometry.length > 0 &&
      runtimeGeometry.every(({ geometry }) => primitivesForGeometry(geometry) !== null);
    if (!allRepresentable || !primitiveEntries || primitiveEntries.length === 0) {
      skippedTargetCount += 1;
      if (emitSkippedComments) {
        const statement = statementInfoForTarget(compiled, target);
        if (statement) {
          const indent = sourceIndent(compiled, statement.line);
          const lines = linesByInsertion.get(target.insertionStatementIndex) ?? [];
          lines.push(`${indent}${makeComment(target)}`);
          linesByInsertion.set(target.insertionStatementIndex, lines);
          skippedComments += 1;
        }
      }
      continue;
    }

    const namingSourceElement = sourceElementForRuntimeId(elementsById, target.sourceElementId) ?? targetElements[0];
    const baseName = namingSourceElement?.name.trim() ? `${namingSourceElement.name.trim()}_baked` : "_baked";
    const indent = sourceIndent(compiled, statementInfoForTarget(compiled, target)?.line ?? 1);
    const lines = linesByInsertion.get(target.insertionStatementIndex) ?? [];
    const nameState = emittedNameState.get(baseName) ?? { nextSuffix: 1, usedBaseName: false };
    primitiveEntries.forEach(({ primitive, source: primitiveSource }) => {
      const isSinglePrimitive = primitiveEntries.length === 1;
      const requestedName = isSinglePrimitive && !nameState.usedBaseName
        ? baseName
        : `${baseName}_${nameState.nextSuffix++}`;
      nameState.usedBaseName ||= isSinglePrimitive;
      const id = createCadElementId(primitive.kind === "point" ? "freePoint" : primitive.kind === "line" ? "line" : primitive.kind === "arc" ? "arcLine" : "bezierCurve");
      const name = uniqueNameInNamespace({
        elements: plannedElements,
        elementId: id,
        requestedName,
        fallbackBaseName: requestedName,
        parentGroupId: target.insertionParentGroupId
      });
      const generated = primitiveToElement(primitive, id, name, primitiveSource ?? namingSourceElement, target.insertionParentGroupId);
      plannedElements.push(generated);
      generatedElementIds.push(id);
      if (!primaryGeneratedElementId) primaryGeneratedElementId = id;
      lines.push(...serializedPrimitiveLines(generated, indent));
    });
    emittedNameState.set(baseName, nameState);
    linesByInsertion.set(target.insertionStatementIndex, lines);
  }

  if (linesByInsertion.size === 0) return { splices: [], createdElementIds: [], generatedElementIds: [], primaryGeneratedElementId: null, skippedTargetCount, skippedComments };
  return {
    splices: planInsertionSplices(compiled, linesByInsertion),
    createdElementIds: generatedElementIds,
    generatedElementIds,
    primaryGeneratedElementId,
    skippedTargetCount,
    skippedComments
  };
};

export const applyBakePlan = (plan: BakePlan): DocumentMutationResult => {
  if (plan.splices.length === 0) return { status: "noop" };
  const result = useCadDocumentStore.getState().commitLineSplices(plan.splices, {
    createdElementIds: plan.createdElementIds
  });
  if (result.status !== "applied") return result;
  const state = useCadDocumentStore.getState();
  if (plan.generatedElementIds.length > 0) {
    useCadUiStore.getState().applySelection(state.elements, {
      selectedElementId: plan.primaryGeneratedElementId,
      selectedElementIds: plan.generatedElementIds,
      selectionAnchorElementId: plan.primaryGeneratedElementId
    });
  }
  useCadUiStore.getState().setCommandErrorMessage(null);
  return result;
};
