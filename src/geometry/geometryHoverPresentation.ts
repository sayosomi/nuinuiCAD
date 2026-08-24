import {
  formatAngleDeg,
  formatCoordinate,
  formatMillimeters,
  formatNumber
} from "./geometryDisplay";
import {
  elementTypeLabels,
  type CadElement,
  type ComputedArcLine,
  type ComputedBezierCurve,
  type ComputedGeometry,
  type ComputedJoinedPath,
  type ComputedLine,
  type ComputedOffsetLine,
  type ElementId,
  type EvaluationResult,
  type OffsetLineSide
} from "../types/geometry";

export type GeometryHoverReference = {
  elementId: ElementId;
  label: string;
};

export type GeometryHoverRow =
  | { kind: "value"; label: string; value: string }
  | { kind: "references"; label: string; references: GeometryHoverReference[] };

export type GeometryHoverTable = {
  headers: string[];
  rows: string[][];
};

export type GeometryHoverAvailability =
  | { kind: "geometry"; rows: GeometryHoverRow[]; table?: GeometryHoverTable }
  | { kind: "not-evaluated" }
  | { kind: "unavailable" };

export type GeometryHoverPresentation = {
  heading: string;
  statuses: string[];
  availability: GeometryHoverAvailability;
};

export type GeometryHoverReferenceHref = (
  reference: GeometryHoverReference
) => string | null | undefined;

type ComputedOffsetLineWithInspection = ComputedOffsetLine & {
  offsetDistance?: number;
  offsetSide?: OffsetLineSide;
};

const headingFor = (element: CadElement): string =>
  `${element.name} · ${elementTypeLabels[element.type]}`;

export const geometryHoverUnavailablePresentation = (
  element: CadElement
): GeometryHoverPresentation => ({
  heading: headingFor(element),
  statuses: [],
  availability: { kind: "unavailable" }
});

const hasIssueFor = (
  issues: readonly { elementId: string }[],
  elementId: string
): boolean => issues.some((issue) => issue.elementId === elementId);

const valueRow = (label: string, value: string): GeometryHoverRow => ({
  kind: "value",
  label,
  value
});

const lineDirectionAngleDeg = (line: ComputedLine): number | null => {
  const dx = line.end.x - line.start.x;
  const dy = line.end.y - line.start.y;
  return Math.hypot(dx, dy) <= Number.EPSILON
    ? null
    : Math.atan2(dy, dx) * 180 / Math.PI;
};

const lineHoverRows = (line: ComputedLine): GeometryHoverRow[] => [
  valueRow("長さ", formatMillimeters(line.length)),
  valueRow("角度", formatAngleDeg(lineDirectionAngleDeg(line))),
  valueRow("始点", formatCoordinate(line.start)),
  valueRow("終点", formatCoordinate(line.end))
];

const arcHoverRows = (arc: ComputedArcLine): GeometryHoverRow[] => [
  valueRow("中心点", formatCoordinate(arc.center)),
  valueRow("半径", formatMillimeters(arc.radius)),
  valueRow("始角度", formatAngleDeg(arc.startAngleDeg)),
  valueRow("終角度", formatAngleDeg(arc.endAngleDeg)),
  valueRow("スイープ", `${formatNumber(arc.sweepAngleDeg)}°`),
  valueRow("進行方向", arc.sweepAngleDeg > 0 ? "反時計回り" : arc.sweepAngleDeg < 0 ? "時計回り" : "なし"),
  valueRow("長さ", formatMillimeters(arc.length)),
  valueRow("始点", formatCoordinate(arc.start)),
  valueRow("終点", formatCoordinate(arc.end))
];

const pointDistance = (
  left: { x: number; y: number },
  right: { x: number; y: number }
): number => Math.hypot(right.x - left.x, right.y - left.y);

const directionAngleDeg = (
  from: { x: number; y: number },
  to: { x: number; y: number }
): number | null => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return Math.hypot(dx, dy) <= Number.EPSILON
    ? null
    : Math.atan2(dy, dx) * 180 / Math.PI;
};

