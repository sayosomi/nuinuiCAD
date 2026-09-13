import type { BindingId } from "../scalars/bindingCatalog";
import type { BindingVersionId } from "../scalars/bindingVersions";
import type { BindingVersionRuntimeHistory } from "../scalars/linearMutationEvaluator";
import type { ScalarEvaluation } from "../scalars/types";
import type { ConditionEvaluationTrace } from "../scalars/conditionEvaluationTrace";
import type {
  CadElementType,
  DrawingModifierStroke,
  ElementId
} from "../model/cadDocumentTypes";
import type { GeometryValueOccurrence } from "../model/cadDocumentTypes";
import type { GeometryValueOccurrenceKey } from "../model/geometryValueOccurrence";

export type ComputedGeometryValuePoint = {
  kind: "point";
  x: number;
  y: number;
};

export type ComputedGeometryValueLine = {
  kind: "line";
  start: { x: number; y: number };
  end: { x: number; y: number };
  length: number;
  startAngleDeg: number | null;
  endAngleDeg: number | null;
  startTangentAngleDeg: number | null;
  endTangentAngleDeg: number | null;
};

export type ComputedGeometryValueArcLine = {
  kind: "arcLine";
  center: { x: number; y: number };
  start: { x: number; y: number };
  end: { x: number; y: number };
  radius: number;
  startAngleDeg: number;
  endAngleDeg: number;
  startTangentAngleDeg: number;
  endTangentAngleDeg: number;
  sweepAngleDeg: number;
  length: number;
};

export type ComputedGeometryValueBezierSegment = {
  start: { x: number; y: number };
  control1: { x: number; y: number };
  control2: { x: number; y: number };
  end: { x: number; y: number };
};

export type ComputedGeometryValueBezierCurve = {
  kind: "bezierCurve";
  segments: ComputedGeometryValueBezierSegment[];
  length: number;
};

export type ComputedGeometryValuePolylineSegment = {
  start: { x: number; y: number };
  end: { x: number; y: number };
  length: number;
};

export type ComputedGeometryValuePolyline = {
  kind: "polyline";
  segments: ComputedGeometryValuePolylineSegment[];
  closed: boolean;
  start: { x: number; y: number };
  end: { x: number; y: number };
  length: number;
  startTangentAngleDeg: number | null;
  endTangentAngleDeg: number | null;
};

export type ComputedGeometryValueOffsetLineSegment =
  | {
      kind: "line";
      start: { x: number; y: number };
      end: { x: number; y: number };
      length: number;
    }
  | {
      kind: "bezier";
      start: { x: number; y: number };
      control1: { x: number; y: number };
      control2: { x: number; y: number };
      end: { x: number; y: number };
      length: number;
    }
  | {
      kind: "arc";
      center: { x: number; y: number };
      start: { x: number; y: number };
      end: { x: number; y: number };
      radius: number;
      startAngleDeg: number;
      sweepAngleDeg: number;
      length: number;
    };

export type ComputedGeometryValueOffsetLine = {
  kind: "offsetLine";
  start: { x: number; y: number } | null;
  end: { x: number; y: number } | null;
  segments: ComputedGeometryValueOffsetLineSegment[];
  closed: boolean;
  length: number;
  startTangentAngleDeg: number | null;
  endTangentAngleDeg: number | null;
};

export type ComputedGeometryValueJoinedPath = {
  kind: "joinedPath";
  start: { x: number; y: number } | null;
  end: { x: number; y: number } | null;
  segments: ComputedGeometryValueOffsetLineSegment[];
  closed: boolean;
  length: number;
  startTangentAngleDeg: number | null;
  endTangentAngleDeg: number | null;
};

export type ComputedGeometryValue =
  | ComputedGeometryValuePoint
  | ComputedGeometryValueLine
  | ComputedGeometryValueArcLine
  | ComputedGeometryValueBezierCurve
  | ComputedGeometryValuePolyline
  | ComputedGeometryValueOffsetLine
  | ComputedGeometryValueJoinedPath;

export type ComputedGeometryValueEntry = {
  occurrence: GeometryValueOccurrence;
  value: ComputedGeometryValue;
};

export type GeometryValueEvaluationError = {
  occurrence: GeometryValueOccurrence;
  message: string;
};

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
  intermediateSlotIds: string[];
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

export type ComputedJoinedPath = {
  kind: "joinedPath";
  elementId: ElementId;
  name: string;
  pathIds: ElementId[];
  start: ComputedPoint | null;
  end: ComputedPoint | null;
  segments: ComputedOffsetLineSegment[];
  closed: boolean;
  length: number;
  startTangentAngleDeg: number | null;
  endTangentAngleDeg: number | null;
};

