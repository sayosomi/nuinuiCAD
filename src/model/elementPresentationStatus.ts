import {
  effectiveEnabledElementIds,
  effectiveVisibleElementIds,
  groupStateByElementId,
  type GroupFoldById
} from "./groups";
import {
  effectiveVisibleElementIdsForProfile,
  visibilityProfileById
} from "./visibilityProfiles";
import { resolvedElementColorMap } from "../palette/elementColors";
import type {
  CadElement,
  DocumentPalette,
  ElementId,
  EvaluationResult,
  VisibilityProfile
} from "../types/geometry";

/** Shared element-state semantics for the Source Editor rail and read-only Inspector. */
export type ElementPresentationStatus = {
  elementId: ElementId;
  hasError: boolean;
  hasWarning: boolean;
  hiddenSelf: boolean;
  hiddenByGroup: boolean;
  hiddenByProfile: boolean;
  disabledSelf: boolean;
  disabledByGroup: boolean;
  conditionInactive: boolean;
  isEvaluated: boolean;
  locked: boolean;
  printEnabled: boolean;
  canToggleVisibility: boolean;
  canTogglePrint: boolean;
  color: string;
};

const issueIdsIncludingGroups = (elements: readonly CadElement[], evaluation: EvaluationResult) => {
  const errorIds = new Set(evaluation.errors.map((item) => item.elementId));
  const warningIds = new Set(evaluation.warnings.map((item) => item.elementId));
  const byId = new Map(elements.map((item) => [item.id, item]));
  for (const sourceId of [...errorIds]) {
    let current = byId.get(sourceId);
    while (current?.parentGroupId) {
      errorIds.add(current.parentGroupId);
      current = byId.get(current.parentGroupId);
    }
  }
  for (const sourceId of [...warningIds]) {
    let current = byId.get(sourceId);
    while (current?.parentGroupId) {
      warningIds.add(current.parentGroupId);
      current = byId.get(current.parentGroupId);
    }
  }
  return { errorIds, warningIds };
};

export const createElementPresentationStatusIndex = ({
  elements,
  evaluation,
  groupFoldById,
  palette,
  visibilityProfiles,
  activeVisibilityProfileId
}: {
  elements: readonly CadElement[];
  evaluation: EvaluationResult;
  groupFoldById: GroupFoldById;
  palette: DocumentPalette;
  visibilityProfiles: readonly VisibilityProfile[];
  activeVisibilityProfileId: string;
}) => {
  const groupStates = groupStateByElementId([...elements], groupFoldById);
  const profile = visibilityProfileById([...visibilityProfiles], activeVisibilityProfileId);
  const profileVisible = effectiveVisibleElementIdsForProfile({ elements: [...elements], profile });
  const baseVisible = evaluation.effectiveVisibleElementIds ?? effectiveVisibleElementIds([...elements]);
  const enabled = evaluation.effectiveEnabledElementIds ?? effectiveEnabledElementIds([...elements]);
  const conditionInactive = evaluation.conditionInactiveElementIds ?? new Set<ElementId>();
  const evaluated = evaluation.evaluatedElementIds ?? new Set(elements.map((element) => element.id));
  const colors = resolvedElementColorMap([...elements], palette);
  const { errorIds, warningIds } = issueIdsIncludingGroups(elements, evaluation);
  const statuses = elements.map<ElementPresentationStatus>((element) => {
    const groupState = groupStates.get(element.id);
    return {
      elementId: element.id,
      hasError: errorIds.has(element.id),
      hasWarning: warningIds.has(element.id),
      hiddenSelf: !element.visible,
      hiddenByGroup: Boolean(groupState?.hiddenByGroupId),
      hiddenByProfile: element.visible && !groupState?.hiddenByGroupId && !profileVisible.has(element.id),
      disabledSelf: !element.enabled,
      disabledByGroup: Boolean(groupState?.disabledByGroupId),
      conditionInactive: conditionInactive.has(element.id),
      isEvaluated: evaluated.has(element.id) && enabled.has(element.id) && baseVisible.has(element.id),
      locked: Boolean(element.locked),
      printEnabled: element.type === "group" && element.printEnabled === true,
      canToggleVisibility: element.type !== "variable",
      canTogglePrint: element.type === "group",
      color: colors.get(element.id) ?? "#31322f"
    };
  });
  return new Map(statuses.map((status) => [status.elementId, status]));
};
