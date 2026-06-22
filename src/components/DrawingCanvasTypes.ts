import type { BezierHandleRole as CommandBezierHandleRole } from "../commands/commands";
import type { ParameterKey } from "../parameters/parameterDefinitions";
import type {
  ComputedArcLine,
  ComputedBezierCurve,
  ComputedLine,
  ComputedOffsetLine,
  ComputedPoint,
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
};

export type PointPickCandidateMenu = {
  screen: ScreenPoint;
  candidates: PointPickCandidate[];
};

export type LinePickCandidate = {
  line: ComputedLine | ComputedArcLine | ComputedBezierCurve | ComputedOffsetLine;
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
