import type { LastGoodDslDocument } from "../document/canonicalDocument";
import { propertyBindingOccurrenceKey } from "../scalars/propertyBindingCompiler";
import { evaluateTypedExpression } from "../scalars/expressionEvaluator";
import type { ScalarEvaluation } from "../scalars/types";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import { evaluateElementsReference } from "../geometry/evaluationEngine";
import { evaluateNumericValue, computedReferencePathValue } from "../geometry/numericExpressions";
import { resolveDerivedPoint } from "../model/pointAnchors";
import type {
  CadElement,
  ComputedBezierCurve,
  ComputedGeometry,
  ComputedOffsetLine,
  ComputedPoint,
  DrawingModifierStroke,
  ElementId,
  EvaluationResult,
  Layout,
  LayoutPlacement,
  NumericValue,
  PrintOutput,
  SvgOutput,
  DrawingModifierThemeRole
} from "../types/geometry";

export const PX_TO_MM = 25.4 / 96;
export const OUTPUT_TEXT_NOMINAL_FONT_SIZE_MM = 3;
export const OUTPUT_TEXT_LINE_HEIGHT = 1.2;
export const OUTPUT_TEXT_ASCENT = 0.8;
export const OUTPUT_TEXT_DESCENT = 0.2;
export const OUTPUT_TEXT_FONT_FAMILY = "HeiseiKakuGo-W5";

/**
 * Output colors are intentionally independent from the active Canvas theme.
 * These values are the established legacy export appearance and are part of
 * the output contract, not a runtime presentation preference.
 */
export const OUTPUT_PALETTE: Readonly<Record<DrawingModifierThemeRole, string>> = Object.freeze({
  foreground: "#31322f",
  muted: "#53564f",
  accent: "#0f766e",
  info: "#2563eb",
  warning: "#73320d",
  error: "#b91c1c"
});

export const outputPaletteColorForRole = (role: DrawingModifierThemeRole) => OUTPUT_PALETTE[role];

/**
 * The output core is deliberately independent of host APIs.  A host supplies
 * its production evaluator to `evaluateOutputPlan`; the synchronous planner
 * below consumes only the resolved evaluation result.
 */
export type OutputEvaluation = (
  elements: CadElement[],
  options: ReturnType<typeof buildEvaluationOptions>
) => EvaluationResult | Promise<EvaluationResult>;

export type OutputPoint = { x: number; y: number };

export type OutputStroke = {
  widthMm: number;
  style: DrawingModifierStroke["style"];
  colorHex: string;
};

export type OutputPathSegment =
  | { kind: "line"; start: OutputPoint; end: OutputPoint }
  | {
      kind: "bezier";
      start: OutputPoint;
      control1: OutputPoint;
      control2: OutputPoint;
      end: OutputPoint;
    }
  | {
      kind: "arc";
      center: OutputPoint;
      radius: number;
      startAngleDeg: number;
      sweepAngleDeg: number;
    };

export type OutputPath = OutputPathSegment & {
  elementId: ElementId;
  name: string;
  stroke: OutputStroke;
};

export type OutputOffsetLine = {
  kind: "offsetLine";
  elementId: ElementId;
  name: string;
  segments: OutputPathSegment[];
  stroke: OutputStroke;
};

export type OutputText = {
  kind: "text";
  elementId: ElementId;
  name: string;
  text: string;
  anchor: OutputPoint;
  fontSizeMm: number;
  widthMm: number;
  lineWidthsMm: number[];
  lineAdvancesMm: number[][];
  lineHeightMm: number;
  rotationDeg: number;
  mirrorX: boolean;
  colorHex: string;
};

export type OutputDrawable = OutputPath | OutputOffsetLine | OutputText;

export type OutputBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
};

export type OutputPlacementPlan = {
  id: string;
  groupId: ElementId;
  origin: OutputPoint;
  at: OutputPoint;
  scale: number;
  angleDeg: number;
  mirror: boolean;
  drawables: OutputDrawable[];
};

export type OutputGuide = {
  axis: "vertical" | "horizontal";
  positionMm: number;
  label: string;
  labelFontSizeMm: number;
  labelRotationDeg: number;
  labelCenter: OutputPoint;
  labelWidthMm: number;
  labelAdvancesMm: number[];
};

export type OutputPrintPage = {
  index: number;
  column: number;
  row: number;
  origin: OutputPoint;
  guides: OutputGuide[];
};

export type RustOutputPayloadBase = {
  version: 1;
  bounds: OutputBounds;
  drawables: OutputDrawable[];
};

export type RustSvgOutputPayload = RustOutputPayloadBase & {
  kind: "svg";
  widthMm: number;
  heightMm: number;
  contentOrigin: OutputPoint;
};

export type RustPrintOutputPayload = RustOutputPayloadBase & {
  kind: "print";
  paper: { widthMm: number; heightMm: number };
  marginMm: number;
  overlapMm: number;
  stride: OutputPoint;
  pages: OutputPrintPage[];
};

