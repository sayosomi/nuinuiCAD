import type { BezierHandleRole as CommandBezierHandleRole } from "../commands/commands";
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
import type { LineMeasurementCandidate, ScreenPoint } from "./DrawingCanvasHitTest";

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
  sourceReference?: string;
};

export type PointPickCandidateMenu = {
  screen: ScreenPoint;
  candidates: PointPickCandidate[];
};

export type LinePickCandidate = {
  line: ComputedLine | ComputedArcLine | ComputedBezierCurve | ComputedOffsetLine;
  sourceReference?: string;
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
  overlayPointPickCandidates: PointPickCandidate[];
  overlayNumericReferenceCandidates: CanvasNumericReferenceCandidate[];
  selectedBezierHandles: BezierHandleOverlay[];
};
