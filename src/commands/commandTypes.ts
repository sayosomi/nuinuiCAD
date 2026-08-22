import type { BezierHandleRole } from "../model/elementDragTransforms";
import type { ElementActivity } from "../model/elementActivity";
import type { DocumentMutationResult } from "../state/cadDocumentStore";
import type {
  MeasurementInsertMode,
  MeasurementPointSlot
} from "../state/cadUiStore";
import type { NumericMeasurementKey } from "../geometry/numericExpressionTypes";
import type { CanvasTextWidthMeasurer } from "../geometry/canvasDrawingBounds";
import type { BindingId } from "../scalars/bindingCatalog";
import type { ModuleSemanticTarget } from "../dsl/moduleSemanticEditor";
import type { ModuleSemanticCursorResolution } from "../editor/sourceEditorTypes";
import type { CadElement, ElementId, EvaluationResult, PointAnchor } from "../types/geometry";
import type { NumericValue } from "../types/geometry";
import type { SourceCreationCursor } from "./sourceCreationInsertion";
import type { CanonicalGeometrySourceReference } from "../model/moduleSemanticCandidateBoundary";

export type { BezierHandleRole };

export type BakeSandboxEvaluation = {
  evaluation: EvaluationResult;
  targetIds: readonly ElementId[];
  compiledDocumentRevision: number;
};

export type CommandId =
  | "newDocument"
  | "openDocument"
  | "saveDocument"
  | "saveDocumentAs"
  | "undo"
  | "redo"
  | "selectElement"
  | "clearCanvasSelection"
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
  | "duplicateSelectedElement"
  | "deleteSelectedElement"
  | "addFreePoint"
  | "addText"
  | "addOffsetPoint"
  | "addPolarOffsetPoint"
  | "addDivisionPoint"
  | "addLineDivisionPoint"
  | "addIntersectionPoint"
  | "addLineTangentOffsetPoint"
  | "addBezierBulgePoint"
  | "addBezierExtremePoint"
  | "addLine"
  | "addAngleLengthLine"
  | "addCommonTangentLine"
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
  | "bakeCurrentShape"
  | "bakeBaseShape"
  | "addImage"
  | "addBezierIntermediatePoint"
  | "deleteBezierIntermediatePoint"
  | "zoomInCanvas"
  | "zoomOutCanvas"
  | "resetCanvasView"
  | "fitDrawing"
  | "toggleCanvasPointNames"
  | "toggleCanvasGeometryNames"
  /** @deprecated Compatibility alias for toggleCanvasPointNames. */
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
  | "openCommandRibbonSettings"
  | "closeCommandRibbonSettings"
  | "openSelectionColorPicker"
  | "closeSelectionColorPicker"
  | "applyDisplayColorToSelection"
  | "renameSelectedElement"
  | "goToSourceDefinition"
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
  /** VS Code Canvas opts into local element-selection history; Tauri leaves this unset. */
  recordSelectionHistory?: boolean;
  /** Finalizes ephemeral Canvas interaction state before a command changes ownership. */
  finalizeCanvasInteraction?: () => void;
  /** Host-aware Canvas Undo/Redo coordinator. The direct store path remains the Tauri fallback. */
  canvasHistory?: (direction: "undo" | "redo") => void;
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
  currentCursorModuleSemanticTarget?: () => ModuleSemanticTarget | null;
  currentCursorModuleSemanticResolution?: () => ModuleSemanticCursorResolution;
  goToSourceDefinitionAtCursor?: () => boolean;
  /** Focuses the Source Editor at the end of a newly generated element statement. */
  focusSourceEditorAtElementEnd?: (elementId: ElementId) => void;
  /** Focuses the Source Editor at the end of a physical line, without touching
   * Canvas selection - used for a just-inserted draft statement that has no
   * corresponding CadElement yet. */
  focusSourceEditorAtLineEnd?: (line: number) => void;
  /** Canvas-only ephemeral state cleared before a creation-session replacement. */
  clearPendingCanvasPointerIntent?: () => void;
  /** Cancels the deferred Canvas-to-Source-Editor focus handoff before replacement. */
  clearSourceEditorFocusReservation?: () => void;
  getCanvasViewportRect?: () => DOMRect | null;
  measureCanvasTextWidth?: CanvasTextWidthMeasurer;
  elementId?: ElementId;
  insertionIndex?: number;
  targetParentGroupId?: ElementId | null;
  evaluationLimitIndex?: number;
  evaluation?: EvaluationResult;
  evaluationIsCurrent?: boolean;
  /** Source statement selected by a host-side source cursor query. */
  sourceStatementIndex?: number;
  /** Bake-only selection captured before an asynchronous sandbox evaluation. */
  bakeSelectedElementIds?: readonly ElementId[];
  emitSkippedComments?: boolean;
  includeHiddenGeometry?: boolean;
  includeDisabledGeometry?: boolean;
  /** Bake-only sandbox evaluation; accepted only with explicit target/current metadata. */
  bakeDisabledEvaluation?: EvaluationResult;
  bakeDisabledEvaluationTargetIds?: readonly ElementId[];
  bakeDisabledEvaluationIsCurrent?: boolean;
  /** Tauri-only on-demand Bake sandbox provider. */
  prepareBakeSandbox?: (targetIds: readonly ElementId[]) => Promise<BakeSandboxEvaluation | null>;
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
  pointAnchorMode?: "reference" | "coordinate";
  pickedPointId?: ElementId;
  pickedPointAnchor?: PointAnchor;
  /** Structured canonical source reference supplied by a semantic Module pick candidate. */
  pickedPointSourceReference?: CanonicalGeometrySourceReference;
  pickedLineId?: ElementId;
  /** Canonical source reference supplied by a semantic Module pick candidate. */
  pickedLineSourceReference?: CanonicalGeometrySourceReference;
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
  run: (context?: CommandContext) =>
    | void
    | boolean
    | DocumentMutationResult
    | Promise<void | boolean | DocumentMutationResult>;
};
