import type { PickModeSession } from "../model/pickModeSession";

export type CanvasModalMode = "pick" | "coordinate-point-creation";

export type CanvasModalOperation =
  | "create-coordinate-point"
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

export type PickModeCanvasOperation = CanvasModalOperation;

const allowedWhilePicking = new Set<CanvasModalOperation>([
  "pan",
  "zoom",
  "reset-view",
  "fit-drawing",
  "presentation-toggle",
  "pick",
  "reveal",
  "focus"
]);

const allowedWhileCreatingCoordinatePoints = new Set<CanvasModalOperation>([
  "create-coordinate-point",
  "pan",
  "zoom",
  "reset-view",
  "fit-drawing",
  "presentation-toggle",
  "focus",
  "undo",
  "redo"
]);

export const canvasModalCanvasOperationAllowed = (
  operation: CanvasModalOperation,
  mode: CanvasModalMode | null | undefined
): boolean => {
  if (!mode) return true;
  return mode === "pick"
    ? allowedWhilePicking.has(operation)
    : allowedWhileCreatingCoordinatePoints.has(operation);
};

export const canvasModalCanvasOperationAllowedForActive = (
  operation: CanvasModalOperation,
  mode: CanvasModalMode | null | undefined
): boolean => canvasModalCanvasOperationAllowed(operation, mode);

export const canvasModalModeFor = ({
  pickModeActive,
  coordinatePointCreationActive
}: {
  pickModeActive: boolean;
  coordinatePointCreationActive: boolean;
}): CanvasModalMode | null => pickModeActive
  ? "pick"
  : coordinatePointCreationActive
    ? "coordinate-point-creation"
    : null;

export const pickModeCanvasOperationAllowed = (
  operation: PickModeCanvasOperation,
  session: PickModeSession | null | undefined
): boolean => canvasModalCanvasOperationAllowed(operation, session ? "pick" : null);

export const pickModeCanvasOperationAllowedForActive = (
  operation: PickModeCanvasOperation,
  active: boolean
): boolean => canvasModalCanvasOperationAllowed(operation, active ? "pick" : null);

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
  if (commandId === "editCanvasRibbon") return "workflow-start";
  if (commandId === "zoomInCanvas" || commandId === "zoomOutCanvas") return "zoom";
  if (commandId === "resetCanvasView") return "reset-view";
  if (commandId === "fitDrawing") return "fit-drawing";
  if (
    commandId === "toggleCanvasPointNames" ||
    commandId === "toggleCanvasGeometryNames" ||
    commandId === "toggleCanvasElementNames" ||
    commandId === "toggleCanvasPoints" ||
    commandId === "toggleCanvasGrid" ||
    commandId === "configureCanvasGrid" ||
    commandId === "toggleCanvasGridSnap"
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

export const canvasModalCanvasCommandAllowed = (
  commandId: string,
  mode: CanvasModalMode | null | undefined
): boolean => canvasModalCanvasOperationAllowed(
  pickModeCanvasOperationForCommand(commandId),
  mode
);

export const pickModeCanvasCommandAllowedForActive = (
  commandId: string,
  active: boolean
): boolean => pickModeCanvasOperationAllowedForActive(
  pickModeCanvasOperationForCommand(commandId),
  active
);
