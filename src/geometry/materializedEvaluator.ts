import type { CadElement, ComputedGeometry, GeometryInputTarget } from "../types/geometry";
import type {
  ComputedGeometryValue,
  ComputedOffsetLineSegment,
  ComputedPoint
} from "./evaluationTypes";
import type { ElementEvaluationContext } from "./elementEvaluatorTypes";
import { geometryError } from "./evaluationContext";
import { geometryValueOccurrenceKey } from "@nuinuicad/nui-language";

const point = (element: CadElement, key: string, value: { x: number; y: number }): ComputedPoint => ({
  kind: "point",
  elementId: `${element.id}:${key}`,
  name: `${element.name}.${key}`,
  x: value.x,
  y: value.y
});

const materializeValue = (element: CadElement, value: ComputedGeometryValue): ComputedGeometry => {
  switch (value.kind) {
    case "point":
      return { kind: "point", elementId: element.id, name: element.name, x: value.x, y: value.y };
    case "line": {
      const start = point(element, "start", value.start);
      const end = point(element, "end", value.end);
      return {
        kind: "line", elementId: element.id, name: element.name,
        startPointId: start.elementId, endPointId: end.elementId, start, end,
        length: value.length, startAngleDeg: value.startAngleDeg, endAngleDeg: value.endAngleDeg,
        startTangentAngleDeg: value.startTangentAngleDeg, endTangentAngleDeg: value.endTangentAngleDeg
      };
    }
    case "arcLine": {
      const center = point(element, "center", value.center);
      const start = point(element, "start", value.start);
      const end = point(element, "end", value.end);
      return {
        kind: "arcLine", elementId: element.id, name: element.name,
        centerPointId: center.elementId, center, start, end,
        radius: value.radius, startAngleDeg: value.startAngleDeg, endAngleDeg: value.endAngleDeg,
        startTangentAngleDeg: value.startTangentAngleDeg, endTangentAngleDeg: value.endTangentAngleDeg,
        sweepAngleDeg: value.sweepAngleDeg, length: value.length
      };
    }
    case "bezierCurve": {
      const segments = value.segments.map((segment, index) => ({
        startPointId: `${element.id}:segment${index}:start`,
        endPointId: `${element.id}:segment${index}:end`,
        start: point(element, `segment${index}:start`, segment.start),
        control1: { ...segment.control1 },
        control2: { ...segment.control2 },
        end: point(element, `segment${index}:end`, segment.end)
      }));
      const first = segments[0];
      const last = segments.at(-1);
      return {
        kind: "bezierCurve", elementId: element.id, name: element.name,
        startPointId: first?.startPointId ?? null, endPointId: last?.endPointId ?? null,
        intermediatePointIds: [], intermediateSlotIds: [], segments, length: value.length,
        startTangentAngleDeg: null, endTangentAngleDeg: null,
        startHandleAngleDeg: 0, startHandleLength: 0, endHandleAngleDeg: 0, endHandleLength: 0
      };
    }
    case "polyline": {
      const segments = value.segments.map((segment, index) => ({
        kind: "line" as const,
        start: point(element, `segment${index}:start`, segment.start),
        end: point(element, `segment${index}:end`, segment.end),
        length: segment.length
      }));
      return {
        kind: "polyline", elementId: element.id, name: element.name, segments, closed: value.closed,
        start: point(element, "start", value.start), end: point(element, "end", value.end), length: value.length,
        startTangentAngleDeg: value.startTangentAngleDeg, endTangentAngleDeg: value.endTangentAngleDeg
      };
    }
    case "offsetLine":
    case "joinedPath": {
      const segments: ComputedOffsetLineSegment[] = value.segments.map((segment, index) => {
        if (segment.kind === "line") {
          return { kind: "line" as const, start: point(element, `segment${index}:start`, segment.start), end: point(element, `segment${index}:end`, segment.end), length: segment.length };
        }
        if (segment.kind === "bezier") {
          return { kind: "bezier" as const, start: point(element, `segment${index}:start`, segment.start), control1: { ...segment.control1 }, control2: { ...segment.control2 }, end: point(element, `segment${index}:end`, segment.end), length: segment.length };
        }
        return {
          kind: "arc" as const,
          center: point(element, `segment${index}:center`, segment.center),
          start: point(element, `segment${index}:start`, segment.start),
          end: point(element, `segment${index}:end`, segment.end),
          radius: segment.radius, startAngleDeg: segment.startAngleDeg, sweepAngleDeg: segment.sweepAngleDeg, length: segment.length
        };
      });
      return {
        kind: value.kind, elementId: element.id, name: element.name,
        ...(value.kind === "offsetLine" ? { baseLineIds: [] } : { pathIds: [] }),
        start: value.start ? point(element, "start", value.start) : null,
        end: value.end ? point(element, "end", value.end) : null,
        segments, closed: value.closed, length: value.length,
        startTangentAngleDeg: value.startTangentAngleDeg, endTangentAngleDeg: value.endTangentAngleDeg
      } as ComputedGeometry;
    }
  }
};