export type OutputPlan = {
  kind: "svg" | "print";
  outputId: string;
  outputName: string;
  layoutId: string;
  profileId?: string;
  placements: OutputPlacementPlan[];
  drawables: OutputDrawable[];
  renderedBounds: OutputBounds;
  bounds: OutputBounds;
  rustPayload: RustSvgOutputPayload | RustPrintOutputPayload;
  svg?: {
    widthMm: number;
    heightMm: number;
    viewBox: { x: number; y: number; width: number; height: number };
  };
  print?: {
    paper: "a4" | "a3";
    orientation: "portrait" | "landscape";
    paperWidthMm: number;
    paperHeightMm: number;
    marginMm: number;
    overlapMm: number;
    effectiveWidthMm: number;
    effectiveHeightMm: number;
    strideXmm: number;
    strideYmm: number;
    columns: number;
    rows: number;
    pages: OutputPrintPage[];
  };
};

export class OutputPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutputPlanError";
  }
}

const finitePositive = (value: number, label: string) => {
  if (!Number.isFinite(value) || value <= 0) throw new OutputPlanError(`${label} must be finite and greater than zero.`);
  return value;
};

const finiteNonNegative = (value: number, label: string) => {
  if (!Number.isFinite(value) || value < 0) throw new OutputPlanError(`${label} must be finite and non-negative.`);
  return value;
};

const finite = (value: number, label: string) => {
  if (!Number.isFinite(value)) throw new OutputPlanError(`${label} must be finite.`);
  return value;
};

const degToRad = (value: number) => value * Math.PI / 180;

const normalizeAngle = (value: number) => ((value % 360) + 360) % 360;

const addPoint = (left: OutputPoint, right: OutputPoint): OutputPoint => ({ x: left.x + right.x, y: left.y + right.y });

const transformPoint = (
  point: OutputPoint,
  origin: OutputPoint,
  at: OutputPoint,
  scale: number,
  angleDeg: number,
  mirror: boolean
): OutputPoint => {
  const sign = mirror ? -1 : 1;
  const localX = (point.x - origin.x) * scale * sign;
  const localY = (point.y - origin.y) * scale;
  const angle = degToRad(angleDeg);
  return addPoint(at, {
    x: localX * Math.cos(angle) - localY * Math.sin(angle),
    y: localX * Math.sin(angle) + localY * Math.cos(angle)
  });
};

const transformedArc = (
  arc: Extract<OutputPathSegment, { kind: "arc" }>,
  origin: OutputPoint,
  at: OutputPoint,
  scale: number,
  angleDeg: number,
  mirror: boolean
): Extract<OutputPathSegment, { kind: "arc" }> => ({
  kind: "arc",
  center: transformPoint(arc.center, origin, at, scale, angleDeg, mirror),
  radius: Math.abs(scale) * arc.radius,
  startAngleDeg: normalizeAngle(angleDeg + (mirror ? 180 - arc.startAngleDeg : arc.startAngleDeg)),
  sweepAngleDeg: mirror ? -arc.sweepAngleDeg : arc.sweepAngleDeg
});

const transformSegment = (
  segment: OutputPathSegment,
  origin: OutputPoint,
  at: OutputPoint,
  scale: number,
  angleDeg: number,
  mirror: boolean
): OutputPathSegment => {
  if (segment.kind === "line") {
    return {
      kind: "line",
      start: transformPoint(segment.start, origin, at, scale, angleDeg, mirror),
      end: transformPoint(segment.end, origin, at, scale, angleDeg, mirror)
    };
  }
  if (segment.kind === "bezier") {
    return {
      kind: "bezier",
      start: transformPoint(segment.start, origin, at, scale, angleDeg, mirror),
      control1: transformPoint(segment.control1, origin, at, scale, angleDeg, mirror),
      control2: transformPoint(segment.control2, origin, at, scale, angleDeg, mirror),
      end: transformPoint(segment.end, origin, at, scale, angleDeg, mirror)
    };
  }
  return transformedArc(segment, origin, at, scale, angleDeg, mirror);
};

const pointOf = (point: ComputedPoint): OutputPoint => ({ x: finite(point.x, "geometry x"), y: finite(point.y, "geometry y") });

const strokeColor = (stroke: DrawingModifierStroke): string => {
  if (stroke.color.kind === "fixed") {
    if (!/^#[0-9A-Fa-f]{6}$/.test(stroke.color.hex)) {
      throw new OutputPlanError(`Invalid fixed modifier color: ${stroke.color.hex}`);
    }
    return stroke.color.hex;
  }
  return outputPaletteColorForRole(stroke.color.role);
};

