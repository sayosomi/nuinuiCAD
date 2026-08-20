import type { BezierHandleRole as CommandBezierHandleRole } from "../commands/commands";
import type { CanvasSelectionMode } from "../commands/selectionCommands";
import type { CanonicalGeometrySourceReference } from "../model/moduleSemanticCandidateBoundary";
import type { ParameterKey } from "../parameters/parameterDefinitions";
import type {
  ComputedArcLine,
  ComputedBezierCurve,
  ComputedImage,
  ComputedLine,
  ComputedOffsetLine,
  ComputedPoint,
  ComputedText,
  ElementId,
  PointAnchor
} from "../types/geometry";
import type { SelectionSnapshot } from "../state/cadDocumentStore";
import type { LineMeasurementCandidate, ScreenPoint } from "./DrawingCanvasHitTest";
import type { CanvasIdentityKind } from "./canvasDrawOrder";

export type CanvasOverlayLine = {
  line: ComputedLine;
  start: ScreenPoint;
  end: ScreenPoint;
};

export type CanvasOverlayArc = {
  arc: ComputedArcLine;
  start: ScreenPoint;
  end: ScreenPoint;
  points: ScreenPoint[];
};

export type CanvasOverlayCurve = {
  curve: ComputedBezierCurve;
  points: ScreenPoint[];
};

export type BezierEditingHelperOverlay = {
  curve: ComputedBezierCurve;
  points: ScreenPoint[];
};

export type CanvasOverlayOffsetLine = {
  line: ComputedOffsetLine;
  points: ScreenPoint[];
};

export type CanvasOverlayPoint = {
  point: ComputedPoint;
  screen: ScreenPoint;
};

export type CanvasOverlayImage = {
  image: ComputedImage;
  sourceUrl: string;
  corners: ScreenPoint[];
};

export type CanvasOverlayText = {
  text: ComputedText;
  screen: ScreenPoint;
  fontSizePx: number;
};

export type CanvasIdentityCandidate = {
  elementId: ElementId;
  name: string | null;
  kind: CanvasIdentityKind;
  representativeScreen: ScreenPoint;
};

export type CanvasOverlapCandidateSession = {
  anchor: ScreenPoint;
  candidates: CanvasIdentityCandidate[];
  activeIndex: number;
  selectionMode: CanvasSelectionMode;
  selectionBefore: SelectionSnapshot;
};

export type CanvasHoverIdentityState = {
  pointer: ScreenPoint;
  candidates: CanvasIdentityCandidate[];
} | null;

export type CanvasHoverIdentityPopup = {
  pointer: ScreenPoint;
  candidates: CanvasIdentityCandidate[];
};

export type CanvasNumericReferenceCandidate = {
  line: ComputedLine | ComputedArcLine | ComputedBezierCurve | ComputedOffsetLine;
  start?: ScreenPoint;
  end?: ScreenPoint;
  points?: ScreenPoint[];
};

export type MeasurementCandidateMenu = {
  screen: ScreenPoint;
  candidates: LineMeasurementCandidate[];
  targetElementId: ElementId;
  targetParameterKey: ParameterKey;
};

export type PointPickCandidate = {
  anchor: PointAnchor;
  label: string;
  screen: ScreenPoint;
  sourceReference?: CanonicalGeometrySourceReference;
};

export type PointPickCandidateMenu = {
  screen: ScreenPoint;
  candidates: PointPickCandidate[];
};

export type LinePickCandidate = {
  line: ComputedLine | ComputedArcLine | ComputedBezierCurve | ComputedOffsetLine;
  sourceReference?: CanonicalGeometrySourceReference;
};

export type LinePickCandidateMenu = {
  screen: ScreenPoint;
  candidates: LinePickCandidate[];
};

export type BezierHandleOverlay = {
  id: string;
  curveId: ElementId;
  role: CommandBezierHandleRole;
  intermediatePointId?: string;
  anchor: ScreenPoint;
  control: ScreenPoint;
};

export type CanvasOverlayData = {
  lines: ComputedLine[];
  arcs: ComputedArcLine[];
  curves: ComputedBezierCurve[];
  offsetLines: ComputedOffsetLine[];
  images: ComputedImage[];
  texts: ComputedText[];
  points: ComputedPoint[];
  visibleElementIds: Set<ElementId>;
  overlayLines: CanvasOverlayLine[];
  overlayPoints: CanvasOverlayPoint[];
  overlayArcs: CanvasOverlayArc[];
  overlayCurves: CanvasOverlayCurve[];
  overlayOffsetLines: CanvasOverlayOffsetLine[];
  overlayImages: CanvasOverlayImage[];
  overlayTexts: CanvasOverlayText[];
  overlayIdentityCandidates: CanvasIdentityCandidate[];
  selectedBezierEditingHelper: BezierEditingHelperOverlay | null;
  overlayPointPickCandidates: PointPickCandidate[];
  overlayNumericReferenceCandidates: CanvasNumericReferenceCandidate[];
  selectedBezierHandles: BezierHandleOverlay[];
};
