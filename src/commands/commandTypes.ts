import type { BezierHandleRole } from "../model/elementDragTransforms";
import type { CadDocumentSnapshot } from "../state/cadDocumentStore";
import type { DocumentMutationResult } from "../state/cadDocumentStore";
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
  | "importLegacyDocument"
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
  | "addGroup"
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
  | "setMeasurementInsertMode"
  | "startMeasurementFunctionInsert"
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
  | "startEndpointPairPick"
  | "startEndpointAndPointPick"
  | "applyPickedPoint"
  | "cancelPointPick"
  | "startLinePick"
  | "startLineAndPointPick"
  | "applyPickedLine"
  | "cancelLinePick"
  | "toggleElementVisibility"
  | "toggleElementEnabled"
  | "toggleElementLocked"
  | "toggleGroupPrintEnabled"
  | "toggleSelectedGroupPrintEnabled"
  | "toggleSelectedElementVisibility"
  | "toggleSelectedElementEnabled"
  | "toggleSelectedElementLocked"
  | "duplicateSelectedElement"
  | "deleteSelectedElement"
  | "addFreePoint"
  | "addText"
  | "addVariable"
  | "addOffsetPoint"
  | "addPolarOffsetPoint"
  | "addDivisionPoint"
  | "addLineDivisionPoint"
  | "addIntersectionPoint"
  | "addLineTangentOffsetPoint"
  | "addLine"
  | "addAngleLengthLine"
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
  | "togglePrintPreviewWindow"
  | "toggleCanvasElementNames"
  | "toggleCanvasPoints"
  | "toggleElementListColorAccents"
  | "openCommandPalette"
  | "closeCommandPalette"
  | "openShortcutSettings"
  | "closeShortcutSettings"
  | "openPaletteSettings"
  | "closePaletteSettings"
  | "openVisibilityProfileSettings"
  | "closeVisibilityProfileSettings"
  | "openGroupTemplateLibrary"
  | "openGroupTemplateInsertion"
  | "closeGroupTemplateLibrary"
  | "openDslPanel"
  | "exportDslSelection"
  | "validateDslPanel"
  | "applyDslPanel"
  | "closeDslPanel"
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
  | "toggleInspectorPanel"
  | "focusInspectorParameterRows"
  | "focusInspectorDependencyRows"
  | "exitInspector"
  | "selectNextInspectorRow"
  | "selectPreviousInspectorRow"
  | "activateInspectorRow"
  | "startInspectorParameterPick"
  | "stepSourceValueForward"
  | "stepSourceValueBackward";

export type CommandContext = {
  focusCanvas?: () => void;
  focusElementList?: () => void;
  focusElementSearch?: () => void;
  exportDslSelection?: () => void;
  validateDslPanel?: () => void;
  applyDslPanel?: () => void;
  closeDslPanel?: () => void;
  focusInspectorParameterRows?: () => void;
  focusInspectorDependencyRows?: () => void;
  moveInspectorRow?: (direction: -1 | 1) => boolean;
  activateInspectorRow?: () => boolean;
  startInspectorParameterPick?: () => boolean;
  /** The Inspector owns the only DOM-focus check for command delegation. */
  inspectorHasFocus?: () => boolean;
  exitInspector?: () => void;
  getCanvasViewportRect?: () => DOMRect | null;
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
  dslElementIds?: ElementId[];
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
  /** Most commands flush pending editor text before running. Editor-native text commands own that boundary. */
  flushPolicy?: "before-run" | "editor-owned";
  run: (context?: CommandContext) => void | boolean | DocumentMutationResult;
};
