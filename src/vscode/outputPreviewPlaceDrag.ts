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

const DIRECT_NUMERIC_LITERAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

const rangeContains = (outer: NormalizedSourceRange, inner: NormalizedSourceRange): boolean =>
  outer.from <= inner.from && inner.to <= outer.to;

const exactRangeText = (
  source: string,
  range: NormalizedSourceRange,
  expectedText: string
): boolean => source.slice(range.from, range.to) === expectedText;

const safeNormalizedRange = (range: NormalizedSourceRange, sourceLength: number): boolean =>
  Number.isInteger(range.from) &&
  Number.isInteger(range.to) &&
  range.from >= 0 &&
  range.to > range.from &&
  range.to <= sourceLength;

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

/** Re-validates the immutable drag-begin proof against authoritative state. */
export const outputPreviewPlaceDragProofIsCurrent = ({
  proof,
  normalizedSource,
  currentSourceRevision,
  documentVersion,
  plan
}: {
  proof: OutputPreviewPlaceDragProof;
  normalizedSource: string;
  currentSourceRevision: number;
  documentVersion: number | null;
  plan: OutputPreviewPlaceDragPlanIdentity | null;
}): boolean => Boolean(
  plan &&
  documentVersion === proof.documentVersion &&
  currentSourceRevision === proof.sourceRevision &&
  normalizedSource === proof.normalizedSourceSnapshot &&
  outputPreviewPlaceDragPlanIdentityFor(plan) === proof.planIdentity &&
  rangeContains(proof.statementRange, proof.x.range) &&
  rangeContains(proof.statementRange, proof.y.range) &&
  proof.x.range.to <= proof.y.range.from &&
  exactRangeText(normalizedSource, proof.x.range, proof.x.sourceText) &&
  exactRangeText(normalizedSource, proof.y.range, proof.y.sourceText)
);

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

const coordinatePatchFor = (
  coordinate: OutputPreviewPlaceDragProof["x"],
  value: number
): OutputPreviewPlaceCoordinatePatch | null => {
  if (value === coordinate.literal) return null;
  const replacement = numericLiteralForExpression(value);
  if (replacement === null) return null;
  return {
    range: coordinate.range,
    expectedText: coordinate.sourceText,
    replacement
  };
};

export const outputPreviewPlaceCoordinatePatchesFor = (
  proof: OutputPreviewPlaceDragProof,
  coordinates: { x: number; y: number }
): readonly OutputPreviewPlaceCoordinatePatch[] | null => {
  if (!Number.isFinite(coordinates.x) || !Number.isFinite(coordinates.y)) return null;
  const x = coordinatePatchFor(proof.x, coordinates.x);
  const y = coordinatePatchFor(proof.y, coordinates.y);
  return [x, y].filter((patch): patch is OutputPreviewPlaceCoordinatePatch => patch !== null);
};

/**
 * Host-side fail-closed validation for the exact coordinate patches emitted by
 * one drag. This validates only source ownership/safety, not parsing semantics.
 */
export const outputPreviewPlaceCoordinatePatchesAreSafe = ({
  normalizedSource,
  statementRange,
  patches
}: {
  normalizedSource: string;
  statementRange: NormalizedSourceRange;
  patches: readonly OutputPreviewPlaceCoordinatePatch[];
}): boolean => {
  if (
    !safeNormalizedRange(statementRange, normalizedSource.length) ||
    patches.length < 1 ||
    patches.length > 2
  ) return false;

  const ordered = [...patches].sort((left, right) => left.range.from - right.range.from);
  for (let index = 0; index < ordered.length; index += 1) {
    const patch = ordered[index]!;
    const previous = ordered[index - 1];
    const replacement = patch.replacement.trim();
    if (
      !safeNormalizedRange(patch.range, normalizedSource.length) ||
      !rangeContains(statementRange, patch.range) ||
      (previous !== undefined && previous.range.to > patch.range.from) ||
      patch.expectedText.length === 0 ||
      !exactRangeText(normalizedSource, patch.range, patch.expectedText) ||
      !DIRECT_NUMERIC_LITERAL.test(replacement) ||
      !Number.isFinite(Number(replacement))
    ) return false;
  }
  return true;
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
