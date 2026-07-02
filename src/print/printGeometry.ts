import { evaluateNumericValue } from "../geometry/numericExpressions";
import { parseForGroupGeneratedElementId } from "../model/forGroupGeneratedReferences";
import { descendantIdsForGroup } from "../model/groups";
import { resolveDerivedPoint } from "../model/pointAnchors";
import type {
  CadElement,
  ComputedArcLine,
  ComputedBezierCurve,
  ComputedGeometry,
  ComputedOffsetLine,
  ElementId,
  EvaluationResult,
  PointAnchor,
  PrintLayout,
  PrintLayoutPlacement
} from "../types/geometry";
import { printCanvasSizeMm } from "./printLayout";

export type PrintPoint = { x: number; y: number };

export type PrintablePath =
  | {
      kind: "line";
      elementId: ElementId;
      groupId: ElementId;
      placementId: string;
      start: PrintPoint;
      end: PrintPoint;
    }
  | {
      kind: "bezier";
      elementId: ElementId;
      groupId: ElementId;
      placementId: string;
      start: PrintPoint;
      control1: PrintPoint;
      control2: PrintPoint;
      end: PrintPoint;
    }
  | {
      kind: "polyline";
      elementId: ElementId;
      groupId: ElementId;
      placementId: string;
      points: PrintPoint[];
    };

export type PrintableGroup = Extract<CadElement, { type: "group" }> & {
  printEnabled: true;
};

export const printableGroups = (elements: CadElement[]): PrintableGroup[] =>
  elements.filter(
    (element): element is PrintableGroup => element.type === "group" && element.printEnabled === true
  );

const geometryTemplateId = (elementId: ElementId) =>
  parseForGroupGeneratedElementId(elementId)?.templateElementId ?? elementId;

const geometryBelongsToGroup = (
  geometry: ComputedGeometry,
  descendantIds: Set<ElementId>
) => descendantIds.has(geometryTemplateId(geometry.elementId));

const resolveAnchorPoint = ({
  anchor,
  group,
  elements,
  evaluation
}: {
  anchor: PointAnchor | undefined;
  group: CadElement;
  elements: CadElement[];
  evaluation: EvaluationResult;
}): PrintPoint => {
  const fallback = { x: 0, y: 0 };
  if (!anchor) return fallback;
  if (anchor.mode === "reference") {
    const point = evaluation.computedGeometry.get(anchor.pointId);
    return point?.kind === "point" ? { x: point.x, y: point.y } : fallback;
  }
  if (anchor.mode === "derived") {
    const source = evaluation.computedGeometry.get(anchor.elementId);
    const point = resolveDerivedPoint(source, anchor.pointKey, new Map(elements.map((element) => [element.id, element])));
    return point ? { x: point.x, y: point.y } : fallback;
  }

  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const x = evaluateNumericValue({
    value: anchor.x,
    computedGeometry: evaluation.computedGeometry,
    elementsById,
    currentElement: group,
    computedVariables: evaluation.computedVariables,
    elements
  }).value;
  const y = evaluateNumericValue({
    value: anchor.y,
    computedGeometry: evaluation.computedGeometry,
    elementsById,
    currentElement: group,
    computedVariables: evaluation.computedVariables,
    elements
  }).value;
  return {
    x: x ?? 0,
    y: y ?? 0
  };
};

export const transformPrintPoint = ({
  point,
  anchor,
  placement,
  scale
}: {
  point: PrintPoint;
  anchor: PrintPoint;
  placement: PrintLayoutPlacement;
  scale: number;
}): PrintPoint => {
  const localX = (point.x - anchor.x) * scale * (placement.mirrorX ? -1 : 1);
  const localY = (point.y - anchor.y) * scale;
  const angle = (placement.angleDeg * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: placement.x + localX * cos - localY * sin,
    y: placement.y + localX * sin + localY * cos
  };
};

const sampleArc = (arc: ComputedArcLine) => {
  const radius = Math.max(arc.radius, 0);
  const count = Math.max(8, Math.ceil(Math.abs(arc.sweepAngleDeg) / 8));
  return Array.from({ length: count + 1 }, (_, index) => {
    const angleDeg = arc.startAngleDeg + (arc.sweepAngleDeg * index) / count;
    const angle = (angleDeg * Math.PI) / 180;
    return {
      x: arc.center.x + Math.cos(angle) * radius,
      y: arc.center.y + Math.sin(angle) * radius
    };
  });
};

const transformPolyline = ({
  points,
  geometry,
  groupId,
  placement,
  anchor,
  scale
}: {
  points: PrintPoint[];
  geometry: ComputedGeometry;
  groupId: ElementId;
  placement: PrintLayoutPlacement;
  anchor: PrintPoint;
  scale: number;
}): PrintablePath => ({
  kind: "polyline",
  elementId: geometry.elementId,
  groupId,
  placementId: placement.id,
  points: points.map((point) => transformPrintPoint({ point, anchor, placement, scale }))
});

