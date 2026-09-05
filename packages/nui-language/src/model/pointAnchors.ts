import type { CadElement, ElementId, LineEndpointReference, PointAnchor } from "../types/geometry";

export type PointAnchorGeometryCategory = "point" | "line" | "curve" | "arc" | "text" | "image";

/** Canonical source-level derived-point accessor vocabulary. */
export const isKnownDerivedPointKey = (pointKey: string): boolean =>
  pointKey === "start" ||
  pointKey === "end" ||
  pointKey === "center" ||
  (pointKey.startsWith("intermediate:") && pointKey.length > "intermediate:".length);

export const isDerivedPointKeyForGeometryCategory = (
  category: PointAnchorGeometryCategory,
  pointKey: string
): boolean => {
  if (!isKnownDerivedPointKey(pointKey)) return false;
  if (category === "line") return pointKey === "start" || pointKey === "end";
  if (category === "curve") return pointKey === "start" || pointKey === "end" || pointKey.startsWith("intermediate:");
  if (category === "arc") return pointKey === "start" || pointKey === "end" || pointKey === "center";
  return false;
};

export const isLineEndpointPointKey = (pointKey: string): boolean => pointKey === "start" || pointKey === "end";

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
  element.type === "polarOffsetPoint" ||
  element.type === "divisionPoint" ||
  element.type === "lineDivisionPoint" ||
  element.type === "intersectionPoint" ||
  element.type === "lineTangentOffsetPoint" ||
  element.type === "bezierExtremePoint" ||
  element.type === "bezierBulgePoint";

export const pointAnchorForElement = (element: CadElement): PointAnchor | null => {
  if (element.type === "offsetPoint" || element.type === "polarOffsetPoint") {
    return element.fromPoint ?? (element.fromPointId ? referenceAnchor(element.fromPointId) : null);
  }
  return null;
};

export const pointAnchorOptions = (elements: CadElement[]): PointAnchor[] =>
  elements.flatMap((element) => {
    if (isPointElement(element)) return [referenceAnchor(element.id)];
    if (element.type === "line" || element.type === "commonTangentLine") {
      return [derivedAnchor(element.id, "start"), derivedAnchor(element.id, "end")];
    }
    if (element.type === "arcLine" || element.type === "threePointArcLine") {
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
    if (element.type === "offsetLine") {
      return [derivedAnchor(element.id, "start"), derivedAnchor(element.id, "end")];
    }
    if (element.type === "polyline") {
      return [derivedAnchor(element.id, "start"), derivedAnchor(element.id, "end")];
    }
    if (element.type === "splitLine") {
      return [derivedAnchor(element.id, "start"), derivedAnchor(element.id, "end")];
    }
    if (element.type === "copyLine") {
      return [derivedAnchor(element.id, "start"), derivedAnchor(element.id, "end")];
    }
    if (element.type === "symmetricCopyLine") {
      return [derivedAnchor(element.id, "start"), derivedAnchor(element.id, "end")];
    }
    return [];
  });

export const derivedPointLabel = (
  elementId: ElementId,
  pointKey: string,
  elements: CadElement[] | Map<ElementId, CadElement>
) => {
  const element = Array.isArray(elements)
    ? elements.find((item) => item.id === elementId)
    : elements.get(elementId);
  const elementName = element?.name ?? elementId;
  if (pointKey === "start") return `${elementName}.始点`;
  if (pointKey === "end") return `${elementName}.終点`;
  if (pointKey === "center") return `${elementName}.中心点`;
  if (pointKey.startsWith("intermediate:") && element?.type === "bezierCurve") {
    const intermediateId = pointKey.slice("intermediate:".length);
    const index = element.intermediatePoints.findIndex((point) => point.id === intermediateId);
    return `${elementName}.中間点${index >= 0 ? index + 1 : intermediateId}`;
  }
  return `${elementName}.${pointKey}`;
};

export const pointAnchorLabel = (anchor: PointAnchor, elements: CadElement[]) => {
  if (anchor.mode === "coordinate") return "座標";
  if (anchor.mode === "reference") {
    return elements.find((element) => element.id === anchor.pointId)?.name ?? anchor.pointId;
  }

  return derivedPointLabel(anchor.elementId, anchor.pointKey, elements);
};

export const isLineLikeElement = (element: CadElement) =>
  element.type === "line" ||
  element.type === "angleLengthLine" ||
  element.type === "commonTangentLine" ||
  element.type === "arcLine" ||
  element.type === "threePointArcLine" ||
  element.type === "cornerRadiusArcLine" ||
  element.type === "bezierCurve" ||
  element.type === "offsetLine" ||
  element.type === "polyline" ||
  element.type === "splitLine" ||
  element.type === "copyLine" ||
  element.type === "symmetricCopyLine";

export const lineEndpointReferenceOptions = (elements: CadElement[]): LineEndpointReference[] =>
  elements.flatMap((element) =>
    isLineLikeElement(element)
      ? [
          { lineId: element.id, endpointKey: "start" as const },
          { lineId: element.id, endpointKey: "end" as const }
        ]
      : []
  );

export const lineEndpointReferenceEquals = (
  a: LineEndpointReference | null,
  b: LineEndpointReference | null
) => Boolean(a && b && a.lineId === b.lineId && a.endpointKey === b.endpointKey);

export const lineEndpointReferenceForAnchor = (
  anchor: PointAnchor,
  elements: CadElement[]
): LineEndpointReference | null => {
  if (anchor.mode !== "derived" || (anchor.pointKey !== "start" && anchor.pointKey !== "end")) {
    return null;
  }

  const element = elements.find((item) => item.id === anchor.elementId);
  if (!element || !isLineLikeElement(element)) return null;

  return {
    lineId: anchor.elementId,
    endpointKey: anchor.pointKey
  };
};

export const lineEndpointReferenceLabel = (
  endpoint: LineEndpointReference,
  elements: CadElement[]
) => {
  const element = elements.find((item) => item.id === endpoint.lineId);
  const lineName = element?.name ?? endpoint.lineId;
  return `${lineName}.${endpoint.endpointKey === "start" ? "始点" : "終点"}`;
};
