import type { ElementId } from "../types/geometry";
import { groupStateByElementId, isGroupElement } from "../model/groups";
import { buildPlacementRefsByStatementIndex } from "./dslPrintLayoutPlacementIndex";
import type { CompiledDslDocument } from "./dslDocument";
import {
  createDslSemanticOccurrenceIndex,
  dslSemanticOccurrenceAt,
  type DslSemanticIdentity
} from "./dslSemanticOccurrenceIndex";
import {
  queryDslCanvasRevealSourceTarget,
  type DslCanvasRevealSemanticTarget,
  type DslCanvasRevealSourceQueryResult,
  type DslCanvasRevealSourceTarget
} from "./dslCanvasRevealQuery";
import type { SourceSnapshot } from "./logicalStatementSourceMap";
import type { ModuleGeometryRuntimeCompilation } from "./moduleGeometryRuntime";
import { projectDslRevealRuntimeTarget } from "./dslRevealRuntimeProjection";

export type DslOutputPreviewRevealFailureReason =
  | "source-mismatch"
  | "invalid-position"
  | "no-target";

export type DslOutputPreviewRevealSourceTarget =
  | {
      kind: "output";
      outputKind: "print" | "svg";
      outputId: string;
      sourceStatementIndex: number;
    }
  | {
      kind: "layout";
      layoutId: string;
      sourceStatementIndex: number;
    }
  | {
      kind: "place";
      layoutId: string;
      placementId: string;
      placementIndex: number;
      sourceStatementIndex: number;
    }
  | {
      kind: "group";
      elementId: ElementId;
      sourceStatementIndex: number;
    }
  | {
      kind: "geometry";
      elementId: ElementId;
      sourceStatementIndex: number;
    }
  | {
      kind: "semantic";
      semantic: DslCanvasRevealSemanticTarget;
      ownerSourceStatementIndex: number | null;
    };

export type DslOutputPreviewRevealSourceQueryResult =
  | { status: "resolved"; target: DslOutputPreviewRevealSourceTarget }
  | { status: "failed"; reason: DslOutputPreviewRevealFailureReason };

export type DslOutputPreviewRevealSourceQueryInput = {
  source: SourceSnapshot;
  compiled: CompiledDslDocument;
  position: number;
};

export type DslOutputPreviewRevealRuntimeTarget =
  | {
      kind: "group" | "geometry";
      sourceStatementIndex: number;
      runtimeElementIds: readonly ElementId[];
    };

export type DslOutputPreviewRevealRuntimeProjectionResult =
  | { status: "resolved"; target: DslOutputPreviewRevealRuntimeTarget }
  | { status: "failed"; reason: "no-runtime-target" };

export type DslOutputPreviewRevealRuntimeProjectionInput = {
  target: Extract<DslOutputPreviewRevealSourceTarget, { kind: "group" | "geometry" | "semantic" }>;
  compiled: Pick<
    CompiledDslDocument,
    "statementMap" | "moduleSemanticAnalysis" | "sourceSemanticAnalysis" | "moduleMaterialization"
  >;
  moduleGeometryRuntime?: ModuleGeometryRuntimeCompilation;
  elements: readonly import("../types/geometry").CadElement[];
};

export type DslOutputPreviewRevealStructuralAvailabilityInput = {
  target: DslOutputPreviewRevealSourceTarget;
  compiled: CompiledDslDocument;
};

const elementForId = (compiled: CompiledDslDocument, elementId: ElementId) =>
  compiled.document?.elements.find((element) => element.id === elementId) ?? null;

const statementKeyFor = (
  compiled: CompiledDslDocument,
  kind: "layout" | "print" | "svg",
  statementIndex: number
): string | null => {
  const prefix = `${kind}:`;
  const entry = [...(compiled.statementMap?.byKey ?? new Map())]
    .find(([key, statement]) => key.startsWith(prefix) && statement.statementIndex === statementIndex);
  return entry ? entry[0].slice(prefix.length) : null;
};