const pathsForGeometry = ({
  geometry,
  groupId,
  placement,
  anchor,
  scale
}: {
  geometry: ComputedGeometry;
  groupId: ElementId;
  placement: PrintLayoutPlacement;
  anchor: PrintPoint;
  scale: number;
}): PrintablePath[] => {
  if (geometry.kind === "line") {
    return [{
      kind: "line",
      elementId: geometry.elementId,
      groupId,
      placementId: placement.id,
      start: transformPrintPoint({ point: geometry.start, anchor, placement, scale }),
      end: transformPrintPoint({ point: geometry.end, anchor, placement, scale })
    }];
  }
  if (geometry.kind === "arcLine") {
    return [transformPolyline({ points: sampleArc(geometry), geometry, groupId, placement, anchor, scale })];
  }
  if (geometry.kind === "bezierCurve") {
    return (geometry as ComputedBezierCurve).segments.map((segment) => ({
      kind: "bezier",
      elementId: geometry.elementId,
      groupId,
      placementId: placement.id,
      start: transformPrintPoint({ point: segment.start, anchor, placement, scale }),
      control1: transformPrintPoint({ point: segment.control1, anchor, placement, scale }),
      control2: transformPrintPoint({ point: segment.control2, anchor, placement, scale }),
      end: transformPrintPoint({ point: segment.end, anchor, placement, scale })
    }));
  }
  if (geometry.kind === "offsetLine") {
    return (geometry as ComputedOffsetLine).segments.map((segment) => {
      if (segment.kind === "line") {
        return {
          kind: "line" as const,
          elementId: geometry.elementId,
          groupId,
          placementId: placement.id,
          start: transformPrintPoint({ point: segment.start, anchor, placement, scale }),
          end: transformPrintPoint({ point: segment.end, anchor, placement, scale })
        };
      }
      if (segment.kind === "bezier") {
        return {
          kind: "bezier" as const,
          elementId: geometry.elementId,
          groupId,
          placementId: placement.id,
          start: transformPrintPoint({ point: segment.start, anchor, placement, scale }),
          control1: transformPrintPoint({ point: segment.control1, anchor, placement, scale }),
          control2: transformPrintPoint({ point: segment.control2, anchor, placement, scale }),
          end: transformPrintPoint({ point: segment.end, anchor, placement, scale })
        };
      }
      const arc: ComputedArcLine = {
        kind: "arcLine",
        elementId: geometry.elementId,
        name: geometry.name,
        centerPointId: null,
        center: { ...segment.center, kind: "point", elementId: `${geometry.elementId}:center`, name: "" },
        start: { ...segment.start, kind: "point", elementId: `${geometry.elementId}:start`, name: "" },
        end: { ...segment.end, kind: "point", elementId: `${geometry.elementId}:end`, name: "" },
        radius: segment.radius,
        startAngleDeg: segment.startAngleDeg,
        endAngleDeg: segment.startAngleDeg + segment.sweepAngleDeg,
        startTangentAngleDeg: 0,
        endTangentAngleDeg: 0,
        sweepAngleDeg: segment.sweepAngleDeg,
        length: segment.length
      };
      return transformPolyline({ points: sampleArc(arc), geometry, groupId, placement, anchor, scale });
    });
  }
  return [];
};

export const printablePathsForLayout = ({
  elements,
  evaluation,
  layout
}: {
  elements: CadElement[];
  evaluation: EvaluationResult;
  layout: PrintLayout;
}) => {
  const geometries = Array.from(evaluation.computedGeometry.values());
  const visibleIds = evaluation.effectiveVisibleElementIds ?? new Set(elements.map((element) => element.id));
  const enabledIds = evaluation.effectiveEnabledElementIds ?? new Set(elements.map((element) => element.id));
  const groupsById = new Map(printableGroups(elements).map((group) => [group.id, group]));

  return layout.placements.flatMap((placement) => {
    const group = groupsById.get(placement.groupId);
    if (!group) return [];
    const descendants = new Set(descendantIdsForGroup(elements, group.id));
    const anchor = resolveAnchorPoint({
      anchor: group.printAnchor,
      group,
      elements,
      evaluation
    });
    return geometries
      .filter((geometry) => visibleIds.has(geometry.elementId) && enabledIds.has(geometry.elementId))
      .filter((geometry) => geometryBelongsToGroup(geometry, descendants))
      .flatMap((geometry) =>
        pathsForGeometry({
          geometry,
          groupId: group.id,
          placement,
          anchor,
          scale: layout.scale
        })
      );
  });
};

export const defaultPlacementForGroup = (
  groupId: ElementId,
  layout: PrintLayout
): PrintLayoutPlacement => {
  const canvas = printCanvasSizeMm(layout);
  let index = layout.placements.length + 1;
  const existingIds = new Set(layout.placements.map((placement) => placement.id));
  while (existingIds.has(`placement-${index}`)) {
    index += 1;
  }
  return {
    id: `placement-${index}`,
    groupId,
    x: Math.round(canvas.widthMm / 2),
    y: Math.round(canvas.heightMm / 2),
    angleDeg: 0,
    mirrorX: false
  };
};