export type ComputedPolylineSegment = {
  kind: "line";
  start: ComputedPoint;
  end: ComputedPoint;
  length: number;
};

export type ComputedPolyline = {
  kind: "polyline";
  elementId: ElementId;
  name: string;
  segments: ComputedPolylineSegment[];
  closed: boolean;
  start: ComputedPoint;
  end: ComputedPoint;
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

export type ComputedGeometry =
  | ComputedPoint
  | ComputedLine
  | ComputedArcLine
  | ComputedBezierCurve
  | ComputedOffsetLine
  | ComputedJoinedPath
  | ComputedPolyline
  | ComputedImage
  | ComputedText;

export type InstanceBaseGeometry = {
  instanceId: ElementId;
  geometry: ComputedGeometry[];
};

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

export type ForGroupGeneratedOccurrenceStep = {
  templateForGroupId: ElementId;
  iterationIndex: number;
};

export type ForGroupGeneratedRow = {
  forGroupId: ElementId;
  templateElementId: ElementId;
  generatedElementId: ElementId;
  iterationIndex: number;
  occurrencePath: ForGroupGeneratedOccurrenceStep[];
  variableName: string;
  variableValue: number;
  elementName: string;
  elementType: CadElementType;
};

/** A successful source-semantic in-place geometry mutation, in runtime execution order. */
export type GeometryMutationExecution = {
  mutationElementId: ElementId;
  targetElementIds: ElementId[];
};

export type EvaluationResult = {
  computedGeometry: Map<ElementId, ComputedGeometry>;
  /** Immutable snapshots keyed by runtime owner and recipe stage path. */
  transformationStageGeometry?: Map<string, ComputedGeometry>;
  /** Immutable construction results, deliberately separate from drawable geometry. */
  computedGeometryValues?: Map<GeometryValueOccurrenceKey, ComputedGeometryValueEntry>;
  /** Runtime failures owned by immutable geometry-value occurrences, never drawable elements. */
  geometryValueErrors?: GeometryValueEvaluationError[];
  /** Every successfully evaluated declaration, captured before later mutations. */
  preMutationGeometry?: Map<ElementId, ComputedGeometry>;
  /** Successful in-place geometry mutations, preserving actual runtime execution order. */
  geometryMutationExecutions?: GeometryMutationExecution[];
  /** Concrete module-instance geometry captured at materialization end. */
  instanceBaseGeometry?: Map<ElementId, ComputedGeometry[]>;
  errors: DependencyError[];
  warnings: EvaluationWarning[];
  evaluatedElementIds?: Set<ElementId>;
  evaluationLimitIndex?: number;
  effectiveVisibleElementIds?: Set<ElementId>;
  effectiveEnabledElementIds?: Set<ElementId>;
  /** Explicitly resolved drawing style strokes, keyed by runtime element id. */
  effectiveDrawingModifierStrokes?: Map<ElementId, DrawingModifierStroke>;
  conditionInactiveElementIds?: Set<ElementId>;
  /** Exact reached-node trace for each typed conditionalGroup evaluated in this runtime revision. */
  conditionEvaluationTraces?: ReadonlyMap<ElementId, ConditionEvaluationTrace>;
  forGroupGeneratedRows?: ForGroupGeneratedRow[];
  /**
   * Task 25: `forGroup` element ids whose generated-result presentation is
   * currently enabled (the literal `showGenerated` value, || the resolved
   * typed boolean binding when bound). Never affects iteration count/rows -
   * `forGroupGeneratedRows` above is always fully populated regardless of
   * membership here. Consulted only by presentation surfaces such as the
   * Source Editor's generated-rows widget.
   */
  forGroupEffectiveShowGeneratedIds?: Set<ElementId>;
  /**
   * Task 20: version-0 TS reference evaluation of the compiled scalar
   * program's const/let declarations, keyed by BindingId. Present only when the source document had a non-empty
   * `EvaluateElementsOptions.scalarProgram` && only on the TS reference
   * evaluation path (`evaluateElementsWithRust` does not run `evaluateElements`'s loop at all, so Rust output has no equivalent field
   * until Task 21).
   */
  computedScalarBindings?: ReadonlyMap<BindingId, ScalarEvaluation>;
  /** Task 31: TS-only per-version history, present only for linear-set documents. */
  computedScalarBindingVersions?: ReadonlyMap<BindingVersionId, BindingVersionRuntimeHistory>;
};
