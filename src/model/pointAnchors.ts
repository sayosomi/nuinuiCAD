import type {
  CadElement,
  ComputedBezierCurve,
  ComputedGeometry,
  ComputedLine,
  ComputedPoint,
  ElementId,
  PointAnchor
} from "../types/geometry";

export type SelectablePoint = {
  anchor: PointAnchor;
  label: string;
  point: ComputedPoint;
};

export const referenceAnchor = (pointId: ElementId): PointAnchor => ({
  mode: "reference",
  pointId
});

export const derivedAnchor = (elementId: ElementId, pointKey: string): PointAnchor => ({
  mode: "derived",
  elementId,
  pointKey
});

export const anchorReferenceElementId = (anchor: PointAnchor) => {
  if (anchor.mode === "reference") return anchor.pointId;
  if (anchor.mode === "derived") return anchor.elementId;
  return null;
};

export const anchorEquals = (a: PointAnchor | null, b: PointAnchor | null) => {
  if (!a || !b || a.mode !== b.mode) return false;
  if (a.mode === "reference" && b.mode === "reference") return a.pointId === b.pointId;
  if (a.mode === "derived" && b.mode === "derived") {
    return a.elementId === b.elementId && a.pointKey === b.pointKey;
  }
  if (a.mode === "coordinate" && b.mode === "coordinate") {
    return a.x === b.x && a.y === b.y;
  }
  return false;
};

export const isPointElement = (element: CadElement) =>
  element.type === "freePoint" ||
  element.type === "offsetPoint" ||
  element.type === "polarOffsetPoint";

export const pointAnchorForElement = (element: CadElement): PointAnchor | null => {
  if (element.type === "offsetPoint" || element.type === "polarOffsetPoint") {
    return element.fromPoint ?? (element.fromPointId ? referenceAnchor(element.fromPointId) : null);
  }
  return null;
};

const derivedPoint = (
  source: ComputedLine | ComputedBezierCurve | Extract<ComputedGeometry, { kind: "arcLine" }>,
  pointKey: string,
  elementsById: Map<ElementId, CadElement>
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

  if (pointKey === "start") return source.segments[0]?.start ?? null;
  if (pointKey === "end") return source.segments.at(-1)?.end ?? null;

  const intermediateId = pointKey.startsWith("intermediate:")
    ? pointKey.slice("intermediate:".length)
    : null;
  const element = elementsById.get(source.elementId);
  if (!intermediateId || element?.type !== "bezierCurve") return null;

  const index = element.intermediatePoints.findIndex((point) => point.id === intermediateId);
  return index < 0 ? null : source.segments[index]?.end ?? null;
};

export const resolveDerivedPoint = (
  source: ComputedGeometry | undefined,
  pointKey: string,
  elementsById: Map<ElementId, CadElement>
) => {
  if (!source || (source.kind !== "line" && source.kind !== "arcLine" && source.kind !== "bezierCurve")) return null;
  return derivedPoint(source, pointKey, elementsById);
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

  if (element?.type === "bezierCurve") {
    element.intermediatePoints.forEach((intermediate, index) => {
      const point = geometry.segments[index]?.end;
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

export const pointAnchorOptions = (elements: CadElement[]): PointAnchor[] =>
  elements.flatMap((element) => {
    if (isPointElement(element)) return [referenceAnchor(element.id)];
    if (element.type === "line") {
      return [derivedAnchor(element.id, "start"), derivedAnchor(element.id, "end")];
    }
    if (element.type === "arcLine") {
      return [
        derivedAnchor(element.id, "center"),
        derivedAnchor(element.id, "start"),
        derivedAnchor(element.id, "end")
      ];
    }
    if (element.type === "bezierCurve") {
      return [
        derivedAnchor(element.id, "start"),
        ...element.intermediatePoints.map((point) =>
          derivedAnchor(element.id, `intermediate:${point.id}`)
        ),
        derivedAnchor(element.id, "end")
      ];
    }
    return [];
  });

export const pointAnchorLabel = (anchor: PointAnchor, elements: CadElement[]) => {
  if (anchor.mode === "coordinate") return "座標";
  if (anchor.mode === "reference") {
    return elements.find((element) => element.id === anchor.pointId)?.name ?? anchor.pointId;
  }

  const element = elements.find((item) => item.id === anchor.elementId);
  const elementName = element?.name ?? anchor.elementId;
  if (anchor.pointKey === "start") return `${elementName}.始点`;
  if (anchor.pointKey === "end") return `${elementName}.終点`;
  if (anchor.pointKey.startsWith("intermediate:") && element?.type === "bezierCurve") {
    const intermediateId = anchor.pointKey.slice("intermediate:".length);
    const index = element.intermediatePoints.findIndex((point) => point.id === intermediateId);
    return `${elementName}.中間点${index >= 0 ? index + 1 : intermediateId}`;
  }
  if (anchor.pointKey === "center") return `${elementName}.中心点`;
  return `${elementName}.${anchor.pointKey}`;
};