const strokeFor = (
  elementId: ElementId,
  evaluation: EvaluationResult
): OutputStroke => {
  const resolved = evaluation.effectiveDrawingModifierStrokes?.get(elementId);
  if (!resolved) return { widthMm: PX_TO_MM, style: "solid", colorHex: OUTPUT_PALETTE.foreground };
  finitePositive(resolved.widthPx, `modifier width for ${elementId}`);
  return {
    widthMm: resolved.widthPx * PX_TO_MM,
    style: resolved.style,
    colorHex: strokeColor(resolved)
  };
};

const geometryPath = (geometry: ComputedGeometry): OutputPathSegment | null => {
  if (geometry.kind === "line") {
    return { kind: "line", start: pointOf(geometry.start), end: pointOf(geometry.end) };
  }
  if (geometry.kind === "arcLine") {
    return {
      kind: "arc",
      center: pointOf(geometry.center),
      radius: finitePositive(geometry.radius, "arc radius"),
      startAngleDeg: finite(geometry.startAngleDeg, "arc start angle"),
      sweepAngleDeg: finite(geometry.sweepAngleDeg, "arc sweep")
    };
  }
  if (geometry.kind === "bezierCurve") {
    return null;
  }
  return null;
};

const bezierSegments = (geometry: ComputedBezierCurve): OutputPathSegment[] => geometry.segments.map((segment) => ({
  kind: "bezier" as const,
  start: pointOf(segment.start),
  control1: { x: finite(segment.control1.x, "Bezier control x"), y: finite(segment.control1.y, "Bezier control y") },
  control2: { x: finite(segment.control2.x, "Bezier control x"), y: finite(segment.control2.y, "Bezier control y") },
  end: pointOf(segment.end)
}));

const offsetSegments = (geometry: ComputedOffsetLine): OutputPathSegment[] => geometry.segments.map((segment): OutputPathSegment => {
  if (segment.kind === "line") return { kind: "line", start: pointOf(segment.start), end: pointOf(segment.end) };
  if (segment.kind === "bezier") {
    return {
      kind: "bezier",
      start: pointOf(segment.start),
      control1: { x: finite(segment.control1.x, "offset Bezier control x"), y: finite(segment.control1.y, "offset Bezier control y") },
      control2: { x: finite(segment.control2.x, "offset Bezier control x"), y: finite(segment.control2.y, "offset Bezier control y") },
      end: pointOf(segment.end)
    };
  }
  return {
    kind: "arc",
    center: pointOf(segment.center),
    radius: finitePositive(segment.radius, "offset arc radius"),
    startAngleDeg: finite(segment.startAngleDeg, "offset arc start angle"),
    sweepAngleDeg: finite(segment.sweepAngleDeg, "offset arc sweep")
  };
});

const normalizedTextLines = (text: string) => text.replace(/\r\n?/g, "\n").split("\n");

const textAdvanceRatio = (character: string) => {
  if (/\p{Mark}/u.test(character)) return 0;
  return character.codePointAt(0)! > 0x2e80 ? 1 : 0.62;
};

export type DeterministicTextLayout = {
  lineWidthsMm: number[];
  lineAdvancesMm: number[][];
  widthMm: number;
};

/**
 * Fixed output text metrics.  The encoders consume these resolved advances;
 * neither browser layout nor an OS font installation owns output geometry.
 */
export const deterministicTextLayout = (text: string, fontSizeMm: number): DeterministicTextLayout => {
  const lineAdvancesMm = normalizedTextLines(text).map((line) => [...line].map((character) => textAdvanceRatio(character) * fontSizeMm));
  const lineWidthsMm = lineAdvancesMm.map((advances) => advances.reduce((width, advance) => width + advance, 0));
  return { lineWidthsMm, lineAdvancesMm, widthMm: Math.max(...lineWidthsMm, 0) };
};

export const deterministicTextWidthMm = (text: string, fontSizeMm: number) => deterministicTextLayout(text, fontSizeMm).widthMm;

const textBoundsFor = ({
  anchor,
  fontSizeMm,
  lineWidthsMm,
  lineHeightMm,
  rotationDeg,
  mirrorX
}: Pick<OutputText, "anchor" | "fontSizeMm" | "lineWidthsMm" | "lineHeightMm" | "rotationDeg" | "mirrorX">): OutputBounds => {
  const ascent = fontSizeMm * OUTPUT_TEXT_ASCENT;
  const descent = fontSizeMm * OUTPUT_TEXT_DESCENT;
  const corners = lineWidthsMm.flatMap((width, index) => {
    const baselineY = -index * lineHeightMm;
    return [
      { x: 0, y: baselineY - descent },
      { x: width, y: baselineY - descent },
      { x: 0, y: baselineY + ascent },
      { x: width, y: baselineY + ascent }
    ];
  }).map((corner) => transformPoint(corner, { x: 0, y: 0 }, anchor, 1, rotationDeg, mirrorX));
  return boundsFromPoints(corners);
};

const textBounds = (text: OutputText): OutputBounds => textBoundsFor(text);

const emptyBounds = (): OutputBounds => ({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, width: 0, height: 0 });

