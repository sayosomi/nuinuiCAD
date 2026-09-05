export type ElementId = string;

export type DrawingModifierState = "visible" | "hidden" | "disabled";

export type DrawingModifierStrokeStyle = "solid" | "dashed" | "dotted";

export type DrawingModifierThemeRole =
  | "foreground"
  | "muted"
  | "accent"
  | "info"
  | "warning"
  | "error";

export type DrawingModifierStrokeColor =
  | { kind: "themeRole"; role: DrawingModifierThemeRole }
  | { kind: "fixed"; hex: string };

export type DrawingModifierStroke = {
  widthPx: number;
  style: DrawingModifierStrokeStyle;
  color: DrawingModifierStrokeColor;
};

export type DrawingProfile = {
  /** Compiler/reconciler-owned identity for a top-level `profile` declaration. */
  id: string;
  name: string;
};

export type DrawingModifierProperties = {
  state?: DrawingModifierState;
  widthPx?: number;
  style?: DrawingModifierStrokeStyle;
  color?: DrawingModifierStrokeColor;
};

export type DrawingModifierProfileDelta = DrawingModifierProperties & {
  /** Resolved identity of the referenced top-level Drawing Profile. */
  profileId: string;
  /** Source name retained for canonical serialization and editor presentation. */
  profileName: string;
};

export type DrawingModifierDefinition = {
  name: string;
} & DrawingModifierProperties & {
  profileDeltas?: DrawingModifierProfileDelta[];
};

export type CadElementBase = {
  id: ElementId;
  name: string;
  activity: "visible" | "hidden" | "disabled";
  /** Source-owned, ordered references to document-level drawing modifiers. */
  modifierNames?: string[];
  parentGroupId?: ElementId;
  conditionalBranch?: ConditionalBranch;
  numericParameterSteps?: Partial<Record<string, number>>;
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

export type NumericExpression = {
  kind: "expression";
  expression: string;
};

export type NumericValue = number | NumericExpression;

export type PrintPaperSizeId = "a4" | "a3";

export type LayoutOrigin =
  | { kind: "localOrigin" }
  | { kind: "point"; pointId: ElementId };

export type LayoutPlacement = {
  /** Reconciler-owned identity of the source `place` statement. */
  id: string;
  groupId: ElementId;
  origin: LayoutOrigin;
  at: { x: NumericValue; y: NumericValue };
  scale?: NumericValue;
  angleDeg: NumericValue;
  mirror: boolean;
};

export type Layout = {
  /** Reconciler-owned identity of the source `layout` declaration. */
  id: string;
  name: string;
  scale: NumericValue;
  placements: LayoutPlacement[];
};

export type PrintOutput = {
  /** Reconciler-owned identity of the source `print` declaration. */
  id: string;
  name: string;
  layoutId: string;
  profileId?: string;
  paper: PrintPaperSizeId;
  orientation: "portrait" | "landscape";
  overlap: NumericValue;
};

export type SvgOutput = {
  /** Reconciler-owned identity of the source `svg` declaration. */
  id: string;
  name: string;
  layoutId: string;
  profileId?: string;
  margin: NumericValue;
};

export type ConditionalBranch = "then" | "else";

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
  curveSide?: "convex" | "concave";
  distance: NumericValue;
};

export type BezierExtremePointElement = CadElementBase & {
  type: "bezierExtremePoint";
  baseLineId: ElementId;
  segmentIndex: NumericValue;
  directionDeg: NumericValue;
};

export type BezierBulgePointElement = CadElementBase & {
  type: "bezierBulgePoint";
  baseLineId: ElementId;
  segmentIndex: NumericValue;
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

export type PolylineElement = CadElementBase & {
  type: "polyline";
  points: PointAnchor[];
  closed: boolean;
};

export type AngleLengthLineElement = CadElementBase & {
  type: "angleLengthLine";
  startPoint: PointAnchor;
  angleDeg: NumericValue;
  length: NumericValue;
};

export type CommonTangentLineKind = "external" | "internal";
export type CommonTangentLineSide = "left" | "right";

export type CommonTangentLineElement = CadElementBase & {
  type: "commonTangentLine";
  firstLineId: ElementId;
  secondLineId: ElementId;
  kind: CommonTangentLineKind;
  side: CommonTangentLineSide;
};

export type ArcDirection = "counterclockwise" | "clockwise";

export type ArcLineElement = CadElementBase & {
  type: "arcLine";
  centerPoint: PointAnchor;
  radius: NumericValue;
  startAngleDeg: NumericValue;
  endAngleDeg: NumericValue;
  direction?: ArcDirection;
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

/** Reverses the traversal direction of an already-evaluated line-like
 * element in place; produces no geometry under its own id. */
export type PathReverseElement = CadElementBase & {
  type: "pathReverse";
  targetLineId: ElementId;
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

export type ModuleInstanceElement = CadElementBase & {
  type: "moduleInstance";
};

export type CadElement =
  | GroupElement
  | ConditionalGroupElement
  | ForGroupElement
  | ModuleInstanceElement
  | FreePointElement
  | OffsetPointElement
  | PolarOffsetPointElement
  | DivisionPointElement
  | LineDivisionPointElement
  | IntersectionPointElement
  | LineTangentOffsetPointElement
  | BezierExtremePointElement
  | BezierBulgePointElement
  | LineElement
  | PolylineElement
  | AngleLengthLineElement
  | CommonTangentLineElement
  | ArcLineElement
  | ThreePointArcLineElement
  | CornerRadiusArcLineElement
  | EdgeElement
  | ExtendTrimElement
  | PathReverseElement
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

/** Runtime-only elements do not have a nui 1 source construction yet. */
export const runtimeOnlyElementTypes = new Set<CadElementType>(["moduleInstance"]);