const layoutIdForStatement = (compiled: CompiledDslDocument, statementIndex: number) =>
  compiled.layoutIdsByStatementIndex?.get(statementIndex) ?? statementKeyFor(compiled, "layout", statementIndex);

const outputIdForStatement = (
  compiled: CompiledDslDocument,
  statementIndex: number,
  kind: "print" | "svg"
) => compiled.outputIdsByStatementIndex?.get(statementIndex) ?? statementKeyFor(compiled, kind, statementIndex);

const placementRefForStatement = (
  compiled: CompiledDslDocument,
  statementIndex: number
): { layoutId: string; placementIndex: number } | null => {
  const indexed = buildPlacementRefsByStatementIndex(
    compiled.statements,
    compiled.layoutIdsByStatementIndex
  ).get(statementIndex);
  if (indexed) return indexed;

  const entry = [...(compiled.statementMap?.byKey ?? new Map())]
    .find(([key, statement]) => key.startsWith("place:") && statement.statementIndex === statementIndex);
  if (!entry) return null;
  const match = entry[0].match(/^place:(.*):(\d+)$/);
  return match ? { layoutId: match[1]!, placementIndex: Number(match[2]) } : null;
};

const sourceElementTargetFor = (
  compiled: CompiledDslDocument,
  elementId: ElementId
): Extract<DslOutputPreviewRevealSourceTarget, { kind: "group" | "geometry" }> | null => {
  const element = elementForId(compiled, elementId);
  const statementIndex = compiled.statementMap?.byElementId.get(elementId)?.statementIndex;
  if (!element || statementIndex === undefined) return null;
  return isGroupElement(element)
    ? { kind: "group", elementId, sourceStatementIndex: statementIndex }
    : { kind: "geometry", elementId, sourceStatementIndex: statementIndex };
};

const sourceTargetForStatementIndex = (
  compiled: CompiledDslDocument,
  sourceStatementIndex: number
): DslOutputPreviewRevealSourceTarget | null => {
  const statement = compiled.statements[sourceStatementIndex];
  if (!statement || !compiled.statementMap) return null;

  if (statement.kind === "layout") {
    const layoutId = layoutIdForStatement(compiled, sourceStatementIndex);
    return layoutId
      ? { kind: "layout", layoutId, sourceStatementIndex }
      : null;
  }
  if (statement.kind === "print" || statement.kind === "svg") {
    const outputId = outputIdForStatement(compiled, sourceStatementIndex, statement.kind);
    return outputId
      ? { kind: "output", outputKind: statement.kind, outputId, sourceStatementIndex }
      : null;
  }
  if (statement.kind === "place") {
    const placement = placementRefForStatement(compiled, sourceStatementIndex);
    if (!placement) return null;
    const placementId = compiled.statementMap.statementIdByStatementIndex?.get(sourceStatementIndex);
    return placementId
      ? {
          kind: "place",
          layoutId: placement.layoutId,
          placementId,
          placementIndex: placement.placementIndex,
          sourceStatementIndex
        }
      : null;
  }

  const elementId = compiled.statementMap.elementIdByStatementIndex.get(sourceStatementIndex);
  return elementId ? sourceElementTargetFor(compiled, elementId) : null;
};

const sourceTargetForSemanticIdentity = (
  compiled: CompiledDslDocument,
  identity: DslSemanticIdentity
): DslOutputPreviewRevealSourceTarget | null => {
  if (identity.kind === "element") return sourceElementTargetFor(compiled, identity.elementId);
  if (identity.kind !== "source") return null;
  const statementIndex = compiled.statementMap?.statementIndexByStatementId?.get(identity.statementId);
  return statementIndex === undefined ? null : sourceTargetForStatementIndex(compiled, statementIndex);
};