const intermediateHandleAxisAngleDeg = (
  curve: ComputedBezierCurve,
  index: number
): number | null => {
  const previous = curve.segments[index - 1];
  const next = curve.segments[index];
  if (!previous || !next) return null;
  const anchor = previous.end;
  const outgoing = directionAngleDeg(anchor, next.control1);
  if (outgoing !== null) return outgoing;
  const incoming = directionAngleDeg(anchor, previous.control2);
  return incoming === null ? null : incoming + 180;
};

const bezierHoverTable = (curve: ComputedBezierCurve): GeometryHoverTable | undefined => {
  const first = curve.segments[0];
  const last = curve.segments.at(-1);
  if (!first || !last) return undefined;

  const rows: string[][] = [[
    "P0",
    formatCoordinate(first.start),
    "—",
    formatAngleDeg(curve.startHandleAngleDeg),
    formatMillimeters(curve.startHandleLength)
  ]];

  for (let index = 1; index < curve.segments.length; index += 1) {
    const previous = curve.segments[index - 1]!;
    const next = curve.segments[index]!;
    const anchor = previous.end;
    rows.push([
      `P${index}`,
      formatCoordinate(anchor),
      formatMillimeters(pointDistance(anchor, previous.control2)),
      formatAngleDeg(intermediateHandleAxisAngleDeg(curve, index)),
      formatMillimeters(pointDistance(anchor, next.control1))
    ]);
  }

  rows.push([
    `P${curve.segments.length}`,
    formatCoordinate(last.end),
    formatMillimeters(curve.endHandleLength),
    formatAngleDeg(curve.endHandleAngleDeg),
    "—"
  ]);

  return {
    headers: ["Anchor", "Position", "← In", "Angle", "Out →"],
    rows
  };
};

const geometryNameFor = (
  evaluation: EvaluationResult,
  elementId: ElementId
): string => evaluation.computedGeometry.get(elementId)?.name ?? elementId;

const offsetHoverRows = (
  line: ComputedOffsetLineWithInspection,
  evaluation: EvaluationResult
): GeometryHoverRow[] => [
  valueRow("長さ", formatMillimeters(line.length)),
  valueRow("始点", line.start ? formatCoordinate(line.start) : "未定義"),
  valueRow("終点", line.end ? formatCoordinate(line.end) : "未定義"),
  ...(line.offsetDistance === undefined
    ? []
    : [valueRow("距離", formatMillimeters(line.offsetDistance))]),
  ...(line.offsetSide === undefined
    ? []
    : [valueRow("方向", line.offsetSide)]),
  {
    kind: "references" as const,
    label: "Source",
    references: line.baseLineIds.map((elementId) => ({
      elementId,
      label: geometryNameFor(evaluation, elementId)
    }))
  },
  ...(line.closed ? [valueRow("閉じる", "はい")] : [])
];

const joinedPathHoverRows = (
  line: ComputedJoinedPath,
  evaluation: EvaluationResult
): GeometryHoverRow[] => [
  valueRow("長さ", formatMillimeters(line.length)),
  valueRow("始点", line.start ? formatCoordinate(line.start) : "未定義"),
  valueRow("終点", line.end ? formatCoordinate(line.end) : "未定義"),
  {
    kind: "references",
    label: "Paths",
    references: line.pathIds.map((elementId) => ({ elementId, label: geometryNameFor(evaluation, elementId) }))
  },
  ...(line.closed ? [valueRow("閉じる", "はい")] : [])
];

const geometryHoverAvailability = (
  geometry: ComputedGeometry,
  evaluation: EvaluationResult
): Extract<GeometryHoverAvailability, { kind: "geometry" }> => {
  if (geometry.kind === "point") {
    return {
      kind: "geometry",
      rows: [valueRow("座標", formatCoordinate(geometry))]
    };
  }
  if (geometry.kind === "line") {
    return { kind: "geometry", rows: lineHoverRows(geometry) };
  }
  if (geometry.kind === "arcLine") {
    return { kind: "geometry", rows: arcHoverRows(geometry) };
  }
  if (geometry.kind === "bezierCurve") {
    return {
      kind: "geometry",
      rows: [valueRow("長さ", formatMillimeters(geometry.length))],
      table: bezierHoverTable(geometry)
    };
  }
  if (geometry.kind === "offsetLine") {
    return {
      kind: "geometry",
      rows: offsetHoverRows(geometry as ComputedOffsetLineWithInspection, evaluation)
    };
  }
  if (geometry.kind === "joinedPath") {
    return { kind: "geometry", rows: joinedPathHoverRows(geometry, evaluation) };
  }
  return { kind: "geometry", rows: [] };
};