const cloneWithDestinationIdentity = (element: CadElement, source: ComputedGeometry): ComputedGeometry => {
  const value = source.kind === "point"
    ? { kind: "point" as const, x: source.x, y: source.y }
    : undefined;
  if (value) return materializeValue(element, value);
  // Keep the concrete source family and all computed shape data. A structured
  // clone gives the destination its own mutable runtime object. Re-key nested
  // computed points as well, so hit-testing, properties, and later recipes
  // observe the destination's ordinary design-object identity throughout.
  const clone = structuredClone(source) as ComputedGeometry;
  const sourcePrefix = `${source.elementId}:`;
  const sourceNamePrefix = `${source.name}.`;
  const remap = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(remap);
      return;
    }
    if (!value || typeof value !== "object") return;
    const object = value as Record<string, unknown>;
    if (object.kind === "point" && typeof object.elementId === "string") {
      const sourcePointId = object.elementId;
      const suffix = sourcePointId.startsWith(sourcePrefix)
        ? sourcePointId.slice(sourcePrefix.length)
        : sourcePointId;
      object.elementId = `${element.id}:${suffix}`;
      if (typeof object.name === "string") {
        object.name = object.name.startsWith(sourceNamePrefix)
          ? `${element.name}.${object.name.slice(sourceNamePrefix.length)}`
          : `${element.name}.${suffix}`;
      }
    }
    Object.values(object).forEach(remap);
  };
  remap(clone);
  clone.elementId = element.id;
  clone.name = element.name;
  return clone;
};

const sourceTarget = (context: ElementEvaluationContext): GeometryInputTarget | undefined => {
  const target = context.geometryInputTargets?.get("source");
  if (!target) return undefined;
  return "kind" in target ? target : target[0];
};

const sourceGeometry = (
  context: ElementEvaluationContext,
  target: GeometryInputTarget
): ComputedGeometry | ComputedGeometryValue | undefined => {
  if (target.kind === "drawable") {
    return context.resolveGeometrySnapshot
      ? context.resolveGeometrySnapshot(target.elementId, target.stagePath)
      : context.computedGeometry.get(target.elementId);
  }
  if (target.kind === "geometryValue") {
    return context.computedGeometryValues?.get(geometryValueOccurrenceKey(target.occurrence))?.value;
  }
  return undefined;
};

export const evaluateMaterializedElement = (element: CadElement, context: ElementEvaluationContext): boolean => {
  if (element.type !== "materializedPoint" && element.type !== "materializedLine" && element.type !== "materializedPath") return false;
  const target = sourceTarget(context);
  const source = target ? sourceGeometry(context, target) : undefined;
  if (!source) {
    context.errors.push(geometryError(element, `${element.name} の source geometry が利用できません。依存先を確認してください。`));
    return true;
  }
  const materialized = "elementId" in source
    ? cloneWithDestinationIdentity(element, source as ComputedGeometry)
    : materializeValue(element, source as ComputedGeometryValue);
  context.computedGeometry.set(element.id, materialized);
  return true;
};
