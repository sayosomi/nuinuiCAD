import type { ModuleMaterialization } from "../dsl/moduleMaterialization";
import {
  moduleInstanceCanvasGeometry,
  type ModuleInstanceCanvasGeometry
} from "../geometry/moduleInstanceCanvasGeometry";
import type { CanvasTextWidthMeasurer } from "../geometry/canvasDrawingBounds";
import type {
  CadElement,
  ElementId,
  EvaluationResult,
  VisibilityProfile
} from "../types/geometry";

export type ModuleInstanceSelectionSnapshot = {
  selectedElementId: ElementId | null;
  selectedElementIds: readonly ElementId[];
  selectionAnchorElementId: ElementId | null;
};

type ReconcileModuleInstanceSelectionInput = {
  selection: ModuleInstanceSelectionSnapshot;
  evaluationIsCurrent: boolean;
  elements: readonly CadElement[];
  evaluation: EvaluationResult;
  moduleMaterialization?: ModuleMaterialization;
  visibilityProfiles: readonly VisibilityProfile[];
  activeVisibilityProfileId: string | null;
  measureCanvasTextWidth?: CanvasTextWidthMeasurer;
};

const selectedModuleInstanceIds = (
  selection: ModuleInstanceSelectionSnapshot,
  elements: readonly CadElement[]
): ElementId[] => {
  const elementById = new Map(elements.map((element) => [element.id, element]));
  return selection.selectedElementIds.filter((id) => elementById.get(id)?.type === "moduleInstance");
};

export type ModuleInstanceSelectionReconciliation = {
  selection: {
    selectedElementId: ElementId | null;
    selectedElementIds: ElementId[];
    selectionAnchorElementId: ElementId | null;
  };
  clearedInstanceIds: ElementId[];
  instanceGeometry: ReadonlyMap<ElementId, ModuleInstanceCanvasGeometry>;
};

/**
 * Reconcile invisible concrete Module-instance selections after a proven-current
 * evaluation. Missing/stale materialization is not evidence that an instance is
 * empty, so it never clears selection.
 *
 * This is evaluation reconciliation, not a user selection action. Callers must
 * apply the returned snapshot without recording Canvas selection history.
 */
export const reconcileModuleInstanceSelection = ({
  selection,
  evaluationIsCurrent,
  elements,
  evaluation,
  moduleMaterialization,
  visibilityProfiles,
  activeVisibilityProfileId,
  measureCanvasTextWidth
}: ReconcileModuleInstanceSelectionInput): ModuleInstanceSelectionReconciliation | null => {
  if (!evaluationIsCurrent || !moduleMaterialization) return null;

  const instanceIds = selectedModuleInstanceIds(selection, elements);
  if (instanceIds.length === 0) return null;

  const instanceGeometry = new Map<ElementId, ModuleInstanceCanvasGeometry>();
  const clearedInstanceIds: ElementId[] = [];
  for (const instanceId of instanceIds) {
    const geometry = moduleInstanceCanvasGeometry({
      instanceId,
      elements,
      evaluation,
      moduleMaterialization,
      visibilityProfiles,
      activeVisibilityProfileId,
      measureCanvasTextWidth
    });
    if (!geometry) continue;
    instanceGeometry.set(instanceId, geometry);
    if (geometry.renderableDescendantIds.length === 0) clearedInstanceIds.push(instanceId);
  }

  if (clearedInstanceIds.length === 0) return null;
  const cleared = new Set(clearedInstanceIds);
  const selectedElementIds = selection.selectedElementIds.filter((id) => !cleared.has(id));
  const selectedElementId = selection.selectedElementId && !cleared.has(selection.selectedElementId)
    ? selection.selectedElementId
    : selectedElementIds[0] ?? null;
  const selectionAnchorElementId =
    selection.selectionAnchorElementId && !cleared.has(selection.selectionAnchorElementId)
      ? selection.selectionAnchorElementId
      : selectedElementId;

  return {
    selection: {
      selectedElementId,
      selectedElementIds,
      selectionAnchorElementId
    },
    clearedInstanceIds,
    instanceGeometry
  };
};
