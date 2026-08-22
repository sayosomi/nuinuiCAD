import { constrainedWorldDelta, type AxisLockKeys } from "../components/canvasViewport";
import type { NormalizedSourceRange } from "../dsl/dslNavigationQuery";
import type { OutputPlan } from "../output/outputCore";
import type { OutputPlaceProjection } from "../output/outputPlaceProjection";
import { numericLiteralForExpression } from "../scalars/numericLiteral";
import { normalizedRangeForOutputPlaceValue } from "./outputPreviewPlaceInteraction";

export type OutputPreviewPlaceDragPlanIdentity = Pick<OutputPlan, "kind" | "outputId" | "layoutId">;

export type OutputPreviewPlaceDragProof = {
  placeId: string;
  documentVersion: number;
  sourceRevision: number;
  normalizedSourceSnapshot: string;
  planIdentity: string;
  statementRange: NormalizedSourceRange;
  x: {
    range: NormalizedSourceRange;
    sourceText: string;
    literal: number;
  };
  y: {
    range: NormalizedSourceRange;
    sourceText: string;
    literal: number;
  };
};

export type OutputPreviewPlaceCoordinatePatch = {
  range: NormalizedSourceRange;
  expectedText: string;
  replacement: string;
};

const rangeContains = (outer: NormalizedSourceRange, inner: NormalizedSourceRange): boolean =>
  outer.from <= inner.from && inner.to <= outer.to;

const exactRangeText = (
  source: string,
  range: NormalizedSourceRange,
  expectedText: string
): boolean => source.slice(range.from, range.to) === expectedText;

export const outputPreviewPlaceDragPlanIdentityFor = (
  plan: OutputPreviewPlaceDragPlanIdentity
): string => `${plan.kind}:${plan.outputId}:${plan.layoutId}`;

/**
 * Captures all source/plan facts that make one Output Preview place drag safe.
 * The returned proof is immutable gesture input; callers must discard it when
 * any authoritative host/source/plan identity changes.
 */
export const beginOutputPreviewPlaceDrag = ({
  projection,
  normalizedSource,
  currentSourceRevision,
  documentVersion,
  plan
}: {
  projection: OutputPlaceProjection;
  normalizedSource: string;
  currentSourceRevision: number;
  documentVersion: number | null;
  plan: OutputPreviewPlaceDragPlanIdentity;
}): OutputPreviewPlaceDragProof | null => {
  if (
    documentVersion === null ||
    !Number.isInteger(documentVersion) ||
    documentVersion < 0 ||
    projection.sourceRevision !== currentSourceRevision ||
    projection.layoutId !== plan.layoutId ||
    !projection.dragability.draggable
  ) return null;

  const xValue = projection.authored.at.x;
  const yValue = projection.authored.at.y;
  if (!xValue || !yValue) return null;

  const xRange = normalizedRangeForOutputPlaceValue(xValue, currentSourceRevision, normalizedSource.length);
  const yRange = normalizedRangeForOutputPlaceValue(yValue, currentSourceRevision, normalizedSource.length);
  if (
    !xRange ||
    !yRange ||
    !rangeContains(projection.statementRange, xRange) ||
    !rangeContains(projection.statementRange, yRange) ||
    xRange.to > yRange.from ||
    !exactRangeText(normalizedSource, xRange, xValue.text) ||
    !exactRangeText(normalizedSource, yRange, yValue.text)
  ) return null;

  const { x, y } = projection.dragability.literals;
  if (
    Number(xValue.text.trim()) !== x ||
    Number(yValue.text.trim()) !== y
  ) return null;

  return {
    placeId: projection.placeId,
    documentVersion,
    sourceRevision: currentSourceRevision,
    normalizedSourceSnapshot: normalizedSource,
    planIdentity: outputPreviewPlaceDragPlanIdentityFor(plan),
    statementRange: { ...projection.statementRange },
    x: { range: xRange, sourceText: xValue.text, literal: x },
    y: { range: yRange, sourceText: yValue.text, literal: y }
  };
};

export const outputPreviewPlaceDragCoordinatesFor = ({
  proof,
  screenDx,
  screenDy,
  zoom,
  axisLockKeys
}: {
  proof: OutputPreviewPlaceDragProof;
  screenDx: number;
  screenDy: number;
  zoom: number;
  axisLockKeys: AxisLockKeys;
}): { x: number; y: number } | null => {
  if (
    !Number.isFinite(screenDx) ||
    !Number.isFinite(screenDy) ||
    !Number.isFinite(zoom) ||
    zoom <= 0
  ) return null;
  const delta = constrainedWorldDelta({ screenDx, screenDy, zoom, axisLockKeys });
  const x = proof.x.literal + delta.dx;
  const y = proof.y.literal + delta.dy;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
};

export const outputPreviewPlaceCoordinatePatchesFor = (
  proof: OutputPreviewPlaceDragProof,
  coordinates: { x: number; y: number }
): readonly OutputPreviewPlaceCoordinatePatch[] | null => {
  const x = numericLiteralForExpression(coordinates.x);
  const y = numericLiteralForExpression(coordinates.y);
  if (x === null || y === null) return null;
  return [
    { range: proof.x.range, expectedText: proof.x.sourceText, replacement: x },
    { range: proof.y.range, expectedText: proof.y.sourceText, replacement: y }
  ];
};

/** Creates transient normalized source only from the exact drag-begin snapshot. */
export const outputPreviewPlacePreviewSourceFor = (
  proof: OutputPreviewPlaceDragProof,
  coordinates: { x: number; y: number }
): string | null => {
  const patches = outputPreviewPlaceCoordinatePatchesFor(proof, coordinates);
  if (!patches) return null;
  if (patches.some((patch) => !exactRangeText(
    proof.normalizedSourceSnapshot,
    patch.range,
    patch.expectedText
  ))) return null;

  let result = proof.normalizedSourceSnapshot;
  for (const patch of [...patches].sort((left, right) => right.range.from - left.range.from)) {
    result = `${result.slice(0, patch.range.from)}${patch.replacement}${result.slice(patch.range.to)}`;
  }
  return result;
};