const boundsFromPoints = (points: readonly OutputPoint[]): OutputBounds => {
  if (!points.length) return emptyBounds();
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
};

const mergeBounds = (left: OutputBounds, right: OutputBounds): OutputBounds => {
  if (!Number.isFinite(left.minX)) return right;
  if (!Number.isFinite(right.minX)) return left;
  return boundsFromPoints([
    { x: left.minX, y: left.minY },
    { x: left.maxX, y: left.maxY },
    { x: right.minX, y: right.minY },
    { x: right.maxX, y: right.maxY }
  ]);
};

const expandBounds = (bounds: OutputBounds, amount: number): OutputBounds => {
  if (!Number.isFinite(bounds.minX)) return bounds;
  return {
    minX: bounds.minX - amount,
    minY: bounds.minY - amount,
    maxX: bounds.maxX + amount,
    maxY: bounds.maxY + amount,
    width: bounds.width + amount * 2,
    height: bounds.height + amount * 2
  };
};

const cubicAt = (p0: number, p1: number, p2: number, p3: number, t: number) => {
  const one = 1 - t;
  return one ** 3 * p0 + 3 * one ** 2 * t * p1 + 3 * one * t ** 2 * p2 + t ** 3 * p3;
};

const cubicExtrema = (p0: number, p1: number, p2: number, p3: number) => {
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  const roots: number[] = [];
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) >= 1e-12) roots.push(-c / b);
  } else {
    const discriminant = b * b - 4 * a * c;
    if (discriminant >= 0) {
      roots.push((-b + Math.sqrt(discriminant)) / (2 * a), (-b - Math.sqrt(discriminant)) / (2 * a));
    }
  }
  return roots.filter((root) => root > 0 && root < 1);
};

const segmentBounds = (segment: OutputPathSegment): OutputBounds => {
  if (segment.kind === "line") return boundsFromPoints([segment.start, segment.end]);
  if (segment.kind === "bezier") {
    const xs = [0, 1, ...cubicExtrema(segment.start.x, segment.control1.x, segment.control2.x, segment.end.x)];
    const ys = [0, 1, ...cubicExtrema(segment.start.y, segment.control1.y, segment.control2.y, segment.end.y)];
    const parameters = [...new Set([...xs, ...ys])];
    return boundsFromPoints(parameters.map((t) => ({
      x: cubicAt(segment.start.x, segment.control1.x, segment.control2.x, segment.end.x, t),
      y: cubicAt(segment.start.y, segment.control1.y, segment.control2.y, segment.end.y, t)
    })));
  }
  const angles = [segment.startAngleDeg, segment.startAngleDeg + segment.sweepAngleDeg];
  const sweep = Math.abs(segment.sweepAngleDeg);
  if (sweep >= 360) angles.push(0, 90, 180, 270);
  else for (const candidate of [0, 90, 180, 270]) {
    const delta = ((candidate - segment.startAngleDeg) % 360 + 360) % 360;
    if (segment.sweepAngleDeg >= 0 ? delta <= sweep : delta === 0 || 360 - delta <= sweep) angles.push(candidate);
  }
  return boundsFromPoints(angles.map((angle) => ({
    x: segment.center.x + segment.radius * Math.cos(degToRad(angle)),
    y: segment.center.y + segment.radius * Math.sin(degToRad(angle))
  })));
};

const drawableBounds = (drawable: OutputDrawable): OutputBounds => {
  if (drawable.kind === "text") return textBounds(drawable);
  const paths = drawable.kind === "offsetLine" ? drawable.segments : [drawable];
  let bounds = emptyBounds();
  for (const path of paths) bounds = mergeBounds(bounds, segmentBounds(path));
  return expandBounds(bounds, drawable.stroke.widthMm / 2);
};

export const outputDrawableBounds = drawableBounds;

