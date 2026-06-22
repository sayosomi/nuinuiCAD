export type ElementId = string;

export type CadElementBase = {
  id: ElementId;
  name: string;
  visible: boolean;
  enabled: boolean;
  parentGroupId?: ElementId;
  numericVariables?: NumericVariable[];
  numericParameterSteps?: Partial<Record<string, number>>;
};

export type NumericExpression = {
  kind: "expression";
  expression: string;
};

export type NumericValue = number | NumericExpression;

export type NumericVariable = {
  id: string;
  name: string;
  value: NumericValue;
};

export type BezierNumericVariable = NumericVariable;

export type FreePointElement = CadElementBase & {
  type: "freePoint";
  x: NumericValue;
  y: NumericValue;
};

export type OffsetPointElement = CadElementBase & {
  type: "offsetPoint";
  fromPoint?: PointAnchor;
  fromPointId?: ElementId;
  dx: NumericValue;
  dy: NumericValue;
};

export type PolarOffsetPointElement = CadElementBase & {
  type: "polarOffsetPoint";
  fromPoint?: PointAnchor;
  fromPointId?: ElementId;
  angleDeg: NumericValue;
  distance: NumericValue;
};

export type DivisionPointMode = "distance" | "ratio";

export type DivisionPointElement = CadElementBase & {
  type: "divisionPoint";
  startPoint: PointAnchor;
  endPoint: PointAnchor;
  placementMode: DivisionPointMode;
  distance: NumericValue;
  ratio: NumericValue;
};

export type LineEndpointReference = {
  lineId: ElementId;
  endpointKey: "start" | "end";
};

export type LineDivisionPointElement = CadElementBase & {
  type: "lineDivisionPoint";
  endpoint: LineEndpointReference;
  placementMode: DivisionPointMode;
  distance: NumericValue;
  ratio: NumericValue;
};

export type IntersectionPointElement = CadElementBase & {
  type: "intersectionPoint";
  line1Id: ElementId;
  line2Id: ElementId;
  intersectionIndex: NumericValue;
  useExtensions: boolean;
};

export type LineTangentOffsetPointElement = CadElementBase & {
  type: "lineTangentOffsetPoint";
  baseLineId: ElementId;
  basePoint: PointAnchor;
  tangentAngleDeg: NumericValue;
  distance: NumericValue;
};

export type PointAnchor =
  | {
      mode: "reference";
      pointId: ElementId;
    }
  | {
      mode: "derived";
      elementId: ElementId;
      pointKey: string;
    }
  | {
      mode: "coordinate";
      x: NumericValue;
      y: NumericValue;
    };

export type LineElement = CadElementBase & {
  type: "line";
  startPoint: PointAnchor;
  endPoint: PointAnchor;
};

export type ArcLineElement = CadElementBase & {
  type: "arcLine";
  centerPoint: PointAnchor;
  radius: NumericValue;
  startAngleDeg: NumericValue;
  endAngleDeg: NumericValue;
};

export type ThreePointArcLineElement = CadElementBase & {
  type: "threePointArcLine";
  point1: PointAnchor;
  point2: PointAnchor;
  point3: PointAnchor;
  startAngleDeg: NumericValue;
  endAngleDeg: NumericValue;
};

export type BezierIntermediatePoint = {
  id: string;
  point: PointAnchor;
  handleAngleDeg: NumericValue;
  incomingHandleLength: NumericValue;
  outgoingHandleLength: NumericValue;
};

export type BezierCurveElement = CadElementBase & {
  type: "bezierCurve";
  startPoint: PointAnchor;
  startHandleAngleDeg: NumericValue;
  startHandleLength: NumericValue;
  intermediatePoints: BezierIntermediatePoint[];
  endPoint: PointAnchor;
  endHandleAngleDeg: NumericValue;
  endHandleLength: NumericValue;
};

export type OffsetLineSide = "right" | "left";

export type OffsetLineElement = CadElementBase & {
  type: "offsetLine";
  baseLineIds: ElementId[];
  offset: NumericValue;
  side: OffsetLineSide;
  closed: boolean;
};