/**
 * Host-neutral runtime-state and current-geometry presentation shared by native
 * Editor Hover and future Explorer Hover renderers.
 *
 * Geometry formatting helpers remain shared with Inspector, while this module
 * owns the compact Hover information selection and structured references/table.
 */
export const geometryHoverPresentation = (
  element: CadElement,
  evaluation: EvaluationResult
): GeometryHoverPresentation => {
  const heading = headingFor(element);
  const inactive = evaluation.conditionInactiveElementIds?.has(element.id) ?? false;
  const enabled = evaluation.effectiveEnabledElementIds
    ? evaluation.effectiveEnabledElementIds.has(element.id)
    : element.activity !== "disabled";
  const evaluated = evaluation.evaluatedElementIds
    ? evaluation.evaluatedElementIds.has(element.id)
    : true;

  if (inactive) {
    return {
      heading,
      statuses: ["Inactive"],
      availability: { kind: "not-evaluated" }
    };
  }

  if (!enabled) {
    return {
      heading,
      statuses: ["Disabled"],
      availability: { kind: "not-evaluated" }
    };
  }

  if (!evaluated) {
    return {
      heading,
      statuses: [],
      availability: { kind: "not-evaluated" }
    };
  }

  const visible = evaluation.effectiveVisibleElementIds
    ? evaluation.effectiveVisibleElementIds.has(element.id)
    : element.activity === "visible";
  const hasError = hasIssueFor(evaluation.errors, element.id);
  const hasWarning = hasIssueFor(evaluation.warnings, element.id);
  const statuses = [
    ...(!visible ? ["Hidden"] : []),
    ...(hasError ? ["Error"] : []),
    ...(hasWarning ? ["Warning"] : [])
  ];
  const geometry = evaluation.computedGeometry.get(element.id);

  return {
    heading,
    statuses,
    availability: geometry
      ? geometryHoverAvailability(geometry, evaluation)
      : { kind: "unavailable" }
  };
};

const markdownCharacters = new Set([
  "\\", "`", "*", "_", "{", "}", "[", "]", "(", ")",
  "#", "+", "-", ".", "!", "|", ">"
]);

const escapeMarkdown = (value: string): string =>
  [...value]
    .map((character) => markdownCharacters.has(character) ? `\\${character}` : character)
    .join("");

const markdownReference = (
  reference: GeometryHoverReference,
  hrefForReference: GeometryHoverReferenceHref | undefined
): string => {
  const label = escapeMarkdown(reference.label);
  const href = hrefForReference?.(reference);
  return href ? `[${label}](${href})` : label;
};

export const geometryHoverMarkdown = (
  presentation: GeometryHoverPresentation,
  hrefForReference?: GeometryHoverReferenceHref
): string => {
  const lines = [`**${escapeMarkdown(presentation.heading)}**`];
  if (presentation.statuses.length > 0) {
    lines.push("", `_${presentation.statuses.map(escapeMarkdown).join(" · ")}_`);
  }
  lines.push("", "**Geometry**", "");

  if (presentation.availability.kind === "not-evaluated") {
    lines.push("Not evaluated");
    return lines.join("\n");
  }
  if (presentation.availability.kind === "unavailable") {
    lines.push("Geometry unavailable");
    return lines.join("\n");
  }

  for (const row of presentation.availability.rows) {
    if (row.kind === "value") {
      lines.push(`- **${escapeMarkdown(row.label)}:** ${escapeMarkdown(row.value)}`);
      continue;
    }
    lines.push(
      `- **${escapeMarkdown(row.label)}:** ${row.references
        .map((reference) => markdownReference(reference, hrefForReference))
        .join(", ")}`
    );
  }

  if (presentation.availability.table) {
    const { headers, rows } = presentation.availability.table;
    lines.push(
      "",
      `| ${headers.map(escapeMarkdown).join(" | ")} |`,
      `| ${headers.map(() => "---").join(" | ")} |`,
      ...rows.map((row) => `| ${row.map(escapeMarkdown).join(" | ")} |`)
    );
  }

  return lines.join("\n");
};