const outputGeometryFor = (
  geometry: ComputedGeometry,
  elementId: ElementId,
  name: string,
  stroke: OutputStroke,
  transform: { origin: OutputPoint; at: OutputPoint; scale: number; angleDeg: number; mirror: boolean }
): OutputDrawable[] => {
  const finalStroke = { ...stroke };
  if (geometry.kind === "line" || geometry.kind === "arcLine") {
    const path = geometryPath(geometry);
    if (!path) return [];
    return [{ ...transformSegment(path, transform.origin, transform.at, transform.scale, transform.angleDeg, transform.mirror), elementId, name, stroke: finalStroke } as OutputPath];
  }
  if (geometry.kind === "bezierCurve") {
    const segments = bezierSegments(geometry).map((segment) => transformSegment(segment, transform.origin, transform.at, transform.scale, transform.angleDeg, transform.mirror));
    return segments.map((segment) => ({ ...segment, elementId, name, stroke: finalStroke } as OutputPath));
  }
  if (geometry.kind === "offsetLine") {
    const segments = offsetSegments(geometry).map((segment) => transformSegment(segment, transform.origin, transform.at, transform.scale, transform.angleDeg, transform.mirror));
    return segments.length ? [{ kind: "offsetLine", elementId, name, segments, stroke: finalStroke }] : [];
  }
  if (geometry.kind === "text" && geometry.anchor) {
    const fontSizeMm = finitePositive(geometry.fontSize, `font size for ${elementId}`) * transform.scale;
    const textLayout = deterministicTextLayout(geometry.text, fontSizeMm);
    return [{
      kind: "text",
      elementId,
      name,
      text: geometry.text.replace(/\r\n?/g, "\n"),
      anchor: transformPoint(pointOf(geometry.anchor), transform.origin, transform.at, transform.scale, transform.angleDeg, transform.mirror),
      fontSizeMm,
      widthMm: textLayout.widthMm,
      lineWidthsMm: textLayout.lineWidthsMm,
      lineAdvancesMm: textLayout.lineAdvancesMm,
      lineHeightMm: fontSizeMm * OUTPUT_TEXT_LINE_HEIGHT,
      rotationDeg: transform.angleDeg,
      mirrorX: transform.mirror,
      colorHex: finalStroke.colorHex
    }];
  }
  return [];
};

const descendants = (elements: readonly CadElement[], groupId: ElementId) => {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const result = new Set<ElementId>([groupId]);
  for (const element of elements) {
    let parentId = element.parentGroupId;
    const visited = new Set<ElementId>();
    while (parentId && visited.add(parentId)) {
      if (parentId === groupId) {
        result.add(element.id);
        break;
      }
      parentId = byId.get(parentId)?.parentGroupId;
    }
  }
  return result;
};

const statementIndexById = (compiledDocument: LastGoodDslDocument) => new Map([
  ...Array.from(compiledDocument.statementMap.statementIdByStatementIndex ?? new Map<number, string>(), ([index, id]) => [id, index] as const),
  ...Array.from(compiledDocument.layoutIdsByStatementIndex ?? new Map<number, string>(), ([index, id]) => [id, index] as const),
  ...Array.from(compiledDocument.outputIdsByStatementIndex ?? new Map<number, string>(), ([index, id]) => [id, index] as const)
]);

const scalarError = (message: string): ScalarEvaluation => ({ status: "error", type: { kind: "number" }, issueCode: message });

const resolveNumeric = ({
  value,
  occurrence,
  sourceOrder,
  compiledDocument,
  evaluation
}: {
  value: NumericValue;
  occurrence: string;
  sourceOrder: number;
  compiledDocument: LastGoodDslDocument;
  evaluation: EvaluationResult;
}): number => {
  if (typeof value === "number") return finite(value, occurrence);
  const binding = compiledDocument.numericBindings?.get(occurrence);
  if (binding?.typedExpression) {
    const scalar = evaluateTypedExpression(binding.typedExpression, {
      lookupBinding: (bindingId) => evaluation.computedScalarBindings?.get(bindingId) ?? scalarError(`missing scalar binding ${bindingId}`),
      lookupGeometryProperty: (reference) => {
        if (!reference.elementId || reference.targetSourceOrder === null || reference.targetSourceOrder >= sourceOrder) return scalarError("geometry property is unavailable");
        const result = computedReferencePathValue(evaluation.computedGeometry.get(reference.elementId), reference.property);
        return typeof result === "number" && Number.isFinite(result)
          ? { status: "ok", type: { kind: "number" }, value: { kind: "number", value: result } }
          : scalarError("geometry property is unavailable");
      },
      lookupGeometryTarget: (target) => {
        if (target.statementIndex >= sourceOrder) return undefined;
        const geometry = evaluation.computedGeometry.get(target.statementId);
        if (!geometry) return undefined;
        if (!target.pointKey) return geometry;
        return resolveDerivedPoint(
          geometry,
          target.pointKey,
          new Map(compiledDocument.document.elements.map((element) => [element.id, element]))
        ) ?? undefined;
      }
    });
    if (scalar.status !== "ok" || scalar.value.kind !== "number") throw new OutputPlanError(`Cannot resolve ${occurrence}.`);
    return finite(scalar.value.value, occurrence);
  }
  let expression = value.expression;
  for (const reference of [...(binding?.references ?? [])].reverse()) {
    const scalar = evaluation.computedScalarBindings?.get(reference.bindingId);
    if (!scalar || scalar.status !== "ok" || scalar.value.kind !== "number") throw new OutputPlanError(`Cannot resolve ${occurrence}.`);
    const literal = finite(scalar.value.value, reference.bindingId).toString();
    if (expression.slice(reference.expressionStart, reference.expressionEnd) !== `@${reference.name}`) {
      throw new OutputPlanError(`Cannot map compiled numeric binding ${occurrence}.`);
    }
    expression = `${expression.slice(0, reference.expressionStart)}${literal}${expression.slice(reference.expressionEnd)}`;
  }
  const result = evaluateNumericValue({
    value: { kind: "expression", expression },
    computedGeometry: evaluation.computedGeometry,
    elementsById: new Map(compiledDocument.document.elements.map((element) => [element.id, element])),
    elements: compiledDocument.document.elements
  });
  if (result.value === undefined) throw new OutputPlanError(`Cannot resolve ${occurrence}: ${result.error?.message ?? "invalid numeric value"}`);
  return finite(result.value, occurrence);
};

