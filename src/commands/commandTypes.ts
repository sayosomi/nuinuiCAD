import type { BezierHandleRole } from "../model/elementDragTransforms";
import type { CadDocumentSnapshot } from "../state/cadDocumentStore";
import type {
  MeasurementInsertMode,
  MeasurementPointSlot
} from "../state/cadUiStore";
import type { CadElement, ElementId, PointAnchor } from "../types/geometry";

export type { BezierHandleRole };

export type CommandId =
  | "openDocument"
  | "saveDocument"
  | "saveDocumentAs"
  | "undo"
  | "redo"
  | "selectElement"
  | "selectNextElement"
  | "selectPreviousElement"
  | "extendSelectionToNextElement"
  | "extendSelectionToPreviousElement"
  | "moveSelectedElementUp"
  | "moveSelectedElementDown"
  | "moveElementToInsertionIndex"
  | "setEvaluationLimitIndex"
  | "moveEvaluationDividerUp"
  | "moveEvaluationDividerDown"
  | "moveEvaluationDividerToSelectedElement"
  | "moveEvaluationDividerToEnd"
  | "groupSelectedElements"
  | "ungroupSelectedGroup"
  | "toggleGroupExpanded"
  | "indentSelectedElements"
  | "outdentSelectedElements"
  | "selectParentGroup"
  | "movePointElementByDelta"
  | "moveBezierHandleByDelta"
  | "applyNumericExpressionReference"
  | "insertNumericExpressionSnippet"
  | "toggleExpressionInsertTray"
  | "closeExpressionInsertTray"
  | "setMeasurementInsertMode"
  | "startMeasurementPointPick"
  | "startMeasurementLinePick"
  | "insertSelectedMeasurement"
  | "startNumericReferencePick"
  | "applyPickedNumericReference"
  | "cancelNumericReferencePick"
  | "selectNextPickCandidate"
  | "selectPreviousPickCandidate"
  | "selectNextPickOption"
  | "selectPreviousPickOption"
  | "applySelectedPickCandidate"
  | "startPointPick"
  | "applyPickedPoint"
  | "cancelPointPick"
  | "startLinePick"
  | "applyPickedLine"
  | "cancelLinePick"
  | "toggleElementVisibility"
  | "toggleElementEnabled"
  | "toggleSelectedElementVisibility"
  | "toggleSelectedElementEnabled"
  | "duplicateSelectedElement"
  | "deleteSelectedElement"
  | "addFreePoint"
  | "addVariable"
  | "addOffsetPoint"
  | "addPolarOffsetPoint"
  | "addDivisionPoint"
  | "addLineDivisionPoint"
  | "addIntersectionPoint"
  | "addLineTangentOffsetPoint"
  | "addLine"
  | "addArcLine"
  | "addThreePointArcLine"
  | "addCornerRadiusArcLine"
  | "addEdge"
  | "addExtendTrim"
  | "addBezierCurve"
  | "addOffsetLine"
  | "addSplitLine"
  | "addCopyLine"
  | "addSymmetricCopyLine"
  | "addMove"
  | "addSymmetricMove"
  | "addNumericVariable"
  | "deleteNumericVariable"
  | "addBezierNumericVariable"
  | "deleteBezierNumericVariable"
  | "addBezierIntermediatePoint"
  | "deleteBezierIntermediatePoint"
  | "zoomInCanvas"
  | "zoomOutCanvas"
  | "resetCanvasView"
  | "openCommandPalette"
  | "closeCommandPalette"
  | "focusCanvas"
  | "focusElementList"
  | "focusElementSearch"
  | "enterElementListMode"
  | "toggleShortcutHelp"
  | "toggleElementInfoPanel"
  | "enterDependencyJumpMode"
  | "exitDependencyJumpMode"
  | "selectNextDependencyJumpTarget"
  | "selectPreviousDependencyJumpTarget"
  | "jumpToSelectedDependencyTarget"
  | "enterParameterEditMode"
  | "exitParameterEditMode"
  | "selectNextParameter"
  | "selectPreviousParameter"
  | "selectParameterByKey"
  | "incrementSelectedParameter"
  | "decrementSelectedParameter"
  | "increaseSelectedParameterStep"
  | "decreaseSelectedParameterStep"
  | "cycleSelectedReferenceForward"
  | "cycleSelectedReferenceBackward"
  | "toggleSelectedParameterValue"
  | "toggleSelectedPointAnchorMode"
  | "setSelectedPointAnchorReferenceMode"
  | "setSelectedPointAnchorCoordinateMode"
  | "toggleSelectedBooleanParameter"
  | "toggleBooleanParameterByDirectKey"
  | "activateSelectedParameter"
  | "focusSelectedParameterInput";

export type CommandContext = {
  focusCanvas?: () => void;
  focusElementList?: () => void;
  focusElementSearch?: () => void;
  focusSelectedParameterInput?: () => void;
  getCanvasViewportRect?: () => DOMRect | null;
  parameterDirectKey?: string;
  stepMultiplier?: number;
  elementId?: ElementId;
  insertionIndex?: number;
  evaluationLimitIndex?: number;
  selectionMode?: "replace" | "toggle" | "range";
  dx?: number;
  dy?: number;
  angleLocked?: boolean;
  distanceLocked?: boolean;
  bezierHandleRole?: BezierHandleRole;
  commitMode?: "preview" | "commit";
  baseElements?: CadElement[];
  historySnapshot?: CadDocumentSnapshot;
  parameterKey?: string;
  numericExpression?: string;
  numericReferenceExpression?: string;
  numericExpressionSnippet?: string;
  displayedExpression?: string;
  selectionStart?: number | null;
  selectionEnd?: number | null;
  measurementInsertMode?: MeasurementInsertMode;
  measurementPointSlot?: MeasurementPointSlot;
  intermediatePointId?: string;
  variableId?: string;
  pointAnchorMode?: "reference" | "coordinate";
  pickedPointId?: ElementId;
  pickedPointAnchor?: PointAnchor;
  pickedLineId?: ElementId;
};

export type Command = {
  id: CommandId;
  label: string;
  palette?: {
    order?: number;
    keywords?: string[];
  };
  shortcuts?: {
    keys: string;
    label?: string;
  }[];
  run: (context?: CommandContext) => void;
};
