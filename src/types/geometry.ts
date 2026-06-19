export type ElementId = string;

export type CadElementBase = {
  id: ElementId;
  name: string;
  visible: boolean;
  enabled: boolean;
  numericParameterSteps?: Partial<Record<string, number>>;
};

export type NumericExpression = {
  kind: "expression";
  expression: string;
};

export type NumericValue = number | NumericExpression;

export type FreePointElement = CadElementBase & {
  type: "freePoint";
  x: NumericValue;
  y: NumericValue;
};

export type OffsetPointElement = CadElementBase & {
  type: "offsetPoint";
  fromPointId: ElementId;
  dx: NumericValue;
  dy: NumericValue;
};

export type PolarOffsetPointElement = CadElementBase & {
  type: "polarOffsetPoint";
  fromPointId: ElementId;
  angleDeg: NumericValue;
  distance: NumericValue;
};

export type LineElement = CadElementBase & {
  type: "line";
  startPointId: ElementId;
  endPointId: ElementId;
};

export type BezierIntermediatePoint = {
  id: string;
  pointId: ElementId;
  handleAngleDeg: NumericValue;
  incomingHandleLength: NumericValue;
  outgoingHandleLength: NumericValue;
};

export type BezierNumericVariable = {
  id: string;
  name: string;
  value: NumericValue;
};

export type BezierCurveElement = CadElementBase & {
  type: "bezierCurve";
  numericVariables?: BezierNumericVariable[];
  startPointId: ElementId;
  startHandleAngleDeg: NumericValue;
  startHandleLength: NumericValue;
  intermediatePoints: BezierIntermediatePoint[];
  endPointId: ElementId;
  endHandleAngleDeg: NumericValue;
  endHandleLength: NumericValue;
};

export type CadElement =
  | FreePointElement
  | OffsetPointElement
  | PolarOffsetPointElement
  | LineElement
  | BezierCurveElement;
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
  startPointId: ElementId;
  endPointId: ElementId;
  start: ComputedPoint;
  end: ComputedPoint;
  length: number;
  startAngleDeg: number | null;
  endAngleDeg: number | null;
};

export type ComputedBezierSegment = {
  startPointId: ElementId;
  endPointId: ElementId;
  start: ComputedPoint;
  control1: { x: number; y: number };
  control2: { x: number; y: number };
  end: ComputedPoint;
};

export type ComputedBezierCurve = {
  kind: "bezierCurve";
  elementId: ElementId;
  name: string;
  startPointId: ElementId;
  endPointId: ElementId;
  intermediatePointIds: ElementId[];
  segments: ComputedBezierSegment[];
  length: number;
  startHandleAngleDeg: number;
  startHandleLength: number;
  endHandleAngleDeg: number;
  endHandleLength: number;
};

export type ComputedGeometry = ComputedPoint | ComputedLine | ComputedBezierCurve;

export type DependencyError = {
  elementId: ElementId;
  elementName: string;
  missingDependencyId: ElementId;
  missingDependencyName?: string;
  message: string;
};

export type EvaluationResult = {
  computedGeometry: Map<ElementId, ComputedGeometry>;
  errors: DependencyError[];
};

export const elementTypeLabels: Record<CadElementType, string> = {
  freePoint: "free point",
  offsetPoint: "offset point",
  polarOffsetPoint: "polar offset point",
  line: "line",
  bezierCurve: "Bezier curve"
};