const outputSourceIndex = (compiledDocument: LastGoodDslDocument, id: string) => {
  const index = statementIndexById(compiledDocument).get(id);
  if (index === undefined) throw new OutputPlanError(`Output declaration ${id} has no source identity.`);
  return index;
};

const resolvedPlacement = (
  placement: LayoutPlacement,
  layout: Layout,
  compiledDocument: LastGoodDslDocument,
  evaluation: EvaluationResult,
  targetElements: readonly CadElement[]
): OutputPlacementPlan => {
  const sourceOrder = outputSourceIndex(compiledDocument, placement.id);
  const scaleSourceOrder = placement.scale === undefined ? outputSourceIndex(compiledDocument, layout.id) : sourceOrder;
  const scale = resolveNumeric({ value: placement.scale ?? layout.scale, occurrence: propertyBindingOccurrenceKey(scaleSourceOrder, "scale"), sourceOrder: scaleSourceOrder, compiledDocument, evaluation });
  const at = {
    x: resolveNumeric({ value: placement.at.x, occurrence: propertyBindingOccurrenceKey(sourceOrder, "at:x"), sourceOrder, compiledDocument, evaluation }),
    y: resolveNumeric({ value: placement.at.y, occurrence: propertyBindingOccurrenceKey(sourceOrder, "at:y"), sourceOrder, compiledDocument, evaluation })
  };
  const resolvedAngleDeg = resolveNumeric({ value: placement.angleDeg, occurrence: propertyBindingOccurrenceKey(sourceOrder, "angle"), sourceOrder, compiledDocument, evaluation });
  finitePositive(scale, `placement ${placement.id} scale`);
  const angleDeg = normalizeAngle(finite(resolvedAngleDeg, `placement ${placement.id} angle`));
  const origin = placement.origin.kind === "localOrigin"
    ? { x: 0, y: 0 }
    : (() => {
        const point = evaluation.computedGeometry.get(placement.origin.pointId);
        if (!point || point.kind !== "point") throw new OutputPlanError(`Placement ${placement.id} origin is unavailable.`);
        return pointOf(point);
      })();
  const targetIds = descendants(targetElements, placement.groupId);
  const templateByGeneratedId = new Map((evaluation.forGroupGeneratedRows ?? []).map((row) => [row.generatedElementId, row.templateElementId]));
  const sourceElementsById = new Map(targetElements.map((element) => [element.id, element]));
  const drawables: OutputDrawable[] = [];
  for (const geometry of evaluation.computedGeometry.values()) {
    const sourceId = templateByGeneratedId.get(geometry.elementId) ?? geometry.elementId;
    if (!targetIds.has(sourceId)) continue;
    if (!evaluation.effectiveVisibleElementIds?.has(geometry.elementId)) continue;
    if (geometry.kind !== "line" && geometry.kind !== "arcLine" && geometry.kind !== "bezierCurve" && geometry.kind !== "offsetLine" && geometry.kind !== "text") continue;
    const sourceElement = sourceElementsById.get(sourceId);
    const name = sourceElement?.name ?? geometry.name;
    drawables.push(...outputGeometryFor(geometry, geometry.elementId, name, strokeFor(geometry.elementId, evaluation), { origin, at, scale, angleDeg, mirror: placement.mirror }));
  }
  return { id: placement.id, groupId: placement.groupId, origin, at, scale, angleDeg, mirror: placement.mirror, drawables };
};

const labelForIndex = (index: number) => {
  let value = index;
  let label = "";
  while (value >= 0) {
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26) - 1;
  }
  return label;
};

const labelLayout = ({
  text,
  axis,
  center,
  overlapMm,
  effectiveWidthMm,
  effectiveHeightMm
}: {
  text: string;
  axis: OutputGuide["axis"];
  center: OutputPoint;
  overlapMm: number;
  effectiveWidthMm: number;
  effectiveHeightMm: number;
}) => {
  const stripWidthMm = axis === "vertical" ? overlapMm : effectiveWidthMm;
  const stripHeightMm = axis === "vertical" ? effectiveHeightMm : overlapMm;
  const rotationDeg = axis === "vertical" ? 90 : 0;
  const nominalFontSizeMm = OUTPUT_TEXT_NOMINAL_FONT_SIZE_MM;
  const lineHeightMm = nominalFontSizeMm * OUTPUT_TEXT_LINE_HEIGHT;
  const nominalTextLayout = deterministicTextLayout(text, nominalFontSizeMm);
  const nominalBounds = textBoundsFor({
    anchor: { x: 0, y: 0 },
    fontSizeMm: nominalFontSizeMm,
    lineWidthsMm: nominalTextLayout.lineWidthsMm,
    lineHeightMm,
    rotationDeg,
    mirrorX: false
  });
  const fitScale = Math.min(
    1,
    nominalBounds.width > 0 ? stripWidthMm / nominalBounds.width : 1,
    nominalBounds.height > 0 ? stripHeightMm / nominalBounds.height : 1
  );
  const fontSizeMm = nominalFontSizeMm * fitScale;
  const textLayout = deterministicTextLayout(text, fontSizeMm);
  return {
    labelFontSizeMm: fontSizeMm,
    labelRotationDeg: rotationDeg,
    labelCenter: center,
    labelWidthMm: textLayout.widthMm,
    labelAdvancesMm: textLayout.lineAdvancesMm[0] ?? []
  };
};