const statementAt = (
  compiled: CompiledDslDocument,
  position: number
): number | null => {
  const candidates = compiled.statements.filter((statement) =>
    (statement.kind === "layout" || statement.kind === "place" || statement.kind === "print" || statement.kind === "svg") &&
    statement.sourceRevision === compiled.spans.sourceMap.sourceRevision &&
    statement.documentRange.from <= position &&
    position < statement.documentRange.to
  );
  candidates.sort((left, right) =>
    (left.documentRange.to - left.documentRange.from) - (right.documentRange.to - right.documentRange.from) ||
    left.documentRange.from - right.documentRange.from
  );
  return candidates[0]?.documentRange
    ? compiled.statements.indexOf(candidates[0])
    : null;
};

const targetFromCanvasSourceTarget = (
  compiled: CompiledDslDocument,
  target: DslCanvasRevealSourceTarget
): DslOutputPreviewRevealSourceTarget | null => {
  if (target.kind === "semantic") {
    return {
      kind: "semantic",
      semantic: target.semantic,
      ownerSourceStatementIndex: target.ownerSourceStatementIndex
    };
  }
  return sourceTargetForStatementIndex(compiled, target.sourceStatementIndex);
};

const sourceAndCompiledMatch = (source: SourceSnapshot, compiled: CompiledDslDocument): boolean =>
  !source.normalizedSource.includes("\r") &&
  compiled.spans.sourceMap.source === source.normalizedSource &&
  compiled.spans.sourceMap.sourceRevision === source.sourceRevision &&
  compiled.statementMap?.sourceRevision === source.sourceRevision;

const uniqueRuntimeElementIds = (
  candidates: readonly (ElementId | null)[],
  elements: readonly import("../types/geometry").CadElement[]
): readonly ElementId[] => {
  const elementIds = new Set(elements.map((element) => element.id));
  const seen = new Set<ElementId>();
  const result: ElementId[] = [];
  for (const candidate of candidates) {
    if (!candidate || !elementIds.has(candidate) || seen.has(candidate)) continue;
    seen.add(candidate);
    result.push(candidate);
  }
  return result;
};

/**
 * Project an Output Preview group/geometry source target to current runtime
 * IDs. This reuses the shared Module/materialization projection and applies no
 * Canvas visibility, profile, or presentation eligibility filtering.
 */
export const projectDslOutputPreviewRevealRuntimeTarget = ({
  target,
  compiled,
  moduleGeometryRuntime,
  elements
}: DslOutputPreviewRevealRuntimeProjectionInput): DslOutputPreviewRevealRuntimeProjectionResult => {
  const canvasTarget: DslCanvasRevealSourceTarget = target.kind === "semantic"
    ? target
    : { kind: "statement-owner", sourceStatementIndex: target.sourceStatementIndex };
  const projection = projectDslRevealRuntimeTarget({
    target: canvasTarget,
    compiled,
    moduleGeometryRuntime,
    elements
  });
  const semanticCandidates = uniqueRuntimeElementIds(projection.candidates, elements);
  const ownerCandidates = uniqueRuntimeElementIds(projection.ownerCandidates, elements);
  const runtimeElementIds = target.kind === "semantic" && semanticCandidates.length === 0
    ? ownerCandidates
    : semanticCandidates;
  return runtimeElementIds.length === 0
    ? { status: "failed", reason: "no-runtime-target" }
    : {
        status: "resolved",
        target: {
          kind: target.kind === "semantic" ? "geometry" : target.kind,
          sourceStatementIndex: target.kind === "semantic"
            ? target.semantic.sourceStatementIndex
            : target.sourceStatementIndex,
          runtimeElementIds
        }
      };
};

const currentStatementIs = (
  compiled: CompiledDslDocument,
  statementIndex: number,
  kind: DslOutputPreviewRevealSourceTarget["kind"]
): boolean => {
  const statement = compiled.statements[statementIndex];
  if (!statement || statement.sourceRevision !== compiled.spans.sourceMap.sourceRevision) return false;
  if (kind === "output") return statement.kind === "print" || statement.kind === "svg";
  if (kind === "geometry") return statement.kind === "element" || statement.kind === "moduleInstance";
  return statement.kind === kind;
};

