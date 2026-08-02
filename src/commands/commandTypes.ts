import type { BezierHandleRole } from "../model/elementDragTransforms";
import type { ElementActivity } from "../model/elementActivity";
import type { DocumentMutationResult } from "../state/cadDocumentStore";
import type {
  MeasurementInsertMode,
  MeasurementPointSlot
} from "../state/cadUiStore";
import type { NumericMeasurementKey } from "../geometry/numericExpressionTypes";
import type { BindingId } from "../scalars/bindingCatalog";
import type { GroupTemplate } from "../templates/groupTemplate";
import type { CadElement, ElementId, EvaluationResult, PointAnchor } from "../types/geometry";
import type { NumericValue } from "../types/geometry";
import type { SourceCreationCursor } from "./sourceCreationInsertion";

export type { BezierHandleRole };

export type CommandId =
  | "newDocument"
  | "openDocument"
  | "importLegacyDocument"
  | "upgradeDocumentToNui3"
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
  | "finishLinePick"
  | "cancelLinePick"
  | "cycleElementActivity"
  | "setElementActivity"
  | "setSelectedElementsVisible"
  | "setSelectedElementsHidden"
  | "setSelectedElementsDisabled"
  | "toggleGroupPrintEnabled"
  | "toggleSelectedGroupPrintEnabled"
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
  | "reverseSelectedPath"
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
  | "renameSelectedElement"
  | "focusCanvas"
  | "focusSourceEditor"
  | "focusElementSearch"
  | "toggleShortcutHelp"
  | "toggleInspectorPanel"
  | "stepSourceValueForward"
  | "stepSourceValueBackward"
  | "startCanvasPickFromSourceSelection"
  | "cancelCommandLineSession"
  | "confirmCommandLineSession";

export type CommandContext = {
  focusCanvas?: () => void;
  focusSourceEditor?: () => void;
  focusElementSearch?: () => void;
  /** Current element statement under the Source Editor cursor, without exposing CodeMirror state. */
  currentCursorElementId?: () => ElementId | null;
  /** Current physical Source Editor cursor for statement-preserving creation insertion. */
  currentSourceCursor?: () => SourceCreationCursor | null;
  /** Typed binding (declaration/reference/set target/template hole) under the
   * Source Editor cursor, if any - see typedRenameTargetAtCursor.ts. Null
   * whenever the cursor is not on a typed construct at all. */
  currentCursorTypedRenameTargetBindingId?: () => BindingId | null;
  /** Focuses the Source Editor at the end of a newly generated element statement. */
  focusSourceEditorAtElementEnd?: (elementId: ElementId) => void;
  /** Canvas-only ephemeral state cleared before a creation-session replacement. */
  clearPendingCanvasPointerIntent?: () => void;
  /** Cancels the deferred Canvas-to-Source-Editor focus handoff before replacement. */
  clearSourceEditorFocusReservation?: () => void;
  getCanvasViewportRect?: () => DOMRect | null;
  elementId?: ElementId;
  insertionIndex?: number;
  targetParentGroupId?: ElementId | null;
  evaluationLimitIndex?: number;
  evaluation?: EvaluationResult;
  selectionMode?: "replace" | "toggle" | "range";
  /** Source Editor folded-block move: use elementId alone instead of the current multi-selection. */
  moveCursorElementOnly?: boolean;
  dx?: number;
  dy?: number;
  angleLocked?: boolean;
  distanceLocked?: boolean;
  bezierHandleRole?: BezierHandleRole;
  commitMode?: "preview" | "commit";
  baseElements?: CadElement[];
  baseEvaluation?: EvaluationResult;
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
  activity?: ElementActivity;
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