const printPages = ({
  bounds,
  paperWidthMm,
  paperHeightMm,
  marginMm,
  overlapMm
}: {
  bounds: OutputBounds;
  paperWidthMm: number;
  paperHeightMm: number;
  marginMm: number;
  overlapMm: number;
}) => {
  const effectiveWidthMm = paperWidthMm - 2 * marginMm;
  const effectiveHeightMm = paperHeightMm - 2 * marginMm;
  finitePositive(effectiveWidthMm, "print effective width");
  finitePositive(effectiveHeightMm, "print effective height");
  finiteNonNegative(overlapMm, "print overlap");
  if (overlapMm >= effectiveWidthMm || overlapMm >= effectiveHeightMm) throw new OutputPlanError("print overlap must be smaller than both effective dimensions.");
  const strideXmm = effectiveWidthMm - overlapMm;
  const strideYmm = effectiveHeightMm - overlapMm;
  const columns = bounds.width <= effectiveWidthMm ? 1 : 1 + Math.ceil((bounds.width - effectiveWidthMm) / strideXmm);
  const rows = bounds.height <= effectiveHeightMm ? 1 : 1 + Math.ceil((bounds.height - effectiveHeightMm) / strideYmm);
  const pages: OutputPrintPage[] = [];
  const verticalBoundaryCount = Math.max(0, columns - 1);
  const verticalLabelFor = (row: number, boundary: number) => String(row * verticalBoundaryCount + boundary + 1);
  const horizontalLabels = Array.from({ length: Math.max(0, columns * Math.max(0, rows - 1)) }, (_, index) => labelForIndex(index));
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const guides: OutputGuide[] = [];
      if (overlapMm > 0 && column > 0) {
        const label = verticalLabelFor(row, column - 1);
        const layout = labelLayout({
          text: label,
          axis: "vertical",
          center: { x: marginMm + overlapMm / 2, y: paperHeightMm / 2 },
          overlapMm,
          effectiveWidthMm,
          effectiveHeightMm
        });
        guides.push({ axis: "vertical", positionMm: marginMm + overlapMm, label, ...layout });
      }
      if (overlapMm > 0 && column < columns - 1) {
        const label = verticalLabelFor(row, column);
        const layout = labelLayout({
          text: label,
          axis: "vertical",
          center: { x: paperWidthMm - marginMm - overlapMm / 2, y: paperHeightMm / 2 },
          overlapMm,
          effectiveWidthMm,
          effectiveHeightMm
        });
        guides.push({ axis: "vertical", positionMm: paperWidthMm - marginMm - overlapMm, label, ...layout });
      }
      if (overlapMm > 0 && row > 0) {
        const label = horizontalLabels[(row - 1) * columns + column];
        const layout = labelLayout({
          text: label,
          axis: "horizontal",
          center: { x: paperWidthMm / 2, y: marginMm + overlapMm / 2 },
          overlapMm,
          effectiveWidthMm,
          effectiveHeightMm
        });
        guides.push({ axis: "horizontal", positionMm: marginMm + overlapMm, label, ...layout });
      }
      if (overlapMm > 0 && row < rows - 1) {
        const label = horizontalLabels[row * columns + column];
        const layout = labelLayout({
          text: label,
          axis: "horizontal",
          center: { x: paperWidthMm / 2, y: paperHeightMm - marginMm - overlapMm / 2 },
          overlapMm,
          effectiveWidthMm,
          effectiveHeightMm
        });
        guides.push({ axis: "horizontal", positionMm: paperHeightMm - marginMm - overlapMm, label, ...layout });
      }
      pages.push({
        index: pages.length,
        column,
        row,
        origin: { x: bounds.minX - marginMm + column * strideXmm, y: bounds.minY - marginMm + row * strideYmm },
        guides
      });
    }
  }
  return { effectiveWidthMm, effectiveHeightMm, strideXmm, strideYmm, columns, rows, pages };
};

