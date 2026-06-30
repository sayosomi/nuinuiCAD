export type ElementId = string;

export type CadElementBase = {
  id: ElementId;
  name: string;
  visible: boolean;
  enabled: boolean;
  parentGroupId?: ElementId;
  conditionalBranch?: ConditionalBranch;
  numericVariables?: NumericVariable[];
  numericParameterSteps?: Partial<Record<string, number>>;
};

export type NumericExpression = {
  kind: "expression";
  expression: string;
};

export type NumericValue = number | NumericExpression;

export type ConditionalBranch = "then" | "else";

export type NumericVariable = {
  id: string;
  name: string;
  value: NumericValue;
};

export type BezierNumericVariable = NumericVariable;

export type VariableScope = "global" | "group";

export type VariableValueMode =
  | "expression"
  | "pointDistance"
  | "pointAngle"
  | "pointLineDistance";

export type VariableElement = CadElementBase & {
  type: "variable";
  scope: VariableScope;
  valueMode: VariableValueMode;
  expression: NumericValue;
  point1: PointAnchor;
  point2: PointAnchor;
  point: PointAnchor;
  lineId: ElementId;
};

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

export type CornerRadiusArcLineElement = CadElementBase & {
  type: "cornerRadiusArcLine";
  endpoint1: LineEndpointReference;
  endpoint2: LineEndpointReference;
  radius: NumericValue;
  intersectionIndex: NumericValue;
};

export type EdgeElement = CadElementBase & {
  type: "edge";
  endpoint1: LineEndpointReference;
  endpoint2: LineEndpointReference;
  intersectionIndex: NumericValue;
};

export type ExtendTrimElement = CadElementBase & {
  type: "extendTrim";
  endpoint: LineEndpointReference;
  point: PointAnchor;
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

export type SplitLineElement = CadElementBase & {
  type: "splitLine";
  baseLineId: ElementId;
  splitPoint: PointAnchor;
};

export type CopyLineElement = CadElementBase & {
  type: "copyLine";
  startPoint: PointAnchor;
  endPoint: PointAnchor;
  angleDeg: NumericValue;
  mirrorX: boolean;
  baseLineIds: ElementId[];
};

export type SymmetricCopyLineElement = CadElementBase & {
  type: "symmetricCopyLine";
  axisPoint1: PointAnchor;
  axisPoint2: PointAnchor;
  baseLineIds: ElementId[];
};

export type MoveElement = CadElementBase & {
  type: "move";
  startPoint: PointAnchor;
  endPoint: PointAnchor;
  angleDeg: NumericValue;
  mirrorX: boolean;
  baseLineIds: ElementId[];
};

export type SymmetricMoveElement = CadElementBase & {
  type: "symmetricMove";
  axisPoint1: PointAnchor;
  axisPoint2: PointAnchor;
  baseLineIds: ElementId[];
};

export type GroupElement = CadElementBase & {
  type: "group";
  expanded: boolean;
};

export type ConditionalGroupElement = CadElementBase & {
  type: "conditionalGroup";
  condition: NumericValue;
  expanded: boolean;
  elseExpanded: boolean;
};

export type ForGroupElement = CadElementBase & {
  type: "forGroup";
  variableName: string;
  start: NumericValue;
  count: NumericValue;
  step: NumericValue;
  expanded: boolean;
  showGenerated: boolean;
};

export type CadElement =
  | GroupElement
  | ConditionalGroupElement
  | ForGroupElement
  | VariableElement
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
  | CornerRadiusArcLineElement
  | EdgeElement
  | ExtendTrimElement
  | BezierCurveElement
  | OffsetLineElement
  | SplitLineElement
  | CopyLineElement
  | SymmetricCopyLineElement
  | MoveElement
  | SymmetricMoveElement;
export type CadElementType = CadElement["type"];
export type CadElementCategory = "group" | "point" | "line" | "modification";

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
  startTangentAngleDeg: number | null;
  endTangentAngleDeg: number | null;
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
  startTangentAngleDeg: number;
  endTangentAngleDeg: number;
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
  startTangentAngleDeg: number | null;
  endTangentAngleDeg: number | null;
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
  start: ComputedPoint | null;
  end: ComputedPoint | null;
  segments: ComputedOffsetLineSegment[];
  closed: boolean;
  length: number;
  startTangentAngleDeg: number | null;
  endTangentAngleDeg: number | null;
};

export type ComputedVariable = {
  kind: "variable";
  elementId: ElementId;
  name: string;
  value: number;
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

export type ForGroupGeneratedRow = {
  forGroupId: ElementId;
  templateElementId: ElementId;
  generatedElementId: ElementId;
  iterationIndex: number;
  variableName: string;
  variableValue: number;
  elementName: string;
  elementType: CadElementType;
};

export type EvaluationResult = {
  computedGeometry: Map<ElementId, ComputedGeometry>;
  computedVariables: Map<ElementId, ComputedVariable>;
  errors: DependencyError[];
  warnings: EvaluationWarning[];
  evaluatedElementIds?: Set<ElementId>;
  evaluationLimitIndex?: number;
  effectiveVisibleElementIds?: Set<ElementId>;
  effectiveEnabledElementIds?: Set<ElementId>;
  conditionInactiveElementIds?: Set<ElementId>;
  forGroupGeneratedRows?: ForGroupGeneratedRow[];
};

export const elementTypeLabels: Record<CadElementType, string> = {
  group: "グループ",
  conditionalGroup: "ifブロック",
  forGroup: "forブロック",
  variable: "変数",
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
  cornerRadiusArcLine: "角R円弧線",
  edge: "エッジ",
  extendTrim: "延長短縮",
  bezierCurve: "Bezier curve",
  offsetLine: "オフセット線",
  splitLine: "分割線",
  copyLine: "コピー線",
  symmetricCopyLine: "対称コピー線",
  move: "移動",
  symmetricMove: "対称移動"
};

export const elementTypeCategories: Record<CadElementType, CadElementCategory> = {
  group: "group",
  conditionalGroup: "group",
  forGroup: "group",
  variable: "modification",
  freePoint: "point",
  offsetPoint: "point",
  polarOffsetPoint: "point",
  divisionPoint: "point",
  lineDivisionPoint: "point",
  intersectionPoint: "point",
  lineTangentOffsetPoint: "point",
  line: "line",
  arcLine: "line",
  threePointArcLine: "line",
  cornerRadiusArcLine: "line",
  edge: "modification",
  extendTrim: "modification",
  bezierCurve: "line",
  offsetLine: "line",
  splitLine: "line",
  copyLine: "line",
  symmetricCopyLine: "line",
  move: "modification",
  symmetricMove: "modification"
};

export const elementCategoryLabels: Record<CadElementCategory, string> = {
  group: "グループ",
  point: "点",
  line: "線",
  modification: "変更"
};
