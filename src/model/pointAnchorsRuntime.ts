import type {
  CadElement,
  ComputedBezierCurve,
  ComputedGeometry,
  ComputedLine,
  ComputedOffsetLine,
  ComputedPolyline,
  ComputedPoint
} from "../types/geometry";
import type { ElementId, PointAnchor } from "../../packages/nui-language/src/model/cadDocumentTypes";
import { derivedAnchor, referenceAnchor } from "../../packages/nui-language/src/model/pointAnchors";

export type SelectablePoint = {
  anchor: PointAnchor;
  label: string;
  point: ComputedPoint;
};

const derivedPoint = (
  source: ComputedLine | ComputedBezierCurve | ComputedOffsetLine | ComputedPolyline | Extract<ComputedGeometry, { kind: "arcLine" }>,
  pointKey: string
): ComputedPoint | null => {
  if (source.kind === "line") {
    if (pointKey === "start") return source.start;
    if (pointKey === "end") return source.end;
    return null;
  }

  if (source.kind === "arcLine") {
    if (pointKey === "center") return source.center;
    if (pointKey === "start") return source.start;
    if (pointKey === "end") return source.end;
    return null;
  }

  if (source.kind === "offsetLine") {
    if (pointKey === "start") return source.segments[0]?.start ?? null;
    if (pointKey === "end") return source.segments.at(-1)?.end ?? null;
    return null;
  }

  if (source.kind === "polyline") {
    if (pointKey === "start") return source.start;
    if (pointKey === "end") return source.end;
    return null;
  }

  if (source.kind === "bezierCurve") {
    if (pointKey === "start") return source.segments[0]?.start ?? null;
    if (pointKey === "end") return source.segments.at(-1)?.end ?? null;
  }
  if (source.kind !== "bezierCurve") return null;

  const intermediateId = pointKey.startsWith("intermediate:")
    ? pointKey.slice("intermediate:".length)
    : null;
  if (!intermediateId || source.kind !== "bezierCurve") return null;

  const index = source.intermediateSlotIds.indexOf(intermediateId);
  return index < 0 ? null : source.segments[index]?.end ?? null;
};

export const resolveDerivedPoint = (
  source: ComputedGeometry | undefined,
  pointKey: string,
  _elementsById: Map<ElementId, CadElement>
) => {
  void _elementsById;
  if (
    !source ||
    (
      source.kind !== "line" &&
      source.kind !== "arcLine" &&
      source.kind !== "bezierCurve" &&
      source.kind !== "offsetLine" &&
      source.kind !== "polyline"
    )
  ) return null;
  return derivedPoint(source, pointKey);
};

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
