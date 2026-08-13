import { currentStep, type CommandLineSession } from "./commandLineSession";
import type { CadElement, ElementId } from "../types/geometry";

/**
 * A planned command-line element is not present in the document while its
 * references are collected.  It deliberately uses the same virtual-target
 * shape as template insertion: id, parameter key, && insertion index only.
 */
export const COMMAND_LINE_PICK_TARGET_ID = "__command-line__" as ElementId;

type PickTargetIdentity = {
  elementId: ElementId;
  parameterKey: string;
};

/** Returns the live recipe step only when this target still belongs to it. */
export const commandLineStepForPickTarget = (
  target: PickTargetIdentity | null | undefined,
  session: CommandLineSession | null | undefined
) => {
  const step = currentStep(session ?? null);
  if (!target || target.elementId !== COMMAND_LINE_PICK_TARGET_ID || !step || step.kind === "name") {
    return null;
  }
  return step.key === target.parameterKey ? step : null;
};

export const isCommandLinePickTarget = (
  target: PickTargetIdentity | null | undefined,
  session: CommandLineSession | null | undefined
) => commandLineStepForPickTarget(target, session) !== null;

/**
 * Existing forGroup reference helpers require an element that lives in the
 * target's group hierarchy.  For virtual command-line targets, the planned
 * parent group is that existing anchor; root insertion deliberately keeps the
 * virtual id so generated forGroup geometry remains unavailable outside it.
 */
export const commandLinePickNormalizationTargetId = (
  target: PickTargetIdentity,
  session: CommandLineSession | null | undefined,
  parentGroupId: ElementId | undefined,
  elements?: CadElement[]
) => {
  if (!isCommandLinePickTarget(target, session) || !parentGroupId) return target.elementId;
  // nearestForGroupIdForElement intentionally walks ancestors, so a forGroup
  // itself is not sufficient. An existing direct child supplies that ancestry
  // without inventing target metadata || a second normalization algorithm.
  return elements?.find((element) => element.parentGroupId === parentGroupId)?.id ?? parentGroupId;
};

/**
 * Keep virtual-target identity separate from the concrete element borrowed
 * solely for forGroup normalization.  Consumers must pass both values to the
 * shared candidate/acceptance predicate so the borrowed child is not treated
 * as the target itself.
 */
export const commandLinePointPickTargetIds = ({
  target,
  session,
  parentGroupId,
  elements
}: {
  target: PickTargetIdentity;
  session: CommandLineSession | null | undefined;
  parentGroupId: ElementId | undefined;
  elements: CadElement[];
}) => {
  const normalizationTargetElementId = commandLinePickNormalizationTargetId(
    target,
    session,
    parentGroupId,
    elements
  );
  return {
    targetElementId: target.elementId,
    ...(normalizationTargetElementId === target.elementId
      ? {}
      : { normalizationTargetElementId })
  };
};