const outputOwnedLayoutIds = (
  document: NonNullable<CompiledDslDocument["document"]>
): ReadonlySet<string> => {
  const layoutIds = new Set(document.layouts.map((layout) => layout.id));
  return new Set(
    [...document.printOutputs, ...document.svgOutputs]
      .map((output) => output.layoutId)
      .filter((layoutId) => layoutIds.has(layoutId))
  );
};

const currentElementTarget = (
  compiled: CompiledDslDocument,
  target: Extract<DslOutputPreviewRevealSourceTarget, { kind: "group" | "geometry" }>
): boolean => {
  const element = elementForId(compiled, target.elementId);
  const statement = compiled.statements[target.sourceStatementIndex];
  if (!statement || statement.sourceRevision !== compiled.spans.sourceMap.sourceRevision) return false;
  if (!element) return false;
  if (target.kind === "group" ? !isGroupElement(element) : isGroupElement(element)) return false;
  if (compiled.statementMap?.elementIdByStatementIndex.get(target.sourceStatementIndex) !== target.elementId) return false;
  return compiled.statementMap.byElementId.get(target.elementId)?.statementIndex === target.sourceStatementIndex;
};

const currentSemanticTarget = (
  compiled: CompiledDslDocument,
  target: Extract<DslOutputPreviewRevealSourceTarget, { kind: "semantic" }>
): boolean => {
  const statement = compiled.statements[target.semantic.sourceStatementIndex];
  if (!statement || statement.sourceRevision !== compiled.spans.sourceMap.sourceRevision) return false;
  if (target.ownerSourceStatementIndex !== null && !currentStatementIs(
    compiled,
    target.ownerSourceStatementIndex,
    "group"
  ) && !currentStatementIs(compiled, target.ownerSourceStatementIndex, "geometry")) return false;
  return true;
};

const currentPlacementTarget = (
  compiled: CompiledDslDocument,
  target: Extract<DslOutputPreviewRevealSourceTarget, { kind: "place" }>,
  outputLayoutIds: ReadonlySet<string>
): boolean => {
  if (!currentStatementIs(compiled, target.sourceStatementIndex, "place")) return false;
  if (compiled.statementMap?.statementIdByStatementIndex?.get(target.sourceStatementIndex) !== target.placementId) return false;
  const placementRef = placementRefForStatement(compiled, target.sourceStatementIndex);
  if (
    !placementRef ||
    placementRef.layoutId !== target.layoutId ||
    placementRef.placementIndex !== target.placementIndex ||
    !outputLayoutIds.has(target.layoutId)
  ) return false;
  const layout = compiled.document?.layouts.find((candidate) => candidate.id === target.layoutId);
  const placement = layout?.placements[target.placementIndex];
  return placement?.id === target.placementId;
};

/**
 * Project the exact current Source target to structural Output ownership for
 * menu availability. This intentionally does not evaluate geometry or apply
 * any host presentation state; command execution remains responsible for
 * drawable/runtime checks and final reveal success.
 */