export type GroupElement = CadElementBase & {
  type: "group";
  expanded: boolean;
};

export type CadElement =
  | GroupElement
  | FreePointElement
  | OffsetPointElement
  | PolarOffsetPointElement
  | DivisionPointElement
  | LineDivisionPointElement
  | IntersectionPointElement
  | LineTangentOffsetPointElement
  | LineElement
  | ArcLineElement
  | ThreePointArcLineElement
  | BezierCurveElement
  | OffsetLineElement;
export type CadElementType = CadElement["type"];

export type ComputedPoint = {
  kind: "point";
  elementId: ElementId;
  name: string;
  x: number;
  y: number;
};

export type ComputedLine = {
  kind: "line";
  elementId: ElementId;
  name: string;
  startPointId: ElementId | null;
  endPointId: ElementId | null;
  start: ComputedPoint;
  end: ComputedPoint;
  length: number;
  startAngleDeg: number | null;
  endAngleDeg: number | null;
};

export type ComputedArcLine = {
  kind: "arcLine";
  elementId: ElementId;
  name: string;
  centerPointId: ElementId | null;
  center: ComputedPoint;
  start: ComputedPoint;
  end: ComputedPoint;
  radius: number;
  startAngleDeg: number;
  endAngleDeg: number;
  sweepAngleDeg: number;
  length: number;
};

export type ComputedBezierSegment = {
  startPointId: ElementId | null;
  endPointId: ElementId | null;
  start: ComputedPoint;
  control1: { x: number; y: number };
  control2: { x: number; y: number };
  end: ComputedPoint;
};

export type ComputedBezierCurve = {
  kind: "bezierCurve";
  elementId: ElementId;
  name: string;
  startPointId: ElementId | null;
  endPointId: ElementId | null;
  intermediatePointIds: ElementId[];
  segments: ComputedBezierSegment[];
  length: number;
  startHandleAngleDeg: number;
  startHandleLength: number;
  endHandleAngleDeg: number;
  endHandleLength: number;
};

export type ComputedOffsetLineSegment =
  | {
      kind: "line";
      start: ComputedPoint;
      end: ComputedPoint;
      length: number;
    }
  | {
      kind: "bezier";
      start: ComputedPoint;
      control1: { x: number; y: number };
      control2: { x: number; y: number };
      end: ComputedPoint;
      length: number;
    }
  | {
      kind: "arc";
      center: ComputedPoint;
      start: ComputedPoint;
      end: ComputedPoint;
      radius: number;
      startAngleDeg: number;
      sweepAngleDeg: number;
      length: number;
    };

export type ComputedOffsetLine = {
  kind: "offsetLine";
  elementId: ElementId;
  name: string;
  baseLineIds: ElementId[];
  segments: ComputedOffsetLineSegment[];
  closed: boolean;
  length: number;
};

export type ComputedGeometry =
  | ComputedPoint
  | ComputedLine
  | ComputedArcLine
  | ComputedBezierCurve
  | ComputedOffsetLine;

export type DependencyError = {
  elementId: ElementId;
  elementName: string;
  missingDependencyId: ElementId;
  missingDependencyName?: string;
  message: string;
};

export type EvaluationWarning = {
  elementId: ElementId;
  elementName: string;
  message: string;
};

export type EvaluationResult = {
  computedGeometry: Map<ElementId, ComputedGeometry>;
  errors: DependencyError[];
  warnings: EvaluationWarning[];
  effectiveVisibleElementIds?: Set<ElementId>;
  effectiveEnabledElementIds?: Set<ElementId>;
};

export const elementTypeLabels: Record<CadElementType, string> = {
  group: "グループ",
  freePoint: "free point",
  offsetPoint: "offset point",
  polarOffsetPoint: "polar offset point",
  divisionPoint: "点間分点",
  lineDivisionPoint: "線上分点",
  intersectionPoint: "交点",
  lineTangentOffsetPoint: "線上オフセット点",
  line: "line",
  arcLine: "arc line",
  threePointArcLine: "three-point arc line",
  bezierCurve: "Bezier curve",
  offsetLine: "オフセット線"
};
