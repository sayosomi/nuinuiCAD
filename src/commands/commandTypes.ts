import type { BezierHandleRole } from "../model/elementDragTransforms";
import type { CadDocumentSnapshot } from "../state/cadDocumentStore";
import type {
  MeasurementInsertMode,
  MeasurementPointSlot
} from "../state/cadUiStore";
import type { NumericMeasurementKey } from "../geometry/numericExpressionTypes";
import type { GroupTemplate } from "../templates/groupTemplate";
import type { CadElement, ElementId, EvaluationResult, PointAnchor } from "../types/geometry";
import type { NumericValue } from "../types/geometry";

export type { BezierHandleRole };

export type CommandId =
  | "newDocument"
  | "openDocument"
  | "saveDocument"
  | "saveDocumentAs"
  | "exportPrintSvg"
  | "exportPrintPdf"
  | "undo"
  | "redo"
  | "selectElement"
  | "selectAllElements"
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
  | "addConditionalGroup"
  | "wrapSelectedElementsInConditionalGroup"
  | "addElseBranchToSelectedConditionalGroup"
  | "deleteElseBranchFromSelectedConditionalGroup"
  | "addForGroup"
  | "wrapSelectedElementsInForGroup"
  | "toggleSelectedForGroupGenerated"
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
  | "startNumericReferenceInsertPick"
  | "setNumericReferencePickProperty"
  | "applyPickedNumericReference"
  | "cancelNumericReferencePick"
  | "selectNextPickCandidate"
  | "selectPreviousPickCandidate"
  | "selectNextPickOption"
  | "selectPreviousPickOption"
  | "applySelectedPickCandidate"
  | "startPointPick"
  | "startLineEndpointPairPick"
  | "applyPickedPoint"
  | "cancelPointPick"
  | "startLinePick"
  | "startLineAndPointPick"
  | "applyPickedLine"
  | "cancelLinePick"
  | "toggleElementVisibility"
  | "toggleElementEnabled"
  | "toggleGroupPrintEnabled"
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
  | "addImage"
  | "addNumericVariable"
  | "deleteNumericVariable"
  | "addBezierNumericVariable"
  | "deleteBezierNumericVariable"
  | "addBezierIntermediatePoint"
  | "deleteBezierIntermediatePoint"
  | "zoomInCanvas"
  | "zoomOutCanvas"
  | "resetCanvasView"
  | "openPrintLayout"
  | "closePrintLayout"
  | "toggleCanvasElementNames"
  | "toggleCanvasPoints"
  | "toggleElementListColorAccents"
  | "openCommandPalette"
  | "closeCommandPalette"
  | "openShortcutSettings"
  | "closeShortcutSettings"
  | "openPaletteSettings"
  | "closePaletteSettings"
  | "openGroupTemplateLibrary"
  | "openGroupTemplateInsertion"
  | "closeGroupTemplateLibrary"
  | "startTemplateInsertion"
  | "cancelTemplateInsertion"
  | "selectNextTemplateInsertionInput"
  | "selectPreviousTemplateInsertionInput"
  | "selectTemplateInsertionInput"
  | "setTemplateNumericInput"
  | "confirmTemplateInsertion"
  | "openCommandRibbonSettings"
  | "closeCommandRibbonSettings"
  | "openSelectionColorPicker"
  | "closeSelectionColorPicker"
  | "applyDisplayColorToSelection"
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
  targetParentGroupId?: ElementId | null;
  evaluationLimitIndex?: number;
  evaluation?: EvaluationResult;
  selectionMode?: "replace" | "toggle" | "range";
  dx?: number;
  dy?: number;
  angleLocked?: boolean;
  distanceLocked?: boolean;
  bezierHandleRole?: BezierHandleRole;
  commitMode?: "preview" | "commit";
  baseElements?: CadElement[];
  baseEvaluation?: EvaluationResult;
  historySnapshot?: CadDocumentSnapshot;
  parameterKey?: string;
  numericExpression?: string;
  numericReferenceExpression?: string;
  numericReferenceProperty?: NumericMeasurementKey;
  numericExpressionSnippet?: string;
  numericExpressionAppendMode?: "sum" | "raw";
  displayedExpression?: string;
  selectionStart?: number | null;
  selectionEnd?: number | null;
  measurementInsertMode?: MeasurementInsertMode;
  measurementPointSlot?: MeasurementPointSlot;
  nextParameterKey?: string;
  intermediatePointId?: string;
  variableId?: string;
  pointAnchorMode?: "reference" | "coordinate";
  pickedPointId?: ElementId;
  pickedPointAnchor?: PointAnchor;
  pickedLineId?: ElementId;
  groupTemplate?: GroupTemplate;
  templateInputId?: string;
  numericValue?: NumericValue;
  colorId?: string;
};

export type Command = {
  id: CommandId;
  label: string;
  palette?: {
    order?: number;
    keywords?: string[];
    isAvailable?: (context?: CommandContext) => boolean;
  };
  shortcuts?: {
    keys: string;
    label?: string;
  }[];
  run: (context?: CommandContext) => void;
};
