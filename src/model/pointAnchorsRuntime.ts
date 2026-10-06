import type {
  CadElement,
  ComputedGeometry,
  ComputedPoint
} from "../types/geometry";
import type { ComputedGeometryValue, ComputedGeometryValuePoint } from "../geometry/evaluationTypes";
import type { ElementId, PointAnchor } from "@nuinuicad/nui-language";
import { derivedAnchor, referenceAnchor } from "@nuinuicad/nui-language";

export type SelectablePoint = {
  anchor: PointAnchor;
  label: string;
  point: ComputedPoint;
};

type DerivedPointSource = ComputedGeometry | ComputedGeometryValue;
type DerivedPointCoordinates = Pick<ComputedPoint, "x" | "y">;

const pointCoordinates = (
  point: ComputedPoint | DerivedPointCoordinates | null | undefined
): ComputedPoint | DerivedPointCoordinates | null => point ?? null;

const derivedPoint = (
  source: DerivedPointSource,
  pointKey: string
): ComputedPoint | DerivedPointCoordinates | null => {
  if (source.kind === "line") {
    if (pointKey === "start") return pointCoordinates(source.start);
    if (pointKey === "end") return pointCoordinates(source.end);
    return null;
  }

  if (source.kind === "arcLine") {
    if (pointKey === "center") return pointCoordinates(source.center);
    if (pointKey === "start") return pointCoordinates(source.start);
    if (pointKey === "end") return pointCoordinates(source.end);
    return null;
  }

  if (source.kind === "offsetLine") {
    if (pointKey === "start") return pointCoordinates(source.segments[0]?.start);
    if (pointKey === "end") return pointCoordinates(source.segments.at(-1)?.end);
    return null;
  }

  if (source.kind === "joinedPath") {
    if (pointKey === "start") return pointCoordinates(source.start);
    if (pointKey === "end") return pointCoordinates(source.end);
    return null;
  }

  if (source.kind === "polyline") {
    if (pointKey === "start") return pointCoordinates(source.start);
    if (pointKey === "end") return pointCoordinates(source.end);
    return null;
  }

  if (source.kind === "bezierCurve") {
    if (pointKey === "start") return pointCoordinates(source.segments[0]?.start);
    if (pointKey === "end") return pointCoordinates(source.segments.at(-1)?.end);
  }
  if (source.kind !== "bezierCurve") return null;
  if (!("intermediateSlotIds" in source)) return null;

  const intermediateId = pointKey.startsWith("intermediate:")
    ? pointKey.slice("intermediate:".length)
    : null;
  if (!intermediateId || source.kind !== "bezierCurve") return null;

  const index = source.intermediateSlotIds.indexOf(intermediateId);
  return index < 0 ? null : pointCoordinates(source.segments[index]?.end);
};

export function resolveDerivedPoint(
  source: ComputedGeometry | undefined,
  pointKey: string,
  _elementsById: Map<ElementId, CadElement>
): ComputedPoint | null;
export function resolveDerivedPoint(
  source: ComputedGeometryValue | undefined,
  pointKey: string,
  _elementsById: Map<ElementId, CadElement>
): ComputedGeometryValuePoint | null;
export function resolveDerivedPoint(
  source: DerivedPointSource | undefined,
  pointKey: string,
  _elementsById: Map<ElementId, CadElement>
): ComputedPoint | ComputedGeometryValuePoint | null;
export function resolveDerivedPoint(
  source: DerivedPointSource | undefined,
  pointKey: string,
  _elementsById: Map<ElementId, CadElement>
): ComputedPoint | ComputedGeometryValuePoint | null {
  void _elementsById;
  if (
    !source ||
    (
      source.kind !== "line" &&
      source.kind !== "arcLine" &&
      source.kind !== "bezierCurve" &&
      source.kind !== "offsetLine" &&
      source.kind !== "joinedPath" &&
      source.kind !== "polyline"
    )
  ) return null;
  const point = derivedPoint(source, pointKey);
  if (!point) return null;
  if ("elementId" in point) return point;
  return { kind: "point", x: point.x, y: point.y };
}

const computedPoint = (
  elementId: ElementId,
  name: string,
  point: { x: number; y: number }
): ComputedPoint => ({
  kind: "point",
  elementId,
  name,
  x: point.x,
  y: point.y
});

