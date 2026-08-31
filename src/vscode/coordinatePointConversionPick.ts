import { anchorEquals } from "../model/pointAnchors";
import type { PointAnchor, ElementId } from "../types/geometry";
import type { ParameterKey } from "../parameters/parameterDefinitions";
import { sourceReferenceText, type CanonicalGeometrySourceReference } from "../model/moduleSemanticCandidateBoundary";
import type { CoordinatePointConversionSession } from "../commands/coordinatePointConversionSession";

export const COORDINATE_POINT_CONVERSION_PICK_TARGET_ID = "__coordinate-point-conversion__" as ElementId;
export const COORDINATE_POINT_CONVERSION_PICK_PARAMETER_KEY = "base" as ParameterKey;

export const coordinatePointConversionPickTarget = () => ({
  elementId: COORDINATE_POINT_CONVERSION_PICK_TARGET_ID,
  parameterKey: COORDINATE_POINT_CONVERSION_PICK_PARAMETER_KEY,
  insertionIndex: Number.MAX_SAFE_INTEGER
});

export const isCoordinatePointConversionPickTarget = (
  target: { elementId: string; parameterKey: string } | null | undefined
): boolean => target?.elementId === COORDINATE_POINT_CONVERSION_PICK_TARGET_ID &&
  target.parameterKey === COORDINATE_POINT_CONVERSION_PICK_PARAMETER_KEY;

export const coordinatePointConversionBaseKeyForPick = ({
  session,
  anchor,
  sourceReference
}: {
  session: CoordinatePointConversionSession;
  anchor: PointAnchor;
  sourceReference?: CanonicalGeometrySourceReference;
}): string | null => {
  const sourceText = sourceReference ? sourceReferenceText(sourceReference) : null;
  return session.baseCandidates.find((candidate) => {
    if (!anchorEquals(candidate.anchor, anchor)) return false;
    if (!sourceText) return true;
    const candidateReference = session.targetIds
      .map((targetId) => candidate.referencesByTargetId.get(targetId))
      .find((value) => value !== undefined);
    return sourceReferenceText(candidateReference ?? null) === sourceText;
  })?.key ?? null;
};
