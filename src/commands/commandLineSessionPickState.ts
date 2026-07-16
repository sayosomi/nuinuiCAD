import { initialNumericReferencePickProperty } from "../geometry/numericReferenceProperties";
import type { CadUiState } from "../state/cadUiStore";
import { COMMAND_LINE_PICK_TARGET_ID } from "./commandLinePickRouting";
import {
  currentStep,
  isEditingCommandLineStep,
  type CommandLineSession
} from "./commandLineSession";

type CommandLinePickFields = Pick<
  CadUiState,
  | "activePointPickTarget"
  | "activeNumericReferencePickTarget"
  | "activeLinePickTarget"
  | "activePickCursor"
>;

/** Builds the one command-line-owned numeric target from derivable prompt data. */
export const commandLineNumericReferencePickTargetFor = (
  session: CommandLineSession,
  restoredProperty?: NonNullable<CommandLineSession["editingReturnPickState"]>["numericReferencePickProperty"]
) => {
  const step = currentStep(session);
  if (step?.kind !== "number") return null;
  return {
    elementId: COMMAND_LINE_PICK_TARGET_ID,
    parameterKey: step.key,
    insertionIndex: session.insertionIndex,
    mode: "replace" as const,
    property: restoredProperty ?? initialNumericReferencePickProperty(step.stepLevels)
  };
};

/** Builds the command-line-owned targets for the current prompt. */
export const commandLinePickStateForSession = (
  session: CommandLineSession | null | undefined,
  restoredPickState = null as CommandLineSession["editingReturnPickState"]
): CommandLinePickFields => {
  const step = currentStep(session ?? null);
  const target = step && step.kind !== "number" && step.kind !== "name"
    ? {
        elementId: COMMAND_LINE_PICK_TARGET_ID,
        parameterKey: step.key,
        insertionIndex: session!.insertionIndex
      }
    : null;
  const activePickCursor = restoredPickState?.activePickCursor ?? null;

  if (step?.kind === "point" || step?.kind === "endpoint") {
    return {
      activePointPickTarget: target,
      activeNumericReferencePickTarget: null,
      activeLinePickTarget: null,
      activePickCursor
    };
  }
  if (step?.kind === "line") {
    return {
      activePointPickTarget: null,
      activeNumericReferencePickTarget: null,
      activeLinePickTarget: target,
      activePickCursor
    };
  }
  if (step?.kind === "lineList") {
    const draftLineIds = isEditingCommandLineStep(session!) && Array.isArray(session!.editingDraft)
      ? [...session!.editingDraft]
      : restoredPickState?.lineListDraftLineIds ? [...restoredPickState.lineListDraftLineIds] : [];
    return {
      activePointPickTarget: null,
      activeNumericReferencePickTarget: null,
      activeLinePickTarget: target ? { ...target, draftLineIds } : null,
      activePickCursor
    };
  }
  if (step?.kind === "number" && restoredPickState?.numericReferencePickProperty !== null && restoredPickState?.numericReferencePickProperty !== undefined) {
    return {
      activePointPickTarget: null,
      activeLinePickTarget: null,
      activeNumericReferencePickTarget: commandLineNumericReferencePickTargetFor(
        session!,
        restoredPickState.numericReferencePickProperty
      ),
      activePickCursor
    };
  }
  return {
    activePointPickTarget: null,
    activeNumericReferencePickTarget: null,
    activeLinePickTarget: null,
    activePickCursor
  };
};

/** Captures only transient command-line progress that cannot be re-derived. */
export const editingReturnPickStateFor = (
  session: CommandLineSession,
  ui: CommandLinePickFields
) => {
  const step = currentStep(session);
  const ownsCurrentTarget = (target: { elementId: string; parameterKey: string } | null) =>
    Boolean(step && step.kind !== "name" && target?.elementId === COMMAND_LINE_PICK_TARGET_ID && target.parameterKey === step.key);
  const pointTargetOwned = ownsCurrentTarget(ui.activePointPickTarget);
  const lineTargetOwned = ownsCurrentTarget(ui.activeLinePickTarget);
  const numericTargetOwned = ownsCurrentTarget(ui.activeNumericReferencePickTarget);

  const numericReferencePickProperty = step?.kind === "number" && numericTargetOwned
    ? ui.activeNumericReferencePickTarget?.property ?? null
    : null;
  const activeLineDraftLineIds = ui.activeLinePickTarget?.draftLineIds;
  const lineListDraftLineIds = step?.kind === "lineList" && lineTargetOwned &&
    activeLineDraftLineIds && activeLineDraftLineIds.length > 0
    ? [...activeLineDraftLineIds]
    : null;
  const activePickCursor = pointTargetOwned || lineTargetOwned || numericTargetOwned
      ? ui.activePickCursor ? { ...ui.activePickCursor } : null
      : null;
  return numericReferencePickProperty || lineListDraftLineIds || activePickCursor
    ? { numericReferencePickProperty, lineListDraftLineIds, activePickCursor }
    : null;
};