export const isDslOutputPreviewRevealSourceTargetStructurallyAvailable = ({
  target,
  compiled
}: DslOutputPreviewRevealStructuralAvailabilityInput): boolean => {
  const document = compiled.document;
  if (!document || !compiled.statementMap) return false;

  const outputLayoutIds = outputOwnedLayoutIds(document);
  if (target.kind === "output") {
    if (!currentStatementIs(compiled, target.sourceStatementIndex, "output")) return false;
    const outputId = outputIdForStatement(compiled, target.sourceStatementIndex, target.outputKind);
    if (outputId !== target.outputId) return false;
    return target.outputKind === "print"
      ? document.printOutputs.some((output) => output.id === target.outputId)
      : document.svgOutputs.some((output) => output.id === target.outputId);
  }

  if (target.kind === "layout") {
    if (!currentStatementIs(compiled, target.sourceStatementIndex, "layout")) return false;
    return layoutIdForStatement(compiled, target.sourceStatementIndex) === target.layoutId &&
      outputLayoutIds.has(target.layoutId);
  }

  if (target.kind === "place") return currentPlacementTarget(compiled, target, outputLayoutIds);

  if (target.kind === "group" || target.kind === "geometry") {
    if (!currentElementTarget(compiled, target)) return false;
  } else if (!currentSemanticTarget(compiled, target)) {
    return false;
  }

  const elements = document.elements;
  const projection = projectDslOutputPreviewRevealRuntimeTarget({
    target,
    compiled,
    moduleGeometryRuntime: compiled.moduleGeometryRuntime,
    elements
  });
  if (projection.status === "failed") return false;

  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const placedGroupIds = new Set<ElementId>();
  for (const layout of document.layouts) {
    if (!outputLayoutIds.has(layout.id)) continue;
    for (const placement of layout.placements) {
      const group = elementsById.get(placement.groupId);
      if (group && isGroupElement(group)) placedGroupIds.add(group.id);
    }
  }
  if (placedGroupIds.size === 0) return false;

  const groupStates = groupStateByElementId(elements);
  return projection.target.runtimeElementIds.some((elementId) => {
    const state = groupStates.get(elementId);
    return placedGroupIds.has(elementId) ||
      (state?.ancestorGroupIds ?? []).some((ancestorId) => placedGroupIds.has(ancestorId));
  });
};

const sourceFailureFromCanvas = (
  result: DslCanvasRevealSourceQueryResult
): Extract<DslOutputPreviewRevealSourceQueryResult, { status: "failed" }> | null =>
  result.status === "failed" && result.reason !== "no-target"
    ? { status: "failed", reason: result.reason }
    : null;

/**
 * Resolve the exact current Source position used by Output Preview Reveal.
 * Geometry references deliberately come from the existing Canvas Reveal
 * semantic query; source-output identities come from the compiler occurrence
 * index and StatementMap rather than a second parser or name resolver.
 */
export const queryDslOutputPreviewRevealSourceTarget = ({
  source,
  compiled,
  position
}: DslOutputPreviewRevealSourceQueryInput): DslOutputPreviewRevealSourceQueryResult => {
  if (!sourceAndCompiledMatch(source, compiled)) return { status: "failed", reason: "source-mismatch" };
  if (!Number.isInteger(position) || position < 0 || position > source.normalizedSource.length) {
    return { status: "failed", reason: "invalid-position" };
  }

  const canvasResult = queryDslCanvasRevealSourceTarget({ source, compiled, position });
  const canvasFailure = sourceFailureFromCanvas(canvasResult);
  if (canvasFailure) return canvasFailure;
  if (canvasResult.status === "resolved" && canvasResult.target.kind === "semantic") {
    return targetFromCanvasSourceTarget(compiled, canvasResult.target)
      ? { status: "resolved", target: targetFromCanvasSourceTarget(compiled, canvasResult.target)! }
      : { status: "failed", reason: "no-target" };
  }

  const occurrence = compiled.statementMap
    ? dslSemanticOccurrenceAt(createDslSemanticOccurrenceIndex(compiled), position)
    : null;
  const semanticTarget = occurrence
    ? sourceTargetForSemanticIdentity(compiled, occurrence.identity)
    : null;
  if (semanticTarget) return { status: "resolved", target: semanticTarget };

  if (canvasResult.status === "resolved") {
    const ownerTarget = targetFromCanvasSourceTarget(compiled, canvasResult.target);
    if (ownerTarget) return { status: "resolved", target: ownerTarget };
  }

  const statementIndex = statementAt(compiled, position);
  const statementTarget = statementIndex === null
    ? null
    : sourceTargetForStatementIndex(compiled, statementIndex);
  return statementTarget
    ? { status: "resolved", target: statementTarget }
    : { status: "failed", reason: "no-target" };
};
