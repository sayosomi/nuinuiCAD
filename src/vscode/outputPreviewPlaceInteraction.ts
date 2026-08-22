import type {
  OutputPlaceAuthoredValue,
  OutputPlaceProjection,
  OutputPlaceReferenceNavigation
} from "../output/outputPlaceProjection";
import type { NormalizedSourceRange } from "../dsl/dslNavigationQuery";
import {
  outputPreviewWorldToScreen,
  type OutputPreviewViewport,
  type OutputPreviewViewportSize
} from "./outputPreviewViewport";

export const OUTPUT_PREVIEW_PLACE_HANDLE_RADIUS_PX = 6;
export const OUTPUT_PREVIEW_PLACE_HANDLE_HIT_RADIUS_PX = 10;

export type OutputPreviewPlaceHandle = {
  placeId: string;
  projection: OutputPlaceProjection;
  screen: { x: number; y: number };
  cursor: "grab" | "default";
};

export type OutputPreviewPlaceReferenceTarget = {
  label: string;
  range: NormalizedSourceRange;
};

export type OutputPreviewPlacePropertyRow = {
  key: "at" | "origin" | "scale" | "angle" | "mirror";
  label: string;
  value: string;
  sourceRange: NormalizedSourceRange | null;
  referenceTargets: readonly OutputPreviewPlaceReferenceTarget[];
};

const finiteScreenPoint = (point: { x: number; y: number }): boolean =>
  Number.isFinite(point.x) && Number.isFinite(point.y);

export const outputPreviewPlaceHandlesFor = (
  projections: readonly OutputPlaceProjection[],
  size: OutputPreviewViewportSize,
  viewport: OutputPreviewViewport
): readonly OutputPreviewPlaceHandle[] => projections.flatMap((projection) => {
  const screen = outputPreviewWorldToScreen(projection.transformedOrigin, size, viewport);
  if (!finiteScreenPoint(screen)) return [];
  return [{
    placeId: projection.placeId,
    projection,
    screen,
    cursor: projection.dragability.draggable ? "grab" : "default"
  }];
});

export const outputPreviewPlaceCandidatesAtScreen = (
  handles: readonly OutputPreviewPlaceHandle[],
  point: { x: number; y: number },
  hitRadiusPx = OUTPUT_PREVIEW_PLACE_HANDLE_HIT_RADIUS_PX
): readonly OutputPreviewPlaceHandle[] => {
  if (!finiteScreenPoint(point) || !Number.isFinite(hitRadiusPx) || hitRadiusPx < 0) return [];
  const radiusSquared = hitRadiusPx * hitRadiusPx;
  return handles.filter((handle) => {
    const dx = handle.screen.x - point.x;
    const dy = handle.screen.y - point.y;
    return dx * dx + dy * dy <= radiusSquared;
  });
};

export const normalizedRangeForOutputPlaceValue = (
  value: OutputPlaceAuthoredValue,
  sourceRevision: number,
  sourceLength: number
): NormalizedSourceRange | null => {
  const span = value.sourceSpan;
  if (!span || span.sourceRevision !== sourceRevision || span.segments.length !== 1) return null;
  const segment = span.segments[0];
  if (
    !segment ||
    !Number.isInteger(segment.from) ||
    !Number.isInteger(segment.to) ||
    segment.from < 0 ||
    segment.to <= segment.from ||
    segment.to > sourceLength
  ) return null;
  return { from: segment.from, to: segment.to };
};

const referenceLabel = (sourceText: string, reference: OutputPlaceReferenceNavigation): string => {
  const text = sourceText.slice(reference.sourceRange.from, reference.sourceRange.to).trim();
  return text.length > 0 ? `@${text}` : "reference";
};

const referenceTargetsFor = (
  value: OutputPlaceAuthoredValue,
  sourceText: string
): readonly OutputPreviewPlaceReferenceTarget[] => value.references.flatMap((reference) => {
  if (
    reference.targetRange.from < 0 ||
    reference.targetRange.to <= reference.targetRange.from ||
    reference.targetRange.to > sourceText.length
  ) return [];
  return [{ label: referenceLabel(sourceText, reference), range: reference.targetRange }];
});

export const outputPreviewPlacePropertyRows = (
  projection: OutputPlaceProjection,
  sourceText: string
): readonly OutputPreviewPlacePropertyRow[] => {
  const values: readonly [OutputPreviewPlacePropertyRow["key"], string, OutputPlaceAuthoredValue | undefined][] = [
    ["at", "at", projection.authored.at],
    ["origin", "origin", projection.authored.origin],
    ["scale", "scale", projection.authored.scale],
    ["angle", "angle", projection.authored.angle],
    ["mirror", "mirror", projection.authored.mirror]
  ];
  return values.flatMap(([key, label, value]) => value ? [{
    key,
    label,
    value: value.text,
    sourceRange: normalizedRangeForOutputPlaceValue(value, projection.sourceRevision, sourceText.length),
    referenceTargets: referenceTargetsFor(value, sourceText)
  }] : []);
};

export const outputPreviewPlaceDragReason = (projection: OutputPlaceProjection): string | null => {
  if (projection.dragability.draggable) return null;
  const axes = projection.dragability.reason.issues.map(({ axis }) => axis.toUpperCase()).join("/");
  return axes.length > 0
    ? `Cannot drag: ${axes} in at must be direct finite numeric literals.`
    : "Cannot drag: at must use direct finite numeric literals.";
};