export const selectablePointsForGeometry = (
  geometry: ComputedGeometry,
  elementsById: Map<ElementId, CadElement>
): SelectablePoint[] => {
  if (geometry.kind === "point") {
    return [
      {
        anchor: referenceAnchor(geometry.elementId),
        label: geometry.name,
        point: geometry
      }
    ];
  }

  if (geometry.kind === "line") {
    return [
      {
        anchor: derivedAnchor(geometry.elementId, "start"),
        label: `${geometry.name}.始点`,
        point: computedPoint(`${geometry.elementId}:start`, `${geometry.name}.始点`, geometry.start)
      },
      {
        anchor: derivedAnchor(geometry.elementId, "end"),
        label: `${geometry.name}.終点`,
        point: computedPoint(`${geometry.elementId}:end`, `${geometry.name}.終点`, geometry.end)
      }
    ];
  }

  if (geometry.kind === "arcLine") {
    return [
      {
        anchor: derivedAnchor(geometry.elementId, "center"),
        label: `${geometry.name}.中心点`,
        point: computedPoint(`${geometry.elementId}:center`, `${geometry.name}.中心点`, geometry.center)
      },
      {
        anchor: derivedAnchor(geometry.elementId, "start"),
        label: `${geometry.name}.始点`,
        point: computedPoint(`${geometry.elementId}:start`, `${geometry.name}.始点`, geometry.start)
      },
      {
        anchor: derivedAnchor(geometry.elementId, "end"),
        label: `${geometry.name}.終点`,
        point: computedPoint(`${geometry.elementId}:end`, `${geometry.name}.終点`, geometry.end)
      }
    ];
  }

  if (geometry.kind === "offsetLine") {
    const start = geometry.segments[0]?.start;
    const end = geometry.segments.at(-1)?.end;
    return [
      ...(start
        ? [{
            anchor: derivedAnchor(geometry.elementId, "start"),
            label: `${geometry.name}.始点`,
            point: computedPoint(`${geometry.elementId}:start`, `${geometry.name}.始点`, start)
          }]
        : []),
      ...(end
        ? [{
            anchor: derivedAnchor(geometry.elementId, "end"),
            label: `${geometry.name}.終点`,
            point: computedPoint(`${geometry.elementId}:end`, `${geometry.name}.終点`, end)
          }]
        : [])
    ];
  }

  if (geometry.kind === "joinedPath") {
    return [
      ...(geometry.start
        ? [{
            anchor: derivedAnchor(geometry.elementId, "start"),
            label: `${geometry.name}.始点`,
            point: computedPoint(`${geometry.elementId}:start`, `${geometry.name}.始点`, geometry.start)
          }]
        : []),
      ...(geometry.end
        ? [{
            anchor: derivedAnchor(geometry.elementId, "end"),
            label: `${geometry.name}.終点`,
            point: computedPoint(`${geometry.elementId}:end`, `${geometry.name}.終点`, geometry.end)
          }]
        : [])
    ];
  }

  if (geometry.kind === "polyline") {
    return [
      {
        anchor: derivedAnchor(geometry.elementId, "start"),
        label: `${geometry.name}.始点`,
        point: computedPoint(`${geometry.elementId}:start`, `${geometry.name}.始点`, geometry.start)
      },
      {
        anchor: derivedAnchor(geometry.elementId, "end"),
        label: `${geometry.name}.終点`,
        point: computedPoint(`${geometry.elementId}:end`, `${geometry.name}.終点`, geometry.end)
      }
    ];
  }

  if (geometry.kind === "image" || geometry.kind === "text") {
    return [];
  }

  const element = elementsById.get(geometry.elementId);
  const points: SelectablePoint[] = [];
  const start = geometry.segments[0]?.start;
  const end = geometry.segments.at(-1)?.end;

  if (start) {
    points.push({
      anchor: derivedAnchor(geometry.elementId, "start"),
      label: `${geometry.name}.始点`,
      point: computedPoint(`${geometry.elementId}:start`, `${geometry.name}.始点`, start)
    });
  }

  if (geometry.kind === "bezierCurve" && element?.type === "bezierCurve") {
    element.intermediatePoints.forEach((intermediate, index) => {
      const segmentIndex = geometry.intermediateSlotIds.indexOf(intermediate.id);
      const point = segmentIndex < 0 ? undefined : geometry.segments[segmentIndex]?.end;
      if (!point) return;
      points.push({
        anchor: derivedAnchor(geometry.elementId, `intermediate:${intermediate.id}`),
        label: `${geometry.name}.中間点${index + 1}`,
        point: computedPoint(
          `${geometry.elementId}:intermediate:${intermediate.id}`,
          `${geometry.name}.中間点${index + 1}`,
          point
        )
      });
    });
  }

  if (end) {
    points.push({
      anchor: derivedAnchor(geometry.elementId, "end"),
      label: `${geometry.name}.終点`,
      point: computedPoint(`${geometry.elementId}:end`, `${geometry.name}.終点`, end)
    });
  }

  return points;
};

export const selectablePointsForElement = (
  element: CadElement,
  computedGeometry: Map<ElementId, ComputedGeometry>,
  elementsById: Map<ElementId, CadElement>
) => {
  const geometry = computedGeometry.get(element.id);
  return geometry ? selectablePointsForGeometry(geometry, elementsById) : [];
};
