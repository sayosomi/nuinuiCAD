import type { BindingId } from "../scalars/bindingCatalog";
import type { ScalarEvaluation } from "../scalars/types";

export type ElementId = string;

export type CadElementBase = {
  id: ElementId;
  name: string;
  /** Legacy v2 DSL / IPC activity flags. Runtime policy lives in elementActivity.ts. */
  visible: boolean;
  enabled: boolean;
  colorId?: string;
  parentGroupId?: ElementId;
  conditionalBranch?: ConditionalBranch;
  numericVariables?: NumericVariable[];
  numericParameterSteps?: Partial<Record<string, number>>;
};

export type PaletteColor = {
  id: string;
  name: string;
  hex: string;
};

export type DocumentPalette = {
  colors: PaletteColor[];
  defaultColorId: string;
};

export type VisibilityRole = {
  id: string;
  name: string;
};

export type VisibilityProfile = {
  id: string;
  name: string;
  defaultRoleVisible: boolean;
  roleVisibility: Record<string, boolean>;
};

export type PaperSizeId = "a4" | "a3" | "b5" | "b4" | "letter" | "legal";

export type PrintLayoutOutputKind = "pdf" | "svg";

export type PrintLayoutPlacement = {
  id: string;
  groupId: ElementId;
  x: NumericValue;
  y: NumericValue;
  angleDeg: NumericValue;
  mirrorX: boolean;
};

export type PrintLayout = {
  id: string;
  name: string;
  outputKind: PrintLayoutOutputKind;
  visibilityProfileId?: string;
  paperSizeId: PaperSizeId;
  orientation: "portrait" | "landscape";
  columns: NumericValue;
  rows: NumericValue;
  overlapMm: NumericValue;
  scale: NumericValue;
  svgCanvasWidthMm: NumericValue;
  svgCanvasHeightMm: NumericValue;
  numericVariables?: NumericVariable[];
  placements: PrintLayoutPlacement[];
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

export type DivisionPlacement =
  | { kind: "distance"; value: NumericValue }
  | { kind: "ratio"; value: NumericValue };

export type DivisionPointElement = CadElementBase & {
  type: "divisionPoint";
  startPoint: PointAnchor;
  endPoint: PointAnchor;
  placement: DivisionPlacement;
};

export type LineEndpointReference = {
  lineId: ElementId;
  endpointKey: "start" | "end";
};

export type LineDivisionPointElement = CadElementBase & {
  type: "lineDivisionPoint";
  endpoint: LineEndpointReference;
  placement: DivisionPlacement;
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

export type AngleLengthLineElement = CadElementBase & {
  type: "angleLengthLine";
  startPoint: PointAnchor;
  angleDeg: NumericValue;
  length: NumericValue;
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
  suppressTrimWarnings?: boolean;
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
  scale: NumericValue;
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
  scale: NumericValue;
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

export type ImageElement = CadElementBase & {
  type: "image";
  sourcePath: string;
  originPoint: PointAnchor;
  naturalWidthPx: number;
  naturalHeightPx: number;
  sourceDpi: number;
  targetPixelsPerMm: number;
  scale: NumericValue;
  angleDeg: NumericValue;
  mirrorX: boolean;
};

export type TextElement = CadElementBase & {
  type: "text";
  text: string;
  anchor: PointAnchor | null;
  fontSize: NumericValue;
};

export type GroupElement = CadElementBase & {
  type: "group";
  printEnabled?: boolean;
  printAnchor?: PointAnchor;
  visibilityRoleIds?: string[];
};

export type ConditionalGroupElement = CadElementBase & {
  type: "conditionalGroup";
  condition: NumericValue;
};

export type ForGroupElement = CadElementBase & {
  type: "forGroup";
  variableName: string;
  start: NumericValue;
  count: NumericValue;
  step: NumericValue;
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
  | AngleLengthLineElement
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
  | SymmetricMoveElement
  | ImageElement
  | TextElement;
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

export type ComputedImage = {
  kind: "image";
  elementId: ElementId;
  name: string;
  sourcePath: string;
  origin: ComputedPoint;
  naturalWidthPx: number;
  naturalHeightPx: number;
  sourceDpi: number;
  targetPixelsPerMm: number;
  scale: number;
  angleDeg: number;
  mirrorX: boolean;
  widthMm: number;
  heightMm: number;
};

export type ComputedText = {
  kind: "text";
  elementId: ElementId;
  name: string;
  text: string;
  anchor: ComputedPoint | null;
  fontSize: number;
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
  | ComputedOffsetLine
  | ComputedImage
  | ComputedText;

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
  /**
   * Task 20: version-0 TS reference evaluation of the compiled scalar
   * program's const/let declarations, keyed by BindingId - a separate map
   * from `computedVariables` (legacy numeric variables), never merged with
   * it. Present only when the source document had a non-empty
   * `EvaluateElementsOptions.scalarProgram` and only on the TS reference
   * evaluation path (`evaluateElementsWithRust` does not run
   * `evaluateElements`'s loop at all, so Rust output has no equivalent field
   * until Task 21).
   */
  computedScalarBindings?: ReadonlyMap<BindingId, ScalarEvaluation>;
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
  angleLengthLine: "角度距離線",
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
  symmetricMove: "対称移動",
  image: "画像",
  text: "テキスト"
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
  angleLengthLine: "line",
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
  symmetricMove: "modification",
  image: "modification",
  text: "modification"
};

export const elementCategoryLabels: Record<CadElementCategory, string> = {
  group: "グループ",
  point: "点",
  line: "線",
  modification: "変更"
};
