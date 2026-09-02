import type {
  ReactNode } from "react";
import type { CanvasTextWidthMeasurer } from "../geometry/canvasDrawingBounds";
import type { BezierHandleRole } from "../model/elementDragTransforms";
import type { ModuleSemanticCandidateContext } from "../model/moduleSemanticCandidateBoundary";
import type { CanvasRectangleSelectionUpdateMode } from "../commands/canvasRectangleSelectionCommands";
import type { CanvasSelectionMode } from "../commands/selectionCommands";
import type {
  ActiveLinePickTarget,
  ActiveNumericReferencePickTarget,
  ActivePointPickTarget,
  CanvasViewport
} from "../state/cadUiStore";
import type { CommandLineSession } from "../commands/commandLineSession";
import type {
  CadElement,
  ElementId,
  EvaluationResult,
  PointAnchor,
  VisibilityProfile
} from "../types/geometry";
import type { SelectionSnapshot } from "../state/cadDocumentStore";
import type { CanonicalGeometrySourceReference } from "../model/moduleSemanticCandidateBoundary";
import type { ViewportSize } from "./canvasViewport";
import type { CanvasTheme } from "./canvasTheme";
import type { PickCandidate } from "../model/pickCandidates";
import type { CanvasModuleMaterialization } from "../dsl/moduleMaterialization";
import type { CommandId } from "../commands/commandTypes";
import type { CanvasPresentation } from "./canvasPresentation";

export type CanvasCommitMode = "preview" | "commit";
export type { CanvasSelectionMode };

export type CanvasPickKeyboardCommandId = Extract<CommandId,
  | "selectPreviousPickCandidate"
  | "selectNextPickCandidate"
  | "selectPreviousPickOption"
  | "selectNextPickOption"
  | "applySelectedPickCandidate"
  | "cancelPointPick"
  | "cancelNumericReferencePick"
  | "cancelLinePick"
>;

export type CanvasContextMenuKind = "blank" | "element";

export type CanvasWorldPoint = { x: number; y: number };

export type CanvasPointDragAction = {
  elementId: ElementId;
  dx: number;
  dy: number;
  angleLocked: boolean;
  distanceLocked: boolean;
  commitMode: CanvasCommitMode;
  baseElements: CadElement[];
  baseEvaluation?: EvaluationResult;
};

export type CanvasBezierHandleDragAction = {
  elementId: ElementId;
  bezierHandleRole: BezierHandleRole;
  intermediatePointId?: string;
  dx: number;
  dy: number;
  angleLocked: boolean;
  distanceLocked: boolean;
  commitMode: CanvasCommitMode;
  baseElements: CadElement[];
  baseEvaluation?: EvaluationResult;
};

export type CanvasCanonicalDocumentSnapshot = {
  elements: CadElement[];
  sourceRevision: number;
  compiledDocumentRevision: number;
  sourceText: string;
  docText: string;
};

export type CanvasHostAdapter = {
  /** Effective runtime elements, including an active ephemeral preview. */
  elements: CadElement[];
  /** Canonical document elements used for document-order and drag snapshots. */
  canonicalElements: CadElement[];
  /** Runtime-only IDs are real Canvas candidates, not ephemeral creation previews. */
  runtimeElementIds?: ReadonlySet<ElementId>;
  evaluationLimitIndex: number | undefined;
  compiledDocumentRevision: number;
  canvasTheme: CanvasTheme;
  presentation?: CanvasPresentation;
  visibilityProfiles: VisibilityProfile[];
  activeVisibilityProfileId: string | null;
  moduleSemanticContext: ModuleSemanticCandidateContext;
  /** Presentation-only materialization; canonical semantic context remains root-owned. */
  canvasModuleMaterialization?: CanvasModuleMaterialization;
  measureCanvasTextWidth?: CanvasTextWidthMeasurer;
  selectedElementId: ElementId | null;
  selectedElementIds: ElementId[];
  selectionAnchorElementId?: ElementId | null;
  canvasViewport: CanvasViewport;
  showCanvasPointNames: boolean;
  showCanvasGeometryNames: boolean;
  showCanvasPoints: boolean;
  /** Whether the host wants the shared fixed Canvas controls/status chrome. */
  renderFixedCanvasChrome?: boolean;
  /** Optional host projection for the semantic context of the latest right click. */
  canvasContextMenuData?: string;
  publishCanvasContextMenu?: (context: {
    kind: CanvasContextMenuKind;
    pointer?: CanvasWorldPoint;
  }) => void;
  /** Publishes the latest finite pointer position in world millimetres. */
  publishCanvasPointerPosition?: (pointer: CanvasWorldPoint) => void;
  activePointPickTarget: ActivePointPickTarget | null;
  activeNumericReferencePickTarget: ActiveNumericReferencePickTarget | null;
  activeLinePickTarget: ActiveLinePickTarget | null;
  commandLineSession: CommandLineSession | null;

  flushSourceEditorOnCanvasPointerDown: () => "blocked-composition" | "flushed" | "clean";
  setCommandErrorMessage: (message: string) => void;
  focusSourceEditor: () => void;
  getCurrentCanonicalDocument: () => CanvasCanonicalDocumentSnapshot;
  panCanvasViewport: (dx: number, dy: number) => void;
  zoomCanvasViewportAt: (
    zoomFactor: number,
    anchor?: { x: number; y: number; width: number; height: number }
  ) => void;
  selectElement: (elementId: ElementId, selectionMode: CanvasSelectionMode, recordHistory?: boolean) => unknown;
  getCanvasSelectionSnapshot: () => SelectionSnapshot;
  previewCanvasSelection: (
    previousSelection: SelectionSnapshot,
    elementId: ElementId,
    selectionMode: CanvasSelectionMode
  ) => unknown;
  finalizeCanvasSelectionSession: (previousSelection: SelectionSnapshot) => unknown;
  commitCanvasRectangleSelection: (
    memberIds: readonly ElementId[],
    mode: CanvasRectangleSelectionUpdateMode
  ) => unknown;
  clearCanvasSelection: () => unknown;
  movePointElementByDelta: (action: CanvasPointDragAction) => unknown;
  moveBezierHandleByDelta: (action: CanvasBezierHandleDragAction) => unknown;
  applyPickedNumericReference: (numericReferenceExpression: string) => unknown;
  applyNumericExpressionReference: (action: {
    elementId: ElementId;
    parameterKey: string;
    numericExpression: string;
  }) => unknown;
  applyPickedLine: (action: {
    pickedLineId: ElementId;
    pickedLineSourceReference?: CanonicalGeometrySourceReference;
  }) => unknown;
  applyPickedPoint: (action: {
    pickedPointAnchor: PointAnchor;
    pickedPointSourceReference?: CanonicalGeometrySourceReference;
  }) => unknown;
  /** Shared Canvas keyboard boundary for the active pick scope. */
  dispatchCanvasPickCommand?: (commandId: CanvasPickKeyboardCommandId) => unknown;
  /** Optional host filter layered over the shared point-pick candidates. */
  filterPointPickCandidates?: (candidates: PickCandidate[]) => PickCandidate[];
  /** Cancels a host-owned Canvas pick flow while Canvas has focus. */
  cancelCanvasPickOperation?: () => unknown;
  toggleCanvasPointNames?: () => unknown;
  toggleCanvasGeometryNames?: () => unknown;
  toggleCanvasPoints: () => unknown;
  resolveImageSourceUrl: (sourcePath: string) => string;
  renderHostOverlay?: (viewportSize: ViewportSize) => ReactNode;
};
