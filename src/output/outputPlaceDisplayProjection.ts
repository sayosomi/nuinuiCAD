import {
  rebuildOutputPlanFromResolvedPlacements,
  type OutputDrawable,
  type OutputPath,
  type OutputPathSegment,
  type OutputPlan,
  type OutputPoint
} from "./outputCore";

export type OutputPlaceDisplayDelta = { x: number; y: number };

const translatePoint = (point: OutputPoint, delta: OutputPlaceDisplayDelta): OutputPoint => ({
  x: point.x + delta.x,
  y: point.y + delta.y
});

const translateSegment = (
  segment: OutputPathSegment,
  delta: OutputPlaceDisplayDelta
): OutputPathSegment => {
  if (segment.kind === "line") {
    return {
      ...segment,
      start: translatePoint(segment.start, delta),
      end: translatePoint(segment.end, delta)
    };
  }
  if (segment.kind === "bezier") {
    return {
      ...segment,
      start: translatePoint(segment.start, delta),
      control1: translatePoint(segment.control1, delta),
      control2: translatePoint(segment.control2, delta),
      end: translatePoint(segment.end, delta)
    };
  }
  return { ...segment, center: translatePoint(segment.center, delta) };
};

const translateDrawable = (drawable: OutputDrawable, delta: OutputPlaceDisplayDelta): OutputDrawable => {
  if (drawable.kind === "text") {
    return { ...drawable, anchor: translatePoint(drawable.anchor, delta) };
  }
  if (drawable.kind === "line" || drawable.kind === "bezier" || drawable.kind === "arc") {
    return translateSegment(drawable, delta) as OutputPath;
  }
  return { ...drawable, segments: drawable.segments.map((segment) => translateSegment(segment, delta)) };
};

/** Projects an absolute drag delta onto one already-resolved placement for display. */
export const projectOutputPlanForPlaceTranslation = ({
  acceptedPlan,
  placeId,
  delta
}: {
  acceptedPlan: OutputPlan;
  placeId: string;
  delta: OutputPlaceDisplayDelta;
}): OutputPlan | null => {
  if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y)) return null;
  const matching = acceptedPlan.placements.filter((placement) => placement.id === placeId);
  if (matching.length !== 1) return null;
  if (delta.x === 0 && delta.y === 0) return acceptedPlan;

  const placements = acceptedPlan.placements.map((placement) => placement.id !== placeId
    ? placement
    : {
        ...placement,
        at: translatePoint(placement.at, delta),
        drawables: placement.drawables.map((drawable) => translateDrawable(drawable, delta))
      });
  return rebuildOutputPlanFromResolvedPlacements(acceptedPlan, placements);
};