const outputLayout = (compiledDocument: LastGoodDslDocument, layoutId: string) => {
  const layout = compiledDocument.document.layouts.find((candidate) => candidate.id === layoutId);
  if (!layout) throw new OutputPlanError(`Layout ${layoutId} was not found.`);
  return layout;
};

export const buildOutputPlan = ({
  compiledDocument,
  output,
  evaluation
}: {
  compiledDocument: LastGoodDslDocument;
  output: PrintOutput | SvgOutput;
  evaluation: EvaluationResult;
}): OutputPlan => {
  if (evaluation.errors.length) throw new OutputPlanError(`Output evaluation failed: ${evaluation.errors[0].message}`);
  const layout = outputLayout(compiledDocument, output.layoutId);
  const placements = layout.placements.map((placement) => resolvedPlacement(placement, layout, compiledDocument, evaluation, compiledDocument.document.elements));
  const drawables = placements.flatMap((placement) => placement.drawables);
  if (!drawables.length) throw new OutputPlanError("Output has no renderable bounds.");
  let renderedBounds = emptyBounds();
  for (const drawable of drawables) renderedBounds = mergeBounds(renderedBounds, drawableBounds(drawable));
  if (!Number.isFinite(renderedBounds.minX) || !Number.isFinite(renderedBounds.minY)) throw new OutputPlanError("Output has no renderable bounds.");
  const outputIndex = outputSourceIndex(compiledDocument, output.id);
  if (!("paper" in output)) {
    const marginMm = resolveNumeric({ value: output.margin, occurrence: propertyBindingOccurrenceKey(outputIndex, "margin"), sourceOrder: outputIndex, compiledDocument, evaluation });
    finiteNonNegative(marginMm, "svg margin");
    const bounds = expandBounds(renderedBounds, marginMm);
    const contentOrigin = { x: bounds.minX, y: bounds.minY };
    const rustPayload: RustSvgOutputPayload = { version: 1, kind: "svg", bounds: renderedBounds, widthMm: bounds.width, heightMm: bounds.height, contentOrigin, drawables };
    return {
      kind: "svg", outputId: output.id, outputName: output.name, layoutId: output.layoutId, ...(output.profileId ? { profileId: output.profileId } : {}),
      placements, drawables, renderedBounds, bounds, rustPayload,
      svg: { widthMm: bounds.width, heightMm: bounds.height, viewBox: { x: 0, y: 0, width: bounds.width, height: bounds.height } }
    };
  }
  const paperBase = output.paper === "a4" ? { widthMm: 210, heightMm: 297 } : { widthMm: 297, heightMm: 420 };
  const paperWidthMm = output.orientation === "landscape" ? paperBase.heightMm : paperBase.widthMm;
  const paperHeightMm = output.orientation === "landscape" ? paperBase.widthMm : paperBase.heightMm;
  const marginMm = resolveNumeric({ value: output.margin, occurrence: propertyBindingOccurrenceKey(outputIndex, "margin"), sourceOrder: outputIndex, compiledDocument, evaluation });
  const overlapMm = resolveNumeric({ value: output.overlap, occurrence: propertyBindingOccurrenceKey(outputIndex, "overlap"), sourceOrder: outputIndex, compiledDocument, evaluation });
  finiteNonNegative(marginMm, "print margin");
  const tiling = printPages({ bounds: renderedBounds, paperWidthMm, paperHeightMm, marginMm, overlapMm });
  const rustPayload: RustPrintOutputPayload = { version: 1, kind: "print", bounds: renderedBounds, drawables, paper: { widthMm: paperWidthMm, heightMm: paperHeightMm }, marginMm, overlapMm, stride: { x: tiling.strideXmm, y: tiling.strideYmm }, pages: tiling.pages };
  return {
    kind: "print", outputId: output.id, outputName: output.name, layoutId: output.layoutId, ...(output.profileId ? { profileId: output.profileId } : {}),
    placements, drawables, renderedBounds, bounds: renderedBounds, rustPayload,
    print: { paper: output.paper, orientation: output.orientation, paperWidthMm, paperHeightMm, marginMm, overlapMm, ...tiling }
  };
};

/** Profile-aware evaluation entry point used by future host adapters. */
export const evaluateOutputPlan = async ({
  compiledDocument,
  output,
  evaluate = evaluateElementsReference
}: {
  compiledDocument: LastGoodDslDocument;
  output: PrintOutput | SvgOutput;
  evaluate?: OutputEvaluation;
}) => {
  const evaluation = await evaluate(
    compiledDocument.document.elements,
    buildEvaluationOptions({
      compiledDocument,
      evaluationLimitIndex: compiledDocument.document.evaluationLimitIndex,
      ...(output.profileId ? { selectedDrawingProfileId: output.profileId } : {})
    })
  );
  return buildOutputPlan({ compiledDocument, output, evaluation });
};

export const tryBuildOutputPlan = (input: Parameters<typeof buildOutputPlan>[0]) => {
  try {
    return { ok: true as const, plan: buildOutputPlan(input) };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
  }
};
