import {
  hitTestPointPickCandidates,
  type PointPickHitTarget
} from "../components/canvasInteractionHitTest";
import type {
  CanvasGeometryHitCandidate,
  ScreenPoint
} from "../components/DrawingCanvasHitTest";
import type {
  ReferencePickCandidate,
  ReferencePickPointOption
} from "./referencePickCandidates";

export type ReferencePickPointHit = PointPickHitTarget & {
  candidateElementId: string;
  option: ReferencePickPointOption;
};

export const hitTestReferencePickPoints = ({
  screen,
  candidates,
  worldToScreen,
  hitRadiusPx = 8
}: {
  screen: ScreenPoint;
  candidates: readonly ReferencePickCandidate[];
  worldToScreen: (point: { x: number; y: number }) => ScreenPoint;
  hitRadiusPx?: number;
}): ReferencePickPointHit[] => {
  const pointTargets = candidates.flatMap<ReferencePickPointHit>((candidate) =>
    candidate.options.flatMap((option) => option.kind === "point"
      ? [{
          candidateElementId: candidate.elementId,
          option,
          screen: worldToScreen(option.point)
        }]
      : [])
  );
  return hitTestPointPickCandidates(screen, pointTargets, hitRadiusPx);
};

/** Canvas keeps ownership of geometric hit testing and draw-order ranking.
 * Reference Pick only removes hits that are not valid candidates for the
 * current Source target. */
export const filterReferencePickGeometryHits = (
  hits: readonly CanvasGeometryHitCandidate[],
  candidates: readonly ReferencePickCandidate[]
): CanvasGeometryHitCandidate[] => {
  const eligibleIds = new Set(
    candidates
      .filter((candidate) => candidate.options.some((option) =>
        option.kind === "geometry" || option.kind === "numericProperty"
      ))
      .map((candidate) => candidate.elementId)
  );
  return hits.filter((hit) => eligibleIds.has(hit.elementId));
};
