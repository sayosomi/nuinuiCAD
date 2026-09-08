import type { PickModeSession } from "../model/pickModeSession";

export type PickModeCanvasOperation =
  | "normal-selection"
  | "rectangle-selection"
  | "point-drag"
  | "bezier-drag"
  | "clear-selection"
  | "document-mutation"
  | "workflow-start"
  | "undo"
  | "redo"
  | "pan"
  | "zoom"
  | "reset-view"
  | "fit-drawing"
  | "presentation-toggle"
  | "pick"
  | "reveal"
  | "focus";

const allowedWhilePicking = new Set<PickModeCanvasOperation>([
  "pan",
  "zoom",
  "reset-view",
  "fit-drawing",
  "presentation-toggle",
  "pick",
  "reveal",
  "focus"
]);

export const pickModeCanvasOperationAllowed = (
  operation: PickModeCanvasOperation,
  session: PickModeSession | null | undefined
): boolean => !session || allowedWhilePicking.has(operation);

export const pickModeCanvasOperationAllowedForActive = (
  operation: PickModeCanvasOperation,
  active: boolean
): boolean => !active || allowedWhilePicking.has(operation);

const pickCommandIds = new Set([
  "applyNumericExpressionReference",
  "applyPickedNumericReference",
  "applyPickedLine",
  "applyPickedPoint",
  "applySelectedPickCandidate",
  "cancelLinePick",
  "cancelNumericReferencePick",
  "cancelPickMode",
  "cancelPointPick",
  "finishLinePick",
  "finishPickMode",
  "finishPointPick",
  "selectNextPickCandidate",
  "selectNextPickOption",
  "selectPreviousPickCandidate",
  "selectPreviousPickOption",
  "setNumericReferencePickProperty"
]);

export const pickModeCanvasOperationForCommand = (
  commandId: string
): PickModeCanvasOperation => {
  if (commandId === "undo") return "undo";
  if (commandId === "redo") return "redo";
  if (commandId === "clearCanvasSelection") return "clear-selection";
  if (commandId === "zoomInCanvas" || commandId === "zoomOutCanvas") return "zoom";
  if (commandId === "resetCanvasView") return "reset-view";
  if (commandId === "fitDrawing") return "fit-drawing";
  if (
    commandId === "toggleCanvasPointNames" ||
    commandId === "toggleCanvasGeometryNames" ||
    commandId === "toggleCanvasElementNames" ||
    commandId === "toggleCanvasPoints"
  ) return "presentation-toggle";
  if (commandId === "focusCanvas") return "focus";
  if (pickCommandIds.has(commandId)) return "pick";
  return "document-mutation";
};

export const pickModeCanvasCommandAllowed = (
  commandId: string,
  session: PickModeSession | null | undefined
): boolean => pickModeCanvasOperationAllowed(
  pickModeCanvasOperationForCommand(commandId),
  session
);
